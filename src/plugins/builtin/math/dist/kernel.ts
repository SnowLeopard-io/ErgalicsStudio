/* eslint-disable no-loss-of-precision -- Wichura AS241 coefficients are transcribed at their published decimal precision; JavaScript rounds each literal to the nearest double, which is exactly the intended constant. */
// ==========================================================================
// math-dist — probability distribution numerics (pure, dependency-free, testable)
//
// Ten standard families (Normal, Poisson, Exponential, Beta, Gamma,
// Student-t, Chi-squared, F, Binomial, Geometric) with pdf/pmf, cdf and
// quantile (ppf) evaluators built on Lanczos log-gamma, series / continued-
// fraction incomplete gamma, Lentz continued-fraction incomplete beta and
// the AS241 inverse normal. Also: a seeded mulberry32 RNG with Box-Muller
// and inverse-transform samplers, density histograms, closed-form MLE fits,
// built-in sample datasets and the embedded validation suite.
//
// All functions are pure so the kernel unit-tests without a canvas or DOM.
// The unified error metric throughout is |computed − analytic|/|analytic|.
// ==========================================================================

// ---- special functions ------------------------------------------------------------

/** Lanczos approximation coefficients (g = 7, n = 9) for the gamma function. */
const LANCZOS_G = 7;
const LANCZOS_P = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** Natural logarithm of the gamma function (reflection for z < 0.5). */
export function logGamma(z: number): number {
  if (z <= 0 && Number.isInteger(z)) return Infinity;
  if (z < 0.5) {
    // Euler reflection: Γ(z)Γ(1 − z) = π / sin(πz).
    return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - logGamma(1 - z);
  }
  const x = z - 1;
  let acc = LANCZOS_P[0]!;
  for (let i = 1; i < LANCZOS_P.length; i += 1) acc += LANCZOS_P[i]! / (x + i);
  const t = x + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(acc);
}

/** Gamma function via logGamma. */
export function gammaFn(z: number): number {
  return Math.exp(logGamma(z));
}

/**
 * Regularized incomplete gamma P(a, x) and Q(a, x) = 1 − P(a, x).
 * P uses the power series for x < a + 1, Q the Lentz continued fraction
 * otherwise, so both tails keep full relative precision.
 */
function gammaPQ(a: number, x: number): { p: number; q: number } {
  if (!(a > 0)) return { p: NaN, q: NaN };
  if (!(x > 0)) return { p: 0, q: 1 };
  const gln = logGamma(a);
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 500; n += 1) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    const p = Math.min(1, sum * Math.exp(-x + a * Math.log(x) - gln));
    return { p, q: 1 - p };
  }
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 500; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  const q = Math.min(1, Math.max(0, Math.exp(-x + a * Math.log(x) - gln) * h));
  return { p: 1 - q, q };
}

/** Regularized lower incomplete gamma P(a, x) = γ(a, x)/Γ(a). */
export function lowerGammaP(a: number, x: number): number {
  return gammaPQ(a, x).p;
}

/** Regularized upper incomplete gamma Q(a, x) = Γ(a, x)/Γ(a). */
export function upperGammaQ(a: number, x: number): number {
  return gammaPQ(a, x).q;
}

/** Error function from the half-integer incomplete gamma. */
export function erf(x: number): number {
  return x >= 0 ? lowerGammaP(0.5, x * x) : -lowerGammaP(0.5, x * x);
}

/** Complementary error function (both tails keep full precision). */
export function erfc(x: number): number {
  return x >= 0 ? upperGammaQ(0.5, x * x) : 1 + lowerGammaP(0.5, x * x);
}

/** Standard normal CDF Φ(z) via erfc. */
export function normalCdf(z: number): number {
  return 0.5 * erfc(-z / Math.SQRT2);
}

/**
 * Inverse standard normal CDF — Wichura's AS241 (PPND16), relative error
 * near machine precision over the whole open interval (0, 1).
 */
export function normalPpf(p: number): number {
  const q = p - 0.5;
  if (Math.abs(q) <= 0.425) {
    const r = 0.180625 - q * q;
    const num =
      (((((((2509.0809287301226727 * r + 33430.575583588128105) * r + 67265.770927008700853) * r +
        45921.953931549871457) *
        r +
        13731.693765509461125) *
        r +
        1971.5909503065514427) *
        r +
        133.14166789178437745) *
        r +
      3.387132872796366608);
    const den =
      (((((((5226.495278852854561 * r + 28729.085735721942674) * r + 39307.89580009271061) * r +
        21213.794301586595867) *
        r +
        5394.1960214247511077) *
        r +
        687.1870074920579083) *
        r +
        42.313330701600911252) *
        r +
      1);
    return (q * num) / den;
  }
  let r = p < 0.5 ? p : 1 - p;
  r = Math.sqrt(-Math.log(r));
  let val: number;
  if (r <= 5) {
    r -= 1.6;
    const num =
      (((((((7.7454501427834140764e-4 * r + 2.27238449892691845833e-2) * r + 2.4178072517745061177e-1) * r +
        1.27045825245236838258) *
        r +
        3.64784832476320460504) *
        r +
        5.7694972214606914055) *
        r +
        4.6303378461565452959) *
        r +
      1.42343711074968357734);
    const den =
      (((((((1.05075007164441684324e-9 * r + 5.475938084995344946e-4) * r + 1.51986665636164571966e-2) * r +
        1.4810397642748007459e-1) *
        r +
        6.8976733498510000455e-1) *
        r +
        1.6763848301838038494) *
        r +
        2.05319162663775882187) *
        r +
      1);
    val = num / den;
  } else {
    r -= 5;
    const num =
      (((((((2.01033439929228813265e-14 * r + 2.71155556874348757815e-5) * r + 1.2426609473880784386e-3) * r +
        2.6532189526576123093e-2) *
        r +
        2.9656057182850489123e-1) *
        r +
        1.7848265399172913358) *
        r +
        5.4637849111641143699) *
        r +
      6.6579046435011037772);
    const den =
      (((((((2.04426310338993978564e-15 * r + 1.4215117583164458887e-7) * r + 1.8463183175100546818e-5) * r +
        7.868691311456132591e-4) *
        r +
        1.48753612908506148525e-2) *
        r +
        1.3692988092273580531e-1) *
        r +
        5.9983220655588793769e-1) *
        r +
      1);
    val = num / den;
  }
  return q < 0 ? -val : val;
}

/** Lentz continued fraction for the incomplete beta integral. */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-16;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function regularizedBetaI(x: number, a: number, b: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - lbeta);
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Natural log of B(a, b). */
function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

// ---- distribution catalogue ----------------------------------------------------------

export type DistId =
  | 'normal'
  | 'poisson'
  | 'exponential'
  | 'beta'
  | 'gamma'
  | 't'
  | 'chisq'
  | 'f'
  | 'binomial'
  | 'geometric';

/** One slider-able parameter of a family (pure metadata). */
export interface DistParamDef {
  /** State key, unique across all families (e.g. `normalMu`). */
  key: string;
  labelEn: string;
  labelZh: string;
  /** Short symbol used in canvas captions (e.g. `μ`). */
  symbol: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface DistDef {
  id: DistId;
  labelEn: string;
  labelZh: string;
  kind: 'continuous' | 'discrete';
  params: DistParamDef[];
  /** Theoretical mean; NaN when undefined for the parameter range. */
  mean: (p: Record<string, number>) => number;
  /** Theoretical variance; NaN when undefined for the parameter range. */
  variance: (p: Record<string, number>) => number;
}

/** Parameter accessor with a fallback (missing keys use family defaults). */
function pr(p: Record<string, number>, key: string, dflt: number): number {
  const v = p[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : dflt;
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export const DISTS: DistDef[] = [
  {
    id: 'normal',
    labelEn: 'Normal (Gaussian)',
    labelZh: '正态（高斯）分布',
    kind: 'continuous',
    params: [
      { key: 'normalMu', labelEn: 'Mean μ', labelZh: '均值 μ', symbol: 'μ', min: -6, max: 6, step: 0.1, default: 0 },
      { key: 'normalSigma', labelEn: 'Std dev σ', labelZh: '标准差 σ', symbol: 'σ', min: 0.1, max: 5, step: 0.05, default: 1 },
    ],
    mean: (p) => pr(p, 'normalMu', 0),
    variance: (p) => Math.pow(pr(p, 'normalSigma', 1), 2),
  },
  {
    id: 'poisson',
    labelEn: 'Poisson',
    labelZh: '泊松分布',
    kind: 'discrete',
    params: [
      { key: 'poissonLambda', labelEn: 'Rate λ', labelZh: '强度 λ', symbol: 'λ', min: 0.1, max: 40, step: 0.1, default: 4 },
    ],
    mean: (p) => pr(p, 'poissonLambda', 4),
    variance: (p) => pr(p, 'poissonLambda', 4),
  },
  {
    id: 'exponential',
    labelEn: 'Exponential',
    labelZh: '指数分布',
    kind: 'continuous',
    params: [
      { key: 'expLambda', labelEn: 'Rate λ', labelZh: '率参数 λ', symbol: 'λ', min: 0.05, max: 3, step: 0.05, default: 0.5 },
    ],
    mean: (p) => 1 / pr(p, 'expLambda', 0.5),
    variance: (p) => 1 / Math.pow(pr(p, 'expLambda', 0.5), 2),
  },
  {
    id: 'beta',
    labelEn: 'Beta',
    labelZh: 'Beta 分布',
    kind: 'continuous',
    params: [
      { key: 'betaA', labelEn: 'Shape α', labelZh: '形状 α', symbol: 'α', min: 0.2, max: 10, step: 0.1, default: 2 },
      { key: 'betaB', labelEn: 'Shape β', labelZh: '形状 β', symbol: 'β', min: 0.2, max: 10, step: 0.1, default: 3 },
    ],
    mean: (p) => {
      const a = pr(p, 'betaA', 2);
      const b = pr(p, 'betaB', 3);
      return a / (a + b);
    },
    variance: (p) => {
      const a = pr(p, 'betaA', 2);
      const b = pr(p, 'betaB', 3);
      const s = a + b;
      return (a * b) / (s * s * (s + 1));
    },
  },
  {
    id: 'gamma',
    labelEn: 'Gamma (shape–rate)',
    labelZh: 'Gamma 分布（形状–率）',
    kind: 'continuous',
    params: [
      { key: 'gammaShape', labelEn: 'Shape α', labelZh: '形状 α', symbol: 'α', min: 0.2, max: 10, step: 0.1, default: 2 },
      { key: 'gammaRate', labelEn: 'Rate β', labelZh: '率参数 β', symbol: 'β', min: 0.1, max: 5, step: 0.1, default: 1 },
    ],
    mean: (p) => pr(p, 'gammaShape', 2) / pr(p, 'gammaRate', 1),
    variance: (p) => pr(p, 'gammaShape', 2) / Math.pow(pr(p, 'gammaRate', 1), 2),
  },
  {
    id: 't',
    labelEn: "Student-t",
    labelZh: 'Student-t 分布',
    kind: 'continuous',
    params: [
      { key: 'tNu', labelEn: 'Degrees of freedom ν', labelZh: '自由度 ν', symbol: 'ν', min: 2, max: 60, step: 1, default: 5 },
    ],
    mean: (p) => {
      const nu = pr(p, 'tNu', 5);
      return nu > 1 ? 0 : NaN;
    },
    variance: (p) => {
      const nu = pr(p, 'tNu', 5);
      return nu > 2 ? nu / (nu - 2) : NaN;
    },
  },
  {
    id: 'chisq',
    labelEn: 'Chi-squared',
    labelZh: '卡方分布',
    kind: 'continuous',
    params: [
      { key: 'chisqK', labelEn: 'Degrees of freedom k', labelZh: '自由度 k', symbol: 'k', min: 1, max: 40, step: 1, default: 3 },
    ],
    mean: (p) => pr(p, 'chisqK', 3),
    variance: (p) => 2 * pr(p, 'chisqK', 3),
  },
  {
    id: 'f',
    labelEn: 'F (variance ratio)',
    labelZh: 'F 分布（方差比）',
    kind: 'continuous',
    params: [
      { key: 'fD1', labelEn: 'Numerator df d₁', labelZh: '分子自由度 d₁', symbol: 'd1', min: 1, max: 30, step: 1, default: 4 },
      { key: 'fD2', labelEn: 'Denominator df d₂', labelZh: '分母自由度 d₂', symbol: 'd2', min: 3, max: 30, step: 1, default: 6 },
    ],
    mean: (p) => {
      const d2 = pr(p, 'fD2', 6);
      return d2 > 2 ? d2 / (d2 - 2) : NaN;
    },
    variance: (p) => {
      const d1 = pr(p, 'fD1', 4);
      const d2 = pr(p, 'fD2', 6);
      if (d2 <= 4) return NaN;
      return (2 * d2 * d2 * (d1 + d2 - 2)) / (d1 * (d2 - 2) * (d2 - 2) * (d2 - 4));
    },
  },
  {
    id: 'binomial',
    labelEn: 'Binomial',
    labelZh: '二项分布',
    kind: 'discrete',
    params: [
      { key: 'binomN', labelEn: 'Trials n', labelZh: '试验次数 n', symbol: 'n', min: 1, max: 100, step: 1, default: 20 },
      { key: 'binomP', labelEn: 'Success probability p', labelZh: '成功概率 p', symbol: 'p', min: 0.05, max: 0.95, step: 0.05, default: 0.3 },
    ],
    mean: (p) => pr(p, 'binomN', 20) * pr(p, 'binomP', 0.3),
    variance: (p) => pr(p, 'binomN', 20) * pr(p, 'binomP', 0.3) * (1 - pr(p, 'binomP', 0.3)),
  },
  {
    id: 'geometric',
    labelEn: 'Geometric (trials to first success)',
    labelZh: '几何分布（首次成功试验数）',
    kind: 'discrete',
    params: [
      { key: 'geomP', labelEn: 'Success probability p', labelZh: '成功概率 p', symbol: 'p', min: 0.05, max: 0.95, step: 0.05, default: 0.35 },
    ],
    mean: (p) => 1 / pr(p, 'geomP', 0.35),
    variance: (p) => (1 - pr(p, 'geomP', 0.35)) / Math.pow(pr(p, 'geomP', 0.35), 2),
  },
];

const DIST_MAP = new Map<DistId, DistDef>(DISTS.map((d) => [d.id, d]));

/** Metadata lookup for a family id. */
export function getDist(id: DistId): DistDef {
  const def = DIST_MAP.get(id);
  if (!def) throw new Error(`unknown distribution '${id}'`);
  return def;
}

/** Default parameter record of one family. */
export function defaultParams(id: DistId): Record<string, number> {
  const out: Record<string, number> = {};
  for (const pd of getDist(id).params) out[pd.key] = pd.default;
  return out;
}

/** Default parameter record spanning every family (plugin initial state). */
export function allDefaultParams(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const def of DISTS) for (const pd of def.params) out[pd.key] = pd.default;
  return out;
}

// ---- pdf / pmf --------------------------------------------------------------------

function normalPdf(mu: number, sigma: number, x: number): number {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

function poissonPmf(lam: number, k: number): number {
  if (lam <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lam + k * Math.log(lam) - logGamma(k + 1));
}

function exponentialPdf(lam: number, x: number): number {
  return x < 0 ? 0 : lam * Math.exp(-lam * x);
}

function betaPdf(a: number, b: number, x: number): number {
  if (x < 0 || x > 1) return 0;
  if (x === 0) return a < 1 ? Infinity : a === 1 ? b : 0;
  if (x === 1) return b < 1 ? Infinity : b === 1 ? a : 0;
  return Math.exp((a - 1) * Math.log(x) + (b - 1) * Math.log1p(-x) - logBeta(a, b));
}

function gammaPdf(shape: number, rate: number, x: number): number {
  if (x < 0) return 0;
  if (x === 0) return shape < 1 ? Infinity : shape === 1 ? rate : 0;
  return Math.exp(shape * Math.log(rate) + (shape - 1) * Math.log(x) - rate * x - logGamma(shape));
}

function tPdf(nu: number, x: number): number {
  const norm = Math.exp(logGamma((nu + 1) / 2) - logGamma(nu / 2) - 0.5 * Math.log(nu * Math.PI));
  return norm * Math.pow(1 + (x * x) / nu, -(nu + 1) / 2);
}

function fPdf(d1: number, d2: number, x: number): number {
  if (x < 0) return 0;
  const lb = logBeta(d1 / 2, d2 / 2);
  if (x === 0) {
    if (d1 > 2) return 0;
    if (d1 < 2) return Infinity;
    return Math.exp(-lb + (d1 / 2) * Math.log(d1 / d2));
  }
  return Math.exp(
    -lb + (d1 / 2) * Math.log(d1 / d2) + (d1 / 2 - 1) * Math.log(x) - ((d1 + d2) / 2) * Math.log1p((d1 * x) / d2),
  );
}

function binomialPmf(n: number, p: number, k: number): number {
  if (p <= 0) return k === 0 ? 1 : 0;
  if (p >= 1) return k === n ? 1 : 0;
  return Math.exp(logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1) + k * Math.log(p) + (n - k) * Math.log1p(-p));
}

function geometricPmf(p: number, k: number): number {
  if (k < 1) return 0;
  if (p >= 1) return k === 1 ? 1 : 0;
  if (p <= 0) return 0;
  return Math.exp((k - 1) * Math.log1p(-p) + Math.log(p));
}

function isIntegerX(x: number): boolean {
  return Math.abs(x - Math.round(x)) < 1e-9;
}

/** PDF (continuous) or PMF (discrete) of one family; 0 outside the support. */
export function distPdf(id: DistId, p: Record<string, number>, x: number): number {
  switch (id) {
    case 'normal':
      return normalPdf(pr(p, 'normalMu', 0), pr(p, 'normalSigma', 1), x);
    case 'poisson':
      return isIntegerX(x) ? poissonPmf(pr(p, 'poissonLambda', 4), Math.round(x)) : 0;
    case 'exponential':
      return exponentialPdf(pr(p, 'expLambda', 0.5), x);
    case 'beta':
      return betaPdf(pr(p, 'betaA', 2), pr(p, 'betaB', 3), x);
    case 'gamma':
      return gammaPdf(pr(p, 'gammaShape', 2), pr(p, 'gammaRate', 1), x);
    case 't':
      return tPdf(pr(p, 'tNu', 5), x);
    case 'chisq':
      return gammaPdf(pr(p, 'chisqK', 3) / 2, 0.5, x);
    case 'f':
      return fPdf(pr(p, 'fD1', 4), pr(p, 'fD2', 6), x);
    case 'binomial': {
      const n = Math.round(pr(p, 'binomN', 20));
      return isIntegerX(x) && x >= 0 && x <= n ? binomialPmf(n, pr(p, 'binomP', 0.3), Math.round(x)) : 0;
    }
    case 'geometric':
      return isIntegerX(x) ? geometricPmf(pr(p, 'geomP', 0.35), Math.round(x)) : 0;
  }
}

/** CDF F(x) = P(X ≤ x) of one family (floored for discrete families). */
export function distCdf(id: DistId, p: Record<string, number>, x: number): number {
  switch (id) {
    case 'normal':
      return clamp01(normalCdf((x - pr(p, 'normalMu', 0)) / pr(p, 'normalSigma', 1)));
    case 'poisson': {
      const lam = pr(p, 'poissonLambda', 4);
      if (x < 0) return 0;
      if (lam <= 0) return 1;
      const k = Math.floor(x + 1e-9);
      return clamp01(upperGammaQ(k + 1, lam));
    }
    case 'exponential': {
      const lam = pr(p, 'expLambda', 0.5);
      if (x <= 0) return 0;
      return clamp01(-Math.expm1(-lam * x));
    }
    case 'beta':
      return clamp01(regularizedBetaI(x, pr(p, 'betaA', 2), pr(p, 'betaB', 3)));
    case 'gamma': {
      if (x <= 0) return 0;
      return clamp01(lowerGammaP(pr(p, 'gammaShape', 2), pr(p, 'gammaRate', 1) * x));
    }
    case 't': {
      const nu = pr(p, 'tNu', 5);
      const half = 0.5 * regularizedBetaI(nu / (nu + x * x), nu / 2, 0.5);
      return x >= 0 ? clamp01(1 - half) : clamp01(half);
    }
    case 'chisq':
      if (x <= 0) return 0;
      return clamp01(lowerGammaP(pr(p, 'chisqK', 3) / 2, x / 2));
    case 'f': {
      if (x <= 0) return 0;
      const d1 = pr(p, 'fD1', 4);
      const d2 = pr(p, 'fD2', 6);
      return clamp01(regularizedBetaI((d1 * x) / (d1 * x + d2), d1 / 2, d2 / 2));
    }
    case 'binomial': {
      const n = Math.round(pr(p, 'binomN', 20));
      const prob = pr(p, 'binomP', 0.3);
      if (x < 0) return 0;
      const k = Math.floor(x + 1e-9);
      if (k >= n) return 1;
      return clamp01(regularizedBetaI(1 - prob, n - k, k + 1));
    }
    case 'geometric': {
      const prob = pr(p, 'geomP', 0.35);
      if (x < 1) return 0;
      if (prob >= 1) return 1;
      if (prob <= 0) return 0;
      const k = Math.floor(x + 1e-9);
      return clamp01(-Math.expm1(k * Math.log1p(-prob)));
    }
  }
}

// ---- quantile (ppf) ------------------------------------------------------------------

/** Bracket + bisect a continuous CDF; `lo`/`hi` seed the search interval. */
function bracketedQuantile(cdfFn: (x: number) => number, q: number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  let guard = 0;
  while (cdfFn(b) < q && guard < 200) {
    a = b;
    b *= 2;
    guard += 1;
  }
  while (cdfFn(a) > q && guard < 400) {
    b = a;
    a *= 2;
    guard += 1;
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = 0.5 * (a + b);
    if (cdfFn(mid) < q) a = mid;
    else b = mid;
    if (b - a <= 1e-14 * Math.max(1, Math.abs(b))) break;
  }
  return 0.5 * (a + b);
}

/** Smallest support point k of a discrete family with cdf(k) ≥ q. */
function discreteQuantile(cdfFn: (k: number) => number, q: number, k0: number, kMax: number): number {
  let k = k0;
  while (k < kMax && cdfFn(k) < q) k += 1;
  return k;
}

/** Quantile function Q(q) = inf { x : F(x) ≥ q } of one family. */
export function distQuantile(id: DistId, p: Record<string, number>, q: number): number {
  const qq = Math.min(1 - 1e-12, Math.max(1e-12, q));
  switch (id) {
    case 'normal':
      return pr(p, 'normalMu', 0) + pr(p, 'normalSigma', 1) * normalPpf(qq);
    case 'poisson': {
      const lam = pr(p, 'poissonLambda', 4);
      const kMax = Math.max(120, Math.ceil(lam + 12 * Math.sqrt(lam) + 60));
      return discreteQuantile((k) => distCdf(id, p, k), qq, 0, kMax);
    }
    case 'exponential':
      return -Math.log1p(-qq) / pr(p, 'expLambda', 0.5);
    case 'beta':
      return bracketedQuantile((x) => distCdf(id, p, x), qq, 0, 1);
    case 'gamma':
      return bracketedQuantile((x) => distCdf(id, p, x), qq, 0, 1);
    case 't':
      return bracketedQuantile((x) => distCdf(id, p, x), qq, -1, 1);
    case 'chisq':
      return bracketedQuantile((x) => distCdf(id, p, x), qq, 0, 1);
    case 'f':
      return bracketedQuantile((x) => distCdf(id, p, x), qq, 0, 1);
    case 'binomial': {
      const n = Math.round(pr(p, 'binomN', 20));
      return discreteQuantile((k) => distCdf(id, p, k), qq, 0, n);
    }
    case 'geometric': {
      const prob = pr(p, 'geomP', 0.35);
      const kMax = Math.max(100, Math.ceil(Math.log(1e-12) / Math.log1p(-prob)) + 10);
      return discreteQuantile((k) => distCdf(id, p, k), qq, 1, kMax);
    }
  }
}

// ---- plotting ranges ------------------------------------------------------------------

/** Tail probability trimmed from each side of the default plot window. */
export const PLOT_TAIL = 0.001;

/**
 * Default x window for the family: the [tail, 1 − tail] quantile range with
 * 5 % padding (integer bounds for discrete families).
 */
export function distXRange(id: DistId, p: Record<string, number>): [number, number] {
  const def = getDist(id);
  const lo = distQuantile(id, p, PLOT_TAIL);
  const hi = distQuantile(id, p, 1 - PLOT_TAIL);
  if (def.kind === 'discrete') return [Math.floor(lo), Math.ceil(hi)];
  const pad = (hi - lo) * 0.05;
  return [lo - pad, hi + pad];
}

/**
 * Plot window extended to cover `samples` as well, so a histogram of the
 * data never falls outside the axes.
 */
export function plotXRange(id: DistId, p: Record<string, number>, samples?: number[]): [number, number] {
  const [a, b] = distXRange(id, p);
  if (!samples || samples.length === 0) return [a, b];
  let smin = Infinity;
  let smax = -Infinity;
  for (const v of samples) {
    if (!Number.isFinite(v)) continue;
    if (v < smin) smin = v;
    if (v > smax) smax = v;
  }
  if (smin === Infinity) return [a, b];
  if (getDist(id).kind === 'discrete') {
    return [Math.min(a, Math.floor(smin)), Math.max(b, Math.ceil(smax))];
  }
  const span = Math.max(b, smax) - Math.min(a, smin);
  return [Math.min(a, smin - span * 0.03), Math.max(b, smax + span * 0.03)];
}

// ---- reproducible RNG and sampling -------------------------------------------------------

export interface Rng {
  /** Next uniform deviate in [0, 1). */
  next(): number;
  /** Standard normal deviate (Box–Muller with a cached pair). */
  normal(): number;
}

/** mulberry32: tiny, fast, fully reproducible from a 32-bit seed. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let cached: number | null = null;
  const normal = (): number => {
    if (cached !== null) {
      const v = cached;
      cached = null;
      return v;
    }
    let u = next();
    if (u <= 0) u = Number.MIN_VALUE;
    const r = Math.sqrt(-2 * Math.log(u));
    const theta = 2 * Math.PI * next();
    cached = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
  return { next, normal };
}

/** Marsaglia–Tsang gamma sampler (shape ≥ 1) with the shape < 1 boost. */
function sampleGamma(shape: number, rng: Rng): number {
  if (shape < 1) {
    const u = Math.max(rng.next(), Number.MIN_VALUE);
    return sampleGamma(shape + 1, rng) * Math.pow(u, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = rng.normal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.next();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/**
 * Draw `n` i.i.d. samples of the family from a seeded RNG. Normal uses
 * Box–Muller, exponential/geometric inverse transform, Poisson Knuth's
 * product method, beta/gamma/chisq/t/F through Marsaglia–Tsang, binomial by
 * Bernoulli summation — every path deterministic for a given seed.
 */
export function sampleDist(id: DistId, p: Record<string, number>, n: number, seed: number): number[] {
  const rng = createRng(seed);
  const out: number[] = [];
  switch (id) {
    case 'normal': {
      const mu = pr(p, 'normalMu', 0);
      const sigma = pr(p, 'normalSigma', 1);
      for (let i = 0; i < n; i += 1) out.push(mu + sigma * rng.normal());
      return out;
    }
    case 'exponential': {
      const lam = pr(p, 'expLambda', 0.5);
      for (let i = 0; i < n; i += 1) out.push(-Math.log1p(-rng.next()) / lam);
      return out;
    }
    case 'poisson': {
      const lam = pr(p, 'poissonLambda', 4);
      if (lam > 30) {
        // Normal approximation with continuity correction for large rates.
        const sqrtL = Math.sqrt(lam);
        for (let i = 0; i < n; i += 1) out.push(Math.max(0, Math.round(lam + sqrtL * rng.normal())));
        return out;
      }
      const cutoff = Math.exp(-lam);
      for (let i = 0; i < n; i += 1) {
        let k = 0;
        let prod = 1;
        do {
          k += 1;
          prod *= Math.max(rng.next(), Number.MIN_VALUE);
        } while (prod > cutoff && k < 10000);
        out.push(k - 1);
      }
      return out;
    }
    case 'beta': {
      const a = pr(p, 'betaA', 2);
      const b = pr(p, 'betaB', 3);
      for (let i = 0; i < n; i += 1) {
        const x = sampleGamma(a, rng);
        const y = sampleGamma(b, rng);
        const s = x + y;
        out.push(s > 0 ? x / s : a / (a + b));
      }
      return out;
    }
    case 'gamma': {
      const a = pr(p, 'gammaShape', 2);
      const rate = pr(p, 'gammaRate', 1);
      for (let i = 0; i < n; i += 1) out.push(sampleGamma(a, rng) / rate);
      return out;
    }
    case 'chisq': {
      const k = pr(p, 'chisqK', 3);
      for (let i = 0; i < n; i += 1) out.push(2 * sampleGamma(k / 2, rng));
      return out;
    }
    case 't': {
      const nu = pr(p, 'tNu', 5);
      for (let i = 0; i < n; i += 1) out.push(rng.normal() / Math.sqrt((2 * sampleGamma(nu / 2, rng)) / nu));
      return out;
    }
    case 'f': {
      const d1 = pr(p, 'fD1', 4);
      const d2 = pr(p, 'fD2', 6);
      for (let i = 0; i < n; i += 1) {
        const c1 = (2 * sampleGamma(d1 / 2, rng)) / d1;
        const c2 = (2 * sampleGamma(d2 / 2, rng)) / d2;
        out.push(c1 / c2);
      }
      return out;
    }
    case 'binomial': {
      const trials = Math.round(pr(p, 'binomN', 20));
      const prob = pr(p, 'binomP', 0.3);
      for (let i = 0; i < n; i += 1) {
        let hits = 0;
        for (let j = 0; j < trials; j += 1) if (rng.next() < prob) hits += 1;
        out.push(hits);
      }
      return out;
    }
    case 'geometric': {
      const prob = pr(p, 'geomP', 0.35);
      const logQ = Math.log1p(-prob);
      for (let i = 0; i < n; i += 1) {
        const u = Math.max(rng.next(), Number.MIN_VALUE);
        out.push(Math.max(1, Math.ceil(Math.log(u) / logQ)));
      }
      return out;
    }
  }
}

// ---- histogram and summaries ----------------------------------------------------------------

export interface HistBar {
  x0: number;
  x1: number;
  /** Bin density count / (n · bin width), so a pdf overlays directly. */
  y: number;
}

/** Density histogram over [lo, hi]; values outside the window are dropped. */
export function histogramBars(values: number[], lo: number, hi: number, bins: number): HistBar[] {
  const bars: HistBar[] = [];
  if (bins <= 0 || !(hi > lo) || values.length === 0) {
    for (let i = 0; i < Math.max(0, bins); i += 1) {
      const w = (hi - lo) / bins;
      bars.push({ x0: lo + i * w, x1: lo + (i + 1) * w, y: 0 });
    }
    return bars;
  }
  const w = (hi - lo) / bins;
  const counts = new Array<number>(bins).fill(0);
  let used = 0;
  for (const v of values) {
    if (!Number.isFinite(v) || v < lo || v > hi) continue;
    let idx = Math.floor((v - lo) / w);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx] = (counts[idx] ?? 0) + 1;
    used += 1;
  }
  const scale = used > 0 ? 1 / (used * w) : 0;
  for (let i = 0; i < bins; i += 1) {
    bars.push({ x0: lo + i * w, x1: lo + (i + 1) * w, y: (counts[i] ?? 0) * scale });
  }
  return bars;
}

export interface SampleSummary {
  n: number;
  mean: number;
  /** Sample standard deviation (Bessel-corrected, n − 1). */
  sd: number;
  min: number;
  max: number;
}

/** Count / mean / sd / range of a sample (NaN-safe). */
export function summarize(values: number[]): SampleSummary {
  const clean = values.filter((v) => Number.isFinite(v));
  if (clean.length === 0) return { n: 0, mean: NaN, sd: NaN, min: NaN, max: NaN };
  let sum = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of clean) {
    sum += v;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const mean = sum / clean.length;
  let acc = 0;
  for (const v of clean) acc += (v - mean) * (v - mean);
  const sd = clean.length > 1 ? Math.sqrt(acc / (clean.length - 1)) : 0;
  return { n: clean.length, mean, sd, min: lo, max: hi };
}

// ---- maximum-likelihood fits ----------------------------------------------------------------

export interface MleFit {
  dist: DistId;
  params: Record<string, number>;
  logLik: number;
  /** Standard errors of the closed-form estimators (asymptotic). */
  se: Record<string, number>;
}

/**
 * Closed-form MLE of the three fitted families:
 * Normal → x̄ and the n-denominator sd; Exponential → 1/x̄;
 * Poisson → x̄. Returns null for families without a built-in dataset fit.
 */
export function mleFit(dist: DistId, values: number[]): MleFit | null {
  const data = values.filter((v) => Number.isFinite(v));
  const n = data.length;
  if (n < 2) return null;
  let sum = 0;
  for (const v of data) sum += v;
  const mean = sum / n;
  if (dist === 'normal') {
    let acc = 0;
    for (const v of data) acc += (v - mean) * (v - mean);
    const sigma = Math.sqrt(acc / n);
    if (!(sigma > 0)) return null;
    const logLik = -0.5 * n * Math.log(2 * Math.PI * sigma * sigma) - acc / (2 * sigma * sigma);
    return {
      dist,
      params: { normalMu: mean, normalSigma: sigma },
      logLik,
      se: { normalMu: sigma / Math.sqrt(n), normalSigma: sigma / Math.sqrt(2 * n) },
    };
  }
  if (dist === 'exponential') {
    if (!(mean > 0)) return null;
    const lam = 1 / mean;
    return {
      dist,
      params: { expLambda: lam },
      logLik: n * Math.log(lam) - lam * sum,
      se: { expLambda: lam / Math.sqrt(n) },
    };
  }
  if (dist === 'poisson') {
    if (!(mean > 0)) return null;
    let logFactSum = 0;
    for (const v of data) logFactSum += logGamma(Math.round(v) + 1);
    return {
      dist,
      params: { poissonLambda: mean },
      logLik: -n * mean + Math.log(mean) * sum - logFactSum,
      se: { poissonLambda: Math.sqrt(mean / n) },
    };
  }
  return null;
}

// ---- built-in sample datasets ----------------------------------------------------------------

export interface SampleDataset {
  id: string;
  labelEn: string;
  labelZh: string;
  /** Family the dataset is fitted with. */
  family: DistId;
  values: number[];
}

/** Embedded observations used by the empirical-fit mode (plugin-local data). */
export const SAMPLE_DATASETS: SampleDataset[] = [
  {
    id: 'mass-g',
    labelEn: 'Specimen mass (g)',
    labelZh: '试件质量测量（g）',
    family: 'normal',
    values: [
      98.4, 101.2, 99.6, 103.1, 97.9, 100.5, 102.3, 99.1, 101.7, 96.8, 100.9, 104.2, 98.7, 101.4,
      99.9, 102.6, 97.5, 100.2, 103.5, 99.3, 101.1, 98.2, 100.7, 102.0, 97.1, 101.9, 99.8, 103.8,
      98.9, 100.4, 102.7, 97.7, 101.6, 99.4, 100.8, 104.6, 98.0, 101.3, 99.2, 102.1,
    ],
  },
  {
    id: 'arrival-min',
    labelEn: 'Service inter-arrival times (min)',
    labelZh: '服务到达间隔（min）',
    family: 'exponential',
    values: [
      0.42, 2.87, 1.13, 5.66, 0.08, 3.21, 7.94, 1.55, 4.02, 0.67, 6.31, 2.44, 9.18, 1.02, 3.77,
      0.29, 5.14, 2.06, 8.53, 1.71, 4.86, 0.53, 6.92, 2.95, 10.4, 1.34, 3.58, 0.91, 5.47, 2.18,
    ],
  },
  {
    id: 'defects-shift',
    labelEn: 'Defects per shift (count)',
    labelZh: '每班次缺陷计数（件）',
    family: 'poisson',
    values: [
      3, 1, 4, 2, 0, 5, 3, 2, 6, 1, 4, 2, 3, 0, 7, 2, 1, 4, 3, 5, 2, 1, 3, 4, 0, 2, 5, 3, 1, 6,
      2, 4, 3, 1, 2, 0, 3, 5, 2, 4,
    ],
  },
];

// ---- embedded validation benchmarks ----------------------------------------------------

export const DIST_BENCHMARK_ID = 'dist-benchmarks';

export interface DistBenchmark {
  id: string;
  labelZh: string;
  labelEn: string;
  detailZh: string;
  detailEn: string;
  /** Unified relative error |computed − analytic|/|analytic|. */
  relErr: number;
  passed: boolean;
}

function simpson(a: number, b: number, fa: number, fm: number, fb: number): number {
  return ((b - a) / 6) * (fa + 4 * fm + fb);
}

function adaptiveRec(
  f: (x: number) => number,
  a: number,
  b: number,
  fa: number,
  fm: number,
  fb: number,
  whole: number,
  tol: number,
  depth: number,
): number {
  const m = 0.5 * (a + b);
  const lm = 0.5 * (a + m);
  const rm = 0.5 * (m + b);
  const flm = f(lm);
  const frm = f(rm);
  const left = simpson(a, m, fa, flm, fm);
  const right = simpson(m, b, fm, frm, fb);
  const delta = left + right - whole;
  if (depth <= 0 || Math.abs(delta) <= 15 * tol) return left + right + delta / 15;
  return (
    adaptiveRec(f, a, m, fa, flm, fm, left, tol / 2, depth - 1) +
    adaptiveRec(f, m, b, fm, frm, fb, right, tol / 2, depth - 1)
  );
}

/** Adaptive Simpson quadrature of f over [a, b] (absolute tolerance). */
export function adaptiveSimpson(f: (x: number) => number, a: number, b: number, tol = 1e-11, depth = 15): number {
  const m = 0.5 * (a + b);
  const fa = f(a);
  const fm = f(m);
  const fb = f(b);
  return adaptiveRec(f, a, b, fa, fm, fb, simpson(a, b, fa, fm, fb), tol, depth);
}

/**
 * Run the embedded validation suite:
 * ① adaptive-Simpson ∫pdf dx = 1 over seven continuous families;
 * ② Φ⁻¹(0.975) against the tabulated normal quantile;
 * ③ every CDF monotone inside [0, 1] on its bulk grid;
 * ④ Σpmf = 1 for Poisson / Binomial / Geometric;
 * ⑤ seeded sample means converge to the theoretical means;
 * ⑥ χ² and t CDFs at tabulated critical values.
 * All checks use the unified metric |computed − analytic|/|analytic|.
 */
export function runDistBenchmarks(): DistBenchmark[] {
  const out: DistBenchmark[] = [];

  // ① ∫ pdf dx = 1 (adaptive Simpson vs the analytic value 1).
  const integralCases: Array<{ id: DistId; p: Record<string, number>; a: number; b: number; name: string }> = [
    { id: 'normal', p: { normalMu: 1.5, normalSigma: 2 }, a: -22.5, b: 25.5, name: 'N(1.5, 2²)' },
    { id: 'exponential', p: { expLambda: 0.7 }, a: 0, b: 60, name: 'Exp(0.7)' },
    { id: 'gamma', p: { gammaShape: 2, gammaRate: 1 }, a: 0, b: 50, name: 'Γ(2, 1)' },
    { id: 'beta', p: { betaA: 2, betaB: 3 }, a: 0, b: 1, name: 'Beta(2, 3)' },
    { id: 't', p: { tNu: 5 }, a: -200, b: 200, name: 't₅' },
    { id: 'chisq', p: { chisqK: 3 }, a: 0, b: 70, name: 'χ²₃' },
    { id: 'f', p: { fD1: 4, fD2: 6 }, a: 0, b: 5000, name: 'F(4, 6)' },
  ];
  let e1 = 0;
  let worst1 = '';
  for (const c of integralCases) {
    const val = adaptiveSimpson((x) => distPdf(c.id, c.p, x), c.a, c.b);
    const err = Math.abs(val - 1) / 1;
    if (err > e1) {
      e1 = err;
      worst1 = `${c.name}: ${val.toPrecision(12)}`;
    }
  }
  out.push({
    id: 'pdf-unit-integral',
    labelZh: '∫pdf dx = 1（7 个连续分布，自适应 Simpson）（< 1e-6）',
    labelEn: '∫pdf dx = 1 over 7 continuous families, adaptive Simpson (< 1e-6)',
    detailZh: `最大相对误差来自 ${worst1 || '—'}；积分区间覆盖各分布主体，截断尾部 < 1e-12`,
    detailEn: `largest rel. err from ${worst1 || 'n/a'}; ranges cover the bulk, truncated tails < 1e-12`,
    relErr: e1,
    passed: e1 < 1e-6,
  });

  // ② Φ⁻¹(0.975) vs the tabulated value 1.959963984540054 (≈ 1.959964).
  const zRef = 1.959963984540054;
  const zNum = normalPpf(0.975);
  const e2 = Math.abs(zNum - zRef) / zRef;
  out.push({
    id: 'normal-quantile',
    labelZh: 'Φ⁻¹(0.975) 对照 1.959964（AS241）（< 1e-9）',
    labelEn: 'Φ⁻¹(0.975) vs 1.959964 tabulated (AS241) (< 1e-9)',
    detailZh: `Φ⁻¹(0.975) = ${zNum.toPrecision(16)}，解析 1.959963984540054；Φ⁻¹(0.5) = ${normalPpf(0.5).toExponential(2)}`,
    detailEn: `Φ⁻¹(0.975) = ${zNum.toPrecision(16)}, analytic 1.959963984540054; Φ⁻¹(0.5) = ${normalPpf(0.5).toExponential(2)}`,
    relErr: e2,
    passed: e2 < 1e-9,
  });

  // ③ CDF range [0, 1] and monotone non-decreasing on the bulk grid.
  let e3 = 0;
  let worst3 = '';
  const GRID = 160;
  for (const def of DISTS) {
    const p = defaultParams(def.id);
    const lo = distQuantile(def.id, p, PLOT_TAIL);
    const hi = distQuantile(def.id, p, 1 - PLOT_TAIL);
    let prev = distCdf(def.id, p, lo);
    e3 = Math.max(e3, 0 - prev, prev - 1);
    for (let i = 1; i <= GRID; i += 1) {
      const x = lo + ((hi - lo) * i) / GRID;
      const c = distCdf(def.id, p, x);
      const viol = Math.max(0 - c, c - 1, prev - c);
      if (viol > e3) {
        e3 = viol;
        worst3 = def.id;
      }
      prev = c;
    }
  }
  out.push({
    id: 'cdf-monotone-range',
    labelZh: '全部 10 个 CDF 单调且值域 [0,1]（< 1e-12 违反量）',
    labelEn: 'all 10 CDFs monotone inside [0, 1] (< 1e-12 violation)',
    detailZh: `160 点主体网格（分位数播种）上的最大违反量 ${e3.toExponential(2)}${worst3 ? `，最差分布 ${worst3}` : ''}`,
    detailEn: `max violation ${e3.toExponential(2)} on 160-point quantile-seeded grids${worst3 ? `, worst family ${worst3}` : ''}`,
    relErr: e3,
    passed: e3 < 1e-12,
  });

  // ④ Σ pmf = 1 for the three discrete families.
  const pmfCases: Array<{ id: DistId; p: Record<string, number>; k0: number; k1: number; name: string }> = [
    { id: 'poisson', p: { poissonLambda: 4 }, k0: 0, k1: 150, name: 'Poisson(4)' },
    { id: 'binomial', p: { binomN: 40, binomP: 0.35 }, k0: 0, k1: 40, name: 'Bin(40, 0.35)' },
    { id: 'geometric', p: { geomP: 0.25 }, k0: 1, k1: 500, name: 'Geom(0.25)' },
  ];
  let e4 = 0;
  let worst4 = '';
  for (const c of pmfCases) {
    let s = 0;
    for (let k = c.k0; k <= c.k1; k += 1) s += distPdf(c.id, c.p, k);
    const err = Math.abs(s - 1) / 1;
    if (err > e4) {
      e4 = err;
      worst4 = `${c.name}: ${s.toPrecision(12)}`;
    }
  }
  out.push({
    id: 'discrete-pmf-sum',
    labelZh: '离散分布 Σpmf = 1（泊松/二项/几何）（< 1e-10）',
    labelEn: 'Σpmf = 1 for Poisson / Binomial / Geometric (< 1e-10)',
    detailZh: `最大相对误差来自 ${worst4 || '—'}；求和覆盖全部有效支撑`,
    detailEn: `largest rel. err from ${worst4 || 'n/a'}; sums cover the full effective support`,
    relErr: e4,
    passed: e4 < 1e-10,
  });

  // ⑤ Seeded sample means converge to the theoretical means (n = 6000).
  const convCases: Array<{ id: DistId; p: Record<string, number>; mu: number; name: string }> = [
    { id: 'normal', p: { normalMu: 2, normalSigma: 3 }, mu: 2, name: 'N(2, 3²)' },
    { id: 'exponential', p: { expLambda: 0.5 }, mu: 2, name: 'Exp(0.5)' },
    { id: 'poisson', p: { poissonLambda: 3 }, mu: 3, name: 'Poisson(3)' },
  ];
  let e5 = 0;
  let worst5 = '';
  for (const c of convCases) {
    const s = summarize(sampleDist(c.id, c.p, 6000, 20261027));
    const err = Math.abs(s.mean - c.mu) / Math.abs(c.mu);
    if (err > e5) {
      e5 = err;
      worst5 = `${c.name}: mean = ${s.mean.toPrecision(8)}`;
    }
  }
  out.push({
    id: 'sample-mean-convergence',
    labelZh: '固定种子采样均值收敛到理论均值，n = 6000（< 5%）',
    labelEn: 'seeded sample means converge to theory, n = 6000 (< 5%)',
    detailZh: `seed = 20261027；最大相对偏差来自 ${worst5 || '—'}`,
    detailEn: `seed = 20261027; largest rel. deviation from ${worst5 || 'n/a'}`,
    relErr: e5,
    passed: e5 < 0.05,
  });

  // ⑥ χ²₁,0.₉₅ = 3.841458820694124 and t₁₂,0.₉₇₅ = 2.1788128296634177 critical CDFs.
  const chiCrit = 3.841458820694124;
  const chiCdf = distCdf('chisq', { chisqK: 1 }, chiCrit);
  const eChi = Math.abs(chiCdf - 0.95) / 0.95;
  const tCrit = 2.1788128296634177;
  const tCdf = distCdf('t', { tNu: 12 }, tCrit);
  const eT = Math.abs(tCdf - 0.975) / 0.975;
  const e6 = Math.max(eChi, eT);
  out.push({
    id: 'chi-t-critical',
    labelZh: 'χ²₁,0.₉₅ = 3.841459 与 t₁₂,0.₉₇₅ = 2.178813 临界值 CDF（< 1e-9）',
    labelEn: 'χ²₁,0.₉₅ = 3.841459 and t₁₂,0.₉₇₅ = 2.178813 critical CDFs (< 1e-9)',
    detailZh: `F_χ²(3.841459) = ${chiCdf.toPrecision(15)} 对照 0.95；F_t(2.178813) = ${tCdf.toPrecision(15)} 对照 0.975`,
    detailEn: `F_χ²(3.841459) = ${chiCdf.toPrecision(15)} vs 0.95; F_t(2.178813) = ${tCdf.toPrecision(15)} vs 0.975`,
    relErr: e6,
    passed: e6 < 1e-9,
  });

  return out;
}



