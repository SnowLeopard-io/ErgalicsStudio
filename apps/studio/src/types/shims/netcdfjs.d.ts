// Ambient declaration for `netcdfjs` (no shipped types). Re-exports from
// `./parser.js`; the reader exposes `variables`, `dimensions`, `globalAttributes`
// and `getDataVariable(name)`.
declare module 'netcdfjs' {
  export interface NetCDFAttribute {
    name: string;
    value: unknown;
  }
  export interface NetCDFDimension {
    name: string;
    size: number;
  }
  export interface NetCDFVariableMeta {
    name: string;
    /** Dimension *ids* (0-based indices into `reader.dimensions`), not names. */
    dimensions: number[];
    type: string;
    attributes: NetCDFAttribute[];
  }
  export class NetCDFReader {
    constructor(data: ArrayBuffer | Uint8Array);
    readonly variables: NetCDFVariableMeta[];
    readonly dimensions?: NetCDFDimension[];
    readonly globalAttributes?: Record<string, unknown>;
    /**
     * Returns the variable's values as a flat row-major TypedArray.
     * (Runtime method is `getDataVariable`; `getVariable` does not exist.)
     */
    getDataVariable(variableName: string): Float64Array | Float32Array | Int32Array | Int16Array | Uint8Array | number[];
  }
  export default NetCDFReader;
}
