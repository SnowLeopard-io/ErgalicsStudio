// ==========================================================================
// sim-montecarlo kernel — pure Monte Carlo sampling / statistics core.
//
// Deterministic given a seed (mulberry32 PRNG). Provides:
//   - distribution library (uniform / normal / triangular / PERT / beta /
//     empirical) with sampling, moments and inverse-CDF
//   - samplers: simple random, Latin hypercube, Sobol sequence
//   - Gaussian-copula rank-correlation structure between inputs
//   - a safe arithmetic expression evaluator (no eval / Function)
//   - output statistics, convergence diagnostics (running mean, Gelman-Rubin)
//   - tornado sensitivity data and scatter support helpers
// ==========================================================================

export type DistributionSpec = {
  dist: 'uniform' | 'normal' | 'triangular' | 'pert' | 'beta' | 'empirical';
  /** Distribution parameters (meaning depends on `dist`). */
  params: number[];
  /** Samples for the empirical distribution (sorted on use). */
  samples?: number[];
};

export interface InputVariable {
  name: string;
  spec: DistributionSpec;
}

// ---- PRNG ----------------------------------------------------------------

export interface Rng {
  next(): number;
}

/** mulberry32 — small, fast, deterministic 32-bit PRNG. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next(): number {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Standard normal sample via Box-Muller (cached second variate). */
export function rngNormal(rng: Rng): number {
  let u = rng.next();
  if (u <= 0) u = 2.220446049250313e-16;
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---- Distributions -------------------------------------------------------

/** Inverse of the standard normal CDF (Acklam's rational approximation). */
export function normalInvCdf(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pLow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

// ---- Distributions (inverse-transform sampling) --------------------------

/** Draw one sample of the distribution from a uniform variate u in [0,1)
 * (pure inverse-transform; keeps LHS/Sobol stratification intact). */
export function sampleDistribution(spec: DistributionSpec, u: number): number {
  switch (spec.dist) {
    case 'uniform': {
      const [a, b] = [spec.params[0] ?? 0, spec.params[1] ?? 1];
      return a + (b - a) * u;
    }
    case 'normal': {
      const [mu, sigma] = [spec.params[0] ?? 0, spec.params[1] ?? 1];
      return mu + sigma * normalInvCdf(Math.min(Math.max(u, 1e-15), 1 - 1e-15));
    }
    case 'triangular': {
      const [lo, mode, hi] = [spec.params[0] ?? 0, spec.params[1] ?? 0.5, spec.params[2] ?? 1];
      const f = (mode - lo) / Math.max(hi - lo, 1e-12);
      if (u < f) return lo + Math.sqrt(u * (hi - lo) * (mode - lo));
      return hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
    }
    case 'pert': {
      const [lo, mode, hi] = [spec.params[0] ?? 0, spec.params[1] ?? 0.5, spec.params[2] ?? 1];
      const lambda = spec.params[3] ?? 4;
      const w = Math.max(hi - lo, 1e-12);
      const alpha = 1 + lambda * (mode - lo) / w;
      const beta = 1 + lambda * (hi - mode) / w;
      return lo + w * betaQuantile(Math.min(Math.max(u, 1e-15), 1 - 1e-15), alpha, beta);
    }
    case 'beta': {
      const [alpha, beta] = [spec.params[0] ?? 2, spec.params[1] ?? 2];
      return betaQuantile(Math.min(Math.max(u, 1e-15), 1 - 1e-15), alpha, beta);
    }
    case 'empirical': {
      const xs = spec.samples ?? [];
      if (xs.length === 0) return NaN;
      const idx = Math.min(xs.length - 1, Math.floor(u * xs.length));
      return xs[idx]!;
    }
  }
}

function lnGamma(x: number): number {
  // Lanczos approximation (g=7, n=9).
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  x -= 1;
  let acc = c[0]!;
  for (let i = 1; i < 9; i++) acc += c[i]! / (x + i);
  const t = x + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(acc);
}

/** Regularized incomplete beta function I_x(a,b) (continued fraction). */
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lbeta);
  if (x < (a + 1) / (a + b + 2)) {
    return front * betacf(x, a, b) / a;
  }
  return 1 - front * betacf(1 - x, b, a) / b;
}

function betacf(x: number, a: number, b: number): number {
  const fpmin = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < fpmin) d = fpmin;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpmin) d = fpmin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpmin) c = fpmin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

/** Beta distribution quantile via bisection on the regularized incomplete beta. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let it = 0; it < 80; it++) {
    const mid = 0.5 * (lo + hi);
    if (betaCdf(mid, a, b) < p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export function distributionMean(spec: DistributionSpec): number {
  switch (spec.dist) {
    case 'uniform': return ((spec.params[0] ?? 0) + (spec.params[1] ?? 1)) / 2;
    case 'normal': return spec.params[0] ?? 0;
    case 'triangular': {
      const [a, m, b] = [spec.params[0] ?? 0, spec.params[1] ?? 0.5, spec.params[2] ?? 1];
      return (a + m + b) / 3;
    }
    case 'pert': {
      const [a, m, b] = [spec.params[0] ?? 0, spec.params[1] ?? 0.5, spec.params[2] ?? 1];
      const lambda = spec.params[3] ?? 4;
      return (a + lambda * m + b) / (lambda + 2);
    }
    case 'beta': {
      const [al, be] = [spec.params[0] ?? 2, spec.params[1] ?? 2];
      return al / (al + be);
    }
    case 'empirical': {
      const xs = spec.samples ?? [];
      if (!xs.length) return NaN;
      return xs.reduce((s, v) => s + v, 0) / xs.length;
    }
  }
}

export function distributionStd(spec: DistributionSpec): number {
  switch (spec.dist) {
    case 'uniform': {
      const w = (spec.params[1] ?? 1) - (spec.params[0] ?? 0);
      return w / Math.sqrt(12);
    }
    case 'normal': return Math.abs(spec.params[1] ?? 1);
    case 'triangular': {
      const [a, m, b] = [spec.params[0] ?? 0, spec.params[1] ?? 0.5, spec.params[2] ?? 1];
      return Math.sqrt((a * a + m * m + b * b - a * m - a * b - m * b) / 18);
    }
    case 'pert': return Math.max(distributionMax(spec) - distributionMin(spec), 0) / 6;
    case 'beta': {
      const [al, be] = [spec.params[0] ?? 2, spec.params[1] ?? 2];
      const ab = al + be;
      return Math.sqrt(al * be / (ab * ab * (ab + 1)));
    }
    case 'empirical': {
      const xs = spec.samples ?? [];
      const mu = distributionMean(spec);
      return Math.sqrt(xs.reduce((s, v) => s + (v - mu) * (v - mu), 0) / Math.max(xs.length - 1, 1));
    }
  }
}

export function distributionMin(spec: DistributionSpec): number {
  switch (spec.dist) {
    case 'uniform': return spec.params[0] ?? 0;
    case 'normal': return (spec.params[0] ?? 0) - 4 * Math.abs(spec.params[1] ?? 1);
    case 'triangular':
    case 'pert': {
      const ps = spec.params;
      return Math.min(ps[0] ?? 0, ps[2] ?? 1);
    }
    case 'beta': return 0;
    case 'empirical': {
      const xs = spec.samples ?? [];
      return xs.length ? Math.min(...xs) : NaN;
    }
  }
}

export function distributionMax(spec: DistributionSpec): number {
  switch (spec.dist) {
    case 'uniform': return spec.params[1] ?? 1;
    case 'normal': return (spec.params[0] ?? 0) + 4 * Math.abs(spec.params[1] ?? 1);
    case 'triangular':
    case 'pert': {
      const ps = spec.params;
      return Math.max(ps[0] ?? 0, ps[2] ?? 1);
    }
    case 'beta': return 1;
    case 'empirical': {
      const xs = spec.samples ?? [];
      return xs.length ? Math.max(...xs) : NaN;
    }
  }
}

// ---- Samplers ------------------------------------------------------------

export type SamplerKind = 'random' | 'lhs' | 'sobol';

/** Independent U[0,1) matrix (N rows x k columns). */
export function sampleRandom(n: number, k: number, rng: Rng): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(k);
    for (let j = 0; j < k; j++) row[j] = rng.next();
    out.push(row);
  }
  return out;
}

/** Latin hypercube: one sample per stratum per column (seeded permutation). */
export function sampleLhs(n: number, k: number, rng: Rng): number[][] {
  const strata: number[][] = [];
  for (let j = 0; j < k; j++) {
    const perm: number[] = new Array(n);
    for (let i = 0; i < n; i++) perm[i] = i;
    for (let i = n - 1; i > 0; i--) {
      const r = Math.floor(rng.next() * (i + 1));
      const t = perm[i]!;
      perm[i] = perm[r]!;
      perm[r] = t;
    }
    strata.push(perm);
  }
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(k);
    for (let j = 0; j < k; j++) {
      const s = strata[j]![i]!;
      row[j] = (s + rng.next()) / n;
    }
    out.push(row);
  }
  return out;
}

// ---- Sobol sequence ------------------------------------------------------

/** Primitive polynomials over GF(2) for Sobol dimensions 1..15, encoded as
 * bitmasks (bit j set = a_j coefficient of x^s + a_{s-1}x^{s-1} + ... + a_1 x + 1;
 * the trailing constant 1 is implicit). Several dimensions may share a
 * primitive polynomial of a different degree — this is standard practice. */
const SOBOL_POLY: number[] = [3, 3, 3, 5, 3, 3, 113, 17, 9, 5, 3, 3, 3, 5, 3];
/** Degrees of the corresponding polynomials (dim 1..15). */
const SOBOL_DEG: number[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 2, 3, 4, 5, 6];

/** Direction-number table per dimension. Initial m_i = 2^(i-1) + 1 (odd, with
 * leading bit at position i-1) guarantee upper-triangular full-rank generator
 * matrices, hence the (0,m,s)-net property; only the discrepancy constant
 * differs from the canonical Joe-Kuo initial values. */
function sobolDirections(dim: number): Uint32Array[] {
  const dirs: Uint32Array[] = [];
  for (let d = 0; d < dim; d++) {
    const v = new Uint32Array(32);
    if (d === 0) {
      for (let i = 1; i <= 32; i++) v[i - 1] = 1 << (32 - i);
    } else {
      const poly = SOBOL_POLY[d - 1]!;
      const s = SOBOL_DEG[d - 1]!;
      const m: number[] = [];
      for (let i = 1; i <= s; i++) m.push(i === 1 ? 1 : (1 << (i - 1)) + 1);
      // Bratley-Fox recurrence:
      // m_i = 2^s * m_{i-s} XOR m_{i-s} XOR (XOR_j a_j * 2^j * m_{i-j})
      for (let i = s + 1; i <= 32; i++) {
        let acc = (m[i - s - 1]! << s) ^ m[i - s - 1]!;
        for (let j = 1; j < s; j++) {
          if ((poly >>> j) & 1) acc ^= m[i - j - 1]! << j;
        }
        m.push(acc & 0xffffffff);
      }
      for (let i = 1; i <= 32; i++) {
        const mi = m[i - 1]!;
        v[i - 1] = mi << (32 - i);
      }
    }
    dirs.push(v);
  }
  return dirs;
}

/** Sobol sequence (Gray-code construction) — up to 16 dimensions. */
export function sampleSobol(n: number, k: number): number[][] {
  const dim = Math.min(k, 16);
  const dirs = sobolDirections(dim);
  const out: number[][] = [];
  let x = new Uint32Array(dim);
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(k);
    if (i > 0) {
      const c = (i & -i) === 0 ? 31 : 31 - Math.clz32(i & -i); // trailing zeros
      for (let d = 0; d < dim; d++) x[d] = (x[d]! ^ dirs[d]![c]!) >>> 0;
    }
    for (let d = 0; d < dim; d++) row[d] = x[d]! / 4294967296;
    for (let d = dim; d < k; d++) row[d] = 0.5;
    out.push(row);
  }
  return out;
}

// ---- Gaussian copula (rank correlation) ----------------------------------

/** Cholesky factor of a symmetric positive-definite matrix (with diagonal
 * jitter fallback). Returns null if the matrix cannot be factored. */
export function cholesky(a: number[][]): number[][] | null {
  const n = a.length;
  const jitter = [0, 1e-10, 1e-8, 1e-6, 1e-4];
  for (const eps of jitter) {
    const l: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    let ok = true;
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = a[i]![j]! + (i === j ? eps : 0);
        for (let p = 0; p < j; p++) sum -= l[i]![p]! * l[j]![p]!;
        if (i === j) {
          if (sum <= 0) { ok = false; break; }
          l[i]![j] = Math.sqrt(sum);
        } else {
          l[i]![j] = sum / l[j]![j]!;
        }
      }
    }
    if (ok) return l;
  }
  return null;
}

/** Apply a Gaussian copula to a U[0,1) matrix so that column rank
 * correlations approximate the target correlation matrix. */
export function applyGaussianCopula(u: number[][], corr: number[][]): number[][] {
  const k = corr.length;
  const l = cholesky(corr);
  if (!l) return u;
  const n = u.length;
  // z-score each column (inverse CDF), correlate, map back through normal CDF.
  const z: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(k);
    for (let j = 0; j < k; j++) row[j] = normalInvCdf(Math.min(Math.max(u[i]![j]!, 1e-12), 1 - 1e-12));
    z.push(row);
  }
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(k);
    for (let j = 0; j < k; j++) {
      let acc = 0;
      for (let p = 0; p <= j; p++) acc += l[j]![p]! * z[i]![p]!;
      // Phi(acc) via logistic-free erf approximation: use erfinv-free approach
      row[j] = normalCdf(acc);
    }
    out.push(row);
  }
  return out;
}

/** Standard normal CDF via erf (Abramowitz-Stegun 7.1.26). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI) * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

// ---- Expression evaluator ------------------------------------------------

interface Token { kind: 'num' | 'id' | 'op' | 'lp' | 'rp' | 'comma'; text: string }

const FUNCS = new Set(['min', 'max', 'abs', 'sqrt', 'exp', 'ln', 'log', 'pow', 'sin', 'cos', 'tan']);
const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3, 'u-': 4 };

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n') { i++; continue; }
    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.eE]/.test(src[j]!)) j++;
      // scientific notation: 1e-3 / 1E+5
      if (j < src.length && (src[j] === '+' || src[j] === '-') && /[eE]/.test(src[j - 1] ?? '') && j > i + 1 && /[eE]/.test(src[j - 1]!)) {
        // lookahead already consumed e; consume sign + digits
        let k = j + 1;
        while (k < src.length && /[0-9]/.test(src[k]!)) k++;
        tokens.push({ kind: 'num', text: src.slice(i, k) });
        i = k;
        continue;
      }
      tokens.push({ kind: 'num', text: src.slice(i, j) });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j]!)) j++;
      tokens.push({ kind: 'id', text: src.slice(i, j) });
      i = j;
      continue;
    }
    if ('+-*/^'.includes(ch)) { tokens.push({ kind: 'op', text: ch }); i++; continue; }
    if (ch === '(') { tokens.push({ kind: 'lp', text: ch }); i++; continue; }
    if (ch === ')') { tokens.push({ kind: 'rp', text: ch }); i++; continue; }
    if (ch === ',') { tokens.push({ kind: 'comma', text: ch }); i++; continue; }
    throw new Error(`Unexpected character '${ch}' at position ${i}`);
  }
  return tokens;
}

/** Shunting-yard: expression -> RPN token list. Validates identifiers against
 * the allowed variable/function set at parse time. */
export function parseExpression(src: string, variables: string[]): string[] {
  const vars = new Set(variables);
  const tokens = tokenize(src);
  const output: string[] = [];
  const stack: string[] = [];
  let prev: Token | null = null;
  for (const tk of tokens) {
    if (tk.kind === 'num') {
      if (!Number.isFinite(Number(tk.text))) throw new Error(`Invalid number '${tk.text}'`);
      output.push(tk.text);
    } else if (tk.kind === 'id') {
      if (FUNCS.has(tk.text)) {
        stack.push('f:' + tk.text);
      } else if (vars.has(tk.text)) {
        output.push('v:' + tk.text);
      } else {
        throw new Error(`Unknown identifier '${tk.text}'`);
      }
    } else if (tk.kind === 'op') {
      const unary = tk.text === '-' && (!prev || prev.kind === 'op' || prev.kind === 'lp' || prev.kind === 'comma');
      const op = unary ? 'u-' : tk.text;
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        if (top.startsWith('f:')) { output.push(stack.pop()!); continue; }
        if (PREC[top] !== undefined && PREC[top]! >= PREC[op]! && !(op === '^' && top === '^')) {
          output.push(stack.pop()!);
          continue;
        }
        break;
      }
      stack.push(op);
    } else if (tk.kind === 'lp') {
      stack.push('(');
    } else if (tk.kind === 'rp') {
      let found = false;
      while (stack.length) {
        const top = stack.pop()!;
        if (top === '(') { found = true; break; }
        output.push(top);
      }
      if (!found) throw new Error('Unbalanced parentheses');
      if (stack.length && stack[stack.length - 1]!.startsWith('f:')) output.push(stack.pop()!);
    } else if (tk.kind === 'comma') {
      let found = false;
      while (stack.length) {
        const top = stack[stack.length - 1]!;
        if (top === '(') { found = true; break; }
        output.push(stack.pop()!);
      }
      if (!found) throw new Error('Comma outside function call');
    }
    prev = tk;
  }
  while (stack.length) {
    const top = stack.pop()!;
    if (top === '(') throw new Error('Unbalanced parentheses');
    output.push(top);
  }
  return output;
}

/** Evaluate an RPN program against a variable scope. */
export function evalRpn(rpn: string[], scope: Record<string, number>): number {
  const st: number[] = [];
  for (const tk of rpn) {
    if (tk.startsWith('v:')) {
      const v = scope[tk.slice(2)];
      if (v === undefined || !Number.isFinite(v)) throw new Error(`Unbound variable '${tk.slice(2)}'`);
      st.push(v);
    } else if (tk.startsWith('f:')) {
      const f = tk.slice(2);
      const arity = f === 'pow' || f === 'min' || f === 'max' ? 2 : 1;
      if (st.length < arity) throw new Error(`Function '${f}' expects ${arity} argument(s)`);
      const args = st.splice(st.length - arity, arity);
      st.push(applyFunc(f, args));
    } else if (tk === 'u-') {
      if (!st.length) throw new Error('Missing operand');
      st.push(-st.pop()!);
    } else if (PREC[tk] !== undefined) {
      if (st.length < 2) throw new Error('Missing operand');
      const b = st.pop()!;
      const a = st.pop()!;
      st.push(applyOp(tk, a, b));
    } else {
      st.push(Number(tk));
    }
  }
  if (st.length !== 1) throw new Error('Malformed expression');
  return st[0]!;
}

function applyOp(op: string, a: number, b: number): number {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '^': return Math.pow(a, b);
    default: throw new Error(`Unknown operator '${op}'`);
  }
}

function applyFunc(f: string, args: number[]): number {
  const [a, b] = [args[0] ?? 0, args[1] ?? 0];
  switch (f) {
    case 'min': return Math.min(a, b);
    case 'max': return Math.max(a, b);
    case 'abs': return Math.abs(a);
    case 'sqrt': return Math.sqrt(a);
    case 'exp': return Math.exp(a);
    case 'ln': return Math.log(a);
    case 'log': return Math.log10(a);
    case 'pow': return Math.pow(a, b);
    case 'sin': return Math.sin(a);
    case 'cos': return Math.cos(a);
    case 'tan': return Math.tan(a);
    default: throw new Error(`Unknown function '${f}'`);
  }
}

// ---- Statistics ----------------------------------------------------------

export function mean(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return s / Math.max(xs.length, 1);
}

export function variance(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 2) return 0;
  const mu = mean(xs);
  let s = 0;
  for (let i = 0; i < n; i++) { const d = xs[i]! - mu; s += d * d; }
  return s / (n - 1);
}

export function std(xs: ArrayLike<number>): number {
  return Math.sqrt(variance(xs));
}

export function skewness(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mu = mean(xs);
  const sd = std(xs) || 1e-12;
  let s = 0;
  for (let i = 0; i < n; i++) { const d = (xs[i]! - mu) / sd; s += d * d * d; }
  return (n / ((n - 1) * (n - 2))) * s;
}

export function minMax(xs: ArrayLike<number>): { min: number; max: number } {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i]!;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return { min: mn === Infinity ? 0 : mn, max: mx === -Infinity ? 0 : mx };
}

/** Linear-interpolated percentile of an ascending-sorted array. */
export function percentileSorted(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * Math.min(Math.max(p, 0), 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (pos - lo) * (sorted[hi]! - sorted[lo]!);
}

export interface OutputStats {
  n: number;
  mean: number;
  std: number;
  skewness: number;
  min: number;
  max: number;
  p5: number;
  p50: number;
  p95: number;
  ci95Lo: number;
  ci95Hi: number;
}

export function summarize(xs: number[]): OutputStats {
  const sorted = [...xs].sort((a, b) => a - b);
  const m = mean(xs);
  const sd = std(xs);
  const half = 1.959963984540054 * sd / Math.sqrt(Math.max(xs.length, 1));
  return {
    n: xs.length,
    mean: m,
    std: sd,
    skewness: skewness(xs),
    min: sorted[0] ?? NaN,
    max: sorted[sorted.length - 1] ?? NaN,
    p5: percentileSorted(sorted, 0.05),
    p50: percentileSorted(sorted, 0.5),
    p95: percentileSorted(sorted, 0.95),
    ci95Lo: m - half,
    ci95Hi: m + half,
  };
}

export interface Histogram {
  binEdges: number[];
  counts: number[];
}

export function histogram(xs: number[], bins: number): Histogram {
  const { min, max } = minMax(xs);
  const span = max - min || 1;
  const edges: number[] = new Array(bins + 1);
  for (let i = 0; i <= bins; i++) edges[i] = min + (span * i) / bins;
  const counts = new Array(bins).fill(0);
  for (const v of xs) {
    let b = Math.floor(((v - min) / span) * bins);
    if (b < 0) b = 0;
    if (b >= bins) b = bins - 1;
    counts[b]!++;
  }
  return { binEdges: edges, counts };
}

// ---- Convergence diagnostics ---------------------------------------------

/** Running mean of a sample series (for convergence plots). */
export function runningMean(xs: number[]): number[] {
  const out: number[] = new Array(xs.length);
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += xs[i]!;
    out[i] = s / (i + 1);
  }
  return out;
}

/** Gelman-Rubin R-hat across m chains of equal length n. */
export function gelmanRubin(chains: number[][]): number {
  const m = chains.length;
  if (m < 2) return 1;
  const n = Math.min(...chains.map((c) => c.length));
  if (n < 2) return 1;
  const means = chains.map((c) => mean(c.slice(0, n)));
  const grand = mean(means);
  let b = 0;
  for (const mu of means) b += (mu - grand) * (mu - grand);
  b = (n / (m - 1)) * b;
  let w = 0;
  for (const c of chains) w += variance(c.slice(0, n));
  w /= m;
  const varPlus = ((n - 1) / n) * w + b / n;
  if (w <= 0) return varPlus <= 0 ? 1 : Infinity;
  return Math.sqrt(varPlus / w);
}

// ---- Sensitivity -----------------------------------------------------------

/** Spearman rank correlation (average ranks for ties). */
export function rankCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 3) return 0;
  const ranks = (arr: number[]): number[] => {
    const idx = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const r = new Array<number>(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1]!.v === idx[i]!.v) j++;
      const avg = (i + j) / 2 + 1;
      for (let p = i; p <= j; p++) r[idx[p]!.i] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = ranks(x.slice(0, n));
  const ry = ranks(y.slice(0, n));
  return pearson(rx, ry);
}

export function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x.slice(0, n));
  const my = mean(y.slice(0, n));
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const den = Math.sqrt(sxx * syy);
  return den > 0 ? sxy / den : 0;
}

export interface TornadoBar {
  name: string;
  /** Output at the input's low percentile (others at median). */
  low: number;
  /** Output at the input's high percentile. */
  high: number;
  /** Median-baseline output. */
  base: number;
}

export interface McRunResult {
  stats: OutputStats;
  histogram: Histogram;
  inputs: InputVariable[];
  samples: number[][];
  outputs: number[];
  inputNames: string[];
  rhat: number | null;
  correlations: Array<{ name: string; spearman: number }>;
  tornado: TornadoBar[];
  sampler: SamplerKind;
  /** Per-chain running means (null when fewer than 2 chains). */
  chainRunningMeans: number[][] | null;
}

export interface McRunOptions {
  inputs: InputVariable[];
  expression: string;
  n: number;
  sampler: SamplerKind;
  seed: number;
  /** Rank-correlation matrix (k x k); null = independent inputs. */
  corr?: number[][] | null;
  chains?: number;
  computeSensitivity?: boolean;
}

/** Full Monte Carlo run: design matrix -> model evaluation -> diagnostics. */
export function runMonteCarlo(opts: McRunOptions): McRunResult {
  const { inputs, expression, n, sampler, seed } = opts;
  const k = inputs.length;
  const names = inputs.map((v) => v.name);
  const rpn = parseExpression(expression, names);
  const rng = createRng(seed);

  // Design matrix of uniforms.
  let u: number[][];
  if (sampler === 'sobol') {
    u = sampleSobol(n, k);
  } else if (sampler === 'lhs') {
    u = sampleLhs(n, k, rng);
  } else {
    u = sampleRandom(n, k, rng);
  }
  if (opts.corr && opts.corr.length === k) u = applyGaussianCopula(u, opts.corr);

  // Inverse-CDF transform to the target distributions.
  const samples: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(k);
    for (let j = 0; j < k; j++) row[j] = sampleDistribution(inputs[j]!.spec, u[i]![j]!);
    samples[i] = row;
  }

  // Model evaluation.
  const outputs: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const scope: Record<string, number> = {};
    for (let j = 0; j < k; j++) scope[names[j]!] = samples[i]![j]!;
    outputs[i] = evalRpn(rpn, scope);
  }

  const stats = summarize(outputs);
  const hist = histogram(outputs, Math.min(60, Math.max(10, Math.round(Math.sqrt(n)))));

  // Gelman-Rubin over independent chains (fresh seeds).
  let rhat: number | null = null;
  let chainRunningMeans: number[][] | null = null;
  const chains = Math.max(0, opts.chains ?? 0);
  if (chains >= 2) {
    const chainSamples: number[][] = [];
    // Sobol chains use disjoint contiguous blocks of one long sequence (the
    // sequence itself is deterministic); random/LHS chains use fresh seeds.
    const sobolAll = sampler === 'sobol' ? sampleSobol(n * chains, k) : null;
    for (let c = 0; c < chains; c++) {
      const cu = sobolAll
        ? sobolAll.slice(c * n, (c + 1) * n)
        : sampler === 'lhs'
          ? sampleLhs(n, k, createRng(seed + 7919 * (c + 1)))
          : sampleRandom(n, k, createRng(seed + 7919 * (c + 1)));
      if (opts.corr && opts.corr.length === k) {
        const correlated = applyGaussianCopula(cu, opts.corr);
        for (let i = 0; i < n; i++) cu[i] = correlated[i]!;
      }
      const cout: number[] = new Array(n);
      for (let i = 0; i < n; i++) {
        const scope: Record<string, number> = {};
        for (let j = 0; j < k; j++) scope[names[j]!] = sampleDistribution(inputs[j]!.spec, cu[i]![j]!);
        cout[i] = evalRpn(rpn, scope);
      }
      chainSamples.push(cout);
    }
    rhat = gelmanRubin(chainSamples);
    chainRunningMeans = chainSamples.map((c) => runningMean(c));
  }

  // Sensitivity.
  const correlations: Array<{ name: string; spearman: number }> = [];
  if (opts.computeSensitivity) {
    for (let j = 0; j < k; j++) {
      correlations.push({ name: names[j]!, spearman: rankCorrelation(samples.map((r) => r[j]!), outputs) });
    }
  }

  // Tornado: perturb each input between its P10 and P90, others at median.
  const tornado: TornadoBar[] = [];
  if (opts.computeSensitivity) {
    const sortedCols: number[][] = [];
    for (let j = 0; j < k; j++) sortedCols.push([...samples.map((r) => r[j]!)].sort((a, b) => a - b));
    for (let j = 0; j < k; j++) {
      const p10 = percentileSorted(sortedCols[j]!, 0.1);
      const p90 = percentileSorted(sortedCols[j]!, 0.9);
      const evaluate = (val: number): number => {
        const scope: Record<string, number> = {};
        for (let q = 0; q < k; q++) scope[names[q]!] = q === j ? val : percentileSorted(sortedCols[q]!, 0.5);
        return evalRpn(rpn, scope);
      };
      tornado.push({ name: names[j]!, low: evaluate(p10), high: evaluate(p90), base: evaluate(percentileSorted(sortedCols[j]!, 0.5)) });
    }
    tornado.sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  }

  return { stats, histogram: hist, inputs, samples, outputs, inputNames: names, rhat, correlations, tornado, sampler, chainRunningMeans };
}

/** Parse the input-variable table: one variable per line,
 * `name,dist,p1,p2,p3[,p4]` (empirical uses p1 as a semicolon sample list). */
export function parseInputsTable(text: string): InputVariable[] {
  const vars: InputVariable[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(',').map((p) => p.trim());
    if (parts.length < 2) continue;
    const name = parts[0]!;
    const dist = parts[1]!.toLowerCase() as DistributionSpec['dist'];
    if (!['uniform', 'normal', 'triangular', 'pert', 'beta', 'empirical'].includes(dist)) {
      throw new Error(`Unknown distribution '${parts[1]}' for variable '${name}'`);
    }
    if (dist === 'empirical') {
      const xs = (parts[2] ?? '').split(/[; ]+/).filter(Boolean).map(Number);
      if (!xs.length || xs.some((v) => !Number.isFinite(v))) throw new Error(`Empirical samples for '${name}' must be finite numbers`);
      vars.push({ name, spec: { dist, params: [], samples: xs.sort((a, b) => a - b) } });
    } else {
      const params = parts.slice(2).map(Number);
      if (params.some((v) => !Number.isFinite(v))) throw new Error(`Parameters for '${name}' must be finite numbers`);
      vars.push({ name, spec: { dist, params } });
    }
  }
  const seen = new Set<string>();
  for (const v of vars) {
    if (seen.has(v.name)) throw new Error(`Duplicate variable name '${v.name}'`);
    seen.add(v.name);
  }
  return vars;
}

/** Parse a square whitespace/CSV correlation matrix. */
export function parseCorrMatrix(text: string, k: number): number[][] | null {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!rows.length) return null;
  const m = rows.map((r) => r.split(/[\s,;]+/).map(Number));
  if (m.length !== k || m.some((r) => r.length !== k)) throw new Error(`Correlation matrix must be ${k}x${k}`);
  for (const row of m) {
    if (row.some((v) => !Number.isFinite(v))) throw new Error('Correlation matrix contains non-numeric entries');
  }
  for (let i = 0; i < k; i++) {
    if (Math.abs(m[i]![i]! - 1) > 1e-9) throw new Error('Diagonal of correlation matrix must be 1');
    for (let j = 0; j < i; j++) {
      if (Math.abs(m[i]![j]! - m[j]![i]!) > 1e-9) throw new Error('Correlation matrix must be symmetric');
      if (Math.abs(m[i]![j]!) > 1) throw new Error('Correlations must be in [-1, 1]');
    }
  }
  return m;
}
