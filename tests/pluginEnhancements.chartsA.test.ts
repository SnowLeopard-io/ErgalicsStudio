// ==========================================================================
// Tests for the chart-plugin enhancements (batch A):
//   - Export architecture: plugin-level PNG snapshot export was REMOVED from
//     every plugin — a canvas-level unified export menu (CentralArea) owns
//     PNG now. Among chart plugins, CSV export survives only on the
//     computed-stat plugins (histogram, box plot, QQ plot); the passthrough
//     charts (scatter, time series, heatmap, contour, error band) declare no
//     export buttons at all.
//   - CSV export of the plugin's computed data (and no-op when empty)
//   - New analytical toggles: scatter trend line, time-series rolling mean,
//     histogram cumulative/density, box-plot mean marker
// ==========================================================================

import { describe, it, expect, vi } from 'vitest';
import { ScatterPlugin } from '@/plugins/builtin/charts/scatter/plugin';
import { TimeSeriesPlugin } from '@/plugins/builtin/charts/timeSeries/plugin';
import { HistogramPlugin } from '@/plugins/builtin/charts/histogram/plugin';
import { BoxPlotPlugin } from '@/plugins/builtin/charts/boxPlot/plugin';
import { HeatmapPlugin } from '@/plugins/builtin/charts/heatmap/plugin';
import { ContourPlugin } from '@/plugins/builtin/charts/contour/plugin';
import { ErrorBandPlugin } from '@/plugins/builtin/charts/errorband/plugin';
import { QQPlotPlugin } from '@/plugins/builtin/charts/qqplot/plugin';
import type { ParamDefinition, Plugin, PluginApi } from '@/types/plugin';

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

function buttonDefs(defs: ParamDefinition[]) {
  return defs.filter((d): d is Extract<ParamDefinition, { type: 'button' }> => d.type === 'button');
}

async function make<T extends Plugin>(
  PluginCtor: new () => T,
  file: File | null,
) {
  const { api, exportFile, notify } = fakeApi();
  const plugin = new PluginCtor();
  await plugin.init(api);
  if (file) await plugin.loadData?.(file);
  return { plugin, exportFile, notify };
}

const CSV = (name: string, text: string) => new File([text], name);

// ---- export buttons ---------------------------------------------------------
//
// PNG snapshot export is owned by the canvas-level menu in CentralArea, so no
// plugin declares an exportPng button any more. Only the computed-stat chart
// plugins keep a plugin-level exportCsv button.

interface ComputedCaseDef {
  name: string;
  base: string;
  header: string;
  Ctor: new () => any;
  file: File;
}

interface PassthroughCaseDef {
  name: string;
  Ctor: new () => any;
}

const COMPUTED_CASES: ComputedCaseDef[] = [
  {
    name: 'histogram',
    base: 'histogram',
    header: 'binStart,binEnd,count',
    Ctor: HistogramPlugin,
    file: CSV('vals.csv', '1\n2\n3\n4\n5\n6\n7\n8\n'),
  },
  {
    name: 'boxPlot',
    base: 'box-plot',
    header: 'name,min,q1,median,q3,max,n',
    Ctor: BoxPlotPlugin,
    file: CSV('groups.csv', 'A,1\nA,2\nA,3\nB,10\nB,11\nB,12\n'),
  },
  {
    name: 'qqplot',
    base: 'qq-plot',
    header: 'theoretical,sample',
    Ctor: QQPlotPlugin,
    file: CSV('sample.csv', '1\n2\n3\n4\n5\n6\n7\n8\n'),
  },
];

const PASSTHROUGH_CASES: PassthroughCaseDef[] = [
  { name: 'scatter', Ctor: ScatterPlugin },
  { name: 'timeSeries', Ctor: TimeSeriesPlugin },
  { name: 'heatmap', Ctor: HeatmapPlugin },
  { name: 'contour', Ctor: ContourPlugin },
  { name: 'errorband', Ctor: ErrorBandPlugin },
];

describe.each(COMPUTED_CASES)('$name CSV export', (c) => {
  it('declares exactly an exportCsv button and no PNG export', async () => {
    const { plugin } = await make(c.Ctor, null);
    const defs = plugin.getParams();
    const csv = buttonDefs(defs).find((b) => b.key === 'exportCsv');
    expect(csv).toBeDefined();
    expect(csv!.action).toBe('exportCsv');
    expect(csv!.labelI18n?.['zh-CN']).toBeTruthy();
    expect(csv!.labelI18n?.['en-US']).toBeTruthy();
    // PNG snapshot export moved to the canvas-level menu in CentralArea.
    expect(defs.some((d: ParamDefinition) => d.key === 'exportPng')).toBe(false);
    expect(defs.filter((d: ParamDefinition) => d.key.startsWith('export')).map((d: ParamDefinition) => d.key)).toEqual(['exportCsv']);
  });

  it('exports CSV with a .csv file name after data is loaded', async () => {
    const { plugin, exportFile } = await make(c.Ctor, c.file);
    plugin.updateParams({ exportCsv: true });
    expect(exportFile).toHaveBeenCalledTimes(1);
    const fileName = exportFile.mock.calls[0]![0] as string;
    expect(fileName.endsWith('.csv')).toBe(true);
    expect(fileName.startsWith(c.base)).toBe(true);

    const blob = exportFile.mock.calls[0]![1] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    const text = await blob.text();
    const firstLine = text.replace(/^\uFEFF/, '').split('\r\n')[0]!;
    expect(firstLine).toBe(c.header);
  });

  it('refuses CSV export (no exportFile call) before data is loaded', async () => {
    const { plugin, exportFile, notify } = await make(c.Ctor, null);
    plugin.updateParams({ exportCsv: true });
    expect(exportFile).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('warning', expect.any(String));
  });

  it('accepts the real host button payload {key:{action:key}}', async () => {
    const { plugin, exportFile } = await make(c.Ctor, c.file);
    // ParamPanel emits onChange(key, { action: key }) — not `{ key: true }`.
    plugin.updateParams({ exportCsv: { action: 'exportCsv' } });
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(String(exportFile.mock.calls[0]![0]).endsWith('.csv')).toBe(true);
  });
});

describe.each(PASSTHROUGH_CASES)('$name export buttons', (c) => {
  it('declares no export buttons at all and ignores export payloads', async () => {
    const { plugin, exportFile } = await make(c.Ctor, null);
    const exportKeys = plugin.getParams().filter((d: ParamDefinition) => d.key.startsWith('export'));
    expect(exportKeys).toEqual([]);
    // The unified canvas export menu (CentralArea) owns PNG/CSV for these
    // charts; a stray payload for a removed button must be a silent no-op.
    expect(() => plugin.updateParams({ exportCsv: true })).not.toThrow();
    expect(() => plugin.updateParams({ exportPng: true })).not.toThrow();
    expect(exportFile).not.toHaveBeenCalled();
  });
});

// ---- scatter: trend line ---------------------------------------------------

describe('scatter trend line', () => {
  async function loaded() {
    return make(
      ScatterPlugin,
      CSV('points.dat', '0 1\n1 2\n2 3\n3 5\n4 4\n'),
    );
  }

  it('toggles the showTrendline state from its checkbox', async () => {
    const { plugin } = await loaded();
    const checkbox = () =>
      plugin.getParams().find((d) => d.key === 'showTrendline') as Extract<
        ParamDefinition,
        { type: 'checkbox' }
      >;
    expect(checkbox().value).toBe(false);

    expect(() => plugin.updateParams({ showTrendline: true })).not.toThrow();
    expect(checkbox().value).toBe(true);
    const state = (plugin as unknown as { state: { showTrendline: boolean } }).state;
    expect(state.showTrendline).toBe(true);

    plugin.updateParams({ showTrendline: false });
    expect(checkbox().value).toBe(false);
  });
});

// ---- time series: rolling mean ---------------------------------------------

describe('time series rolling mean', () => {
  it('clamps the rollWindow param to [0, 40] and defaults to 0', async () => {
    const { plugin } = await make(
      TimeSeriesPlugin,
      CSV('s.csv', 'a\n1\n2\n3\n4\n5\n'),
    );
    const range = () =>
      plugin.getParams().find((d) => d.key === 'rollWindow') as Extract<
        ParamDefinition,
        { type: 'range' }
      >;
    expect(range().value).toBe(0);
    plugin.updateParams({ rollWindow: 3 });
    expect(range().value).toBe(3);
    plugin.updateParams({ rollWindow: 999 });
    expect(range().value).toBe(40);
    plugin.updateParams({ rollWindow: -5 });
    expect(range().value).toBe(0);
  });
});

// ---- histogram: cumulative / density ---------------------------------------

describe('histogram cumulative and density', () => {
  async function loaded() {
    return make(HistogramPlugin, CSV('v.csv', Array.from({ length: 20 }, (_, i) => `${i}`).join('\n')));
  }

  it('toggles the cumulative checkbox', async () => {
    const { plugin } = await loaded();
    const cumulative = () =>
      plugin.getParams().find((d) => d.key === 'cumulative') as Extract<
        ParamDefinition,
        { type: 'checkbox' }
      >;
    expect(cumulative().value).toBe(false);
    plugin.updateParams({ cumulative: true });
    expect(cumulative().value).toBe(true);
  });

  it('appends a density column to CSV only in density mode', async () => {
    const { plugin, exportFile } = await loaded();

    plugin.updateParams({ exportCsv: true });
    let text = await (exportFile.mock.calls.at(-1)![1] as Blob).text();
    expect(text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe('binStart,binEnd,count');

    plugin.updateParams({ density: true, exportCsv: true });
    text = await (exportFile.mock.calls.at(-1)![1] as Blob).text();
    expect(text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe('binStart,binEnd,count,density');
  });
});

// ---- box plot: mean marker --------------------------------------------------

describe('box plot show mean', () => {
  it('toggles the showMean checkbox', async () => {
    const { plugin } = await make(
      BoxPlotPlugin,
      CSV('g.csv', 'A,1\nA,2\nA,3\nB,10\nB,11\nB,12\n'),
    );
    const showMean = () =>
      plugin.getParams().find((d) => d.key === 'showMean') as Extract<
        ParamDefinition,
        { type: 'checkbox' }
      >;
    expect(showMean().value).toBe(false);
    plugin.updateParams({ showMean: true });
    expect(showMean().value).toBe(true);
  });

  it('exports one CSV row per group including n', async () => {
    const { plugin, exportFile } = await make(
      BoxPlotPlugin,
      CSV('g.csv', 'A,1\nA,2\nA,3\nB,10\nB,11\nB,12\n'),
    );
    plugin.updateParams({ exportCsv: true });
    const text = await (exportFile.mock.calls[0]![1] as Blob).text();
    const lines = text.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 groups
    expect(lines[1]!.split(',').map((f) => f.trim())[0]).toBe('A');
  });
});
