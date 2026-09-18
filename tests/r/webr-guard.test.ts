// FR-04 — webR adapter guard tests: when the optional webR bundle is absent
// (Node has neither globalThis.WebR nor webr/webr.mjs), every entry point
// must fail with a recognisable, catchable error — never crash the process.
import { describe, it, expect, afterEach } from 'vitest';
import { WebRRuntime } from '@/core/r/webr-runtime';
import { WebRUnavailableError, isValidRPkgName } from '@/core/r/types';

describe('WebRRuntime guards (FR-04)', () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>).WebR;
  });

  it('load() rejects with WebRUnavailableError when the bundle cannot be imported', async () => {
    const rt = new WebRRuntime();
    await expect(rt.load()).rejects.toBeInstanceOf(WebRUnavailableError);
  });

  it('the load error carries the recognisable code and a vendoring hint', async () => {
    const rt = new WebRRuntime();
    const err = await rt.load().then(
      () => null,
      (e: unknown) => e as WebRUnavailableError,
    );
    expect(err).not.toBeNull();
    expect(err!.code).toBe('webr-unavailable');
    expect(err!.message).toContain('public/webr');
  });

  it('a module without a WebR export is also reported as unavailable', async () => {
    // `node:vm` imports fine in Node but exports no `WebR` constructor.
    const rt = new WebRRuntime({ moduleUrl: 'node:vm' });
    await expect(rt.load()).rejects.toThrow(/does not export a WebR constructor/);
  });

  it('exec propagates the recognisable load error (no silent crash)', async () => {
    const rt = new WebRRuntime();
    await expect(rt.exec('1 + 1')).rejects.toBeInstanceOf(WebRUnavailableError);
  });

  it('install rejects invalid package names before touching the runtime', async () => {
    const rt = new WebRRuntime();
    await expect(rt.install('bad name!')).rejects.toThrow(/invalid R package name/);
    await expect(rt.install('1abc')).rejects.toThrow(/invalid R package name/);
  });

  it('dispose before load is a safe no-op', async () => {
    const rt = new WebRRuntime();
    await expect(rt.dispose()).resolves.toBeUndefined();
  });

  it('isValidRPkgName accepts CRAN-style names and rejects junk', () => {
    expect(isValidRPkgName('ggplot2')).toBe(true);
    expect(isValidRPkgName('data.table')).toBe(true);
    expect(isValidRPkgName('dplyr')).toBe(true);
    expect(isValidRPkgName('')).toBe(false);
    expect(isValidRPkgName('2bad')).toBe(false);
    expect(isValidRPkgName('rm -rf /')).toBe(false);
    expect(isValidRPkgName('pkg;evil')).toBe(false);
  });
});
