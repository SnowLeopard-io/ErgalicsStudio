// ==========================================================================
// math-numerics — numerical analysis kernel (pure, dependency-free, testable)
//
// Classic deterministic numerics with closed-form references:
//   - root finding: bisection, Newton–Raphson and secant iteration traces;
//   - quadrature: composite trapezoidal / Simpson, Gauss–Legendre nodes and
//     weights computed from the Legendre polynomial, Richardson estimates;
//   - finite differences: forward / backward / central with truncation errors;
//   - interpolation: Lagrange, Newton divided differences, natural/clamped
//     cubic splines (tridiagonal second-derivative solve);
//   - convergence analysis: least-squares order fits on log-log error data
//     and on iteration error sequences.
//
// SAMPLE_FUNCTIONS carries the built-in sample dataset (root bracket, exact
// root, closed-form integral, derivative probe, interpolation range), so the
// plugin needs no external data. runNumericsBenchmarks() executes the
// embedded validation suite. All functions are pure: the kernel unit-tests
// without a canvas or DOM. The unified error metric throughout is
// |computed − analytic|/|analytic| (absolute error with a stated note when
// the analytic value is 0).
// ==========================================================================

// ---- built-in sample dataset ---------------------------------------------------

export interface SampleFunction {
  id: string;
  labelEn: string;
  labelZh: string;
  /** Pretty formula shown in titles and captions. */
  formula: string;
  f: (x: number) => number;
  /** Analytic first derivative (reference for finite differences). */
  df: (x: number) => number;
  /** Sign-changing bracket [a, b] for bisection (f(a)·f(b) < 0). */
  bracket: [number, number];
  /** Closed-form root inside the bracket. */
  root: number;
  /** Integration interval with its closed-form value. */
  integral: { a: number; b: number; value: number };
  /** Probe point for finite-difference derivative checks. */
  xDiff: number;
  /** Interpolation range. */
  range: [number, number];
}

export const SAMPLE_FUNCTIONS: SampleFunction[] = [
  {
    id: 'sqrt2',
    labelEn: 'Root sample: f(x) = x² − 2 (root √2)',
    labelZh: '求根样例：f(x) = x² − 2（根 √2）',
    formula: 'x² − 2',
    f: (x) => x * x - 2,
    df: (x) => 2 * x,
    bracket: [1, 2],
    root: Math.SQRT2,
    integral: { a: 0, b: 2, value: 8 / 3 - 4 },
    xDiff: 1.5,
    range: [0, 2],
  },
  {
    id: 'sin',
    labelEn: 'Quadrature sample: f(x) = sin x (∫₀^π = 2)',
    labelZh: '积分类样例：f(x) = sin x（∫₀^π = 2）',
    formula: 'sin x',
    f: (x) => Math.sin(x),
    df: (x) => Math.cos(x),
    bracket: [2, 4],
    root: Math.PI,
    integral: { a: 0, b: Math.PI, value: 2 },
    xDiff: 0.7,
    range: [0, Math.PI],
  },
  {
    id: 'runge',
    labelEn: 'Interpolation sample: Runge 1/(1+25x²) − 0.4',
    labelZh: '插值样例：Runge 函数 1/(1+25x²) − 0.4',
    formula: '1/(1+25x²) − 0.4',
    f: (x) => 1 / (1 + 25 * x * x) - 0.4,
    df: (x) => (-50 * x) / Math.pow(1 + 25 * x * x, 2),
    bracket: [0, 1],
    root: Math.sqrt(0.06),
    integral: { a: -1, b: 1, value: 0.4 * Math.atan(5) - 0.8 },
    xDiff: 0.5,
    range: [-1, 1],
  },
  {
    id: 'exp',
    labelEn: 'Mixed sample: f(x) = eˣ − 2 (root ln 2)',
    labelZh: '综合样例：f(x) = eˣ − 2（根 ln 2）',
    formula: 'eˣ − 2',
    f: (x) => Math.exp(x) - 2,
    df: (x) => Math.exp(x),
    bracket: [-1, 2],
    root: Math.LN2,
    integral: { a: 0, b: 1, value: Math.E - 3 },
    xDiff: 1,
    range: [-1, 2],
  },
];

/** Resolve a sample by id (unknown ids fall back to the first sample). */
export function selectSample(id: string): SampleFunction {
  return SAMPLE_FUNCTIONS.find((s) => s.id === id) ?? SAMPLE_FUNCTIONS[0]!;
}

// ---- root finding ----------------------------------------------------------------

export interface RootStep {
  /** Zero-based iteration index. */
  k: number;
  /** Iterate value. */
  x: number;
  /** |f(x)| at the iterate. */
  residual: number;
  /** |x − exact| when the caller supplies the closed-form root, else residual. */
  err: number;
}

export interface RootResult {
  converged: boolean;
  /** Final iterate (NaN when the method could not produce one). */
  root: number;
  steps: RootStep[];
}

function makeStep(k: number, x: number, residual: number, exact?: number): RootStep {
  return { k, x, residual, err: exact !== undefined ? Math.abs(x - exact) : residual };
}

/**
 * Bisection on [a, b]. Requires a sign change; the bracket halves every
 * iteration, so the guaranteed error decays like O(h) with ratio 1/2.
 */
export function bisectRoot(
  f: (x: number) => number,
  a0: number,
  b0: number,
  maxIter: number,
  exact?: number,
): RootResult {
  let a = a0;
  let b = b0;
  let fa = f(a);
  const fb = f(b);
  const steps: RootStep[] = [];
  if (!Number.isFinite(fa) || !Number.isFinite(fb) || fa * fb > 0) {
    return { converged: false, root: NaN, steps };
  }
  let x = (a + b) / 2;
  let converged = false;
  for (let k = 0; k < maxIter; k += 1) {
    x = (a + b) / 2;
    const fx = f(x);
    steps.push(makeStep(k, x, Math.abs(fx), exact));
    if (fx === 0) {
      converged = true;
      break;
    }
    if (fa * fx <= 0) {
      b = x;
    } else {
      a = x;
      fa = fx;
    }
    if ((b - a) / 2 <= 1e-10) {
      converged = true;
      break;
    }
  }
  return { converged, root: x, steps };
}

/**
 * Newton–Raphson x ← x − f/f′ with a step-based stopping test
 * |Δx| ≤ 1e-14·max(1, |x|) (quadratic convergence).
 */
export function newtonRoot(
  f: (x: number) => number,
  df: (x: number) => number,
  x0: number,
  maxIter: number,
  exact?: number,
): RootResult {
  let x = x0;
  const steps: RootStep[] = [];
  let converged = false;
  for (let k = 0; k < maxIter; k += 1) {
    const fx = f(x);
    const d = df(x);
    steps.push(makeStep(k, x, Math.abs(fx), exact));
    if (!Number.isFinite(fx) || !Number.isFinite(d)) return { converged: false, root: x, steps };
    if (fx === 0) {
      converged = true;
      break;
    }
    if (d === 0) break;
    const dx = fx / d;
    x -= dx;
    if (Math.abs(dx) <= 1e-14 * Math.max(1, Math.abs(x))) {
      converged = true;
      break;
    }
  }
  if (!converged && Number.isFinite(x)) {
    const scale = Math.max(1, Math.abs(x));
    converged = Math.abs(f(x)) <= 1e-10 * scale;
  }
  return { converged, root: x, steps };
}

/**
 * Secant method with the two starting points x0 < x1 (no derivative needed);
 * stops when the update drops below 1e-14·max(1, |x|).
 */
export function secantRoot(
  f: (x: number) => number,
  x0: number,
  x1: number,
  maxIter: number,
  exact?: number,
): RootResult {
  let a = x0;
  let b = x1;
  let fa = f(a);
  let fb = f(b);
  const steps: RootStep[] = [];
  let x = b;
  let converged = false;
  for (let k = 0; k < maxIter; k += 1) {
    x = b;
    steps.push(makeStep(k, x, Math.abs(fb), exact));
    if (fb === 0) {
      converged = true;
      break;
    }
    const den = fb - fa;
    if (den === 0 || !Number.isFinite(den)) break;
    const dx = (fb * (b - a)) / den;
    a = b;
    fa = fb;
    b -= dx;
    fb = f(b);
    if (!Number.isFinite(fb)) break;
    if (Math.abs(dx) <= 1e-14 * Math.max(1, Math.abs(b))) {
      converged = true;
      break;
    }
  }
  if (!converged && Number.isFinite(x)) {
    const scale = Math.max(1, Math.abs(x));
    converged = Math.abs(f(x)) <= 1e-10 * scale;
  }
  return { converged, root: x, steps };
}

// ---- convergence-rate analysis ------------------------------------------------------

/**
 * Least-squares slope p of log10(err) = c + p·log10(h): the measured
 * convergence order of an error-vs-step sequence. Non-finite or non-positive
 * pairs (and pairs with err ≤ floor) are skipped; returns NaN when fewer
 * than two usable pairs remain.
 */
export function fitLogLogOrder(hs: number[], errs: number[], floor = 0): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < hs.length && i < errs.length; i += 1) {
    const h = hs[i]!;
    const e = errs[i]!;
    if (!Number.isFinite(h) || !Number.isFinite(e) || h <= 0 || e <= floor) continue;
    const x = Math.log10(h);
    const y = Math.log10(e);
    n += 1;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  if (n < 2) return NaN;
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-15) return NaN;
  return (n * sxy - sx * sy) / den;
}

/**
 * Measured order p of an iteration error sequence from a log2-error
 * regression log2(err_k) = c − p·k over k ∈ [kStart, kEnd]:
 * p ≈ 1 linear (bisection), p ≈ 2 quadratic (Newton), p ≈ 1.618 (secant).
 */
export function fitIterationOrder(errs: number[], kStart: number, kEnd: number): number {
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let k = kStart; k <= kEnd; k += 1) {
    const e = errs[k];
    if (e === undefined || !Number.isFinite(e) || e <= 0) continue;
    const y = Math.log2(e);
    n += 1;
    sx += k;
    sy += y;
    sxx += k * k;
    sxy += k * y;
  }
  if (n < 3) return NaN;
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-15) return NaN;
  return -(n * sxy - sx * sy) / den;
}

// ---- quadrature ---------------------------------------------------------------------

/** Composite trapezoidal rule with `panels` subintervals. */
export function trapezoidal(f: (x: number) => number, a: number, b: number, panels: number): number {
  const n = Math.max(1, Math.floor(panels));
  const h = (b - a) / n;
  let sum = (f(a) + f(b)) / 2;
  for (let i = 1; i < n; i += 1) sum += f(a + i * h);
  return sum * h;
}

/** Composite Simpson rule (odd panel counts are rounded up to even). */
export function simpson(f: (x: number) => number, a: number, b: number, panels: number): number {
  let n = Math.max(2, Math.floor(panels));
  if (n % 2 !== 0) n += 1;
  const h = (b - a) / n;
  let sum = f(a) + f(b);
  for (let i = 1; i < n; i += 1) sum += (i % 2 === 0 ? 2 : 4) * f(a + i * h);
  return (sum * h) / 3;
}

function legendre(n: number, x: number): [number, number] {
  // Returns [P_n(x), P_{n−1}(x)] by the standard three-term recurrence.
  let pPrev = 1;
  let pCur = x;
  if (n === 0) return [1, 0];
  for (let k = 2; k <= n; k += 1) {
    const pNext = ((2 * k - 1) * x * pCur - (k - 1) * pPrev) / k;
    pPrev = pCur;
    pCur = pNext;
  }
  return [pCur, pPrev];
}

export interface GaussRule {
  nodes: number[];
  weights: number[];
}

/**
 * Gauss–Legendre nodes/weights on [−1, 1] for `order` ∈ [1, 6]: nodes are
 * the roots of P_order found by Newton from the Chebyshev-like initial guess,
 * weights are 2/((1−x²)·P′(x)²). Order 1 is the midpoint rule.
 */
export function gaussNodesWeights(order: number): GaussRule {
  const n = Math.min(6, Math.max(1, Math.round(order)));
  if (n === 1) return { nodes: [0], weights: [2] };
  const nodes: number[] = [];
  const weights: number[] = [];
  for (let i = 1; i <= n; i += 1) {
    let x = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    for (let it = 0; it < 100; it += 1) {
      const [pn, pnm1] = legendre(n, x);
      const dp = (n * (x * pn - pnm1)) / (x * x - 1);
      const dx = pn / dp;
      x -= dx;
      if (Math.abs(dx) <= 1e-15 * Math.max(1, Math.abs(x))) break;
    }
    const [pn, pnm1] = legendre(n, x);
    const dp = (n * (x * pn - pnm1)) / (x * x - 1);
    nodes.push(x);
    weights.push(2 / ((1 - x * x) * dp * dp));
  }
  // Sort ascending by node, keeping each weight paired with its node.
  const orderIdx = nodes.map((_, k) => k).sort((a, b) => nodes[a]! - nodes[b]!);
  return {
    nodes: orderIdx.map((k) => nodes[k]!),
    weights: orderIdx.map((k) => weights[k]!),
  };
}

/** Single-panel Gauss–Legendre quadrature of `order` points on [a, b]. */
export function gaussLegendre(f: (x: number) => number, a: number, b: number, order: number): number {
  const { nodes, weights } = gaussNodesWeights(order);
  const mid = (a + b) / 2;
  const half = (b - a) / 2;
  let sum = 0;
  for (let i = 0; i < nodes.length; i += 1) sum += weights[i]! * f(mid + half * nodes[i]!);
  return sum * half;
}

/** Composite Gauss–Legendre: `panels` subintervals × `order` points each. */
export function compositeGauss(
  f: (x: number) => number,
  a: number,
  b: number,
  panels: number,
  order: number,
): number {
  const n = Math.max(1, Math.floor(panels));
  const h = (b - a) / n;
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += gaussLegendre(f, a + i * h, a + (i + 1) * h, order);
  return sum;
}

/**
 * Composite trapezoid with a Richardson error estimate: the value uses 2n
 * panels and the estimate is the classical |I(2n) − I(n)|/3.
 */
export function trapezoidalEstimate(
  f: (x: number) => number,
  a: number,
  b: number,
  panels: number,
): { value: number; estimate: number } {
  const n = Math.max(1, Math.floor(panels));
  const value = trapezoidal(f, a, b, 2 * n);
  const coarse = trapezoidal(f, a, b, n);
  return { value, estimate: Math.abs(value - coarse) / 3 };
}

/** Composite Simpson with the Richardson estimate |S(2n) − S(n)|/15. */
export function simpsonEstimate(
  f: (x: number) => number,
  a: number,
  b: number,
  panels: number,
): { value: number; estimate: number } {
  let n = Math.max(2, Math.floor(panels));
  if (n % 2 !== 0) n += 1;
  const value = simpson(f, a, b, 2 * n);
  const coarse = simpson(f, a, b, n);
  return { value, estimate: Math.abs(value - coarse) / 15 };
}

// ---- finite differences --------------------------------------------------------------

/** Forward difference (f(x+h) − f(x))/h — truncation error O(h). */
export function forwardDiff(f: (x: number) => number, x: number, h: number): number {
  return (f(x + h) - f(x)) / h;
}

/** Backward difference (f(x) − f(x−h))/h — truncation error O(h). */
export function backwardDiff(f: (x: number) => number, x: number, h: number): number {
  return (f(x) - f(x - h)) / h;
}

/** Central difference (f(x+h) − f(x−h))/(2h) — truncation error O(h²). */
export function centralDiff(f: (x: number) => number, x: number, h: number): number {
  return (f(x + h) - f(x - h)) / (2 * h);
}

export interface DiffErrors {
  forward: number;
  backward: number;
  central: number;
}

/** Absolute errors of the three difference formulas against an exact df. */
export function diffErrors(
  f: (x: number) => number,
  df: (x: number) => number,
  x: number,
  h: number,
): DiffErrors {
  const exact = df(x);
  return {
    forward: Math.abs(forwardDiff(f, x, h) - exact),
    backward: Math.abs(backwardDiff(f, x, h) - exact),
    central: Math.abs(centralDiff(f, x, h) - exact),
  };
}

// ---- interpolation ---------------------------------------------------------------------

/** Equispaced interpolation nodes on [a, b] (n ≥ 2). */
export function equiNodes(a: number, b: number, n: number): number[] {
  const count = Math.max(2, Math.round(n));
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) out.push(a + ((b - a) * i) / (count - 1));
  return out;
}

/** Lagrange interpolation evaluated at x (O(n²), stable for small n). */
export function lagrangeInterp(xs: number[], ys: number[], x: number): number {
  const n = Math.min(xs.length, ys.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    let term = ys[i]!;
    for (let j = 0; j < n; j += 1) {
      if (j === i) continue;
      term *= (x - xs[j]!) / (xs[i]! - xs[j]!);
    }
    sum += term;
  }
  return sum;
}

/** Newton divided-difference table (top row of coefficients, ascending powers). */
export function dividedDifferences(xs: number[], ys: number[]): number[] {
  const n = Math.min(xs.length, ys.length);
  const c = ys.slice(0, n);
  for (let k = 1; k < n; k += 1) {
    for (let i = n - 1; i >= k; i -= 1) {
      c[i] = (c[i]! - c[i - 1]!) / (xs[i]! - xs[i - k]!);
    }
  }
  return c;
}

/** Evaluate the Newton form ∑ c_i ∏(x − x_j), j < i, by nested multiplication. */
export function newtonInterp(coefs: number[], xs: number[], x: number): number {
  const n = Math.min(coefs.length, xs.length);
  if (n === 0) return NaN;
  let result = coefs[n - 1]!;
  for (let i = n - 2; i >= 0; i -= 1) result = result * (x - xs[i]!) + coefs[i]!;
  return result;
}

export type SplineMode = 'natural' | 'clamped';

/** One cubic segment on [x_i, x_{i+1}]: a + b·t + c·t² + d·t³, t = x − x_i. */
export interface SplineSegment {
  a: number;
  b: number;
  c: number;
  d: number;
}

/**
 * Cubic spline through (xs, ys) via the second-derivative (M) formulation
 * solved with the Thomas algorithm. `natural` sets M₀ = Mₙ = 0; `clamped`
 * prescribes the end first derivatives (`endDerivs`, default zero slope).
 */
export function cubicSpline(
  xs: number[],
  ys: number[],
  mode: SplineMode = 'natural',
  endDerivs: [number, number] = [0, 0],
): SplineSegment[] {
  const n = xs.length - 1;
  if (n < 1) return [];
  const h: number[] = [];
  for (let i = 0; i < n; i += 1) h.push(xs[i + 1]! - xs[i]!);

  // Tridiagonal system (size n+1) for the second derivatives M_i.
  const sub = new Array<number>(n + 1).fill(0);
  const diag = new Array<number>(n + 1).fill(0);
  const sup = new Array<number>(n + 1).fill(0);
  const rhs = new Array<number>(n + 1).fill(0);

  if (mode === 'clamped') {
    diag[0] = 2 * h[0]!;
    sup[0] = h[0]!;
    rhs[0] = 6 * ((ys[1]! - ys[0]!) / h[0]! - endDerivs[0]);
    diag[n] = 2 * h[n - 1]!;
    sub[n] = h[n - 1]!;
    rhs[n] = 6 * (endDerivs[1] - (ys[n]! - ys[n - 1]!) / h[n - 1]!);
  } else {
    diag[0] = 1;
    rhs[0] = 0;
    diag[n] = 1;
    rhs[n] = 0;
  }
  for (let i = 1; i < n; i += 1) {
    const hm = h[i - 1]!;
    const hp = h[i]!;
    sub[i] = hm;
    diag[i] = 2 * (hm + hp);
    sup[i] = hp;
    rhs[i] = 6 * ((ys[i + 1]! - ys[i]!) / hp - (ys[i]! - ys[i - 1]!) / hm);
  }

  // Thomas forward elimination.
  for (let i = 1; i <= n; i += 1) {
    const w = sub[i]! / diag[i - 1]!;
    diag[i] = diag[i]! - w * sup[i - 1]!;
    rhs[i] = rhs[i]! - w * rhs[i - 1]!;
  }
  // Back substitution.
  const m = new Array<number>(n + 1).fill(0);
  m[n] = rhs[n]! / diag[n]!;
  for (let i = n - 1; i >= 0; i -= 1) m[i] = (rhs[i]! - sup[i]! * m[i + 1]!) / diag[i]!;

  const segs: SplineSegment[] = [];
  for (let i = 0; i < n; i += 1) {
    const hh = h[i]!;
    const y0 = ys[i]!;
    const y1 = ys[i + 1]!;
    segs.push({
      a: y0,
      b: (y1 - y0) / hh - (hh * (2 * m[i]! + m[i + 1]!)) / 6,
      c: m[i]! / 2,
      d: (m[i + 1]! - m[i]!) / (6 * hh),
    });
  }
  return segs;
}

/** Evaluate spline segments (binary-search-free: linear scan, n is small). */
export function splineEval(segs: SplineSegment[], xs: number[], x: number): number {
  if (segs.length === 0) return NaN;
  let i = 0;
  for (let k = 0; k < xs.length - 1; k += 1) {
    if (x >= xs[k]!) i = k;
  }
  if (i > segs.length - 1) i = segs.length - 1;
  const t = x - xs[i]!;
  const s = segs[i]!;
  return s.a + t * (s.b + t * (s.c + t * s.d));
}

// ---- embedded validation benchmarks ------------------------------------------------

export const NUMERICS_BENCHMARK_ID = 'numerics-benchmarks';

export interface NumericsBenchmark {
  id: string;
  labelZh: string;
  labelEn: string;
  detailZh: string;
  detailEn: string;
  /** Unified relative error |computed − analytic|/|analytic|. */
  relErr: number;
  passed: boolean;
}

/** Panel-count ladder used by the quadrature convergence charts. */
export const PANEL_LADDER = [2, 4, 8, 16, 32, 64];

/** Finite-difference step ladder (decades from 1e-1 to 1e-7). */
export const FD_STEP_LADDER = [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7];

/**
 * Run the embedded validation suite (see manifest research.notes):
 * bisection order, Simpson cubic exactness + quintic error term, 2-point
 * Gauss cubic exactness, the Newton residual on √2, central vs forward
 * differences, and spline node reproduction. Every check reports the unified
 * metric |computed − analytic|/|analytic| (absolute error with an explicit
 * note when the analytic value is 0).
 */
export function runNumericsBenchmarks(): NumericsBenchmark[] {
  const out: NumericsBenchmark[] = [];
  const s2 = selectSample('sqrt2');

  // (1) Bisection order: regression of log2|error| over iterations 10..35
  // must show slope −1 (linear convergence, neighbouring error ratio ≈ 1/2).
  const bis = bisectRoot(s2.f, s2.bracket[0], s2.bracket[1], 40, s2.root);
  const bisErrs = bis.steps.map((s) => s.err);
  const bisOrder = fitIterationOrder(bisErrs, 10, 35);
  const e1 = Math.abs(bisOrder - 1) / 1; // analytic order = 1
  out.push({
    id: 'bisection-order',
    labelEn: 'Bisection measured order ≈ 1 (error ratio ≈ 1/2, |Δp| < 0.1)',
    labelZh: '二分法实测收敛阶 ≈ 1（相邻误差比 ≈ 1/2，|Δp| < 0.1）',
    relErr: e1,
    passed: Number.isFinite(e1) && e1 < 0.1,
    detailEn: `log2|error| regression over k = 10..35 gives order ${bisOrder.toFixed(4)} (theoretical 1); final |x − √2| = ${bisErrs[bisErrs.length - 1]!.toExponential(3)}`,
    detailZh: `k = 10..35 的 log₂|误差| 回归给出阶 ${bisOrder.toFixed(4)}（理论值 1）；最终 |x − √2| = ${bisErrs[bisErrs.length - 1]!.toExponential(3)}`,
  });

  // (2) Composite Simpson is exact for cubics: ∫₀² (x³ − 2x + 1) dx = 2.
  const cubic = (x: number) => x * x * x - 2 * x + 1;
  const cubicRef = 2;
  const sCub = simpson(cubic, 0, 2, 6);
  const e2 = Math.abs(sCub - cubicRef) / Math.abs(cubicRef);
  out.push({
    id: 'simpson-cubic',
    labelEn: 'Composite Simpson exact for cubics (|S − 2|/2 < 1e-12)',
    labelZh: '复合 Simpson 对三次多项式精确（|S − 2|/2 < 1e-12）',
    relErr: e2,
    passed: e2 < 1e-12,
    detailEn: `S = ${sCub.toPrecision(17)} vs analytic 2 (degree of exactness 3; a general quintic is NOT integrated exactly)`,
    detailZh: `S = ${sCub.toPrecision(17)} 对照解析值 2（精确次数 3；一般五次多项式并不被 Simpson 精确积分）`,
  });

  // (3) Composite Simpson quintic error vs the closed-form term
  // I − S = −Σ_panels (w/180)·h⁴·f⁗(panel midpoint) (exact for quintics,
  // because the Peano kernel is symmetric and f⁗ is affine).
  const quintic = (x: number) => x ** 5 - 3 * x ** 4 + 2;
  const quinticD4 = (x: number) => 120 * x - 72;
  const quinticRef = 1 / 6 - 3 / 5 + 2;
  const qPanels = 4;
  const qH = 1 / qPanels;
  let qPred = 0;
  for (let i = 0; i < qPanels / 2; i += 1) {
    const mid = (2 * i + 1) * qH;
    qPred += ((2 * qH) / 180) * qH ** 4 * quinticD4(mid);
  }
  const qS = simpson(quintic, 0, 1, qPanels);
  const qDiff = qS - quinticRef;
  const e3 = Math.abs(qDiff - qPred) / Math.abs(qPred); // analytic prediction ≠ 0
  out.push({
    id: 'simpson-quintic-error',
    labelEn: 'Simpson quintic error vs closed-form −(b−a)h⁴f⁗/180 (< 1e-10)',
    labelZh: 'Simpson 五次误差对照闭式项 −(b−a)h⁴f⁗/180（< 1e-10）',
    relErr: e3,
    passed: e3 < 1e-10,
    detailEn: `I − S = ${(-qDiff).toExponential(6)} vs predicted ${(-qPred).toExponential(6)} on x⁵ − 3x⁴ + 2, 4 panels of h = 0.25 (analytic I = ${quinticRef.toPrecision(12)})`,
    detailZh: `x⁵ − 3x⁴ + 2 在 4 个 h = 0.25 区间上 I − S = ${(-qDiff).toExponential(6)} 对照预测 ${(-qPred).toExponential(6)}（解析 I = ${quinticRef.toPrecision(12)}）`,
  });

  // (4) 2-point Gauss–Legendre is exact for cubics: ∫₀² x³ dx = 4.
  const g2 = gaussLegendre((x) => x * x * x, 0, 2, 2);
  const g2Ref = 4;
  const e4 = Math.abs(g2 - g2Ref) / g2Ref;
  out.push({
    id: 'gauss2-cubic',
    labelEn: '2-point Gauss–Legendre exact for cubics (|G − 4|/4 < 1e-14)',
    labelZh: '2 点 Gauss–Legendre 对三次多项式精确（|G − 4|/4 < 1e-14）',
    relErr: e4,
    passed: e4 < 1e-14,
    detailEn: `G = ${g2.toPrecision(17)} vs analytic 4 (nodes ±1/√3, weights 1 mapped to [0, 2])`,
    detailZh: `G = ${g2.toPrecision(17)} 对照解析值 4（节点 ±1/√3、权 1 映射到 [0, 2]）`,
  });

  // (5) Newton on x² − 2 from x₀ = 1.3: the squared residual |x² − 2|/2.
  const newt = newtonRoot(s2.f, s2.df, 1.3, 8, s2.root);
  const finalX = newt.steps.length > 0 ? newt.root : NaN;
  const e5 = Math.abs(finalX * finalX - 2) / 2; // analytic value 2 ≠ 0
  out.push({
    id: 'newton-sqrt2',
    labelEn: 'Newton on x² − 2: squared residual |x² − 2|/2 < 1e-12',
    labelZh: 'x² − 2 的 Newton 平方残差 |x² − 2|/2 < 1e-12',
    relErr: e5,
    passed: Number.isFinite(e5) && e5 < 1e-12,
    detailEn: `x₀ = 1.3 → x = ${finalX.toPrecision(17)} after ${newt.steps.length} steps (quadratic convergence), residual ${Math.abs(finalX * finalX - 2).toExponential(3)}`,
    detailZh: `x₀ = 1.3 → ${newt.steps.length} 步后 x = ${finalX.toPrecision(17)}（二次收敛），残差 ${Math.abs(finalX * finalX - 2).toExponential(3)}`,
  });

  // (6) Central differences must beat forward differences for f = sin at
  // x = 0.7, h = 1e-5 (O(h²) vs O(h) truncation error).
  const probe = selectSample('sin');
  const fdH = 1e-5;
  const fdX = probe.xDiff;
  const fdExact = probe.df(fdX);
  const fwdRel = Math.abs(forwardDiff(probe.f, fdX, fdH) - fdExact) / Math.abs(fdExact);
  const cenRel = Math.abs(centralDiff(probe.f, fdX, fdH) - fdExact) / Math.abs(fdExact);
  out.push({
    id: 'central-vs-forward',
    labelEn: 'Central-difference relative error beats forward (< 1e-6 and < forward)',
    labelZh: '中心差分相对误差优于前向差分（< 1e-6 且小于前向）',
    relErr: cenRel, // unified metric |D_c − f′|/|f′|
    passed: cenRel < 1e-6 && cenRel < fwdRel,
    detailEn: `at x = ${fdX}, h = 1e-5: central ${cenRel.toExponential(3)} vs forward ${fwdRel.toExponential(3)} (ratio ${(cenRel / fwdRel).toExponential(3)}, theory O(h²) vs O(h))`,
    detailZh: `x = ${fdX}、h = 1e-5：中心差分 ${cenRel.toExponential(3)} 对前向差分 ${fwdRel.toExponential(3)}（比值 ${(cenRel / fwdRel).toExponential(3)}，理论 O(h²) 对 O(h)）`,
  });

  // (7) Interpolating splines reproduce their nodes: natural and clamped
  // variants evaluated at every node must return y_i.
  const xs = equiNodes(s2.range[0], s2.range[1], 7);
  const ys = xs.map((x) => s2.f(x));
  const naturalSegs = cubicSpline(xs, ys, 'natural');
  const clampedSegs = cubicSpline(xs, ys, 'clamped', [s2.df(xs[0]!), s2.df(xs[xs.length - 1]!)]);
  let nodeErr = 0;
  let nodeRel = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const xn = xs[i]!;
    const yn = ys[i]!;
    const dN = Math.abs(splineEval(naturalSegs, xs, xn) - yn);
    const dC = Math.abs(splineEval(clampedSegs, xs, xn) - yn);
    nodeErr = Math.max(nodeErr, dN, dC);
    // Unified metric; every node value here is nonzero (|y| ≥ 0.222).
    nodeRel = Math.max(nodeRel, yn === 0 ? dN : dN / Math.abs(yn), yn === 0 ? dC : dC / Math.abs(yn));
  }
  out.push({
    id: 'spline-nodes',
    labelEn: 'Natural & clamped splines reproduce interpolation nodes (rel < 1e-12)',
    labelZh: '自然/夹持样条在插值节点复现数据（相对误差 < 1e-12）',
    relErr: nodeRel,
    passed: nodeRel < 1e-12,
    detailEn: `max |S(x_i) − y_i| = ${nodeErr.toExponential(3)} over 7 nodes of x² − 2 on [0, 2] (all y_i ≠ 0, relative metric applies)`,
    detailZh: `[0, 2] 上 x² − 2 的 7 个节点 max |S(x_i) − y_i| = ${nodeErr.toExponential(3)}（各 y_i ≠ 0，采用相对口径）`,
  });

  return out;
}
