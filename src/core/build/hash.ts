// ==========================================================================
// Ergalics Studio — content-addressed hashing for the science build system
//
// Cache keys must be *content* fingerprints, not identities: the same table
// re-imported under another name, or a node moved on the canvas, must map to
// the same cache entry. This module provides:
//
//   • ContentHasher — a streaming two-lane FNV-1a mixer producing a 64-bit
//     hex digest. Every numeric value is fed through an explicit
//     little-endian DataView, so a digest is identical on every platform
//     (typed-array memory order is NOT portable across archives).
//   • canonicalize — a deterministic text form for JSON-ish values
//     (sorted keys, special numbers, Map/Set entry-order insensitivity).
//   • hashDataValue — full-content hashing for DataTable / Dataset /
//     Scalar / RenderedView, including whole typed arrays (streamed, never
//     converted to a giant string).
//
// Collision budget: 64 bits is sufficient for a workbench-scale cache
// (birthday bound ~2^32 entries); we still include a schema version in every
// cache key so algorithm changes invalidate wholesale.
// ==========================================================================

import type { ColumnData, DataValue, DataTable, Dataset } from '@/types/datatable';
import { isDataset, isDataTable, isRenderedView, isScalar } from '@/types/datatable';

const FNV_PRIME = 0x01000193;
/** Two independent lanes: a collision in one 32-bit lane is still caught by
 *  the other, giving an effective 64-bit space from cheap 32-bit math. */
const LANE_A_OFFSET = 0x811c9dc5;
const LANE_B_OFFSET = 0x9e3779b9;

/** Streaming digest with a stable, platform-independent encoding. */
export class ContentHasher {
  private a = LANE_A_OFFSET;
  private b = LANE_B_OFFSET;
  private readonly numBuf = new Uint8Array(8);
  private readonly numView = new DataView(this.numBuf.buffer);

  updateString(text: string): this {
    let a = this.a;
    let b = this.b;
    for (let i = 0; i < text.length; i += 1) {
      const code = text.charCodeAt(i);
      a ^= code & 0xff;
      a = Math.imul(a, FNV_PRIME);
      a ^= code >>> 8;
      a = Math.imul(a, FNV_PRIME);
      b ^= code & 0xff;
      b = Math.imul(b, 0x85ebca6b);
      b ^= code >>> 8;
      b = Math.imul(b, 0xc2b2ae35);
      b ^= b >>> 13;
    }
    this.a = a >>> 0;
    this.b = b >>> 0;
    return this;
  }

  updateBytes(bytes: Uint8Array): this {
    let a = this.a;
    let b = this.b;
    for (let i = 0; i < bytes.length; i += 1) {
      const byte = bytes[i] ?? 0;
      a ^= byte;
      a = Math.imul(a, FNV_PRIME);
      b ^= byte;
      b = Math.imul(b, 0x85ebca6b);
      b ^= b >>> 13;
      b = Math.imul(b, 0xc2b2ae35);
    }
    this.a = a >>> 0;
    this.b = b >>> 0;
    return this;
  }

  /** Feed one number in a canonical little-endian IEEE-754 encoding. */
  updateNumber(value: number): this {
    // Normalize the two distinguishable zeroes and keep specials stable.
    const v = Object.is(value, -0) ? 0 : value;
    this.numView.setFloat64(0, v, true);
    return this.updateBytes(this.numBuf);
  }

  updateBigInt(value: bigint): this {
    return this.updateString(value.toString(10));
  }

  /** Hash any canonicalizable value (see `canonicalize`). */
  updateValue(value: unknown): this {
    switch (typeof value) {
      case 'string':
        return this.updateString(`s:${value.length}:`).updateString(value);
      case 'number':
        return this.updateString('n:').updateNumber(value);
      case 'bigint':
        return this.updateString('b:').updateBigInt(value);
      case 'boolean':
        return this.updateString(value ? 'T' : 'F');
      case 'undefined':
        return this.updateString('U');
      case 'function':
      case 'symbol':
        return this.updateString('X');
      default:
        return this.updateValueObject(value);
    }
  }

  private updateValueObject(value: unknown): this {
    if (value === null) return this.updateString('N');
    if (value instanceof Date) {
      return this.updateString('D:').updateNumber(value.getTime());
    }
    if (ArrayBuffer.isView(value)) return this.updateArrayBufferView(value);
    if (value instanceof ArrayBuffer) {
      return this.updateString('A:').updateBytes(new Uint8Array(value));
    }
    if (Array.isArray(value)) {
      this.updateString(`[${value.length}:`);
      for (const item of value) this.updateValue(item);
      return this.updateString(']');
    }
    if (value instanceof Map) {
      // Map/Set iteration order is insertion order; hash entries in a
      // canonical (sorted-digest) order so equivalent maps collide.
      const entries = [...value.entries()].map(([k, v]) => {
        const h = new ContentHasher().updateValue(k).digest();
        return { h, k, v };
      });
      entries.sort((x, y) => (x.h < y.h ? -1 : x.h > y.h ? 1 : 0));
      this.updateString(`M${entries.length}:`);
      for (const e of entries) this.updateValue(e.k).updateValue(e.v);
      return this.updateString('}');
    }
    if (value instanceof Set) {
      const hashes = [...value].map((v) => new ContentHasher().updateValue(v).digest());
      hashes.sort();
      this.updateString(`S${hashes.length}:`);
      for (const h of hashes) this.updateString(h);
      return this.updateString('}');
    }
    // Plain object: sorted keys make the digest key-order independent.
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    this.updateString(`{${keys.length}:`);
    for (const key of keys) {
      this.updateString(key).updateString(':').updateValue(obj[key]);
    }
    return this.updateString('}');
  }

  private updateArrayBufferView(view: ArrayBufferView): this {
    if (view instanceof Float64Array) {
      this.updateString(`f64:${view.length}:`);
      for (let i = 0; i < view.length; i += 1) this.updateNumber(view[i] ?? 0);
      return this.updateString(';');
    }
    if (view instanceof Float32Array) {
      this.updateString(`f32:${view.length}:`);
      for (let i = 0; i < view.length; i += 1) this.updateNumber(view[i] ?? 0);
      return this.updateString(';');
    }
    if (view instanceof Int32Array || view instanceof Uint32Array || view instanceof Uint16Array ||
        view instanceof Int16Array || view instanceof Uint8Array || view instanceof Int8Array) {
      // Explicit tags, never `constructor.name`: minifiers and future runtime
      // changes must not be able to alter a cache key.
      const tag = view instanceof Int32Array ? 'i32'
        : view instanceof Uint32Array ? 'u32'
          : view instanceof Uint16Array ? 'u16'
            : view instanceof Int16Array ? 'i16'
              : view instanceof Uint8Array ? 'u8'
                : 'i8';
      this.updateString(`${tag}:${view.length}:`);
      for (let i = 0; i < view.length; i += 1) this.updateNumber(view[i] ?? 0);
      return this.updateString(';');
    }
    // BigInt64/BigUint64 are not used by DataValue; hash their bytes.
    return this.updateString('v:').updateBytes(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
  }

  /** 16 hex chars (two 32-bit lanes, avalanche-finished). */
  digest(): string {
    return finish(this.a) + finish(this.b);
  }
}

/** Murmur-style avalanche so small input changes flip many output bits. */
function finish(x: number): string {
  let h = x >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Deterministic canonical text for JSON-ish values (debugging + tests). */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'undefined':
      return 'undefined';
    case 'string':
      return JSON.stringify(value);
    case 'number':
      // JSON.stringify turns NaN/Infinity into "null" — a cache-key footgun.
      if (Number.isNaN(value)) return 'NaN';
      if (value === Number.POSITIVE_INFINITY) return 'Infinity';
      if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
      if (Object.is(value, -0)) return '-0';
      return String(value);
    case 'bigint':
      return `${value.toString(10)}n`;
    case 'boolean':
      return value ? 'true' : 'false';
    case 'function':
    case 'symbol':
      return `[${typeof value}]`;
    default:
      break;
  }
  if (value instanceof Date) return `Date(${value.toISOString()})`;
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value instanceof Map) {
    const entries = [...value.entries()]
      .map(([k, v]) => `${canonicalize(k)}=>${canonicalize(v)}`)
      .sort();
    return `Map{${entries.join(',')}}`;
  }
  if (value instanceof Set) {
    return `Set{${[...value].map(canonicalize).sort().join(',')}}`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
}

/** Hash any canonicalizable value. */
export function hashValue(value: unknown): string {
  return new ContentHasher().updateValue(value).digest();
}

/** Hash a column's full content without materializing a string copy. */
export function hashColumn(data: ColumnData): ContentHasher {
  return new ContentHasher().updateValue(data);
}

/**
 * Full-content hash of a DataTable. Column names, units and types are part of
 * the fingerprint (a unit change is a real change: it alters downstream
 * physics), while the table's `id` / tags / provenance are NOT (they are
 * identity metadata and must not break cache reuse).
 */
export function hashTable(table: DataTable): string {
  const h = new ContentHasher().updateString(`table:${table.length}:`);
  for (const col of table.columns) {
    h.updateString(col.name).updateString(col.type).updateString(col.unit ?? '');
    const data = table.getColumn(col.name);
    h.updateString(';');
    if (data instanceof Float64Array || data instanceof Float32Array ||
        data instanceof Int32Array || data instanceof Uint32Array) {
      h.updateValue(data);
    } else if (Array.isArray(data)) {
      h.updateString(`arr:${data.length}:`);
      for (const v of data) h.updateValue(v);
    }
    h.updateString(';');
  }
  return h.digest();
}

/** Full-content hash of an N-D dataset (shape + axes + payload). */
export function hashDataset(ds: Dataset): string {
  const h = new ContentHasher()
    .updateString(`dataset:${ds.name}:`)
    .updateValue(ds.dims)
    .updateString(ds.unit ?? '');
  for (const axis of ds.axes) {
    h.updateString(axis.name).updateString(axis.unit ?? '');
    if (axis.values !== undefined) h.updateValue(axis.values);
    h.updateString(';');
  }
  h.updateValue(ds.data);
  // attrs are format metadata (FITS cards etc.) and DO affect semantics.
  h.updateValue(ds.attrs);
  return h.digest();
}

/** Full-content hash of any block value flowing between ports. */
export function hashDataValue(value: DataValue | undefined | null): string {
  if (value === undefined || value === null) return 'none';
  if (isDataTable(value)) return hashTable(value);
  if (isDataset(value)) return hashDataset(value);
  if (isScalar(value)) return new ContentHasher().updateString('scalar:').updateValue(value.value).digest();
  if (isRenderedView(value)) {
    // A rendered view is a handle into the live plugin runtime, not data.
    return new ContentHasher().updateString(`view:${value.viewType}:${value.id}`).digest();
  }
  return hashValue(value);
}
