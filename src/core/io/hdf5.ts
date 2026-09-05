// HDF5 family loader (h5wasm). Covers plain HDF5, h5ad (AnnData / single-cell),
// and MATLAB v7.3 MAT files — all of which are HDF5 containers.

// h5wasm is a WASM package: load it on demand (only when an HDF5 file is
// actually parsed) so it never enters the Standard-mode initial bundle and a
// failure here cannot take down the whole workbench (editor architecture §1.1).
import type * as h5wasm from 'h5wasm';
import { asFloat64, type NumericArray, type RawVariable } from './types';

// h5wasm's d.ts only types the `File` constructor for a filename string, but the
// runtime also accepts a Uint8Array to read straight from memory. Cast once.
type H5FileCtor = new (data: Uint8Array | string, mode?: string) => h5wasm.File;

const NUMERIC = [
  Float64Array, Float32Array, Int8Array, Int16Array, Int32Array,
  Uint8Array, Uint16Array, Uint32Array, BigInt64Array, BigUint64Array,
] as const;

function isNumericTypedArray(v: unknown): v is NumericArray {
  return NUMERIC.some((Ctor) => v instanceof Ctor);
}

function collectAttrs(ds: h5wasm.Dataset): Record<string, unknown> | undefined {
  try {
    const attrs = ds.attrs;
    if (!attrs) return undefined;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(attrs)) {
      try {
        const a = attrs[key];
        out[key] = a ? (a as { value?: unknown }).value ?? null : null;
      } catch {
        /* ignore unreadable attribute */
      }
    }
    return out;
  } catch {
    return undefined;
  }
}

/** Read every numeric dataset in an HDF5 container into `RawVariable`s. */
export async function loadHdf5(buffer: ArrayBuffer): Promise<RawVariable[]> {
  const h5 = await import('h5wasm');
  await h5.ready;
  const H5File = h5.File as unknown as H5FileCtor;
  const file = new H5File(new Uint8Array(buffer), 'r');
  try {
    const out: RawVariable[] = [];
    for (const path of file.paths()) {
      const node = file.get(path);
      if (!node) continue;
      if ((node as unknown as { type?: string }).type !== 'Dataset') continue;
      const ds = node as h5wasm.Dataset;
      const value = ds.value;
      if (!isNumericTypedArray(value)) continue;
      const shape = ds.shape ?? [];
      const labels = (ds.get_dimension_labels?.() ?? []).map((l: string | null) => l);
      out.push({
        name: path || '/',
        data: asFloat64(value),
        shape,
        labels,
        attrs: collectAttrs(ds),
      });
    }
    return out;
  } finally {
    file.close();
  }
}
