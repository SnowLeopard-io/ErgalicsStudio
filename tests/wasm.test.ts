// WASM loader retry logic tests (spec §11.1: retry 3x, 1s interval).
//
// Two layers are covered:
//  1. Retry/backoff policy — via a mock loader injected through
//     `__setWasmLoader` (pure policy tests, no module resolution involved).
//  2. The real import path (EG2-39) — a real ESM fixture module under
//     `tests/fixtures/native-esm.js` flows through an actual `import()`, so
//     the loader contract (default init callable, named bindings surfaced,
//     init failure retry) is verified rather than assumed. A conditional test
//     also covers the default loader's graceful degradation when the native
//     module is absent (clean clone / CI).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const moduleMock = vi.hoisted(() => ({
  init: vi.fn(),
  core_version: vi.fn(() => 'test-core'),
}));

async function freshWasm() {
  // Re-import so the module-level cache (module/loading) starts clean.
  const wasm = await import('@/core/wasm');
  // Point the loader at the mock — a plain import() promise that resolves
  // instantly, so fake timers control only the retry backoff.
  wasm.__setWasmLoader(() =>
    Promise.resolve({
      default: moduleMock.init,
      core_version: moduleMock.core_version,
      detect_file_kind: () => 0,
      log: () => {},
    }),
  );
  return wasm;
}

/** Fresh wasm module whose loader points at the REAL fixture module. */
async function fixtureWasm() {
  const wasm = await import('@/core/wasm');
  wasm.__setWasmLoader(() => import('./fixtures/native-esm.js'));
  return wasm;
}

describe('wasm loader', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    moduleMock.init.mockReset();
    moduleMock.core_version.mockReset().mockReturnValue('test-core');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes the spec retry policy', async () => {
    const { MAX_WASM_RETRIES, WASM_RETRY_DELAY_MS } = await freshWasm();
    expect(MAX_WASM_RETRIES).toBe(3);
    expect(WASM_RETRY_DELAY_MS).toBe(1000);
  });

  it('loads the module when init succeeds', async () => {
    moduleMock.init.mockResolvedValue(undefined);
    const { loadWasm } = await freshWasm();
    const mod = await loadWasm();
    expect(mod).not.toBeNull();
    expect(moduleMock.init).toHaveBeenCalledTimes(1);
  });

  it('returns null after MAX_WASM_RETRIES when init keeps failing', async () => {
    moduleMock.init.mockRejectedValue(new Error('wasm load failed'));
    const { loadWasm, MAX_WASM_RETRIES, WASM_RETRY_DELAY_MS } = await freshWasm();
    const promise = loadWasm();
    await vi.advanceTimersByTimeAsync(WASM_RETRY_DELAY_MS * MAX_WASM_RETRIES + 100);
    const mod = await promise;
    expect(mod).toBeNull();
    expect(moduleMock.init.mock.calls.length).toBe(MAX_WASM_RETRIES);
  });
});

describe('wasm loader — real import path', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads a real ESM fixture: default init called, named bindings surfaced', async () => {
    const fixture = await import('./fixtures/native-esm.js');
    await fixture.setInitBehavior({ failTimes: 0 });
    const { loadWasm } = await fixtureWasm();
    const mod = await loadWasm();
    expect(mod).not.toBeNull();
    // The default export was invoked once as init…
    expect(fixture.__fixtureInitCalls()).toBe(1);
    // …and the named bindings flow through the real import.
    expect(mod!.core_version()).toBe('fixture-core');
    expect(mod!.detect_file_kind(new Uint8Array(4))).toBe(0);
    expect(typeof mod!.log).toBe('function');
  });

  it('retries a real fixture whose default init fails, then succeeds', async () => {
    const fixture = await import('./fixtures/native-esm.js');
    await fixture.setInitBehavior({ failTimes: 2 }); // attempts 1–2 throw, 3 succeeds
    const { loadWasm, WASM_RETRY_DELAY_MS } = await fixtureWasm();
    const promise = loadWasm();
    await vi.advanceTimersByTimeAsync(WASM_RETRY_DELAY_MS * 3 + 100);
    const mod = await promise;
    expect(mod).not.toBeNull();
    expect(fixture.__fixtureInitCalls()).toBe(3);
  });

  it('default loader degrades to null when the native module is absent', async () => {
    // Only meaningful on a clean checkout / CI where src/native/ergalics_core.js
    // has not been generated (make-wasm-stub / build:wasm). When a developer
    // has built the real module locally this path legitimately loads it.
    const nativeModule = fileURLToPath(
      new URL('../src/native/ergalics_core.js', import.meta.url),
    );
    if (existsSync(nativeModule)) return;
    // Real timers: the default loader drives a REAL vite import(), whose
    // failure propagation is not reliably driven by fake timers (the module
    // runner can hold internal timer races). The real retry backoff is only
    // ~2s total, well under the timeout.
    vi.useRealTimers();
    const { loadWasm } = await import('@/core/wasm');
    await expect(loadWasm()).resolves.toBeNull();
  }, 30_000);
});
