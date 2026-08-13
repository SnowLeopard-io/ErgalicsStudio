// Stub for the generated WASM core bindings.
// The real bindings are produced by `npm run build:wasm` (scripts/build-wasm.mjs)
// which emits this file into src/native/. This stub keeps the frontend
// buildable and runnable in graceful-degradation mode before the Rust core
// has been compiled.

export function core_version() {
  throw new Error('WASM core not built — run `npm run build:wasm`');
}

export function detect_file_kind() {
  return null;
}

export function log() {
  /* noop */
}

const _default = Promise.resolve();
export default _default;