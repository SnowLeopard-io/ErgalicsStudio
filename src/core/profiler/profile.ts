// ==========================================================================
// Ergalics Studio — Data Profiler (pure TS, data layer)
//
// Streaming, single-pass column profiling for chunked large files:
//   • numeric columns: exact min/max/mean/variance (Welford), zeros, a
//     reservoir sample for quantiles / MAD / histograms, modified-z outlier
//     count (|0.6745(x − median)/MAD| > 3.5)
//   • text columns: HyperLogLog cardinality, Space-Saving top-k, lengths
//   • table level: joint numeric reservoir for Pearson/Spearman, HyperLogLog
//     over row hashes for duplicate-rate estimation
//   • deterministic 0–100 quality score with an issue list
//
// Memory is O(cols × reservoir) regardless of row count.
// ==========================================================================

// --------------------------------------------------------------------------
// Hashes & cardinality
// --------------------------------------------------------------------------

/** FNV-1a 32-bit, returned as an unsigned int (the string form lives in repro). */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** fmix32 finaliser — spreads FNV output for HLL register indexing. */
function mix32(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

const HLL_P = 12;
const HLL_M = 1 << HLL_P;
const HLL_ALPHA = 0.7213 / (1 + 1.079 / HLL_M);

/** HyperLogLog sketch — mergeable cardinality estimator. */
export class HyperLogLog {
  readonly registers: Uint8Array = new Uint8Array(HLL_M);

  addHash(hash: number): void {
    const idx = hash & (HLL_M - 1);
    const w = hash >>> HLL_P;
    // Rank = leading zero bits of w + 1 (w has 32−P bits).
    let rank = 1;
    let bit = 1 << (31 - HLL_P);
    while (bit > 0 && (w & bit) === 0) {
      rank += 1;
      bit >>>= 1;
    }
    if (rank > this.registers[idx]!) this.registers[idx] = rank;
  }

  add(value: string): void {
    this.addHash(mix32(fnv1a(value)));
  }

  merge(other: HyperLogLog): void {
    for (let i = 0; i < HLL_M; i += 1) {
      if (other.registers[i]! > this.registers[i]!) this.registers[i] = other.registers[i]!;
    }
  }

  estimate(): number {
    let sum = 0;
    let zeros = 0;
    for (let i = 0; i < HLL_M; i += 1) {
      sum += 2 ** -this.registers[i]!;
      if (this.registers[i] === 0) zeros += 1;
    }
    let e = (HLL_ALPHA * HLL_M * HLL_M) / sum;
    if (e < 2.5 * HLL_M && zeros > 0) {
      e = HLL_M * Math.log(HLL_M / zeros); // linear counting
    } else if (e > (1 << 30) / 30) {
      e = -(2 ** 32) * Math.log(1 - e / 2 ** 32);
    }
    return e;
  }
}

// --------------------------------------------------------------------------
// Space-Saving frequent items
// --------------------------------------------------------------------------

interface Counter {
  value: string;
  count: number;
  error: number;
}

/** Space-Saving algorithm for approximate top-k frequent items. */
export class SpaceSaving {
  private map = new Map<string, Counter>();

  constructor(private readonly k = 10) {}

  add(value: string): void {
    const existing = this.map.get(value);
    if (existing) {
      existing.count += 1;
      return;
    }
    if (this.map.size < this.k) {
      this.map.set(value, { value, count: 1, error: 0 });
    } else {
      // Evict the smallest counter and inherit its error.
      let min: Counter | null = null;
      for (const c of this.map.values()) {
        if (!min || c.count < min.count) min = c;
      }
      const victim = min as Counter;
      this.map.delete(victim.value);
      this.map.set(value, { value, count: victim.count + 1, error: victim.count });
    }
  }

  /** Descending-by-count list. */
  top(): Array<{ value: string; count: number }> {
    return [...this.map.values()]
      .sort((a, b) => b.count - a.count)
      .map((c) => ({ value: c.value, count: c.count }));
  }
}

// --------------------------------------------------------------------------
// Public types
// --------------------------------------------------------------------------

export type ColumnKind = 'numeric' | 'text';

export interface ColumnSpec {
  name: string;
  kind?: ColumnKind;
}

export interface Histogram {
  min: number;
  max: number;
  bins: number;
  /** bin edges, length bins+1 */
  edges: number[];
  counts: number[];
}

export interface NumericColumnProfile {
  name: string;
  kind: 'numeric';
  n: number;
  missing: number;
  min: number;
  max: number;
  mean: number;
  sd: number;
  zeros: number;
  q01: number;
  q05: number;
  q25: number;
  q50: number;
  q75: number;
  q95: number;
  q99: number;
  mad: number;
  outlierCount: number;
  histogram: Histogram;
}

export interface TextColumnProfile {
  name: string;
  kind: 'text';
  n: number;
  missing: number;
  distinctEstimate: number;
  topValues: Array<{ value: string; count: number }>;
  minLength: number;
  maxLength: number;
  avgLength: number;
}

export type ColumnProfile = NumericColumnProfile | TextColumnProfile;

export type IssueSeverity = 'high' | 'medium' | 'low';

export interface ProfileIssue {
  code: string;
  severity: IssueSeverity;
  column?: string;
  message: string;
}

export interface CorrelationInfo {
  names: string[];
  pearson: number[][];
  spearman: number[][];
  /** Number of (sampled) complete numeric rows used for Spearman. */
  sampleSize: number;
}

export interface DuplicateInfo {
  estimatedDistinct: number;
  duplicateRate: number;
}

export interface TableProfile {
  rows: number;
  score: number;
  columns: ColumnProfile[];
  duplicates: DuplicateInfo;
  correlations: CorrelationInfo | null;
  issues: ProfileIssue[];
}

export interface ProfilerOptions {
  /** Reservoir capacity for per-column and joint numeric sampling. */
  reservoir?: number;
  /** Histogram bin count. */
  bins?: number;
  /** Number of top text values tracked per text column. */
  topK?: number;
}

// --------------------------------------------------------------------------
// Value parsing
// --------------------------------------------------------------------------

export function isMissing(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' || t === 'NA' || t === 'NaN' || t.toLowerCase() === 'null';
  }
  return typeof v === 'number' && Number.isNaN(v);
}

/** Parse a cell as a finite number when possible; otherwise null. */
export function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Infer column kinds from a sample of parsed rows. */
export function inferColumnKinds(
  columns: string[],
  sample: Array<Array<string | number | null>>,
): ColumnSpec[] {
  return columns.map((name, j) => {
    let seen = 0;
    let numeric = 0;
    for (const row of sample) {
      const v = row[j];
      if (isMissing(v)) continue;
      seen += 1;
      if (asNumber(v) !== null) numeric += 1;
    }
    // No observed values: default to numeric (profiling an empty/short sample).
    return { name, kind: seen === 0 || numeric === seen ? 'numeric' : 'text' };
  });
}

// --------------------------------------------------------------------------
// Reservoir sampling
// --------------------------------------------------------------------------

class Reservoir {
  values: number[] = [];
  private seen = 0;

  constructor(private readonly capacity: number, private readonly rng: () => number) {}

  add(v: number): void {
    this.seen += 1;
    if (this.values.length < this.capacity) {
      this.values.push(v);
    } else {
      const j = Math.floor(this.rng() * this.seen);
      if (j < this.capacity) this.values[j] = v;
    }
  }
}

// --------------------------------------------------------------------------
// Profiler
// --------------------------------------------------------------------------

interface Internal {
  spec: ColumnSpec;
  globalIndex: number;
  n: number;
  missing: number;
}

interface NumericInternal extends Internal {
  kind: 'numeric';
  min: number;
  max: number;
  zeros: number;
  sample: Reservoir;
}

interface TextInternal extends Internal {
  kind: 'text';
  hll: HyperLogLog;
  top: SpaceSaving;
  minLen: number;
  maxLen: number;
  lenSum: number;
}

export class Profiler {
  private rows = 0;
  private numeric: NumericInternal[] = [];
  private text: TextInternal[] = [];
  private rowHll = new HyperLogLog();
  /** Joint reservoir of complete numeric rows (aligned vectors). */
  private jointSample: number[][] = [];
  private jointSeen = 0;
  // Incremental co-moments for Pearson across numeric column pairs.
  private means: number[] = [];
  private co: number[][] = [];
  private vars: number[] = [];
  private numericNames: string[] = [];
  private rng: () => number;
  private readonly reservoir: number;
  private readonly bins: number;

  constructor(columns: ColumnSpec[], opts: ProfilerOptions = {}) {
    this.reservoir = opts.reservoir ?? 20000;
    this.bins = opts.bins ?? 20;
    let state = 0x1234abcd >>> 0;
    this.rng = () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const topK = opts.topK ?? 10;
    columns.forEach((spec, globalIndex) => {
      const kind = spec.kind ?? 'numeric';
      if (kind === 'numeric') {
        this.numeric.push({
          spec,
          globalIndex,
          kind,
          n: 0,
          missing: 0,
          min: Infinity,
          max: -Infinity,
          zeros: 0,
          sample: new Reservoir(this.reservoir, this.rng),
        });
        this.numericNames.push(spec.name);
      } else {
        this.text.push({
          spec,
          globalIndex,
          kind,
          n: 0,
          missing: 0,
          hll: new HyperLogLog(),
          top: new SpaceSaving(topK),
          minLen: Infinity,
          maxLen: 0,
          lenSum: 0,
        });
      }
    });
    const nc = this.numeric.length;
    this.means = new Array(nc).fill(0);
    this.vars = new Array(nc).fill(0);
    this.co = Array.from({ length: nc }, () => new Array<number>(nc).fill(0));
  }

  addRow(cells: Array<string | number | null | undefined>): void {
    this.rows += 1;
    // Row fingerprint for duplicate estimation.
    this.rowHll.add(cells.map((c) => (c === null || c === undefined ? '' : String(c))).join('\x00'));

    // Numeric side: Welford per column + pairwise co-moments.
    const vec: number[] = new Array(this.numeric.length).fill(NaN);
    const residualOld: number[] = new Array(this.numeric.length).fill(NaN);
    let complete = this.numeric.length > 0;
    for (let c = 0; c < this.numeric.length; c += 1) {
      const col = this.numeric[c]!;
      const raw = cells[col.globalIndex];
      if (isMissing(raw)) {
        col.missing += 1;
        complete = false;
        continue;
      }
      const v = asNumber(raw);
      if (v === null) {
        // Non-numeric token inside a declared numeric column: count missing.
        col.missing += 1;
        complete = false;
        continue;
      }
      col.n += 1;
      col.min = Math.min(col.min, v);
      col.max = Math.max(col.max, v);
      if (v === 0) col.zeros += 1;
      col.sample.add(v);
      vec[c] = v;
      // Residual against the PRE-update mean (needed for pairs below).
      residualOld[c] = v - this.means[c]!;
      this.means[c]! += residualOld[c]! / col.n;
    }
    // Pairwise co-moments after all means have advanced:
    // C_dc += (x_d − mean_d_old) · (x_c − mean_c_new).
    for (let c = 0; c < this.numeric.length; c += 1) {
      if (!Number.isFinite(vec[c])) continue;
      const v = vec[c]!;
      this.vars[c]! += residualOld[c]! * (v - this.means[c]!);
      for (let d = 0; d < c; d += 1) {
        if (Number.isFinite(vec[d])) {
          const add = residualOld[d]! * (v - this.means[c]!);
          this.co[d]![c]! += add;
          this.co[c]![d] = this.co[d]![c]!;
        }
      }
    }
    if (complete) this.addJoint(vec);

    for (const col of this.text) {
      const raw = cells[col.globalIndex];
      if (isMissing(raw)) {
        col.missing += 1;
        continue;
      }
      const s = typeof raw === 'string' ? raw : String(raw);
      col.n += 1;
      col.hll.add(s);
      col.top.add(s);
      col.lenSum += s.length;
      col.minLen = Math.min(col.minLen, s.length);
      col.maxLen = Math.max(col.maxLen, s.length);
    }
  }

  addChunk(rows: Array<Array<string | number | null | undefined>>): void {
    for (const row of rows) this.addRow(row);
  }

  private addJoint(vec: number[]): void {
    this.jointSeen += 1;
    if (this.jointSample.length < this.reservoir) {
      this.jointSample.push(vec);
    } else {
      const j = Math.floor(this.rng() * this.jointSeen);
      if (j < this.reservoir) this.jointSample[j] = vec;
    }
  }

  finalize(): TableProfile {
    const columns: ColumnProfile[] = [];
    const issues: ProfileIssue[] = [];
    let score = 100;

    const deduct = (pts: number): void => {
      score -= pts;
    };
    const addIssue = (
      code: string,
      severity: IssueSeverity,
      pts: number,
      message: string,
      column?: string,
    ): void => {
      issues.push({ code, severity, column, message });
      deduct(pts);
    };

    const numericProfiles: NumericColumnProfile[] = [];

    for (const col of this.numeric) {
      const total = col.n + col.missing;
      const missRate = total > 0 ? col.missing / total : 0;
      const sd = col.n > 1 ? Math.sqrt(this.vars[this.numeric.indexOf(col)]! / (col.n - 1)) : 0;
      const sorted = col.sample.values.slice().sort((a, b) => a - b);
      const q = (p: number): number => quantileSorted(sorted, p);
      const median = q(0.5);
      const absDev = sorted.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
      const mad = quantileSorted(absDev, 0.5);
      let outliers = 0;
      if (mad > 0) {
        for (const v of col.sample.values) {
          if (Math.abs((0.6745 * (v - median)) / mad) > 3.5) outliers += 1;
        }
      }
      const histogram = buildHistogram(sorted, col.min, col.max, this.bins);
      const prof: NumericColumnProfile = {
        name: col.spec.name,
        kind: 'numeric',
        n: col.n,
        missing: col.missing,
        min: col.n > 0 ? col.min : NaN,
        max: col.n > 0 ? col.max : NaN,
        mean: col.n > 0 ? this.means[this.numeric.indexOf(col)] : NaN,
        sd,
        zeros: col.zeros,
        q01: q(0.01),
        q05: q(0.05),
        q25: q(0.25),
        q50: median,
        q75: q(0.75),
        q95: q(0.95),
        q99: q(0.99),
        mad,
        outlierCount: outliers,
        histogram,
      };
      numericProfiles.push(prof);
      columns.push(prof);

      if (missRate > 0.2) {
        addIssue('missing', 'high', 15, `Column "${col.spec.name}" has ${pct(missRate)}% missing values`, col.spec.name);
      } else if (missRate > 0.05) {
        addIssue('missing', 'medium', 8, `Column "${col.spec.name}" has ${pct(missRate)}% missing values`, col.spec.name);
      } else if (missRate > 0.01) {
        addIssue('missing', 'low', 3, `Column "${col.spec.name}" has ${pct(missRate)}% missing values`, col.spec.name);
      }
      if (col.n > 1 && (sd === 0 || col.min === col.max)) {
        addIssue('constant', 'medium', 8, `Column "${col.spec.name}" is constant (${col.min})`, col.spec.name);
      }
      const zeroRate = col.n > 0 ? col.zeros / col.n : 0;
      if (zeroRate > 0.5 && col.n > 10) {
        addIssue('sparse', 'low', 4, `Column "${col.spec.name}" is ${pct(zeroRate)}% zeros`, col.spec.name);
      }
      const outRate = col.sample.values.length > 0 ? outliers / col.sample.values.length : 0;
      if (outRate > 0.15) {
        addIssue('outliers', 'high', 10, `Column "${col.spec.name}" has ${pct(outRate)}% outliers (|mod z|>3.5)`, col.spec.name);
      } else if (outRate > 0.05) {
        addIssue('outliers', 'medium', 5, `Column "${col.spec.name}" has ${pct(outRate)}% outliers (|mod z|>3.5)`, col.spec.name);
      }
    }

    for (const col of this.text) {
      const total = col.n + col.missing;
      const missRate = total > 0 ? col.missing / total : 0;
      const distinct = col.hll.estimate();
      const prof: TextColumnProfile = {
        name: col.spec.name,
        kind: 'text',
        n: col.n,
        missing: col.missing,
        distinctEstimate: distinct,
        topValues: col.top.top(),
        minLength: col.n > 0 ? col.minLen : 0,
        maxLength: col.maxLen,
        avgLength: col.n > 0 ? col.lenSum / col.n : 0,
      };
      columns.push(prof);

      if (missRate > 0.2) {
        addIssue('missing', 'high', 15, `Column "${col.spec.name}" has ${pct(missRate)}% missing values`, col.spec.name);
      } else if (missRate > 0.05) {
        addIssue('missing', 'medium', 8, `Column "${col.spec.name}" has ${pct(missRate)}% missing values`, col.spec.name);
      } else if (missRate > 0.01) {
        addIssue('missing', 'low', 3, `Column "${col.spec.name}" has ${pct(missRate)}% missing values`, col.spec.name);
      }
      if (col.n > 1 && distinct <= 1.01) {
        addIssue('constant', 'medium', 8, `Column "${col.spec.name}" is constant ("${prof.topValues[0]?.value ?? ''}")`, col.spec.name);
      }
      if (col.n > 50 && distinct / col.n > 0.95) {
        addIssue('id_like', 'low', 6, `Column "${col.spec.name}" looks like an identifier (${pct(distinct / col.n)}% unique)`, col.spec.name);
      }
    }

    // Duplicate rows.
    const distinctRows = this.rowHll.estimate();
    const duplicateRate = this.rows > 0 ? Math.max(0, 1 - distinctRows / this.rows) : 0;
    if (duplicateRate > 0.2) {
      addIssue('duplicates', 'high', 12, `Table has about ${pct(duplicateRate)}% duplicated rows`);
    } else if (duplicateRate > 0.05) {
      addIssue('duplicates', 'medium', 6, `Table has about ${pct(duplicateRate)}% duplicated rows`);
    }

    // Correlations.
    const nc = this.numeric.length;
    const pearson: number[][] = Array.from({ length: nc }, () => new Array<number>(nc).fill(1));
    for (let i = 0; i < nc; i += 1) {
      for (let j = i + 1; j < nc; j += 1) {
        const denom = Math.sqrt(this.vars[i]! * this.vars[j]!);
        const r = denom > 0 ? clamp(this.co[i]![j]! / denom, -1, 1) : 0;
        pearson[i]![j] = r;
        pearson[j]![i] = r;
      }
    }
    let correlations: CorrelationInfo | null = null;
    if (nc >= 2) {
      correlations = {
        names: this.numericNames,
        pearson,
        spearman: this.spearmanMatrix(nc),
        sampleSize: this.jointSample.length,
      };
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    return {
      rows: this.rows,
      score,
      columns,
      duplicates: {
        estimatedDistinct: Math.round(distinctRows),
        duplicateRate,
      },
      correlations,
      issues,
    };
  }

  /** Spearman ρ from ranks of the joint reservoir (approximate for huge data). */
  private spearmanMatrix(nc: number): number[][] {
    const m = this.jointSample.length;
    const ranks: number[][] = Array.from({ length: nc }, () => new Array<number>(m));
    for (let c = 0; c < nc; c += 1) {
      const pairs = this.jointSample
        .map((row, i) => ({ v: row[c]!, i }))
        .filter((p) => Number.isFinite(p.v))
        .sort((a, b) => a.v - b.v);
      // Average ranks for ties.
      let k = 0;
      while (k < pairs.length) {
        let j = k;
        while (j + 1 < pairs.length && pairs[j + 1]!.v === pairs[k]!.v) j += 1;
        const avg = (k + j) / 2 + 1;
        for (let t = k; t <= j; t += 1) ranks[c]![pairs[t]!.i] = avg;
        k = j + 1;
      }
    }
    const mean = Array.from({ length: nc }, (_, c) => {
      let s = 0;
      for (let i = 0; i < m; i += 1) s += ranks[c]![i]!;
      return s / Math.max(m, 1);
    });
    const matrix: number[][] = Array.from({ length: nc }, () => new Array<number>(nc).fill(1));
    for (let a = 0; a < nc; a += 1) {
      for (let b = a + 1; b < nc; b += 1) {
        let cov = 0;
        let va = 0;
        let vb = 0;
        for (let i = 0; i < m; i += 1) {
          const da = ranks[a]![i]! - mean[a]!;
          const db = ranks[b]![i]! - mean[b]!;
          cov += da * db;
          va += da * da;
          vb += db * db;
        }
        const r = va > 0 && vb > 0 ? clamp(cov / Math.sqrt(va * vb), -1, 1) : 0;
        matrix[a]![b] = r;
        matrix[b]![a] = r;
      }
    }
    return matrix;
  }
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

function buildHistogram(sorted: number[], min: number, max: number, bins: number): Histogram {
  const edges: number[] = [];
  const counts = new Array<number>(bins).fill(0);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    for (let b = 0; b <= bins; b += 1) edges.push(Number.isFinite(min) ? min : 0);
    if (sorted.length > 0) counts[0] = sorted.length;
    return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0, bins, edges, counts };
  }
  const width = (max - min) / bins;
  for (let b = 0; b <= bins; b += 1) edges.push(min + b * width);
  for (const v of sorted) {
    let idx = Math.floor((v - min) / width);
    if (idx >= bins) idx = bins - 1;
    if (idx < 0) idx = 0;
    counts[idx]! += 1;
  }
  return { min, max, bins, edges, counts };
}

function pct(x: number): string {
  return (x * 100).toFixed(1);
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// --------------------------------------------------------------------------
// Batch convenience
// --------------------------------------------------------------------------

/**
 * Profile a fully materialised table. When column kinds are omitted they are
 * inferred from up to the first 1 000 rows.
 */
export function profileRows(
  rows: Array<Array<string | number | null | undefined>>,
  columns: ColumnSpec[] | string[],
  opts: ProfilerOptions = {},
): TableProfile {
  let specs: ColumnSpec[];
  if (columns.length > 0 && typeof columns[0] === 'string') {
    const names = columns as string[];
    specs = inferColumnKinds(names, rows.slice(0, 1000));
  } else {
    specs = columns as ColumnSpec[];
  }
  const profiler = new Profiler(specs, opts);
  profiler.addChunk(rows);
  return profiler.finalize();
}
