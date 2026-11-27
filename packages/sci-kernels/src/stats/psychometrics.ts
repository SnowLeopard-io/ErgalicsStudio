// ==========================================================================
// Ergalics Studio — psychometrics (pure TS, no WASM)
//
// Questionnaire reliability and factorability checks that social-science and
// education theses require before anything else:
//
//   - Cronbach's α (internal consistency) with α-if-item-deleted and
//     item–total / inter-item diagnostics;
//   - KMO (Kaiser–Meyer–Olkin) sampling adequacy, overall and per item,
//     from the correlation matrix and its partial-correlation inverse;
//   - Bartlett's test of sphericity (is the correlation matrix distinguishable
//     from the identity?).
//
// Input convention: `items` is an n × k matrix — n subjects (rows), k items
// (columns). Columns with zero variance are rejected explicitly rather than
// silently producing −Infinity / NaN.
// ==========================================================================

import { inverseSPD } from '../math/linalg';
import { chiSquareCdf, studentTCdf } from './special';

function validate(items: number[][]): { n: number; k: number } {
  const n = items.length;
  if (n < 2) throw new Error('psychometrics: at least two subjects are required');
  const k = items[0]!.length;
  if (k < 2) throw new Error('psychometrics: at least two items are required');
  for (let i = 0; i < n; i += 1) {
    if (items[i]!.length !== k) throw new Error('psychometrics: every row must have the same length');
    for (const v of items[i]!) {
      if (!Number.isFinite(v)) throw new Error('psychometrics: missing / non-finite values are not supported');
    }
  }
  return { n, k };
}

function column(items: number[][], j: number): number[] {
  return items.map((row) => row[j]!);
}

function variance(values: number[], ddof = 1): number {
  const n = values.length;
  if (n <= ddof) return NaN;
  const m = values.reduce((s, v) => s + v, 0) / n;
  let ss = 0;
  for (const v of values) ss += (v - m) ** 2;
  return ss / (n - ddof);
}

function correlationMatrix(items: number[][], n: number, k: number): number[][] {
  const cols = Array.from({ length: k }, (_, j) => column(items, j));
  const means = cols.map((c) => c.reduce((s, v) => s + v, 0) / n);
  const sds = cols.map((c) => Math.sqrt(variance(c, 1)));
  const R: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let a = 0; a < k; a += 1) {
    R[a]![a] = 1;
    for (let b = a + 1; b < k; b += 1) {
      if (!(sds[a]! > 0) || !(sds[b]! > 0)) {
        throw new Error(`psychometrics: item ${(!(sds[a]! > 0) ? a : b) + 1} has zero variance`);
      }
      let cov = 0;
      for (let i = 0; i < n; i += 1) cov += (cols[a]![i]! - means[a]!) * (cols[b]![i]! - means[b]!);
      const r = cov / ((n - 1) * sds[a]! * sds[b]!);
      R[a]![b] = r;
      R[b]![a] = r;
    }
  }
  return R;
}

// ---- Cronbach's alpha -----------------------------------------------------

export interface CronbachResult {
  alpha: number;
  nItems: number;
  nSubjects: number;
  /** α with each item removed (useful for scale refinement). */
  alphaIfDeleted: number[];
  /** Correlation of each item with the rest of the scale. */
  itemTotalCorrelation: number[];
  /** Mean off-diagonal inter-item correlation. */
  meanInterItemCorrelation: number;
  interpretation: string;
}

function alphaOf(cols: number[][]): number {
  const k = cols.length;
  if (k < 2) return NaN;
  const variances = cols.map((c) => variance(c, 1));
  const total = Array.from({ length: cols[0]!.length }, (_, i) =>
    cols.reduce((s, c) => s + c[i]!, 0),
  );
  const totalVar = variance(total, 1);
  if (!(totalVar > 0)) return NaN;
  const sumItemVar = variances.reduce((s, v) => s + v, 0);
  return (k / (k - 1)) * (1 - sumItemVar / totalVar);
}

function alphaLabel(alpha: number): string {
  if (!Number.isFinite(alpha)) return 'undefined';
  if (alpha >= 0.9) return 'excellent';
  if (alpha >= 0.8) return 'good';
  if (alpha >= 0.7) return 'acceptable';
  if (alpha >= 0.6) return 'questionable';
  if (alpha >= 0.5) return 'poor';
  return 'unacceptable';
}

/**
 * Cronbach's α = k/(k−1) · (1 − Σσ²ᵢ / σ²_total).
 * Values around 0.7–0.9 are conventionally acceptable for research scales.
 */
export function cronbachAlpha(items: number[][]): CronbachResult {
  const { n, k } = validate(items);
  const cols = Array.from({ length: k }, (_, j) => column(items, j));
  const alpha = alphaOf(cols);
  const alphaIfDeleted = cols.map((_, j) => alphaOf(cols.filter((__, i) => i !== j)));

  const total = Array.from({ length: n }, (_, i) => cols.reduce((s, c) => s + c[i]!, 0));
  const totalVar = variance(total, 1);
  const totalSd = Math.sqrt(totalVar);
  const itemTotalCorrelation = cols.map((c) => {
    const rest = Array.from({ length: n }, (_, i) => total[i]! - c[i]!);
    const restSd = Math.sqrt(variance(rest, 1));
    if (!(totalSd > 0) || !(restSd > 0)) return NaN;
    let cov = 0;
    const mc = c.reduce((s, v) => s + v, 0) / n;
    const mr = rest.reduce((s, v) => s + v, 0) / n;
    for (let i = 0; i < n; i += 1) cov += (c[i]! - mc) * (rest[i]! - mr);
    return cov / ((n - 1) * Math.sqrt(variance(c, 1)) * restSd);
  });

  let rsum = 0;
  let rcount = 0;
  for (let a = 0; a < k; a += 1) {
    for (let b = a + 1; b < k; b += 1) {
      const aCol = cols[a]!;
      const bCol = cols[b]!;
      const ma = aCol.reduce((s, v) => s + v, 0) / n;
      const mb = bCol.reduce((s, v) => s + v, 0) / n;
      let cov = 0;
      for (let i = 0; i < n; i += 1) cov += (aCol[i]! - ma) * (bCol[i]! - mb);
      const denom = (n - 1) * Math.sqrt(variance(aCol, 1)) * Math.sqrt(variance(bCol, 1));
      if (denom > 0) {
        rsum += cov / denom;
        rcount += 1;
      }
    }
  }

  return {
    alpha,
    nItems: k,
    nSubjects: n,
    alphaIfDeleted,
    itemTotalCorrelation,
    meanInterItemCorrelation: rcount ? rsum / rcount : NaN,
    interpretation: alphaLabel(alpha),
  };
}

// ---- KMO ------------------------------------------------------------------

export interface KmoResult {
  overall: number;
  perItem: number[];
  interpretation: string;
}

function kmoLabel(value: number): string {
  if (!Number.isFinite(value)) return 'undefined';
  if (value >= 0.9) return 'marvelous';
  if (value >= 0.8) return 'meritorious';
  if (value >= 0.7) return 'middling';
  if (value >= 0.6) return 'mediocre';
  if (value >= 0.5) return 'miserable';
  return 'unacceptable';
}

/**
 * Kaiser–Meyer–Olkin measure. Partial correlations come from the scaled
 * inverse correlation matrix: pᵢⱼ = −(R⁻¹)ᵢⱼ / √((R⁻¹)ᵢᵢ(R⁻¹)ⱼⱼ).
 */
export function kmo(items: number[][]): KmoResult {
  const { n, k } = validate(items);
  const R = correlationMatrix(items, n, k);
  let Rinv: number[][];
  try {
    Rinv = inverseSPD(R);
  } catch {
    throw new Error('kmo: the correlation matrix is singular (items are linearly dependent)');
  }
  // `inverseSPD` clamps tiny pivots, so a singular matrix can still come back
  // with finite-looking (but meaningless) values. Check the determinant too.
  if (!(Math.exp(logAbsDet(R)) > 1e-12)) {
    throw new Error('kmo: the correlation matrix is singular (items are linearly dependent)');
  }
  const partial = (i: number, j: number): number => {
    const denom = Math.sqrt(Math.max(Rinv[i]![i]!, 1e-300) * Math.max(Rinv[j]![j]!, 1e-300));
    return denom > 0 ? -Rinv[i]![j]! / denom : 0;
  };

  let sumR2 = 0;
  let sumP2 = 0;
  const rowR2 = new Array<number>(k).fill(0);
  const rowP2 = new Array<number>(k).fill(0);
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) {
      if (i === j) continue;
      const r2 = R[i]![j]! ** 2;
      const p2 = partial(i, j) ** 2;
      sumR2 += r2;
      sumP2 += p2;
      rowR2[i]! += r2;
      rowP2[i]! += p2;
    }
  }
  const overall = sumR2 + sumP2 > 0 ? sumR2 / (sumR2 + sumP2) : NaN;
  const perItem = rowR2.map((r2, i) => (r2 + rowP2[i]! > 0 ? r2 / (r2 + rowP2[i]!) : NaN));
  return { overall, perItem, interpretation: kmoLabel(overall) };
}

// ---- Bartlett -------------------------------------------------------------

export interface BartlettResult {
  chiSquare: number;
  df: number;
  pValue: number;
  determinant: number;
}

/** log|det(A)| by Gaussian elimination with partial pivoting. */
function logAbsDet(A: number[][]): number {
  const n = A.length;
  const M = A.map((row) => row.slice());
  let logDet = 0;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    const p = M[pivot]![col]!;
    if (!(Math.abs(p) > 0)) return -Infinity;
    if (pivot !== col) {
      [M[col], M[pivot]] = [M[pivot]!, M[col]!];
      // Swapping two rows flips the sign, irrelevant for |det|.
    }
    logDet += Math.log(Math.abs(p));
    for (let r = col + 1; r < n; r += 1) {
      const f = M[r]![col]! / p;
      if (f === 0) continue;
      for (let c = col; c < n; c += 1) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return logDet;
}

/**
 * Bartlett's test of sphericity:
 *   χ² = −(n − 1 − (2k + 5)/6) · ln|R|,  df = k(k − 1)/2.
 * A significant result means the correlation matrix is not an identity —
 * i.e. factor analysis is worthwhile.
 */
export function bartlettTest(items: number[][]): BartlettResult {
  const { n, k } = validate(items);
  const R = correlationMatrix(items, n, k);
  const logDet = logAbsDet(R);
  const det = Math.exp(logDet);
  const df = (k * (k - 1)) / 2;
  const chiSquare = -logDet * (n - 1 - (2 * k + 5) / 6);
  const pValue = Number.isFinite(chiSquare) ? 1 - chiSquareCdf(Math.max(0, chiSquare), df) : 0;
  return {
    chiSquare,
    df,
    pValue: Math.min(1, Math.max(0, pValue)),
    determinant: Number.isFinite(det) ? det : 0,
  };
}

// ---- item-total t diagnostics (convenience for reports) --------------------

export interface ItemTotalResult {
  item: number;
  r: number;
  t: number;
  df: number;
  pValue: number;
}

/**
 * Two-sided t test for each item–total correlation (H0: ρ = 0) using
 * t = r√(n−2)/√(1−r²). Complements Cronbach's α when deciding which item to
 * drop.
 */
export function itemTotalTests(items: number[][]): ItemTotalResult[] {
  const result = cronbachAlpha(items);
  const n = result.nSubjects;
  const df = n - 2;
  return result.itemTotalCorrelation.map((r, item) => {
    const t = Number.isFinite(r) && Math.abs(r) < 1 ? (r * Math.sqrt(df)) / Math.sqrt(1 - r * r) : NaN;
    return {
      item: item + 1,
      r,
      t,
      df,
      pValue: Number.isFinite(t) ? 2 * (1 - studentTCdf(Math.abs(t), df)) : NaN,
    };
  });
}
