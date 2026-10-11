// ==========================================================================
// psych-rt — reaction-time statistics numerics (pure, dependency-free)
//
// Descriptive statistics for RT data (n, mean, median, SD, SEM, 95% CI via an
// in-house Student-t quantile), Welch's independent-samples t test with
// Satterthwaite df and an exact two-tailed p from the regularized incomplete
// beta, Cohen's d (pooled SD), and the standard <100 ms / >2000 ms outlier
// screen. All functions are pure — the browser experiment itself lives in
// plugin.ts; this module is fully unit-testable without a DOM.
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

/** Continued fraction for the regularized incomplete beta (Numerical Recipes). */
export function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 3e-15;
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
export function betai(a: number, b: number, x: number): number {
  if (!(x >= 0) || !(x <= 1) || !(a > 0) || !(b > 0)) return Number.NaN;
  if (x === 0 || x === 1) return x;
  const bt = Math.exp(
    gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

// ---- Student t ------------------------------------------------------------------

/**
 * Two-tailed tail probability P(|T_df| ≥ |t|) = I_{df/(df+t²)}(df/2, 1/2).
 * Exact for all df ≥ 1 (including small df) via the incomplete beta.
 */
export function tTwoTailedP(t: number, df: number): number {
  if (!(df >= 1) || !Number.isFinite(t)) return Number.NaN;
  return betai(df / 2, 0.5, df / (df + t * t));
}

/** Student t CDF P(T ≤ t). */
export function tCdf(t: number, df: number): number {
  const p = tTwoTailedP(t, df);
  return t >= 0 ? 1 - p / 2 : p / 2;
}

/**
 * Student t quantile by bisection on the exact CDF (80 iterations ⇒ ~1e-12
 * location accuracy on the [-1e4, 1e4] bracket). Handles df ≥ 1, including
 * the Cauchy-like df = 1 (t_{0.975,1} = 12.7062).
 */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df >= 1)) return Number.NaN;
  let lo = -1e4;
  let hi = 1e4;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- descriptives -------------------------------------------------------------------

export interface RtSummary {
  n: number;
  mean: number;
  median: number;
  /** Sample SD (ddof = 1). */
  sd: number;
  sem: number;
  /** Half-width of the 95% CI: t_{0.975, n-1} · SEM. */
  ciHalf: number;
  ciLo: number;
  ciHi: number;
}

/** Descriptive statistics with an exact small-sample 95% t interval. */
export function summarize(rts: number[]): RtSummary | null {
  const xs = rts.filter((v) => Number.isFinite(v));
  const n = xs.length;
  if (n < 2) return null;
  const mean = xs.reduce((a, v) => a + v, 0) / n;
  const variance = xs.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(Math.max(variance, 0));
  const sem = sd / Math.sqrt(n);
  const tq = tQuantile(0.975, n - 1);
  const ciHalf = tq * sem;
  const sorted = [...xs].sort((a, b) => a - b);
  const median = n % 2 === 1 ? sorted[(n - 1) / 2]! : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  return { n, mean, median, sd, sem, ciHalf, ciLo: mean - ciHalf, ciHi: mean + ciHalf };
}

// ---- group comparison -------------------------------------------------------------------

export interface WelchResult {
  t: number;
  df: number;
  /** Two-tailed p-value. */
  p: number;
}

/**
 * Welch's independent-samples t test (unequal variances): the Satterthwaite
 * degrees of freedom make it exact-ish without the pooled-variance assumption.
 * Returns null when either group has < 2 finite observations or zero total
 * standard error (degenerate data).
 */
export function welchTest(a: number[], b: number[]): WelchResult | null {
  const xs = a.filter((v) => Number.isFinite(v));
  const ys = b.filter((v) => Number.isFinite(v));
  const n1 = xs.length;
  const n2 = ys.length;
  if (n1 < 2 || n2 < 2) return null;
  const m1 = xs.reduce((s, v) => s + v, 0) / n1;
  const m2 = ys.reduce((s, v) => s + v, 0) / n2;
  const v1 = xs.reduce((s, v) => s + (v - m1) ** 2, 0) / (n1 - 1);
  const v2 = ys.reduce((s, v) => s + (v - m2) ** 2, 0) / (n2 - 1);
  const se2 = v1 / n1 + v2 / n2;
  if (!(se2 > 0)) return null;
  const t = (m1 - m2) / Math.sqrt(se2);
  const df = se2 * se2 / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1));
  return { t, df, p: tTwoTailedP(t, df) };
}

/** Cohen's d with the pooled SD convention (Cohen 1988). Null when degenerate. */
export function cohensD(a: number[], b: number[]): number | null {
  const xs = a.filter((v) => Number.isFinite(v));
  const ys = b.filter((v) => Number.isFinite(v));
  const n1 = xs.length;
  const n2 = ys.length;
  if (n1 < 2 || n2 < 2) return null;
  const m1 = xs.reduce((s, v) => s + v, 0) / n1;
  const m2 = ys.reduce((s, v) => s + v, 0) / n2;
  const v1 = xs.reduce((s, v) => s + (v - m1) ** 2, 0) / (n1 - 1);
  const v2 = ys.reduce((s, v) => s + (v - m2) ** 2, 0) / (n2 - 1);
  const sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
  return sp > 0 ? (m1 - m2) / sp : null;
}

// ---- outlier screen -------------------------------------------------------------------------

export interface OutlierScreen {
  kept: number[];
  removed: number[];
}

/**
 * Standard RT screen: drop non-finite values and anything outside the
 * inclusive [minMs, maxMs] window (defaults 100 / 2000 ms).
 */
export function filterOutliers(rts: number[], minMs = 100, maxMs = 2000): OutlierScreen {
  const kept: number[] = [];
  const removed: number[] = [];
  for (const rt of rts) {
    if (Number.isFinite(rt) && rt >= minMs && rt <= maxMs) kept.push(rt);
    else removed.push(rt);
  }
  return { kept, removed };
}

// ---- data parsing ------------------------------------------------------------------------------

export interface RtGroup {
  name: string;
  rts: number[];
}

export interface RtDataset {
  groups: RtGroup[];
  /** Total parsed rows. */
  n: number;
}

/**
 * Parse an RT dataset from CSV/TSV/TXT text. Accepted mainstream formats:
 *  - header `condition,rt` (names matched case-insensitively; `rt`/`reaction`
 *    accepted for the RT column) with arbitrary column order;
 *  - headerless two-column rows (column 1 = condition label, column 2 = RT);
 *  - single-column RT lists (one implicit group "RT").
 * `#`-comment lines are skipped; non-finite RTs are dropped. Returns null
 * when nothing usable is found.
 */
export function parseRtData(text: string): RtDataset | null {
  const trim = text.trim();
  if (!trim) return null;
  const lines = trim.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  if (lines.length === 0) return null;
  const split = (l: string) => l.split(/[,\t;\s]+/).filter((c) => c.length > 0);

  const firstCells = split(lines[0]!);
  const allNumeric = firstCells.length > 0 && firstCells.every((c) => Number.isFinite(Number(c)));
  let condCol = 0;
  let rtCol = firstCells.length >= 2 ? 1 : 0;
  let startRow = 0;
  if (!allNumeric && firstCells.length >= 1) {
    startRow = 1;
    for (let j = 0; j < firstCells.length; j += 1) {
      const name = firstCells[j]!.toLowerCase();
      if (name.includes('cond')) condCol = j;
      if (name === 'rt' || name.includes('reaction') || name === 'ms') rtCol = j;
    }
  }

  const byName = new Map<string, number[]>();
  let n = 0;
  for (let i = startRow; i < lines.length; i += 1) {
    const cells = split(lines[i]!);
    const rt = Number(cells[rtCol]);
    if (!Number.isFinite(rt) || cells.length === 0) continue;
    const name = startRow === 0 && cells.length === 1 ? 'RT' : (cells[condCol] ?? 'RT');
    const list = byName.get(name) ?? [];
    list.push(rt);
    byName.set(name, list);
    n += 1;
  }
  if (n === 0) return null;
  return { groups: [...byName.entries()].map(([name, rts]) => ({ name, rts })), n };
}

// ---- embedded validation benchmark -------------------------------------------------------------

export const RT_BENCHMARK = {
  id: 'psych-rt-benchmark',
  /** Exact Welch t for [1,2,3,4] vs [5,6,7,8]: −4·√(6/5). */
  manualT: -4.381780460041329,
  /** Published t_{0.975,6} table value. */
  tQ6: 2.446911846,
} as const;

export interface RtBenchmark {
  manualT: number;
  manualTErr: number;
  manualDf: number;
  manualP: number;
  /** |p(t = 2.447, df = 6) − 0.05| — the classic critical-value check. */
  pCriticalErr: number;
  tQ6: number;
  tQ6Err: number;
  ciSelfConsistent: boolean;
  outlierKept: number[];
  outlierRemoved: number[];
  pass: boolean;
}

/**
 * Run the four embedded benchmarks (uniform error metric
 * |computed - analytic| / |analytic|):
 *  (1) Welch t on [1,2,3,4] vs [5,6,7,8] vs the exact hand value −4√(6/5) (< 1e-9);
 *  (2) p(t = 2.447, df = 6) ≈ 0.05 (< 1e-3);
 *  (3) CI construction self-consistency (mean ± t_{0.975,df}·SEM, symmetric);
 *  (4) outlier screen keeps [250, 300] and removes [50, 5000, 90] (90 < 100 ms).
 */
export function runRtBenchmark(): RtBenchmark {
  const w = welchTest([1, 2, 3, 4], [5, 6, 7, 8])!;
  const manualTErr = Math.abs(w.t - RT_BENCHMARK.manualT) / Math.abs(RT_BENCHMARK.manualT);
  const pCriticalErr = Math.abs(tTwoTailedP(2.447, 6) - 0.05);
  const tQ6 = tQuantile(0.975, 6);
  const tQ6Err = Math.abs(tQ6 - RT_BENCHMARK.tQ6);
  const s = summarize([2, 4, 4, 4, 5, 5, 7, 9])!;
  const ciSelfConsistent =
    Math.abs(s.mean - 5) < 1e-12 &&
    Math.abs(s.sd - Math.sqrt(32 / 7)) < 1e-12 && // sample SD (ddof = 1)
    Math.abs(s.ciLo - s.mean + s.ciHalf) < 1e-9 &&
    Math.abs(s.ciHi - s.mean - s.ciHalf) < 1e-9 &&
    Math.abs(s.median - 4.5) < 1e-12;
  const screen = filterOutliers([50, 250, 300, 5000, 90], 100, 2000);
  const outlierOk =
    screen.kept.length === 2 && screen.removed.length === 3 &&
    screen.kept.join(',') === '250,300' && screen.removed.join(',') === '50,5000,90';
  return {
    manualT: w.t,
    manualTErr,
    manualDf: w.df,
    manualP: w.p,
    pCriticalErr,
    tQ6,
    tQ6Err,
    ciSelfConsistent: ciSelfConsistent && tQ6Err < 1e-6,
    outlierKept: screen.kept,
    outlierRemoved: screen.removed,
    pass: manualTErr < 1e-9 && Math.abs(w.df - 6) < 1e-9 && pCriticalErr < 1e-3 && tQ6Err < 1e-6 && ciSelfConsistent && outlierOk,
  };
}
