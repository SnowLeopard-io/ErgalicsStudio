// ==========================================================================
// Functional tests for the builtin "fun" plugin enhancements:
//   - per-plugin Export PNG buttons (snapshot of the canvas 2D surface)
//   - randomize / reset / clear action buttons
//   - palette CSV / CSS export
//   - Game of Life pattern select (random / glider / blinker / beacon)
//   - Truchet tile-type select (random / diagonal / curve)
// ==========================================================================

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { MandelbrotPlugin } from '@/plugins/builtin/mandelbrot';
import { SpirographPlugin } from '@/plugins/builtin/spirograph';
import { LissajousPlugin } from '@/plugins/builtin/lissajous';
import { LifePlugin } from '@/plugins/builtin/life';
import { HarmonographPlugin } from '@/plugins/builtin/harmonograph';
import { PalettePlugin } from '@/plugins/builtin/palette';
import { KochPlugin } from '@/plugins/builtin/koch';
import { BarnsleyPlugin } from '@/plugins/builtin/barnsley';
import { FireworksPlugin } from '@/plugins/builtin/fireworks';
import { TruchetPlugin } from '@/plugins/builtin/truchet';
import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';

// Animation loops schedule frames; node has no rAF / DOM.
beforeAll(() => {
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 1;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => undefined;
  const noop2d = () => new Proxy({}, { get: () => () => {}, set: () => true });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: noop2d }),
  };
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

/** Fake 160x120 canvas: width/height start at 0, the 2D context is a full
 *  no-op proxy, and toDataURL returns a valid (tiny) PNG data URL. */
function fakeCanvas() {
  const ctx2d = new Proxy({}, { get: () => () => {}, set: () => true });
  return {
    clientWidth: 160,
    clientHeight: 120,
    width: 0,
    height: 0,
    getContext: () => ctx2d,
    toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=',
  } as unknown as HTMLCanvasElement;
}

function containerOf(canvas: HTMLCanvasElement): ContainerCapabilities {
  return { canvas2d: canvas } as unknown as ContainerCapabilities;
}

function paramKeys(defs: ParamDefinition[]): Set<string> {
  return new Set(defs.map((d) => d.key));
}

function paramOf(defs: ParamDefinition[], key: string): ParamDefinition {
  const def = defs.find((d) => d.key === key);
  if (!def) throw new Error(`missing param ${key}`);
  return def;
}

/** Activate the plugin on a fake canvas, force one redraw, then click the
 *  Export PNG button and return the recorded exportFile calls. */
async function pngExportRoundTrip(
  plugin: Plugin,
  forceRedraw: (p: Plugin, container: ContainerCapabilities) => void,
) {
  const { api, exportFile } = fakeApi();
  await plugin.init(api);
  const canvas = fakeCanvas();
  const container = containerOf(canvas);
  await plugin.activate?.({ container, api });
  forceRedraw(plugin, container);
  plugin.updateParams?.({ exportPng: true });
  return exportFile;
}

// ---- mandelbrot -----------------------------------------------------------

describe('mandelbrot enhancement', () => {
  it('exposes exportPng and resetZoom buttons with bilingual labels', async () => {
    const plugin = new MandelbrotPlugin();
    await plugin.init(fakeApi().api);
    const keys = paramKeys(plugin.getParams());
    expect(keys.has('exportPng')).toBe(true);
    expect(keys.has('resetView')).toBe(true);
    const exportBtn = paramOf(plugin.getParams(), 'exportPng');
    expect(exportBtn.type).toBe('button');
    expect(exportBtn.labelI18n).toMatchObject({ 'zh-CN': '导出 PNG', 'en-US': 'Export PNG' });
  });

  it('redraws then exports a PNG file', async () => {
    const plugin = new MandelbrotPlugin();
    const exportFile = await pngExportRoundTrip(plugin, (p, c) => p.render?.(c));
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(exportFile.mock.calls[0]![0]).toMatch(/\.png$/);
  });

  it('resetView restores zoom to 1', async () => {
    const plugin = new MandelbrotPlugin();
    await plugin.init(fakeApi().api);
    await plugin.activate({ container: containerOf(fakeCanvas()) });
    plugin.updateParams?.({ zoom: 10 });
    expect(paramOf(plugin.getParams(), 'zoom').type).toBe('range');
    expect((paramOf(plugin.getParams(), 'zoom') as { value: number }).value).toBe(10);
    plugin.updateParams?.({ resetView: true });
    expect((paramOf(plugin.getParams(), 'zoom') as { value: number }).value).toBe(1);
  });
});

// ---- spirograph -----------------------------------------------------------

describe('spirograph enhancement', () => {
  it('exposes exportPng and randomize buttons', async () => {
    const plugin = new SpirographPlugin();
    await plugin.init(fakeApi().api);
    const keys = paramKeys(plugin.getParams());
    expect(keys.has('exportPng')).toBe(true);
    expect(keys.has('randomize')).toBe(true);
  });

  it('exports a PNG after a redraw', async () => {
    const plugin = new SpirographPlugin();
    const exportFile = await pngExportRoundTrip(plugin, (p, c) => p.render?.(c));
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(String(exportFile.mock.calls[0]![0])).toMatch(/\.png$/);
  });

  it('randomizes the tunable curve parameters and redraws', async () => {
    const plugin = new SpirographPlugin();
    await plugin.init(fakeApi().api);
    await plugin.activate({ container: containerOf(fakeCanvas()) });
    plugin.updateParams?.({ randomize: true });
    const p = plugin as unknown as { state: { R: number; r: number; d: number; shape: string } };
    expect(p.state.R).toBeGreaterThanOrEqual(40);
    expect(p.state.R).toBeLessThanOrEqual(320);
    expect(p.state.r).toBeGreaterThanOrEqual(10);
    expect(p.state.r).toBeLessThanOrEqual(220);
    expect(p.state.d).toBeGreaterThanOrEqual(10);
    expect(p.state.d).toBeLessThanOrEqual(220);
    expect(['hypo', 'epi']).toContain(p.state.shape);
  });
});

// ---- lissajous ------------------------------------------------------------

describe('lissajous enhancement', () => {
  it('exposes exportPng and reset buttons', async () => {
    const plugin = new LissajousPlugin();
    await plugin.init(fakeApi().api);
    const keys = paramKeys(plugin.getParams());
    expect(keys.has('exportPng')).toBe(true);
    expect(keys.has('reset')).toBe(true);
  });

  it('exports a PNG after a redraw', async () => {
    const plugin = new LissajousPlugin();
    const exportFile = await pngExportRoundTrip(plugin, (p, c) => p.render?.(c));
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(String(exportFile.mock.calls[0]![0])).toMatch(/\.png$/);
    await plugin.deactivate?.();
  });

  it('reset restores the default frequencies and phase', async () => {
    const plugin = new LissajousPlugin();
    await plugin.init(fakeApi().api);
    await plugin.activate({ container: containerOf(fakeCanvas()) });
    try {
      plugin.updateParams?.({ a: 11, b: 7, delta: 0 });
      plugin.updateParams?.({ reset: true });
      const defs = plugin.getParams();
      expect((paramOf(defs, 'a') as { value: number }).value).toBe(3);
      expect((paramOf(defs, 'b') as { value: number }).value).toBe(2);
      expect((paramOf(defs, 'delta') as { value: number }).value).toBeCloseTo(Math.PI / 2);
    } finally {
      await plugin.deactivate?.();
    }
  });
});

// ---- life -----------------------------------------------------------------

describe('life pattern select and png export', () => {
  it('exposes the pattern select, reseed and exportPng', async () => {
    const plugin = new LifePlugin();
    await plugin.init(fakeApi().api);
    const defs = plugin.getParams();
    const keys = paramKeys(defs);
    expect(keys.has('pattern')).toBe(true);
    expect(keys.has('reseed')).toBe(true);
    expect(keys.has('exportPng')).toBe(true);
    const pattern = paramOf(defs, 'pattern');
    expect(pattern.type).toBe('select');
    if (pattern.type !== 'select') throw new Error('pattern must be select');
    expect(pattern.options.map((o) => o.value)).toEqual(['random', 'glider', 'blinker', 'beacon']);
    const glider = pattern.options.find((o) => o.value === 'glider')!;
    expect(glider.labelI18n).toMatchObject({ 'zh-CN': '滑翔机', 'en-US': 'Glider' });
    expect(pattern.labelI18n).toMatchObject({ 'zh-CN': '图案', 'en-US': 'Pattern' });
  });

  it('sows the classic 5-cell glider, blinker and beacon without stopping playback', async () => {
    const plugin = new LifePlugin();
    await plugin.init(fakeApi().api);
    await plugin.activate({ container: containerOf(fakeCanvas()) });
    try {
      const p = plugin as unknown as { grid: Uint8Array; timer: unknown };
      const alive = () => p.grid.reduce((sum, v) => sum + v, 0);

      plugin.updateParams?.({ pattern: 'glider' });
      expect(alive()).toBe(5);
      // Playback keeps running across pattern switches.
      expect(p.timer).not.toBeNull();

      plugin.updateParams?.({ pattern: 'blinker' });
      expect(alive()).toBe(3);

      plugin.updateParams?.({ pattern: 'beacon' });
      expect(alive()).toBe(8);

      // Back to random: the grid is cleared and re-sown densely.
      plugin.updateParams?.({ pattern: 'random' });
      expect(alive()).toBeGreaterThan(5);
      expect(p.timer).not.toBeNull();

      // The legacy reseed button still sows random cells.
      plugin.updateParams?.({ reseed: true });
      expect(alive()).toBeGreaterThan(5);
    } finally {
      await plugin.deactivate?.();
    }
  });

  it('exports a PNG after a step', async () => {
    const plugin = new LifePlugin();
    const { api, exportFile } = fakeApi();
    await plugin.init(api);
    const container = containerOf(fakeCanvas());
    await plugin.activate({ container });
    try {
      plugin.render?.(container);
      plugin.updateParams?.({ exportPng: true });
      expect(exportFile).toHaveBeenCalledTimes(1);
      expect(String(exportFile.mock.calls[0]![0])).toMatch(/\.png$/);
    } finally {
      await plugin.deactivate?.();
    }
  });
});

// ---- harmonograph ---------------------------------------------------------

describe('harmonograph enhancement', () => {
  it('exposes exportPng and randomize buttons', async () => {
    const plugin = new HarmonographPlugin();
    await plugin.init(fakeApi().api);
    const keys = paramKeys(plugin.getParams());
    expect(keys.has('exportPng')).toBe(true);
    expect(keys.has('randomize')).toBe(true);
  });

  it('exports a PNG after a redraw', async () => {
    const plugin = new HarmonographPlugin();
    const exportFile = await pngExportRoundTrip(plugin, (p, c) => p.render?.(c));
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(String(exportFile.mock.calls[0]![0])).toMatch(/\.png$/);
  });

  it('randomizes frequencies, damping and color', async () => {
    const plugin = new HarmonographPlugin();
    await plugin.init(fakeApi().api);
    await plugin.activate({ container: containerOf(fakeCanvas()) });
    plugin.updateParams?.({ randomize: true });
    const p = plugin as unknown as {
      state: { f1: number; f2: number; f3: number; f4: number; damping: number; color: string };
    };
    for (const f of [p.state.f1, p.state.f2, p.state.f3, p.state.f4]) {
      expect(f).toBeGreaterThanOrEqual(0.5);
      expect(f).toBeLessThanOrEqual(6.5);
    }
    expect(p.state.damping).toBeGreaterThanOrEqual(0);
    expect(p.state.damping).toBeLessThanOrEqual(0.02);
    expect(p.state.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

// ---- palette --------------------------------------------------------------

describe('palette CSV / CSS export', () => {
  it('exposes exportCsv and exportCss buttons', async () => {
    const plugin = new PalettePlugin();
    await plugin.init(fakeApi().api);
    const keys = paramKeys(plugin.getParams());
    expect(keys.has('exportCsv')).toBe(true);
    expect(keys.has('exportCss')).toBe(true);
  });

  it('exports the generated colors as CSV then as CSS', async () => {
    const plugin = new PalettePlugin();
    const { api, exportFile } = fakeApi();
    await plugin.init(api);
    const container = containerOf(fakeCanvas());
    await plugin.activate({ container });
    // Generate the swatches first.
    plugin.render?.(container);

    plugin.updateParams?.({ exportCsv: true });
    expect(exportFile).toHaveBeenCalledTimes(1);
    const [csvName, csvBlob, csvMime] = exportFile.mock.calls[0]!;
    expect(String(csvName)).toMatch(/\.csv$/);
    expect(String(csvMime ?? '')).toContain('csv');
    expect(csvBlob).toBeInstanceOf(Blob);

    plugin.updateParams?.({ exportCss: true });
    expect(exportFile).toHaveBeenCalledTimes(2);
    const [cssName, cssText, cssMime] = exportFile.mock.calls[1]!;
    expect(cssName).toBe('palette.css');
    expect(cssMime).toBe('text/css');
    expect(typeof cssText).toBe('string');
    const text = cssText as string;
    expect(text.startsWith(':root{')).toBe(true);
    expect(text).toContain('--color-1:#');
    expect(text.trimEnd().endsWith('}')).toBe(true);
  });
});

// ---- koch -----------------------------------------------------------------

describe('koch enhancement', () => {
  it('exposes exportPng, keeps the depth range and adds no reset button', async () => {
    const plugin = new KochPlugin();
    await plugin.init(fakeApi().api);
    const defs = plugin.getParams();
    const keys = paramKeys(defs);
    expect(keys.has('exportPng')).toBe(true);
    expect(keys.has('reset')).toBe(false);
    expect(paramOf(defs, 'iterations').type).toBe('range');
  });

  it('exports a PNG after a redraw', async () => {
    const plugin = new KochPlugin();
    const exportFile = await pngExportRoundTrip(plugin, (p, c) => p.render?.(c));
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(String(exportFile.mock.calls[0]![0])).toMatch(/\.png$/);
  });
});

// ---- barnsley -------------------------------------------------------------

describe('barnsley enhancement', () => {
  it('exposes exportPng and reset buttons alongside regenerate', async () => {
    const plugin = new BarnsleyPlugin();
    await plugin.init(fakeApi().api);
    const keys = paramKeys(plugin.getParams());
    expect(keys.has('exportPng')).toBe(true);
    expect(keys.has('reset')).toBe(true);
    expect(keys.has('regenerate')).toBe(true);
  });

  it('exports a PNG after a redraw', async () => {
    const plugin = new BarnsleyPlugin();
    const exportFile = await pngExportRoundTrip(plugin, (p, c) => p.render?.(c));
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(String(exportFile.mock.calls[0]![0])).toMatch(/\.png$/);
  });

  it('reset restores the default parameters and redraws', async () => {
    const plugin = new BarnsleyPlugin();
    await plugin.init(fakeApi().api);
    await plugin.activate({ container: containerOf(fakeCanvas()) });
    plugin.updateParams?.({ points: 5000, color: '#fcd34d', seed: 99 });
    plugin.updateParams?.({ reset: true });
    const p = plugin as unknown as { state: { points: number; color: string; seed: number } };
    expect(p.state.points).toBe(60_000);
    expect(p.state.color).toBe('#6ee7b7');
    expect(p.state.seed).toBe(1);
  });
});

// ---- fireworks ------------------------------------------------------------

describe('fireworks enhancement', () => {
  it('exposes exportPng and clear buttons while keeping fire', async () => {
    const plugin = new FireworksPlugin();
    await plugin.init(fakeApi().api);
    const keys = paramKeys(plugin.getParams());
    expect(keys.has('exportPng')).toBe(true);
    expect(keys.has('clear')).toBe(true);
    expect(keys.has('fire')).toBe(true);
  });

  it('fires a burst, steps, exports a PNG, then clears all particles', async () => {
    const plugin = new FireworksPlugin();
    const { api, exportFile } = fakeApi();
    await plugin.init(api);
    const container = containerOf(fakeCanvas());
    await plugin.activate({ container });
    try {
      // One burst + a step produces live particles.
      plugin.updateParams?.({ fire: true });
      const inner = plugin as unknown as { particles: unknown[]; step: (dt: number) => void; draw: () => void };
      expect(inner.particles.length).toBeGreaterThan(0);
      inner.step(16.7);
      inner.draw();

      plugin.updateParams?.({ exportPng: true });
      expect(exportFile).toHaveBeenCalledTimes(1);
      expect(String(exportFile.mock.calls[0]![0])).toMatch(/\.png$/);

      plugin.updateParams?.({ clear: true });
      expect(inner.particles).toHaveLength(0);
    } finally {
      await plugin.deactivate?.();
    }
  });
});

// ---- truchet --------------------------------------------------------------

describe('truchet enhancement', () => {
  it('exposes exportPng, the variant select and keeps reseed', async () => {
    const plugin = new TruchetPlugin();
    await plugin.init(fakeApi().api);
    const defs = plugin.getParams();
    const keys = paramKeys(defs);
    expect(keys.has('exportPng')).toBe(true);
    expect(keys.has('variant')).toBe(true);
    expect(keys.has('regenerate')).toBe(true);
    const variant = paramOf(defs, 'variant');
    expect(variant.type).toBe('select');
    if (variant.type !== 'select') throw new Error('variant must be select');
    expect(variant.options.map((o) => o.value)).toEqual(['random', 'diagonal', 'curve']);
    const diagonal = variant.options.find((o) => o.value === 'diagonal')!;
    expect(diagonal.labelI18n).toMatchObject({ 'zh-CN': '对角线', 'en-US': 'Diagonal' });
  });

  it('renders every variant and exports a PNG', async () => {
    const plugin = new TruchetPlugin();
    const { api, exportFile } = fakeApi();
    await plugin.init(api);
    const container = containerOf(fakeCanvas());
    await plugin.activate({ container });
    plugin.render?.(container);
    plugin.updateParams?.({ variant: 'diagonal' });
    expect((paramOf(plugin.getParams(), 'variant') as { value: string }).value).toBe('diagonal');
    plugin.updateParams?.({ variant: 'random' });
    plugin.updateParams?.({ variant: 'curve' });
    plugin.updateParams?.({ regenerate: true });
    plugin.updateParams?.({ exportPng: true });
    expect(exportFile).toHaveBeenCalledTimes(1);
    expect(String(exportFile.mock.calls[0]![0])).toMatch(/\.png$/);
  });
});
