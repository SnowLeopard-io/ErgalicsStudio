// WASM loader retry logic tests (spec §11.1: retry 3x, 1s interval).
//
// The native module (`@/native/ergalics_core.js`) is a build artifact that
// is git-untracked and absent in a clean clone / CI until `build:wasm` runs,
// so these tests inject a mock loader via `__setWasmLoader` instead of
// relying on module resolution or `vi.doMock` (the dynamic import is
// intentionally `@vite-ignore`d, which vitest cannot intercept).
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
