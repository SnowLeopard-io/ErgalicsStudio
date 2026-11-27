// ==========================================================================
// Ergalics Studio — ANOVA post-hoc tests (pure TS, no WASM)
//
// `anovaOneWay()` tells you that *some* group means differ; post-hoc tests
// answer *which*. Two procedures are implemented:
//
//   - Tukey HSD (Tukey–Kramer for unequal n): all pairwise comparisons,
//     family-wise error rate controlled through the Studentized range
//     distribution.
//   - Dunnett: every treatment against a single control, which is the
//     pharmacology / assay design — more powerful than Tukey because it makes
//     fewer comparisons.
//
// Both p-values come from exact distribution integrals instead of table
// look-ups: the Studentized range CDF is a two-dimensional integral over the
// chi distribution and the standard normal, and Dunnett's joint probability
// conditions on the common variance factor (the correlation matrix is
// rank-one, so one normal integral is enough).
// ==========================================================================

import { logGamma } from './special';
import { mean, variance } from './descriptive';

// ---- fast normal helpers (the integrals evaluate Φ hundreds of thousands of
// times, so the accurate `erf` from special.ts would dominate the runtime) ---

const SQRT_2PI = Math.sqrt(2 * Math.PI);

function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/** Abramowitz–Stegun 26.2.17 normal CDF (|ε| < 7.5e-8). */
function fastNormalCdf(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * z);
  const poly =
    t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - normalPdf(z) * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

/** Composite Simpson rule over [a, b] with an even number of intervals. */
function simpson(f: (x: number) => number, a: number, b: number, n: number): number {
  const m = n % 2 === 0 ? n : n + 1;
  const h = (b - a) / m;
  let s = f(a) + f(b);
  for (let i = 1; i < m; i += 1) s += (i % 2 === 0 ? 2 : 4) * f(a + i * h);
  return (h / 3) * s;
}

/**
 * Density of t = √(χ²_ν/ν) on (0, ∞):
 *   f(t) = 2 (ν/2)^{ν/2} / Γ(ν/2) · t^{ν−1} · exp(−ν t²/2).
 */
function chiScaledPdf(t: number, df: number): number {
  if (t <= 0) return 0;
  const a = df / 2;
  return (
    2 *
    Math.exp(a * Math.log(df / 2) - logGamma(a) + (df - 1) * Math.log(t) - (df * t * t) / 2)
  );
}

/**
 * Probability that a Studentized range of `k` groups with `df` error degrees
 * of freedom is ≤ q:
 *
 *   P(Q ≤ q) = ∫₀^∞ f_T(t) · k ∫ φ(z)[Φ(z + q t) − Φ(z)]^{k−1} dz dt.
 *
 * `t = √(χ²_df/df)` carries the uncertainty of the pooled variance estimate.
 */
export function studentizedRangeCdf(q: number, k: number, df: number): number {
  if (!Number.isFinite(q) || q <= 0) return 0;
  if (k < 2) return NaN;
  if (!Number.isFinite(df) || df <= 0) return NaN;
  const outer = (t: number): number => {
    const c = q * t;
    const inner = (z: number): number => {
      const base = fastNormalCdf(z);
      const upper = fastNormalCdf(z + c);
      return normalPdf(z) * (upper - base) ** (k - 1);
    };
    // The integrand is negligible beyond |z| ≈ 8 for any c.
    return chiScaledPdf(t, df) * k * simpson(inner, -8, 8, 240);
  };
  const value = simpson(outer, 0, 8, 320);
  return Math.min(1, Math.max(0, value));
}

/** Quantile of the Studentized range distribution (bisection on the CDF). */
export function studentizedRangeInv(p: number, k: number, df: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = 40;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (studentizedRangeCdf(mid, k, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// ---- shared pooling -------------------------------------------------------

interface Pooled {
  msWithin: number;
  dfError: number;
  k: number;
}

function poolGroups(groups: number[][]): Pooled {
  const k = groups.length;
  if (k < 2) throw new Error('post-hoc tests need at least two groups');
  const emptyAt = groups.findIndex((g) => g.length < 2);
  if (emptyAt >= 0) {
    throw new Error(`group ${emptyAt} needs at least two observations`);
  }
  let ssw = 0;
  let df = 0;
  for (const g of groups) {
    ssw += variance(g, true) * (g.length - 1);
    df += g.length - 1;
  }
  if (df < 1) throw new Error('post-hoc tests need at least one error degree of freedom');
  return { msWithin: ssw / df, dfError: df, k };
}

export interface PosthocComparison {
  groupA: string;
  groupB: string;
  meanA: number;
  meanB: number;
  meanDiff: number;
  /** Standard error of the mean difference. */
  se: number;
  /** Test statistic: Studentized range q (Tukey) or t (Dunnett). */
  statistic: number;
  /** Family-wise adjusted p-value. */
  pValue: number;
  ciLow: number;
  ciHigh: number;
  significant: boolean;
}

export interface TukeyResult {
  method: 'tukey-hsd';
  comparisons: PosthocComparison[];
  msWithin: number;
  dfError: number;
  k: number;
  alpha: number;
  /** Critical Studentized range value at `alpha`. */
  qCrit: number;
}

/**
 * Tukey's HSD with the Tukey–Kramer correction for unequal group sizes.
 * Pairwise difference CI: Δ ± qα,df · √(MSW/2 · (1/nᵢ + 1/nⱼ)).
 */
export function tukeyHSD(
  groups: number[][],
  groupNames?: string[],
  alpha = 0.05,
): TukeyResult {
  const { msWithin, dfError, k } = poolGroups(groups);
  const names = groupNames ?? groups.map((_, i) => `group${i + 1}`);
  if (names.length !== k) throw new Error('tukeyHSD: groupNames must match the group count');
  const qCrit = studentizedRangeInv(1 - alpha, k, dfError);
  const means = groups.map(mean);
  const comparisons: PosthocComparison[] = [];
  for (let i = 0; i < k; i += 1) {
    for (let j = i + 1; j < k; j += 1) {
      const diff = means[i]! - means[j]!;
      const se = Math.sqrt((msWithin / 2) * (1 / groups[i]!.length + 1 / groups[j]!.length));
      const q = se > 0 ? Math.abs(diff) / se : diff === 0 ? 0 : Infinity;
      const pValue = Number.isFinite(q) ? 1 - studentizedRangeCdf(q, k, dfError) : 0;
      const half = qCrit * se;
      comparisons.push({
        groupA: names[i]!,
        groupB: names[j]!,
        meanA: means[i]!,
        meanB: means[j]!,
        meanDiff: diff,
        se,
        statistic: q,
        pValue: Math.min(1, Math.max(0, pValue)),
        ciLow: diff - half,
        ciHigh: diff + half,
        significant: pValue <= alpha,
      });
    }
  }
  return { method: 'tukey-hsd', comparisons, msWithin, dfError, k, alpha, qCrit };
}

export interface DunnettResult {
  method: 'dunnett';
  control: string;
  comparisons: PosthocComparison[];
  msWithin: number;
  dfError: number;
  k: number;
  alpha: number;
  /** Critical value of max |Tᵢ| at `alpha` (for simultaneous CIs). */
  tCrit: number;
}

/**
 * Joint probability P(maxᵢ |Tᵢ| ≤ c) for Dunnett's comparisons.
 *
 * With a common control the correlations factor as ρᵢⱼ = aᵢaⱼ with
 * aᵢ = 1/√(1 + n₀/nᵢ), so conditioning on one standard normal U makes the
 * comparisons independent:
 *   Tᵢ = (aᵢ U + √(1−aᵢ²) εᵢ) / √(W/df).
 * The outer integral over t = √(W/df) handles the estimated variance.
 */
function dunnettJoint(c: number, a: number[], df: number): number {
  const b = a.map((v) => Math.sqrt(Math.max(0, 1 - v * v)));
  const outer = (t: number): number => {
    const cc = c * t;
    const inner = (u: number): number => {
      let prod = 1;
      for (let i = 0; i < a.length; i += 1) {
        const ai = a[i]!;
        const bi = b[i]!;
        if (bi < 1e-12) {
          prod *= Math.abs(ai * u) <= cc ? 1 : 0;
        } else {
          prod *= fastNormalCdf((cc - ai * u) / bi) - fastNormalCdf((-cc - ai * u) / bi);
        }
        if (prod === 0) break;
      }
      return normalPdf(u) * prod;
    };
    return chiScaledPdf(t, df) * simpson(inner, -8, 8, 240);
  };
  const value = simpson(outer, 0, 8, 320);
  return Math.min(1, Math.max(0, value));
}

/**
 * Dunnett's test: every treatment mean against one control. Adjusted
 * p-values are single-step (family-wise) and CIs use the simultaneous
 * critical value.
 */
export function dunnettTest(
  control: number[],
  treatmentGroups: number[][],
  groupNames?: string[],
  alpha = 0.05,
): DunnettResult {
  const m = treatmentGroups.length;
  if (m === 0) throw new Error('dunnettTest needs at least one treatment group');
  if (control.length < 2) throw new Error('dunnettTest: control needs at least two observations');
  const groups = [control, ...treatmentGroups];
  const { msWithin, dfError } = poolGroups(groups);
  const names = groupNames ?? ['control', ...treatmentGroups.map((_, i) => `treatment${i + 1}`)];
  if (names.length !== m + 1) throw new Error('dunnettTest: groupNames must have m + 1 entries');

  const n0 = control.length;
  const a = treatmentGroups.map((g) => 1 / Math.sqrt(1 + n0 / g.length));
  // Critical value: solve P(max |T| ≤ c) = 1 − alpha.
  let lo = 0;
  let hi = 20;
  for (let i = 0; i < 60; i += 1) {
    const mid = (lo + hi) / 2;
    if (dunnettJoint(mid, a, dfError) < 1 - alpha) lo = mid;
    else hi = mid;
  }
  const tCrit = (lo + hi) / 2;

  const controlMean = mean(control);
  const comparisons: PosthocComparison[] = treatmentGroups.map((g, i) => {
    const diff = mean(g) - controlMean;
    const se = Math.sqrt(msWithin * (1 / n0 + 1 / g.length));
    const tObs = se > 0 ? Math.abs(diff) / se : diff === 0 ? 0 : Infinity;
    const pValue = Number.isFinite(tObs) ? 1 - dunnettJoint(tObs, a, dfError) : 0;
    const half = tCrit * se;
    return {
      groupA: names[0]!,
      groupB: names[i + 1]!,
      meanA: controlMean,
      meanB: mean(g),
      meanDiff: diff,
      se,
      statistic: tObs,
      pValue: Math.min(1, Math.max(0, pValue)),
      ciLow: diff - half,
      ciHigh: diff + half,
      significant: pValue <= alpha,
    };
  });

  return {
    method: 'dunnett',
    control: names[0]!,
    comparisons,
    msWithin,
    dfError,
    k: m + 1,
    alpha,
    tCrit,
  };
}
