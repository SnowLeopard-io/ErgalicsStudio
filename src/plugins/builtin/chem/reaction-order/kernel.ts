// ==========================================================================
// chem-reaction-order — integrated-rate-law order determination + Arrhenius
// analysis (pure, dependency-free, testable)
//
// Integrated-method order screening: an [A]–t decay series is linearised
// three ways (zero order [A] vs t, first order ln[A] vs t, second order
// 1/[A] vs t), each fitted by self-implemented ordinary least squares, and
// the order with the highest coefficient of determination R² is selected.
// The slope yields the rate constant k (positive, sign-normalised) with its
// standard error from the OLS covariance. A half-life cross-check uses the
// textbook relation t½ ∝ [A]₀^(1−n): successive half-lives along the decay
// give n = 1 − d(ln t½)/d(ln [A]₀). Arrhenius analysis fits ln k vs 1/T
// (slope = −Ea/R) to recover the activation energy and pre-exponential
// factor. Deterministic synthetic data generators (mulberry32, seeded) make
// every benchmark exactly reproducible. No DOM anywhere.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

/** Universal gas constant R = 8.314462618 J·mol⁻¹·K⁻¹ (CODATA 2018). */
export const R_GAS = 8.314462618;

export interface SeriesPoint {
  /** Time (any unit; k inherits the reciprocal unit). */
  t: number;
  /** Reactant concentration [A] (concentration units). */
  c: number;
}

export interface LinearFit {
  slope: number;
  intercept: number;
  r2: number;
  /** Standard error of the slope: √(SSE/(n−2)/Sxx). */
  slopeSe: number;
  n: number;
}

/**
 * Ordinary least squares y = a + b·x with R² and the slope standard error.
 * Self-implemented normal equations (no library dependency).
 */
export function linearFit(xs: number[], ys: number[]): LinearFit {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: 0, r2: 0, slopeSe: 0, n };
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sx += xs[i]!;
    sy += ys[i]!;
    sxx += xs[i]! * xs[i]!;
    sxy += xs[i]! * ys[i]!;
  }
  const denom = n * sxx - sx * sx;
  const slope = Math.abs(denom) < 1e-30 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  let ssTot = 0;
  let ssRes = 0;
  const mean = sy / n;
  for (let i = 0; i < n; i += 1) {
    ssTot += (ys[i]! - mean) ** 2;
    ssRes += (ys[i]! - (intercept + slope * xs[i]!)) ** 2;
  }
  const r2 = ssTot < 1e-30 ? 1 : 1 - ssRes / ssTot;
  const sxxC = sxx - (sx * sx) / n;
  const slopeSe = n > 2 && sxxC > 1e-30 ? Math.sqrt(ssRes / (n - 2) / sxxC) : 0;
  return { slope, intercept, r2, slopeSe, n };
}

// ---- integrated-method order screening --------------------------------------

export type ReactionOrder = 0 | 1 | 2;

export interface OrderTransformInfo {
  order: ReactionOrder;
  en: string;
  zh: string;
  /** Y-axis label of the linearised plot. */
  yLabel: string;
}

/** The three integrated-rate-law linearisations screened side by side. */
export const ORDER_TRANSFORMS: OrderTransformInfo[] = [
  { order: 0, en: 'Zero order', zh: '零级', yLabel: '[A]' },
  { order: 1, en: 'First order', zh: '一级', yLabel: 'ln[A]' },
  { order: 2, en: 'Second order', zh: '二级', yLabel: '1/[A]' },
];

/**
 * Linearising transform of the integrated rate laws:
 * n=0 → [A] = [A]₀ − kt;  n=1 → ln[A] = ln[A]₀ − kt;  n=2 → 1/[A] = 1/[A]₀ + kt.
 * Points with c ≤ 0 are unusable for the logarithm and are dropped upstream.
 */
export function transformY(order: ReactionOrder, c: number): number {
  if (order === 0) return c;
  if (order === 1) return Math.log(c);
  return 1 / c;
}

export interface OrderAnalysis {
  best: ReactionOrder;
  /** R² of all three linearisations, keyed by order. */
  fits: Record<ReactionOrder, LinearFit>;
  /** Rate constant (positive; concentration^-(n−1)·time⁻¹ units). */
  k: number;
  /** Standard error of k from the OLS slope covariance. */
  kSe: number;
  /** R² of the winning linearisation. */
  r2: number;
}

/**
 * Screen all three integrated-rate-law linearisations and select the order
 * with the highest R². Requires ≥3 points with c > 0; returns null otherwise.
 */
export function analyzeOrder(data: SeriesPoint[]): OrderAnalysis | null {
  const pts = data
    .filter((d) => Number.isFinite(d.t) && Number.isFinite(d.c) && d.c > 0)
    .sort((a, b) => a.t - b.t);
  if (pts.length < 3) return null;
  const xs = pts.map((d) => d.t);
  const fits = {} as Record<ReactionOrder, LinearFit>;
  let best: ReactionOrder = 1;
  let bestR2 = -Infinity;
  for (const o of [0, 1, 2] as ReactionOrder[]) {
    const fit = linearFit(xs, pts.map((d) => transformY(o, d.c)));
    fits[o] = fit;
    if (fit.r2 > bestR2) {
      bestR2 = fit.r2;
      best = o;
    }
  }
  const win = fits[best]!;
  // n=0,1 linearise with slope −k; n=2 with slope +k. Rate constants are
  // reported positive (sign-normalised) in all cases.
  const k = Math.abs(win.slope);
  return { best, fits, k, kSe: win.slopeSe, r2: win.r2 };
}

/** Rate-constant unit for a given order (time unit `tu`, e.g. 's' or 'min'). */
export function rateConstantUnit(order: ReactionOrder, tu = 's'): string {
  if (order === 0) return `mol/(L·${tu})`;
  if (order === 1) return `${tu}⁻¹`;
  return `L/(mol·${tu})`;
}

// ---- half-life cross-check ----------------------------------------------------

export interface HalfLifePair {
  /** Starting concentration of the segment. */
  c0: number;
  /** Time for the concentration to fall to c0/2. */
  tHalf: number;
}

export interface HalfLifeCheck {
  pairs: HalfLifePair[];
  /** n = 1 − d(ln t½)/d(ln c0); null when fewer than 2 usable pairs. */
  order: number | null;
  slope: number | null;
}

/**
 * Successive-half-life cross-check (t½ ∝ c0^(1−n)): walk the decay curve,
 * each segment starting where the previous one ended, timing the fall to
 * half the segment's starting concentration (linear interpolation between
 * samples). At least 2 segments are needed for the log–log slope.
 */
export function halfLifeCheck(data: SeriesPoint[]): HalfLifeCheck {
  const pts = data
    .filter((d) => Number.isFinite(d.t) && Number.isFinite(d.c) && d.c > 0)
    .sort((a, b) => a.t - b.t);
  const pairs: HalfLifePair[] = [];
  if (pts.length < 3) return { pairs, order: null, slope: null };
  let idx = 0;
  let c0 = pts[0]!.c;
  let t0 = pts[0]!.t;
  // Guard against pathological non-decaying input: at most pts.length walks.
  while (idx < pts.length - 1 && pairs.length < 12) {
    const half = c0 / 2;
    let j = idx + 1;
    while (j < pts.length && pts[j]!.c > half) j += 1;
    if (j >= pts.length) break;
    const prev = pts[j - 1]!;
    const cur = pts[j]!;
    const tHalf =
      cur.c === prev.c
        ? cur.t - t0
        : (prev.t - t0) + ((prev.c - half) / (prev.c - cur.c)) * (cur.t - prev.t);
    if (!(tHalf > 0) || !Number.isFinite(tHalf)) break;
    pairs.push({ c0, tHalf });
    idx = j - 1;
    c0 = cur.c;
    t0 = cur.t;
  }
  if (pairs.length < 2) return { pairs, order: null, slope: null };
  const fit = linearFit(pairs.map((p) => Math.log(p.c0)), pairs.map((p) => Math.log(p.tHalf)));
  return { pairs, order: 1 - fit.slope, slope: fit.slope };
}

// ---- Arrhenius analysis --------------------------------------------------------

export interface ArrheniusPoint {
  /** Absolute temperature (K). */
  T: number;
  /** Rate constant at T (same units as the kinetics fit). */
  k: number;
}

export interface ArrheniusFit {
  /** Activation energy (kJ/mol). */
  ea: number;
  /** Standard error of Ea (kJ/mol). */
  eaSe: number;
  /** ln A from the intercept. */
  lnA: number;
  /** Pre-exponential factor A = exp(intercept). */
  a: number;
  r2: number;
  n: number;
}

/**
 * Arrhenius fit: ln k = ln A − Ea/(R·T). Linear least squares of ln k vs
 * 1/T gives slope = −Ea/R and intercept = ln A; Ea carries the slope's
 * standard error. Requires ≥3 points with T, k > 0.
 */
export function arrheniusFit(points: ArrheniusPoint[]): ArrheniusFit | null {
  const pts = points.filter((p) => Number.isFinite(p.T) && Number.isFinite(p.k) && p.T > 0 && p.k > 0);
  if (pts.length < 3) return null;
  const fit = linearFit(pts.map((p) => 1 / p.T), pts.map((p) => Math.log(p.k)));
  const ea = (-fit.slope * R_GAS) / 1000;
  const eaSe = (fit.slopeSe * R_GAS) / 1000;
  return { ea, eaSe, lnA: fit.intercept, a: Math.exp(fit.intercept), r2: fit.r2, n: pts.length };
}

// ---- deterministic synthetic data (demo + embedded benchmarks) ------------------

export interface SynthKineticsOptions {
  order: ReactionOrder;
  c0: number;
  k: number;
  tMax: number;
  n: number;
  /** Multiplicative Gaussian noise scale (0 = exact). */
  noise: number;
  seed: number;
}

/** Exact integrated rate law for a constant-volume batch decay. */
export function exactConcentration(order: ReactionOrder, c0: number, k: number, t: number): number {
  if (order === 0) return Math.max(c0 - k * t, 0);
  if (order === 1) return c0 * Math.exp(-k * t);
  return c0 / (1 + k * c0 * t);
}

/** Seeded Gaussian generator (mulberry32 uniform + Box–Muller). */
export function seededGaussian(seed: number): () => number {
  const next = mulberry32(seed);
  return () => {
    let u = 0;
    do {
      u = next();
    } while (u <= 1e-12);
    const v = next() || 0.5;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** Synthetic noisy [A]–t series from a known order / rate constant. */
export function synthKinetics(opts: SynthKineticsOptions): SeriesPoint[] {
  const rand = seededGaussian(opts.seed);
  const pts: SeriesPoint[] = [];
  for (let i = 0; i < opts.n; i += 1) {
    const t = opts.tMax === 0 ? 0 : (opts.tMax * i) / (opts.n - 1);
    const cExact = exactConcentration(opts.order, opts.c0, opts.k, t);
    const c = cExact <= 0 ? 0 : cExact * (1 + opts.noise * rand());
    pts.push({ t, c: Math.max(0, c) });
  }
  return pts;
}

export interface SynthArrheniusOptions {
  /** Activation energy (kJ/mol). */
  eaKJ: number;
  /** Pre-exponential factor A. */
  a: number;
  temperatures: number[];
  /** Multiplicative Gaussian noise scale (0 = exact). */
  noise: number;
  seed: number;
}

/** Synthetic noisy k(T) series from a known Arrhenius pair. */
export function synthArrhenius(opts: SynthArrheniusOptions): ArrheniusPoint[] {
  const rand = seededGaussian(opts.seed);
  const eaJ = opts.eaKJ * 1000;
  return opts.temperatures.map((T) => ({
    T,
    k: opts.a * Math.exp(-eaJ / (R_GAS * T)) * (1 + opts.noise * rand()),
  }));
}

// ---- two-column table parsing ----------------------------------------------------

export type TableKind = 'kinetics' | 'arrhenius';

export interface ParsedTable {
  kind: TableKind;
  kinetics: SeriesPoint[];
  arrhenius: ArrheniusPoint[];
  /** True when a header row with recognisable column names was found. */
  headerDetected: boolean;
}

const TEMP_TOKENS = ['temp', 'temperature', 't_k', 'tk', 't/k', 'kelvin', '1/t'];
const K_TOKENS = ['k', 'rate', 'rateconst', 'rate_constant', 'rateconst'];
const TIME_TOKENS = ['t', 'time', 't_s', 'ts', 't/min', 'tmin', 'time_s'];
const CONC_TOKENS = ['c', 'conc', 'concentration', 'a', '[a]', 'ca', 'c_a', 'abs'];

function isNumeric(s: string): boolean {
  return s !== '' && Number.isFinite(Number(s));
}

/**
 * Parse a two-column table (CSV/TSV/DAT/TXT). Header keywords decide the
 * mode: temperature/`k`-ish tokens → Arrhenius, time/concentration tokens →
 * kinetics; without a recognisable header the caller's fallback is used.
 * `#` comments, blank lines and rows with fewer than two numeric cells are
 * skipped. Each row contributes (t/T, c/k) from its first two numeric cells.
 */
export function parseTwoColumn(text: string, fallback: TableKind): ParsedTable {
  const trim = text.trim();
  const empty: ParsedTable = { kind: fallback, kinetics: [], arrhenius: [], headerDetected: false };
  if (!trim) return empty;
  const lines = trim.split(/\r?\n/);
  let kind: TableKind | null = null;
  let headerDetected = false;
  const rows: Array<[number, number]> = [];
  for (const line of lines) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const cells = l.split(/[,\s;]+/).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;
    if (!rows.length && cells.some((c) => !isNumeric(c))) {
      // First non-numeric row → header; sniff the column names.
      const toks = cells.map((c) => c.toLowerCase().replace(/[^a-z_/[\]]/g, ''));
      const hasTemp = toks.some((tk) => TEMP_TOKENS.some((w) => tk === w || tk.startsWith(w)));
      const hasK = toks.some((tk) => K_TOKENS.includes(tk));
      const hasTime = toks.some((tk) => TIME_TOKENS.some((w) => tk === w || tk.startsWith(w)));
      const hasConc = toks.some((tk) => CONC_TOKENS.includes(tk));
      kind = hasTemp || (hasK && !hasConc && !hasTime) ? 'arrhenius' : hasTime || hasConc ? 'kinetics' : fallback;
      headerDetected = true;
      continue;
    }
    const a = Number(cells[0]);
    const b = Number(cells[1]);
    if (Number.isFinite(a) && Number.isFinite(b)) rows.push([a, b]);
  }
  const resolved = kind ?? fallback;
  return {
    kind: resolved,
    headerDetected,
    kinetics: rows.map(([t, c]) => ({ t, c })),
    arrhenius: rows.map(([T, k]) => ({ T, k })),
  };
}
