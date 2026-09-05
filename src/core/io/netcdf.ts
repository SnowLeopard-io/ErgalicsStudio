// NetCDF loader (netcdfjs). Covers classic NetCDF-3 and NetCDF-4 (the latter is
// HDF5-based, so `detectScientificFormat` routes `.nc`/NetCDF-4 to `hdf5` when
// the magic bytes are HDF5; netcdfjs handles the classic format here).

// netcdfjs is a pure-JS parser: still loaded on demand (editor architecture
// §1.1) to keep the Standard-mode initial bundle lean.
import type { NetCDFReader } from 'netcdfjs';
import { asFloat64, type RawVariable } from './types';

export async function loadNetcdf(buffer: ArrayBuffer): Promise<RawVariable[]> {
  const { NetCDFReader: NetCDFReaderCtor } = await import('netcdfjs');
  let reader: NetCDFReader;
  try {
    reader = new NetCDFReaderCtor(buffer);
  } catch {
    return [];
  }
  const out: RawVariable[] = [];
  // `reader.dimensions` is ordered; a variable's `dimensions` field is a list of
  // dimension *ids* (0-based indices into that array), not names.
  const dimById = new Map<number, { name: string; size: number }>();
  (reader.dimensions ?? []).forEach((d, i) => dimById.set(i, { name: d.name, size: d.size }));

  for (const v of reader.variables ?? []) {
    // `getDataVariable` returns a flat row-major TypedArray (or Array); it is
    // never an object, so gate on "is it data", not Array.isArray.
    const raw = reader.getDataVariable(v.name);
    if (!(ArrayBuffer.isView(raw) || Array.isArray(raw))) continue;
    const elems = Array.from(raw as ArrayLike<number>);
    const shape = (v.dimensions ?? []).map((id) => dimById.get(id)?.size ?? 0);
    const labels = (v.dimensions ?? []).map((id) => dimById.get(id)?.name ?? `dim${id}`);
    const attrs: Record<string, unknown> = {};
    for (const a of (v.attributes as { name: string; value: unknown }[]) ?? []) {
      attrs[a.name] = a.value;
    }
    const unit = typeof attrs['units'] === 'string' ? (attrs['units'] as string) : null;
    out.push({
      name: v.name,
      data: asFloat64(elems),
      shape: shape.length ? shape : [elems.length],
      labels,
      attrs,
      unit,
    });
  }
  return out;
}
