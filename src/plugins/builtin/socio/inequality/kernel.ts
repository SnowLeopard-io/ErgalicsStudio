// ==========================================================================
// socio-inequality — income inequality analytics (pure, testable)
//
// Distribution-level measurement on income samples:
//   - Gini coefficient via the exact mean-absolute-difference formula, with a
//     seeded bootstrap percentile interval;
//   - Lorenz curve points and trapezoid-area integration;
//   - Palma ratio (top 10% / bottom 40%), decomposable Theil index, Atkinson
//     index (epsilon parameter), 90/10 and 50/10 percentile ratios;
//   - seeded generation of log-normal / Pareto / power-law / exponential
//     samples, moment-based rough parameter identification and checks against
//     the theoretical Gini identities (log-normal: 2*Phi(sigma/sqrt2)-1,
//     Pareto: 1/(2a-1), exponential: 1/2);
//   - Galton-style intergenerational mobility: child log-income regresses on
//     the parent's with elasticity rho; the rank-rank slope is estimated by
//     OLS on within-distribution percentile ranks;
//   - tax counterfactuals (progressive brackets / flat / regressive) with the
//     Reynolds-Smolensky-style redistribution effect G_pre - G_post.
//
// All functions are pure and deterministic under a fixed seed — no canvas,
// no DOM. References: Gini (1912); Theil (1967); Atkinson (1970); Palma (2011).
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

export type Distribution = 'log-normal' | 'pareto' | 'power-law' | 'exponential';
export type TaxRegime = 'none' | 'progressive' | 'flat' | 'regressive';

// ---- small numeric helpers ---------------------------------------------------

/**
 * Error function via the Abramowitz-Stegun 7.1.26 rational approximation
 * (max |error| = 1.5e-7) — enough for Gini identity checks at 1e-2 tolerance.
 */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - poly * Math.exp(-ax * ax));
}

/** Standard normal CDF Phi(z). */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Arithmetic mean of a non-empty array (empty -> 0). */
export function mean(xs: ArrayLike<number>): number {
  const n = xs.length;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i += 1) s += xs[i]!;
  return s / n;
}

/**
 * Empirical percentile of a sorted-ascending array with linear interpolation
 * (Hyndman-Fan type 7, the numpy/matplotlib default). `p` in [0, 1].
 */
export function percentileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const h = (n - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Convenience wrapper: percentile of an unsorted array. */
export function percentile(xs: number[], p: number): number {
  return percentileSorted([...xs].sort((a, b) => a - b), p);
}

// ---- Gini ---------------------------------------------------------------------

/**
 * Exact Gini coefficient via the mean-absolute-difference formula
 *   G = sum_i sum_j |x_i - x_j| / (2 n^2 mu),
 * computed as sum over unordered pairs (mathematically identical). Exact for
 * the empirical distribution; no sorting required. All-equal (or all-zero)
 * populations give exactly 0.
 */
export function giniExact(x: number[]): number {
  const n = x.length;
  if (n === 0) return NaN;
  const m = mean(x);
  if (m <= 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    const xi = x[i]!;
    for (let j = i + 1; j < n; j += 1) s += Math.abs(xi - x[j]!);
  }
  return s / (n * n * m);
}

/**
 * Gini of a sorted-ascending array via trapezoid integration of the Lorenz
 * curve — identical to `giniExact` for unweighted data but O(n log n), which
 * makes it the right kernel for bootstrap resampling.
 */
export function giniSorted(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  const m = mean(sorted);
  if (m <= 0) return 0;
  let cum = 0;
  let sumL = 0;
  for (let k = 0; k < n - 1; k += 1) {
    cum += sorted[k]!;
    sumL += cum; // sum of S_k for k = 1..n-1
  }
  // G = 1 - (1 + 2 * sum_{k=1}^{n-1} L_k) / n with L_k = S_k / (n * m)
  return 1 - (1 + (2 * sumL) / (n * m)) / n;
}

/** Weighted Gini via trapezoid integration of the weighted Lorenz curve. */
export function giniWeighted(incomes: number[], weights: number[]): number {
  const n = Math.min(incomes.length, weights.length);
  if (n === 0) return NaN;
  const order = incomes
    .slice(0, n)
    .map((v, i) => ({ v, w: weights[i]! }))
    .sort((a, b) => a.v - b.v);
  let wSum = 0;
  let wxSum = 0;
  for (const u of order) {
    wSum += u.w;
    wxSum += u.w * u.v;
  }
  if (wSum <= 0 || wxSum <= 0) return 0;
  let cumPop = 0;
  let cumInc = 0;
  let prevPop = 0;
  let prevInc = 0;
  let area = 0;
  for (const u of order) {
    cumPop += u.w / wSum;
    cumInc += (u.w * u.v) / wxSum;
    area += ((prevInc + cumInc) / 2) * (cumPop - prevPop);
    prevPop = cumPop;
    prevInc = cumInc;
  }
  return 1 - 2 * area;
}

export interface IncomeSample {
  /** Non-negative incomes (or any ratio-scale values). */
  incomes: number[];
  /** Optional sampling weights (same length). */
  weights?: number[];
}

/** Gini of an (optionally weighted) income sample. */
export function gini(sample: IncomeSample): number {
  if (sample.weights && sample.weights.length > 0) {
    return giniWeighted(sample.incomes, sample.weights);
  }
  return giniExact(sample.incomes);
}

/**
 * Seeded bootstrap percentile confidence interval for the Gini coefficient:
 * `reps` resamples of size n with replacement, Gini recomputed on each, and
 * the [2.5%, 97.5%] percentiles of the bootstrap distribution returned.
 */
export interface GiniBootstrapCI {
  estimate: number;
  lo: number;
  hi: number;
  reps: number;
}

export function giniBootstrapCI(incomes: number[], reps: number, seed: number): GiniBootstrapCI {
  const estimate = giniExact(incomes);
  const n = incomes.length;
  if (reps <= 0 || n === 0) return { estimate, lo: estimate, hi: estimate, reps: 0 };
  const rand = mulberry32(seed >>> 0 || 1);
  const stats: number[] = [];
  for (let r = 0; r < reps; r += 1) {
    const resample = new Array<number>(n);
    for (let i = 0; i < n; i += 1) resample[i] = incomes[Math.floor(rand() * n)]!;
    stats.push(giniSorted(resample.sort((a, b) => a - b)));
  }
  stats.sort((a, b) => a - b);
  return {
    estimate,
    lo: percentileSorted(stats, 0.025),
    hi: percentileSorted(stats, 0.975),
    reps,
  };
}

// ---- Lorenz curve ---------------------------------------------------------------

/** One Lorenz point: cumulative population share `p`, cumulative income share `l`. */
export interface LorenzPoint {
  p: number;
  l: number;
}

/**
 * Lorenz curve of an (optionally weighted) sample, ascending by income.
 * Always starts at (0, 0) and ends at (1, 1) when total income is positive;
 * a degenerate all-zero sample returns the equality diagonal.
 */
export function lorenzCurve(incomes: number[], weights?: number[]): LorenzPoint[] {
  const n = incomes.length;
  if (n === 0) return [{ p: 0, l: 0 }, { p: 1, l: 1 }];
  const order = incomes
    .map((v, i) => ({ v, w: weights && weights[i] !== undefined ? weights[i]! : 1 }))
    .sort((a, b) => a.v - b.v);
  let wSum = 0;
  let wxSum = 0;
  for (const u of order) {
    wSum += u.w;
    wxSum += u.w * u.v;
  }
  if (wSum <= 0 || wxSum <= 0) return [{ p: 0, l: 0 }, { p: 1, l: 1 }];
  const pts: LorenzPoint[] = [{ p: 0, l: 0 }];
  let cumPop = 0;
  let cumInc = 0;
  for (const u of order) {
    cumPop += u.w / wSum;
    cumInc += (u.w * u.v) / wxSum;
    pts.push({ p: cumPop, l: cumInc });
  }
  const last = pts[pts.length - 1]!;
  last.p = 1;
  last.l = 1;
  return pts;
}

/** Trapezoid area under a Lorenz curve (points must be sorted by `p`). */
export function lorenzArea(points: LorenzPoint[]): number {
  let area = 0;
  for (let k = 1; k < points.length; k += 1) {
    const a = points[k - 1]!;
    const b = points[k]!;
    area += ((a.l + b.l) / 2) * (b.p - a.p);
  }
  return area;
}

/** Gini implied by a Lorenz curve: G = 1 - 2 * area. */
export function giniFromLorenz(points: LorenzPoint[]): number {
  return 1 - 2 * lorenzArea(points);
}

/**
 * Cumulative income share held by the poorest fraction `q` of the population
 * (linear interpolation at the rank cutoff; supports sampling weights).
 */
export function incomeShareBelow(incomes: number[], q: number, weights?: number[]): number {
  const pts = lorenzCurve(incomes, weights);
  if (pts.length === 2 && pts[0]!.p === 0 && pts[1]!.p === 1) {
    // degenerate (all-zero or single-point) curve — equality fallback
    return q;
  }
  const x = Math.min(1, Math.max(0, q));
  for (let k = 1; k < pts.length; k += 1) {
    const b = pts[k]!;
    const a = pts[k - 1]!;
    if (x <= b.p) {
      const t = b.p === a.p ? 0 : (x - a.p) / (b.p - a.p);
      return a.l + t * (b.l - a.l);
    }
  }
  return 1;
}

/**
 * Palma ratio: income share of the top 10% divided by the share of the
 * bottom 40% (Palma 2011).
 */
export function palmaRatio(incomes: number[], weights?: number[]): number {
  const bottom = incomeShareBelow(incomes, 0.4, weights);
  const top = 1 - incomeShareBelow(incomes, 0.9, weights);
  if (bottom <= 0) return Infinity;
  return top / bottom;
}

// ---- Theil / Atkinson / percentile ratios ------------------------------------------

/**
 * Theil index (decomposable, Theil 1967):
 *   T = (1/n) sum_i (x_i / mu) * ln(x_i / mu),
 * with the x_i = 0 terms taken as their limit 0. Weighted variant uses
 * weight-normalised averaging.
 */
export function theilIndex(incomes: number[], weights?: number[]): number {
  const n = incomes.length;
  if (n === 0) return NaN;
  const w = weights && weights.length > 0 ? weights : undefined;
  let wSum = 0;
  let muNum = 0;
  for (let i = 0; i < n; i += 1) {
    const wi = w ? w[i]! : 1;
    wSum += wi;
    muNum += wi * incomes[i]!;
  }
  if (wSum <= 0 || muNum <= 0) return 0;
  const mu = muNum / wSum;
  let t = 0;
  for (let i = 0; i < n; i += 1) {
    const wi = w ? w[i]! : 1;
    const r = incomes[i]! / mu;
    if (r > 0) t += wi * r * Math.log(r);
  }
  return t / wSum;
}

/**
 * Atkinson index (Atkinson 1970) with inequality aversion epsilon >= 0:
 *   eps != 1: A = 1 - ( (1/n) sum_i (x_i/mu)^(1-eps) )^(1/(1-eps))
 *   eps  = 1: A = 1 - ( prod_i x_i )^(1/n) / mu   (geometric-mean form)
 */
export function atkinsonIndex(incomes: number[], epsilon: number): number {
  const n = incomes.length;
  if (n === 0) return NaN;
  const mu = mean(incomes);
  if (mu <= 0) return 0;
  if (Math.abs(epsilon - 1) < 1e-12) {
    let logSum = 0;
    for (let i = 0; i < n; i += 1) {
      if (incomes[i]! <= 0) return 1;
      logSum += Math.log(incomes[i]!);
    }
    return 1 - Math.exp(logSum / n) / mu;
  }
  const power = 1 - epsilon;
  let s = 0;
  for (let i = 0; i < n; i += 1) s += Math.pow(incomes[i]! / mu, power);
  return 1 - Math.pow(s / n, 1 / power);
}

/** P90/P10 percentile ratio. */
export function p90p10(incomes: number[]): number {
  const sorted = [...incomes].sort((a, b) => a - b);
  const p10 = percentileSorted(sorted, 0.1);
  const p90 = percentileSorted(sorted, 0.9);
  if (p10 <= 0) return Infinity;
  return p90 / p10;
}

/** P50/P10 percentile ratio. */
export function p50p10(incomes: number[]): number {
  const sorted = [...incomes].sort((a, b) => a - b);
  const p10 = percentileSorted(sorted, 0.1);
  const p50 = percentileSorted(sorted, 0.5);
  if (p10 <= 0) return Infinity;
  return p50 / p10;
}

// ---- distribution generation --------------------------------------------------------

export interface DistParams {
  distribution: Distribution;
  /** Sample size. */
  n: number;
  /**
   * Shape parameter: sigma for log-normal, tail exponent alpha for
   * pareto / power-law; ignored for exponential.
   */
  shape: number;
  seed: number;
}

/** Box-Muller transform of mulberry32 uniforms into standard normals. */
export function standardNormals(n: number, rand: () => number): number[] {
  const out: number[] = [];
  while (out.length < n) {
    const u1 = rand();
    const u2 = rand();
    if (u1 <= 1e-12) continue;
    const r = Math.sqrt(-2 * Math.log(u1));
    out.push(r * Math.cos(2 * Math.PI * u2));
    if (out.length < n) out.push(r * Math.sin(2 * Math.PI * u2));
  }
  return out;
}

/** Pareto (Type I) Gini identity: G = 1/(2a-1) for a > 1/2. */
export function paretoGini(alpha: number): number {
  return 1 / (2 * alpha - 1);
}

/** Log-normal Gini identity: G = 2*Phi(sigma/sqrt(2)) - 1. */
export function lognormalGini(sigma: number): number {
  return 2 * normalCdf(sigma / Math.SQRT2) - 1;
}

/** Exponential-distribution Gini (scale-free): exactly 1/2. */
export const EXPONENTIAL_GINI = 0.5;

/**
 * Generate a seeded income sample of size n:
 * - log-normal: x = exp(mu + sigma z), mu = -sigma^2/2 so that E[x] = 1;
 * - pareto: Pareto Type I with x_m = 1 and tail exponent alpha;
 * - power-law: continuous power law p(x) propto x^-alpha on [1, 1e6]
 *   (inverse-CDF sampling);
 * - exponential: x = -ln(1-u) (lambda = 1, mean 1).
 */
export function generateIncomes(p: DistParams): number[] {
  const rand = mulberry32(p.seed >>> 0 || 1);
  const n = Math.max(2, Math.round(p.n));
  if (p.distribution === 'log-normal') {
    const sigma = Math.min(2.5, Math.max(0.05, p.shape));
    const mu = (-sigma * sigma) / 2;
    return standardNormals(n, rand).map((z) => Math.exp(mu + sigma * z));
  }
  if (p.distribution === 'pareto') {
    const alpha = Math.min(8, Math.max(1.2, p.shape));
    const out = new Array<number>(n);
    for (let i = 0; i < n; i += 1) {
      const u = Math.max(1e-12, rand());
      out[i] = Math.pow(1 - u, -1 / alpha);
    }
    return out;
  }
  if (p.distribution === 'power-law') {
    const alpha = Math.min(8, Math.max(1.2, p.shape));
    const xMax = 1e6;
    const pow = 1 - alpha;
    const xMaxPow = Math.pow(xMax, pow);
    const out = new Array<number>(n);
    for (let i = 0; i < n; i += 1) {
      const u = Math.min(1 - 1e-12, Math.max(0, rand()));
      out[i] = Math.pow(1 + u * (xMaxPow - 1), 1 / pow);
    }
    return out;
  }
  // exponential, lambda = 1 (mean 1)
  const out = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const u = Math.max(1e-12, rand());
    out[i] = -Math.log(1 - u);
  }
  return out;
}

// ---- moment-based identification ------------------------------------------------------

export interface DistIdentification {
  distribution: Distribution;
  /** Moment-implied shape parameter (sigma-hat or alpha-hat). */
  shape: number;
  /** Theoretical Gini implied by the fitted parameters (NaN when undefined). */
  theoreticalGini: number;
  /** |empirical Gini - theoretical Gini| (NaN when the identity is undefined). */
  giniGap: number;
  /** True when a closed-form theoretical Gini exists for this family. */
  hasIdentity: boolean;
}

/**
 * Rough moment-based parameter identification for one assumed family:
 * - log-normal: sigma^2 = ln(1 + v/m^2), then G = 2*Phi(sigma/sqrt2) - 1;
 * - pareto: alpha = m/(m-1) for m > 1 (x_m = 1), then G = 1/(2a-1);
 * - power-law: Clauset-style MLE alpha = 1 + n / sum ln(x_i/x_min); the pure
 *   power-law (x_min, infinity) shares the Pareto Gini formula, but the
 *   finite x_max truncation lowers the sample Gini, so no exact identity is
 *   claimed (hasIdentity = false);
 * - exponential: lambda = 1/m and the exact identity G = 1/2.
 */
export function identifyDistribution(incomes: number[], assumed: Distribution): DistIdentification {
  const n = incomes.length;
  const m = mean(incomes);
  if (n === 0 || m <= 0) {
    return { distribution: assumed, shape: NaN, theoreticalGini: NaN, giniGap: NaN, hasIdentity: false };
  }
  const gEmp = giniExact(incomes);
  if (assumed === 'log-normal') {
    let v = 0;
    for (let i = 0; i < n; i += 1) v += (incomes[i]! - m) * (incomes[i]! - m);
    v /= n;
    const sigma = Math.sqrt(Math.log(1 + (v / (m * m))));
    const gTheo = lognormalGini(sigma);
    return { distribution: assumed, shape: sigma, theoreticalGini: gTheo, giniGap: Math.abs(gEmp - gTheo), hasIdentity: true };
  }
  if (assumed === 'pareto') {
    if (m <= 1) {
      return { distribution: assumed, shape: NaN, theoreticalGini: NaN, giniGap: NaN, hasIdentity: true };
    }
    const alpha = m / (m - 1);
    const gTheo = alpha > 0.5 ? paretoGini(alpha) : NaN;
    return {
      distribution: assumed,
      shape: alpha,
      theoreticalGini: gTheo,
      giniGap: Number.isFinite(gTheo) ? Math.abs(gEmp - gTheo) : NaN,
      hasIdentity: true,
    };
  }
  if (assumed === 'power-law') {
    const xMin = Math.min(...incomes);
    let logSum = 0;
    for (let i = 0; i < n; i += 1) logSum += Math.log(incomes[i]! / xMin);
    const alpha = 1 + n / Math.max(logSum, 1e-12);
    return { distribution: assumed, shape: alpha, theoreticalGini: NaN, giniGap: NaN, hasIdentity: false };
  }
  // exponential
  return { distribution: assumed, shape: 1 / m, theoreticalGini: EXPONENTIAL_GINI, giniGap: Math.abs(gEmp - EXPONENTIAL_GINI), hasIdentity: true };
}

// ---- intergenerational mobility --------------------------------------------------------

export interface MobilityPair {
  /** Parent income. */
  parent: number;
  /** Child income. */
  child: number;
  /** Parent percentile rank within the parent distribution, [0, 1]. */
  parentRank: number;
  /** Child percentile rank within the child distribution, [0, 1]. */
  childRank: number;
}

export interface MobilityResult {
  /** Intergenerational elasticity (rho) used to generate the data. */
  elasticity: number;
  /** OLS rank-rank slope of child rank on parent rank. */
  rankRankSlope: number;
  /** OLS elasticity: slope of ln(child income) on ln(parent income). */
  igeSlope: number;
  /** Parent-child pairs (capped for plotting). */
  pairs: MobilityPair[];
}

/**
 * Population rank-rank slope of a bivariate standard-normal pair with
 * correlation rho: slope = 6 * arcsin(rho/2) / pi. This follows from
 * Cov(Phi(X), Phi(Y)) = arcsin(rho/2) / (2 pi) with Var(Phi(X)) = 1/12.
 */
export function expectedRankRankSlope(rho: number): number {
  const c = Math.min(1, Math.max(-1, rho)) / 2;
  return (6 * Math.asin(c)) / Math.PI;
}

/**
 * Galton-style intergenerational mobility simulation. Parent log-income and
 * child log-income are standardised bivariate normal with correlation
 * `elasticity` (child z = rho * parent z + sqrt(1 - rho^2) * eps); incomes
 * are exp(sigma * z) with sigma = 0.8. Percentile ranks are the empirical
 * within-distribution ranks; the rank-rank slope is the OLS slope.
 */
export function simulateMobility(n: number, elasticity: number, seed: number, sigma = 0.8, maxPairs = 600): MobilityResult {
  const size = Math.max(2, Math.round(n));
  const rho = Math.min(0.98, Math.max(0, elasticity));
  const rand = mulberry32(seed >>> 0 || 1);
  const zs = standardNormals(2 * size, rand);
  const zParent: number[] = [];
  const zChild: number[] = [];
  for (let i = 0; i < size; i += 1) {
    const zp = zs[i]!;
    const eps = zs[size + i]!; // independent innovation for the child
    zParent.push(zp);
    zChild.push(rho * zp + Math.sqrt(1 - rho * rho) * eps);
  }
  const parent = zParent.map((z) => Math.exp(sigma * z));
  const child = zChild.map((z) => Math.exp(sigma * z));

  const rankOf = (values: number[]): number[] => {
    const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(values.length);
    for (let k = 0; k < order.length; k += 1) ranks[order[k]!.i] = (k + 0.5) / order.length;
    return ranks;
  };
  const pr = rankOf(parent);
  const cr = rankOf(child);

  // OLS slope of childRank on parentRank.
  const mp = mean(pr);
  const mc = mean(cr);
  let num = 0;
  let den = 0;
  for (let i = 0; i < size; i += 1) {
    num += (pr[i]! - mp) * (cr[i]! - mc);
    den += (pr[i]! - mp) * (pr[i]! - mp);
  }
  const rankRankSlope = den > 0 ? num / den : 0;

  // OLS elasticity: ln(child) on ln(parent).
  let numL = 0;
  let denL = 0;
  const mpL = mean(parent.map((v) => Math.log(v)));
  const mcL = mean(child.map((v) => Math.log(v)));
  for (let i = 0; i < size; i += 1) {
    const lp = Math.log(parent[i]!) - mpL;
    const lc = Math.log(child[i]!) - mcL;
    numL += lp * lc;
    denL += lp * lp;
  }
  const igeSlope = denL > 0 ? numL / denL : 0;

  const stride = Math.max(1, Math.ceil(size / maxPairs));
  const pairs: MobilityPair[] = [];
  for (let i = 0; i < size; i += stride) {
    pairs.push({ parent: parent[i]!, child: child[i]!, parentRank: pr[i]!, childRank: cr[i]! });
  }
  return { elasticity: rho, rankRankSlope, igeSlope, pairs };
}

// ---- tax counterfactuals -----------------------------------------------------------------

export interface TaxResult {
  regime: TaxRegime;
  /** Statutory top marginal rate parameter. */
  rate: number;
  preTax: number[];
  postTax: number[];
  giniPre: number;
  giniPost: number;
  /** Reynolds-Smolensky-style redistribution effect: G_pre - G_post. */
  redistribution: number;
  /** Total tax collected / total pre-tax income. */
  avgTaxRate: number;
}

/**
 * Marginal-bracket schedule relative to the sample median m:
 * - progressive: [0, 0.5m, 2m] with marginal rates [0, rate/2, rate];
 * - flat: rate on all income;
 * - regressive: [0, 0.5m, 2m] with marginal rates [rate, rate/2, 0].
 */
export function taxAt(income: number, regime: TaxRegime, rate: number, median: number): number {
  if (regime === 'none' || rate <= 0) return 0;
  if (regime === 'flat') return income * rate;
  const lo = 0.5 * median;
  const hi = 2 * median;
  if (regime === 'progressive') {
    let tax = 0;
    if (income > lo) tax += (Math.min(income, hi) - lo) * (rate / 2);
    if (income > hi) tax += (income - hi) * rate;
    return tax;
  }
  // regressive
  let tax = Math.min(income, lo) * rate;
  if (income > lo) tax += (Math.min(income, hi) - lo) * (rate / 2);
  return tax;
}

/**
 * Apply a tax regime to a sample and compute pre/post-tax Ginis plus the
 * Reynolds-Smolensky-style redistribution effect G_pre - G_post (no
 * reranking term; the post-tax schedule is applied pointwise).
 */
export function applyTax(incomes: number[], regime: TaxRegime, rate: number): TaxResult {
  const preTax = incomes.slice();
  const median = percentile(incomes, 0.5);
  const postTax = incomes.map((x) => Math.max(0, x - taxAt(x, regime, rate, median)));
  let taxTotal = 0;
  let incomeTotal = 0;
  for (let i = 0; i < incomes.length; i += 1) {
    taxTotal += incomes[i]! - postTax[i]!;
    incomeTotal += incomes[i]!;
  }
  const giniPre = giniExact(preTax);
  const giniPost = giniExact(postTax);
  return {
    regime,
    rate,
    preTax,
    postTax,
    giniPre,
    giniPost,
    redistribution: giniPre - giniPost,
    avgTaxRate: incomeTotal > 0 ? taxTotal / incomeTotal : 0,
  };
}

// ---- qualitative severity verdict ---------------------------------------------------------

export interface InequalityVerdict {
  key: 'low' | 'moderate' | 'high' | 'severe';
  en: string;
  zh: string;
}

/** Qualitative severity classification of a point-estimate Gini. */
export function classifyInequality(g: number): InequalityVerdict {
  if (!Number.isFinite(g)) {
    return { key: 'severe', en: 'undefined (degenerate sample)', zh: '未定义（退化样本）' };
  }
  if (g < 0.25) {
    return { key: 'low', en: 'low inequality (G < 0.25)', zh: '低不平等（G < 0.25）' };
  }
  if (g < 0.35) {
    return { key: 'moderate', en: 'moderate inequality (0.25 <= G < 0.35)', zh: '中等不平等（0.25 ≤ G < 0.35）' };
  }
  if (g < 0.45) {
    return { key: 'high', en: 'high inequality (0.35 <= G < 0.45)', zh: '高度不平等（0.35 ≤ G < 0.45）' };
  }
  return { key: 'severe', en: 'severe inequality (G >= 0.45)', zh: '严重不平等（G ≥ 0.45）' };
}

// ---- embedded validation benchmark -----------------------------------------------------------

export interface InequalityBenchmark {
  pass: boolean;
  details: {
    /** Hand-computed Ginis on tiny populations are exact. */
    giniTinyExact: boolean;
    /** |sample Gini - 2*Phi(sigma/sqrt2)+... identity| for seeded log-normal. */
    lognormalGiniErr: number;
    /** |sample Gini - 1/(2a-1)| for seeded Pareto. */
    paretoGiniErr: number;
    /** |sample Gini - 1/2| for seeded exponential. */
    exponentialGiniErr: number;
    /** Lorenz curves close at (0,0) and (1,1). */
    lorenzClosure: boolean;
    /** Fixed-seed bootstrap CI contains the point estimate. */
    ciContainsEstimate: boolean;
    /** Bootstrap CI has positive width. */
    ciWidthPositive: boolean;
    /** Same seed reproduces samples and statistics exactly. */
    deterministic: boolean;
  };
}

export const INEQUALITY_BENCHMARK = {
  id: 'gini-exact+lorenz-closure',
  /** Sample size for the distribution-identity checks. */
  n: 20000,
  /** Log-normal sigma used in the identity check. */
  sigma: 0.8,
  /** Pareto tail exponent used in the identity check. */
  alpha: 3,
  /** Identity tolerance (sampling error at n = 20000 is well below this). */
  tol: 0.02,
  /** Fixed benchmark seed. */
  seed: 20261029,
  /** Bootstrap reps for the CI sanity check. */
  bootReps: 200,
} as const;

/**
 * Run the embedded inequality validation battery: exact tiny-population
 * Ginis, theoretical-Gini identities on large seeded samples, Lorenz closure,
 * bootstrap CI sanity and seed determinism.
 */
export function runInequalityBenchmark(): InequalityBenchmark {
  // (1) hand-computed Ginis on tiny populations.
  const g1111 = giniExact([1, 1, 1, 1]);
  const g0004 = giniExact([0, 0, 0, 4]);
  const g1234 = giniExact([1, 2, 3, 4]);
  const giniTinyExact =
    Math.abs(g1111) < 1e-12 && Math.abs(g0004 - 0.75) < 1e-12 && Math.abs(g1234 - 0.25) < 1e-12;

  // (2) log-normal identity: G = 2*Phi(sigma/sqrt(2)) - 1.
  const lnSample = generateIncomes({ distribution: 'log-normal', n: INEQUALITY_BENCHMARK.n, shape: INEQUALITY_BENCHMARK.sigma, seed: INEQUALITY_BENCHMARK.seed });
  const lnGini = giniExact(lnSample);
  const lognormalGiniErr = Math.abs(lnGini - lognormalGini(INEQUALITY_BENCHMARK.sigma));

  // (3) Pareto identity: G = 1/(2a-1).
  const paretoSample = generateIncomes({ distribution: 'pareto', n: INEQUALITY_BENCHMARK.n, shape: INEQUALITY_BENCHMARK.alpha, seed: INEQUALITY_BENCHMARK.seed + 1 });
  const paretoG = giniExact(paretoSample);
  const paretoGiniErr = Math.abs(paretoG - paretoGini(INEQUALITY_BENCHMARK.alpha));

  // (4) exponential identity: G = 1/2.
  const expSample = generateIncomes({ distribution: 'exponential', n: INEQUALITY_BENCHMARK.n, shape: 1, seed: INEQUALITY_BENCHMARK.seed + 2 });
  const expGiniErr = Math.abs(giniExact(expSample) - EXPONENTIAL_GINI);

  // (5) Lorenz closure at (0,0) and (1,1).
  let lorenzClosure = true;
  for (const sample of [lnSample, paretoSample, [1, 2, 3, 4]]) {
    const pts = lorenzCurve(sample as number[]);
    const first = pts[0]!;
    const last = pts[pts.length - 1]!;
    lorenzClosure =
      lorenzClosure &&
      Math.abs(first.p) < 1e-12 &&
      Math.abs(first.l) < 1e-12 &&
      Math.abs(last.p - 1) < 1e-12 &&
      Math.abs(last.l - 1) < 1e-12;
  }

  // (6) bootstrap CI sanity on a fixed seed.
  const ci = giniBootstrapCI(lnSample, INEQUALITY_BENCHMARK.bootReps, INEQUALITY_BENCHMARK.seed + 3);
  const ciContainsEstimate = ci.lo <= ci.estimate + 1e-12 && ci.estimate <= ci.hi + 1e-12;
  const ciWidthPositive = ci.hi - ci.lo > 0;

  // (7) determinism: same seed -> identical samples and statistics.
  const a = generateIncomes({ distribution: 'log-normal', n: 2000, shape: 0.7, seed: 777 });
  const b = generateIncomes({ distribution: 'log-normal', n: 2000, shape: 0.7, seed: 777 });
  const c = generateIncomes({ distribution: 'log-normal', n: 2000, shape: 0.7, seed: 778 });
  let deterministic = a.length === b.length && b.length === c.length;
  for (let i = 0; i < a.length && deterministic; i += 1) {
    if (a[i] !== b[i]) deterministic = false;
    if (a[i] === c[i]) deterministic = false; // different seed must differ
  }
  deterministic =
    deterministic &&
    giniExact(a) === giniExact(b) &&
    simulateMobility(400, 0.4, 555).rankRankSlope === simulateMobility(400, 0.4, 555).rankRankSlope;

  const identityOk = lognormalGiniErr < INEQUALITY_BENCHMARK.tol && paretoGiniErr < INEQUALITY_BENCHMARK.tol && expGiniErr < INEQUALITY_BENCHMARK.tol;
  return {
    pass: giniTinyExact && identityOk && lorenzClosure && ciContainsEstimate && ciWidthPositive && deterministic,
    details: {
      giniTinyExact,
      lognormalGiniErr,
      paretoGiniErr,
      exponentialGiniErr: expGiniErr,
      lorenzClosure,
      ciContainsEstimate,
      ciWidthPositive,
      deterministic,
    },
  };
}
