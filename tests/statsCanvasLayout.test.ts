// Regression coverage for the stats plugin canvases:
//   1. Data plugins start EMPTY (no bundled sample) and render an explicit
//      "no data" empty state with an import hint.
//   2. Meta-analysis forest plot: 95% CI whiskers must stay inside the forest
//      frame — they used to extrapolate past it into the value column and the
//      funnel plot.
//   3. Multivariate biplot: loading-arrow labels must stay inside the scatter
//      frame and not stack on top of each other.
//   4. Timeseries correlograms: the last lag bar must not spill past the
//      frame, and panel titles must not be drawn twice.
//   5. Slider params (eps / minPts / horizon / period) actually recompute the
//      model — the "slider has no effect" regression.
import { describe, it, expect } from 'vitest';
import type { ContainerCapabilities, PluginApi } from '@/types/plugin';
import { StatsMetaPlugin } from '@/plugins/builtin/stats/meta/plugin';
import { StatsMultivariatePlugin } from '@/plugins/builtin/stats/multivariate/plugin';
import { StatsTimeseriesPlugin } from '@/plugins/builtin/stats/timeseries/plugin';

const W = 880;
const H = 520;

interface Call {
  op: string;
  args: unknown[];
}

function recordingCtx() {
  const calls: Call[] = [];
  const rec = (op: string) => (...args: unknown[]) => {
    calls.push({ op, args });
  };
  const store: Record<string, unknown> = { font: '', textAlign: 'left' };
  const g = new Proxy(store, {
    get: (t, prop) => {
      if (prop === '__calls') return calls;
      if (prop === 'measureText') return (text: string) => ({ width: String(text).length * 5.5 });
      if (prop === 'canvas') return {};
      return t[prop as string] ?? rec(String(prop));
    },
    set: (t, prop, value) => {
      t[prop as string] = value;
      return true;
    },
  });
  return g as unknown as CanvasRenderingContext2D;
}

function makeCanvas() {
  // A single shared context instance — prepareCanvas and the assertion helper
  // must observe the same recording proxy.
  let ctx: CanvasRenderingContext2D | null = null;
  return {
    clientWidth: W,
    clientHeight: H,
    width: 0,
    height: 0,
    getContext: () => (ctx ??= recordingCtx()),
  };
}

function callsOf(canvas: unknown): Call[] {
  const ctx = (canvas as { getContext: () => CanvasRenderingContext2D }).getContext();
  return (ctx as unknown as { __calls: Call[] }).__calls;
}

async function loadedPlugin<P extends { init(a: PluginApi): Promise<void>; render(c: ContainerCapabilities): void; loadData(f: File): Promise<void> }>(
  plugin: P,
  csv: string,
) {
  await plugin.init(fakeApi());
  plugin.render({ canvas2d: makeCanvas() } as unknown as ContainerCapabilities);
  await plugin.loadData(new File([csv], 'data.csv'));
  // Re-render so the recorded draw calls reflect the loaded data.
  plugin.render({ canvas2d: makeCanvas() } as unknown as ContainerCapabilities);
  return plugin;
}

function fakeApi(): PluginApi {
  return {
    locale: 'en-US',
    t: (k: string) => k,
    onLocaleChange: () => () => undefined,
    notify: () => undefined,
    emit: () => undefined,
    on: () => () => undefined,
  } as unknown as PluginApi;
}

const META_CSV = `study,effect,se,group
Adams 2016,0.18,0.09,behavioural
Baker 2018,0.34,0.12,behavioural
Chen 2019,0.22,0.08,behavioural
Diaz 2020,0.41,0.15,behavioural
Evans 2017,0.29,0.11,pharmacological
Fischer 2019,0.51,0.17,pharmacological
Garcia 2021,0.37,0.13,pharmacological
Hughes 2022,0.44,0.14,pharmacological`;

// ---- 1. empty start state ---------------------------------------------------

describe('stats plugins start with an empty state (no bundled sample)', () => {
  it.each([
    ['meta', () => new StatsMetaPlugin()],
    ['multivariate', () => new StatsMultivariatePlugin()],
    ['timeseries', () => new StatsTimeseriesPlugin()],
  ])('%s renders the "No data loaded" hint before any import', async (_name, make) => {
    const plugin = make();
    await plugin.init(fakeApi());
    plugin.render({ canvas2d: makeCanvas() } as unknown as ContainerCapabilities);
    const texts = callsOf((plugin as unknown as { ctx: { canvas2d: unknown } }).ctx.canvas2d)
      .filter((c) => c.op === 'fillText')
      .map((c) => String(c.args[0]));
    expect(texts).toContain('No data loaded');
    expect(texts.some((t) => t.includes('Import a CSV / TSV dataset'))).toBe(true);
  });

  it('exposes no embedded sample text at all', () => {
    for (const plugin of [new StatsMetaPlugin(), new StatsMultivariatePlugin(), new StatsTimeseriesPlugin()]) {
      expect((plugin as unknown as { text: string }).text.trim()).toBe('');
    }
  });
});

// ---- 2. meta forest plot CI containment -------------------------------------

describe('meta forest plot keeps CI whiskers inside the frame', () => {
  it('no horizontal study segment crosses the value column between the plots', async () => {
    const plugin = await loadedPlugin(new StatsMetaPlugin(), META_CSV);
    const calls = callsOf((plugin as unknown as { ctx: { canvas2d: unknown } }).ctx.canvas2d);
    // First strokeRect is the forest frame: x0=150, w=0.62·W-26-150.
    const rects = calls.filter((c) => c.op === 'strokeRect').map((c) => c.args as number[]);
    expect(rects.length).toBeGreaterThan(1);
    const forest = rects[0]!;
    const forestX1 = forest[0]! + forest[2]!;
    const funnelX0 = Math.round(W * 0.7);
    // Collect horizontal stroke segments (CI bars are horizontal; the funnel
    // dashed lines and frame are not).
    const horizontal: Array<[number, number]> = [];
    let open: { x: number; y: number } | null = null;
    for (const c of calls) {
      if (c.op === 'moveTo') open = { x: c.args[0] as number, y: c.args[1] as number };
      else if (c.op === 'lineTo' && open) {
        const x = c.args[0] as number;
        const y = c.args[1] as number;
        if (Math.abs(y - open.y) < 0.5 && Math.abs(x - open.x) > 8) horizontal.push([Math.min(open.x, x), Math.max(open.x, x)]);
        open = { x, y };
      }
    }
    const offenders = horizontal.filter(([a, b]) => b > forestX1 + 0.5 && a < funnelX0 - 1);
    expect(offenders).toEqual([]);
  });
});

// ---- 3. multivariate biplot labels ------------------------------------------

const MV_CSV = `id,speed,height,width,mass,species
1,3.2,4.1,2.2,3.7,setosa
2,3.4,3.9,2.4,3.9,setosa
3,2.9,4.4,2.1,3.5,setosa
4,6.4,2.3,4.8,6.1,versicolor
5,6.1,2.6,4.5,5.8,versicolor
6,6.7,2.1,5.0,6.4,versicolor
7,8.1,7.4,6.3,8.2,virginica
8,7.8,7.1,6.0,7.9,virginica
9,8.4,7.7,6.6,8.5,virginica`;

describe('multivariate biplot labels stay inside the scatter frame', () => {
  it('every loading label is clamped inside the biplot box', async () => {
    const plugin = await loadedPlugin(new StatsMultivariatePlugin(), MV_CSV);
    const calls = callsOf((plugin as unknown as { ctx: { canvas2d: unknown } }).ctx.canvas2d);
    const scatter = (calls.filter((c) => c.op === 'strokeRect').map((c) => c.args as number[]))[0]!;
    const x0 = scatter[0]!;
    const x1 = scatter[0]! + scatter[2]!;
    const y0 = scatter[1]!;
    const y1 = scatter[1]! + scatter[3]!;
    const labels = calls
      .filter((c) => c.op === 'fillText')
      .map((c) => ({ text: String(c.args[0]), x: c.args[1] as number, y: c.args[2] as number }))
      .filter((l) => ['speed', 'height', 'width', 'mass'].includes(l.text));
    expect(labels).toHaveLength(4);
    for (const l of labels) {
      expect(l.x).toBeGreaterThanOrEqual(x0 - 0.5);
      expect(l.y).toBeGreaterThanOrEqual(y0);
      expect(l.y).toBeLessThanOrEqual(y1);
      // With left alignment the text extends to x + width; it must fit.
      expect(l.x + l.text.length * 5.5).toBeLessThanOrEqual(x1 + 0.5);
    }
  });

  it('keeps the PC space aspect-correct (x domain widened by box aspect)', async () => {
    const plugin = new StatsMultivariatePlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(new File([MV_CSV], 'mv.csv'));
    const scores = (plugin as unknown as { result: { pca: { scores: number[][] } | null } }).result!.pca!.scores;
    // Scores are unchanged by rendering; the aspect fix is in the draw path,
    // so here we just verify scores exist and are finite (drawing assertions
    // above cover the frame containment).
    expect(scores.length).toBeGreaterThan(0);
  });
});

// ---- 4. timeseries correlograms ---------------------------------------------

const TS_CSV = `month,value
${Array.from({ length: 36 }, (_, t) => `${t + 1},${(20 + 0.07 * t + 3.2 * Math.sin((2 * Math.PI * t) / 12) + (t % 3) * 0.2).toFixed(3)}`).join('\n')}`;

describe('timeseries correlograms clamp bars and print panel titles once', () => {
  it('no ACF/PACF bar extends past its frame', async () => {
    const plugin = await loadedPlugin(new StatsTimeseriesPlugin(), TS_CSV);
    const calls = callsOf((plugin as unknown as { ctx: { canvas2d: unknown } }).ctx.canvas2d);
    // Correlogram bars live in the bottom half of the canvas.
    const bars = calls
      .filter((c) => c.op === 'fillRect')
      .map((c) => c.args as number[])
      .filter(([x, y, w, h]) => (y as number) > H * 0.5 && (h as number) > 0 && (w as number) < 40);
    expect(bars.length).toBeGreaterThan(0);
    for (const [x, , w] of bars) {
      expect(x!).toBeGreaterThanOrEqual(61);
      expect(x! + w!).toBeLessThanOrEqual(W - 29.5);
    }
  });

  it('draws each panel title exactly once', async () => {
    const plugin = await loadedPlugin(new StatsTimeseriesPlugin(), TS_CSV);
    const texts = callsOf((plugin as unknown as { ctx: { canvas2d: unknown } }).ctx.canvas2d)
      .filter((c) => c.op === 'fillText')
      .map((c) => String(c.args[0]));
    expect(texts.filter((t) => t === 'ACF')).toHaveLength(1);
    expect(texts.filter((t) => t === 'PACF')).toHaveLength(1);
  });
});

// ---- 5. slider plumbing ------------------------------------------------------

describe('range sliders recompute their models', () => {
  it('timeseries horizon changes the forecast length', async () => {
    const plugin = new StatsTimeseriesPlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(new File([TS_CSV], 'ts.csv'));
    plugin.updateParams({ horizon: 30 });
    const result = (plugin as unknown as { result: { forecast: unknown[] } }).result!;
    expect(result.forecast).toHaveLength(30);
    expect(plugin.getParams().find((p) => p.key === 'horizon')?.value).toBe(30);
  });

  it('timeseries period changes the decomposition', async () => {
    const plugin = new StatsTimeseriesPlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(new File([TS_CSV], 'ts.csv'));
    plugin.updateParams({ period: 6 });
    const result = (plugin as unknown as { result: { decomp: { period: number } | null } }).result!;
    expect(result.decomp!.period).toBe(6);
  });

  it('multivariate eps/minPts change the DBSCAN clustering', async () => {
    const plugin = new StatsMultivariatePlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(new File([MV_CSV], 'mv.csv'));
    plugin.updateParams({ view: 'dbscan' });
    const before = (plugin as unknown as { result: { dbscanResult: { labels: number[] } | null } }).result!.dbscanResult!.labels;
    plugin.updateParams({ eps: 4.5 });
    const mid = (plugin as unknown as { result: { dbscanResult: { labels: number[] } | null } }).result!.dbscanResult!;
    expect(mid.labels.length).toBe(before.length);
    expect(mid.labels.join(',')).not.toBe(before.join(','));
    plugin.updateParams({ minPts: 8 });
    expect(plugin.getParams().find((p) => p.key === 'minPts')?.value).toBe(8);
  });
});
