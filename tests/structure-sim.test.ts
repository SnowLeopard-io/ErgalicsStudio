// ==========================================================================
// Regression tests for the structural-mechanics lab plugin.
//
// The plugin is normally driven by the browser rAF loop, so these tests stub
// rAF and step it by hand: this is the only way to catch "the sim silently
// refuses to (re)start" bugs, which look like a dead canvas in the UI.
// ==========================================================================

import { beforeEach, describe, expect, it } from 'vitest';
import createStructurePlugin from '@/plugins/builtin/structure';
import type { ContainerCapabilities, Plugin, PluginApi } from '@/types/plugin';

type AnyPlugin = Plugin & Record<string, any>;

let rafQueue: ((t: number) => void) | null = null;
let rafSeq = 0;

function make2dContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    measureText: () => ({ width: 0 }),
    setLineDash: () => {},
    getImageData: () => ({ data: new Uint8ClampedArray(0) }),
    save: () => {},
    restore: () => {},
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k as string];
      return () => undefined;
    },
    set(t, k, v) {
      t[k as string] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const ctx = make2dContext();
  return {
    clientWidth: w,
    clientHeight: h,
    width: w,
    height: h,
    style: {},
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: w, height: h }),
    addEventListener: () => {},
    removeEventListener: () => {},
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  } as unknown as HTMLCanvasElement;
}

function makeApi(): PluginApi {
  return {
    locale: 'zh-CN',
    notify: (...args: unknown[]) => {
      notifications.push(args[1] as string);
    },
    log: () => {},
    setStatus: () => {},
    reportDataScale: () => {},
    exportFile: () => {},
    openFile: async () => null,
    readText: async () => '',
    readBinary: async () => new ArrayBuffer(0),
    getParam: () => undefined,
    setParam: () => {},
    cache: {} as PluginApi['cache'],
  } as unknown as PluginApi;
}

/** Warning/info messages the plugin pushed through api.notify, in order. */
let notifications: string[] = [];

/**
 * A loadable stand-in for the demo truss the plugin used to fabricate: a
 * 10-joint deck truss with one weight, expressed in the plugin's file format.
 */
function trussFile(): File {
  const deckX = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
  const bottomX = [0.2, 0.5, 0.8];
  const nodes = [
    ...deckX.map((x, i) => ({ x, y: 0.5, fixed: i === 0 || i === deckX.length - 1 })),
    ...bottomX.map((x) => ({ x, y: 0.86 })),
  ];
  const members = [
    [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6],
    [7, 8], [8, 9],
    [1, 7], [3, 8], [5, 9],
    [0, 7], [7, 2], [2, 8], [8, 4], [4, 9], [9, 6],
  ].map(([a, b]) => ({ a, b, material: 'steel' }));
  return new File([JSON.stringify({ nodes, members, weights: [{ x: 0.5, y: 0.16 }] })], 'truss.json');
}

/** Stage a loaded truss: the plugin is data-driven and opens empty. */
async function loadTruss() {
  await plugin.loadData!(trussFile());
  notifications = [];
}

/** Step the stubbed rAF loop forward by `seconds` at ~60 fps. */
function advance(seconds: number) {
  const frames = Math.round(seconds * 60);
  for (let i = 0; i < frames; i += 1) {
    const cb = rafQueue;
    rafQueue = null;
    if (!cb) return i;
    cb(performance.now() + (i + 1) * (1000 / 60));
  }
  return frames;
}

let plugin: AnyPlugin;

beforeEach(() => {
  rafQueue = null;
  rafSeq = 0;
  notifications = [];
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => {
    rafQueue = cb;
    rafSeq += 1;
    return rafSeq;
  };
  (globalThis as any).cancelAnimationFrame = () => {
    rafQueue = null;
  };
  (globalThis as any).getComputedStyle = () => ({ backgroundColor: '' });
  (globalThis as any).performance ??= { now: () => Date.now() };

  plugin = createStructurePlugin() as AnyPlugin;
  plugin.init(makeApi());
  const container = {
    canvas2d: makeCanvas(800, 500),
    reportDataScale: () => {},
  } as unknown as ContainerCapabilities;
  plugin.activate!({ container, api: makeApi() });
  plugin.render!(container);
});

describe('structure plugin · empty until data is loaded', () => {
  it('stages an empty bench and refuses ▶ Run / 重置 / 增加重物 without data', async () => {
    // The plugin used to fabricate a demo truss the moment it opened; now the
    // scene must come exclusively from a file or a sample.
    expect((plugin.joints as unknown[]).length).toBe(0);
    expect(plugin.state.hasData).toBe(false);

    plugin.updateParams!({ run: true });
    expect(plugin.state.running).toBe(false);
    expect(rafQueue).toBe(null);
    expect(notifications.some((m) => m.includes('尚未加载结构数据'))).toBe(true);

    notifications = [];
    plugin.updateParams!({ reset: { action: 'reset' } });
    expect(notifications.length).toBe(1);

    notifications = [];
    plugin.updateParams!({ drop: { action: 'drop' } });
    expect(notifications.length).toBe(1);
    expect((plugin.weights as unknown[]).length).toBe(0);
  });

  it('shows the loaded structure and can then be run, paused and re-run', async () => {
    await loadTruss();
    expect(plugin.state.hasData).toBe(true);
    expect((plugin.joints as unknown[]).length).toBe(10);
    expect((plugin.members as unknown[]).length).toBe(17);
    expect(plugin.state.running).toBe(false);

    plugin.updateParams!({ run: true });
    expect(plugin.state.running).toBe(true);
    advance(0.2);
    plugin.updateParams!({ run: false });
    expect(plugin.state.running).toBe(false);

    plugin.updateParams!({ run: true });
    expect(plugin.state.running).toBe(true);
    expect(rafQueue).not.toBe(null);
  });
});

describe('structure plugin · simulation', () => {
  it('opens paused and settles the loaded weight only once ▶ Run is pressed', async () => {
    await loadTruss();
    // A loaded scene is staged paused: the truss must not run itself.
    expect(plugin.state.running).toBe(false);
    expect(rafQueue).toBe(null);

    plugin.updateParams!({ run: true });
    expect(plugin.state.running).toBe(true);

    const weights = plugin.weights as { y: number }[];
    expect(weights.length).toBe(1);
    const y0 = weights[0]!.y;
    advance(1.2);
    // The loaded weight rests on the deck (no drop impact): it must stay
    // supported — neither free-falling nor bouncing away.
    expect(Math.abs(weights[0]!.y - y0)).toBeLessThan(10);
  });

  it('places a settled weight when the "drop" button is pressed', async () => {
    await loadTruss();
    // Let the deck settle first, as it would in the UI before the user asks
    // for another weight.
    plugin.updateParams!({ run: true });
    advance(0.2);
    const before = (plugin.weights as unknown[]).length;
    plugin.updateParams!({ drop: { action: 'drop' } });
    // Adding a weight keeps the run live so the extra sag is immediate.
    expect(plugin.state.running).toBe(true);
    const weights = plugin.weights as { y: number }[];
    expect(weights.length).toBe(before + 1);
    const dropped = weights[weights.length - 1]!;
    const y0 = dropped.y;
    advance(1.0);
    // "增加重物" settles the new weight onto the deck, so it must stay near
    // its placed position instead of falling through to the floor.
    expect(Math.abs(dropped.y - y0)).toBeLessThan(12);
  });

  it('resumes after the Run toggle is paused and pressed again', async () => {
    await loadTruss();
    plugin.updateParams!({ run: true });
    advance(0.3);
    plugin.updateParams!({ run: false });
    expect(plugin.state.running).toBe(false);
    expect(rafQueue).toBe(null);

    plugin.updateParams!({ run: true });
    expect(plugin.state.running).toBe(true);
    // A resumed sim must re-arm the animation frame, otherwise the canvas is
    // frozen forever and the Run button looks dead.
    expect(rafQueue).not.toBe(null);
  });
});

describe('structure plugin · reset', () => {
  const joints = () => plugin.joints as { x: number; y: number }[];
  const authored = () => joints().map((j) => ({ x: j.x, y: j.y }));
  const maxDrift = (base: { x: number; y: number }[]) =>
    joints().reduce((m, j, i) => Math.max(m, Math.abs(j.y - base[i]!.y)), 0);

  it('clears the runtime weights and restores the authored truss', async () => {
    await loadTruss();
    const pristine = authored();

    // Load the deck up and let the frame bend under it.
    plugin.updateParams!({ weightMass: 10 });
    plugin.updateParams!({ run: true });
    advance(0.2);
    plugin.updateParams!({ drop: { action: 'drop' } });
    plugin.updateParams!({ drop: { action: 'drop' } });
    expect((plugin.weights as unknown[]).length).toBe(3);
    advance(2.0);
    expect(maxDrift(pristine)).toBeGreaterThan(0.5); // the extra loads really bend it

    // 重置 used to restore a baseline that had itself absorbed every added
    // weight, so the loads stayed on the deck and the sag never came out.
    plugin.updateParams!({ reset: { action: 'reset' } });
    expect((plugin.weights as unknown[]).length).toBe(1);
    expect(plugin.state.running).toBe(false);
    expect(rafQueue).toBe(null);
    const restored = authored();
    restored.forEach((j, i) => {
      expect(j.x).toBeCloseTo(pristine[i]!.x, 6);
      expect(j.y).toBeCloseTo(pristine[i]!.y, 6);
    });
  });

  it('re-arms with the runtime loads still standing on a parameter change', async () => {
    await loadTruss();
    plugin.updateParams!({ run: true });
    advance(0.2);
    plugin.updateParams!({ drop: { action: 'drop' } });
    expect((plugin.weights as unknown[]).length).toBe(2);

    // A parameter change resets the *shape* but keeps the dropped load: only
    // 重置 is meant to clear it.
    plugin.updateParams!({ gravity: 500 });
    expect(plugin.state.running).toBe(false);
    expect(rafQueue).toBe(null);
    expect((plugin.weights as unknown[]).length).toBe(2);
  });
});
