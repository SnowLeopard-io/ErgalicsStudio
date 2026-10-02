// FITS loader unit tests (EG2-38) — the parser previously had no test guard,
// so the "0"-cell → NaN corruption class had nothing to catch it.
//
// fitsjs is a CoffeeScript UMD bundle; loadFits resolves the constructor from
// several module shapes. We mock 'fitsjs' with a fake FITS class injected
// through a hoisted holder (vi.mock factories are hoisted above imports) and
// exercise loadFits's HDU walking, reshaping and cell-conversion semantics.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFits } from '@/core/io/fits';

interface FakeHDU {
  header: Record<string, unknown>;
  data: unknown;
  hasData(): boolean;
}

const h = vi.hoisted(() => {
  type HDU = {
    header: Record<string, unknown>;
    data: unknown;
    hasData(): boolean;
  };
  let hdus: HDU[] = [];
  let resolveMode: 'astro' | 'empty' = 'astro';
  class FakeFITS {
    hdus: HDU[];
    constructor(_buffer: ArrayBuffer) {
      this.hdus = hdus;
    }
    getHDU(i: number): HDU | undefined {
      return this.hdus[i];
    }
  }
  return {
    FakeFITS,
    setHdus(next: HDU[]): void {
      hdus = next;
    },
    setResolveMode(mode: 'astro' | 'empty'): void {
      resolveMode = mode;
    },
    factory() {
      // resolveFITS probes `.default` / `.FITS` / `.astro` on the module
      // namespace; each must be an *own* key (even when undefined) because
      // vitest's mock-namespace proxy throws on reads of keys the factory
      // did not define. `astro` is a live getter: the mock namespace is
      // materialized on the first import of 'fitsjs', so a static value
      // would freeze resolveMode and `setResolveMode('empty')` could never
      // take effect.
      return {
        default: undefined as unknown,
        FITS: undefined as unknown,
        get astro(): { FITS: typeof FakeFITS } | undefined {
          return resolveMode === 'astro' ? { FITS: FakeFITS } : undefined;
        },
      };
    },
  };
});

vi.mock('fitsjs', () => h.factory());

const hdu = (header: Record<string, unknown>, data: unknown): FakeHDU => ({
  header,
  data,
  hasData: () => data != null,
});

describe('loadFits', () => {
  beforeEach(() => {
    h.setResolveMode('astro');
    h.setHdus([]);
  });

  it('reshapes an image HDU via the NAXIS header keys', async () => {
    h.setHdus([
      hdu({ NAXIS: 2, NAXIS1: 2, NAXIS2: 2 }, new Float32Array([1, 2, 3, 4])),
    ]);
    const vars = await loadFits(new ArrayBuffer(8));
    expect(vars).toHaveLength(1);
    expect(vars[0]!.name).toBe('hdu0');
    expect(vars[0]!.shape).toEqual([2, 2]);
    expect(Array.from(vars[0]!.data)).toEqual([1, 2, 3, 4]);
    expect(vars[0]!.labels).toEqual(['axis0', 'axis1']);
  });

  it('keeps a valid numeric zero string in a table HDU (EG1-70 regression)', async () => {
    h.setHdus([
      hdu({}, { t: [1, '0', '', 'abc'], id: ['a', 'b', 'c', 'd'] }),
    ]);
    const vars = await loadFits(new ArrayBuffer(8));
    expect(vars).toHaveLength(1);
    const v = vars[0]!;
    expect(v.shape).toEqual([4, 2]);
    expect(v.attrs!.columns).toEqual(['t', 'id']);
    const d = Array.from(v.data);
    // Row-major [4×2] — column t occupies even indices: the "0" cell (t,r1)
    // survives as 0…
    expect(d[0]!).toBe(1);
    expect(d[2]!).toBe(0);
    // …blank and non-numeric cells stay missing (NaN).
    expect(Number.isNaN(d[4]!)).toBe(true);
    expect(Number.isNaN(d[6]!)).toBe(true);
    // The id column (odd indices) is all-string: no fabricated numbers.
    expect(Number.isNaN(d[1]!)).toBe(true);
    expect(Number.isNaN(d[3]!)).toBe(true);
    expect(Number.isNaN(d[5]!)).toBe(true);
    expect(Number.isNaN(d[7]!)).toBe(true);
  });

  it('preserves non-finite numeric HDU data', async () => {
    h.setHdus([hdu({ NAXIS: 1, NAXIS1: 3 }, new Float64Array([NaN, Infinity, -Infinity]))]);
    const vars = await loadFits(new ArrayBuffer(8));
    const d = Array.from(vars[0]!.data);
    expect(Number.isNaN(d[0]!)).toBe(true);
    expect(d[1]!).toBe(Infinity);
    expect(d[2]!).toBe(-Infinity);
  });

  it('skips HDUs without data and keeps the hdu index in the name', async () => {
    h.setHdus([
      hdu({ NAXIS: 1, NAXIS1: 1 }, null),
      hdu({ NAXIS: 1, NAXIS1: 2 }, new Float64Array([7, 8])),
    ]);
    const vars = await loadFits(new ArrayBuffer(8));
    expect(vars).toHaveLength(1);
    expect(vars[0]!.name).toBe('hdu1');
    expect(Array.from(vars[0]!.data)).toEqual([7, 8]);
  });

  it('falls back to a single zero-length axis when NAXIS is absent', async () => {
    h.setHdus([hdu({}, new Float64Array([5]))]);
    const vars = await loadFits(new ArrayBuffer(8));
    expect(vars[0]!.shape).toEqual([0]);
    expect(Array.from(vars[0]!.data)).toEqual([5]);
  });

  it('throws a descriptive error when no FITS constructor is resolvable', async () => {
    h.setResolveMode('empty');
    await expect(loadFits(new ArrayBuffer(8))).rejects.toThrow(/fitsjs failed to load/);
  });
});
