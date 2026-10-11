// ==========================================================================
// psych-sdt — signal detection theory numerics (pure, dependency-free)
//
// Equal-variance Gaussian SDT: d' = z(H) - z(F), bias beta = exp((zF²-zH²)/2),
// criterion c = -(zH + zF)/2, analytic ROC HR = Phi(d' + Phi^-1(FAR)) and
// AUC = Phi(d'/sqrt(2)). An optional unequal-variance model with sigma ratio
// s generalises these to HR = Phi((d' + z(FAR))/s), AUC = Phi(d'/sqrt(1+s²)).
//
// Numerics are fully in-house: Phi via the regularized incomplete gamma
// (erfc identity, ~1e-14 relative accuracy) and the inverse via Acklam's
// rational approximation refined by one Halley step. All pure — no DOM.
// ==========================================================================

// ---- special functions --------------------------------------------------------

/** Log Gamma (Lanczos, double precision). */
export function gammaln(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let ser = 1.000000000190015;
  for (let j = 0; j < 6; j += 1) {
    y += 1;
    ser += cof[j]! / y;
  }
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** Regularized lower incomplete gamma P(a, x) by series (x < a+1). */
function gammaSeries(a: number, x: number): number {
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < 500; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - gammaln(a));
}

/** Regularized upper incomplete gamma Q(a, x) by modified Lentz continued fraction. */
function gammaContinued(a: number, x: number): number {
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
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - gammaln(a)) * h;
}

/** Regularized upper incomplete gamma Q(a, x). */
export function gammq(a: number, x: number): number {
  if (!(x >= 0) || !(a > 0)) return Number.NaN;
  if (x === 0) return 1;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaContinued(a, x);
}

/** Standard normal density. */
export function stdNormPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Standard normal CDF via the erfc identity
 *   Phi(x) = 0.5·erfc(-x/√2),  erfc(y) = Q(1/2, y²),
 * accurate to ~1e-14 relative over the whole line.
 */
export function stdNormCdf(x: number): number {
  const q = gammq(0.5, (x * x) / 2);
  return x >= 0 ? 1 - q / 2 : q / 2;
}

/**
 * Standard normal quantile (probit): Acklam's piecewise rational approximation
 * (|rel. err| < 1.15e-9) refined by one Halley step against the in-house Phi,
 * which drives the error to machine level.
 */
export function stdNormQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return Number.NaN;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  let x: number;
  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  // One Halley refinement step against the in-house CDF.
  const e = stdNormCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  return x - u / (1 + (x * u) / 2);
}

// ---- SDT measures ---------------------------------------------------------------

const RATE_MIN = 1e-6;

/** Clamp a rate into the open (0, 1) interval so z() stays finite. */
export function safeRate(p: number): number {
  return Math.min(1 - RATE_MIN, Math.max(RATE_MIN, p));
}

export interface SdtMeasures {
  dprime: number;
  beta: number;
  criterion: number;
}

/**
 * Equal-variance Gaussian SDT (Macmillan & Creelman 2005):
 *   d' = z(H) - z(F),  beta = exp((z_F² - z_H²)/2),  c = -(z_H + z_F)/2.
 */
export function sdtMeasures(hitRate: number, faRate: number): SdtMeasures {
  const zh = stdNormQuantile(safeRate(hitRate));
  const zf = stdNormQuantile(safeRate(faRate));
  return {
    dprime: zh - zf,
    beta: Math.exp((zf * zf - zh * zh) / 2),
    criterion: -0.5 * (zh + zf),
  };
}

/**
 * Equal-variance analytic ROC: HR = Phi(d' + Phi^-1(FAR)).
 * `far` must lie in (0, 1) — the caller supplies the grid.
 */
export function rocHrEv(dprime: number, far: number): number {
  return stdNormCdf(dprime + stdNormQuantile(safeRate(far)));
}

/** Unequal-variance ROC (noise σ = 1, signal σ = s): HR = Phi((d' + z(FAR))/s). */
export function rocHrUv(dprime: number, far: number, s: number): number {
  const ss = Math.max(0.1, s);
  return stdNormCdf((dprime + stdNormQuantile(safeRate(far))) / ss);
}

export interface RocPoint {
  far: number;
  hr: number;
}

/** ROC curve sampled on a log-spaced FAR grid inside (1e-4, 1 - 1e-4). */
export function rocCurve(dprime: number, s = 1, n = 220): RocPoint[] {
  const pts: RocPoint[] = [];
  for (let i = 0; i < n; i += 1) {
    const u = Math.log(1e-4) + ((Math.log(1 - 1e-4) - Math.log(1e-4)) * i) / (n - 1);
    const far = Math.exp(u);
    pts.push({ far, hr: s === 1 ? rocHrEv(dprime, far) : rocHrUv(dprime, far, s) });
  }
  return pts;
}

/** Closed-form AUC of the (possibly unequal-variance) ROC: Phi(d'/√(1+s²)). */
export function aucAnalytic(dprime: number, s = 1): number {
  return stdNormCdf(dprime / Math.sqrt(1 + s * s));
}

/**
 * Numerically integrate the model ROC area in quantile space:
 *   AUC = ∫ Phi((d' + u)/s)·phi(u) du over u ∈ [-7, 7] (trapezoid),
 * an independent cross-check of the closed form.
 */
export function aucNumeric(dprime: number, s = 1, n = 900): number {
  let acc = 0;
  const lo = -7;
  const hi = 7;
  const step = (hi - lo) / n;
  const f = (u: number) => stdNormCdf((dprime + u) / Math.max(0.1, s)) * stdNormPdf(u);
  for (let i = 0; i <= n; i += 1) {
    const u = lo + i * step;
    const w = i === 0 || i === n ? 0.5 : 1;
    acc += w * f(u);
  }
  return acc * step;
}

// ---- data parsing -----------------------------------------------------------------

export interface Confusion {
  hits: number;
  misses: number;
  falseAlarms: number;
  correctRejections: number;
  /** Total trials represented by the tally. */
  n: number;
}

export function confusionToRates(c: Confusion): { hitRate: number; faRate: number } {
  const sTrials = c.hits + c.misses;
  const nTrials = c.falseAlarms + c.correctRejections;
  return {
    hitRate: sTrials > 0 ? c.hits / sTrials : 0.5,
    faRate: nTrials > 0 ? c.falseAlarms / nTrials : 0.5,
  };
}

const SIGNAL_TRUTHY = new Set(['1', 's', 'signal', 'sig', 'true', 't', 'yes', 'y']);
const RESPOND_TRUTHY = new Set(['1', 'r', 'respond', 'response', 'true', 't', 'yes', 'y']);

function isFalsySignal(cell: string): boolean {
  const v = cell.trim().toLowerCase();
  return ['0', 'n', 'noise', 'false', 'f', 'no'].includes(v);
}

/**
 * Parse SDT trial data from CSV/TSV/TXT text. Accepted mainstream formats:
 *  - trial table with header `signal,respond` (0/1, s/n, yes/no, true/false);
 *  - counts table with header naming hits / misses / false alarms / correct
 *    rejections (any row order, values summed across rows);
 *  - headerless two-column numeric trials (column 1 = signal, column 2 = respond).
 * `#`-comment lines are skipped. Returns null when nothing usable is found.
 */
export function parseSdtData(text: string): Confusion | null {
  const trim = text.trim();
  if (!trim) return null;
  const lines = trim.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return null;
  const split = (l: string) => l.split(/[,\t;\s]+/).filter((c) => c.length > 0);
  const first = split(lines[0]!).map((c) => c.toLowerCase());
  const hasTrialHeader = first.includes('signal') && (first.includes('respond') || first.includes('response'));
  const isCountsHeader =
    first.some((c) => c.startsWith('hit')) ||
    first.some((c) => c.startsWith('miss')) ||
    first.some((c) => c.startsWith('false') || c === 'fa');

  if (isCountsHeader) {
    const acc: Confusion = { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0, n: 0 };
    for (let i = 1; i < lines.length; i += 1) {
      const cells = split(lines[i]!);
      if (cells.length !== first.length) continue;
      for (let j = 0; j < first.length; j += 1) {
        const v = Number(cells[j]);
        if (!Number.isFinite(v) || v < 0) continue;
        const name = first[j]!;
        if (name.startsWith('hit')) acc.hits += v;
        else if (name.startsWith('miss')) acc.misses += v;
        else if (name.startsWith('false') || name === 'fa') acc.falseAlarms += v;
        else if (name.startsWith('correct') || name === 'cr') acc.correctRejections += v;
      }
    }
    acc.n = acc.hits + acc.misses + acc.falseAlarms + acc.correctRejections;
    return acc.n > 0 ? acc : null;
  }

  const acc: Confusion = { hits: 0, misses: 0, falseAlarms: 0, correctRejections: 0, n: 0 };
  const startIdx = hasTrialHeader ? 1 : 0;
  for (let i = startIdx; i < lines.length; i += 1) {
    const cells = split(lines[i]!);
    if (cells.length < 2) continue;
    const sc = cells[0]!;
    const rc = cells[1]!;
    const isSignal = SIGNAL_TRUTHY.has(sc.trim().toLowerCase());
    const isNoise = isFalsySignal(sc);
    const isResp = RESPOND_TRUTHY.has(rc.trim().toLowerCase());
    if (!isSignal && !isNoise) continue;
    acc.n += 1;
    if (isSignal && isResp) acc.hits += 1;
    else if (isSignal) acc.misses += 1;
    else if (isResp) acc.falseAlarms += 1;
    else acc.correctRejections += 1;
  }
  return acc.n > 0 ? acc : null;
}

// ---- embedded validation benchmark ---------------------------------------------------

export const SDT_BENCHMARK = {
  id: 'psych-sdt-benchmark',
  /** True probit reference: z(0.8) = 0.8416212335729143 → d' = 1.6832424671458286. */
  dprime8020: 1.6832424671458286,
  q975: 1.959963984540054,
  extremeDprime: 6.180464612335626,
} as const;

export interface SdtBenchmark {
  dprime8020: number;
  dprime8020Err: number;
  q975: number;
  q975Err: number;
  aucNumRelErr: number;
  aucUvNumRelErr: number;
  extremeDprime: number;
  /** Extreme-rate case finite AND within 1e-4 of the reference 6.180465. */
  extremeStable: boolean;
  pass: boolean;
}

/**
 * Run the four embedded SDT benchmarks (uniform error metric
 * |computed - analytic| / |analytic|):
 *  (1) d'(H=0.8, F=0.2) vs the published probit value 1.6832425 (< 1e-4);
 *  (2) numerically integrated ROC area vs closed-form AUC (s = 1 and 1.5, < 1e-4);
 *  (3) numerical stability at H = 0.999 / F = 0.001 (d' = 6.180465);
 *  (4) Phi^-1(0.975) = 1.959964 (< 1e-6).
 */
export function runSdtBenchmark(): SdtBenchmark {
  const m = sdtMeasures(0.8, 0.2);
  const dprime8020Err = Math.abs(m.dprime - SDT_BENCHMARK.dprime8020);
  const q975 = stdNormQuantile(0.975);
  const q975Err = Math.abs(q975 - SDT_BENCHMARK.q975);
  const aucA = aucAnalytic(1.5, 1);
  const aucNumRelErr = Math.abs(aucNumeric(1.5, 1) - aucA) / aucA;
  const aucUv = aucAnalytic(1.5, 1.5);
  const aucUvNumRelErr = Math.abs(aucNumeric(1.5, 1.5) - aucUv) / aucUv;
  const ex = sdtMeasures(0.999, 0.001);
  const extremeErr = Math.abs(ex.dprime - SDT_BENCHMARK.extremeDprime);
  const extremeStable =
    Number.isFinite(ex.dprime) && Number.isFinite(ex.beta) && Number.isFinite(ex.criterion) && extremeErr < 1e-4;
  return {
    dprime8020: m.dprime,
    dprime8020Err,
    q975,
    q975Err,
    aucNumRelErr,
    aucUvNumRelErr,
    extremeDprime: ex.dprime,
    extremeStable,
    pass:
      dprime8020Err < 1e-4 &&
      q975Err < 1e-6 &&
      aucNumRelErr < 1e-4 &&
      aucUvNumRelErr < 1e-4 &&
      extremeStable,
  };
}
