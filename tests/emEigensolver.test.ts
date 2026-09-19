// EM Eigensolver plugin — pure-logic tests (no worker/Pyodide involved).
import { describe, it, expect } from 'vitest';
import { emEigensolverManifest, EmEigensolverPlugin, parseSigma } from '@/plugins/builtin/em-eigensolver/plugin';
import { spectrumDomain, mapToX } from '@/plugins/builtin/em-eigensolver/render';
import { findBuiltin } from '@/plugins/builtin';
import type { PluginApi } from '@/types/plugin';

function fakeApi(locale = 'en-US'): PluginApi {
  return {
    locale,
    t: (k: string) => k,
    onLocaleChange: () => () => {},
    setStatus: () => {},
    reportGpuTime: () => {},
    reportDataScale: () => {},
    notify: () => {},
    log: () => {},
    exportFile: () => {},
    cache: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => false,
      clear: async () => {},
      keys: async () => [],
    },
    openFile: async () => null,
    readText: async () => '',
    readBinary: async () => new ArrayBuffer(0),
    getParam: () => undefined,
    setParam: () => {},
  };
}

describe('em-eigensolver manifest', () => {
  it('declares the solver formats and trusted sandbox', () => {
    expect(emEigensolverManifest.id).toBe('example.em-eigensolver');
    expect(emEigensolverManifest.sandbox).toBe('trusted');
    const exts = (emEigensolverManifest.formats ?? []).map((f) => f.extension);
    expect(exts).toEqual(['.npz', '.npy', '.mtx']);
  });

  it('is registered as a builtin plugin (resolvable by findBuiltin)', () => {
    expect(findBuiltin('example.em-eigensolver')?.manifest.id).toBe('example.em-eigensolver');
  });
});

describe('parseSigma', () => {
  it('maps empty/blank input to null (extremal mode)', () => {
    expect(parseSigma('')).toBeNull();
    expect(parseSigma('   ')).toBeNull();
  });

  it('parses finite numbers and rejects junk', () => {
    expect(parseSigma('-0.75')).toBe(-0.75);
    expect(parseSigma(' 1e-3 ')).toBeCloseTo(0.001);
    expect(parseSigma('abc')).toBeNull();
  });
});

describe('spectrum layout helpers', () => {
  it('pads a non-degenerate domain by 8% on both sides', () => {
    const d = spectrumDomain([0, 10]);
    expect(d.min).toBeCloseTo(-0.8);
    expect(d.max).toBeCloseTo(10.8);
  });

  it('widens a degenerate (single-point) domain', () => {
    const d = spectrumDomain([2, 2, 2]);
    expect(d.min).toBeLessThan(2);
    expect(d.max).toBeGreaterThan(2);
  });

  it('falls back to [-1, 1] with no finite values', () => {
    expect(spectrumDomain([NaN, Infinity])).toEqual({ min: -1, max: 1 });
  });

  it('maps values monotonically onto [x0, x1]', () => {
    const domain = { min: -1, max: 1 };
    expect(mapToX(-1, domain, 0, 100)).toBeCloseTo(0);
    expect(mapToX(0, domain, 0, 100)).toBeCloseTo(50);
    expect(mapToX(1, domain, 0, 100)).toBeCloseTo(100);
  });
});

describe('EmEigensolverPlugin parameter handling', () => {
  it('clamps k into [1, 64] and basisDim into [16, 200]', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    plugin.updateParams({ k: 999, basisDim: 1 });
    const p = plugin as unknown as { state: { k: number; basisDim: number } };
    expect(p.state.k).toBe(64);
    expect(p.state.basisDim).toBe(16);
    plugin.updateParams({ k: 0, basisDim: 1e5 });
    expect(p.state.k).toBe(1);
    expect(p.state.basisDim).toBe(200);
  });

  it('rejects unsupported file types in loadData without touching state', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    const file = new File(['x'], 'evil.exe');
    await plugin.loadData(file);
    const p = plugin as unknown as { file: File | null };
    expect(p.file).toBeNull();
  });

  it('accepts .mtx files and switches the source to file mode', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(new File(['%%matrixmarket'], 'a.mtx'));
    const p = plugin as unknown as { file: File | null; state: { source: string } };
    expect(p.file?.name).toBe('a.mtx');
    expect(p.state.source).toBe('file');
  });

  it('exposes parameter definitions with buttons for solve/export', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    const params = plugin.getParams();
    const keys = params.map((d) => d.key);
    expect(keys).toContain('sample');
    expect(keys).toContain('sigma');
    expect(keys).toContain('run');
    expect(keys).toContain('exportNpz');
  });
});
