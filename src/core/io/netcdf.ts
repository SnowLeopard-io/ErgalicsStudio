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
  } catch (err) {
    // A corrupted/truncated/unsupported file must surface to the user, not
    // masquerade as a successful import of zero variables (EG1-71). Callers
    // (loadScientificData → routeFile) catch and toast the message.
    throw new Error(`NetCDF parse failed: ${err instanceof Error ? err.message : String(err)}`);
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

    // EG3-47: apply packed-data metadata. NetCDF variables commonly store
    // `raw = (value - add_offset) / scale_factor` with `_FillValue` /
    // `missing_value` sentinels for unobserved cells; import the *unpacked*
    // values and map the sentinels to NaN so statistics/plots never treat
    // packed integers or fill values as real observations.
    const toNum = (x: unknown): number | null => {
      if (typeof x === 'number') return Number.isFinite(x) ? x : null;
      if (typeof x === 'string' && x.trim() !== '') {
        const n = Number(x);
        return Number.isFinite(n) ? n : null;
      }
      return null;
    };
    const sentinels: number[] = [];
    for (const key of ['_FillValue', 'missing_value']) {
      const a = attrs[key];
      if (typeof a === 'number' || typeof a === 'string') {
        const n = toNum(a);
        if (n !== null) sentinels.push(n);
      } else if (Array.isArray(a)) {
        for (const x of a) {
          const n = toNum(x);
          if (n !== null) sentinels.push(n);
        }
      }
    }
    const scale = toNum(attrs['scale_factor']);
    const offset = toNum(attrs['add_offset']);
    let data = asFloat64(elems);
    if (sentinels.length > 0) {
      data = data.map((x) => (sentinels.some((s) => s === x) ? NaN : x));
    }
    if (scale !== null || offset !== null) {
      const sc = scale ?? 1;
      const off = offset ?? 0;
      data = data.map((x) => (Number.isFinite(x) ? x * sc + off : x));
    }

    out.push({
      name: v.name,
      data,
      shape: shape.length ? shape : [elems.length],
      labels,
      attrs,
      unit,
    });
  }
  return out;
}
