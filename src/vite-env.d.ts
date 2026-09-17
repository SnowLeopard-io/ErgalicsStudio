/// <reference types="vite/client" />

/** App version injected by Vite `define` from package.json. */
declare const __APP_VERSION__: string;

declare module '*.wgsl' {
  const src: string;
  export default src;
}

declare module '*.cspkg' {
  const url: string;
  export default url;
}