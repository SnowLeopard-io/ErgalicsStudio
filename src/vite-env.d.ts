/// <reference types="vite/client" />

declare module '*.wgsl' {
  const src: string;
  export default src;
}

declare module '*.cspkg' {
  const url: string;
  export default url;
}