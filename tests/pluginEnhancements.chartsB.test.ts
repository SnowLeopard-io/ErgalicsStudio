// ==========================================================================
// Tests for the chart-plugin enhancements (chartsB set):
//   - export architecture: plugin-level PNG snapshot export was REMOVED from
//     every plugin — the canvas-level unified export menu (CentralArea) owns
//     PNG now. Among chart plugins, CSV export survives only on the
//     computed-stat violin plot; the passthrough charts (bar, bubble,
//     network, parallel coordinates, polar, sankey, treemap) declare no
//     export buttons at all.
//   - bar chart gains a Sort select; violin gains Show Points jitter
//
// Node environment: no real canvas — a recording canvas whose 2-D context
// logs every arc() call stands in, exactly like pluginBugfixes.test.ts.
// ==========================================================================

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ViolinPlotPlugin } from '@/plugins/builtin/charts/violinPlot/plugin';
import { ParallelCoordinatesPlugin } from '@/plugins/builtin/charts/parallelCoordinates/plugin';
import { SankeyPlugin } from '@/plugins/builtin/charts/sankey/plugin';
import { TreemapPlugin } from '@/plugins/builtin/charts/treemap/plugin';
import { NetworkGraphPlugin } from '@/plugins/builtin/charts/networkGraph/plugin';
import { BarChartPlugin } from '@/plugins/builtin/charts/barChart/plugin';
import { BubbleChartPlugin } from '@/plugins/builtin/charts/bubbleChart/plugin';
import { PolarPlotPlugin } from '@/plugins/builtin/charts/polarPlot/plugin';
import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
} from '@/types/plugin';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

// Canvas-drawing plugins call getComputedStyle(canvas) on the drawn element,
// which node lacks; some plugins also schedule rAF frames.
beforeAll(() => {
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 1;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => undefined;
  (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({ backgroundColor: '' });
});

function fakeApi() {
  const exportFile = vi.fn();
  const notify = vi.fn();
  const api: PluginApi = {
    locale: 'en-US',
    t: (k: string) => k,
    onLocaleChange: () => () => {},
    setStatus: () => {},
    reportGpuTime: () => {},
    reportDataScale: () => {},
    notify,
    log: () => {},
    exportFile,
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
  return { api, exportFile, notify };
}

/** Canvas whose 2-D context records every arc() call for point-draw checks. */
function recordingCanvas() {
  const arcs: unknown[][] = [];
  const store: Record<string, unknown> = {
    arc: (...args: unknown[]) => arcs.push(args),
  };
  const ctx = new Proxy(store, {
    get: (t, prop) => (prop in t ? t[prop as string] : () => {}),
    set: (t, prop, value) => {
      t[prop as string] = value;
      return true;
    },
  });
  const canvas = {
    clientWidth: 400,
    clientHeight: 300,
    width: 0,
    height: 0,
    toDataURL: () => PNG_DATA_URL,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return { canvas, arcs };
}

function buttonDef(defs: ParamDefinition[], key: string): ParamDefinition {
  const def = defs.find((d) => d.key === key);
  if (!def) throw new Error(`missing param ${key}`);
  return def;
}

async function csvText(exportFile: ReturnType<typeof vi.fn>, callIndex = -1): Promise<string> {
  const calls = exportFile.mock.calls;
  const call = calls[callIndex < 0 ? calls.length - 1 : callIndex]!;
  const text = await (call[1] as Blob).text();
  return text.replace(/^\uFEFF/, '');
}

async function startWith(plugin: Plugin, api: PluginApi, file: File, canvas?: HTMLCanvasElement) {
  await plugin.init(api);
  if (canvas) {
    await plugin.activate?.({
      container: { canvas2d: canvas } as unknown as ContainerCapabilities,
    } as Parameters<NonNullable<Plugin['activate']>>[0]);
  }
  await plugin.loadData?.(file);
}

// ---- cases ------------------------------------------------------------------
//
// violin is a computed-stat plugin and keeps its exportCsv button; every
// other chart here is a passthrough renderer with no plugin-level export
// buttons — the CentralArea canvas menu owns exports for these.

interface PassthroughCaseDef {
  id: string;
  make: () => Plugin;
}

const PASSTHROUGH_CASES: PassthroughCaseDef[] = [
  { id: 'bar', make: () => new BarChartPlugin() },
  { id: 'bubble', make: () => new BubbleChartPlugin() },
  { id: 'network', make: () => new NetworkGraphPlugin() },
  { id: 'parallel', make: () => new ParallelCoordinatesPlugin() },
  { id: 'polar', make: () => new PolarPlotPlugin() },
  { id: 'sankey', make: () => new SankeyPlugin() },
  { id: 'treemap', make: () => new TreemapPlugin() },
];

const BAR_SAMPLE = () => new File(['x,3\ny,1\nz,2\n'], 'bar.csv');
const VIOLIN_SAMPLE = () => new File(['A,1\nA,2\nA,3\nA,4\nB,10\nB,20\n'], 'violin.csv');

// ---- a) the computed-stat plugin keeps a CSV export button ------------------

describe('violin CSV export (computed-stat plugin)', () => {
  it('declares exactly an exportCsv button and no PNG export', async () => {
    const { api } = fakeApi();
    const plugin = new ViolinPlotPlugin();
    await plugin.init(api);
    const defs = await Promise.resolve(plugin.getParams());
    const csv = buttonDef(defs, 'exportCsv');
    expect(csv.type).toBe('button');
    if (csv.type !== 'button') throw new Error('exportCsv is not a button');
    expect(csv.action).toBe('exportCsv');
    expect(csv.labelI18n?.['en-US']).toBeTruthy();
    expect(csv.labelI18n?.['zh-CN']).toBeTruthy();
    // PNG snapshot export moved to the canvas-level menu in CentralArea.
    expect(defs.filter((d) => d.key.startsWith('export')).map((d) => d.key)).toEqual(['exportCsv']);
  });

  it('exports name,min,q1,median,q3,max,n per group after loadData', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new ViolinPlotPlugin();
    await startWith(plugin, api, VIOLIN_SAMPLE());
    plugin.updateParams!({ exportCsv: true });
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(exportFile.mock.calls[0]![0]).toMatch(/\.csv$/);
    const text = await csvText(exportFile);
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('name,min,q1,median,q3,max,n');
    expect(lines).toContain('A,1,2,3,4,4,4');
    expect(lines).toContain('B,10,10,20,20,20,2');
  });

  it('refuses CSV export (no exportFile call) before data is loaded', async () => {
    const { api, exportFile, notify } = fakeApi();
    const plugin = new ViolinPlotPlugin();
    await plugin.init(api);
    plugin.updateParams!({ exportCsv: true });
    expect(exportFile).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('warning', expect.any(String));
  });

  it('host-style button payload { exportCsv: { action } } also works', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new ViolinPlotPlugin();
    await startWith(plugin, api, VIOLIN_SAMPLE());
    plugin.updateParams!({ exportCsv: { action: 'exportCsv' } });
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(exportFile.mock.calls[0]![0]).toMatch(/\.csv$/);
  });
});

// ---- b) passthrough charts declare no export buttons ------------------------

describe.each(PASSTHROUGH_CASES)('$id export buttons', (c) => {
  it('declares no export buttons at all and ignores export payloads', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = c.make();
    await plugin.init(api);
    const defs = await Promise.resolve(plugin.getParams());
    expect(defs.filter((d) => d.key.startsWith('export'))).toEqual([]);
    // A stray payload for a removed button must be a silent no-op.
    expect(() => plugin.updateParams!({ exportCsv: true })).not.toThrow();
    expect(() => plugin.updateParams!({ exportPng: true })).not.toThrow();
    expect(exportFile).not.toHaveBeenCalled();
  });
});

// ---- bar chart Sort select -------------------------------------------------

describe('bar chart sort select', () => {
  it('defaults to none and updates state + param value on change', async () => {
    const { api } = fakeApi();
    const plugin = new BarChartPlugin();
    await startWith(plugin, api, BAR_SAMPLE());

    const initial = buttonOrSelect(plugin.getParams(), 'order');
    expect(initial.type).toBe('select');
    expect(initial.value).toBe('none');
    expect(initial.options.map((o) => o.value)).toEqual(['none', 'asc', 'desc']);
    for (const o of initial.options) {
      expect(o.labelI18n?.['en-US']).toBeTruthy();
      expect(o.labelI18n?.['zh-CN']).toBeTruthy();
    }

    plugin.updateParams!({ order: 'asc' });
    const state = (plugin as unknown as { state: { order: string } }).state;
    expect(state.order).toBe('asc');
    expect(buttonOrSelect(plugin.getParams(), 'order').value).toBe('asc');

    plugin.updateParams!({ order: 'desc' });
    expect(state.order).toBe('desc');

    plugin.updateParams!({ order: 'none' });
    expect(state.order).toBe('none');

    // Unknown values are ignored.
    plugin.updateParams!({ order: 'sideways' });
    expect(state.order).toBe('none');
  });

  function buttonOrSelect(defs: ParamDefinition[], key: string) {
    const def = buttonDef(defs, key);
    if (def.type !== 'select') throw new Error(`${key} is not a select`);
    return def;
  }
});

// ---- violin Show Points ----------------------------------------------------

describe('violin show points', () => {
  it('defaults to false, toggles state, and draws deterministic jitter', async () => {
    const { api } = fakeApi();
    const before = buttonOrCheckbox(new ViolinPlotPlugin().getParams(), 'showPoints');
    expect(before.type).toBe('checkbox');
    expect(before.value).toBe(false);
    expect(before.labelI18n).toEqual({ 'zh-CN': '显示数据点', 'en-US': 'Show Points' });

    const rec1 = recordingCanvas();
    const plugin = new ViolinPlotPlugin();
    await startWith(plugin, api, VIOLIN_SAMPLE(), rec1.canvas);

    // Toggling on draws points (arc is only used by the point layer here).
    plugin.updateParams!({ showPoints: true });
    expect((plugin as unknown as { state: { showPoints: boolean } }).state.showPoints).toBe(true);
    const firstPass = rec1.arcs.map((a) => a.slice(0, 3));
    expect(firstPass).toHaveLength(6); // 4 values in A + 2 in B

    // A redraw triggered by an unrelated param (box overlay off) must keep
    // every point in exactly the same place — the jitter is a deterministic
    // hash, not Math.random().
    plugin.updateParams!({ showBox: false });
    const secondPass = rec1.arcs.slice(firstPass.length).map((a) => a.slice(0, 3));
    expect(secondPass).toEqual(firstPass);

    // Toggling off removes the point layer without errors.
    plugin.updateParams!({ showPoints: false });
    const state = (plugin as unknown as { state: { showPoints: boolean } }).state;
    expect(state.showPoints).toBe(false);
  });

  it('toggling before any data is loaded does not throw', async () => {
    const { api } = fakeApi();
    const plugin = new ViolinPlotPlugin();
    await plugin.init(api);
    expect(() => plugin.updateParams!({ showPoints: true })).not.toThrow();
    expect(() => plugin.updateParams!({ showPoints: false })).not.toThrow();
  });

  function buttonOrCheckbox(defs: ParamDefinition[], key: string) {
    const def = buttonDef(defs, key);
    if (def.type !== 'checkbox') throw new Error(`${key} is not a checkbox`);
    return def;
  }
});
