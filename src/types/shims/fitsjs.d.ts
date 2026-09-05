// Ambient declaration for `fitsjs` (no shipped types). The library is a
// CoffeeScript UMD bundle that hangs `FITS` off `globalThis.astro`; under Vite
// the default import may resolve to undefined at runtime, so `fits.ts` falls
// back to the global. This shim only describes the slice we use.
declare module 'fitsjs' {
  export interface FITSHeader {
    [key: string]: unknown;
    NAXIS?: number;
    NAXIS1?: number;
    NAXIS2?: number;
  }
  export class HDU {
    header: FITSHeader;
    /** Image HDU: a TypedArray (flattened row-major). Table HDU: a record of column arrays. */
    data: unknown;
    hasData(): boolean;
  }
  export class FITS {
    constructor(buffer: ArrayBuffer | Uint8Array);
    readonly hdus: HDU[];
    getHDU(index: number): HDU;
    getHeader(index: number): FITSHeader;
    getData(index: number): unknown;
  }
  const _default: typeof FITS;
  export default _default;
}
