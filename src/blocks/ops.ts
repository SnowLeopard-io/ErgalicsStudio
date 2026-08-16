// ==========================================================================
// Ergalics Studio — DataTable operations (block system)
//
// Pure, immutable helpers shared by block executors: every operation takes a
// table and returns a new one, so executors stay side-effect free and
// testable. Numeric math always runs on Float64Array.
// ==========================================================================

import { createDataTable, type MemoryDataTable } from '@/types/datatable';
import type { ColumnData, ColumnSpec, ColumnType, DataTable } from '@/types/datatable';

export type SortDirection = 'asc' | 'desc';
export type NormalizeMode = 'minmax' | 'zscore';

function newId(): string {
  return crypto.randomUUID();
}

function rebuild(table: DataTable, specs: ColumnSpec[], op: string): MemoryDataTable {
  return createDataTable(newId(), specs, {
    tags: [...table.tags],
    provenance: table.provenance ? `${table.provenance} > ${op}` : op,
  });
}

export function isNumericType(type: ColumnType): boolean {
  return type === 'f32' || type === 'f64' || type === 'i32' || type === 'u32';
}

/** Convert a numeric column to Float64Array (throws for non-numeric). */
export function asFloat64(table: DataTable, name: string): Float64Array {
  const col = table.getColumn(name);
  if (col === undefined) {
    throw new Error(`column "${name}" does not exist`);
  }
  if (col instanceof Float64Array) return col;
  if (col instanceof Float32Array || col instanceof Int32Array || col instanceof Uint32Array) {
    return Float64Array.from(col);
  }
  throw new Error(`column "${name}" is not numeric`);
}

/**
 * Resolve a numeric column, with a clear message for blocks whose column
 * param is still empty. Without this, unconfigured blocks throw raw
 * `column "" does not exist` on their very first run.
 */
export function requireColumn(table: DataTable, name: string): Float64Array {
  if (!name) {
    throw new Error('this block is not configured — pick a column first');
  }
  return asFloat64(table, name);
}

/** Reindex a column by an array of source row indices. */
function subset(col: ColumnData, keep: number[]): ColumnData {
  if (col instanceof Float64Array) return Float64Array.from(keep.map((i) => col[i]!));
  if (col instanceof Float32Array) return Float32Array.from(keep.map((i) => col[i]!));
  if (col instanceof Int32Array) return Int32Array.from(keep.map((i) => col[i]!));
  if (col instanceof Uint32Array) return Uint32Array.from(keep.map((i) => col[i]!));
  // string[] | boolean[] — indexing a union array yields `string | boolean`,
  // so we re-assert through unknown (the runtime type is preserved).
  return keep.map((i) => col[i]!) as unknown as ColumnData;
}

function specsOf(table: DataTable): ColumnSpec[] {
  return table.columns.map((meta) => ({
    name: meta.name,
    type: meta.type,
    data: table.getColumn(meta.name)!,
    unit: meta.unit,
    range: meta.range,
  }));
}

// ---- column transforms ----

export function selectColumns(table: DataTable, names: string[]): DataTable {
  const specs: ColumnSpec[] = [];
  for (const name of names) {
    const data = table.getColumn(name);
    if (data === undefined) throw new Error(`column "${name}" does not exist`);
    const meta = table.columns.find((c) => c.name === name)!;
    specs.push({ name, type: meta.type, data, unit: meta.unit, range: meta.range });
  }
  return rebuild(table, specs, `select:${names.join(',')}`);
}

export function renameColumn(table: DataTable, from: string, to: string): DataTable {
  if (table.getColumn(from) === undefined) throw new Error(`column "${from}" does not exist`);
  if (table.getColumn(to) !== undefined) throw new Error(`column "${to}" already exists`);
  const specs = table.columns.map((meta) => ({
    name: meta.name === from ? to : meta.name,
    type: meta.type,
    data: table.getColumn(meta.name)!,
    unit: meta.unit,
    range: meta.range,
  }));
  return rebuild(table, specs, `rename:${from}->${to}`);
}

export function addColumn(
  table: DataTable,
  name: string,
  type: ColumnType,
  data: ColumnData,
): DataTable {
  if (data.length !== table.length) {
    throw new Error(`column length ${data.length} != table length ${table.length}`);
  }
  if (table.getColumn(name) !== undefined) throw new Error(`column "${name}" already exists`);
  const specs = specsOf(table);
  specs.push({ name, type, data });
  return rebuild(table, specs, `add:${name}`);
}

// ---- row transforms ----

export function filterRows(
  table: DataTable,
  predicate: (row: Record<string, unknown>, index: number) => boolean,
): DataTable {
  const keep: number[] = [];
  for (let i = 0; i < table.length; i += 1) {
    if (predicate(table.getRow(i), i)) keep.push(i);
  }
  const specs = table.columns.map((meta) => ({
    name: meta.name,
    type: meta.type,
    data: subset(table.getColumn(meta.name)!, keep),
    unit: meta.unit,
    range: meta.range,
  }));
  return rebuild(table, specs, `filter:${keep.length}/${table.length}`);
}

export function sortRows(table: DataTable, column: string, direction: SortDirection): DataTable {
  const values = asFloat64(table, column);
  const indices = Array.from({ length: table.length }, (_, i) => i);
  indices.sort((a, b) => {
    const va = values[a]!;
    const vb = values[b]!;
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return direction === 'asc' ? cmp : -cmp;
  });
  const specs = table.columns.map((meta) => ({
    name: meta.name,
    type: meta.type,
    data: subset(table.getColumn(meta.name)!, indices),
    unit: meta.unit,
    range: meta.range,
  }));
  return rebuild(table, specs, `sort:${column}:${direction}`);
}

/** Serialize numeric columns to delimiter-separated text (one row per line). */
export function toDelimited(table: DataTable, columns: string[], delimiter = ' '): string {
  const cols = columns.map((c) => asFloat64(table, c));
  const lines: string[] = [];
  for (let i = 0; i < table.length; i += 1) {
    lines.push(cols.map((c) => String(c[i]!)).join(delimiter));
  }
  return lines.join('\n');
}

// ---- numeric kernels ----

export function normalize(values: Float64Array, mode: NormalizeMode): Float64Array {
  const out = new Float64Array(values.length);
  if (values.length === 0) return out;

  if (mode === 'minmax') {
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    // All-NaN input leaves min=Infinity/max=-Infinity and would produce NaN
    // output; treat it as an empty signal instead of propagating NaN.
    if (!Number.isFinite(min) || !Number.isFinite(max)) return out;
    const range = max - min;
    for (let i = 0; i < values.length; i += 1) {
      out[i] = range === 0 ? 0 : (values[i]! - min) / range;
    }
    return out;
  }

  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let variance = 0;
  for (const v of values) variance += (v - mean) * (v - mean);
  const std = Math.sqrt(variance / values.length);
  for (let i = 0; i < values.length; i += 1) {
    out[i] = std === 0 ? 0 : (values[i]! - mean) / std;
  }
  return out;
}

/** Element-wise binary op over a column and either a scalar or another column. */
export function binaryColumn(
  a: Float64Array,
  b: Float64Array | number,
  op: (x: number, y: number) => number,
): Float64Array {
  const out = new Float64Array(a.length);
  if (typeof b === 'number') {
    for (let i = 0; i < a.length; i += 1) out[i] = op(a[i]!, b);
  } else {
    if (a.length !== b.length) throw new Error('column length mismatch');
    for (let i = 0; i < a.length; i += 1) out[i] = op(a[i]!, b[i]!);
  }
  return out;
}

export function unaryColumn(a: Float64Array, op: (v: number) => number): Float64Array {
  const out = new Float64Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = op(a[i]!);
  return out;
}

// ---- summary / histogram ----

export interface ColumnSummary {
  mean: number;
  std: number;
  min: number;
  max: number;
  median: number;
}

export function summarize(values: Float64Array): ColumnSummary {
  if (values.length === 0) {
    return { mean: 0, std: 0, min: 0, max: 0, median: 0 };
  }
  const sorted = Float64Array.from(values).sort();
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / values.length;
  let variance = 0;
  for (const v of values) variance += (v - mean) * (v - mean);
  const std = Math.sqrt(variance / values.length);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return { mean, std, min, max, median };
}

export interface Histogram {
  centers: Float64Array;
  counts: Float64Array;
}

export function histogram(values: Float64Array, bins: number): Histogram {
  if (bins < 1) throw new Error('bins must be >= 1');
  const counts = new Float64Array(bins);
  const centers = new Float64Array(bins);
  // An empty column must produce zeroed bins, not a table of NaNs: with no
  // values min=Infinity/max=-Infinity, range=-Infinity and every center is NaN.
  if (values.length === 0) return { centers, counts };
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const step = range / bins;
  for (let b = 0; b < bins; b += 1) {
    centers[b] = min + step * (b + 0.5);
  }
  for (const v of values) {
    const idx = Math.min(bins - 1, Math.floor((v - min) / step));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  return { centers, counts };
}
