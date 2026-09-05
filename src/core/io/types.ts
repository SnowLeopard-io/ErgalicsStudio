// ==========================================================================
// Ergalics Studio — scientific data I/O shared types & helpers
//
// A `RawVariable` is the library-agnostic intermediate every loader produces:
// a numeric (float64) buffer, its logical `shape`, per-axis labels, and any
// attributes. `toDataset` turns it into the project's `Dataset` value type so
// it can live alongside `DataTable`s; `dataTableToCSV` serializes a table back
// to text so a parsed scientific file can be injected as a project data file
// and consumed by the existing Standard/flow/block pipelines unchanged.
// ==========================================================================

import type { DataTable, Dataset } from '@/types/datatable';

/** Numeric typed arrays a scientific library may hand back. */
export type NumericArray =
  | Float64Array
  | Float32Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | BigInt64Array
  | BigUint64Array;

/** Library-agnostic intermediate every loader emits. */
export interface RawVariable {
  /** Unique path/name within the source file (e.g. HDF5 path, FITS HDU). */
  name: string;
  /** Numeric data, always float64-normalized for uniform downstream handling. */
  data: Float64Array;
  /** Logical shape, row-major (e.g. `[rows]`, `[height, width]`, `[bands, h, w]`). */
  shape: number[];
  /** Optional per-dimension label (axis name / coordinate name). */
  labels?: (string | null)[];
  /** Arbitrary metadata carried over from the source (units, columns, etc.). */
  attrs?: Record<string, unknown>;
  /** SI-style unit string if the source declares one. */
  unit?: string | null;
  /** Originating file/store name, used to build `Dataset.provenance`. */
  source?: string;
}

/** Normalize any numeric buffer to float64. */
export function asFloat64(data: NumericArray | number[]): Float64Array {
  if (data instanceof Float64Array) return data;
  return Float64Array.from(data as ArrayLike<number>);
}

/** Make a string safe to use as a file name / variable id. */
export function sanitizeName(name: string): string {
  const cleaned = name.replace(/[^\w.\-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'var';
}

/** Build a project `Dataset` from a raw variable. */
export function toDataset(raw: RawVariable, source = raw.name): Dataset {
  const axes = raw.shape.map((_, i) => ({
    name: raw.labels?.[i] ?? `dim${i}`,
  }));
  return {
    kind: 'dataset',
    id: `ds_${sanitizeName(raw.name)}`,
    name: raw.name,
    dims: raw.shape,
    data: raw.data,
    axes,
    unit: raw.unit ?? undefined,
    attrs: raw.attrs ?? {},
    provenance: `loaded from ${source}`,
  };
}

/** Serialize a `DataTable` to CSV text so it can be stored as a project file. */
export function dataTableToCSV(table: DataTable): string {
  const names = table.columnNames();
  const lines = [names.join(',')];
  for (let i = 0; i < table.length; i += 1) {
    const row = names.map((n) => {
      const v = table.getColumn(n)![i];
      if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
      if (v == null) return '';
      return String(v);
    });
    lines.push(row.join(','));
  }
  return lines.join('\n');
}
