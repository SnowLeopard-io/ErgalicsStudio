// ==========================================================================
// Ergalics Studio — Kaplan–Meier survival analysis (pure TS, no WASM)
//
// Medical / public-health papers need two things from a survival table:
// a Kaplan–Meier curve (with Greenwood standard errors, 95% log–log bands,
// median survival and the numbers-at-risk table) and a log-rank test for the
// difference between groups.
//
// Conventions: `events[i] === true` means the event of interest occurred at
// `times[i]`; `false` is right-censoring. At a tied time, events are assumed
// to happen before censoring, and the risk set is "time ≥ t".
// ==========================================================================

import { chiSquareCdf, normalInv } from './special';

export interface KMPoint {
  time: number;
  /** S(t) after the drop at this time. */
  survival: number;
  /** Greenwood standard error. */
  se: number;
  ciLow: number;
  ciHigh: number;
  /** Subjects still at risk just before this time. */
  nAtRisk: number;
  nEvents: number;
  nCensored: number;
}

export interface KMResult {
  curve: KMPoint[];
  /** First time S(t) ≤ 0.5, or null when the curve never reaches it. */
  median: number | null;
  ci95: [number, number] | null;
  n: number;
  events: number;
  censored: number;
  /** Total follow-up time. */
  totalTime: number;
}

/**
 * Kaplan–Meier product-limit estimator.
 *
 * The confidence band uses the complementary log–log transform
 *   S(t)^{exp(±z·se/(S|ln S|))},
 * which stays inside [0, 1] and is the default in R's `survfit`.
 */
export function kaplanMeier(times: number[], events: boolean[], alpha = 0.05): KMResult {
  const n = times.length;
  if (n !== events.length) throw new Error('kaplanMeier: times and events lengths must match');
  if (n === 0) throw new Error('kaplanMeier: no observations');
  for (const t of times) {
    if (!Number.isFinite(t) || t < 0) throw new Error('kaplanMeier: times must be finite and ≥ 0');
  }
  const rows = times.map((time, i) => ({ time, event: events[i]! }));
  rows.sort((a, b) => a.time - b.time);

  const z = Math.abs(normalInv(1 - alpha / 2));
  const curve: KMPoint[] = [
    {
      time: 0,
      survival: 1,
      se: 0,
      ciLow: 1,
      ciHigh: 1,
      nAtRisk: n,
      nEvents: 0,
      nCensored: 0,
    },
  ];

  let survival = 1;
  let greenwood = 0;
  let i = 0;
  while (i < rows.length) {
    const t = rows[i]!.time;
    let j = i;
    let d = 0;
    let c = 0;
    while (j < rows.length && rows[j]!.time === t) {
      if (rows[j]!.event) d += 1;
      else c += 1;
      j += 1;
    }
    const atRisk = n - i;
    if (d > 0 && atRisk > 0) {
      survival *= 1 - d / atRisk;
      if (atRisk > d) greenwood += d / (atRisk * (atRisk - d));
    }
    const se = survival * Math.sqrt(greenwood);
    let lo = survival;
    let hi = survival;
    if (survival > 0 && survival < 1) {
      const logLogSe = se / (survival * Math.abs(Math.log(survival)));
      lo = survival ** Math.exp(z * logLogSe);
      hi = survival ** Math.exp(-z * logLogSe);
    } else if (survival <= 0) {
      lo = 0;
      hi = 0;
    }
    curve.push({
      time: t,
      survival,
      se,
      ciLow: Math.min(lo, hi),
      ciHigh: Math.max(lo, hi),
      nAtRisk: atRisk,
      nEvents: d,
      nCensored: c,
    });
    i = j;
  }

  // Median: first event time with S ≤ 0.5.
  let median: number | null = null;
  for (const p of curve) {
    if (p.survival <= 0.5) {
      median = p.time;
      break;
    }
  }
  // Brookmeyer–Crowley interval: `upper` crossing first, then `lower`.
  let medLow: number | null = null;
  let medHigh: number | null = null;
  for (const p of curve) {
    if (medLow === null && p.ciLow <= 0.5) medLow = p.time;
    if (medHigh === null && p.ciHigh <= 0.5) medHigh = p.time;
  }
  const ci95: [number, number] | null =
    medLow !== null && medHigh !== null ? [Math.min(medLow, medHigh), Math.max(medLow, medHigh)] : null;

  let eventCount = 0;
  let censored = 0;
  let totalTime = 0;
  for (let k = 0; k < n; k += 1) {
    if (events[k]) eventCount += 1;
    else censored += 1;
    totalTime += times[k]!;
  }
  return { curve, median, ci95, n, events: eventCount, censored, totalTime };
}

/** Step-function lookup of S(t) (the last point with time ≤ t). */
export function survivalAt(curve: KMPoint[], time: number): number {
  let value = 1;
  for (const p of curve) {
    if (p.time > time) break;
    value = p.survival;
  }
  return value;
}

export interface LogRankResult {
  chiSquare: number;
  df: number;
  pValue: number;
  /** Signed z statistic (positive → group 1 has more events than expected). */
  z: number;
  observed1: number;
  expected1: number;
  observed2: number;
  expected2: number;
  /** Variance of O₁ − E₁ under the null. */
  variance: number;
  /** Cox–Mantel hazard ratio O₁/E₁ ÷ O₂/E₂ (NaN when undefined). */
  hazardRatio: number;
  /** 95% CI for the hazard ratio (log-scale normal approximation). */
  hazardRatioCi95: [number, number] | null;
}

/**
 * Two-sample log-rank (Mantel–Cox) test. At every distinct event time the
 * observed-minus-expected count for group 1 is accumulated together with its
 * hypergeometric variance:
 *   V = Σ n₁n₂d(n−d) / (n²(n−1)).
 */
export function logRankTest(
  group1: { times: number[]; events: boolean[] },
  group2: { times: number[]; events: boolean[] },
): LogRankResult {
  for (const [name, g] of [
    ['group1', group1],
    ['group2', group2],
  ] as const) {
    if (g.times.length !== g.events.length) {
      throw new Error(`logRankTest: ${name} times and events lengths must match`);
    }
    if (g.times.length === 0) throw new Error(`logRankTest: ${name} is empty`);
  }
  const all = new Set<number>();
  for (const t of group1.times) all.add(t);
  for (const t of group2.times) all.add(t);
  const eventTimes = [...all].filter((t) => {
    const in1 = group1.times.some((v, i) => v === t && group1.events[i]);
    const in2 = group2.times.some((v, i) => v === t && group2.events[i]);
    return in1 || in2;
  });
  eventTimes.sort((a, b) => a - b);

  let o1 = 0;
  let e1 = 0;
  let variance = 0;
  let totalEvents = 0;
  for (const t of eventTimes) {
    let n1 = 0;
    let n2 = 0;
    let d1 = 0;
    let d2 = 0;
    for (let i = 0; i < group1.times.length; i += 1) {
      if (group1.times[i]! >= t) n1 += 1;
      if (group1.times[i] === t && group1.events[i]) d1 += 1;
    }
    for (let i = 0; i < group2.times.length; i += 1) {
      if (group2.times[i]! >= t) n2 += 1;
      if (group2.times[i] === t && group2.events[i]) d2 += 1;
    }
    const d = d1 + d2;
    const nRisk = n1 + n2;
    if (d === 0) continue;
    // The terminal risk set can hold a single subject; its event still counts
    // in O − E, but contributes no variance.
    o1 += d1;
    totalEvents += d;
    if (nRisk > 1) {
      e1 += (d * n1) / nRisk;
      variance += (n1 * n2 * d * (nRisk - d)) / (nRisk * nRisk * (nRisk - 1));
    } else {
      e1 += d1;
    }
  }

  const chiSquare = variance > 0 ? (o1 - e1) ** 2 / variance : 0;
  const pValue = 1 - chiSquareCdf(chiSquare, 1);
  const z = variance > 0 ? (o1 - e1) / Math.sqrt(variance) : 0;
  const o2 = totalEvents - o1;
  const e2 = totalEvents - e1;
  const hazardRatio =
    e1 > 0 && e2 > 0 && o1 > 0 && o2 > 0 ? (o1 / e1) / (o2 / e2) : NaN;
  let hazardRatioCi95: [number, number] | null = null;
  if (Number.isFinite(hazardRatio) && variance > 0) {
    const seLogHr = Math.sqrt(1 / o1 + 1 / o2);
    const zc = Math.abs(normalInv(0.975));
    hazardRatioCi95 = [
      Math.exp(Math.log(hazardRatio) - zc * seLogHr),
      Math.exp(Math.log(hazardRatio) + zc * seLogHr),
    ];
  }

  return {
    chiSquare,
    df: 1,
    pValue: Math.min(1, Math.max(0, pValue)),
    z,
    observed1: o1,
    expected1: e1,
    observed2: o2,
    expected2: e2,
    variance,
    hazardRatio,
    hazardRatioCi95,
  };
}
