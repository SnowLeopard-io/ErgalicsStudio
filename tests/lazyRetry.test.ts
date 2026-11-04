// ==========================================================================
// Tests for the lazy-chunk retry wrapper (src/core/lazyRetry.ts)
// ==========================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lazyRetry, retryImport, ChunkLoadError, isChunkLoadError } from '../src/core/lazyRetry';

// retryImport backs off between attempts; fake timers make that deterministic.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('retryImport / lazyRetry', () => {
  it('returns the module on first attempt when the import succeeds', async () => {
    const loader = vi.fn(() => Promise.resolve({ default: () => null }));
    const promise = retryImport(loader);
    await vi.runAllTimersAsync();
    expect(loader).toHaveBeenCalledTimes(1);
    await expect(promise).resolves.toHaveProperty('default');
  });

  it('retries transient failures and recovers without throwing', async () => {
    let calls = 0;
    const loader = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw new TypeError('Failed to fetch dynamically imported module');
      return { default: () => null };
    });
    const promise = retryImport(loader);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toHaveProperty('default');
    expect(calls).toBe(3);
  });

  it('supports .then() loaders (named exports) like React.lazy does', async () => {
    const loader = vi.fn(() =>
      Promise.resolve({ CodeEditor: () => null }).then((m) => ({ default: m.CodeEditor })),
    );
    const promise = retryImport(loader);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toHaveProperty('default');
  });

  it('throws a ChunkLoadError after exhausting all attempts', async () => {
    const loader = vi.fn(async (): Promise<{ default: () => null }> => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    const promise = retryImport(loader);
    promise.catch(() => undefined); // avoid unhandled rejection
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toBeInstanceOf(ChunkLoadError);
    // 1 initial + 2 retries
    expect(loader).toHaveBeenCalledTimes(3);
  });

  it('lazyRetry composes React.lazy with retryImport', () => {
    const comp = lazyRetry(() => Promise.resolve({ default: () => null }));
    // LazyExoticComponent payload is opaque; just assert it produced a value.
    expect(comp).toBeTruthy();
  });

  it('isChunkLoadError only matches ChunkLoadError instances', () => {
    expect(isChunkLoadError(new ChunkLoadError(new Error('x')))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch'))).toBe(false);
  });
});
