// ==========================================================================
// Tests for the chart-plugin enhancements (chartsB set):
//   - every plugin exposes Export PNG / Export CSV button params
//   - CSV export mirrors the plugin's underlying parsed data
//   - PNG export snapshots the host canvas
//   - buttons no-op (with a warning) before any data is loaded
//   - bar chart gains a Sort select; violin gains Show Points jitter
//
// Node environment: no real canvas — a proxy 2-D context and a fake canvas
// with toDataURL() stand in, exactly like pluginBugfixes.test.ts.
// ==========================================================================

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { ViolinPlotPlugin } from '@/plugins/builtin/violinPlot';
import { ParallelCoordinatesPlugin } from '@/plugins/builtin/parallelCoordinates';
import { SankeyPlugin } from '@/plugins/builtin/sankey';
import { TreemapPlugin } from '@/plugins/builtin/treemap';
import { NetworkGraphPlugin } from '@/plugins/builtin/networkGraph';
import { BarChartPlugin } from '@/plugins/builtin/barChart';
import { BubbleChartPlugin } from '@/plugins/builtin/bubbleChart';
import { PolarPlotPlugin } from '@/plugins/builtin/polarPlot';
import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
} from '@/types/plugin';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

// The network plugin schedules rAF frames; node has none. Draw paths call
// getComputedStyle(canvas), which node lacks as well.
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

/** Canvas 2-D context that absorbs every call/assignment (no real canvas). */
function fakeContext(): CanvasRenderingContext2D {
  const store: Record<string, unknown> = {};
  return new Proxy(store, {
    get: (t, prop) => (prop in t ? t[prop as string] : () => {}),
    set: (t, prop, value) => {
      t[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function fakeCanvas(): HTMLCanvasElement {
  return {
    clientWidth: 400,
    clientHeight: 300,
    width: 0,
    height: 0,
    toDataURL: () => PNG_DATA_URL,
    getContext: () => fakeContext(),
  } as unknown as HTMLCanvasElement;
}

/** Like fakeCanvas, but every arc() call is recorded for point-draw checks. */
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

interface CaseDef {
  id: string;
  make: () => Plugin;
  sample: () => File;
}

const cases: CaseDef[] = [
  {
    id: 'violin',
    make: () => new ViolinPlotPlugin(),
    sample: () => new File(['A,1\nA,2\nA,3\nA,4\nB,10\nB,20\n'], 'violin.csv'),
  },
  {
    id: 'parallel',
    make: () => new ParallelCoordinatesPlugin(),
    sample: () => new File(['a,b,c\n1,2,3\n4,5,6\n'], 'parallel.csv'),
  },
  {
    id: 'sankey',
    make: () => new SankeyPlugin(),
    sample: () =>
      new File(
        [
          JSON.stringify({
            nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
            links: [
              { source: 'a', target: 'b', value: 3 },
              { source: 'b', target: 'c', value: 5 },
            ],
          }),
        ],
        'sankey.json',
      ),
  },
  {
    id: 'treemap',
    make: () => new TreemapPlugin(),
    sample: () => new File(['alpha,10\nbeta,20\ngamma,30\n'], 'treemap.csv'),
  },
  {
    id: 'network',
    make: () => new NetworkGraphPlugin(),
    sample: () =>
      new File(
        [
          JSON.stringify({
            nodes: [{ id: 'a' }, { id: 'b' }],
            links: [{ source: 'a', target: 'b', weight: 2 }],
          }),
        ],
        'network.json',
      ),
  },
  {
    id: 'bar',
    make: () => new BarChartPlugin(),
    sample: () => new File(['x,3\ny,1\nz,2\n'], 'bar.csv'),
  },
  {
    id: 'bubble',
    make: () => new BubbleChartPlugin(),
    sample: () => new File(['1,2,3,0.5\n4,5,6,0.8\n'], 'bubble.csv'),
  },
  {
    id: 'polar',
    make: () => new PolarPlotPlugin(),
    sample: () => new File(['name,d1,d2,d3\ns1,1,2,3\ns2,4,5,6\n'], 'polar.csv'),
  },
];

// ---- a) both export buttons are declared ----------------------------------

describe('chart plugins declare export buttons', () => {
  for (const c of cases) {
    it(`${c.id}: getParams contains exportPng + exportCsv with zh/en labels`, async () => {
      const plugin = c.make();
      await plugin.init(fakeApi().api);
      const defs = await Promise.resolve(plugin.getParams());
      for (const key of ['exportPng', 'exportCsv']) {
        const def = buttonDef(defs, key);
        expect(def.type).toBe('button');
        if (def.type !== 'button') throw new Error(`${key} is not a button`);
        expect(def.action).toBe(key);
        expect(def.labelI18n?.['en-US']).toBeTruthy();
        expect(def.labelI18n?.['zh-CN']).toBeTruthy();
      }
      // PNG first, CSV second is the declared convention.
      expect(defs.map((d) => d.key).indexOf('exportPng')).toBeLessThan(
        defs.map((d) => d.key).indexOf('exportCsv'),
      );
    });
  }
});

// ---- b) CSV export after loadData -----------------------------------------

describe('chart plugins export CSV from loaded data', () => {
  it('violin: name,min,q1,median,q3,max,n per group', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new ViolinPlotPlugin();
    await startWith(plugin, api, cases[0]!.sample!());
    plugin.updateParams!({ exportCsv: true });
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(exportFile.mock.calls[0]![0]).toMatch(/\.csv$/);
    const text = await csvText(exportFile);
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('name,min,q1,median,q3,max,n');
    expect(lines).toContain('A,1,2,3,4,4,4');
    expect(lines).toContain('B,10,10,20,20,20,2');
  });

  it('parallel: one row per record, axis names as header', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new ParallelCoordinatesPlugin();
    await startWith(plugin, api, cases[1]!.sample!());
    plugin.updateParams!({ exportCsv: true });
    expect(exportFile.mock.calls[0]![0]).toMatch(/\.csv$/);
    const text = await csvText(exportFile);
    expect(text).toBe('a,b,c\r\n1,2,3\r\n4,5,6');
  });

  it('sankey: source,target,value from links', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new SankeyPlugin();
    await startWith(plugin, api, cases[2]!.sample!());
    plugin.updateParams!({ exportCsv: true });
    const text = await csvText(exportFile);
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('source,target,value');
    expect(lines).toContain('a,b,3');
    expect(lines).toContain('b,c,5');
  });

  it('treemap: name,parent,size traversal without the synthetic root', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new TreemapPlugin();
    await startWith(plugin, api, cases[3]!.sample!());
    plugin.updateParams!({ exportCsv: true });
    const text = await csvText(exportFile);
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('name,parent,size');
    expect(lines).toContain('alpha,,10');
    expect(lines).toContain('beta,,20');
    expect(lines).toContain('gamma,,30');
    expect(lines.some((l) => l.startsWith('root'))).toBe(false);
  });

  it('treemap: hierarchical rows carry the parent name', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new TreemapPlugin();
    await startWith(plugin, api, new File(['child,parent,5\nparent,,10\n'], 'tree.csv'));
    plugin.updateParams!({ exportCsv: true });
    const text = await csvText(exportFile);
    const lines = text.split('\r\n');
    expect(lines).toContain('parent,,10');
    expect(lines).toContain('child,parent,5');
    expect(lines.some((l) => l.startsWith('root'))).toBe(false);
  });

  it('network: weighted edges get a weight column', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new NetworkGraphPlugin();
    await startWith(plugin, api, cases[4]!.sample!());
    plugin.updateParams!({ exportCsv: true });
    const text = await csvText(exportFile);
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('source,target,weight');
    expect(lines).toContain('a,b,2');
  });

  it('network: unweighted edges export only source,target', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new NetworkGraphPlugin();
    await startWith(plugin, api, new File(['a,b\nb,c\n'], 'edges.csv'));
    plugin.updateParams!({ exportCsv: true });
    const text = await csvText(exportFile);
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('source,target');
    expect(lines).toContain('a,b');
    expect(lines.some((l) => l.split(',').length > 2)).toBe(false);
  });

  it('bar: category,value in import order, then sorted order', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new BarChartPlugin();
    await startWith(plugin, api, cases[5]!.sample!());
    plugin.updateParams!({ exportCsv: true });
    expect(await csvText(exportFile, 0)).toBe('category,value\r\nx,3\r\ny,1\r\nz,2');

    plugin.updateParams!({ order: 'asc' });
    plugin.updateParams!({ exportCsv: true });
    expect(await csvText(exportFile, 1)).toBe('category,value\r\ny,1\r\nz,2\r\nx,3');

    plugin.updateParams!({ order: 'desc' });
    plugin.updateParams!({ exportCsv: true });
    expect(await csvText(exportFile, 2)).toBe('category,value\r\nx,3\r\nz,2\r\ny,1');
  });

  it('bubble: x,y,size plus a numeric color column', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new BubbleChartPlugin();
    await startWith(plugin, api, cases[6]!.sample!());
    plugin.updateParams!({ exportCsv: true });
    const text = await csvText(exportFile);
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('x,y,size,color');
    expect(lines).toContain('1,2,3,0.5');
    expect(lines).toContain('4,5,6,0.8');
  });

  it('bubble: a non-numeric 4th column is exported as group', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new BubbleChartPlugin();
    await startWith(plugin, api, new File(['1,2,3,red\n4,5,6,blue\n'], 'groups.csv'));
    plugin.updateParams!({ exportCsv: true });
    const text = await csvText(exportFile);
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('x,y,size,group');
    expect(lines).toContain('1,2,3,red');
    expect(lines).toContain('4,5,6,blue');
  });

  it('polar: flattened angle,radius pairs for every series vertex', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new PolarPlotPlugin();
    await startWith(plugin, api, cases[7]!.sample!());
    plugin.updateParams!({ exportCsv: true });
    const text = await csvText(exportFile);
    const lines = text.split('\r\n');
    expect(lines[0]).toBe('angle,radius');
    // 2 series x 3 axes = 6 pairs; the first axis starts at -PI/2.
    expect(lines).toHaveLength(7);
    expect(lines[1]).toBe(`${-Math.PI / 2},1`);
  });

  it('host-style button payload { exportCsv: { action } } also works', async () => {
    const { api, exportFile } = fakeApi();
    const plugin = new BarChartPlugin();
    await startWith(plugin, api, cases[5]!.sample!());
    plugin.updateParams!({ exportCsv: { action: 'exportCsv' } });
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(exportFile.mock.calls[0]![0]).toMatch(/\.csv$/);
  });
});

// ---- PNG export after loadData --------------------------------------------

describe('chart plugins export PNG from the live canvas', () => {
  for (const c of cases) {
    it(`${c.id}: snapshots canvas2d as <name>.png`, async () => {
      const { api, exportFile } = fakeApi();
      const plugin = c.make();
      await startWith(plugin, api, c.sample(), fakeCanvas());
      plugin.updateParams!({ exportPng: true });
      expect(exportFile).toHaveBeenCalledTimes(1);
      const [name, blob, mime] = exportFile.mock.calls[0]!;
      expect(name).toMatch(/\.png$/);
      expect(mime).toBe('image/png');
      expect(blob).toBeInstanceOf(Blob);
      await plugin.destroy?.();
    });
  }

  it('refuses with a warning when there is no canvas yet', async () => {
    for (const c of cases) {
      const { api, exportFile, notify } = fakeApi();
      const plugin = c.make();
      await startWith(plugin, api, c.sample()); // no activate() -> no canvas
      plugin.updateParams!({ exportPng: true });
      expect(exportFile).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalledWith('warning', expect.any(String));
      await plugin.destroy?.();
    }
  });
});

// ---- no data: exports must not fire ---------------------------------------

describe('chart plugins do not export before data is loaded', () => {
  for (const c of cases) {
    it(`${c.id}: exportCsv/exportPng produce no file`, () => {
      const { api, exportFile, notify } = fakeApi();
      const plugin = c.make();
      // init() alone — no loadData, no activate.
      void plugin.init(api);
      plugin.updateParams!({ exportCsv: true });
      plugin.updateParams!({ exportPng: true });
      expect(exportFile).not.toHaveBeenCalled();
      expect(notify).toHaveBeenCalled();
    });
  }
});

// ---- bar chart Sort select -------------------------------------------------

describe('bar chart sort select', () => {
  it('defaults to none and updates state + param value on change', async () => {
    const { api } = fakeApi();
    const plugin = new BarChartPlugin();
    await startWith(plugin, api, cases[5]!.sample!());

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
    await startWith(plugin, api, cases[0]!.sample!(), rec1.canvas);

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
