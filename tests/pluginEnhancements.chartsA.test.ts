// ==========================================================================
// Tests for the chart-plugin enhancements (batch A):
//   - Export PNG / Export CSV button params on every chart builtin
//   - CSV export of the plugin's underlying data (and no-op when empty)
//   - PNG export through an injected fake canvas (node, no DOM rendering)
//   - New analytical toggles: scatter trend line, time-series rolling mean,
//     histogram cumulative/density, box-plot mean marker, heatmap labels
// ==========================================================================

import { describe, it, expect, vi } from 'vitest';
import { ScatterPlugin } from '@/plugins/builtin/scatter';
import { TimeSeriesPlugin } from '@/plugins/builtin/timeSeries';
import { HistogramPlugin } from '@/plugins/builtin/histogram';
import { BoxPlotPlugin } from '@/plugins/builtin/boxPlot';
import { HeatmapPlugin } from '@/plugins/builtin/heatmap';
import { ContourPlugin } from '@/plugins/builtin/contour';
import { ErrorBandPlugin } from '@/plugins/builtin/errorband';
import { QQPlotPlugin } from '@/plugins/builtin/qqplot';
import type { ParamDefinition, Plugin, PluginApi } from '@/types/plugin';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';

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

/** Minimal canvas stub — only toDataURL is exercised by PNG export. */
function fakeCanvas() {
  // `getContext` exists on the real element; plugins call it while redrawing
  // after a param update. Returning undefined makes draw() bail out cleanly.
  return {
    toDataURL: () => PNG_DATA_URL,
    getContext: () => undefined,
  } as unknown as HTMLCanvasElement;
}

function injectCanvas(plugin: Plugin) {
  const p = plugin as unknown as { ctx: unknown };
  p.ctx = { canvas2d: fakeCanvas() };
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

interface CaseDef {
  name: string;
  base: string;
  header: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Ctor: new () => any;
  file: File;
}

const CSV = (name: string, text: string) => new File([text], name);
const JSON_FILE = (name: string, value: unknown) =>
  new File([JSON.stringify(value)], name);

const CASES: CaseDef[] = [
  {
    name: 'scatter',
    base: 'scatter',
    header: 'x,y',
    Ctor: ScatterPlugin,
    file: CSV('points.dat', '0 1\n1 2\n2 3\n3 5\n4 4\n'),
  },
  {
    name: 'timeSeries',
    base: 'time-series',
    header: 'a,b',
    Ctor: TimeSeriesPlugin,
    file: CSV('series.csv', 'a,b\n1,2\n2,3\n3,4\n4,5\n'),
  },
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
    name: 'heatmap',
    base: 'heatmap',
    header: 'row,col,value',
    Ctor: HeatmapPlugin,
    file: JSON_FILE('grid.json', [
      [1, 2],
      [3, 4],
    ]),
  },
  {
    name: 'contour',
    base: 'contour',
    header: 'row,col,value',
    Ctor: ContourPlugin,
    file: JSON_FILE('field.json', [
      [0, 1],
      [1, 0],
    ]),
  },
  {
    name: 'errorband',
    base: 'error-band',
    header: 'x,y,lower,upper',
    Ctor: ErrorBandPlugin,
    file: CSV('band.csv', 'x,y,err\n0,1,0.5\n1,2,0.4\n2,3,0.3\n'),
  },
  {
    name: 'qqplot',
    base: 'qq-plot',
    header: 'theoretical,sample',
    Ctor: QQPlotPlugin,
    file: CSV('sample.csv', '1\n2\n3\n4\n5\n6\n7\n8\n'),
  },
];

describe.each(CASES)('$name export buttons', (c) => {
  it('exposes exportPng / exportCsv button params with bilingual labels', async () => {
    const { plugin } = await make(c.Ctor, null);
    const buttons = buttonDefs(plugin.getParams());
    const png = buttons.find((b) => b.key === 'exportPng');
    const csv = buttons.find((b) => b.key === 'exportCsv');
    expect(png).toBeDefined();
    expect(csv).toBeDefined();
    expect(png!.action).toBe('exportPng');
    expect(csv!.action).toBe('exportCsv');
    expect(png!.labelI18n?.['zh-CN']).toBeTruthy();
    expect(png!.labelI18n?.['en-US']).toBeTruthy();
    expect(csv!.labelI18n?.['zh-CN']).toBeTruthy();
    expect(csv!.labelI18n?.['en-US']).toBeTruthy();
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

  it('exports PNG through the injected canvas after data is loaded', async () => {
    const { plugin, exportFile } = await make(c.Ctor, c.file);
    injectCanvas(plugin);
    plugin.updateParams({ exportPng: true });
    expect(exportFile).toHaveBeenCalledTimes(1);
    const [fileName, blob, mime] = exportFile.mock.calls[0]!;
    expect(String(fileName).endsWith('.png')).toBe(true);
    expect(String(fileName).startsWith(c.base)).toBe(true);
    expect(blob).toBeInstanceOf(Blob);
    expect(mime).toBe('image/png');
  });

  it('warns instead of exporting PNG when data exists but no canvas is attached', async () => {
    const { plugin, exportFile, notify } = await make(c.Ctor, c.file);
    plugin.updateParams({ exportPng: true });
    expect(exportFile).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('warning', expect.any(String));
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

  it('adds the optional color column only when a 3rd column exists', async () => {
    const { plugin, exportFile } = await make(
      ScatterPlugin,
      CSV('points.dat', '0 1 0.5\n1 2 0.6\n2 3 0.7\n'),
    );
    plugin.updateParams({ exportCsv: true });
    const blob = exportFile.mock.calls[0]![1] as Blob;
    const text = await blob.text();
    expect(text.replace(/^\uFEFF/, '').split('\r\n')[0]).toBe('x,y,color');
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

// ---- heatmap: label columns -------------------------------------------------

describe('heatmap labelled CSV export', () => {
  it('appends row/col label columns when the JSON carries labels', async () => {
    const file = JSON_FILE('labelled.json', {
      data: [
        [1, 2],
        [3, 4],
      ],
      rowLabels: ['r0', 'r1'],
      colLabels: ['c0', 'c1'],
    });
    const { plugin, exportFile } = await make(HeatmapPlugin, file);
    plugin.updateParams({ exportCsv: true });
    const text = await (exportFile.mock.calls[0]![1] as Blob).text();
    const lines = text.replace(/^\uFEFF/, '').split('\r\n');
    expect(lines[0]).toBe('row,col,rowLabel,colLabel,value');
    expect(lines[1]).toBe('0,0,r0,c0,1');
    expect(lines).toHaveLength(5); // header + 4 cells
  });
});
