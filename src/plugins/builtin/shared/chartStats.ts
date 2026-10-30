// ==========================================================================
// Ergalics Studio — shared statistical kernels for the chart plugin cluster
// (docs/technical/11-插件科研化整改方案.md §3 L3: "绘图 → 分析")
//
// Pure, deterministic numerics only — no Math.random(), no DOM. Every chart
// plugin imports from this module instead of copy-pasting formulas, so a
// metric (Pearson r, Kruskal-Wallis H, Silverman bandwidth…) is computed
// identically wherever it is published. Test p-values come from closed-form
// special functions (regularized incomplete beta / gamma), not lookup tables.
// Null is returned whenever a statistic is undefined for the input (too few
// points, zero variance) so callers can omit the metric instead of
// publishing NaN.
// ==========================================================================

import { fmtMetric } from '@/core/research/scienceOutput';

// ---- descriptive statistics ----------------------------------------------

export function meanOf(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** Sample variance (n-1 denominator); 0 when n < 2. */
export function varianceOf(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const m = meanOf(values);
  let ss = 0;
  for (const v of values) ss += (v - m) * (v - m);
  return ss / (n - 1);
}

export function sdOf(values: readonly number[]): number {
  return Math.sqrt(varianceOf(values));
}

export function minMaxOf(values: readonly number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** Quantile of an ascending-sorted array (linear interpolation, "type 7"). */
export function quantileSorted(sorted: readonly number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const idx = (n - 1) * Math.max(0, Math.min(1, p));
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! + frac * (sorted[hi]! - sorted[lo]!);
}

/** Fisher–Pearson standardized sample skewness (G1). NaN when undefined. */
export function skewnessOf(values: readonly number[]): number {
  const n = values.length;
  if (n < 3) return NaN;
  const m = meanOf(values);
  let m2 = 0;
  let m3 = 0;
  for (const v of values) {
    const d = v - m;
    m2 += d * d;
    m3 += d * d * d;
  }
  m2 /= n;
  m3 /= n;
  if (m2 <= 0) return NaN;
  const g1 = m3 / Math.pow(m2, 1.5);
  return (g1 * Math.sqrt(n * (n - 1))) / (n - 2);
}

/** Excess kurtosis (G2, normal ≡ 0). NaN when undefined. */
export function excessKurtosisOf(values: readonly number[]): number {
  const n = values.length;
  if (n < 4) return NaN;
  const m = meanOf(values);
  let m2 = 0;
  let m4 = 0;
  for (const v of values) {
    const d = v - m;
    m2 += d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m4 /= n;
  if (m2 <= 0) return NaN;
  const g2 = m4 / (m2 * m2) - 3;
  return (((n + 1) * g2 + 6) * (n - 1)) / ((n - 2) * (n - 3));
}

// ---- special functions -----------------------------------------------------

/** Abramowitz–Stegun 7.1.26 error function (|ε| ≤ 1.5e-7). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

export function normCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Acklam's rational approximation of the standard-normal quantile. */
export function normQuantile(p: number): number {
  if (!(p > 0 && p < 1)) return NaN;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  const q = p < plow
    ? Math.sqrt(-2 * Math.log(p))
    : p > 1 - plow
      ? Math.sqrt(-2 * Math.log(1 - p))
      : p - 0.5;
  let x: number;
  if (p < plow || p > 1 - plow) {
    const r = p < plow
      ? (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
        ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
      : -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
        ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
    x = r;
  } else {
    const r = q * q;
    x = (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  }
  return x;
}

/** Lanczos log-gamma (g=7, n=9 coefficients → ~15 significant digits). */
export function logGamma(x: number): number {
  if (x < 0.5) {
    // Reflection for stability on the small side.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const g = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const z = x - 1;
  let a = g[0]!;
  const t = z + 7.5;
  for (let i = 1; i < g.length; i += 1) a += g[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized lower incomplete gamma P(s, x) (series + continued fraction). */
export function gammaP(s: number, x: number): number {
  if (!(s > 0) || x <= 0) return 0;
  if (x < s + 1) {
    let term = 1 / s;
    let sum = term;
    for (let n = 1; n < 1000; n += 1) {
      term *= x / (s + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return sum * Math.exp(-x + s * Math.log(x) - logGamma(s));
  }
  const tiny = 1e-300;
  let b = x + 1 - s;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i += 1) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return 1 - Math.exp(-x + s * Math.log(x) - logGamma(s)) * h;
}

/** Upper-tail probability of χ²(x; df): 1 - P(df/2, x/2). */
export function chiSqSf(x: number, df: number): number {
  if (x <= 0) return 1;
  return Math.max(0, Math.min(1, 1 - gammaP(df / 2, x / 2)));
}

/** Regularized incomplete beta I_x(a, b) (continued fraction, NR §6.4). */
export function betaInc(a: number, b: number, x: number): number {
  if (!(a > 0) || !(b > 0)) return NaN;
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta = logGamma(a + b) - logGamma(a) - logGamma(b);
  const bt = Math.exp(lbeta + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betaCf(a, b, x)) / a;
  return 1 - (bt * betaCf(b, a, 1 - x)) / b;
}

function betaCf(a: number, b: number, x: number): number {
  const tiny = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < tiny) d = tiny;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 500; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < tiny) d = tiny;
    c = 1 + aa / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** Student-t CDF with `df` degrees of freedom. */
export function tCdf(t: number, df: number): number {
  if (!(df > 0)) return NaN;
  const x = df / (df + t * t);
  const half = 0.5 * betaInc(df / 2, 0.5, x);
  return t > 0 ? 1 - half : half;
}

/** Student-t quantile via bisection on the CDF (robust for any p ∈ (0,1)). */
export function tQuantile(p: number, df: number): number {
  if (!(p > 0 && p < 1) || !(df > 0)) return NaN;
  let lo = -2000;
  let hi = 2000;
  for (let i = 0; i < 120; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (tCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

// ---- correlation & regression ----------------------------------------------

export interface CorrResult {
  r: number;
  p: number;
  n: number;
}

/**
 * Pearson r with a two-sided p from the t approximation
 * t = r·sqrt((n-2)/(1-r²)). Null when n < 3 or either series has zero
 * variance (r undefined — callers omit the metric rather than publish NaN).
 */
export function pearson(x: readonly number[], y: readonly number[]): CorrResult | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = x[i]!;
    const b = y[i]!;
    sx += a;
    sy += b;
    sxx += a * a;
    syy += b * b;
    sxy += a * b;
  }
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 0 || vy <= 0) return null;
  const r = Math.max(-1, Math.min(1, (sxy - (sx * sy) / n) / Math.sqrt(vx * vy)));
  const rest = 1 - r * r;
  // Two-sided p from t = r·sqrt((n-2)/(1-r²)); r = ±1 ⇒ p = 0.
  const tStat = Math.abs(r) * Math.sqrt((n - 2) / rest);
  const p = rest <= 0 ? 0 : 2 * (1 - tCdf(tStat, n - 2));
  return { r, p, n };
}

/**
 * Spearman ρ = Pearson correlation of average ranks, two-sided p from the
 * same t approximation.
 */
export function spearman(x: readonly number[], y: readonly number[]): CorrResult | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  const rx = rankAverage(Array.from({ length: n }, (_, i) => x[i]!));
  const ry = rankAverage(Array.from({ length: n }, (_, i) => y[i]!));
  return pearson(rx, ry);
}

/** Average ranks with tie handling (1-based). */
export function rankAverage(values: readonly number[]): number[] {
  const n = values.length;
  const order = values.map((_, i) => i).sort((a, b) => values[a]! - values[b]!);
  const ranks = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]!] === values[order[i]!]) j += 1;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[order[k]!] = r;
    i = j + 1;
  }
  return ranks;
}

export interface OlsResult {
  slope: number;
  intercept: number;
  /** Standard error of the slope. */
  se: number;
  /** Two-sided 95% CI of the slope (t_{0.975, n-2}). */
  ci95: [number, number];
  n: number;
}

/** OLS y = a + b·x with slope SE and 95% CI. Null when x is degenerate. */
export function ols(x: readonly number[], y: readonly number[]): OlsResult | null {
  const n = Math.min(x.length, y.length);
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i += 1) {
    mx += x[i]!;
    my += y[i]!;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (x[i]! - mx) * (x[i]! - mx);
    sxy += (x[i]! - mx) * (y[i]! - my);
  }
  if (sxx <= 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let sse = 0;
  for (let i = 0; i < n; i += 1) {
    const d = y[i]! - (intercept + slope * x[i]!);
    sse += d * d;
  }
  const se = Math.sqrt(sse / (n - 2) / sxx);
  const tc = tQuantile(0.975, n - 2);
  return { slope, intercept, se, ci95: [slope - tc * se, slope + tc * se], n };
}

// ---- time series -------------------------------------------------------------

/** OLS linear trend of a series against t = 0..n-1, with slope p-value. */
export function olsTrend(values: readonly number[]): (OlsResult & { p: number }) | null {
  const n = values.length;
  if (n < 3) return null;
  const t = Array.from({ length: n }, (_, i) => i);
  const fit = ols(t, values);
  if (!fit) return null;
  const rest = fit.se > 0 ? Math.abs(fit.slope) / fit.se : Infinity;
  const p = fit.se > 0 ? 2 * (1 - tCdf(rest, n - 2)) : 0;
  return { ...fit, p };
}

export interface MannKendallResult {
  s: number;
  varS: number;
  z: number;
  p: number;
  n: number;
}

/**
 * Mann-Kendall trend test with tie-corrected variance and continuity
 * correction. O(n²) — callers should cap the input length. Null when n < 4
 * or the variance degenerates (e.g. all-equal values).
 */
export function mannKendall(values: readonly number[]): MannKendallResult | null {
  const n = values.length;
  if (n < 4) return null;
  let s = 0;
  for (let i = 0; i < n - 1; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const d = values[j]! - values[i]!;
      s += d > 0 ? 1 : d < 0 ? -1 : 0;
    }
  }
  const sorted = [...values].sort((a, b) => a - b);
  let tieTerm = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j += 1;
    const t = j - i + 1;
    if (t > 1) tieTerm += t * (t - 1) * (2 * t + 5);
    i = j + 1;
  }
  const varS = (n * (n - 1) * (2 * n + 5) - tieTerm) / 18;
  if (!(varS > 0)) return null;
  const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  return { s, varS, z, p, n };
}

/** Lag-1 autocorrelation (biased estimator). Null when variance is 0. */
export function lag1Autocorr(values: readonly number[]): number | null {
  const n = values.length;
  if (n < 3) return null;
  const m = meanOf(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i += 1) {
    const d = values[i]! - m;
    den += d * d;
    if (i + 1 < n) num += d * (values[i + 1]! - m);
  }
  if (den <= 0) return null;
  return num / den;
}

// ---- distribution shape / binning ---------------------------------------------

/** Sturges' rule: k = 1 + log2(n), minimum 2. */
export function sturgesK(n: number): number {
  return Math.max(2, Math.ceil(1 + Math.log2(Math.max(1, n))));
}

/** Freedman–Diaconis bin width 2·IQR/n^(1/3). Null when IQR = 0. */
export function freedmanDiaconisW(sorted: readonly number[]): number | null {
  const n = sorted.length;
  if (n < 2) return null;
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  if (!(iqr > 0)) return null;
  const w = (2 * iqr) / Math.cbrt(n);
  return w > 0 ? w : null;
}

/** Silverman bandwidth h = 0.9·min(sd, IQR/1.34)·n^(-1/5); 0 when degenerate. */
export function silvermanBw(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const sd = sdOf(values);
  const sorted = [...values].sort((a, b) => a - b);
  const iqr = quantileSorted(sorted, 0.75) - quantileSorted(sorted, 0.25);
  const scale = Math.min(sd, iqr / 1.34);
  const base = scale > 0 ? scale : sd;
  if (!(base > 0)) return 0;
  return 0.9 * base * Math.pow(n, -0.2);
}

/**
 * Filliben Q-Q correlation r_Q: Pearson correlation between the ascending
 * sample and the standard-normal Blom scores m_i = Φ⁻¹((i-0.375)/(n+0.25)).
 */
export function fillibenR(sorted: readonly number[]): number | null {
  const n = sorted.length;
  if (n < 3) return null;
  const scores: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) scores[i] = normQuantile((i + 1 - 0.375) / (n + 0.25));
  // pearson() already returns null on zero-variance input.
  const r = pearson(scores, sorted);
  return r ? r.r : null;
}

// ---- k-sample nonparametric test ------------------------------------------------

export interface KruskalWallisResult {
  h: number;
  df: number;
  p: number;
  n: number;
}

/**
 * Kruskal-Wallis H with tie correction, χ²(k-1) approximation. Null when
 * fewer than 2 non-empty groups.
 */
export function kruskalWallis(groups: readonly number[][]): KruskalWallisResult | null {
  const k = groups.length;
  let n = 0;
  for (const g of groups) n += g.length;
  if (k < 2 || n < 3 || groups.some((g) => g.length === 0)) return null;
  const all: number[] = [];
  for (const g of groups) {
    for (const v of g) all.push(v);
  }
  const ranks = rankAverage(all);
  const rankSums = new Array<number>(k).fill(0);
  let off = 0;
  for (let gi = 0; gi < k; gi += 1) {
    const len = groups[gi]!.length;
    for (let i = 0; i < len; i += 1) rankSums[gi]! += ranks[off + i]!;
    off += len;
  }
  let h = 0;
  for (let gi = 0; gi < k; gi += 1) h += (rankSums[gi]! * rankSums[gi]!) / groups[gi]!.length;
  h = (12 / (n * (n + 1))) * h - 3 * (n + 1);
  const sortedAll = [...all].sort((a, b) => a - b);
  let tieSum = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sortedAll[j + 1] === sortedAll[i]) j += 1;
    const t = j - i + 1;
    if (t > 1) tieSum += t * t * t - t;
    i = j + 1;
  }
  if (tieSum > 0) {
    const corr = 1 - tieSum / (n * n * n - n);
    if (corr > 0) h /= corr;
  }
  if (!(h >= 0)) return null;
  const df = k - 1;
  return { h, df, p: chiSqSf(h, df), n };
}

// ---- formatting / locale helpers --------------------------------------------------

/** `true` when the host locale is a Chinese variant. */
export function isZh(api: { locale: string }): boolean {
  return api.locale.startsWith('zh');
}

/** Bilingual one-liner: picks by `locale.startsWith('zh')`. */
export function bi(api: { locale: string }, en: string, zh: string): string {
  return isZh(api) ? zh : en;
}

/** Two-sided p formatted for the science strip; `<1e-4` below precision. */
export function fmtP(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p < 1e-4) return '<1e-4';
  return fmtMetric(p);
}

/** `value±half-width` composite for CI-style metrics. */
export function pm(v: number, half: number): string {
  if (!Number.isFinite(v) || !Number.isFinite(half)) return '—';
  return `${fmtMetric(v)}±${fmtMetric(half)}`;
}
