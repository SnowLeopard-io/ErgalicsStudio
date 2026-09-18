// FR-04 — R runtime factory tests: fallback behaviour in a Node environment
// where no webR bundle exists (dynamic import of webr/webr.mjs always fails).
import { describe, it, expect, vi } from 'vitest';
import { createRRuntime } from '@/core/r/runtime-factory';
import { createStudioApi, type StudioApiHost } from '@/editor/runtime/studio-api';

function makeGetStudioApi() {
  const host: StudioApiHost = {
    loadText: vi.fn(async () => 'x\n1'),
    renderView: vi.fn(async () => undefined),
    notify: vi.fn(),
    print: vi.fn(),
  };
  return () => createStudioApi(host);
}

describe('createRRuntime (FR-04 factory)', () => {
  it('without webR available, falls back to builtin-ir with a reason', async () => {
    const { runtime, engine, fallbackReason } = await createRRuntime({
      preferFull: true,
      getStudioApi: makeGetStudioApi(),
    });
    expect(engine).toBe('builtin-ir');
    expect(runtime.isFullRuntime).toBe(false);
    expect(typeof fallbackReason).toBe('string');
    expect(fallbackReason).toContain('webR');
    await runtime.dispose();
  });

  it('never rejects even when the full runtime is unavailable', async () => {
    await expect(
      createRRuntime({ preferFull: true, getStudioApi: makeGetStudioApi() }),
    ).resolves.toMatchObject({ engine: 'builtin-ir' });
  });

  it('preferFull=false goes straight to builtin without probing webR', async () => {
    const { runtime, engine, fallbackReason } = await createRRuntime({
      preferFull: false,
      getStudioApi: makeGetStudioApi(),
    });
    expect(engine).toBe('builtin-ir');
    expect(fallbackReason).toBeUndefined();
    expect(runtime.isFullRuntime).toBe(false);
    await runtime.dispose();
  });

  it('the fallback runtime is immediately usable (exec works)', async () => {
    const { runtime } = await createRRuntime({
      preferFull: true,
      getStudioApi: makeGetStudioApi(),
    });
    const result = await runtime.exec('a <- 1');
    expect(result.ok).toBe(true);
    expect(result.variables).toBeDefined();
    await runtime.dispose();
  });

  it('a bogus moduleUrl still falls back cleanly with a recognisable reason', async () => {
    const { engine, fallbackReason } = await createRRuntime({
      preferFull: true,
      getStudioApi: makeGetStudioApi(),
      webrModuleUrl: 'this:module/does-not-exist.mjs',
    });
    expect(engine).toBe('builtin-ir');
    expect(fallbackReason).toContain('webR bundle not found');
  });

  it('onProgress fires during the full-runtime probe', async () => {
    const percents: number[] = [];
    await createRRuntime({
      preferFull: true,
      getStudioApi: makeGetStudioApi(),
      onProgress: (p) => percents.push(p),
    });
    expect(percents).toContain(5); // the 'probe' stage before the import attempt
  });

  it('a preloaded globalThis.WebR is used as the full runtime', async () => {
    const evalRVoid = vi.fn(async () => undefined);
    class FakeWebR {
      ready = Promise.resolve();
      evalRVoid = evalRVoid;
      installPackages = vi.fn(async () => undefined);
      flush = () => [{ type: 'stdout', data: 'hello from R\n' }];
    }
    (globalThis as Record<string, unknown>).WebR = FakeWebR;
    try {
      const { runtime, engine, fallbackReason } = await createRRuntime({
        preferFull: true,
        getStudioApi: makeGetStudioApi(),
      });
      expect(fallbackReason).toBeUndefined();
      expect(engine).toBe('webr');
      expect(runtime.isFullRuntime).toBe(true);
      const result = await runtime.exec('print("hello")');
      expect(result.ok).toBe(true);
      expect(result.stdout).toContain('hello from R');
      await runtime.dispose();
    } finally {
      delete (globalThis as Record<string, unknown>).WebR;
    }
  });
});
