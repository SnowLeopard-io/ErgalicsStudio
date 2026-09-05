// FITS loader (fitsjs). Handles both image HDUs (a flattened TypedArray that we
// reshape via the NAXIS* header keys) and table HDUs (a record of column
// arrays). fitsjs is a CoffeeScript UMD bundle that exposes `FITS` on
// `globalThis.astro`; the default import may be undefined under Vite, so we fall
// back to the global. Verified in-browser; behavior with `import` interop is
// environment-dependent.

// fitsjs is a CoffeeScript UMD bundle: load it on demand and resolve the
// constructor defensively (editor architecture §1.1).
import { asFloat64, type RawVariable } from './types';

// fitsjs is a CoffeeScript UMD IIFE that sets `this.astro.FITS`. Under Vite it
// resolves to the module exports object `{ astro: { FITS } }`; in other setups
// the constructor may be the default, or only reachable via the global. Resolve
// all three shapes. (Pure JS, no WASM — but the import interop is environment
// dependent, so this is best-effort and should be confirmed in-browser.)
function resolveFITS(fitsModule: unknown): {
  new (buffer: ArrayBuffer | Uint8Array): {
    hdus: { hasData(): boolean }[];
    getHDU(index: number): {
      header: Record<string, unknown>;
      data: unknown;
      hasData(): boolean;
    };
  };
} | undefined {
  const mod = fitsModule as unknown as
    | { FITS?: unknown; astro?: { FITS?: unknown }; default?: unknown }
    | undefined;
  const g = globalThis as { astro?: { FITS?: unknown } };
  const ctor =
    (typeof mod?.default === 'function' ? mod.default : undefined) ??
    (typeof mod === 'function' ? mod : undefined) ??
    mod?.FITS ??
    mod?.astro?.FITS ??
    g.astro?.FITS;
  return ctor as never ?? undefined;
}

export async function loadFits(buffer: ArrayBuffer): Promise<RawVariable[]> {
  const fitsMod = await import('fitsjs');
  const fitsModule = (fitsMod as { default?: unknown }).default ?? fitsMod;
  const FITS = resolveFITS(fitsModule);
  if (!FITS) {
    throw new Error('fitsjs failed to load: no FITS constructor (check bundler interop)');
  }
  const fits = new FITS(buffer);
  const out: RawVariable[] = [];

  for (let i = 0; i < fits.hdus.length; i += 1) {
    const hdu = fits.getHDU(i);
    if (!hdu || !hdu.hasData()) continue;
    const header = hdu.header as Record<string, unknown>;
    const data = hdu.data as unknown;

    if (data && (ArrayBuffer.isView(data) || Array.isArray(data))) {
      const naxis = Number(header.NAXIS ?? 1);
      const shape: number[] = [];
      for (let a = 0; a < naxis; a += 1) shape.push(Number(header[`NAXIS${a + 1}`] ?? 0));
      out.push({
        name: `hdu${i}`,
        data: asFloat64(Array.from(data as ArrayLike<number>)),
        shape,
        labels: shape.map((_, a) => `axis${a}`),
      });
    } else if (data && typeof data === 'object') {
      const record = data as Record<string, unknown[]>;
      const keys = Object.keys(record);
      const firstKey = keys[0];
      const firstCol = firstKey ? record[firstKey] : undefined;
      const nRows = firstCol && Array.isArray(firstCol) ? firstCol.length : 0;
      const nCols = keys.length;
      const flat = new Float64Array(nRows * nCols);
      keys.forEach((k, c) => {
        const col = record[k];
        for (let r = 0; r < nRows; r += 1) {
          const v = col ? col[r] : undefined;
          flat[r * nCols + c] = typeof v === 'number' ? v : Number(v) || NaN;
        }
      });
      out.push({
        name: `hdu${i}`,
        data: flat,
        shape: [nRows, nCols],
        labels: [null, null],
        attrs: { columns: keys },
      });
    }
  }
  return out;
}
