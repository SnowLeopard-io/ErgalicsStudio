// EM Eigensolver plugin — pure-logic tests (no worker/Pyodide involved).
import { describe, it, expect } from 'vitest';
import { emEigensolverManifest, EmEigensolverPlugin, modeFieldPanels, parseSigma } from '@/plugins/builtin/em-eigensolver/plugin';
import { spectrumDomain, mapToX } from '@/plugins/builtin/em-eigensolver/render';
import { buildDiagReportHtml, fieldColor as reportFieldColor, svgConvergence, svgModeField, svgResiduals, svgSpectrum } from '@/plugins/builtin/em-eigensolver/diag-report';
import { fieldColor, fieldExtremes, fieldPeak, srgbToLinear, surfaceBuffers } from '@/plugins/builtin/em-eigensolver/render3d';
import { findBuiltin } from '@/plugins/builtin';
import type { EmModeField, EmResultPayload, EmSolverConfig } from '@/plugins/builtin/em-eigensolver/types';
import type { ParamDefinition, PluginApi, SelectParam } from '@/types/plugin';

/** Narrow a param definition to the select variant (options/value access). */
const selectParam = (d: ParamDefinition | undefined): SelectParam | undefined =>
  d?.type === 'select' ? d : undefined;

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

/** fakeApi variant that records every notify() payload for assertions. */
function fakeApiWithNotify(notices: unknown[], locale = 'en-US'): PluginApi {
  return {
    ...fakeApi(locale),
    notify: (kind, message) => {
      notices.push(message);
      void kind;
    },
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

describe('fieldColor (3D mode-field ramp)', () => {
  it('clamps out-of-range inputs and is NaN-safe', () => {
    const [r1] = fieldColor(5);
    const [r2] = fieldColor(-5);
    expect(r1).toBeLessThanOrEqual(1);
    expect(r2).toBeGreaterThanOrEqual(0);
    expect(fieldColor(NaN)).toEqual([1, 1, 1]);
  });

  it('is white at zero and distinct at the two extremes', () => {
    const zero = fieldColor(0);
    const pos = fieldColor(1);
    const neg = fieldColor(-1);
    // zero is white (bright, matches the Figure Studio diverging export)
    expect(zero).toEqual([1, 1, 1]);
    // vermilion positive arm vs Okabe-Ito blue negative arm
    expect(pos[0]).toBeGreaterThan(pos[2]);
    expect(neg[2]).toBeGreaterThan(neg[0]);
  });
});

describe('fieldPeak (3D annotation)', () => {
  const field: EmModeField = {
    index: 0,
    eigenvalue: -1.5,
    rows: 3,
    cols: 4,
    values: [
      0, 0.25, -0.5, 1,
      -1, 0.5, 0, 0.75,
      0.25, -0.25, 1, 0,
    ],
    approx: false,
  };

  it('locates the first max-|value| vertex as row/col/value', () => {
    expect(fieldPeak(field)).toEqual({ row: 0, col: 3, value: 1 });
  });

  it('keeps the sign of the extremum (negative peak)', () => {
    expect(fieldPeak({ ...field, values: [0, -0.25, 0, -0.9, 0, 0.5, 0, 0, 0, 0, 0, 0] })).toEqual({
      row: 0,
      col: 3,
      value: -0.9,
    });
  });
});

describe('fieldExtremes (3D dual annotation)', () => {
  const field: EmModeField = {
    index: 0,
    eigenvalue: -1.5,
    rows: 3,
    cols: 4,
    values: [
      0, 0.25, -0.5, 1,
      -1, 0.5, 0, 0.75,
      0.25, -0.25, 1, 0,
    ],
    approx: false,
  };

  it('locates the strongest positive and negative vertices independently', () => {
    expect(fieldExtremes(field)).toEqual({
      pos: { row: 0, col: 3, value: 1 },
      neg: { row: 1, col: 0, value: -1 },
    });
  });

  it('returns null for the missing side on sign-definite fields', () => {
    expect(fieldExtremes({ ...field, values: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] })).toEqual({
      pos: { row: 2, col: 3, value: 11 },
      neg: null,
    });
  });
});

describe('surfaceBuffers (3D mode-field geometry)', () => {
  const field: EmModeField = {
    index: 0,
    eigenvalue: -1.5,
    rows: 3,
    cols: 4,
    values: [
      0, 0.25, -0.5, 1,
      -1, 0.5, 0, 0.75,
      0.25, -0.25, 1, 0,
    ],
    approx: false,
  };

  it('produces rows*cols vertices centred on the XZ plane', () => {
    const { positions, colors, indices } = surfaceBuffers(field, 0.35);
    expect(positions.length).toBe(12 * 3);
    expect(colors.length).toBe(12 * 3);
    // 2 rows of quads x 3 cols of quads, 6 indices each
    expect(indices.length).toBe(2 * 3 * 6);
    // x spans [-(cols-1)/2, +(cols-1)/2] = [-1.5, 1.5]
    const xs = positions.filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(-1.5);
    expect(Math.max(...xs)).toBeCloseTo(1.5);
  });

  it('displaces height along Y by value * heightScale * max(rows, cols)', () => {
    const { positions } = surfaceBuffers(field, 0.5);
    const ys = positions.filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeCloseTo(0.5 * 4); // value 1 scaled
    expect(Math.min(...ys)).toBeCloseTo(-0.5 * 4); // value -1
  });

  it('colors match the field values through fieldColor (sRGB→linear)', () => {
    const { colors } = surfaceBuffers(field, 0.35);
    // vertex 3 carries values[3] = 1 (peak of the positive arm)
    const [r1, g1, b1] = fieldColor(1);
    const [e0, e1, e2] = [srgbToLinear(r1), srgbToLinear(g1), srgbToLinear(b1)];
    expect(colors[3 * 3]).toBeCloseTo(e0);
    expect(colors[3 * 3 + 1]).toBeCloseTo(e1);
    expect(colors[3 * 3 + 2]).toBeCloseTo(e2);
  });
});

describe('EmEigensolverPlugin 3D view state', () => {
  it('accepts view and modeIndex params (select sends strings; invalid values ignored)', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    plugin.updateParams({ view: 'mode3d', modeIndex: '3' });
    const p = plugin as unknown as { state: { view: string; modeIndex: number } };
    expect(p.state.view).toBe('mode3d');
    expect(p.state.modeIndex).toBe(3);
    // invalid selections are ignored (the dropdown only offers valid modes)
    plugin.updateParams({ modeIndex: '0' });
    expect(p.state.modeIndex).toBe(3);
    plugin.updateParams({ modeIndex: 'abc' });
    expect(p.state.modeIndex).toBe(3);
    plugin.updateParams({ view: 'report' });
    expect(p.state.view).toBe('report');
  });

  it('mode selector lists one entry per returned mode with its eigenvalue', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    // Before any solve: a single placeholder entry.
    let params = plugin.getParams();
    let mode = selectParam(params.find((d) => d.key === 'modeIndex'));
    expect(mode?.type).toBe('select');
    expect(mode?.options).toHaveLength(1);
    // After a solve: one option per mode field, labelled with λ.
    (plugin as unknown as { result: unknown }).result = {
      modeFields: [
        { index: 0, eigenvalue: 0.5, rows: 2, cols: 2, values: [1, 0, 0, 1], approx: false },
        { index: 1, eigenvalue: -1.5, rows: 2, cols: 2, values: [1, 0, 0, 1], approx: false },
      ],
    };
    params = plugin.getParams();
    mode = selectParam(params.find((d) => d.key === 'modeIndex'));
    expect(mode?.options?.map((o) => o.value)).toEqual(['1', '2']);
    expect(mode?.options?.[1]?.label).toContain('λ');
    expect(mode?.options?.[1]?.label).toContain('-1.5');
  });

  it('exposes the view selector in getParams', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    const params = plugin.getParams();
    const view = selectParam(params.find((d) => d.key === 'view'));
    expect(view?.type).toBe('select');
    expect(view?.options?.map((o) => o.value)).toEqual(['report', 'mode3d']);
    expect(params.some((d) => d.key === 'modeIndex')).toBe(true);
  });

  it('falls back to the 2D canvas when mode3d is set without fields', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    plugin.updateParams({ view: 'mode3d' });
    // No result, no three handle — draw() must not throw (2D fallback).
    expect(() => plugin.render({} as never)).not.toThrow();
  });

  // Regression: opening a project auto-activates this plugin and restores its
  // persisted `view: mode3d` before CentralArea has mounted the 3D host
  // container. At that point `three` is null but there is NO result yet, so the
  // plugin must silently fall back to the report view instead of surfacing a
  // confusing "3D container not mounted" warning.
  it('does not warn when mode3d view is restored before any result exists', async () => {
    const notices: unknown[] = [];
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApiWithNotify(notices));
    plugin.updateParams({ view: 'mode3d' });
    // Restore path: draw() against a container with no `three` handle. The
    // node test env has no document, so a bare container is used — the
    // "not mounted" decision happens in draw() before any canvas work.
    plugin.render({} as never);
    expect(notices.some((n) => String(n).includes('3D container not mounted'))).toBe(false);
    expect(notices.some((n) => String(n).includes('not mounted'))).toBe(false);
  });

  // And the true failure — a real result present but the 3D surface missing —
  // still surfaces the actionable warning.
  it('still warns when mode3d is set with a result but no 3D surface', async () => {
    const notices: unknown[] = [];
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApiWithNotify(notices));
    plugin.updateParams({ view: 'mode3d' });
    const p = plugin as unknown as { result: unknown };
    p.result = {
      meta: { name: 'x', nnz: 0, shape: [4, 4] },
      modeFields: [{ index: 0, eigenvalue: 0.5, rows: 2, cols: 2, values: [1, 0, 0, 1], approx: false }],
    };
    plugin.render({} as never);
    expect(notices.some((n) => String(n).includes('3D container not mounted'))).toBe(true);
  });
});

describe('EmEigensolverPlugin parameter handling', () => {
  it('numeric params are selects; off-list values ignored, on-list accepted', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    const params = plugin.getParams();
    for (const key of ['k', 'tol', 'basisDim', 'seed']) {
      expect(params.find((d) => d.key === key)?.type).toBe('select');
    }
    const p = plugin as unknown as { state: { k: number; tol: number; basisDim: number; seed: number } };
    // Selects send strings; on-list values apply.
    plugin.updateParams({ k: '16', tol: '1e-10', basisDim: '96', seed: '3' });
    expect(p.state.k).toBe(16);
    expect(p.state.tol).toBe(1e-10);
    expect(p.state.basisDim).toBe(96);
    expect(p.state.seed).toBe(3);
    // Off-list values are ignored (no clamping to the boundary any more).
    plugin.updateParams({ k: '999', tol: '1e-5', basisDim: '17', seed: '42' });
    expect(p.state.k).toBe(16);
    expect(p.state.tol).toBe(1e-10);
    expect(p.state.basisDim).toBe(96);
    expect(p.state.seed).toBe(3);
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
    expect(keys).toContain('matrix');
    expect(keys).toContain('sigma');
    expect(keys).toContain('run');
    expect(keys).toContain('exportNpz');
    // The old two-level source/sample pair is merged into one dropdown.
    expect(keys).not.toContain('source');
    expect(keys).not.toContain('sample');
  });

  it('merged data-source dropdown lists all samples plus the imported file', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    const matrix = selectParam(plugin.getParams().find((d) => d.key === 'matrix'));
    expect(matrix?.type).toBe('select');
    // 1 bundled file entry + EM_SAMPLES entries; no "file" entry until a
    // file is imported — every real entry is "sample:<id>".
    const values = matrix?.options?.map((o) => o.value) ?? [];
    expect(values.filter((v) => v !== 'placeholder').every((v) => v.startsWith('sample:'))).toBe(true);
    // Option values are unique (the select keys options by value): the
    // no-file placeholder must not reuse "sample:cavity_file".
    expect(new Set(values).size).toBe(values.length);
    plugin.updateParams({ matrix: 'sample:cavity_small' });
    const p = plugin as unknown as { state: { source: string; sample: string } };
    expect(p.state.source).toBe('sample');
    expect(p.state.sample).toBe('cavity_small');
    // Unknown sample ids are ignored.
    plugin.updateParams({ matrix: 'sample:nope' });
    expect(p.state.sample).toBe('cavity_small');
    // "file" is only honoured when a file has been imported.
    plugin.updateParams({ matrix: 'file' });
    expect(p.state.source).toBe('sample');
  });

  it('ignores persisted source:"file" after reload (File objects do not survive)', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    // Simulates a project restore: the old session saved source='file', but
    // this session has no File object — the sample path must stay active.
    plugin.updateParams({ source: 'file', sample: 'cavity_file' });
    const p = plugin as unknown as { state: { source: string; sample: string } };
    expect(p.state.source).toBe('sample');
    expect(p.state.sample).toBe('cavity_file');
    // The dropdown never shows an entry that cannot be solved.
    const matrix = selectParam(plugin.getParams().find((d) => d.key === 'matrix'));
    expect(matrix?.value).toBe('sample:cavity_file');
    expect(matrix?.options?.some((o) => o.value === 'file')).toBe(false);
  });
});

describe('modeFieldPanels (Figure Studio export)', () => {
  const field = (index: number, eigenvalue: number): EmModeField => ({
    index,
    eigenvalue,
    rows: 2,
    cols: 2,
    values: [1, 0, 0, -1],
    approx: false,
  });

  it('builds one 3-column panel per mode with spreadsheet tags', () => {
    const panels = modeFieldPanels([field(0, 0.5), field(1, -1.5), field(2, 2.5)]);
    expect(panels.map((p) => p.tag)).toEqual(['a', 'b', 'c']);
    expect(panels.map((p) => `${p.row}:${p.col}`)).toEqual(['0:0', '0:1', '0:2']);
  });

  it('carries a field series with the grid payload and a λ title', () => {
    const [panel] = modeFieldPanels([field(0, 0.5)]);
    const series = panel!.spec.series[0]!;
    expect(series.kind).toBe('field');
    expect(series.field).toEqual({ values: [1, 0, 0, -1], rows: 2, cols: 2, surface: true });
    expect(panel!.spec.title).toContain('Mode 1');
    expect(panel!.spec.title).toContain('λ');
  });

  it('exposes the send-to-figure action button', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    const keys = plugin.getParams().map((d) => d.key);
    expect(keys).toContain('sendToFigure');
  });
});

// ======================= diagnostic report (PRD REQ-G) ========================

const reportConfig: EmSolverConfig = {
  method: 'lanczos', k: 3, sigma: 0, which: 'LM', tol: 1e-8,
  maxCycles: 60, maxIter: 400, basisDim: 48, seed: 0, denseThreshold: 800,
};

function reportResult(overrides: Partial<EmResultPayload> = {}): EmResultPayload {
  return {
    eigenvalues: [1.5, 0.5, -0.75],
    residuals: [1e-12, 3e-10, 5e-9],
    converged: true,
    iterations: 4,
    matvecs: 120,
    method: 'lanczos',
    backend: 'numpy',
    diagnostics: {},
    meta: {
      name: '<script>alert(1)</script>cavity',
      description: 'A & B "quoted"',
      shape: [64, 64],
      nnz: 320,
      complex: false,
    },
    modeFields: [
      { index: 0, eigenvalue: 1.5, rows: 2, cols: 2, values: [1, 0, 0, -1], approx: false },
    ],
    ...overrides,
  };
}

describe('diagnostic report builder (REQ-G)', () => {
  it('embeds all sections as inline SVG without any <script> tag', () => {
    const html = buildDiagReportHtml({
      result: reportResult(),
      config: reportConfig,
      history: [{ cycle: 1, residuals: [1e-2], matvecs: 30 }, { cycle: 2, residuals: [1e-6], matvecs: 60 }],
    });
    expect(html).toContain('<svg');
    expect(html).toContain('Spectrum');
    expect(html).toContain('Relative residuals');
    expect(html).toContain('Outer convergence');
    expect(html).toContain('Mode fields');
    // self-contained and script-free by construction
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<link');
    expect(html).not.toContain('https://');
  });

  it('escapes adversarial matrix names and descriptions', () => {
    const html = buildDiagReportHtml({ result: reportResult(), config: reportConfig });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;cavity');
    expect(html).toContain('A &amp; B &quot;quoted&quot;');
  });

  it('renders Chinese labels for zh-CN and omits the trace when empty', () => {
    const html = buildDiagReportHtml({
      result: reportResult(), config: reportConfig, history: [], locale: 'zh-CN',
    });
    expect(html).toContain('诊断报告');
    expect(html).toContain('求解参数');
    expect(html).toContain('本次会话无进度轨迹');
    expect(svgConvergence([])).toBe('');
    expect(svgResiduals([], 1e-8)).toBe('');
  });

  it('draws one dot per eigenvalue and colours field extremes blue/red', () => {
    const spectrum = svgSpectrum([1, -1, 0.5], 0);
    expect(spectrum.match(/<circle/g)?.length).toBe(3);
    expect(spectrum).toContain('σ=');
    const field = reportResult().modeFields![0]!;
    expect(svgModeField(field).match(/<rect/g)?.length).toBeGreaterThan(2);
    // diverging colormap: positive → red channel dominant, negative → blue
    expect(reportFieldColor(1)).toBe('rgb(255,42,57)');
    expect(reportFieldColor(-1)).toBe('rgb(61,114,255)');
    expect(reportFieldColor(0)).toBe('rgb(255,255,255)');
  });

  it('exposes the two export action buttons', async () => {
    const plugin = new EmEigensolverPlugin();
    await plugin.init(fakeApi());
    const keys = plugin.getParams().map((d) => d.key);
    expect(keys).toContain('exportReport');
    expect(keys).toContain('exportRepro');
  });
});
