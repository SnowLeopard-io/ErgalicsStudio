// ==========================================================================
// Ergalics Studio — streaming statistics kernels (GB-scale profiling)
//
// Single-pass, O(1)-memory-per-column accumulators used to profile datasets
// that are far larger than the WASM heap:
//   • Welford running mean / variance / skewness / kurtosis (numerically
//     stable, one row at a time)
//   • t-digest quantiles (composable, error-bounded median/p95/p99)
//   • HyperLogLog cardinality (distinct counts in kilobytes)
//   • fixed-resolution online histogram
// Everything is mergeable so batches computed in parallel can be combined.
// ==========================================================================

/** Welford running moments: mean, variance (sample), skewness, kurtosis. */
export class Welford {
  private n = 0;
  private m1 = 0;
  private m2 = 0;
  private m3 = 0;
  private m4 = 0;
  min = Number.POSITIVE_INFINITY;
  max = Number.NEGATIVE_INFINITY;

  push(x: number): void {
    if (!Number.isFinite(x)) return;
    this.n += 1;
    const delta = x - this.m1;
    const deltaN = delta / this.n;
    const deltaN2 = deltaN * deltaN;
    const term1 = delta * deltaN * (this.n - 1);
    const prevM3 = this.m3;
    const prevM2 = this.m2;
    this.m1 += deltaN;
    this.m4 += term1 * deltaN2 * (this.n * this.n - 3 * this.n + 3) + 6 * deltaN2 * prevM2 - 4 * deltaN * prevM3;
    this.m3 += term1 * deltaN * (this.n - 2) - 3 * deltaN * prevM2;
    this.m2 += term1;
    if (x < this.min) this.min = x;
    if (x > this.max) this.max = x;
  }

  get count(): number {
    return this.n;
  }

  get mean(): number {
    return this.n === 0 ? NaN : this.m1;
  }

  /** Sample variance (n-1 denominator); 0 for n <= 1. */
  get variance(): number {
    return this.n < 2 ? 0 : this.m2 / (this.n - 1);
  }

  get stdDev(): number {
    return Math.sqrt(this.variance);
  }

  /** Unbiased sample skewness; 0 for n < 3. */
  get skewness(): number {
    if (this.n < 3 || this.m2 === 0) return 0;
    return (Math.sqrt(this.n * (this.n - 1)) * this.m3) / this.m2 / (this.n - 2);
  }

  /** Unbiased sample excess kurtosis; 0 for n < 4. */
  get kurtosis(): number {
    if (this.n < 4 || this.m2 === 0) return 0;
    const k = (this.n - 1) * ((this.n + 1) * this.m4 - 3 * (this.n - 1) * this.m2 * this.m2);
    return k / ((this.n - 2) * (this.n - 3) * this.m2 * this.m2);
  }

  /** Merge another accumulator (parallel/serial batch combination). */
  merge(other: Welford): void {
    if (other.n === 0) return;
    if (this.n === 0) {
      this.n = other.n; this.m1 = other.m1; this.m2 = other.m2;
      this.m3 = other.m3; this.m4 = other.m4;
      this.min = other.min; this.max = other.max;
      return;
    }
    // Standard parallel combination (Chan et al. / Schubert & Gertz).
    const na = this.n;
    const nb = other.n;
    const n = na + nb;
    const delta = other.m1 - this.m1;
    const delta2 = delta * delta;
    const delta3 = delta2 * delta;
    const delta4 = delta3 * delta;
    const m2 = this.m2 + other.m2 + (delta2 * na * nb) / n;
    const m3 =
      this.m3 + other.m3 +
      (delta3 * na * nb * (na - nb)) / (n * n) +
      (3 * delta * (na * other.m2 - nb * this.m2)) / n;
    const m4 =
      this.m4 + other.m4 +
      (delta4 * na * nb * (na * na - na * nb + nb * nb)) / (n * n * n) +
      (6 * delta2 * (na * na * other.m2 + nb * nb * this.m2)) / (n * n) +
      (4 * delta * (na * other.m3 - nb * this.m3)) / n;
    this.n = n;
    this.m1 += (delta * nb) / n;
    this.m2 = m2;
    this.m3 = m3;
    this.m4 = m4;
    if (other.min < this.min) this.min = other.min;
    if (other.max > this.max) this.max = other.max;
  }
}

/**
 * Merging t-digest (HernándezLobato-ish scale function) for error-bounded
 * streaming quantiles. `delta` controls the centroid cap (~100–1000);
 * accuracy ≈ 1/(2·delta) relative to the rank, independent of stream length.
 */
export class TDigest {
  private centroids: { mean: number; weight: number }[] = [];
  private totalWeight = 0;

  constructor(private readonly delta = 200) {}

  get size(): number {
    return this.centroids.length;
  }

  get count(): number {
    return this.totalWeight;
  }

  push(x: number): void {
    if (!Number.isFinite(x)) return;
    this.centroids.push({ mean: x, weight: 1 });
    this.totalWeight += 1;
    if (this.centroids.length > this.delta * 2) this.compress();
  }

  private compress(): void {
    const sorted = this.centroids.sort((a, b) => a.mean - b.mean);
    const merged: { mean: number; weight: number }[] = [];
    // Greedy k2 merge (tdunning): accumulate a running centroid while its
    // normalized rank stays inside the 4·delta·q(1−q) size envelope; the
    // envelope widens at the middle and collapses at the tails, so tail
    // quantiles stay singletons (high accuracy where it matters).
    let sum = 0;
    let weight = 0;
    let mean = 0;
    let open = false;
    for (const c of sorted) {
      if (!open) {
        mean = c.mean;
        weight = c.weight;
        open = true;
        continue;
      }
      const q = (sum + weight + c.weight / 2) / Math.max(1, this.totalWeight);
      // Cap the merged weight at 4·q(1−q)·N/δ: the middle can hold wide
      // centroids, the tails collapse to singletons (rank error ≤ 1/(2δ)).
      const cap = Math.max(1, (4 * q * (1 - q) * this.totalWeight) / this.delta);
      if (weight + c.weight <= cap) {
        mean = (mean * weight + c.mean * c.weight) / (weight + c.weight);
        weight += c.weight;
      } else {
        merged.push({ mean, weight });
        sum += weight;
        mean = c.mean;
        weight = c.weight;
      }
    }
    if (open) merged.push({ mean, weight });
    this.centroids = merged;
  }

  /** Quantile at rank q ∈ [0,1] by interpolation across centroid spans. */
  quantile(q: number): number {
    if (this.centroids.length === 0 || this.totalWeight === 0) return NaN;
    if (this.centroids.length === 1) return this.centroids[0]?.mean ?? NaN;
    if (this.centroids.length > this.delta) this.compress();
    const sorted = this.centroids;
    const target = q * this.totalWeight;
    const first = sorted[0];
    if (!first) return NaN;
    // The first half-span extrapolates toward the observed minimum.
    if (target <= first.weight / 2) return first.mean;
    let acc = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      const c = sorted[i];
      if (!c) break;
      const half = c.weight / 2;
      if (target <= acc + half) {
        // Left half of the span: interpolate from the previous centroid.
        const prev = sorted[i - 1]?.mean ?? c.mean;
        const t = half === 0 ? 0 : (target - acc) / half;
        return prev + (c.mean - prev) * t;
      }
      if (target <= acc + c.weight) {
        // Right half: interpolate toward the next centroid.
        const next = sorted[i + 1]?.mean ?? c.mean;
        const t = half === 0 ? 0.5 : (target - acc - half) / half;
        return c.mean + (next - c.mean) * t;
      }
      acc += c.weight;
    }
    return sorted[sorted.length - 1]?.mean ?? NaN;
  }

  /** Merge another digest (parallel batches). */
  merge(other: TDigest): void {
    for (const c of other.centroids) {
      this.centroids.push({ ...c });
      this.totalWeight += c.weight;
    }
    if (this.centroids.length > this.delta) this.compress();
  }

  /** Read-only centroid list (histogram bucketing / tests). */
  centroidView(): readonly { mean: number; weight: number }[] {
    return this.centroids;
  }
}

/**
 * HyperLogLog (paper: Flajolet et al.) distinct-value estimator.
 * 2^p registers — p=10 → 1 KiB, typical error ~1.4%. Inputs are 32-bit
 * hashed by a cheap FNV-1a variant; collisions are acceptable at the
 * accuracy target (estimates, not set semantics).
 */
export class HyperLogLog {
  private registers: Uint8Array;
  private alpha: number;

  constructor(private readonly p = 10) {
    this.registers = new Uint8Array(1 << p);
    this.alpha = p === 4 ? 0.673 : p === 5 ? 0.697 : p === 6 ? 0.709 : 0.7213 / (1 + 1.079 / (1 << p));
  }

  push(value: unknown): void {
    const h = hash32(stringify(value));
    const idx = h >>> (32 - this.p);
    const rest = (h << this.p) >>> 0;
    // Position of the leftmost 1-bit in the remaining bits (rank starts at 1).
    let rank = 1;
    if (rest === 0) rank = 32 - this.p + 1;
    else {
      while ((rest & (1 << (31 - rank))) === 0 && rank <= 32 - this.p) rank += 1;
    }
    if (rank > (this.registers[idx] ?? 0)) this.registers[idx] = rank;
  }

  /** Estimated distinct count (bias-corrected harmonic mean). */
  estimate(): number {
    const m = 1 << this.p;
    let sum = 0;
    let zeros = 0;
    for (const r of this.registers) {
      sum += Math.pow(2, -r);
      if (r === 0) zeros += 1;
    }
    let raw = (this.alpha * m * m) / sum;
    if (raw <= 2.5 * m && zeros > 0) {
      // Small-range correction: linear counting dominates below ~2.5m.
      raw = m * Math.log(m / zeros);
    }
    return Math.round(raw);
  }

  merge(other: HyperLogLog): void {
    if (other.p !== this.p) throw new Error('HyperLogLog: precision mismatch');
    for (let i = 0; i < this.registers.length; i += 1) {
      const mine = this.registers[i] ?? 0;
      const theirs = other.registers[i] ?? 0;
      if (theirs > mine) this.registers[i] = theirs;
    }
  }
}

/** FNV-1a 32-bit + murmur3 finalizer (avalanche mixing — the raw FNV high
 *  bits are biased for short similar strings, which skews HLL buckets). */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

function stringify(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? v.toString() : v.toExponential(9);
  return String(v);
}

// ---- Per-column profile ------------------------------------------------------

export type ColumnKind = 'integer' | 'float' | 'boolean' | 'string' | 'empty';

/** A number-looking literal (also accepts 1e6, -0.5, .5, 1_000 is NOT valid). */
const INT_RE = /^[+-]?\d+$/;
const FLOAT_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Classify one raw CSV cell for the streaming type scan. */
export function classifyCell(raw: string): { kind: ColumnKind; numeric?: number } {
  const s = raw.trim();
  if (s === '' || s === 'null' || s === 'NULL' || s === 'NA' || s === 'NaN') return { kind: 'empty' };
  if (s === 'true' || s === 'false' || s === 'TRUE' || s === 'FALSE') return { kind: 'boolean' };
  if (INT_RE.test(s)) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? { kind: 'integer', numeric: n } : { kind: 'float', numeric: n };
  }
  if (FLOAT_RE.test(s)) return { kind: 'float', numeric: Number(s) };
  return { kind: 'string' };
}

export interface ColumnProfile {
  name: string;
  kind: ColumnKind;
  /** Rows scanned for this column (including missing). */
  rows: number;
  missing: number;
  welford: Welford;
  quantiles: TDigest;
  distinct: HyperLogLog;
  histogram: { edges: number[]; counts: number[] };
}

export interface ColumnProfileSummary {
  name: string;
  kind: ColumnKind;
  rows: number;
  missing: number;
  missingRatio: number;
  count: number;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
  distinctEstimate: number;
  histogram: { edges: number[]; counts: number[] };
}

const HISTOGRAM_BINS = 24;

/**
 * Streaming per-column profile accumulator. Numeric columns collect moments,
 * quantiles, distinct estimates and an online histogram; string columns
 * collect distinct estimates. `initColumns` seeds names from the header row;
 * `pushRow` tolerates ragged rows (short/long) defensively.
 */
export class ProfileBuilder {
  private columns: ColumnProfile[] = [];
  private initialized = false;
  rowsSeen = 0;

  initColumns(header: string[]): void {
    this.columns = header.map((name) => ({
      name: name || '(unnamed)',
      kind: 'empty' as ColumnKind,
      rows: 0,
      missing: 0,
      welford: new Welford(),
      quantiles: new TDigest(),
      distinct: new HyperLogLog(),
      histogram: { edges: [], counts: [] },
    }));
    this.initialized = true;
  }

  get columnCount(): number {
    return this.columns.length;
  }

  /** Type of each column as currently scanned (stabilizes after warm-up). */
  kinds(): ColumnKind[] {
    return this.columns.map((c) => c.kind);
  }

  pushRow(row: string[]): void {
    if (!this.initialized) return;
    this.rowsSeen += 1;
    for (let i = 0; i < this.columns.length; i += 1) {
      const col = this.columns[i];
      if (!col) break;
      col.rows += 1;
      const raw = row[i];
      if (raw === undefined) {
        col.missing += 1;
        continue;
      }
      const cell = classifyCell(raw);
      col.distinct.push(raw);
      if (cell.kind === 'empty') {
        col.missing += 1;
        continue;
      }
      // Promote the column kind (empty → first concrete kind; int → float).
      if (col.kind === 'empty') col.kind = cell.kind;
      else if (col.kind === 'integer' && cell.kind === 'float') col.kind = 'float';
      else if (col.kind !== cell.kind && !(col.kind === 'float' && cell.kind === 'integer')) {
        col.kind = 'string';
      }
      if (cell.numeric !== undefined && col.kind !== 'string') {
        col.welford.push(cell.numeric);
        col.quantiles.push(cell.numeric);
      }
    }
  }

  /** Finalize histograms (need min/max, so built at the end). */
  summarize(): ColumnProfileSummary[] {
    return this.columns.map((col) => {
      const hist = finalizeHistogram(col);
      return {
        name: col.name,
        kind: col.kind,
        rows: col.rows,
        missing: col.missing,
        missingRatio: col.rows === 0 ? 0 : col.missing / col.rows,
        count: col.welford.count,
        mean: col.welford.mean,
        stdDev: col.welford.stdDev,
        min: col.welford.count > 0 ? col.welford.min : NaN,
        max: col.welford.count > 0 ? col.welford.max : NaN,
        p50: col.quantiles.quantile(0.5),
        p95: col.quantiles.quantile(0.95),
        p99: col.quantiles.quantile(0.99),
        distinctEstimate: col.distinct.estimate(),
        histogram: hist,
      };
    });
  }
}

/** Fixed-resolution histogram over the observed [min, max] range. */
function finalizeHistogram(col: ColumnProfile): { edges: number[]; counts: number[] } {
  if (col.welford.count < 2 || !Number.isFinite(col.welford.min) || !Number.isFinite(col.welford.max)) {
    return { edges: [], counts: [] };
  }
  const min = col.welford.min;
  const max = col.welford.max;
  if (min === max) return { edges: [min, max], counts: [col.welford.count] };
  const width = (max - min) / HISTOGRAM_BINS;
  const counts = new Array<number>(HISTOGRAM_BINS).fill(0);
  // Re-bucket from the digest's compact centroid state (weights preserved).
  for (const { mean, weight } of col.quantiles.centroidView()) {
    let bin = Math.floor((mean - min) / width);
    if (bin < 0) bin = 0;
    if (bin >= HISTOGRAM_BINS) bin = HISTOGRAM_BINS - 1;
    counts[bin] = (counts[bin] ?? 0) + weight;
  }
  const edges = Array.from({ length: HISTOGRAM_BINS + 1 }, (_, i) => min + width * i);
  edges[0] = min;
  edges[edges.length - 1] = max;
  return { edges, counts };
}
