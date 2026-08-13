// Type declarations for the generated WASM bindings (scripts/build-wasm.mjs
// emits src/native/ergalics_core.js + this companion at build time).
export type FileKind = 'Magic' | 'Extension' | 'Unknown';

export function core_version(): string;
export function detect_file_kind(prefix: Uint8Array): FileKind | null;
export function log(message: string): void;

declare const _default: Promise<unknown>;
export default _default;