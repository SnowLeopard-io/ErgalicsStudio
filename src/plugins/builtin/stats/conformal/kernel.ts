// ==========================================================================
// stats-conformal — split conformal prediction kernel (pure TS, no DOM)
//
// Distribution-free, finite-sample marginal coverage: fit a point predictor on
// the training split, calibrate nonconformity scores on a held-out calibration
// split, and turn them into prediction intervals on the test split.
//
// The demo is built around the failure mode that makes conformal prediction
// worth teaching: under heteroscedastic noise a Gaussian ±z·σ̂ interval with a
// single global σ̂ keeps its marginal rate but loses coverage in the
// high-variance tail of x, while split conformal still hits its marginal rate
// and the normalised variant restores (approximate) conditional coverage.
// ==========================================================================

export type DatasetKind = 'hetero' | 'homo' | 'skewed';
export type ScoreMethod = 'absolute' | 'normalized';

export interface ConformalConfig {
  kind: DatasetKind;
  /** Total sample size (split 60 / 20 / 20). */
  n: number;
  /** Base noise amplitude. */
  noise: number;
  /** Polynomial degree of the point predictor. */
  degree: number;
  /** Miscoverage level: target coverage = 1 - alpha. */
  alpha: number;
  method: ScoreMethod;
  seed: number;
}

export interface Pt {
  x: number;
  y: number;
}

export interface Band {
  x: number;
  lo: number;
  hi: number;
}

export interface SweepPoint {
  alpha: number;
  conformal: number;
  naive: number;
}

export interface ConformalResult {
  kind: DatasetKind;
  train: Pt[];
  cal: Pt[];
  test: Pt[];
  fit: Pt[];
  band: Band[];
  naiveBand: Band[];
  coverage: number;
  coverageNaive: number;
  /** Conditional coverage in the low (< 1/3) and high (> 2/3) x terciles. */
  covLow: number;
  covHigh: number;
  covLowNaive: number;
  covHighNaive: number;
  meanWidth: number;
  meanWidthNaive: number;
  qhat: number;
  alpha: number;
  target: number;
  nCal: number;
  nTest: number;
  degree: number;
  scores: number[];
  sweep: SweepPoint[];
  sigmaHat: number;
  rmse: number;
  normalized: boolean;
}

// ---- deterministic RNG / normal sampler ------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller pair (cached second variate). */
export function gaussian(rng: () => number): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Acklam's inverse normal CDF (|error| < 1.2e-9). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const phigh = 1 - plow;
  // Horner evaluation of a coefficient list: (((c0*q + c1)*q + c2)...).
  const horner = (coefs: number[], x: number): number => coefs.reduce((acc, c) => acc * x + c, 0);
  const dFull = [...d, 1];
  const bFull = [...b, 1];
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return horner(c, q) / horner(dFull, q);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(horner(c, q) / horner(dFull, q));
  }
  const q = p - 0.5;
  const r = q * q;
  return (horner(a, r) * q) / horner(bFull, r);
}

// ---- data -----------------------------------------------------------------

function fTrue(x: number): number {
  return Math.sin(2 * Math.PI * x) + 0.35 * Math.cos(4 * Math.PI * x);
}

function sigmaOf(kind: DatasetKind, x: number, noise: number): number {
  if (kind === 'hetero') return noise * (0.15 + 1.7 * x);
  if (kind === 'skewed') return noise * (0.2 + 1.2 * x);
  return noise;
}

export function generateDataset(
  kind: DatasetKind,
  n: number,
  noise: number,
  seed: number,
): Pt[] {
  const rng = mulberry32(seed);
  const out: Pt[] = [];
  for (let i = 0; i < n; i += 1) {
    const x = rng();
    const s = sigmaOf(kind, x, noise);
    let e: number;
    if (kind === 'skewed') {
      // Standardised exponential (mean 0, sd 1): heavy right tail.
      e = (Math.log(Math.max(1e-12, 1 - rng())) * -1 - 1);
    } else {
      e = gaussian(rng);
    }
    out.push({ x, y: fTrue(x) + s * e });
  }
  return out;
}

// ---- ridge polynomial fit --------------------------------------------------

export interface PolyModel {
  coef: Float64Array;
}

export function fitPoly(xs: number[], ys: number[], degree: number, ridge = 1e-8): PolyModel {
  const d = degree + 1;
  const ata = new Float64Array(d * d);
  const atb = new Float64Array(d);
  for (let i = 0; i < xs.length; i += 1) {
    const x = xs[i] as number;
    const y = ys[i] as number;
    const p = new Float64Array(d);
    p[0] = 1;
    for (let k = 1; k < d; k += 1) p[k] = (p[k - 1] as number) * x;
    for (let r = 0; r < d; r += 1) {
      atb[r] = (atb[r] as number) + (p[r] as number) * y;
      for (let c = 0; c < d; c += 1) ata[r * d + c] = (ata[r * d + c] as number) + (p[r] as number) * (p[c] as number);
    }
  }
  for (let r = 0; r < d; r += 1) ata[r * d + r] = (ata[r * d + r] as number) + ridge;
  return { coef: solve(ata, atb, d) };
}

function solve(a: Float64Array, b: Float64Array, n: number): Float64Array {
  const m = a.slice();
  const rhs = b.slice();
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r * n + col] as number) > Math.abs(m[piv * n + col] as number)) piv = r;
    }
    if (Math.abs(m[piv * n + col] as number) < 1e-14) continue;
    if (piv !== col) {
      for (let c = 0; c < n; c += 1) {
        const t = m[col * n + c] as number;
        m[col * n + c] = m[piv * n + c] as number;
        m[piv * n + c] = t;
      }
      const t = rhs[col] as number;
      rhs[col] = rhs[piv] as number;
      rhs[piv] = t;
    }
    const diag = m[col * n + col] as number;
    for (let r = col + 1; r < n; r += 1) {
      const f = (m[r * n + col] as number) / diag;
      if (f === 0) continue;
      for (let c = col; c < n; c += 1) m[r * n + c] = (m[r * n + c] as number) - f * (m[col * n + c] as number);
      rhs[r] = (rhs[r] as number) - f * (rhs[col] as number);
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = rhs[r] as number;
    for (let c = r + 1; c < n; c += 1) s -= (m[r * n + c] as number) * (x[c] as number);
    const diag = m[r * n + r] as number;
    x[r] = Math.abs(diag) < 1e-14 ? 0 : s / diag;
  }
  return x;
}

export function evalPoly(coef: Float64Array, x: number): number {
  let s = 0;
  for (let k = coef.length - 1; k >= 0; k -= 1) s = s * x + (coef[k] as number);
  return s;
}

// ---- conformal machinery ---------------------------------------------------

/**
 * Split-conformal quantile: the ceil((n+1)(1-alpha))-th smallest score.
 * Returns +Infinity when the calibration set is too small for the requested
 * level (the honest answer: no finite-sample guarantee at that alpha).
 */
export function conformalQuantile(scores: number[], alpha: number): number {
  const n = scores.length;
  if (n === 0) return Infinity;
  const k = Math.ceil((n + 1) * (1 - alpha));
  if (k > n) return Infinity;
  const sorted = scores.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, k - 1)] as number;
}

export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const pos = Math.min(1, Math.max(0, q)) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const f = pos - lo;
  return (sorted[lo] as number) * (1 - f) + (sorted[hi] as number) * f;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function runConformal(cfg: ConformalConfig): ConformalResult {
  const n = Math.max(30, Math.round(cfg.n));
  const data = generateDataset(cfg.kind, n, cfg.noise, cfg.seed);
  const rng = mulberry32(cfg.seed ^ 0x9e3779b9);
  // Shuffle in place (deterministic given the seed).
  for (let i = data.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = data[i] as Pt;
    data[i] = data[j] as Pt;
    data[j] = t;
  }
  const nTrain = Math.floor(n * 0.6);
  const nCal = Math.floor(n * 0.2);
  const train = data.slice(0, nTrain);
  const cal = data.slice(nTrain, nTrain + nCal);
  const test = data.slice(nTrain + nCal);

  const model = fitPoly(train.map((p) => p.x), train.map((p) => p.y), cfg.degree);
  const predTrain = train.map((p) => evalPoly(model.coef, p.x));
  const resTrain = train.map((p, i) => p.y - (predTrain[i] as number));
  const sigmaHat = Math.max(1e-6, std(resTrain));

  // Optional normalisation model: polynomial fit of |residual| on train.
  const sigmaModel = cfg.method === 'normalized'
    ? fitPoly(train.map((p) => p.x), resTrain.map((r) => Math.abs(r)), Math.min(2, cfg.degree))
    : null;
  const scaleAt = (x: number): number => {
    if (!sigmaModel) return 1;
    return Math.max(0.02, evalPoly(sigmaModel.coef, x));
  };

  const predCal = cal.map((p) => evalPoly(model.coef, p.x));
  const scores = cal.map((p, i) => Math.abs(p.y - (predCal[i] as number)) / scaleAt(p.x));
  const qhat = conformalQuantile(scores, cfg.alpha);

  const predTest = test.map((p) => evalPoly(model.coef, p.x));
  let covered = 0;
  let widthSum = 0;
  const z = normInv(1 - cfg.alpha / 2);
  let coveredNaive = 0;
  let widthNaive = 0;
  // Conditional coverage: the marginal guarantee says nothing about a fixed x,
  // so the terciles are where a constant-width Gaussian band visibly fails.
  const tercile = { loN: 0, loC: 0, loGN: 0, hiN: 0, hiC: 0, hiGN: 0 };
  for (let i = 0; i < test.length; i += 1) {
    const p = test[i] as Pt;
    const yhat = predTest[i] as number;
    const half = Number.isFinite(qhat) ? qhat * scaleAt(p.x) : Infinity;
    const confOk = Math.abs(p.y - yhat) <= half;
    if (confOk) covered += 1;
    widthSum += 2 * half;
    const halfN = z * sigmaHat;
    const naiveOk = Math.abs(p.y - yhat) <= halfN;
    if (naiveOk) coveredNaive += 1;
    widthNaive += 2 * halfN;
    if (p.x < 1 / 3) {
      tercile.loN += 1;
      if (confOk) tercile.loC += 1;
      if (naiveOk) tercile.loGN += 1;
    } else if (p.x > 2 / 3) {
      tercile.hiN += 1;
      if (confOk) tercile.hiC += 1;
      if (naiveOk) tercile.hiGN += 1;
    }
  }
  const m = Math.max(1, test.length);
  const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

  const grid: number[] = [];
  const G = 121;
  for (let i = 0; i < G; i += 1) grid.push(i / (G - 1));
  const fit = grid.map((x) => ({ x, y: evalPoly(model.coef, x) }));
  const band = grid.map((x) => {
    const yhat = evalPoly(model.coef, x);
    const half = Number.isFinite(qhat) ? qhat * scaleAt(x) : Infinity;
    return { x, lo: yhat - half, hi: yhat + half };
  });
  const naiveBand = grid.map((x) => {
    const yhat = evalPoly(model.coef, x);
    return { x, lo: yhat - z * sigmaHat, hi: yhat + z * sigmaHat };
  });

  // Coverage vs nominal level (the calibration diagnostic).
  const sweep: SweepPoint[] = [];
  for (let k = 1; k <= 19; k += 1) {
    const alpha = 0.01 + (k - 1) * 0.025; // 0.01 .. 0.46 -> 99% .. 54%
    const qa = conformalQuantile(scores, alpha);
    const za = normInv(1 - alpha / 2);
    let cConf = 0;
    let cNaive = 0;
    for (let i = 0; i < test.length; i += 1) {
      const p = test[i] as Pt;
      const yhat = predTest[i] as number;
      const half = Number.isFinite(qa) ? qa * scaleAt(p.x) : Infinity;
      if (Math.abs(p.y - yhat) <= half) cConf += 1;
      if (Math.abs(p.y - yhat) <= za * sigmaHat) cNaive += 1;
    }
    sweep.push({ alpha, conformal: cConf / m, naive: cNaive / m });
  }

  const rmse = Math.sqrt(
    test.reduce((acc, p, i) => acc + (p.y - (predTest[i] as number)) ** 2, 0) / m,
  );

  return {
    kind: cfg.kind,
    train,
    cal,
    test,
    fit,
    band,
    naiveBand,
    coverage: covered / m,
    coverageNaive: coveredNaive / m,
    covLow: ratio(tercile.loC, tercile.loN),
    covHigh: ratio(tercile.hiC, tercile.hiN),
    covLowNaive: ratio(tercile.loGN, tercile.loN),
    covHighNaive: ratio(tercile.hiGN, tercile.hiN),
    meanWidth: widthSum / m,
    meanWidthNaive: widthNaive / m,
    qhat,
    alpha: cfg.alpha,
    target: 1 - cfg.alpha,
    nCal,
    nTest: test.length,
    degree: cfg.degree,
    scores,
    sweep,
    sigmaHat,
    rmse,
    normalized: cfg.method === 'normalized',
  };
}

/** Self-check: a uniform-score calibration set must return the order statistic. */
export function conformalSelfCheck(): { ok: boolean; detail: string } {
  const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const q = conformalQuantile(scores, 0.2);
  // n = 10, alpha = 0.2 -> k = ceil(11 * 0.8) = 9 -> 9th smallest = 9.
  const ok = q === 9 && normInv(0.975) > 1.95 && normInv(0.975) < 1.97;
  return { ok, detail: `q(0.2, n=10) = ${q}, z(0.975) = ${normInv(0.975).toFixed(4)}` };
}
