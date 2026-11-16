// ==========================================================================
// Ergalics Studio — non-parametric multi-group tests (pure TS, no WASM)
//
// `mannWhitney()` covers two groups. When there are three or more groups and
// the normality / equal-variance assumptions behind ANOVA fail, the
// Kruskal–Wallis H test is the standard alternative; Dunn's test then does
// the pairwise comparisons on mean ranks with a multiplicity correction.
//
// Ranking is average-tie aware (the same convention as Mann–Whitney) and the
// H statistic carries the tie correction
//   H = H_raw / (1 − Σ(t³ − t)/(N³ − N)).
// ==========================================================================

import { chiSquareCdf, normalCdf } from './special';
import { benjaminiHochberg, bonferroni } from './correction';

export interface KruskalWallisResult {
  H: number;
  df: number;
  pValue: number;
  /** True when at least one tie group was present (H was tie-corrected). */
  tied: boolean;
  /** Group medians, aligned to the input order. */
  medians: number[];
  /** Group mean ranks, aligned to the input order. */
  meanRanks: number[];
  /** Rank-based effect size H/(N−1) (analogue of η²). */
  epsilonSquared: number;
  n: number;
}

interface RankedGroup {
  values: number[];
  ranks: number[];
  meanRank: number;
  median: number;
}

/** Rank all values together, assigning average ranks inside tie groups. */
function rankGroups(groups: number[][]): { ranked: RankedGroup[]; tieSum: number; N: number } {
  const merged: Array<{ v: number; g: number }> = [];
  groups.forEach((g, gi) => g.forEach((v) => merged.push({ v, g: gi })));
  merged.sort((a, b) => a.v - b.v);
  const ranks = new Array<number>(merged.length).fill(0);
  let tieSum = 0;
  let i = 0;
  while (i < merged.length) {
    let j = i;
    let sum = 0;
    while (j < merged.length && merged[j]!.v === merged[i]!.v) {
      sum += j + 1;
      j += 1;
    }
    const avg = sum / (j - i);
    for (let k = i; k < j; k += 1) ranks[k] = avg;
    const t = j - i;
    if (t > 1) tieSum += t ** 3 - t;
    i = j;
  }
  const ranked: RankedGroup[] = groups.map((g) => ({
    values: g,
    ranks: [],
    meanRank: 0,
    median: NaN,
  }));
  merged.forEach((m, idx) => {
    ranked[m.g]!.ranks.push(ranks[idx]!);
  });
  for (const rg of ranked) {
    rg.meanRank = rg.ranks.reduce((s, v) => s + v, 0) / rg.ranks.length;
    const sorted = [...rg.values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    rg.median = sorted.length % 2 ? sorted[mid]! : 0.5 * (sorted[mid - 1]! + sorted[mid]!);
  }
  return { ranked, tieSum, N: merged.length };
}

/**
 * Kruskal–Wallis H test. Requires at least two non-empty groups; the
 * chi-square approximation is used for the p-value with `k − 1` df.
 */
export function kruskalWallis(groups: number[][]): KruskalWallisResult {
  const k = groups.length;
  if (k < 2) throw new Error('kruskalWallis needs at least two groups');
  const emptyAt = groups.findIndex((g) => g.length === 0);
  if (emptyAt >= 0) throw new Error(`kruskalWallis: group ${emptyAt} is empty`);
  const { ranked, tieSum, N } = rankGroups(groups);
  if (N < 3) throw new Error('kruskalWallis needs at least three observations in total');

  let raw = 0;
  for (const rg of ranked) raw += rg.ranks.length * rg.meanRank ** 2;
  raw = (12 / (N * (N + 1))) * raw - 3 * (N + 1);
  const correction = 1 - tieSum / (N ** 3 - N);
  const H = correction > 0 ? raw / correction : raw;
  const df = k - 1;
  const pValue = 1 - chiSquareCdf(Math.max(H, 0), df);

  return {
    H,
    df,
    pValue: Math.min(1, Math.max(0, pValue)),
    tied: tieSum > 0,
    medians: ranked.map((rg) => rg.median),
    meanRanks: ranked.map((rg) => rg.meanRank),
    epsilonSquared: N > 1 ? Math.max(0, H) / (N - 1) : NaN,
    n: N,
  };
}

export interface DunnComparison {
  groupA: string;
  groupB: string;
  meanRankA: number;
  meanRankB: number;
  /** Difference of mean ranks (A − B). */
  rankDiff: number;
  z: number;
  /** Raw two-sided p-value. */
  pValue: number;
  /** Multiplicity-adjusted p-value. */
  adjustedP: number;
  significant: boolean;
}

export interface DunnResult {
  comparisons: DunnComparison[];
  /** Variance of the rank differences (tie-corrected). */
  rankVariance: number;
  correction: 'bonferroni' | 'bh';
  alpha: number;
  k: number;
  n: number;
}

/**
 * Dunn's post-hoc test for Kruskal–Wallis. Pairwise z statistics use the
 * tie-corrected rank variance
 *   σ² = [N(N+1)/12 − Σ(t³−t)/(12(N−1))]
 * so the result is consistent with the H test above.
 */
export function dunnPostHoc(
  groups: number[][],
  groupNames?: string[],
  correction: 'bonferroni' | 'bh' = 'bonferroni',
  alpha = 0.05,
): DunnResult {
  const k = groups.length;
  if (k < 2) throw new Error('dunnPostHoc needs at least two groups');
  if (groups.some((g) => g.length === 0)) throw new Error('dunnPostHoc: empty group');
  const names = groupNames ?? groups.map((_, i) => `group${i + 1}`);
  if (names.length !== k) throw new Error('dunnPostHoc: groupNames must match the group count');
  const { ranked, tieSum, N } = rankGroups(groups);
  if (N < 3) throw new Error('dunnPostHoc needs at least three observations in total');
  const rankVariance = (N * (N + 1)) / 12 - tieSum / (12 * (N - 1));

  const comparisons: DunnComparison[] = [];
  for (let i = 0; i < k; i += 1) {
    for (let j = i + 1; j < k; j += 1) {
      const diff = ranked[i]!.meanRank - ranked[j]!.meanRank;
      const se = Math.sqrt(rankVariance * (1 / groups[i]!.length + 1 / groups[j]!.length));
      const z = se > 0 ? diff / se : 0;
      const p = 2 * (1 - normalCdf(Math.abs(z)));
      comparisons.push({
        groupA: names[i]!,
        groupB: names[j]!,
        meanRankA: ranked[i]!.meanRank,
        meanRankB: ranked[j]!.meanRank,
        rankDiff: diff,
        z,
        pValue: Math.min(1, Math.max(0, p)),
        adjustedP: 1,
        significant: false,
      });
    }
  }
  const raw = comparisons.map((c) => c.pValue);
  const adjusted =
    correction === 'bh' ? benjaminiHochberg(raw, alpha) : bonferroni(raw, alpha);
  comparisons.forEach((c, i) => {
    c.adjustedP = adjusted.adjusted[i]!;
    c.significant = adjusted.significant[i]!;
  });

  return { comparisons, rankVariance, correction, alpha, k, n: N };
}
