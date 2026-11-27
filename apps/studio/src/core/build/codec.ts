// ==========================================================================
// Ergalics Studio — build cache codec (pure TS)
//
// Cached outputs must survive an IndexedDB round-trip without losing a single
// bit: a `Float32Array` that comes back as a plain array, or an `i32` column
// that comes back as `f64`, would silently change downstream numerics. This
// module therefore encodes `DataValue` into a tagged, JSON-safe structure with
// explicit little-endian byte layouts (never `structuredClone`-style native
// layout), and decodes it back into real typed arrays / `MemoryDataTable`s.
//
// `RenderedView` is deliberately NOT encodable: it is a live handle into a
// plugin runtime, not data. `encodeDataValue` returns `null` for it and the
// engine treats such outputs as run-local (never cached).
// ==========================================================================

import {
  createDataTable,
  isDataset,
  isDataTable,
  isRenderedView,
  isScalar,
  type ColumnData,
  type ColumnSpec,
  type ColumnType,
  type DataValue,
  type Dataset,
  type DatasetAxis,
} from '@ergalics/plugin-sdk/types';

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const B64_LOOKUP: Record<string, number> = (() => {
  const table: Record<string, number> = {};
  for (let i = 0; i < B64_ALPHABET.length; i += 1) table[B64_ALPHABET[i]!] = i;
  return table;
})();

/** Pure-TS base64 (no `btoa`/`Buffer`: identical in browser, worker and Node). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64_ALPHABET[(n >>> 18) & 63]!;
    out += B64_ALPHABET[(n >>> 12) & 63]!;
    out += B64_ALPHABET[(n >>> 6) & 63]!;
    out += B64_ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = (bytes[i] ?? 0) << 16;
    out += B64_ALPHABET[(n >>> 18) & 63]!;
    out += B64_ALPHABET[(n >>> 12) & 63]!;
    out += '==';
  } else if (rest === 2) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    out += B64_ALPHABET[(n >>> 18) & 63]!;
    out += B64_ALPHABET[(n >>> 12) & 63]!;
    out += B64_ALPHABET[(n >>> 6) & 63]!;
    out += '=';
  }
  return out;
}

/** Pure-TS base64 decode. Throws on malformed input (corrupt cache entries). */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const v = B64_LOOKUP[clean[i]!];
    if (v === undefined) throw new Error('invalid base64 payload in build cache');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o] = (buffer >>> bits) & 0xff;
      o += 1;
    }
  }
  return out.subarray(0, o);
}

// ---- encoded shapes -------------------------------------------------------

export interface EncodedNumericColumn {
  t: 'f64' | 'f32' | 'i32' | 'u32';
  /** Element count (the byte length is implied by the type). */
  n: number;
  /** Little-endian element bytes, base64-encoded. */
  b64: string;
}

export type EncodedColumnData =
  | EncodedNumericColumn
  | { t: 'string'; v: string[] }
  | { t: 'boolean'; v: boolean[] };

export interface EncodedColumn {
  name: string;
  type: ColumnType;
  unit?: string;
  range?: { min: number; max: number };
  data: EncodedColumnData;
}

export interface EncodedTable {
  kind: 'table';
  id: string;
  length: number;
  tags: string[];
  provenance: string;
  columns: EncodedColumn[];
}

export interface EncodedDataset {
  kind: 'dataset';
  id: string;
  name: string;
  dims: number[];
  unit?: string;
  provenance: string;
  data: EncodedColumnData;
  axes: Array<{ name: string; unit?: string; values?: unknown }>;
  attrs: unknown;
}

export interface EncodedScalar {
  kind: 'scalar';
  value: number | string | boolean;
}

export type EncodedValue = EncodedTable | EncodedDataset | EncodedScalar;

// ---- generic value encoding (for `attrs` and axis coordinates) ------------

/** JSON-safe encoding of arbitrary metadata, preserving typed arrays/dates. */
export function encodeUnknown(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      // Keep specials distinguishable; JSON would turn them into null.
      if (Number.isNaN(value)) return { $num: 'NaN' };
      if (value === Number.POSITIVE_INFINITY) return { $num: 'Infinity' };
      if (value === Number.NEGATIVE_INFINITY) return { $num: '-Infinity' };
      if (Object.is(value, -0)) return { $num: '-0' };
      return value;
    case 'bigint':
      return { $bigint: value.toString(10) };
    case 'undefined':
    case 'function':
    case 'symbol':
      return null;
    default:
      break;
  }
  if (value instanceof Date) return { $date: value.getTime() };
  if (ArrayBuffer.isView(value)) {
    const encoded = encodeColumnData(value as ColumnData);
    return { $typed: encoded };
  }
  if (value instanceof ArrayBuffer) {
    return { $bytes: bytesToBase64(new Uint8Array(value)) };
  }
  if (Array.isArray(value)) return value.map(encodeUnknown);
  if (value instanceof Map) {
    return { $map: [...value.entries()].map(([k, v]) => [encodeUnknown(k), encodeUnknown(v)]) };
  }
  if (value instanceof Set) {
    return { $set: [...value].map(encodeUnknown) };
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) out[key] = encodeUnknown(obj[key]);
  return out;
}

/** Inverse of `encodeUnknown`. */
export function decodeUnknown(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decodeUnknown);
  const obj = value as Record<string, unknown>;
  if (typeof obj.$num === 'string') {
    switch (obj.$num) {
      case 'NaN':
        return Number.NaN;
      case 'Infinity':
        return Number.POSITIVE_INFINITY;
      case '-Infinity':
        return Number.NEGATIVE_INFINITY;
      case '-0':
        return -0;
      default:
        return Number.NaN;
    }
  }
  if (typeof obj.$bigint === 'string') return BigInt(obj.$bigint);
  if (typeof obj.$date === 'number') return new Date(obj.$date);
  if (typeof obj.$bytes === 'string') {
    const bytes = base64ToBytes(obj.$bytes);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }
  if (obj.$typed !== undefined) return decodeColumnData(obj.$typed as EncodedColumnData);
  if (Array.isArray(obj.$map)) {
    return new Map(
      (obj.$map as Array<[unknown, unknown]>).map(([k, v]) => [decodeUnknown(k), decodeUnknown(v)]),
    );
  }
  if (Array.isArray(obj.$set)) return new Set((obj.$set as unknown[]).map(decodeUnknown));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) out[key] = decodeUnknown(obj[key]);
  return out;
}

// ---- columns --------------------------------------------------------------

/** Deterministic little-endian bytes, independent of host memory layout. */
export function encodeColumnData(data: ColumnData): EncodedColumnData {
  if (data instanceof Float64Array) return encodeNumeric(data, 'f64');
  if (data instanceof Float32Array) return encodeNumeric(data, 'f32');
  if (data instanceof Int32Array) return encodeNumeric(data, 'i32');
  if (data instanceof Uint32Array) return encodeNumeric(data, 'u32');
  if (Array.isArray(data)) {
    if (data.length > 0 && typeof data[0] === 'boolean') {
      return { t: 'boolean', v: data as boolean[] };
    }
    return { t: 'string', v: data as string[] };
  }
  throw new Error('unsupported column data in build cache');
}

type NumericType = EncodedNumericColumn['t'];

function encodeNumeric(
  data: Float64Array | Float32Array | Int32Array | Uint32Array,
  t: NumericType,
): EncodedNumericColumn {
  const width = t === 'f64' ? 8 : 4;
  const bytes = new Uint8Array(data.length * width);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < data.length; i += 1) {
    const v = data[i] ?? 0;
    const off = i * width;
    switch (t) {
      case 'f64':
        view.setFloat64(off, v, true);
        break;
      case 'f32':
        view.setFloat32(off, v, true);
        break;
      case 'i32':
        view.setInt32(off, v, true);
        break;
      case 'u32':
        view.setUint32(off, v, true);
        break;
    }
  }
  return { t, n: data.length, b64: bytesToBase64(bytes) };
}

export function decodeColumnData(encoded: EncodedColumnData): ColumnData {
  switch (encoded.t) {
    case 'f64':
    case 'f32':
    case 'i32':
    case 'u32':
      return decodeNumeric(encoded);
    case 'boolean':
      return [...encoded.v];
    case 'string':
      return [...encoded.v];
    default:
      throw new Error('invalid cached column encoding');
  }
}

function decodeNumeric(encoded: EncodedNumericColumn): ColumnData {
  const bytes = base64ToBytes(encoded.b64);
  const width = encoded.t === 'f64' ? 8 : 4;
  if (bytes.length !== encoded.n * width) {
    throw new Error('cached column byte length does not match its element count');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out =
    encoded.t === 'f64'
      ? new Float64Array(encoded.n)
      : encoded.t === 'f32'
        ? new Float32Array(encoded.n)
        : encoded.t === 'i32'
          ? new Int32Array(encoded.n)
          : new Uint32Array(encoded.n);
  for (let i = 0; i < encoded.n; i += 1) {
    const off = i * width;
    switch (encoded.t) {
      case 'f64':
        out[i] = view.getFloat64(off, true);
        break;
      case 'f32':
        out[i] = view.getFloat32(off, true);
        break;
      case 'i32':
        out[i] = view.getInt32(off, true);
        break;
      case 'u32':
        out[i] = view.getUint32(off, true);
        break;
    }
  }
  return out as ColumnData;
}

// ---- full DataValue -------------------------------------------------------

/**
 * Encode a flow value for persistence. Returns `null` when the value is not
 * cacheable (rendered views, live handles). Never throws for a valid
 * `DataValue`; throws only for structurally impossible inputs.
 */
export function encodeDataValue(value: DataValue): EncodedValue | null {
  if (isDataTable(value)) return encodeTable(value);
  if (isDataset(value)) return encodeDataset(value);
  if (isScalar(value)) {
    const v = value.value;
    const scalar =
      typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string' ? v : String(v);
    return { kind: 'scalar', value: scalar };
  }
  if (isRenderedView(value)) return null;
  return null;
}

function encodeTable(table: {
  id: string;
  length: number;
  tags: string[];
  provenance: string;
  columns: Array<{ name: string; type: ColumnType; unit?: string; range?: { min: number; max: number } }>;
  getColumn(name: string): ColumnData | undefined;
}): EncodedTable {
  const columns: EncodedColumn[] = table.columns.map((col) => {
    const data = table.getColumn(col.name);
    if (data === undefined) throw new Error(`cached table is missing column "${col.name}"`);
    return {
      name: col.name,
      type: col.type,
      ...(col.unit !== undefined ? { unit: col.unit } : {}),
      ...(col.range !== undefined ? { range: { min: col.range.min, max: col.range.max } } : {}),
      data: encodeColumnData(data),
    };
  });
  return {
    kind: 'table',
    id: table.id,
    length: table.length,
    tags: [...table.tags],
    provenance: table.provenance,
    columns,
  };
}

function encodeDataset(ds: Dataset): EncodedDataset {
  return {
    kind: 'dataset',
    id: ds.id,
    name: ds.name,
    dims: [...ds.dims],
    ...(ds.unit !== undefined ? { unit: ds.unit } : {}),
    provenance: ds.provenance,
    data: encodeColumnData(ds.data),
    axes: ds.axes.map((axis) => ({
      name: axis.name,
      ...(axis.unit !== undefined ? { unit: axis.unit } : {}),
      ...(axis.values !== undefined ? { values: encodeUnknown(axis.values) } : {}),
    })),
    attrs: encodeUnknown(ds.attrs),
  };
}

/** Decode a persisted value. Throws on malformed input. */
export function decodeDataValue(encoded: EncodedValue): DataValue {
  switch (encoded.kind) {
    case 'scalar':
      return { kind: 'scalar', value: encoded.value };
    case 'table': {
      const specs: ColumnSpec[] = encoded.columns.map((col) => ({
        name: col.name,
        type: col.type,
        data: decodeColumnData(col.data),
        ...(col.unit !== undefined ? { unit: col.unit } : {}),
        ...(col.range !== undefined ? { range: col.range } : {}),
      }));
      const table = createDataTable(encoded.id, specs, {
        tags: [...encoded.tags],
        provenance: encoded.provenance,
      });
      return table;
    }
    case 'dataset': {
      const axes: DatasetAxis[] = encoded.axes.map((axis) => ({
        name: axis.name,
        ...(axis.unit !== undefined ? { unit: axis.unit } : {}),
        ...(axis.values !== undefined ? { values: decodeUnknown(axis.values) as DatasetAxis['values'] } : {}),
      }));
      const ds: Dataset = {
        kind: 'dataset',
        id: encoded.id,
        name: encoded.name,
        dims: [...encoded.dims],
        data: decodeColumnData(encoded.data),
        axes,
        ...(encoded.unit !== undefined ? { unit: encoded.unit } : {}),
        attrs: (decodeUnknown(encoded.attrs) as Record<string, unknown>) ?? {},
        provenance: encoded.provenance,
      };
      return ds;
    }
    default:
      throw new Error('invalid cached value encoding');
  }
}

/** Approximate serialized size in bytes, used for cache quota accounting. */
export function estimateEncodedSize(encoded: EncodedValue | unknown): number {
  if (encoded === null || encoded === undefined) return 0;
  if (typeof encoded === 'string') return encoded.length * 2;
  if (typeof encoded === 'number' || typeof encoded === 'boolean' || typeof encoded === 'bigint') return 8;
  if (Array.isArray(encoded)) {
    let total = 0;
    for (const item of encoded) total += estimateEncodedSize(item);
    return total;
  }
  if (typeof encoded === 'object') {
    const obj = encoded as Record<string, unknown>;
    let total = 0;
    for (const key of Object.keys(obj)) total += key.length * 2 + estimateEncodedSize(obj[key]);
    return total;
  }
  return 0;
}
