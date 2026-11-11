// ==========================================================================
// Synthetic Data Generator kernel — pure TypeScript, deterministic.
//
// No DOM imports, no Python runtime: every function is deterministic given
// (data, seed), so a run can be replayed bit-for-bit. Contents:
//
//   - seeded RNG (mulberry32, reused from @/core/repro) + Box-Muller gaussian
//   - basic statistics: mean / variance (n-1) / type-7 quantiles / ECDF / KS
//   - normal CDF (erf) and inverse CDF (Acklam) for the copula transforms
//   - univariate marginal fitting: normal / lognormal / uniform / exponential
//     (selected by minimal KS statistic), categorical by empirical frequency,
//     boolean by p, low-cardinality text by frequency, high-uniqueness ids
//     skipped
//   - multivariate synthesis: Gaussian copula — ranks → uniform → normal
//     scores → correlation matrix (PSD-corrected by eigenvalue clamping) →
//     Cholesky sampling → inverse marginal transform
//   - time-series mode: AR(1) with the empirical lag-1 autocorrelation
//   - privacy: Laplace ε-DP (inverse-transform sampling, noisy histograms /
//     counts / means) and k-anonymity (binning + suppression of classes < k)
//   - qualityMetrics(original, synthetic): per-column KS / TVD, correlation
//     preservation, missing-rate difference, overall similarity score
//   - CSV parse / serialize (RFC-4180-lite)
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

/** Deterministic seeded PRNG in [0, 1). */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  return mulberry32(seed);
}

/** Standard normal draw via Box-Muller (one uniform pair per two draws). */
export function gaussian(rng: Rng): number {
  const u = Math.max(1e-12, rng());
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---- basic statistics ------------------------------------------------------

export function meanOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

/** Unbiased sample variance (n-1 denominator). 0 for n < 2. */
export function varianceOf(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = meanOf(xs);
  let s = 0;
  for (const v of xs) s += (v - m) * (v - m);
  return Math.max(0, s / (n - 1));
}

export function stdOf(xs: number[]): number {
  return Math.sqrt(varianceOf(xs));
}

/** Type-7 quantile (linear interpolation between order statistics). */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  const s = xs.slice().sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo]!;
  const t = pos - lo;
  return s[lo]! * (1 - t) + s[hi]! * t;
}

/** Two-sample Kolmogorov–Smirnov statistic sup|F1(x) - F2(x)|. */
export function ksStatistic(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = a.slice().sort((x, y) => x - y);
  const sb = b.slice().sort((x, y) => x - y);
  let i = 0;
  let j = 0;
  let d = 0;
  while (i < sa.length && j < sb.length) {
    const va = sa[i]!;
    const vb = sb[j]!;
    if (va <= vb) i += 1;
    if (vb <= va) j += 1;
    d = Math.max(d, Math.abs(i / sa.length - j / sb.length));
  }
  return d;
}

/** Pearson correlation of two equal-length samples (0 when degenerate). */
export function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i += 1) {
    sa += a[i]!;
    sb += b[i]!;
  }
  const ma = sa / n;
  const mb = sb / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va <= 0 || vb <= 0) return 0;
  const r = cov / Math.sqrt(va * vb);
  return Math.min(1, Math.max(-1, r));
}

/** Average-rank transform (ties share the mean of their positions, 1-based). */
function averageRanks(values: number[]): number[] {
  const n = values.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((x, y) => values[x]! - values[y]!);
  const ranks = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[idx[j + 1]!] === values[idx[i]!]) j += 1;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) ranks[idx[k]!] = avg;
    i = j + 1;
  }
  return ranks;
}

// ---- normal distribution ------------------------------------------------------

/** erf via Abramowitz–Stegun 7.1.26 (|error| < 1.5e-7). */
export function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return s * y;
}

/** Standard normal CDF Φ(x). */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Standard normal pdf φ(x). */
export function normalPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * Inverse standard normal CDF Φ⁻¹(p) — Acklam's rational approximation
 * (relative error < 1.2e-9), refined by one Halley step on the CDF.
 */
export function normalQuantile(p: number): number {
  if (!(p > 0)) return -Infinity;
  if (!(p < 1)) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;
  let x: number;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= 1 - plow) {
    const q = p - 0.5;
    const r = q * q;
    x = (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  // One Halley refinement step (erf accuracy bounds the final error ~1e-15).
  const e = normalCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);
  return x;
}

// ---- CSV (RFC-4180-lite) ------------------------------------------------------

/** Quote one CSV cell when needed (comma / quote / newline), doubling quotes. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// ---- table model -----------------------------------------------------------

/** A cell of a synthesized / parsed table. `null` = missing. */
export type Cell = string | number | boolean | null;

export interface SynthTable {
  columns: string[];
  rows: Cell[][];
}

/** Split one CSV line honouring double-quoted cells with escaped quotes. */
function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Parse a numeric cell; `null` for empty / non-numeric (missing) values. */
export function parseNum(s: string): number | null {
  const t = s.trim();
  if (!t || !NUM_RE.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** Parse CSV text into a typed table (string cells). `null` if too short. */
export function parseCsvTable(text: string): SynthTable | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;
  const raw = splitCsvLine(lines[0]!).map((c) => c.trim());
  const seen = new Set<string>();
  const columns = raw.map((h, i) => {
    let name = h || `col${i + 1}`;
    let k = 2;
    while (seen.has(name)) {
      name = `${h || 'col'}_${k}`;
      k += 1;
    }
    seen.add(name);
    return name;
  });
  const rows = lines.slice(1).map((l) => splitCsvLine(l) as Cell[]);
  return { columns, rows };
}

/** Serialize a table to CSV text (null cells become empty fields). */
export function toCsv(table: SynthTable): string {
  const lines: string[] = [table.columns.map(csvCell).join(',')];
  for (const row of table.rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\n');
}

// ---- column typing -----------------------------------------------------------

type ColumnRole = 'numeric' | 'categorical' | 'boolean' | 'text' | 'id' | 'empty';

const BOOL_TRUE = new Set(['true', 'yes', 'y', '1', 't']);
const BOOL_FALSE = new Set(['false', 'no', 'n', '0', 'f']);
/** Max distinct values a string column may have to count as low-cardinality. */
const MAX_CATEGORICAL_UNIQUE = 32;

function truthyCell(s: string): boolean | null {
  const t = s.trim().toLowerCase();
  if (BOOL_TRUE.has(t)) return true;
  if (BOOL_FALSE.has(t)) return false;
  return null;
}

/** Classify one column from its string cells (null = missing). */
function profileRole(cells: string[]): { role: ColumnRole; missing: number; unique: number } {
  const total = cells.length;
  if (total === 0) return { role: 'empty', missing: 0, unique: 0 };
  let missing = 0;
  let numeric = 0;
  let bools = 0;
  const uniq = new Set<string>();
  for (const c of cells) {
    const t = (c ?? '').trim();
    if (t === '') {
      missing += 1;
      continue;
    }
    uniq.add(t);
    if (parseNum(t) !== null) numeric += 1;
    if (truthyCell(t) !== null) bools += 1;
  }
  const present = total - missing;
  if (present === 0) return { role: 'empty', missing, unique: 0 };
  const uniqueRatio = uniq.size / present;
  // Booleans need to be boolean-ish across the board and non-numeric.
  if (bools === present && numeric !== present && uniq.size <= 3) {
    return { role: 'boolean', missing, unique: uniq.size };
  }
  if (numeric === present && uniq.size >= 2) return { role: 'numeric', missing, unique: uniq.size };
  // Nearly-all-distinct strings are identifiers — skipped, not sampled.
  if (uniqueRatio >= 0.9 && present >= 10) return { role: 'id', missing, unique: uniq.size };
  if (uniq.size <= MAX_CATEGORICAL_UNIQUE || uniqueRatio <= 0.2) {
    return { role: 'categorical', missing, unique: uniq.size };
  }
  return { role: 'id', missing, unique: uniq.size };
}

// ---- univariate marginal fitting -------------------------------------------

export type DistKind = 'constant' | 'normal' | 'lognormal' | 'uniform' | 'exponential';

interface DistFit {
  kind: DistKind;
  ks: number;
  /** Named parameters: mu/sigma, mulog/sigmalog, a/b, or rate. */
  params: Record<string, number>;
}

function ksAgainst(a: number[], cdf: (x: number) => number): number {
  const s = a.slice().sort((x, y) => x - y);
  let d = 0;
  for (let i = 0; i < s.length; i += 1) {
    const f = cdf(s[i]!);
    d = Math.max(d, Math.abs(i / s.length - f), Math.abs((i + 1) / s.length - f));
  }
  return d;
}

/** Fit one numeric column with each candidate and return the best (min KS). */
export function fitNumeric(values: number[]): DistFit {
  const n = values.length;
  if (n === 0) return { kind: 'constant', ks: 0, params: { value: 0 } };
  const m = meanOf(values);
  const sd = stdOf(values);
  if (sd < 1e-12 || n < 2) return { kind: 'constant', ks: 0, params: { value: m } };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const allPositive = lo > 0;
  const nonNegative = lo >= 0;

  const candidates: DistFit[] = [];
  candidates.push({
    kind: 'normal',
    ks: ksAgainst(values, (x) => normalCdf((x - m) / sd)),
    params: { mu: m, sigma: sd },
  });
  if (allPositive && hi > 0) {
    const logs = values.map((v) => Math.log(v));
    candidates.push({
      kind: 'lognormal',
      ks: ksAgainst(values, (x) => normalCdf((Math.log(x) - meanOf(logs)) / stdOf(logs))),
      params: { mulog: meanOf(logs), sigmalog: stdOf(logs) },
    });
  }
  if (hi > lo) {
    candidates.push({
      kind: 'uniform',
      ks: ksAgainst(values, (x) => (x - lo) / (hi - lo)),
      params: { a: lo, b: hi },
    });
  }
  if (nonNegative && m > 1e-12) {
    candidates.push({
      kind: 'exponential',
      ks: ksAgainst(values, (x) => (x <= 0 ? 0 : 1 - Math.exp(-x / m))),
      params: { rate: 1 / m },
    });
  }
  candidates.sort((a, b) => a.ks - b.ks);
  return candidates[0] ?? { kind: 'normal', ks: 0, params: { mu: m, sigma: sd } };
}

/** Draw one value from a fitted distribution. */
export function sampleDist(fit: DistFit, rng: Rng): number {
  switch (fit.kind) {
    case 'constant':
      return fit.params.value ?? 0;
    case 'normal':
      return (fit.params.mu ?? 0) + (fit.params.sigma ?? 1) * gaussian(rng);
    case 'lognormal':
      return Math.exp((fit.params.mulog ?? 0) + (fit.params.sigmalog ?? 1) * gaussian(rng));
    case 'uniform':
      return (fit.params.a ?? 0) + ((fit.params.b ?? 1) - (fit.params.a ?? 0)) * rng();
    case 'exponential':
      return -Math.log(Math.max(1e-12, 1 - rng())) / (fit.params.rate ?? 1);
  }
}

// ---- table model ------------------------------------------------------------

interface ColumnModel {
  name: string;
  role: ColumnRole;
  missingRate: number;
  /** numeric */
  fit?: DistFit;
  /** Non-missing values in row order (rank source for the copula). */
  values?: number[];
  /** Sorted non-missing values (empirical marginal for the copula). */
  sorted?: number[];
  /** numeric | categorical | text — lag-1 autocorrelation of the raw order. */
  ar1?: number;
  /** categorical | text */
  categories?: string[];
  frequencies?: number[];
  /** Integer per-category counts (DP noise source). */
  counts?: number[];
  /** boolean */
  pTrue?: number;
  unique?: number;
}

interface SynthModel {
  columns: ColumnModel[];
  rowCount: number;
}

/** Convert string cells of one column into typed values per its role. */
function columnCells(rows: Cell[][], colIdx: number): string[] {
  return rows.map((r) => {
    const v = r[colIdx];
    return v === null || v === undefined ? '' : String(v);
  });
}

/** Fit every column of a parsed table. High-uniqueness string columns are marked 'id'. */
export function fitModel(table: SynthTable): SynthModel {
  const columns: ColumnModel[] = table.columns.map((name, i) => {
    const cells = columnCells(table.rows, i);
    const prof = profileRole(cells);
    const missingRate = cells.length > 0 ? prof.missing / cells.length : 0;
    const base: ColumnModel = { name, role: prof.role, missingRate, unique: prof.unique };
    if (prof.role === 'numeric') {
      const values: number[] = [];
      for (const c of cells) {
        const v = parseNum(c);
        if (v !== null) values.push(v);
      }
      base.fit = fitNumeric(values);
      base.values = values;
      base.sorted = values.slice().sort((a, b) => a - b);
      base.ar1 = lag1Autocorr(values);
      return base;
    }
    if (prof.role === 'boolean') {
      let trues = 0;
      let present = 0;
      for (const c of cells) {
        const b = truthyCell(c);
        if (b !== null) {
          present += 1;
          if (b) trues += 1;
        }
      }
      base.pTrue = present > 0 ? trues / present : 0.5;
      return base;
    }
    if (prof.role === 'categorical') {
      const counts = new Map<string, number>();
      for (const c of cells) {
        const t = c.trim();
        if (t !== '') counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      const cats = [...counts.keys()].sort();
      const present = Math.max(1, cells.length - prof.missing);
      base.categories = cats;
      base.counts = cats.map((c) => counts.get(c) ?? 0);
      base.frequencies = cats.map((c) => (counts.get(c) ?? 0) / present);
      return base;
    }
    return base;
  });
  return { columns, rowCount: table.rows.length };
}

/** Empirical lag-1 autocorrelation of an ordered series (0 when degenerate). */
export function lag1Autocorr(xs: number[]): number {
  if (xs.length < 3) return 0;
  const m = meanOf(xs);
  let c0 = 0;
  let c1 = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const d = xs[i]! - m;
    c0 += d * d;
    if (i + 1 < xs.length) c1 += d * (xs[i + 1]! - m);
  }
  if (c0 <= 1e-12) return 0;
  return Math.min(0.995, Math.max(-0.995, c1 / c0));
}

/** Draw one value from an empirical marginal via the type-7 quantile function. */
function sampleEmpirical(sorted: number[], u: number): number {
  return quantile(sorted, u);
}

// ---- linear algebra: PSD correction + Cholesky ------------------------------

/** Jacobi eigen-decomposition of a symmetric matrix → (eigenvalues, eigenvectors). */
export function jacobiEigen(matrix: number[][]): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  const a = matrix.map((row) => row.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 64; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) off += a[p]![q]! * a[p]![q]!;
    }
    if (off < 1e-20) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < 1e-15) continue;
        const app = a[p]![p]!;
        const aqq = a[q]![q]!;
        const theta = (aqq - app) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        // Two-sided rotation A ← Jᵀ A J: columns first, then rows.
        for (let k = 0; k < n; k += 1) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        // Exact classical updates for the pivots (avoids round-off drift).
        a[p]![p] = app - t * apq;
        a[q]![q] = aqq + t * apq;
        a[p]![q] = 0;
        a[q]![p] = 0;
        // Eigenvector accumulation V ← V·J (column rotation only).
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const values = Array.from({ length: n }, (_, i) => a[i]![i]!);
  return { values, vectors: v };
}

/**
 * Nearest (in Frobenius sense) positive-semidefinite correlation-like matrix:
 * clamp eigenvalues to ≥ 1e-8, reconstruct, then rescale to unit diagonal.
 */
export function makePsd(matrix: number[][]): number[][] {
  const n = matrix.length;
  if (n === 0) return [];
  const { values, vectors } = jacobiEigen(matrix);
  const clamped = values.map((lv) => Math.max(1e-8, lv));
  // R' = V diag(clamped) Vᵀ (V stored row-wise → R'[i][j] = Σ_k V[i][k] λ_k V[j][k]).
  const out: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i; j < n; j += 1) {
      let s = 0;
      for (let k = 0; k < n; k += 1) s += vectors[i]![k]! * clamped[k]! * vectors[j]![k]!;
      out[i]![j] = s;
      out[j]![i] = s;
    }
  }
  // Symmetric rescale to unit diagonal: R'' = D·R'·D with D = diag(1/√d).
  const scale = out.map((row, i) => (row[i]! > 1e-12 ? 1 / Math.sqrt(row[i]!) : 1));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      out[i]![j] = out[i]![j]! * scale[i]! * scale[j]!;
    }
  }
  for (let i = 0; i < n; i += 1) out[i]![i] = 1;
  return out;
}

/** Cholesky factor L (lower-triangular) with L·Lᵀ = A; null if not PSD. */
export function cholesky(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = matrix[i]![j]!;
      for (let k = 0; k < j; k += 1) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (!Number.isFinite(s) || s <= 1e-12) return null;
        L[i]![j] = Math.sqrt(s);
      } else {
        L[i]![j] = s / L[j]![j]!;
      }
    }
  }
  return L;
}

/** Cholesky with escalating jitter fallback; never returns null for finite input. */
function choleskySafe(matrix: number[][]): number[][] {
  const direct = cholesky(matrix);
  if (direct) return direct;
  for (const jitter of [1e-10, 1e-8, 1e-6, 1e-4]) {
    const bumped = matrix.map((row, i) => row.map((v, j) => (i === j ? v + jitter : v)));
    const l = cholesky(bumped);
    if (l) return l;
  }
  return matrix.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
}

// ---- Gaussian copula ---------------------------------------------------------

interface CopulaBundle {
  /** Column models participating (non-constant numeric). */
  columns: ColumnModel[];
  /** PSD-corrected normal-score correlation matrix. */
  corr: number[][];
  /** Lower-triangular Cholesky factor of `corr`. */
  chol: number[][];
}

/**
 * Build the Gaussian-copula kit: per-column empirical marginals plus the
 * correlation matrix of the normal scores (rank → Φ⁻¹), PSD-corrected.
 */
function buildCopula(numeric: ColumnModel[]): CopulaBundle {
  const usable = numeric.filter((c) => (c.sorted?.length ?? 0) >= 2 && (c.fit?.kind ?? 'constant') !== 'constant');
  const m = usable.length;
  if (m === 0) return { columns: [], corr: [], chol: [] };
  // Normal scores per row: rank of each observation within its column
  // (average ranks for ties) → u = rank/(len+1) → z = Φ⁻¹(u). Normalization
  // uses each column's own value count: columns may have different lengths
  // (missing cells are dropped per column), and the global minimum would push
  // longer columns to u ≥ 1 → ±Inf normal scores. Row order is preserved so
  // cross-column Pearson correlations estimate the copula.
  const z: number[][] = usable.map((c) => {
    const ranks = averageRanks(c.values!);
    const len = c.values!.length;
    return ranks.map((r) => normalQuantile(r / (len + 1)));
  });
  const corr: number[][] = Array.from({ length: m }, () => new Array<number>(m).fill(0));
  for (let i = 0; i < m; i += 1) {
    for (let j = i; j < m; j += 1) {
      const r = i === j ? 1 : pearson(z[i]!, z[j]!);
      corr[i]![j] = r;
      corr[j]![i] = r;
    }
  }
  const psd = makePsd(corr);
  return { columns: usable, corr: psd, chol: choleskySafe(psd) };
}

/**
 * Draw one correlated copula row: z = L·N(0,I) → u = Φ(z) → x = F⁻¹(u) per
 * column (empirical quantile transform). Returns values aligned with
 * `bundle.columns`.
 */
function sampleCopulaRow(
  bundle: CopulaBundle,
  rng: Rng,
  dpMarginals?: Array<DpMarginal | null>,
): number[] {
  const m = bundle.columns.length;
  const indep = Array.from({ length: m }, () => gaussian(rng));
  const out = new Array<number>(m).fill(0);
  for (let i = 0; i < m; i += 1) {
    let s = 0;
    for (let j = 0; j <= i; j += 1) s += bundle.chol[i]![j]! * indep[j]!;
    const u = normalCdf(s);
    const sorted = bundle.columns[i]!.sorted!;
    const dp = dpMarginals?.[i];
    out[i] = dp ? dpMarginalQuantile(dp, u) : sampleEmpirical(sorted, Math.min(1 - 1e-9, Math.max(1e-9, u)));
  }
  return out;
}

// ---- privacy: Laplace ε-differential privacy --------------------------------

/**
 * Laplace noise via inverse-transform sampling:
 *   x = μ − b·sign(u)·ln(1 − 2|u|),  u ~ Uniform(−0.5, 0.5),  b = sensitivity/ε.
 */
export function laplaceNoise(rng: Rng, epsilon: number, sensitivity: number, mu = 0): number {
  const eps = Math.max(1e-9, epsilon);
  const b = Math.max(1e-12, sensitivity / eps);
  const u = rng() - 0.5;
  return mu - b * Math.sign(u || 1e-12) * Math.log(1 - 2 * Math.abs(u));
}

/**
 * ε-DP release of a bounded-sample mean: the global sensitivity of the mean
 * over values in [min, max] is (max − min)/n, so Laplace noise of that scale
 * is added (Laplace mechanism).
 */
export function dpMean(values: number[], epsilon: number, rng: Rng): { value: number; sensitivity: number } {
  if (values.length === 0) return { value: 0, sensitivity: 0 };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const sensitivity = (hi - lo) / values.length;
  return { value: meanOf(values) + laplaceNoise(rng, epsilon, sensitivity), sensitivity };
}

/** Noisy histogram: counts + Laplace(0, 1/ε) (sensitivity 1 per row), floored at 0. */
function dpHistogramCounts(counts: number[], epsilon: number, rng: Rng): number[] {
  return counts.map((c) => Math.max(0, c + laplaceNoise(rng, epsilon, 1)));
}

interface DpMarginal {
  /** Bin edges (ascending, length = bins + 1). */
  edges: number[];
  /** DP-noised, renormalized bin probabilities. */
  probs: number[];
}

/** Build an ε-DP piecewise-uniform marginal from a numeric column (histogram + Laplace). */
function buildDpMarginal(values: number[], bins: number, epsilon: number, rng: Rng): DpMarginal {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const width = hi > lo ? (hi - lo) / bins : 1;
  const counts = new Array<number>(bins).fill(0);
  for (const v of values) {
    let k = Math.floor((v - lo) / width);
    if (!(k >= 0)) k = 0;
    if (k >= bins) k = bins - 1;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const noisy = dpHistogramCounts(counts, epsilon, rng);
  const total = noisy.reduce((s, c) => s + c, 0);
  const edges = Array.from({ length: bins + 1 }, (_, i) => lo + i * width);
  if (total <= 0) {
    return { edges, probs: new Array<number>(bins).fill(1 / bins) };
  }
  return { edges, probs: noisy.map((c) => c / total) };
}

/** Inverse CDF of a DP histogram marginal at probability `u` (no extra RNG). */
function dpMarginalQuantile(dp: DpMarginal, u: number): number {
  const clamped = Math.min(1 - 1e-12, Math.max(0, u));
  let acc = 0;
  const last = dp.probs.length - 1;
  for (let k = 0; k <= last; k += 1) {
    const p = dp.probs[k]!;
    if (clamped <= acc + p || k === last) {
      const f = p > 0 ? (clamped - acc) / p : 0.5;
      const lo = dp.edges[k]!;
      const hi = dp.edges[k + 1] ?? lo;
      return lo + (hi - lo) * Math.min(1, Math.max(0, f));
    }
    acc += p;
  }
  return dp.edges[dp.edges.length - 1] ?? 0;
}

/** Inverse-CDF draw from a DP histogram marginal (uniform within the bin). */
function sampleDpMarginal(dp: DpMarginal, rng: Rng): number {
  return dpMarginalQuantile(dp, rng());
}

/** ε-DP category frequencies: Laplace(1/ε) on each count, renormalized. */
function dpFrequencies(counts: number[], epsilon: number, rng: Rng): number[] {
  const noisy = counts.map((c) => Math.max(0, c + laplaceNoise(rng, epsilon, 1)));
  const total = noisy.reduce((s, c) => s + c, 0);
  if (total <= 0) return counts.map(() => 1 / Math.max(1, counts.length));
  return noisy.map((c) => c / total);
}

/** Noisy missing rate: the missing-count statistic + Laplace(1/ε). */
function dpMissingRate(missingCount: number, total: number, epsilon: number, rng: Rng): number {
  if (total <= 0) return 0;
  const noisy = Math.max(0, missingCount + laplaceNoise(rng, epsilon, 1));
  return Math.min(1, noisy / total);
}

// ---- privacy: k-anonymity -----------------------------------------------------

interface KAnonResult {
  table: SynthTable;
  /** Rows removed because their equivalence class was smaller than k. */
  suppressed: number;
  /** Smallest surviving equivalence-class size (0 when everything was suppressed). */
  minClassSize: number;
  /** Number of distinct equivalence classes before suppression. */
  classes: number;
  /** Binned numeric columns used as quasi-identifiers. */
  binnedColumns: string[];
}

/**
 * k-anonymity over the generated table: numeric quasi-identifiers are
 * generalized into `bins` equal-width intervals (replaced by bin midpoints),
 * categorical/boolean/text columns are used as-is, then rows whose
 * quasi-identifier combination occurs fewer than k times are suppressed.
 */
export function applyKAnonymity(table: SynthTable, k: number, bins = 8): KAnonResult {
  const models = table.columns.map((name, i) => {
    const cells = columnCells(table.rows, i);
    return { name, i, prof: profileRole(cells) };
  });
  const binnedColumns: string[] = [];
  const generalizers = new Map<number, (v: Cell) => Cell>();
  for (const col of models) {
    if (col.prof.role === 'numeric') {
      const values: number[] = [];
      for (const row of table.rows) {
        const v = row[col.i];
        if (typeof v === 'number') values.push(v);
      }
      if (values.length === 0) continue;
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      if (hi <= lo) {
        generalizers.set(col.i, (v) => (typeof v === 'number' ? Math.round(v * 1e6) / 1e6 : v));
        continue;
      }
      const width = (hi - lo) / bins;
      binnedColumns.push(col.name);
      generalizers.set(col.i, (v) => {
        if (typeof v !== 'number') return v;
        let idx = Math.floor((v - lo) / width);
        if (!(idx >= 0)) idx = 0;
        if (idx >= bins) idx = bins - 1;
        return lo + (idx + 0.5) * width;
      });
    } else if (col.prof.role === 'categorical' || col.prof.role === 'boolean' || col.prof.role === 'text') {
      generalizers.set(col.i, (v) => v);
    }
  }

  const keyOf = (row: Cell[]): string => {
    const parts: string[] = [];
    for (const [i, gen] of generalizers) parts.push(String(gen(row[i] ?? null)));
    return parts.join('\u0001');
  };

  const counts = new Map<string, number>();
  for (const row of table.rows) {
    const key = keyOf(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const minOf = Math.max(1, Math.round(k));
  const keptRows: Cell[][] = [];
  let minClassSize = 0;
  for (const row of table.rows) {
    const size = counts.get(keyOf(row)) ?? 0;
    if (size >= minOf) {
      keptRows.push(row.map((v, i) => generalizers.get(i)?.(v) ?? v));
      minClassSize = minClassSize === 0 ? size : Math.min(minClassSize, size);
    }
  }
  return {
    table: { columns: table.columns, rows: keptRows },
    suppressed: table.rows.length - keptRows.length,
    minClassSize,
    classes: counts.size,
    binnedColumns,
  };
}

// ---- quality metrics ---------------------------------------------------------

interface QualityDetail {
  column: string;
  kind: 'numeric' | 'categorical' | 'boolean' | 'skipped';
  /** Two-sample KS statistic (numeric columns). */
  ks?: number;
  /** Total variation distance of category frequencies (categorical / boolean). */
  tvd?: number;
  /** Similarity in [0, 1]: 1 − statistic. */
  similarity: number;
}

export interface QualityReport {
  perColumn: QualityDetail[];
  /** Mean KS over shared numeric columns (null if none). */
  meanKs: number | null;
  /** Mean TVD over shared categorical / boolean columns (null if none). */
  meanTvd: number | null;
  /** Mean |Δ Pearson correlation| over shared numeric column pairs (null if < 2). */
  corrAbsDiff: number | null;
  /** Mean |Δ missing rate| over shared columns (null if none). */
  missingRateDiff: number | null;
  /** Overall similarity score in [0, 1] (higher = more similar). */
  overall: number;
}

function cellsOf(table: SynthTable, name: string): string[] | null {
  const idx = table.columns.indexOf(name);
  if (idx < 0) return null;
  return columnCells(table.rows, idx);
}

function numericCells(cells: string[]): number[] {
  const out: number[] = [];
  for (const c of cells) {
    const v = parseNum(c);
    if (v !== null) out.push(v);
  }
  return out;
}

function categoryFreqs(cells: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  let present = 0;
  for (const c of cells) {
    const t = c.trim();
    if (t === '') continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
    present += 1;
  }
  const freqs = new Map<string, number>();
  for (const [k, n] of counts) freqs.set(k, present > 0 ? n / present : 0);
  return freqs;
}

function tvdOf(p: Map<string, number>, q: Map<string, number>): number {
  const keys = new Set<string>([...p.keys(), ...q.keys()]);
  let s = 0;
  for (const k of keys) s += Math.abs((p.get(k) ?? 0) - (q.get(k) ?? 0));
  return 0.5 * s;
}

function missingRateOf(cells: string[]): number {
  if (cells.length === 0) return 0;
  let missing = 0;
  for (const c of cells) if (c.trim() === '') missing += 1;
  return missing / cells.length;
}

/** Compare an original and a synthetic table column-by-column. */
export function qualityMetrics(original: SynthTable, synthetic: SynthTable): QualityReport {
  const details: QualityDetail[] = [];
  const sims: number[] = [];
  let ksSum = 0;
  let ksN = 0;
  let tvdSum = 0;
  let tvdN = 0;
  let missSum = 0;
  let missN = 0;
  const origNumeric = new Map<string, number[]>();
  const synNumeric = new Map<string, number[]>();

  for (const name of original.columns) {
    const a = cellsOf(original, name);
    const b = cellsOf(synthetic, name);
    if (!a || !b) continue;
    const role = profileRole(a).role;
    missSum += Math.abs(missingRateOf(a) - missingRateOf(b));
    missN += 1;
    if (role === 'numeric') {
      const va = numericCells(a);
      const vb = numericCells(b);
      const ks = va.length > 0 && vb.length > 0 ? ksStatistic(va, vb) : 0;
      details.push({ column: name, kind: 'numeric', ks, similarity: 1 - ks });
      origNumeric.set(name, va);
      synNumeric.set(name, vb);
      ksSum += ks;
      ksN += 1;
      sims.push(1 - ks);
    } else if (role === 'categorical' || role === 'boolean') {
      const tvd = tvdOf(categoryFreqs(a), categoryFreqs(b));
      details.push({ column: name, kind: role === 'boolean' ? 'boolean' : 'categorical', tvd, similarity: 1 - tvd });
      tvdSum += tvd;
      tvdN += 1;
      sims.push(1 - tvd);
    } else {
      details.push({ column: name, kind: 'skipped', similarity: Number.NaN });
    }
  }

  // Correlation preservation over shared numeric columns.
  let corrDiff: number | null = null;
  const shared = [...origNumeric.keys()].filter((k) => synNumeric.has(k));
  if (shared.length >= 2) {
    let sum = 0;
    let pairs = 0;
    for (let i = 0; i < shared.length; i += 1) {
      for (let j = i + 1; j < shared.length; j += 1) {
        const ra = pearson(origNumeric.get(shared[i]!)!, origNumeric.get(shared[j]!)!);
        const rb = pearson(synNumeric.get(shared[i]!)!, synNumeric.get(shared[j]!)!);
        sum += Math.abs(ra - rb);
        pairs += 1;
      }
    }
    if (pairs > 0) corrDiff = sum / pairs;
  }
  if (corrDiff !== null) sims.push(1 - Math.min(1, corrDiff));
  const missDiff = missN > 0 ? missSum / missN : null;
  if (missDiff !== null) sims.push(1 - Math.min(1, missDiff));

  const finite = sims.filter((s) => Number.isFinite(s));
  return {
    perColumn: details,
    meanKs: ksN > 0 ? ksSum / ksN : null,
    meanTvd: tvdN > 0 ? tvdSum / tvdN : null,
    corrAbsDiff: corrDiff,
    missingRateDiff: missDiff,
    overall: finite.length > 0 ? finite.reduce((s, v) => s + v, 0) / finite.length : 0,
  };
}

// ---- generation orchestration -------------------------------------------------

export type SynthMode = 'copula' | 'independent' | 'timeseries';
export type PrivacyMode = 'none' | 'dp' | 'k-anonymity';

export interface SynthOptions {
  rows: number;
  seed: number;
  mode: SynthMode;
  privacy: PrivacyMode;
  /** ε-DP budget (privacy === 'dp'). */
  epsilon: number;
  /** k-anonymity threshold (privacy === 'k-anonymity'). */
  k: number;
}

export interface SynthResult {
  table: SynthTable;
  report: QualityReport;
  /** Columns dropped from the output (high-cardinality ids, empty columns). */
  skipped: Array<{ column: string; reason: string }>;
  privacy: {
    mode: PrivacyMode;
    epsilon?: number;
    k?: number;
    suppressed?: number;
    minClassSize?: number | null;
    binnedColumns?: string[];
  };
  runtimeMs: number;
  seed: number;
  mode: SynthMode;
  requestedRows: number;
}

const DP_BINS = 24;
const KANON_BINS = 8;

function sampleCategorical(model: ColumnModel, rng: Rng, dpEpsilon: number | null): string {
  const cats = model.categories ?? [];
  if (cats.length === 0) return '';
  const counts = model.counts ?? (model.frequencies ?? []).map((f) => Math.round(f * 100));
  const probs = dpEpsilon !== null ? dpFrequencies(counts, dpEpsilon, rng) : model.frequencies ?? [];
  let u = rng();
  for (let i = 0; i < probs.length; i += 1) {
    if (u < probs[i]! || i === probs.length - 1) return cats[i] ?? '';
    u -= probs[i]!;
  }
  return cats[cats.length - 1] ?? '';
}

/**
 * Generate a synthetic table from `original` under the given options.
 * Deterministic: (original, options) → same output bit-for-bit.
 */
export function generateSynthetic(original: SynthTable, opts: SynthOptions): SynthResult {
  const startedAt = performance.now();
  const model = fitModel(original);
  const rows = Math.max(1, Math.round(opts.rows));
  const rng = createRng(opts.seed);
  const useDp = opts.privacy === 'dp';
  const epsilon = Math.max(0.01, opts.epsilon);
  const skipped: Array<{ column: string; reason: string }> = [];

  // ε-DP releases: noisy histogram marginals, category frequencies, missing rates.
  const dpMarginalByCol = new Map<number, DpMarginal>();
  const dpMissingByCol = new Map<number, number>();
  if (useDp) {
    model.columns.forEach((col, i) => {
      if (col.role === 'numeric' && (col.values?.length ?? 0) > 0 && (col.fit?.kind ?? 'constant') !== 'constant') {
        dpMarginalByCol.set(i, buildDpMarginal(col.values!, DP_BINS, epsilon, rng));
      }
      dpMissingByCol.set(i, dpMissingRate(Math.round(col.missingRate * model.rowCount), model.rowCount, epsilon, rng));
    });
  }

  const numericIdx = model.columns.map((c, i) => (c.role === 'numeric' ? i : -1)).filter((i) => i >= 0);
  const bundle = opts.mode === 'copula' ? buildCopula(numericIdx.map((i) => model.columns[i]!)) : null;
  const bundleDp = bundle
    ? bundle.columns.map((col) => {
        const i = model.columns.indexOf(col);
        return i >= 0 ? dpMarginalByCol.get(i) ?? null : null;
      })
    : null;

  // Allocate generated numeric rows per column.
  const numericValues = new Map<number, number[]>();
  for (const i of numericIdx) numericValues.set(i, new Array<number>(rows).fill(0));

  if (opts.mode === 'copula' && bundle && bundle.columns.length > 0) {
    for (let r = 0; r < rows; r += 1) {
      const vals = sampleCopulaRow(bundle, rng, bundleDp ?? undefined);
      for (let b = 0; b < bundle.columns.length; b += 1) {
        const colIdx = model.columns.indexOf(bundle.columns[b]!);
        if (colIdx >= 0) numericValues.get(colIdx)![r] = vals[b]!;
      }
    }
    // Constant numeric columns are copied (not part of the copula).
    for (const i of numericIdx) {
      const col = model.columns[i]!;
      if (col.fit?.kind === 'constant') {
        const v = col.fit.params.value ?? 0;
        numericValues.set(i, new Array<number>(rows).fill(v));
      }
    }
  }
  if (opts.mode !== 'copula' || !bundle || bundle.columns.length === 0) {
    for (const i of numericIdx) {
      const col = model.columns[i]!;
      if (col.fit?.kind === 'constant') {
        numericValues.set(i, new Array<number>(rows).fill(col.fit.params.value ?? 0));
        continue;
      }
      if (opts.mode === 'timeseries' && (col.sorted?.length ?? 0) > 1) {
        // AR(1) in normal-score space: preserves the lag-1 autocorrelation and
        // the empirical marginal via the quantile transform.
        const rho = col.ar1 ?? 0;
        const innov = Math.sqrt(Math.max(0, 1 - rho * rho));
        const sorted = col.sorted!;
        const dp = dpMarginalByCol.get(i);
        let prev = 0;
        const series: number[] = [];
        for (let r = 0; r < rows; r += 1) {
          const z = r === 0 ? gaussian(rng) : rho * prev + innov * gaussian(rng);
          prev = z;
          const u = Math.min(1 - 1e-9, Math.max(1e-9, normalCdf(z)));
          series.push(dp ? dpMarginalQuantile(dp, u) : quantile(sorted, u));
        }
        numericValues.set(i, series);
      } else {
        const dp = dpMarginalByCol.get(i);
        const series: number[] = [];
        for (let r = 0; r < rows; r += 1) {
          series.push(dp ? sampleDpMarginal(dp, rng) : sampleDist(col.fit!, rng));
        }
        numericValues.set(i, series);
      }
    }
  }

  // Assemble rows: numeric from the buffers above, then categorical / boolean.
  const outColumns: string[] = [];
  const valueMakers: Array<(r: number) => Cell> = [];
  model.columns.forEach((col, i) => {
    if (col.role === 'id') {
      skipped.push({
        column: col.name,
        reason: `high-cardinality identifier (${col.unique ?? '?'} unique values) — skipped`,
      });
      return;
    }
    if (col.role === 'empty') {
      skipped.push({ column: col.name, reason: 'empty column — skipped' });
      return;
    }
    outColumns.push(col.name);
    const missingRate = useDp ? dpMissingByCol.get(i) ?? col.missingRate : col.missingRate;
    if (col.role === 'numeric') {
      const series = numericValues.get(i)!;
      valueMakers.push((r) => (rng() < missingRate ? null : series[r] ?? null));
    } else if (col.role === 'boolean') {
      const p = col.pTrue ?? 0.5;
      valueMakers.push(() => (rng() < missingRate ? null : rng() < p));
    } else {
      valueMakers.push(() => (rng() < missingRate ? null : sampleCategorical(col, rng, useDp ? epsilon : null)));
    }
  });

  const table: SynthTable = { columns: outColumns, rows: [] };
  for (let r = 0; r < rows; r += 1) {
    table.rows.push(valueMakers.map((make) => make(r)));
  }

  let privacy: SynthResult['privacy'] = { mode: opts.privacy };
  if (opts.privacy === 'dp') {
    privacy = { mode: 'dp', epsilon };
  } else if (opts.privacy === 'k-anonymity') {
    const kanon = applyKAnonymity(table, opts.k, KANON_BINS);
    privacy = {
      mode: 'k-anonymity',
      k: Math.max(1, Math.round(opts.k)),
      suppressed: kanon.suppressed,
      minClassSize: kanon.table.rows.length > 0 ? kanon.minClassSize : 0,
      binnedColumns: kanon.binnedColumns,
    };
    table.rows = kanon.table.rows;
  }

  return {
    table,
    report: qualityMetrics(original, table),
    skipped,
    privacy,
    runtimeMs: performance.now() - startedAt,
    seed: opts.seed,
    mode: opts.mode,
    requestedRows: rows,
  };
}

