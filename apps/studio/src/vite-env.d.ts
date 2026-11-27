/// <reference types="vite/client" />

/** App version injected by Vite `define` from package.json. */
declare const __APP_VERSION__: string;

/** Zenodo DOI injected by Vite `define` (empty until release archive runs). */
declare const __ZENODO_DOI__: string;

/** FR-04: whether the optional webR bundle is vendored (Vite `define`). */
declare const __WEBR_AVAILABLE__: boolean;

declare module '*.wgsl' {
  const src: string;
  export default src;
}

declare module '*.cspkg' {
  const url: string;
  export default url;
}