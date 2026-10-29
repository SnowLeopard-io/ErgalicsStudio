// ==========================================================================
// med-biostat — biostatistics kernel (pure functions, no DOM, unit-testable)
//
// Sample size / power (superiority, non-inferiority, equivalence TOST; means
// and two proportions), seeded randomization plans (fixed / random-length
// block, stratified block, Pocock-Simon minimization), two-arm endpoint
// inference (Welch t with CI and Cohen's d; risk difference with Pearson
// chi-square and Fisher's exact test), Lan-DeMets alpha-spending boundaries
// (O'Brien-Fleming and Pocock) computed on the canonical score process, and
// pharmacovigilance PRR signal screening. Distribution primitives (incomplete
// gamma/beta, normal, Student-t, chi-square) come from @/core/stats/special.
//
// All large-sample formulas are the standard teaching approximations (normal
// / Wald / Lan-DeMets); nothing here is a substitute for a certified trial
// design package or a clinical decision system.
// ==========================================================================

import { logGamma, normalCdf, normalInv, studentTCdf, studentTInv, chiSquareCdf } from '@/core/stats/special';
import { mulberry32 } from '@/core/repro/random';

// ---- generic delimited-table helpers --------------------------------------

export type Delimiter = ',' | '\t' | ';';

/** Non-empty, non-comment lines ('#' comments are skipped). */
export function dataLines(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.charCodeAt(0) === 35 /* '#' */) continue;
    out.push(line);
  }
  return out;
}

function countChar(s: string, ch: string): number {
  let c = 0;
  for (let i = 0; i < s.length; i += 1) if (s[i] === ch) c += 1;
  return c;
}

/** Sniff the delimiter of a delimited table from its first line. */
export function detectDelimiter(line: string | undefined): Delimiter {
  if (!line) return ',';
  const opts: Array<[Delimiter, number]> = [
    [',', countChar(line, ',')],
    ['\t', countChar(line, '\t')],
    [';', countChar(line, ';')],
  ];
  opts.sort((a, b) => b[1] - a[1]);
  return opts[0]![1] > 0 ? opts[0]![0] : ',';
}

/** Lowercase and strip non-alphanumerics so `endpoint_primary` -> `endpointprimary`. */
function normName(s: string): string {
  return s.trim().toLowerCase().replace(/^["']|["']$/g, '').replace(/[^a-z0-9]/g, '');
}

function findColumn(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const i = headers.indexOf(c);
    if (i >= 0) return i;
  }
  return -1;
}

export interface RawTable {
  headers: string[];
  rows: string[][];
}

/** Parse a headered delimited table; returns null without a header row. */
export function splitTable(text: string): RawTable | null {
  const lines = dataLines(text);
  if (lines.length < 2) return null;
  const delim = detectDelimiter(lines[0]);
  const headers = lines[0]!.split(delim).map(normName);
  if (headers.every((h) => h === '')) return null;
  const rows: string[][] = [];
  for (let i = 1; i < lines.length; i += 1) rows.push(lines[i]!.split(delim).map((c) => c.trim().replace(/^["']|["']$/g, '')));
  return { headers, rows };
}

function numOf(s: string | undefined): number {
  if (s === undefined || s === '') return NaN;
  const v = Number(s);
  return Number.isFinite(v) ? v : NaN;
}

// ---- power / sample size ---------------------------------------------------

export type Objective = 'superiority' | 'noninferiority' | 'equivalence';
export type EndpointKind = 'means' | 'proportions';

export interface PowerSpec {
  objective: Objective;
  endpoint: EndpointKind;
  /** Two-sided for superiority, one-sided for non-inferiority / TOST. */
  alpha: number;
  /** Target 1 - beta. */
  power: number;
  /** Continuous endpoints: common SD. */
  sigma: number;
  /**
   * Expected effect: superiority uses it as the alternative difference;
   * non-inferiority / equivalence treat |delta| as the assumed true
   * difference that erodes the margin (0 = equal true efficacy).
   */
  delta: number;
  /** Non-inferiority / equivalence margin on the mean or risk-difference scale. */
  margin: number;
  /** Binary endpoints: control (p1) and treatment (p2) expected rates. */
  p1: number;
  p2: number;
  /** Allocation ratio n_treatment / n_control. */
  ratio: number;
}

export interface SampleSizeResult {
  nControl: number;
  nTreat: number;
  nControlRaw: number;
  nTreatRaw: number;
  achievedPower: number;
  zAlpha: number;
  zBeta: number;
  /** Margin actually used by the formula (delta for superiority, margin-|delta| otherwise). */
  effectiveDelta: number;
  totalN: number;
}

/** One-sided alpha for NI/TOST, two-sided for superiority. */
export function zAlphaFor(spec: PowerSpec): number {
  return spec.objective === 'superiority' ? normalInv(1 - spec.alpha / 2) : normalInv(1 - spec.alpha);
}

/** Margin minus the assumed true difference (NI / equivalence only). */
export function effectiveMargin(spec: PowerSpec): number {
  const d = spec.endpoint === 'means' ? Math.abs(spec.delta) : Math.abs(spec.p1 - spec.p2);
  return spec.margin - d;
}

/** Two-sided normal-approx power of the relevant test at a given pair of n. */
export function achievedPower(spec: PowerSpec, nControl: number, nTreat: number): number {
  if (!(nControl >= 2 && nTreat >= 2)) return 0;
  const za = zAlphaFor(spec);
  if (spec.endpoint === 'means') {
    const se = Math.abs(spec.sigma) * Math.sqrt(1 / nControl + 1 / nTreat);
    if (se <= 0) return 0;
    if (spec.objective === 'superiority') {
      return normalCdf(Math.abs(spec.delta) / se - za);
    }
    const eff = effectiveMargin(spec);
    if (eff <= 0) return 0;
    const hi = normalCdf(eff / se - za);
    if (spec.objective === 'noninferiority') return hi;
    // Equivalence (TOST): both one-sided tests must pass.
    const lo = normalCdf((eff + 2 * Math.abs(spec.delta)) / se - za);
    return Math.min(1, Math.max(0, hi + lo - 1));
  }
  const q1 = spec.p1 * (1 - spec.p1);
  const q2 = spec.p2 * (1 - spec.p2);
  const se = Math.sqrt(q1 / nControl + q2 / nTreat);
  if (!(se > 0)) return 0;
  const diff = Math.abs(spec.p1 - spec.p2);
  if (spec.objective === 'superiority') return normalCdf(diff / se - za);
  const eff = effectiveMargin(spec);
  if (eff <= 0) return 0;
  const hi = normalCdf(eff / se - za);
  if (spec.objective === 'noninferiority') return hi;
  const lo = normalCdf((eff + 2 * diff) / se - za);
  return Math.min(1, Math.max(0, hi + lo - 1));
}

/**
 * Closed-form (normal-approximation) sample size per group for the requested
 * power. Returns null when the inputs cannot yield a design (non-positive
 * effect, margin consumed by the assumed true difference, bad ratio).
 */
export function sampleSizeForPower(spec: PowerSpec): SampleSizeResult | null {
  if (!(spec.alpha > 0 && spec.alpha < 1 && spec.power > 0 && spec.power < 1)) return null;
  const r = spec.ratio > 0 ? spec.ratio : 1;
  const za = zAlphaFor(spec);
  // Equivalence (TOST) power is 2*Phi(x) - 1 at delta = 0, so the beta
  // quantile enters as z_(1 - beta/2), not z_(1 - beta).
  const zb =
    spec.objective === 'equivalence'
      ? normalInv(1 - (1 - spec.power) / 2)
      : normalInv(spec.power);
  const k = za + zb;
  let nControlRaw: number;
  let eff: number;
  if (spec.endpoint === 'means') {
    if (!(spec.sigma > 0)) return null;
    if (spec.objective === 'superiority') {
      eff = Math.abs(spec.delta);
      if (!(eff > 0)) return null;
      nControlRaw = ((1 + 1 / r) * spec.sigma * spec.sigma * k * k) / (eff * eff);
    } else {
      eff = effectiveMargin(spec);
      if (!(eff > 0)) return null;
      nControlRaw = ((1 + 1 / r) * spec.sigma * spec.sigma * k * k) / (eff * eff);
    }
  } else {
    const q1 = spec.p1 * (1 - spec.p1);
    const q2 = spec.p2 * (1 - spec.p2);
    const pBar = (spec.p1 + r * spec.p2) / (1 + r);
    const qBar = 1 - pBar;
    const diff = Math.abs(spec.p1 - spec.p2);
    if (spec.objective === 'superiority') {
      eff = diff;
      if (!(eff > 0)) return null;
    } else {
      eff = effectiveMargin(spec);
      if (!(eff > 0)) return null;
    }
    const num = za * Math.sqrt((1 + 1 / r) * pBar * qBar) + zb * Math.sqrt(q1 + q2 / r);
    nControlRaw = (num * num) / (eff * eff);
  }
  const nControl = Math.max(2, Math.ceil(nControlRaw));
  const nTreat = Math.max(2, Math.ceil(nControlRaw * r));
  return {
    nControl,
    nTreat,
    nControlRaw,
    nTreatRaw: nControlRaw * r,
    achievedPower: achievedPower(spec, nControl, nTreat),
    zAlpha: za,
    zBeta: zb,
    effectiveDelta: eff,
    totalN: nControl + nTreat,
  };
}

// ---- two-arm inference -----------------------------------------------------

export interface WelchResult {
  n1: number;
  n2: number;
  mean1: number;
  mean2: number;
  sd1: number;
  sd2: number;
  diff: number;
  se: number;
  df: number;
  t: number;
  p: number;
  ciLo: number;
  ciHi: number;
  cohensD: number;
}

function meanOf(v: number[]): number {
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

function varOf(v: number[]): number {
  const m = meanOf(v);
  let s = 0;
  for (const x of v) s += (x - m) * (x - m);
  return s / (v.length - 1);
}

/** Welch two-sample t test with 95% CI of the difference and Cohen's d. */
export function welchTwoSample(a: number[], b: number[], alpha = 0.05): WelchResult | null {
  const aa = a.filter((v) => Number.isFinite(v));
  const bb = b.filter((v) => Number.isFinite(v));
  if (aa.length < 2 || bb.length < 2) return null;
  const n1 = aa.length;
  const n2 = bb.length;
  const m1 = meanOf(aa);
  const m2 = meanOf(bb);
  const v1 = varOf(aa);
  const v2 = varOf(bb);
  if (!(v1 > 0 && v2 > 0)) return null;
  const se = Math.sqrt(v1 / n1 + v2 / n2);
  const t = (m1 - m2) / se;
  const sa = v1 / n1;
  const sb = v2 / n2;
  const denom = (sa * sa) / (n1 - 1) + (sb * sb) / (n2 - 1);
  const df = (sa + sb) * (sa + sb) / denom;
  const p = 2 * (1 - studentTCdf(Math.abs(t), df));
  const tc = studentTInv(1 - alpha / 2, df);
  const sp = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2));
  return {
    n1,
    n2,
    mean1: m1,
    mean2: m2,
    sd1: Math.sqrt(v1),
    sd2: Math.sqrt(v2),
    diff: m1 - m2,
    se,
    df,
    t,
    p,
    ciLo: m1 - m2 - tc * se,
    ciHi: m1 - m2 + tc * se,
    cohensD: sp > 0 ? (m1 - m2) / sp : NaN,
  };
}

export interface Chi2Result {
  chi2: number;
  p: number;
}

/** Pearson chi-square on a 2x2 table (no continuity correction), df = 1. */
export function chi2_2x2(a: number, b: number, c: number, d: number): Chi2Result {
  const n = a + b + c + d;
  const den = (a + b) * (c + d) * (a + c) * (b + d);
  if (n <= 0 || den <= 0) return { chi2: 0, p: 1 };
  const chi2 = (n * (a * d - b * c) * (a * d - b * c)) / den;
  return { chi2, p: 1 - chiSquareCdf(chi2, 1) };
}

function lchoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/** Two-sided Fisher's exact test for a 2x2 table (sum of P(X) <= observed). */
export function fisherExact2x2(a: number, b: number, c: number, d: number): number {
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const n = r1 + r2;
  if (n <= 0 || r1 <= 0 || r2 <= 0 || c1 <= 0 || c1 >= n) return 1;
  const lo = Math.max(0, c1 - r2);
  const hi = Math.min(c1, r1);
  const logObs = lchoose(r1, a) + lchoose(r2, c1 - a) - lchoose(n, c1);
  const obsP = Math.exp(logObs);
  let p = 0;
  for (let x = lo; x <= hi; x += 1) {
    const pr = Math.exp(lchoose(r1, x) + lchoose(r2, c1 - x) - lchoose(n, c1));
    if (pr <= obsP * (1 + 1e-9)) p += pr;
  }
  return Math.min(1, p);
}

export interface BinaryTwoGroup {
  n1: number;
  n2: number;
  events1: number;
  events2: number;
  rate1: number;
  rate2: number;
  diff: number;
  se: number;
  z: number;
  chi2: number;
  p: number;
  fisherP: number;
  rr: number;
  or: number;
}

/** Risk difference, Pearson chi-square, Fisher exact p, RR and OR. Group 1 vs group 2. */
export function binaryTwoGroup(events1: number, n1: number, events2: number, n2: number): BinaryTwoGroup | null {
  if (!(n1 > 0 && n2 > 0)) return null;
  const b = n1 - events1;
  const d = n2 - events2;
  const rate1 = events1 / n1;
  const rate2 = events2 / n2;
  const se = Math.sqrt((rate1 * (1 - rate1)) / n1 + (rate2 * (1 - rate2)) / n2);
  const z = se > 0 ? (rate1 - rate2) / se : 0;
  const { chi2, p } = chi2_2x2(events1, b, events2, d);
  const odds1 = events1 / Math.max(b, 1);
  const odds2 = events2 / Math.max(d, 1);
  return {
    n1,
    n2,
    events1,
    events2,
    rate1,
    rate2,
    diff: rate1 - rate2,
    se,
    z,
    chi2,
    p,
    fisherP: fisherExact2x2(events1, b, events2, d),
    rr: rate2 > 0 ? rate1 / rate2 : NaN,
    or: odds2 > 0 ? odds1 / odds2 : NaN,
  };
}

// ---- randomization ---------------------------------------------------------

export type RandMethod = 'block' | 'random-block' | 'stratified' | 'adaptive';

export interface StratFactor {
  name: string;
  levels: number;
}

/** Parse "center:2,severity:3" into stratification factors. */
export function parseStrataSpec(text: string): StratFactor[] {
  const out: StratFactor[] = [];
  for (const part of text.split(/[,;]+/)) {
    const m = /^\s*([A-Za-z0-9_\u4e00-\u9fff]+)\s*[:=]\s*(\d+)\s*$/.exec(part);
    if (!m) continue;
    const levels = Number(m[2]);
    if (levels >= 2 && out.length < 6) out.push({ name: m[1]!, levels });
  }
  return out;
}

export interface StratumBalance {
  stratum: string;
  a: number;
  b: number;
}

export interface RandomizationResult {
  method: RandMethod;
  n: number;
  arms: string[];
  /** Stratum or covariate profile per subject ('' when not applicable). */
  strata: string[];
  blockSizes: number[];
  counts: { a: number; b: number };
  chi2: number;
  balanceP: number;
  perStratum: StratumBalance[];
  /** Plain-language rule note (English). */
  rule: string;
}

function balancedPermutation(m: number, rng: () => number): string[] {
  const half = Math.floor(m / 2);
  const arr: string[] = new Array(m);
  for (let i = 0; i < m; i += 1) arr[i] = i < half ? 'A' : 'B';
  for (let i = m - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
  return arr;
}

function evenize(x: number): number {
  const v = Math.max(2, Math.round(x));
  return v % 2 === 0 ? v : v + 1;
}

function balanceStats(arms: string[]): { a: number; b: number; chi2: number; p: number } {
  let a = 0;
  for (const x of arms) if (x === 'A') a += 1;
  const b = arms.length - a;
  const chi2 = arms.length > 0 ? ((a - b) * (a - b)) / arms.length : 0;
  return { a, b, chi2, p: 1 - chiSquareCdf(chi2, 1) };
}

/**
 * Seeded randomization plan.
 * - block: fixed-length permuted blocks;
 * - random-block: block sizes drawn from {4, 6, 8};
 * - stratified: separate permuted blocks within every stratum of the factor
 *   cross-classification (subjects cycle across strata);
 * - adaptive: Pocock-Simon biased-coin minimization over the factor
 *   profiles (impute uniform profiles, assign to the arm that minimizes the
 *   total factor-level imbalance with probability `biasP`, ties broken 50/50).
 */
export function generateRandomization(opts: {
  method: RandMethod;
  n: number;
  blockSize: number;
  /** Stratification factors (stratified / adaptive methods only). */
  factors?: StratFactor[];
  seed: number;
  biasP?: number;
}): RandomizationResult {
  const n = Math.max(4, Math.round(opts.n));
  const rng = mulberry32(opts.seed >>> 0);
  const arms: string[] = new Array(n);
  const strata: string[] = new Array(n).fill('');
  const blockSizes: number[] = [];
  const perStratum: StratumBalance[] = [];
  let rule = 'permuted blocks, 1:1 allocation';

  if (opts.method === 'block' || opts.method === 'random-block') {
    let done = 0;
    while (done < n) {
      const remaining = n - done;
      let size: number;
      if (opts.method === 'block') {
        size = Math.min(evenize(opts.blockSize), remaining);
      } else {
        const pool = [4, 6, 8].filter((s) => s <= remaining);
        size = pool.length > 0 && remaining >= 4 ? pool[Math.floor(rng() * pool.length)]! : remaining;
      }
      const seq = balancedPermutation(size, rng);
      for (let i = 0; i < size; i += 1) arms[done + i] = seq[i]!;
      blockSizes.push(size);
      done += size;
    }
    if (opts.method === 'random-block') rule = 'permuted blocks with random lengths in {4, 6, 8}, 1:1 allocation';
  } else if (opts.method === 'stratified') {
    const factors =
      opts.factors && opts.factors.length > 0 ? opts.factors : [{ name: 'stratum', levels: 2 }];
    const levelNames: string[][] = [];
    for (const f of factors) {
      const names: string[] = [];
      for (let l = 1; l <= f.levels; l += 1) names.push(`${f.name}=${l}`);
      levelNames.push(names);
    }
    // Cartesian product of factor levels.
    const combos: string[] = [''];
    const idx: number[][] = [[]];
    for (let f = 0; f < factors.length; f += 1) {
      const nc: string[] = [];
      const ni: number[][] = [];
      for (let c = 0; c < combos.length; c += 1) {
        for (let l = 0; l < factors[f]!.levels; l += 1) {
          nc.push(combos[c] === '' ? levelNames[f]![l]! : `${combos[c]}|${levelNames[f]![l]}`);
          ni.push([...idx[c]!, l]);
        }
      }
      combos.length = 0;
      idx.length = 0;
      for (const s of nc) combos.push(s);
      for (const s of ni) idx.push([...s]);
    }
    const nStrata = combos.length;
    const buckets: number[][] = Array.from({ length: nStrata }, () => []);
    for (let i = 0; i < n; i += 1) {
      const s = i % nStrata;
      buckets[s]!.push(i);
      strata[i] = combos[s]!;
    }
    const bs = evenize(opts.blockSize);
    for (let s = 0; s < nStrata; s += 1) {
      const members = buckets[s]!;
      let done = 0;
      while (done < members.length) {
        const size = Math.min(bs, members.length - done);
        const seq = balancedPermutation(size, rng);
        for (let i = 0; i < size; i += 1) arms[members[done + i]!] = seq[i]!;
        blockSizes.push(size);
        done += size;
      }
      let a = 0;
      for (const i of members) if (arms[i] === 'A') a += 1;
      perStratum.push({ stratum: combos[s]!, a, b: members.length - a });
    }
    rule = `stratified permuted blocks (block size ${bs}) across ${nStrata} strata of ${factors.map((f) => `${f.name}:${f.levels}`).join(' x ')}, 1:1 within stratum`;
  } else {
    // Pocock-Simon biased-coin minimization with imputed uniform profiles.
    const factors =
      opts.factors && opts.factors.length > 0 ? opts.factors : [{ name: 'stratum', levels: 2 }];
    const biasP = opts.biasP ?? 0.8;
    const cellA = new Map<string, number>();
    const cellB = new Map<string, number>();
    let nA = 0;
    let nB = 0;
    for (let i = 0; i < n; i += 1) {
      const profile = factors.map((f) => `${f.name}=${1 + Math.floor(rng() * f.levels)}`).join('|');
      strata[i] = profile;
      const keys = profile.split('|');
      const imbalanceIf = (arm: 'A' | 'B'): number => {
        let d = Math.abs((arm === 'A' ? nA + 1 : nA) - (arm === 'B' ? nB + 1 : nB));
        for (const k of keys) {
          const a = cellA.get(k) ?? 0;
          const b = cellB.get(k) ?? 0;
          d += Math.abs((arm === 'A' ? a + 1 : a) - (arm === 'B' ? b + 1 : b));
        }
        return d;
      };
      const dA = imbalanceIf('A');
      const dB = imbalanceIf('B');
      let pick: 'A' | 'B';
      if (dA === dB) pick = rng() < 0.5 ? 'A' : 'B';
      else {
        const better: 'A' | 'B' = dA < dB ? 'A' : 'B';
        pick = rng() < biasP ? better : better === 'A' ? 'B' : 'A';
      }
      if (pick === 'A') {
        nA += 1;
        for (const k of keys) cellA.set(k, (cellA.get(k) ?? 0) + 1);
      } else {
        nB += 1;
        for (const k of keys) cellB.set(k, (cellB.get(k) ?? 0) + 1);
      }
      arms[i] = pick;
    }
    for (const f of factors) {
      for (let l = 1; l <= f.levels; l += 1) {
        const key = `${f.name}=${l}`;
        perStratum.push({ stratum: key, a: cellA.get(key) ?? 0, b: cellB.get(key) ?? 0 });
      }
    }
    rule = `Pocock-Simon minimization: biased coin p=${biasP} toward the arm that minimizes total factor-level imbalance (factors ${factors.map((f) => `${f.name}:${f.levels}`).join(' x ')})`;
  }

  const { a, b, chi2, p } = balanceStats(arms);
  return { method: opts.method, n, arms, strata, blockSizes, counts: { a, b }, chi2, balanceP: p, perStratum, rule };
}

// ---- group-sequential boundaries (Lan-DeMets alpha spending) ---------------

export type SpendingFamily = 'obf' | 'pocock';

/**
 * Lan-DeMets O'Brien-Fleming spending: alpha(t) = 2 - 2*Phi(z_{alpha/2}/sqrt(t)).
 */
export function obfSpending(t: number, alpha: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return alpha;
  const z = normalInv(1 - alpha / 2);
  return 2 * (1 - normalCdf(z / Math.sqrt(t)));
}

/**
 * Lan-DeMets Pocock spending: alpha(t) = alpha * ln(1 + (e-1) t)
 * (approximately constant z boundaries across looks).
 */
export function pocockSpending(t: number, alpha: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return alpha;
  return alpha * Math.log(1 + (Math.E - 1) * t);
}

/**
 * Two-sided z boundaries at the given information fractions by the canonical
 * score-process recursion: S(t) is Brownian with S(1) = z * 1, boundaries
 * live on |S(t_j)| >= b_j * sqrt(t_j), and the sub-density of S given no
 * earlier crossing is propagated by Gaussian convolution on a fixed grid.
 */
export function sequentialBoundaries(times: number[], alpha: number, family: SpendingFamily): number[] {
  const k = times.length;
  if (k === 0) return [];
  const spend = family === 'obf' ? obfSpending : pocockSpending;
  const S_MAX = 7;
  const NG = 701;
  const ds = (2 * S_MAX) / (NG - 1);
  const grid = new Float64Array(NG);
  for (let i = 0; i < NG; i += 1) grid[i] = -S_MAX + i * ds;

  const tailMass = (f: Float64Array, cut: number): number => {
    let acc = 0;
    for (let i = 0; i < NG; i += 1) {
      if (Math.abs(grid[i]!) >= cut) acc += f[i]! * ds;
    }
    return acc;
  };

  const boundaries: number[] = new Array(k).fill(0);
  // Sub-density of S(t_1) (unconditional N(0, t_1) until the first boundary).
  let f = new Float64Array(NG);
  {
    const t1 = times[0]!;
    const sd = Math.sqrt(Math.max(t1, 1e-12));
    for (let i = 0; i < NG; i += 1) {
      const x = grid[i]! / sd;
      f[i] = Math.exp(-0.5 * x * x) / (sd * Math.sqrt(2 * Math.PI));
    }
  }
  let cumPrev = 0;
  for (let j = 0; j < k; j += 1) {
    const tj = times[j]!;
    const target = Math.max(spend(tj, alpha), 0);
    const incr = Math.max(target - cumPrev, 1e-14);
    cumPrev = target;
    let lo = 0.5;
    let hi = 24;
    for (let it = 0; it < 64; it += 1) {
      const mid = 0.5 * (lo + hi);
      if (tailMass(f, mid * Math.sqrt(tj)) > incr) lo = mid;
      else hi = mid;
    }
    const bj = 0.5 * (lo + hi);
    boundaries[j] = bj;
    if (j < k - 1) {
      const cut = bj * Math.sqrt(tj);
      const g = new Float64Array(NG);
      for (let i = 0; i < NG; i += 1) g[i] = Math.abs(grid[i]!) < cut ? f[i]! : 0;
      const tau = Math.max(times[j + 1]! - tj, 1e-9);
      const norm = 1 / Math.sqrt(2 * Math.PI * tau);
      const fnext = new Float64Array(NG);
      for (let i = 0; i < NG; i += 1) {
        let acc = 0;
        for (let j2 = 0; j2 < NG; j2 += 1) {
          const gv = g[j2]!;
          if (gv === 0) continue;
          const d = grid[i]! - grid[j2]!;
          acc += gv * Math.exp(-0.5 * (d * d) / tau);
        }
        fnext[i] = acc * ds * norm;
      }
      f = fnext;
    }
  }
  return boundaries;
}

/** Equal information fractions (1/k, ..., 1). */
export function equalInformationFractions(k: number): number[] {
  const out: number[] = [];
  for (let j = 1; j <= Math.max(1, Math.round(k)); j += 1) out.push(j / Math.max(1, Math.round(k)));
  return out;
}

// ---- pharmacovigilance PRR signals -----------------------------------------

export interface AeRow {
  treatment: string;
  event: string;
  cases: number;
  n: number;
}

export interface AeSignalRow extends AeRow {
  rate: number;
  /** Proportional reporting ratio vs all other treatments. */
  prr: number;
  chi2: number;
  p: number;
  signal: boolean;
}

const AE_TREATMENT_COLS = ['treatment', 'drug', 'arm', 'group'];
const AE_EVENT_COLS = ['event', 'adverseevent', 'ae', 'term', 'reaction'];
const AE_CASES_COLS = ['cases', 'count', 'n_cases', 'reports'];
const AE_N_COLS = ['n', 'total', 'exposed', 'subjects'];

/** Parse a treatment,event,cases,n table; returns null when columns are missing. */
export function parseAeCsv(text: string): AeRow[] | null {
  const t = splitTable(text);
  if (!t) return null;
  const iT = findColumn(t.headers, AE_TREATMENT_COLS);
  const iE = findColumn(t.headers, AE_EVENT_COLS);
  const iC = findColumn(t.headers, AE_CASES_COLS);
  const iN = findColumn(t.headers, AE_N_COLS);
  if (iT < 0 || iE < 0 || iC < 0 || iN < 0) return null;
  const rows: AeRow[] = [];
  for (const r of t.rows) {
    const treatment = r[iT] ?? '';
    const event = r[iE] ?? '';
    const cases = numOf(r[iC]);
    const n = numOf(r[iN]);
    if (!treatment || !event || !Number.isFinite(cases) || !Number.isFinite(n) || n <= 0) continue;
    rows.push({ treatment, event, cases: Math.max(0, cases), n });
  }
  return rows.length > 0 ? rows : null;
}

/**
 * Per (treatment, event) row: within-group rate, PRR against all other
 * treatments pooled for the same event, and the Pearson chi-square of the
 * 2x2 drug/event table. Signal flag: PRR >= 2 and chi-square >= 4.
 */
export function aeSignalTable(rows: AeRow[]): AeSignalRow[] {
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.treatment, (totals.get(r.treatment) ?? 0) + r.cases);
  const byEvent = new Map<string, AeRow[]>();
  for (const r of rows) {
    const list = byEvent.get(r.event) ?? [];
    list.push(r);
    byEvent.set(r.event, list);
  }
  const out: AeSignalRow[] = [];
  for (const r of rows) {
    const totalT = totals.get(r.treatment) ?? 0;
    const a = r.cases;
    const b = Math.max(totalT - a, 0);
    let c = 0;
    let otherTotals = 0;
    for (const [tr, tot] of totals) {
      if (tr === r.treatment) continue;
      otherTotals += tot;
      for (const o of byEvent.get(r.event) ?? []) {
        if (o.treatment === tr) c += o.cases;
      }
    }
    const d = Math.max(otherTotals - c, 0);
    const rate = r.cases / r.n;
    const prrT = totalT > 0 ? a / totalT : 0;
    const prrC = otherTotals > 0 ? c / otherTotals : 0;
    const prr = prrC > 0 ? prrT / prrC : prrT > 0 ? Infinity : 0;
    const { chi2, p } = chi2_2x2(a, b, c, d);
    out.push({ ...r, rate, prr, chi2, p, signal: prr >= 2 && chi2 >= 4 });
  }
  return out;
}

// ---- trial CSV intake ------------------------------------------------------

const TRIAL_ARM_COLS = ['arm', 'group', 'treatment', 'trt'];
const TRIAL_PRIMARY_COLS = ['endpointprimary', 'primaryendpoint', 'primary', 'endpoint', 'outcome', 'y'];
const TRIAL_SECONDARY_COLS = ['endpointsecondary', 'secondaryendpoint', 'secondary'];
const TRIAL_EVENT_COLS = ['event', 'relapse', 'response', 'death', 'complication'];

export interface TrialData {
  n: number;
  subject: string[] | null;
  arm: string[];
  armLabels: string[];
  primary: number[];
  secondary: number[] | null;
  event: Array<number> | null;
  age: number[] | null;
}

/**
 * Trial table with an arm column, a numeric primary endpoint and optional
 * secondary endpoint / event / age / subject columns. Rows lacking an arm or
 * a numeric primary endpoint are dropped.
 */
export function parseTrialCsv(text: string): TrialData | null {
  const t = splitTable(text);
  if (!t) return null;
  const iArm = findColumn(t.headers, TRIAL_ARM_COLS);
  const iPrim = findColumn(t.headers, TRIAL_PRIMARY_COLS);
  if (iArm < 0 || iPrim < 0) return null;
  const iSec = findColumn(t.headers, TRIAL_SECONDARY_COLS);
  const iEvent = findColumn(t.headers, TRIAL_EVENT_COLS);
  const iAge = findColumn(t.headers, ['age']);
  const iSubj = findColumn(t.headers, ['subject', 'subjectid', 'id', 'patient']);
  const arm: string[] = [];
  const primary: number[] = [];
  const secondary: number[] = [];
  const event: number[] = [];
  const age: number[] = [];
  const subject: string[] = [];
  const labels: string[] = [];
  for (const r of t.rows) {
    const a = (r[iArm] ?? '').trim();
    const p = numOf(r[iPrim]);
    if (!a || !Number.isFinite(p)) continue;
    const seen = labels.indexOf(a);
    if (seen < 0) labels.push(a);
    arm.push(a);
    primary.push(p);
    secondary.push(iSec >= 0 ? numOf(r[iSec]) : NaN);
    event.push(iEvent >= 0 ? numOf(r[iEvent]) : NaN);
    age.push(iAge >= 0 ? numOf(r[iAge]) : NaN);
    subject.push(iSubj >= 0 ? (r[iSubj] ?? '') : '');
  }
  if (labels.length < 2 || arm.length < 4) return null;
  const secOk = secondary.some((v) => Number.isFinite(v));
  const evOk = event.some((v) => Number.isFinite(v));
  const ageOk = age.some((v) => Number.isFinite(v));
  // Deterministic arm order: the reference arm (control/placebo/...) first,
  // remaining labels alphabetically — so arm[0] is always the comparator.
  const ordered = labels.slice().sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  const refIdx = ordered.findIndex((l) => /control|placebo|sham|vehicle/i.test(l));
  if (refIdx > 0) {
    const ref = ordered[refIdx]!;
    ordered.splice(refIdx, 1);
    ordered.unshift(ref);
  }
  return {
    n: arm.length,
    subject: iSubj >= 0 && subject.some((s) => s !== '') ? subject : null,
    arm,
    armLabels: ordered.slice(0, 2),
    primary,
    secondary: secOk ? secondary : null,
    event: evOk ? event : null,
    age: ageOk ? age : null,
  };
}

/** True when every finite value of the column is 0 or 1 (binary endpoint). */
export function isBinaryColumn(values: number[]): boolean {
  let seen = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    seen += 1;
    if (v !== 0 && v !== 1) return false;
  }
  return seen >= 4;
}

/** Split numeric column values by arm (drops NaN). */
export function valuesByArm(arm: string[], values: number[], labels: string[]): number[][] {
  const out: number[][] = labels.map(() => []);
  for (let i = 0; i < arm.length; i += 1) {
    const idx = labels.indexOf(arm[i]!);
    if (idx < 0) continue;
    const v = values[i]!;
    if (Number.isFinite(v)) out[idx]!.push(v);
  }
  return out;
}
