// Real-ESM fixture for the wasm loader tests (EG2-39): exercises the actual
// dynamic-import path — default init callable, named bindings surfaced —
// without depending on the Rust build artifact. The loader still points at a
// real `import()`, so module shape/init-contract regressions fail here.
let initCalls = 0;
let failInits = 0;

export async function setInitBehavior({ failTimes = 0 } = {}) {
  failInits = failTimes;
  initCalls = 0;
}

export default async function init() {
  initCalls += 1;
  if (initCalls <= failInits) throw new Error(`fixture init failed (call ${initCalls})`);
}

export function core_version() {
  return 'fixture-core';
}

export function detect_file_kind() {
  return 0;
}

export function log() {}

export function __fixtureInitCalls() {
  return initCalls;
}
