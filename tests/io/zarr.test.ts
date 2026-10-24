import { describe, it, expect } from 'vitest';
import { loadZarrFromStore } from '@/core/io/zarr';

// Hand-built Zarr v2 Map stores (same key layout a FetchStore serves: every
// key is an AbsolutePath with a leading "/"). Exercises the enumeration core
// (loadZarrFromStore) without network access — consolidated-metadata groups,
// plain array roots, and the actionable error when a group cannot be listed.

type StoreMap = Map<string, Uint8Array>;

const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));

/** Little-endian "<f8" chunk bytes. */
function f64(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 8);
  const dv = new DataView(out.buffer);
  values.forEach((v, i) => dv.setFloat64(i * 8, v, true));
  return out;
}

const V2_ARRAY = (shape: number[], chunks: number[]) => ({
  zarr_format: 2,
  shape,
  dtype: '<f8',
  chunks,
  compressor: null,
  fill_value: 0,
  filters: null,
  order: 'C',
});

/**
 * Group root + consolidated metadata (.zmetadata) listing:
 *   /pressure      1-D float64 [10, 20, 30] with attrs {units: "Pa"}
 *   /temp          0-D scalar 7.5
 *   /nested/sub    1-D float64 in a nested group
 *   /broken        invalid array metadata → member is skipped, not fatal
 */
function buildConsolidatedGroupStore(): StoreMap {
  const pressure = V2_ARRAY([3], [3]);
  const scalar = V2_ARRAY([], []);
  return new Map<string, Uint8Array>([
    ['/.zgroup', json({ zarr_format: 2 })],
    [
      '/.zmetadata',
      json({
        metadata: {
          '.zgroup': { zarr_format: 2 },
          'pressure/.zarray': pressure,
          'pressure/.zattrs': { units: 'Pa' },
          'temp/.zarray': scalar,
          'nested/sub/.zarray': pressure,
          'broken/.zarray': { zarr_format: 2 },
        },
        zarr_consolidated_format: 1,
      }),
    ],
    ['/pressure/.zarray', json(pressure)],
    ['/pressure/.zattrs', json({ units: 'Pa' })],
    ['/pressure/0', f64(10, 20, 30)],
    ['/temp/.zarray', json(scalar)],
    ['/temp/0', f64(7.5)],
    ['/nested/sub/.zarray', json(pressure)],
    ['/nested/sub/0', f64(1, 2, 3)],
  ]);
}

/** Array root, no consolidated metadata (the pre-D1 supported shape). */
function buildArrayRootStore(): StoreMap {
  const meta = V2_ARRAY([2], [2]);
  return new Map<string, Uint8Array>([
    ['/.zarray', json(meta)],
    ['/.zattrs', json({ units: 'm' })],
    ['/0', f64(1, 2)],
  ]);
}

describe('loadZarrFromStore', () => {
  it('enumerates a consolidated-metadata group into variables', async () => {
    const vars = await loadZarrFromStore(buildConsolidatedGroupStore());
    const byName = new Map(vars.map((v) => [v.name, v]));
    expect([...byName.keys()].sort()).toEqual(['nested/sub', 'pressure', 'temp']);

    const pressure = byName.get('pressure')!;
    expect(pressure.shape).toEqual([3]);
    expect(Array.from(pressure.data)).toEqual([10, 20, 30]);
    expect(pressure.attrs!.units).toBe('Pa');

    const temp = byName.get('temp')!;
    expect(temp.shape).toEqual([]);
    expect(Array.from(temp.data)).toEqual([7.5]);

    const nested = byName.get('nested/sub')!;
    expect(Array.from(nested.data)).toEqual([1, 2, 3]);
  });

  it('skips members with invalid metadata instead of failing the store', async () => {
    const vars = await loadZarrFromStore(buildConsolidatedGroupStore());
    expect(vars.every((v) => v.name !== 'broken')).toBe(true);
  });

  it('reads an array root without consolidated metadata (legacy path)', async () => {
    const vars = await loadZarrFromStore(buildArrayRootStore());
    expect(vars).toHaveLength(1);
    expect(vars[0]!.name).toBe('array');
    expect(vars[0]!.shape).toEqual([2]);
    expect(Array.from(vars[0]!.data)).toEqual([1, 2]);
    expect(vars[0]!.attrs!.units).toBe('m');
  });

  it('explains that a bare group root cannot be enumerated', async () => {
    const store: StoreMap = new Map([
      ['/.zgroup', json({ zarr_format: 2 })],
      ['/pressure/.zarray', json(V2_ARRAY([3], [3]))],
      ['/pressure/0', f64(10, 20, 30)],
    ]);
    await expect(loadZarrFromStore(store)).rejects.toThrow(/consolidated/i);
  });
});
