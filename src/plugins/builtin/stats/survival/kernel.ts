// ==========================================================================
// survival — Kaplan-Meier, log-rank and Cox proportional hazards
//
// Right-censored survival data: product-limit estimation with Greenwood
// variance and log-log confidence bands, the k-sample log-rank test, and a
// Cox PH fit by Newton-Raphson with Breslow handling of tied event times.
// ==========================================================================

import { chiSquareCdf, normalInv } from '@/core/stats/special';
import {
  fmt,
  invert,
  mean,
  parseTable,
  type Matrix,
} from '../../shared/stats-utils';

export interface SurvivalDataset {
  time: number[];
  event: boolean[];
  groups: string[] | null;
  groupName: string | null;
  covariates: { names: string[]; rows: Matrix } | null;
}

const TIME_NAMES = ['time', 'duration', 't', 'followup', 'follow_up', 'days', 'months'];
const EVENT_NAMES = ['event', 'status', 'dead', 'death', 'observed', 'censored'];
const GROUP_NAMES = ['group', 'arm', 'treatment', 'class', 'stratum'];

function eventValue(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (!v) return true;
  if (['0', 'false', 'no', 'censored', 'c', 'alive', 'right'].includes(v)) return false;
  return true;
}

/** Parse `time,event[,group][,covariates…]`. */
export function parseSurvival(text: string): SurvivalDataset {
  const table = parseTable(text);
  if (table.header.length === 0) return { time: [], event: [], groups: null, groupName: null, covariates: null };
  const lower = table.header.map((h) => h.toLowerCase());
  let timeIdx = lower.findIndex((h) => TIME_NAMES.includes(h));
  let eventIdx = lower.findIndex((h) => EVENT_NAMES.includes(h));
  if (timeIdx < 0) timeIdx = 0;
  if (eventIdx < 0) eventIdx = 1;
  const groupIdx = lower.findIndex((h) => GROUP_NAMES.includes(h));
  const time: number[] = [];
  const event: boolean[] = [];
  const groups: string[] = [];
  const covNames: string[] = [];
  const covIdx: number[] = [];
  for (let i = 0; i < table.header.length; i += 1) {
    if (i === timeIdx || i === eventIdx || i === groupIdx) continue;
    const values = table.rows.map((r) => Number(r[i]));
    const ok = values.filter((v) => Number.isFinite(v)).length;
    if (ok >= Math.max(2, table.rows.length * 0.7)) {
      covNames.push(table.header[i]!);
      covIdx.push(i);
    }
  }
  for (const row of table.rows) {
    const t = Number(row[timeIdx]);
    if (!Number.isFinite(t) || t < 0) continue;
    time.push(t);
    event.push(eventValue(String(row[eventIdx] ?? '1')));
    if (groupIdx >= 0) groups.push(String(row[groupIdx] ?? 'group'));
  }
  const covRows: Matrix = [];
  if (covIdx.length > 0) {
    for (const row of table.rows) {
      const t = Number(row[timeIdx]);
      if (!Number.isFinite(t) || t < 0) continue;
      const rec = covIdx.map((i) => Number(row[i]));
      if (rec.some((v) => !Number.isFinite(v))) continue;
      covRows.push(rec);
    }
  }
  return {
    time,
    event,
    groups: groupIdx >= 0 ? groups : null,
    groupName: groupIdx >= 0 ? table.header[groupIdx]! : null,
    covariates: covIdx.length > 0 && covRows.length === time.length ? { names: covNames, rows: covRows } : null,
  };
}

export interface KmPoint {
  time: number;
  nRisk: number;
  events: number;
  survival: number;
  se: number;
  lo: number;
  hi: number;
}

export interface KmCurve {
  label: string;
  points: KmPoint[];
  median: number;
  /** Number of events / censored observations. */
  events: number;
  censored: number;
}

/** Kaplan-Meier product-limit estimator with Greenwood variance and log-log CI. */
export function kaplanMeier(time: number[], event: boolean[], label = 'all', conf = 0.95): KmCurve {
  const n = Math.min(time.length, event.length);
  const rows = Array.from({ length: n }, (_, i) => ({ t: time[i]!, e: event[i]! })).sort((a, b) => a.t - b.t);
  const z = normalInv(1 - (1 - conf) / 2);
  const points: KmPoint[] = [{ time: 0, nRisk: n, events: 0, survival: 1, se: 0, lo: 1, hi: 1 }];
  let s = 1;
  let greenwood = 0;
  let totalEvents = 0;
  let censored = 0;
  let i = 0;
  while (i < rows.length) {
    const t = rows[i]!.t;
    let d = 0;
    let c = 0;
    while (i < rows.length && rows[i]!.t === t) {
      if (rows[i]!.e) d += 1;
      else c += 1;
      i += 1;
    }
    const nRisk = rows.length - (i - d - c);
    if (d > 0 && nRisk > 0) {
      s *= 1 - d / nRisk;
      greenwood += d / (nRisk * (nRisk - d || 1));
      totalEvents += d;
    }
    if (d === 0) censored += c;
    const se = s * Math.sqrt(greenwood);
    let lo = 0;
    let hi = 1;
    if (s > 0 && s < 1 && se > 0) {
      const loglog = Math.log(-Math.log(s));
      const half = (z * Math.sqrt(greenwood)) / Math.abs(Math.log(s));
      lo = Math.exp(-Math.exp(loglog + half));
      hi = Math.exp(-Math.exp(loglog - half));
    }
    points.push({ time: t, nRisk, events: d, survival: s, se, lo, hi });
  }
  let median = NaN;
  for (const p of points) {
    if (p.survival <= 0.5) {
      median = p.time;
      break;
    }
  }
  return { label, points, median, events: totalEvents, censored };
}

export interface LogRankResult {
  chi2: number;
  df: number;
  p: number;
  observed: number[];
  expected: number[];
  labels: string[];
  detail: string;
}

/** k-sample log-rank test. */
export function logRank(time: number[], event: boolean[], groups: string[]): LogRankResult | null {
  const n = Math.min(time.length, event.length, groups.length);
  if (n < 4) return null;
  const labels = [...new Set(groups.slice(0, n))].sort();
  if (labels.length < 2) return null;
  const index = new Map(labels.map((l, i) => [l, i]));
  const times = [...new Set(Array.from({ length: n }, (_, i) => (event[i] ? time[i]! : NaN)).filter((v) => Number.isFinite(v)))].sort((a, b) => a - b);
  const observed = new Array<number>(labels.length).fill(0);
  const expected = new Array<number>(labels.length).fill(0);
  const varMat = Array.from({ length: labels.length }, () => new Array<number>(labels.length).fill(0));
  for (const t of times) {
    const risk = new Array<number>(labels.length).fill(0);
    let nRisk = 0;
    const d = new Array<number>(labels.length).fill(0);
    let dTotal = 0;
    for (let i = 0; i < n; i += 1) {
      if (time[i]! >= t) {
        const g = index.get(groups[i]!)!;
        risk[g]! += 1;
        nRisk += 1;
      }
      if (time[i]! === t && event[i]) {
        const g = index.get(groups[i]!)!;
        d[g]! += 1;
        dTotal += 1;
      }
    }
    if (dTotal === 0 || nRisk === 0) continue;
    for (let g = 0; g < labels.length; g += 1) {
      observed[g]! += d[g]!;
      expected[g]! += (dTotal * risk[g]!) / nRisk;
      for (let h = 0; h < labels.length; h += 1) {
        const cov = ((dTotal * (nRisk - dTotal)) / (nRisk * nRisk * (nRisk - 1 || 1))) * risk[g]! * ((g === h ? nRisk : 0) - risk[h]!);
        varMat[g]![h]! += g === h ? ((dTotal * (nRisk - dTotal)) / (nRisk * nRisk * (nRisk - 1 || 1))) * risk[g]! * (nRisk - risk[g]!) : cov;
      }
    }
  }
  // O-E vector and its covariance; drop the last category.
  const k = labels.length;
  const diff = observed.map((o, g) => o - expected[g]!);
  const v = varMat.slice(0, k - 1).map((row) => row.slice(0, k - 1));
  const inv = invert(v);
  let chi2 = 0;
  if (inv) {
    for (let a = 0; a < k - 1; a += 1) {
      for (let b = 0; b < k - 1; b += 1) chi2 += diff[a]! * inv[a]![b]! * diff[b]!;
    }
  }
  const df = k - 1;
  return {
    chi2,
    df,
    p: 1 - chiSquareCdf(chi2, df),
    observed,
    expected,
    labels,
    detail: `log-rank χ²=${fmt(chi2, 3)} on ${df} df across ${k} groups`,
  };
}

export interface CoxTerm {
  name: string;
  beta: number;
  se: number;
  hr: number;
  lo: number;
  hi: number;
  z: number;
  p: number;
}

export interface CoxResult {
  terms: CoxTerm[];
  logLik: number;
  n: number;
  events: number;
  concordance: number;
  iterations: number;
}

/** Cox proportional-hazards fit (Breslow ties, Newton-Raphson). */
export function coxPH(time: number[], event: boolean[], covariates: Matrix, names: string[]): CoxResult | null {
  const n = Math.min(time.length, event.length, covariates.length);
  if (n < 3) return null;
  const p = covariates[0]?.length ?? 0;
  if (p === 0) return null;
  const x = covariates.slice(0, n).map((row) => [...row]);
  // Centre covariates for numerical stability; the hazard ratio is invariant.
  const means = Array.from({ length: p }, (_, j) => mean(x.map((r) => r[j]!)));
  for (const row of x) for (let j = 0; j < p; j += 1) row[j]! -= means[j]!;
  const t = time.slice(0, n);
  const e = event.slice(0, n);
  let beta = new Array<number>(p).fill(0);
  let logLik = -Infinity;
  let iterations = 0;
  let converged = false;
  for (let iter = 0; iter < 50; iter += 1) {
    iterations = iter + 1;
    const grad = new Array<number>(p).fill(0);
    const hess = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    let ll = 0;
    const eventTimes = [...new Set(t.filter((_, i) => e[i]))].sort((a, b) => a - b);
    for (const time of eventTimes) {
      const idx: number[] = [];
      for (let i = 0; i < n; i += 1) if (t[i]! >= time) idx.push(i);
      const risks = idx.map((i) => {
        const eta = x[i]!.reduce((s, v, j) => s + v * beta[j]!, 0);
        return { i, w: Math.exp(Math.min(40, eta)) };
      });
      const s0 = risks.reduce((s, r) => s + r.w, 0);
      if (s0 <= 0) continue;
      const s1 = new Array<number>(p).fill(0);
      for (const r of risks) for (let j = 0; j < p; j += 1) s1[j]! += r.w * x[r.i]![j]!;
      const s2 = Array.from({ length: p }, () => new Array<number>(p).fill(0));
      for (const r of risks) {
        for (let a = 0; a < p; a += 1) for (let b = 0; b < p; b += 1) s2[a]![b]! += r.w * x[r.i]![a]! * x[r.i]![b]!;
      }
      const events = idx.filter((i) => t[i] === time && e[i]);
      const d = events.length;
      if (d === 0) continue;
      for (const i of events) {
        const eta = x[i]!.reduce((s, v, j) => s + v * beta[j]!, 0);
        ll += eta - Math.log(s0);
        for (let j = 0; j < p; j += 1) grad[j]! += x[i]![j]! - s1[j]! / s0;
      }
      for (let a = 0; a < p; a += 1) {
        for (let b = 0; b < p; b += 1) {
          hess[a]![b]! += d * (s2[a]![b]! / s0 - (s1[a]! * s1[b]!) / (s0 * s0));
        }
      }
    }
    // Newton step: beta += inv(-H) g
    const inv = invert(hess);
    if (!inv) break;
    const step = inv.map((row) => row.reduce((s, v, j) => s + v * grad[j]!, 0));
    const maxStep = Math.max(...step.map(Math.abs));
    const scale = maxStep > 1 ? 1 / maxStep : 1;
    beta = beta.map((v, j) => v + step[j]! * scale * 0.8);
    if (maxStep < 1e-7) {
      logLik = ll;
      converged = true;
      break;
    }
    logLik = ll;
  }
  // Covariance = inv(-H) at the final beta.
  const hess = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  const eventTimes = [...new Set(t.filter((_, i) => e[i]))].sort((a, b) => a - b);
  for (const time of eventTimes) {
    const idx: number[] = [];
    for (let i = 0; i < n; i += 1) if (t[i]! >= time) idx.push(i);
    const risks = idx.map((i) => {
      const eta = x[i]!.reduce((s, v, j) => s + v * beta[j]!, 0);
      return { i, w: Math.exp(Math.min(40, eta)) };
    });
    const s0 = risks.reduce((s, r) => s + r.w, 0);
    if (s0 <= 0) continue;
    const s1 = new Array<number>(p).fill(0);
    for (const r of risks) for (let j = 0; j < p; j += 1) s1[j]! += r.w * x[r.i]![j]!;
    const s2 = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (const r of risks) {
      for (let a = 0; a < p; a += 1) for (let b = 0; b < p; b += 1) s2[a]![b]! += r.w * x[r.i]![a]! * x[r.i]![b]!;
    }
    const d = idx.filter((i) => t[i] === time && e[i]).length;
    for (let a = 0; a < p; a += 1) {
      for (let b = 0; b < p; b += 1) hess[a]![b]! += d * (s2[a]![b]! / s0 - (s1[a]! * s1[b]!) / (s0 * s0));
    }
  }
  const cov = invert(hess);
  const zCrit = normalInv(0.975);
  const terms: CoxTerm[] = names.slice(0, p).map((name, j) => {
    const se = Math.sqrt(Math.max(1e-30, cov?.[j]?.[j] ?? 0));
    const z = beta[j]! / se;
    return {
      name,
      beta: beta[j]!,
      se,
      hr: Math.exp(beta[j]!),
      lo: Math.exp(beta[j]! - zCrit * se),
      hi: Math.exp(beta[j]! + zCrit * se),
      z,
      p: 2 * (1 - normalCdfLocal(Math.abs(z))),
    };
  });
  // Harrell's concordance (pairs with differing survival times).
  let concordant = 0;
  let comparable = 0;
  for (let i = 0; i < n; i += 1) {
    if (!e[i]) continue;
    for (let j = 0; j < n; j += 1) {
      if (i === j || t[j]! <= t[i]!) continue;
      comparable += 1;
      const ri = x[i]!.reduce((s, v, k) => s + v * beta[k]!, 0);
      const rj = x[j]!.reduce((s, v, k) => s + v * beta[k]!, 0);
      if (ri > rj) concordant += 1;
      else if (ri === rj) concordant += 0.5;
    }
  }
  return {
    terms,
    logLik,
    n,
    events: e.filter(Boolean).length,
    concordance: comparable > 0 ? concordant / comparable : NaN,
    iterations: converged ? iterations : -iterations,
  };
}

function normalCdfLocal(x: number): number {
  // Abramowitz & Stegun 7.1.26.
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

export interface SurvivalBenchmark {
  id: string;
  passed: boolean;
  relErr: number;
  detail: string;
}

/** Hand-computed KM / log-rank checks plus a Cox hazard-ratio recovery. */
export function runSurvivalBenchmark(): SurvivalBenchmark[] {
  const time = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const event = [true, true, false, true, true, false, true, true, true, false];
  const km = kaplanMeier(time, event);
  // S(3) = 8/10 * 7/9 * ... ; compare against an independent product.
  const atRisk = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  let s = 1;
  for (let i = 0; i < time.length; i += 1) if (event[i]) s *= 1 - 1 / atRisk[i]!;
  const kmErr = Math.abs(s - km.points.at(-1)!.survival);
  const groups = ['A', 'A', 'B', 'B', 'A', 'B', 'A', 'B', 'A', 'B'];
  const lr = logRank(time, event, groups);
  // Cox on simulated exponential hazards with HR ≈ 2.0.
  let seed = 20261029;
  const rand = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const cov: Matrix = [];
  const ct: number[] = [];
  const ce: boolean[] = [];
  for (let i = 0; i < 400; i += 1) {
    const x = i % 2;
    const rate = x === 0 ? 0.05 : 0.1;
    const u = Math.max(1e-9, rand());
    const trueT = -Math.log(u) / rate;
    const censor = -Math.log(Math.max(1e-9, rand())) / 0.03;
    cov.push([x]);
    ct.push(Math.min(trueT, censor));
    ce.push(trueT <= censor);
  }
  const cox = coxPH(ct, ce, cov, ['group']);
  const hr = cox?.terms[0]?.hr ?? NaN;
  return [
    {
      id: 'km-hand-product',
      passed: kmErr < 1e-9,
      relErr: kmErr,
      detail: `KM final survival ${fmt(km.points.at(-1)!.survival, 5)} vs hand product ${fmt(s, 5)}`,
    },
    {
      id: 'logrank-computable',
      passed: !!lr && Number.isFinite(lr.chi2) && lr.df === 1,
      relErr: 0,
      detail: `log-rank χ²=${fmt(lr?.chi2 ?? NaN, 3)}, p=${fmt(lr?.p ?? NaN, 4)}`,
    },
    {
      id: 'cox-hr-recovery',
      passed: !!cox && Math.abs(hr - 2) < 0.35,
      relErr: Math.abs(hr - 2) / 2,
      detail: `Cox HR ${fmt(hr, 3)} vs true 2.0 (400 seeded observations, 30 % censoring)`,
    },
  ];
}
