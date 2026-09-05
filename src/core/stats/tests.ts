// ==========================================================================
// Ergalics Studio — hypothesis tests
//
// Parametric and non-parametric tests over numeric samples, each returning a
// common `{ statistic, df, pValue }` shape. Two-sample t-tests default to
// Welch's correction (unequal variances); pass `pooled: true` for the classic
// equal-variance version. Mann-Whitney uses the normal approximation with a
// continuity correction and tie adjustment (valid for moderate samples).
// ==========================================================================

import { studentTCdf, chiSquareCdf, fCdf, normalCdf } from './special';
import { mean, variance } from './descriptive';

export interface TestResult {
  statistic: number;
  df?: number | [number, number];
  pValue: number;
}

/** One-sample (or paired-difference) t-test against a null mean `mu0`. */
export function tTestOneSample(data: number[], mu0 = 0): TestResult {
  const n = data.length;
  if (n < 2) return { statistic: NaN, df: n - 1, pValue: NaN };
  const m = mean(data);
  const s = Math.sqrt(variance(data, true));
  const t = (m - mu0) / (s / Math.sqrt(n));
  const df = n - 1;
  const p = 2 * (1 - studentTCdf(Math.abs(t), df));
  return { statistic: t, df, pValue: p };
}

/** Paired t-test: tests whether the mean difference `a - b` is zero. */
export function tTestPaired(a: number[], b: number[]): TestResult {
  const n = Math.min(a.length, b.length);
  const diffs: number[] = [];
  for (let i = 0; i < n; i += 1) diffs.push(a[i]! - b[i]!);
  return tTestOneSample(diffs, 0);
}

/** Two-sample t-test. `pooled = false` (default) uses Welch's correction. */
export function tTestTwoSample(a: number[], b: number[], pooled = false): TestResult {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) return { statistic: NaN, df: na + nb - 2, pValue: NaN };
  const ma = mean(a);
  const mb = mean(b);
  const va = variance(a, true);
  const vb = variance(b, true);
  let t: number;
  let df: number;
  if (pooled) {
    const sp = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2));
    t = sp === 0 ? 0 : (ma - mb) / (sp * Math.sqrt(1 / na + 1 / nb));
    df = na + nb - 2;
  } else {
    const se = Math.sqrt(va / na + vb / nb);
    t = se === 0 ? 0 : (ma - mb) / se;
    const sa = va / na;
    const sb = vb / nb;
    df = (sa + sb) ** 2 / (sa ** 2 / (na - 1) + sb ** 2 / (nb - 1));
  }
  const p = 2 * (1 - studentTCdf(Math.abs(t), df));
  return { statistic: t, df, pValue: p };
}

/** One-way ANOVA across two or more groups (F-test for equal means). */
export function anovaOneWay(groups: number[][]): TestResult {
  const k = groups.length;
  if (k < 2) return { statistic: NaN, df: [NaN, NaN], pValue: NaN };
  const all: number[] = [];
  for (const g of groups) for (const v of g) all.push(v);
  const n = all.length;
  const gm = mean(all);
  let ssb = 0;
  let ssw = 0;
  for (const g of groups) {
    const m = mean(g);
    ssb += g.length * (m - gm) ** 2;
    for (const v of g) ssw += (v - m) ** 2;
  }
  const dfb = k - 1;
  const dfw = n - k;
  if (dfw < 1 || ssw === 0) return { statistic: NaN, df: [dfb, dfw], pValue: NaN };
  const F = (ssb / dfb) / (ssw / dfw);
  const p = 1 - fCdf(F, dfb, dfw);
  return { statistic: F, df: [dfb, dfw], pValue: p };
}

export interface MannWhitneyResult {
  u: number;
  z: number;
  pValue: number;
}

/**
 * Mann-Whitney U test (two independent samples). Returns the smaller U, the
 * normal-approximation z (with continuity + tie correction) and its two-sided
 * p-value.
 */
export function mannWhitney(a: number[], b: number[]): MannWhitneyResult {
  const n1 = a.length;
  const n2 = b.length;
  const merged = [
    ...a.map((v) => ({ v, g: 0 as 0 | 1 })),
    ...b.map((v) => ({ v, g: 1 as 0 | 1 })),
  ].sort((x, y) => x.v - y.v);

  // Average ranks over tied values.
  const ranks: number[] = new Array(merged.length).fill(0);
  let i = 0;
  while (i < merged.length) {
    let j = i;
    let sum = 0;
    let cnt = 0;
    while (j < merged.length && merged[j]!.v === merged[i]!.v) {
      sum += j + 1;
      cnt += 1;
      j += 1;
    }
    const avg = sum / cnt;
    for (let t = i; t < j; t += 1) ranks[t] = avg;
    i = j;
  }

  let r1 = 0;
  for (let k = 0; k < merged.length; k += 1) if (merged[k]!.g === 0) r1 += ranks[k]!;
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);

  // Tie correction term: sum over tie groups of (t^3 - t).
  const tieSum = tiedCorrection(merged.map((m) => m.v));
  const N = n1 + n2;
  const denom = Math.sqrt((n1 * n2) / 12 * (N + 1 - tieSum / (N * (N - 1))));
  const meanU = (n1 * n2) / 2;
  const dev = Math.abs(u - meanU);
  // Two-sided p via the normal approximation with a continuity correction.
  const zFinal = denom === 0 ? 0 : Math.max(0, (dev - 0.5) / denom);
  const pValue = 2 * (1 - normalCdf(zFinal));
  return { u, z: denom === 0 ? 0 : (u - meanU) / denom, pValue };
}

function tiedCorrection(values: number[]): number {
  let sum = 0;
  let i = 0;
  while (i < values.length) {
    let j = i;
    while (j < values.length && values[j] === values[i]) j += 1;
    const t = j - i;
    if (t > 1) sum += t * t * t - t;
    i = j;
  }
  return sum;
}

export interface ChiSquareResult {
  statistic: number;
  df: number;
  pValue: number;
  expected: number[][];
}

/** Pearson chi-square test of independence for a contingency table. */
export function chiSquareIndependence(observed: number[][]): ChiSquareResult {
  const r = observed.length;
  const c = observed[0]?.length ?? 0;
  const rowTot = observed.map((row) => row.reduce((s, v) => s + v, 0));
  const colTot = Array.from({ length: c }, (_, j) =>
    observed.reduce((s, row) => s + (row[j] ?? 0), 0),
  );
  const N = rowTot.reduce((s, v) => s + v, 0);
  const expected: number[][] = [];
  let chi2 = 0;
  for (let i = 0; i < r; i += 1) {
    expected[i] = [];
    for (let j = 0; j < c; j += 1) {
      const e = (rowTot[i]! * colTot[j]!) / N;
      expected[i]![j] = e;
      const o = observed[i]![j] ?? 0;
      if (e > 0) chi2 += (o - e) ** 2 / e;
    }
  }
  const df = (r - 1) * (c - 1);
  const p = 1 - chiSquareCdf(chi2, df);
  return { statistic: chi2, df, pValue: p, expected };
}
