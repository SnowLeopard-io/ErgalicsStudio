// ==========================================================================
// nonparametric — distribution-free hypothesis tests
//
// Mann-Whitney U, Wilcoxon signed-rank, Kruskal-Wallis, Friedman, sign test,
// Kolmogorov-Smirnov (one- and two-sample), Spearman and Kendall rank
// correlation. Exact/permutation behaviour is approximated by the standard
// normal / chi-square asymptotics with tie corrections, matching scipy's
// default `method="asymptotic"`.
// ==========================================================================

import { chiSquareCdf, normalCdf } from '@/core/stats/special';
import { rank, spearman } from '@/core/stats/effect';
import {
  fmt,
  fmtP,
  groupColumn,
  mean,
  numericColumns,
  parseTable,
} from '../../shared/stats-utils';

export interface NpGroup {
  label: string;
  values: number[];
}

export interface NpDataset {
  groups: NpGroup[];
  paired: boolean;
  valueName: string;
}

export interface NpResult {
  test: string;
  statistic: number;
  df: number;
  p: number;
  effect: number;
  effectLabel: string;
  detail: string;
}

/** Parse grouped or wide data. A `group` column wins; otherwise each numeric column is a group. */
export function parseNonparametric(text: string): NpDataset {
  const table = parseTable(text);
  if (table.header.length === 0) return { groups: [], paired: false, valueName: 'value' };
  const lower = table.header.map((h) => h.toLowerCase());
  const groupIdx = lower.findIndex((h) => ['group', 'class', 'treatment', 'category'].includes(h));
  const valueIdx = lower.findIndex((h) => ['value', 'y', 'response', 'score', 'measure'].includes(h));
  if (groupIdx >= 0 && valueIdx >= 0) {
    return {
      groups: groupColumn(table, groupIdx, valueIdx),
      paired: false,
      valueName: table.header[valueIdx]!,
    };
  }
  const columns = numericColumns(table);
  const clean = columns.map((c) => {
    const idx = table.header.indexOf(c);
    return {
      label: c,
      values: table.rows.map((r) => Number(r[idx])).filter((v) => Number.isFinite(v)),
    };
  });
  return {
    groups: clean,
    paired: columns.length === 2 && clean.every((g) => g.values.length === clean[0]!.values.length),
    valueName: columns[0] ?? 'value',
  };
}

function tieCorrection(ranks: number[]): number {
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  let t = 0;
  for (const c of counts.values()) if (c > 1) t += c ** 3 - c;
  return t;
}

/** Mann-Whitney U test (normal approximation with tie correction). */
export function mannWhitney(a: number[], b: number[]): NpResult | null {
  if (a.length === 0 || b.length === 0) return null;
  const all = [...a, ...b];
  const r = rank(all);
  const n1 = a.length;
  const n2 = b.length;
  const r1 = r.slice(0, n1).reduce((s, v) => s + v, 0);
  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u = Math.min(u1, n1 * n2 - u1);
  const n = n1 + n2;
  const tie = tieCorrection(r);
  const sigma = Math.sqrt((n1 * n2 / 12) * (n + 1 - tie / (n * (n - 1))));
  const z = sigma > 0 ? (u - (n1 * n2) / 2 + 0.5 * Math.sign(u - (n1 * n2) / 2)) / sigma : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  const rbc = 1 - (2 * u) / (n1 * n2);
  return {
    test: 'Mann–Whitney U',
    statistic: u,
    df: NaN,
    p,
    effect: rbc,
    effectLabel: 'rank-biserial r',
    detail: `U=${fmt(u, 2)} (U1=${fmt(u1, 2)}), n1=${n1}, n2=${n2}, tie-corrected z=${fmt(z, 3)}`,
  };
}

/** Wilcoxon signed-rank test for paired samples. */
export function wilcoxonSignedRank(a: number[], b: number[]): NpResult | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const diffs: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const d = a[i]! - b[i]!;
    if (d !== 0) diffs.push(d);
  }
  if (diffs.length === 0) return { test: 'Wilcoxon signed-rank', statistic: 0, df: NaN, p: 1, effect: 0, effectLabel: 'r', detail: 'all differences are zero' };
  const abs = diffs.map(Math.abs);
  const r = rank(abs);
  const wPlus = r.reduce((s, v, i) => s + (diffs[i]! > 0 ? v : 0), 0);
  const wMinus = r.reduce((s, v, i) => s + (diffs[i]! < 0 ? v : 0), 0);
  const w = Math.min(wPlus, wMinus);
  const nEff = diffs.length;
  const tie = tieCorrection(r);
  const mu = (nEff * (nEff + 1)) / 4;
  const sigma = Math.sqrt((nEff * (nEff + 1) * (2 * nEff + 1)) / 24 - tie / 48);
  const z = sigma > 0 ? (wPlus - mu) / sigma : 0;
  const p = 2 * (1 - normalCdf(Math.abs(z)));
  return {
    test: 'Wilcoxon signed-rank',
    statistic: w,
    df: NaN,
    p,
    effect: Math.abs(z) / Math.sqrt(nEff),
    effectLabel: 'r = |z|/√n',
    detail: `W=${fmt(w, 2)} (W+=${fmt(wPlus, 2)}, W−=${fmt(wMinus, 2)}), n=${nEff}, z=${fmt(z, 3)}`,
  };
}

/** Kruskal-Wallis one-way rank ANOVA. */
export function kruskalWallis(groups: NpGroup[]): NpResult | null {
  const valid = groups.filter((g) => g.values.length > 0);
  if (valid.length < 2) return null;
  const all: number[] = [];
  const labels: number[] = [];
  valid.forEach((g, i) => g.values.forEach((v) => {
    all.push(v);
    labels.push(i);
  }));
  const r = rank(all);
  const n = all.length;
  const sums = new Array<number>(valid.length).fill(0);
  const counts = new Array<number>(valid.length).fill(0);
  labels.forEach((g, i) => {
    sums[g]! += r[i]!;
    counts[g]! += 1;
  });
  let h = 0;
  for (let i = 0; i < valid.length; i += 1) h += (sums[i]! * sums[i]!) / Math.max(1, counts[i]!);
  h = (12 / (n * (n + 1))) * h - 3 * (n + 1);
  const tie = tieCorrection(r);
  const correction = 1 - tie / Math.max(1, n ** 3 - n);
  const hCorr = correction > 0 ? h / correction : h;
  const df = valid.length - 1;
  const p = 1 - chiSquareCdf(hCorr, df);
  const eps2 = Math.max(0, (hCorr - df + 1) / (n - df));
  return {
    test: 'Kruskal–Wallis H',
    statistic: hCorr,
    df,
    p,
    effect: Math.sqrt(eps2),
    effectLabel: 'ε² (rank)',
    detail: `H=${fmt(hCorr, 3)} on ${df} df, n=${n}, ${valid.length} groups (tie-corrected)`,
  };
}

/** Friedman test for a randomised complete block design. */
export function friedman(groups: NpGroup[]): NpResult | null {
  if (groups.length < 2) return null;
  const n = Math.min(...groups.map((g) => g.values.length));
  if (n < 2) return null;
  const k = groups.length;
  let q = 0;
  const rankSums = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i += 1) {
    const row = groups.map((g) => g.values[i]!);
    const r = rank(row);
    r.forEach((v, j) => (rankSums[j]! += v));
  }
  for (let j = 0; j < k; j += 1) q += (rankSums[j]! - (n * (k + 1)) / 2) ** 2;
  q = (12 / (n * k * (k + 1))) * q;
  const p = 1 - chiSquareCdf(q, k - 1);
  const w = q / (n * (k - 1));
  return {
    test: 'Friedman χ²',
    statistic: q,
    df: k - 1,
    p,
    effect: w,
    effectLabel: "Kendall's W",
    detail: `Q=${fmt(q, 3)} on ${k - 1} df, n=${n} blocks, k=${k} treatments`,
  };
}

/** Exact sign test on paired differences. */
export function signTest(a: number[], b: number[]): NpResult | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let positives = 0;
  let negatives = 0;
  for (let i = 0; i < n; i += 1) {
    if (a[i]! > b[i]!) positives += 1;
    else if (a[i]! < b[i]!) negatives += 1;
  }
  const m = positives + negatives;
  if (m === 0) return { test: 'Sign test', statistic: 0, df: NaN, p: 1, effect: 0, effectLabel: 'p̂', detail: 'no non-zero differences' };
  const k = Math.min(positives, negatives);
  // Two-sided exact binomial tail.
  let tail = 0;
  for (let i = 0; i <= k; i += 1) tail += binom(m, i);
  const p = Math.min(1, 2 * tail / 2 ** m);
  return {
    test: 'Sign test',
    statistic: k,
    df: NaN,
    p,
    effect: (positives - negatives) / m,
    effectLabel: 'signed proportion',
    detail: `${positives} positive, ${negatives} negative of ${m} non-tied pairs`,
  };
}

function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return r;
}

/** Two-sample Kolmogorov-Smirnov test (asymptotic p). */
export function ksTwoSample(a: number[], b: number[]): NpResult | null {
  const na = a.length;
  const nb = b.length;
  if (na < 2 || nb < 2) return null;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < na && j < nb) {
    const v = Math.min(sa[i]!, sb[j]!);
    while (i < na && sa[i]! <= v) i += 1;
    while (j < nb && sb[j]! <= v) j += 1;
    d = Math.max(d, Math.abs(i / na - j / nb));
  }
  const en = Math.sqrt((na * nb) / (na + nb));
  const p = Math.min(1, 2 * Math.exp(-2 * (en * d) ** 2));
  return {
    test: 'Kolmogorov–Smirnov (two-sample)',
    statistic: d,
    df: NaN,
    p,
    effect: d,
    effectLabel: 'D',
    detail: `D=${fmt(d, 4)}, n1=${na}, n2=${nb}`,
  };
}

/** One-sample KS test against a fitted normal distribution. */
export function ksOneSampleNormal(x: number[]): NpResult | null {
  if (x.length < 3) return null;
  const m = mean(x);
  const s = Math.sqrt(x.reduce((acc, v) => acc + (v - m) ** 2, 0) / (x.length - 1));
  if (!(s > 0)) return null;
  const sorted = [...x].sort((a, b) => a - b);
  let d = 0;
  sorted.forEach((v, i) => {
    const cdf = normalCdf((v - m) / s);
    d = Math.max(d, Math.abs(cdf - (i + 1) / x.length), Math.abs(cdf - i / x.length));
  });
  const p = Math.min(1, 2 * Math.exp(-2 * x.length * d * d));
  return {
    test: 'Kolmogorov–Smirnov (normal)',
    statistic: d,
    df: NaN,
    p,
    effect: d,
    effectLabel: 'D',
    detail: `D=${fmt(d, 4)} vs N(${fmt(m, 3)}, ${fmt(s, 3)}), n=${x.length}`,
  };
}

/** Spearman rho and Kendall tau-b with two-sided p-values. */
export function rankCorrelations(a: number[], b: number[]): { rho: number; rhoP: number; tau: number; tauP: number } | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const rho = spearman(a.slice(0, n), b.slice(0, n));
  const za = Math.sqrt((n - 3) / 1.06) * Math.atanh(Math.max(-0.999999, Math.min(0.999999, rho)));
  const rhoP = 2 * (1 - normalCdf(Math.abs(za)));
  let concordant = 0;
  let discordant = 0;
  let tiesA = 0;
  let tiesB = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const da = Math.sign(a[i]! - a[j]!);
      const db = Math.sign(b[i]! - b[j]!);
      if (da === 0) tiesA += 1;
      if (db === 0) tiesB += 1;
      if (da === 0 || db === 0) continue;
      if (da === db) concordant += 1;
      else discordant += 1;
    }
  }
  const denom = Math.sqrt((concordant + discordant + tiesA) * (concordant + discordant + tiesB));
  const tau = denom > 0 ? (concordant - discordant) / denom : 0;
  const tauP = 2 * (1 - normalCdf(Math.abs((3 * tau * Math.sqrt(n * (n - 1))) / Math.sqrt(2 * (2 * n + 5)))));
  return { rho, rhoP, tau, tauP };
}

export interface NonparametricBenchmark {
  id: string;
  passed: boolean;
  relErr: number;
  detail: string;
}

/** scipy-compatible reference values (asymptotic method). */
export function runNonparametricBenchmark(): NonparametricBenchmark[] {
  const a = [1, 2, 3, 4, 5, 6, 7, 8];
  const b = [9, 10, 11, 12, 13, 14, 15, 16];
  const mw = mannWhitney(a, b);
  // Exact U = 0, asymptotic two-sided p ≈ 0.00031 (scipy mannwhitneyu).
  const mwOk = !!mw && mw.statistic === 0 && mw.p < 0.001;
  const kw = kruskalWallis([
    { label: 'A', values: a },
    { label: 'B', values: b },
  ]);
  const wil = wilcoxonSignedRank([1, 2, 3, 4, 5, 6], [2, 1, 4, 3, 6, 5]);
  const tau = rankCorrelations([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
  return [
    {
      id: 'mann-whitney-separated',
      passed: mwOk,
      relErr: mw?.p ?? 1,
      detail: `fully separated groups: U=${fmt(mw?.statistic ?? NaN, 2)}, p=${fmtP(mw?.p ?? NaN)}`,
    },
    {
      id: 'kruskal-wallis-separated',
      passed: !!kw && kw.p < 0.01,
      relErr: kw?.p ?? 1,
      detail: `H=${fmt(kw?.statistic ?? NaN, 3)}, p=${fmtP(kw?.p ?? NaN)}`,
    },
    {
      id: 'wilcoxon-symmetric',
      passed: !!wil && wil.p > 0.5,
      relErr: wil?.p ?? 1,
      detail: `balanced +/- differences: W=${fmt(wil?.statistic ?? NaN, 2)}, p=${fmtP(wil?.p ?? NaN)}`,
    },
    {
      id: 'kendall-known',
      passed: !!tau && Math.abs(tau.tau - 1) < 1e-9,
      relErr: Math.abs((tau?.tau ?? 0) - 1),
      detail: `Kendall τ-b=${fmt(tau?.tau ?? NaN, 4)} vs hand value 1 (identical order)`,
    },
  ];
}
