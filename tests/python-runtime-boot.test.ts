// ==========================================================================
// Python runtime boot lifecycle.
//
// Regression: aborting a boot and immediately starting a new one used to let
// the cancelled boot's rejection handler clear the NEW boot promise. The
// settings panel then stayed on "启动中…" forever while the second boot had
// actually succeeded. Boot generations now guard the shared state.
// ==========================================================================

// @vitest-environment jsdom

import { describe, expect, it, vi, beforeEach } from 'vitest';

const runtime = vi.hoisted(() => ({
  runPython: vi.fn(),
  installPackages: vi.fn(),
  interrupt: vi.fn(),
  dispose: vi.fn(),
}));

vi.mock('@/core/pyodide/runtime', () => ({
  createCodeRuntime: () => runtime,
}));

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('warmPythonRuntime boot generations', () => {
  beforeEach(() => {
    vi.resetModules();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockReturnValue({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      }),
    });
    runtime.runPython.mockReset();
    runtime.installPackages.mockReset().mockResolvedValue({ ok: true, loaded: [] });
    runtime.interrupt.mockReset();
    runtime.dispose.mockReset();
  });

  it('a cancelled boot cannot clobber the boot started right after it', async () => {
    const status = await import('@/core/pyodide/runtime-status');
    const rt = await import('@/core/pyodide/code-runtime');

    const first = deferred<{ ok: boolean; error?: string }>();
    const second = deferred<{ ok: boolean }>();
    runtime.runPython
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    // A real client.interrupt() rejects every pending request.
    runtime.interrupt.mockImplementation(() => first.reject(new Error('interrupted')));

    const boot1 = rt.warmPythonRuntime();
    rt.abortPythonBoot();
    const boot2 = rt.warmPythonRuntime();

    second.resolve({ ok: true });

    expect(await boot1).toBe(false);
    expect(await boot2).toBe(true);
    // The stale boot must not have cleared the new boot handle: the panel
    // uses this to decide whether it can read the loaded-package list.
    expect(rt.isPythonRuntimeWarm()).toBe(true);
    expect(status.usePythonRuntimeStatus.getState().phase).toBe('ready');
  });

  it('a genuine failure clears the boot promise and reports the error', async () => {
    const status = await import('@/core/pyodide/runtime-status');
    const rt = await import('@/core/pyodide/code-runtime');

    const first = deferred<{ ok: boolean; error?: string }>();
    runtime.runPython.mockImplementationOnce(() => first.promise);

    const boot = rt.warmPythonRuntime();
    first.reject(new Error('wasm compile failed'));

    expect(await boot).toBe(false);
    expect(status.usePythonRuntimeStatus.getState().phase).toBe('failed');

    // The next warm-up must be able to retry from scratch.
    runtime.runPython.mockImplementationOnce(async () => ({ ok: true }));
    expect(await rt.warmPythonRuntime()).toBe(true);
    expect(rt.isPythonRuntimeWarm()).toBe(true);
    expect(status.usePythonRuntimeStatus.getState().phase).toBe('ready');
  });
});
