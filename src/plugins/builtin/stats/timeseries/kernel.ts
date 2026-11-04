// ==========================================================================
// timeseries — ARIMA / GARCH, decomposition, unit-root and causality kernel
//
// Pure TypeScript implementations of the workhorses of applied time-series
// analysis: ACF / PACF, additive & multiplicative seasonal decomposition,
// ADF / KPSS / Phillips-Perron unit-root tests, conditional-sum-of-squares
// ARMA (order selected by AIC), GARCH(1,1) by maximum likelihood, forecasting
// with confidence bands and the Granger causality F-test.
// ==========================================================================

import { fCdf, normalInv } from '@/core/stats/special';
import {
  fmt,
  mean,
  parseTable,
  variance,
} from '../../shared/stats-utils';

export interface SeriesData {
  time: number[];
  values: number[];
  /** Optional second series for Granger causality. */
  aux: number[] | null;
  valueName: string;
}

export interface AcfPoint {
  lag: number;
  value: number;
}

export interface Decomposition {
  trend: number[];
  seasonal: number[];
  resid: number[];
  seasonalIndex: number[];
  period: number;
  mode: 'additive' | 'multiplicative';
}

export interface UnitRootTest {
  id: 'adf' | 'kpss' | 'pp';
  statistic: number;
  p: number;
  /** 5 % critical value (reject stationarity for KPSS / non-stationarity for ADF/PP). */
  critical5: number;
  stationary: boolean;
  lags: number;
  detail: string;
}

export interface ArimaModel {
  p: number;
  d: number;
  q: number;
  ar: number[];
  ma: number[];
  intercept: number;
  sigma2: number;
  aic: number;
  bic: number;
  n: number;
  /** Differenced series actually modelled. */
  work: number[];
}

export interface ForecastPoint {
  step: number;
  mean: number;
  lo: number;
  hi: number;
}

export interface GarchFit {
  omega: number;
  alpha: number;
  beta: number;
  persistence: number;
  unconditionalVol: number;
  logLik: number;
  forecastVol: number[];
  returns: number[];
}

export interface GrangerResult {
  lag: number;
  f: number;
  p: number;
  /** Whether x helps predict y beyond y's own lags. */
  causes: boolean;
}

const VALUE_NAMES = ['value', 'y', 'series', 'obs', 'level', 'close', 'price'];
const TIME_NAMES = ['time', 't', 'date', 'timestamp', 'period'];

/** Parse a `time,value[,aux]` table; a single numeric column is accepted. */
export function parseSeries(text: string): SeriesData {
  const table = parseTable(text);
  if (table.header.length === 0) return { time: [], values: [], aux: null, valueName: 'value' };
  const lower = table.header.map((h) => h.toLowerCase());
  let timeIdx = lower.findIndex((h) => TIME_NAMES.includes(h));
  let valueIdx = lower.findIndex((h) => VALUE_NAMES.includes(h));
  const numeric = table.header
    .map((_, i) => i)
    .filter((i) => table.rows.some((r) => Number.isFinite(Number(r[i]))));
  if (timeIdx < 0) timeIdx = numeric[0] ?? 0;
  if (valueIdx < 0) valueIdx = numeric.find((i) => i !== timeIdx) ?? timeIdx;
  const auxIdx = numeric.find((i) => i !== timeIdx && i !== valueIdx);
  const time: number[] = [];
  const values: number[] = [];
  const aux: number[] = [];
  table.rows.forEach((row, i) => {
    const v = Number(row[valueIdx]);
    if (!Number.isFinite(v)) return;
    const t = Number(row[timeIdx]);
    time.push(Number.isFinite(t) ? t : i);
    values.push(v);
    if (auxIdx !== undefined) {
      const a = Number(row[auxIdx]);
      aux.push(Number.isFinite(a) ? a : NaN);
    }
  });
  return {
    time,
    values,
    aux: auxIdx !== undefined && aux.every((v) => Number.isFinite(v)) ? aux : null,
    valueName: table.header[valueIdx] ?? 'value',
  };
}

/** Sample autocorrelation up to `maxLag` (lag 0 = 1). */
export function acf(x: number[], maxLag: number): AcfPoint[] {
  const n = x.length;
  if (n < 2) return [];
  const m = mean(x);
  let denom = 0;
  for (const v of x) denom += (v - m) ** 2;
  const out: AcfPoint[] = [];
  const top = Math.min(maxLag, n - 1);
  for (let lag = 0; lag <= top; lag += 1) {
    let num = 0;
    for (let t = lag; t < n; t += 1) num += (x[t]! - m) * (x[t - lag]! - m);
    out.push({ lag, value: denom === 0 ? 0 : num / denom });
  }
  return out;
}

/** Partial autocorrelation via the Durbin-Levinson recursion. */
export function pacf(x: number[], maxLag: number): AcfPoint[] {
  const r = acf(x, maxLag).map((p) => p.value);
  const out: AcfPoint[] = [{ lag: 0, value: 1 }];
  if (r.length < 2) return out;
  const phi: number[][] = [[]];
  for (let k = 1; k < r.length; k += 1) {
    const prev = phi[k - 1] ?? [];
    let num = r[k]!;
    for (let j = 1; j < k; j += 1) num -= (prev[j] ?? 0) * r[k - j]!;
    let den = 1;
    for (let j = 1; j < k; j += 1) den -= (prev[j] ?? 0) * r[j]!;
    const kk = Math.abs(den) < 1e-12 ? 0 : num / den;
    const row = new Array<number>(k + 1).fill(0);
    row[k] = kk;
    for (let j = 1; j < k; j += 1) row[j] = (prev[j] ?? 0) - kk * (prev[k - j] ?? 0);
    phi.push(row);
    out.push({ lag: k, value: kk });
  }
  return out;
}

/** Classical additive / multiplicative decomposition by moving averages. */
export function seasonalDecompose(x: number[], period: number, mode: 'additive' | 'multiplicative'): Decomposition {
  const n = x.length;
  const p = Math.max(2, Math.round(period));
  const trend = new Array<number>(n).fill(NaN);
  const half = Math.floor(p / 2);
  if (p % 2 === 0) {
    // Even period: a centred 2×p moving average has half weights at both ends,
    // so the window is [t−p/2, t+p/2] (p+1 points) and is centred on t.
    for (let t = 0; t < n; t += 1) {
      if (t - half < 0 || t + half >= n) continue;
      let s = 0.5 * x[t - half]! + 0.5 * x[t + half]!;
      for (let k = -half + 1; k < half; k += 1) s += x[t + k]!;
      trend[t] = s / p;
    }
  } else {
    for (let t = 0; t < n; t += 1) {
      if (t - half < 0 || t + (p - half) > n) continue;
      let s = 0;
      for (let k = 0; k < p; k += 1) s += x[t - half + k]!;
      trend[t] = s / p;
    }
  }
  const sums = new Array<number>(p).fill(0);
  const counts = new Array<number>(p).fill(0);
  for (let t = 0; t < n; t += 1) {
    const tr = trend[t];
    if (tr === undefined || !Number.isFinite(tr)) continue;
    const idx = ((t % p) + p) % p;
    sums[idx]! += mode === 'multiplicative' ? x[t]! / (tr === 0 ? 1 : tr) : x[t]! - tr;
    counts[idx]! += 1;
  }
  const seasonalIndex = sums.map((s, i) => (counts[i] ? s / counts[i]! : mode === 'multiplicative' ? 1 : 0));
  if (mode === 'additive') {
    const m = mean(seasonalIndex);
    for (let i = 0; i < p; i += 1) seasonalIndex[i]! -= m;
  } else {
    const m = mean(seasonalIndex);
    for (let i = 0; i < p; i += 1) seasonalIndex[i]! /= m || 1;
  }
  const seasonal = x.map((_, t) => seasonalIndex[((t % p) + p) % p]!);
  const resid = x.map((v, t) => {
    const tr = trend[t];
    if (tr === undefined || !Number.isFinite(tr)) return NaN;
    return mode === 'multiplicative' ? v / ((tr * seasonal[t]!) || 1) : v - tr - seasonal[t]!;
  });
  return { trend, seasonal, resid, seasonalIndex, period: p, mode };
}

/** OLS helper returning coefficients, residuals and the covariance matrix. */
function ols(y: number[], x: number[][]): { beta: number[]; resid: number[]; cov: number[][]; sse: number } | null {
  const n = y.length;
  const p = x[0]?.length ?? 0;
  if (n <= p) return null;
  const xtx = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const xty = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let a = 0; a < p; a += 1) {
      xty[a]! += x[i]![a]! * y[i]!;
      for (let b = 0; b < p; b += 1) xtx[a]![b]! += x[i]![a]! * x[i]![b]!;
    }
  }
  const inv = invertSmall(xtx);
  if (!inv) return null;
  const beta = inv.map((row) => row.reduce((s, v, j) => s + v * xty[j]!, 0));
  const resid = y.map((v, i) => v - x[i]!.reduce((s, xv, j) => s + xv * beta[j]!, 0));
  const sse = resid.reduce((s, r) => s + r * r, 0);
  const s2 = sse / Math.max(1, n - p);
  return { beta, resid, cov: inv.map((row) => row.map((v) => v * s2)), sse };
}

function invertSmall(a: number[][]): number[][] | null {
  const n = a.length;
  const aug = a.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(aug[r]![col]!) > Math.abs(aug[pivot]![col]!)) pivot = r;
    if (Math.abs(aug[pivot]![col]!) < 1e-12) return null;
    if (pivot !== col) [aug[pivot], aug[col]] = [aug[col]!, aug[pivot]!];
    const pv = aug[col]![col]!;
    for (let j = 0; j < 2 * n; j += 1) aug[col]![j]! /= pv;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = aug[r]![col]!;
      for (let j = 0; j < 2 * n; j += 1) aug[r]![j]! -= f * aug[col]![j]!;
    }
  }
  return aug.map((r) => r.slice(n));
}

function diff(x: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < x.length; i += 1) out.push(x[i]! - x[i - 1]!);
  return out;
}

function difference(x: number[], d: number): number[] {
  let cur = x;
  for (let i = 0; i < d; i += 1) cur = diff(cur);
  return cur;
}

/** Augmented Dickey-Fuller test (constant, no trend). */
/**
 * Approximate Dickey–Fuller τ p-value (constant, no trend) by monotone
 * interpolation of the standard asymptotic quantiles. A normal tail is badly
 * miscalibrated for this non-standard distribution.
 */
function dfPValue(stat: number): number {
  const q: Array<[number, number]> = [
    [-3.43, 0.01],
    [-3.12, 0.025],
    [-2.86, 0.05],
    [-2.57, 0.1],
    [-1.57, 0.5],
    [-0.44, 0.9],
    [-0.08, 0.95],
    [0.24, 0.975],
    [0.6, 0.99],
  ];
  if (!Number.isFinite(stat)) return NaN;
  if (stat <= q[0]![0]) return 0.01;
  if (stat >= q[q.length - 1]![0]) return 0.99;
  for (let i = 0; i + 1 < q.length; i += 1) {
    const a = q[i]!;
    const b = q[i + 1]!;
    if (stat >= a[0] && stat <= b[0]) {
      const f = (stat - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * f;
    }
  }
  return 0.5;
}

/** KPSS level-test p-value from the asymptotic quantile table. */
function kpssPValue(stat: number): number {
  const q: Array<[number, number]> = [
    [0.347, 0.1],
    [0.463, 0.05],
    [0.574, 0.025],
    [0.739, 0.01],
  ];
  if (!Number.isFinite(stat)) return NaN;
  if (stat <= q[0]![0]) return 1;
  if (stat >= q[q.length - 1]![0]) return 0.001;
  for (let i = 0; i + 1 < q.length; i += 1) {
    const a = q[i]!;
    const b = q[i + 1]!;
    if (stat >= a[0] && stat <= b[0]) {
      const f = (stat - a[0]) / (b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * f;
    }
  }
  return 0.05;
}

export function adfTest(x: number[], maxLag = 1): UnitRootTest {
  const n = x.length;
  if (n < 8) return { id: 'adf', statistic: NaN, p: NaN, critical5: -2.86, stationary: false, lags: 0, detail: 'not enough observations' };
  const lag = Math.max(0, Math.min(maxLag, Math.floor(Math.sqrt(n))));
  const dy = diff(x);
  const y: number[] = [];
  const design: number[][] = [];
  for (let t = lag; t < dy.length; t += 1) {
    y.push(dy[t]!);
    const row = [1, x[t]!];
    for (let k = 1; k <= lag; k += 1) row.push(dy[t - k]!);
    design.push(row);
  }
  const fit = ols(y, design);
  if (!fit) return { id: 'adf', statistic: NaN, p: NaN, critical5: -2.86, stationary: false, lags: lag, detail: 'singular regression' };
  const gamma = fit.beta[1]!;
  const se = Math.sqrt(Math.max(1e-30, fit.cov[1]?.[1] ?? 0));
  const stat = gamma / se;
  const p = dfPValue(stat);
  return {
    id: 'adf',
    statistic: stat,
    p,
    critical5: -2.86,
    stationary: stat < -2.86,
    lags: lag,
    detail: `ADF regression with ${lag} lag(s); γ=${fmt(gamma, 5)}, t=${fmt(stat, 4)}`,
  };
}

/** KPSS level-stationarity test (constant only). */
export function kpssTest(x: number[]): UnitRootTest {
  const n = x.length;
  if (n < 6) return { id: 'kpss', statistic: NaN, p: NaN, critical5: 0.463, stationary: false, lags: 0, detail: 'not enough observations' };
  const m = mean(x);
  const resid = x.map((v) => v - m);
  const s: number[] = [];
  let acc = 0;
  for (const r of resid) {
    acc += r;
    s.push(acc);
  }
  const lags = Math.max(1, Math.floor(4 * Math.pow(n / 100, 0.25)));
  let lrv = resid.reduce((a, r) => a + r * r, 0) / n;
  for (let l = 1; l <= lags; l += 1) {
    let cov = 0;
    for (let t = l; t < n; t += 1) cov += resid[t]! * resid[t - l]!;
    cov /= n;
    const w = 1 - l / (lags + 1);
    lrv += 2 * w * cov;
  }
  const stat = s.reduce((a, v) => a + v * v, 0) / (n * n * Math.max(1e-30, lrv));
  // Approximate KPSS asymptotic p-value (calibrated: p(0.463) = 0.05).
  const p = kpssPValue(stat);
  return {
    id: 'kpss',
    statistic: stat,
    p,
    critical5: 0.463,
    stationary: stat < 0.463,
    lags,
    detail: `KPSS level test, Bartlett lags=${lags}`,
  };
}

/** Phillips-Perron test (constant, Newey-West corrected t on ρ). */
export function ppTest(x: number[], lags?: number): UnitRootTest {
  const n = x.length;
  if (n < 8) return { id: 'pp', statistic: NaN, p: NaN, critical5: -2.86, stationary: false, lags: 0, detail: 'not enough observations' };
  const y = x.slice(1);
  const design = x.slice(0, n - 1).map((v) => [1, v]);
  const fit = ols(y, design);
  if (!fit) return { id: 'pp', statistic: NaN, p: NaN, critical5: -2.86, stationary: false, lags: 0, detail: 'singular regression' };
  const rho = fit.beta[1]!;
  const se = Math.sqrt(Math.max(1e-30, fit.cov[1]?.[1] ?? 0));
  const L = lags ?? Math.max(1, Math.floor(4 * Math.pow(n / 100, 0.25)));
  let lrv = fit.resid.reduce((a, r) => a + r * r, 0) / n;
  for (let l = 1; l <= L; l += 1) {
    let cov = 0;
    for (let t = l; t < n - 1; t += 1) cov += fit.resid[t]! * fit.resid[t - l]!;
    cov /= n;
    lrv += 2 * (1 - l / (L + 1)) * cov;
  }
  const s2 = fit.sse / n;
  const tRho = (rho - 1) / se;
  const stat =
    Math.sqrt(s2 / Math.max(1e-30, lrv)) * tRho -
    ((lrv - s2) * (n * se)) / Math.max(1e-30, 2 * s2 * Math.sqrt(lrv));
  return {
    id: 'pp',
    statistic: stat,
    p: dfPValue(stat),
    critical5: -2.86,
    stationary: stat < -2.86,
    lags: L,
    detail: `Phillips-Perron with Newey-West lags=${L}`,
  };
}

interface ArmaCss {
  ar: number[];
  ma: number[];
  intercept: number;
  sse: number;
  sigma2: number;
}

function armaCss(x: number[], p: number, q: number): ArmaCss {
  const n = x.length;
  const intercept = mean(x);
  const params = new Array<number>(p + q).fill(0);
  const evaluate = (theta: number[]): number => {
    const ar = theta.slice(0, p);
    const ma = theta.slice(p);
    const eps = new Array<number>(n).fill(0);
    let sse = 0;
    let count = 0;
    for (let t = p; t < n; t += 1) {
      let pred = intercept;
      for (let i = 0; i < p; i += 1) pred += ar[i]! * (x[t - i - 1]! - intercept);
      for (let j = 0; j < q; j += 1) pred += ma[j]! * eps[t - j - 1]!;
      const e = x[t]! - pred;
      eps[t] = e;
      sse += e * e;
      count += 1;
    }
    return sse / Math.max(1, count);
  };
  let best = evaluate(params);
  let step = 0.25;
  for (let iter = 0; iter < 400; iter += 1) {
    let improved = false;
    for (let j = 0; j < params.length; j += 1) {
      for (const dir of [1, -1]) {
        const trial = [...params];
        trial[j] = Math.max(-1.5, Math.min(1.5, trial[j]! + dir * step));
        const value = evaluate(trial);
        if (value < best - 1e-12) {
          params[j] = trial[j]!;
          best = value;
          improved = true;
        }
      }
    }
    if (!improved) step *= 0.5;
    if (step < 1e-5) break;
  }
  return {
    ar: params.slice(0, p),
    ma: params.slice(p),
    intercept,
    sse: best * Math.max(1, n - p),
    sigma2: best,
  };
}

/** Fit ARIMA(p,d,q); when `p`/`q` are omitted an AIC search over 0..2 is run. */
export function fitArima(
  values: number[],
  opts: { p?: number; d?: number; q?: number; maxP?: number; maxQ?: number } = {},
): ArimaModel | null {
  if (values.length < 8) return null;
  const adf = adfTest(values, 1);
  const d = opts.d ?? (adf.stationary ? 0 : 1);
  const work = difference(values, Math.max(0, d));
  if (work.length < 6) return null;
  const candidates: Array<{ p: number; q: number }> = [];
  if (opts.p !== undefined && opts.q !== undefined) candidates.push({ p: opts.p, q: opts.q });
  else {
    const maxP = opts.maxP ?? 2;
    const maxQ = opts.maxQ ?? 1;
    for (let p = 0; p <= maxP; p += 1) for (let q = 0; q <= maxQ; q += 1) candidates.push({ p, q });
  }
  let best: ArimaModel | null = null;
  for (const { p, q } of candidates) {
    const fit = armaCss(work, p, q);
    const k = p + q + 2;
    const aic = work.length * Math.log(Math.max(1e-30, fit.sigma2)) + 2 * k;
    const bic = work.length * Math.log(Math.max(1e-30, fit.sigma2)) + k * Math.log(work.length);
    if (!best || aic < best.aic) {
      best = { p, d: Math.max(0, d), q, ar: fit.ar, ma: fit.ma, intercept: fit.intercept, sigma2: fit.sigma2, aic, bic, n: work.length, work };
    }
  }
  return best;
}

/** Forecast an ARIMA model with normal confidence bands (MA terms damp to 0). */
export function forecastArima(model: ArimaModel, horizon = 12, conf = 0.95): ForecastPoint[] {
  const z = normalInv(1 - (1 - conf) / 2);
  const hist = [...model.work];
  const eps = new Array<number>(hist.length).fill(0);
  // Recompute residuals so the MA part starts from a consistent state.
  for (let t = model.p; t < hist.length; t += 1) {
    let pred = model.intercept;
    for (let i = 0; i < model.p; i += 1) pred += model.ar[i]! * (hist[t - i - 1]! - model.intercept);
    for (let j = 0; j < model.q; j += 1) pred += model.ma[j]! * eps[t - j - 1]!;
    eps[t] = hist[t]! - pred;
  }
  const out: ForecastPoint[] = [];
  // ψ-weights of the MA(∞) representation: Var(e_{t+h}) = σ² Σ_{j=0}^{h-1} ψ_j².
  const psi = new Array<number>(horizon).fill(0);
  psi[0] = 1;
  for (let j = 1; j < horizon; j += 1) {
    let v = j - 1 < model.q ? model.ma[j - 1]! : 0;
    for (let i = 1; i <= Math.min(model.p, j); i += 1) v += model.ar[i - 1]! * psi[j - i]!;
    psi[j] = v;
  }
  for (let h = 1; h <= horizon; h += 1) {
    const idx = hist.length - 1 + h;
    let pred = model.intercept;
    for (let i = 0; i < model.p; i += 1) {
      const j = idx - i - 1;
      const v = j < hist.length ? hist[j]! : out[j - hist.length]?.mean;
      if (v !== undefined) pred += model.ar[i]! * (v - model.intercept);
    }
    for (let j = 0; j < model.q; j += 1) {
      const e = idx - j - 1 < eps.length ? eps[idx - j - 1] ?? 0 : 0;
      pred += model.ma[j]! * e;
    }
    hist.push(pred);
    let psiSq = 0;
    for (let j = 0; j < h; j += 1) psiSq += psi[j]! * psi[j]!;
    const varH = Math.max(1e-30, model.sigma2 * psiSq);
    out.push({ step: h, mean: pred, lo: pred - z * Math.sqrt(varH), hi: pred + z * Math.sqrt(varH) });
  }
  return out;
}

/** GARCH(1,1) maximum-likelihood fit on returns (or first differences). */
export function fitGarch11(values: number[]): GarchFit | null {
  const returns = diff(values);
  if (returns.length < 12) return null;
  const m = mean(returns);
  const r = returns.map((v) => v - m);
  const varianceR = variance(r, false);
  const objective = (omega: number, alpha: number, beta: number): number => {
    if (omega <= 0 || alpha < 0 || beta < 0 || alpha + beta >= 0.999) return Infinity;
    let h = Math.max(1e-12, varianceR);
    let ll = 0;
    for (const v of r) {
      // σ_t² is formed from r_{t−1}; the likelihood term is for r_t.
      ll += Math.log(h) + (v * v) / h;
      h = omega + alpha * v * v + beta * h;
    }
    return ll;
  };
  let omega = Math.max(1e-8, varianceR * 0.05);
  let alpha = 0.08;
  let beta = 0.9;
  let best = objective(omega, alpha, beta);
  let step = 0.2;
  for (let iter = 0; iter < 500; iter += 1) {
    let improved = false;
    const moves: Array<[number, number, number]> = [
      [omega, alpha, beta],
      [Math.max(1e-10, omega * (1 + step)), alpha, beta],
      [Math.max(1e-10, omega * (1 - step)), alpha, beta],
      [omega, Math.max(0, Math.min(0.5, alpha + step * 0.1)), beta],
      [omega, Math.max(0, Math.min(0.5, alpha - step * 0.1)), beta],
      [omega, alpha, Math.max(0, Math.min(0.99, beta + step * 0.1))],
      [omega, alpha, Math.max(0, Math.min(0.99, beta - step * 0.1))],
    ];
    for (const [no, na, nb] of moves) {
      const value = objective(no, na, nb);
      if (value < best - 1e-9) {
        omega = no;
        alpha = na;
        beta = nb;
        best = value;
        improved = true;
      }
    }
    if (!improved) step *= 0.5;
    if (step < 1e-6) break;
  }
  let h = Math.max(1e-12, varianceR);
  for (const v of r) h = omega + alpha * v * v + beta * h;
  const forecastVol: number[] = [];
  let fh = h;
  for (let i = 0; i < 12; i += 1) {
    forecastVol.push(Math.sqrt(fh));
    fh = omega + (alpha + beta) * fh;
  }
  const persistence = alpha + beta;
  const unconditionalVol = persistence < 1 ? Math.sqrt(omega / (1 - persistence)) : Infinity;
  const logLik = -0.5 * (best + r.length * Math.log(2 * Math.PI));
  return { omega, alpha, beta, persistence, unconditionalVol, logLik, forecastVol, returns };
}

/** Granger causality F-test of x → y over lags 1..maxLag. */
export function grangerCausality(y: number[], x: number[], maxLag = 4): GrangerResult[] {
  const n = Math.min(y.length, x.length);
  const out: GrangerResult[] = [];
  for (let lag = 1; lag <= Math.min(maxLag, Math.floor(n / 4)); lag += 1) {
    const rows: number[] = [];
    for (let t = lag; t < n; t += 1) rows.push(t);
    const yy = rows.map((t) => y[t]!);
    const restricted = rows.map((t) => {
      const row = [1];
      for (let k = 1; k <= lag; k += 1) row.push(y[t - k]!);
      return row;
    });
    const unrestricted = rows.map((t) => {
      const row = [1];
      for (let k = 1; k <= lag; k += 1) row.push(y[t - k]!);
      for (let k = 1; k <= lag; k += 1) row.push(x[t - k]!);
      return row;
    });
    const fr = ols(yy, restricted);
    const fu = ols(yy, unrestricted);
    if (!fr || !fu) continue;
    const df1 = lag;
    const df2 = yy.length - unrestricted[0]!.length;
    if (df2 <= 0) continue;
    const f = ((fr.sse - fu.sse) / df1) / (fu.sse / df2);
    const p = 1 - fCdf(f, df1, df2);
    out.push({ lag, f, p, causes: p < 0.05 });
  }
  return out;
}

export interface TimeSeriesBenchmark {
  id: string;
  passed: boolean;
  relErr: number;
  detail: string;
}

/** Deterministic AR(1) / random-walk validation scenarios. */
export function runTimeSeriesBenchmark(): TimeSeriesBenchmark[] {
  let seed = 20261029;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gauss = (): number => {
    const u = Math.max(1e-12, rand());
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const ar: number[] = [0];
  for (let t = 1; t < 400; t += 1) ar.push(0.7 * ar[t - 1]! + gauss());
  const model = fitArima(ar, { p: 1, q: 0, d: 0 });
  const arErr = model ? Math.abs(model.ar[0]! - 0.7) : Infinity;
  const adfStationary = adfTest(ar, 1);
  const walk: number[] = [0];
  for (let t = 1; t < 400; t += 1) walk.push(walk[t - 1]! + gauss());
  const adfWalk = adfTest(walk, 1);
  const decomp = seasonalDecompose(
    Array.from({ length: 96 }, (_, t) => 10 + 0.05 * t + 3 * Math.sin((2 * Math.PI * t) / 12)),
    12,
    'additive',
  );
  const seasonalErr = Math.max(...decomp.seasonalIndex.map((v, i) => Math.abs(v - 3 * Math.sin((2 * Math.PI * i) / 12))));
  return [
    {
      id: 'ar1-recovery',
      passed: arErr < 0.12,
      relErr: arErr,
      detail: `AR(1) coefficient recovered as ${fmt(model?.ar[0] ?? NaN, 4)} vs truth 0.7 (seeded, n=400)`,
    },
    {
      id: 'adf-stationarity',
      passed: adfStationary.stationary && !adfWalk.stationary,
      relErr: 0,
      detail: `ADF t=${fmt(adfStationary.statistic, 3)} on AR(1) (reject) and t=${fmt(adfWalk.statistic, 3)} on random walk (retain)`,
    },
    {
      id: 'seasonal-recovery',
      passed: seasonalErr < 0.05,
      relErr: seasonalErr,
      detail: `additive seasonal index max error ${fmt(seasonalErr, 4)} vs 3·sin(2πt/12)`,
    },
  ];
}
