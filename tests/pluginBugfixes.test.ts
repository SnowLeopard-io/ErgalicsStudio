// Regressions for the reported plugin defects:
//   1. Protein: the Proteins slider could not be filled — its fixed ceiling
//      let the request run past the end of the loaded network.
//   2. N-body: the interactive loop integrated only a prefix of the drawn
//      set, freezing every body past the cap on screen.
//   3. LBM fluid: the outflow reflected pressure waves, the impulsive start
//      launched a domain-crossing shock, and a diverged run never recovered.
//   4. Every Start/Stop toggle needed two clicks, and importing data left a
//      running simulation running.
//   5. Structure: entering the plugin (and loading a truss) started the
//      simulation outright instead of waiting for ▶ Run.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import {
  FLUID_DIRECTIONS,
  fluidCollideKernelWGSL,
  fluidMacroCPU,
  fluidStepCPU,
} from '@/core/wgsl';
import { ProteinPlugin } from '@/plugins/builtin/protein';
import { NBodyPlugin } from '@/plugins/builtin/nbody';
import { FluidPlugin } from '@/plugins/builtin/fluid';
import { ParticlePlugin } from '@/plugins/builtin/particles';
import { WavePlugin } from '@/plugins/builtin/wave';
import { DoublePendulumPlugin } from '@/plugins/builtin/doublePendulum';
import { StructurePlugin } from '@/plugins/builtin/structure';
import { LifePlugin } from '@/plugins/builtin/life';
import { ContourPlugin } from '@/plugins/builtin/contour';
import { parseTreemapData } from '@/plugins/builtin/treemap';
import { parseBoxData } from '@/plugins/builtin/boxPlot';
import { useChunkStore } from '@/stores/chunkStore';
import { DATA_INGESTED, on } from '@/core/events';
import type { FileEntry } from '@/types/project';
import type { NBodyBody } from '@/core/wgsl';
import type { ContainerCapabilities, GpuComputeApi, ParamDefinition, PluginApi } from '@/types/plugin';

// The animation loops schedule frames; node has no rAF.
beforeAll(() => {
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 1;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => undefined;
});

function fakeApi(): PluginApi {
  return {
    locale: 'en-US',
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

function rangeParam(defs: ParamDefinition[], key: string) {
  const def = defs.find((d) => d.key === key);
  if (!def || def.type !== 'range') throw new Error(`${key} is not a range param`);
  return def;
}

function toggleValue(defs: ParamDefinition[], key: string): boolean {
  const def = defs.find((d) => d.key === key);
  if (!def || def.type !== 'toggle') throw new Error(`${key} is not a toggle param`);
  return Boolean(def.value);
}

// ---- Proteins slider ------------------------------------------------------

describe('protein count slider', () => {
  function network(n: number) {
    const proteins = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `p${i}` }));
    return new File([JSON.stringify({ proteins, interactions: [] })], 'protein.json');
  }

  it('reports a ceiling that matches the loaded network', async () => {
    const plugin = new ProteinPlugin();
    await plugin.init(fakeApi());
    // Before any import the full design ceiling is offered.
    expect(rangeParam(plugin.getParams(), 'count').max).toBe(2000);

    await plugin.loadData(network(560));
    const slider = rangeParam(plugin.getParams(), 'count');
    expect(slider.max).toBe(560);
    expect(slider.value).toBe(560);
  });

  it('keeps the requested count instead of snapping back to the loaded size', async () => {
    const plugin = new ProteinPlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(network(560));

    plugin.updateParams({ count: 300 });
    const p = plugin as unknown as { nodes: unknown[]; state: { count: number } };
    expect(p.nodes).toHaveLength(300);
    // The old bug: resampleTo() overwrote state.count with the loaded size,
    // so the thumb jumped back and the slider could never be filled.
    expect(p.state.count).toBe(300);
    expect(rangeParam(plugin.getParams(), 'count').value).toBe(300);
  });
});

// ---- N-body interactive loop ----------------------------------------------

describe('nbody interactive integration', () => {
  it('caps the set once at start instead of freezing the tail every frame', async () => {
    const plugin = new NBodyPlugin();
    await plugin.init(fakeApi());
    const bodies = Array.from({ length: 6000 }, (_, i) => ({
      x: Math.cos(i) * 2,
      y: Math.sin(i) * 2,
      z: i * 0.001,
      vx: 0,
      vy: 0,
      vz: 0,
      mass: 1,
    }));
    await plugin.loadData(new File([JSON.stringify({ bodies })], 'nbody.json'));

    const p = plugin as unknown as { bodies: NBodyBody[]; state: { count: number } };
    // The slider ceiling follows the dataset, not the hard MAX_BODIES.
    expect(rangeParam(plugin.getParams(), 'count').max).toBeGreaterThanOrEqual(6000);
    expect(p.bodies).toHaveLength(6000);

    // Starting the run downsamples to what the loop can integrate, so no
    // body is left motionless on screen.
    plugin.updateParams({ start: true });
    expect(p.bodies).toHaveLength(4096);
    expect(p.state.count).toBe(4096);

    // One frame must move *every* drawn body — the old prefix sweep left
    // bodies past the cap pinned at their initial position.
    const before = p.bodies.map((b) => ({ x: b.x, y: b.y, z: b.z }));
    (plugin as unknown as { tick: () => void }).tick();
    let moved = 0;
    for (let i = 0; i < p.bodies.length; i += 1) {
      const b = p.bodies[i] as NBodyBody;
      const a = before[i]!;
      if (b.x !== a.x || b.y !== a.y || b.z !== a.z) moved += 1;
    }
    expect(moved).toBe(p.bodies.length);
    plugin.updateParams({ start: false });
  });
});

// ---- LBM outflow / stability ----------------------------------------------

describe('fluid outflow absorbing layer', () => {
  it('is present in the WGSL collide kernel', () => {
    expect(fluidCollideKernelWGSL()).toContain('spongeStrength');
  });

  it('establishes a steady outflow instead of ringing', () => {
    // Long channel, obstacle in the upstream third. Without the absorbing
    // layer the startup transient sloshes between the fixed-density inlet
    // and the copy-outflow and the density keeps ringing forever.
    const W = 96;
    const H = 24;
    const cells = W * H;
    const f = new Float32Array(cells * FLUID_DIRECTIONS);
    const fpost = new Float32Array(f.length);
    const flags = new Float32Array(cells);
    for (let y = 10; y < 14; y += 1) for (let x = 16; x < 22; x += 1) flags[y * W + x] = 1;
    // Seed at rest (what the plugin now does) and ramp the inflow in.
    for (let cell = 0; cell < cells; cell += 1) {
      for (let d = 0; d < FLUID_DIRECTIONS; d += 1) {
        const w = d === 0 ? 4 / 9 : d <= 4 ? 1 / 9 : 1 / 36;
        f[cell * FLUID_DIRECTIONS + d] = w;
      }
    }
    for (let s = 0; s < 1200; s += 1) {
      const t = Math.min(1, s / 300);
      const u0 = 0.1 * t * t * (3 - 2 * t);
      fluidStepCPU(f, fpost, flags, W, H, 1.8, u0);
    }

    const { rho, ux } = fluidMacroCPU(f, W, H);
    for (let y = 2; y < H - 2; y += 1) {
      // Downstream end: pinned to the free stream, so nothing accumulates
      // there and nothing comes back upstream.
      const out = y * W + (W - 2);
      expect(Number.isFinite(rho[out]!)).toBe(true);
      expect(Math.abs(rho[out]! - 1)).toBeLessThan(0.15);
      expect(ux[out]!).toBeGreaterThan(0.02);
      // Upstream end: no global density drift from a trapped wave.
      const inl = y * W + 2;
      expect(Math.abs(rho[inl]! - 1)).toBeLessThan(0.15);
    }
  });
});

describe('fluid divergence recovery', () => {
  it('detects a blown-up lattice and reseeds instead of rendering NaN', async () => {
    const plugin = new FluidPlugin();
    const notify = vi.fn();
    await plugin.init({ ...fakeApi(), notify });
    const values = Array.from({ length: 32 }, () => new Array<number>(48).fill(0));
    for (let y = 12; y < 20; y += 1) for (let x = 18; x < 30; x += 1) values[y]![x] = 1;
    await plugin.loadData(new File([JSON.stringify({ values })], 'mask.json'));

    const p = plugin as unknown as {
      f: Float32Array;
      cols: number;
      rows: number;
      diverged: boolean;
      state: { running: boolean };
      hasDiverged: (rho: Float32Array, ux: Float32Array, uy: Float32Array) => boolean;
      recoverFromDivergence: () => void;
    };
    // A healthy, freshly seeded lattice is not flagged (solid cells hold zero
    // populations and must not trip the density check).
    const healthy = fluidMacroCPU(p.f, p.cols, p.rows);
    expect(p.hasDiverged(healthy.rho, healthy.ux, healthy.uy)).toBe(false);

    // Corrupt the field the way a diverged run does.
    p.f.fill(Number.NaN);
    const macro = fluidMacroCPU(p.f, p.cols, p.rows);
    expect(p.hasDiverged(macro.rho, macro.ux, macro.uy)).toBe(true);

    p.state.running = true;
    p.recoverFromDivergence();
    expect(notify).toHaveBeenCalled();
    expect(p.diverged).toBe(true);
    // Recovery reseeds: the field is finite again and the run is stopped.
    expect(Number.isFinite(p.f[0]!)).toBe(true);
    expect(p.state.running).toBe(false);
  });
});

// ---- importing data must halt the run -------------------------------------

describe('loading data stops the simulation', () => {
  // Every animated builtin shares the same contract: importing new data ends
  // the run, and the user restarts it explicitly through the Start toggle.
  // Without it a still-running frame loop advanced the freshly loaded state
  // the instant it was applied.
  const fluidMask = () =>
    new File(
      [
        JSON.stringify({
          values: Array.from({ length: 32 }, () => new Array<number>(48).fill(0)).map(
            (row, y) => row.map((_, x) => (y >= 12 && y < 20 && x >= 18 && x < 30 ? 1 : 0)),
          ),
        }),
      ],
      'mask.json',
    );

  const proteinNet = () =>
    new File(
      [
        JSON.stringify({
          proteins: Array.from({ length: 40 }, (_, i) => ({ id: `p${i}`, name: `p${i}` })),
          interactions: [],
        }),
      ],
      'protein.json',
    );

  const nbodySet = () =>
    new File(
      [
        JSON.stringify({
          bodies: Array.from({ length: 120 }, (_, i) => ({
            x: Math.cos(i),
            y: Math.sin(i),
            z: 0,
            vx: 0,
            vy: 0,
            vz: 0,
            mass: 1,
          })),
        }),
      ],
      'nbody.json',
    );

  const particlesDat = () =>
    new File(['0 0 1 1\n1 1 2 2\n2 2 3 3\n'], 'particles.dat');

  const waveField = () =>
    new File(
      [
        JSON.stringify({
          u: Array.from({ length: 24 }, () => new Array<number>(32).fill(0)),
        }),
      ],
      'wave.json',
    );

  const pendulumIC = () => new File([JSON.stringify({ th1: 30, th2: 60 })], 'ic.json');

  it('fluid', async () => {
    const plugin = new FluidPlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(fluidMask());
    plugin.updateParams({ start: true });
    expect(toggleValue(plugin.getParams(), 'start')).toBe(true);

    await plugin.loadData(fluidMask());
    expect(toggleValue(plugin.getParams(), 'start')).toBe(false);
    // …and the user can still start again afterwards.
    plugin.updateParams({ start: true });
    expect(toggleValue(plugin.getParams(), 'start')).toBe(true);
    plugin.updateParams({ start: false });
  });

  it('protein', async () => {
    const plugin = new ProteinPlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(proteinNet());
    plugin.updateParams({ start: true });
    expect(toggleValue(plugin.getParams(), 'start')).toBe(true);

    await plugin.loadData(proteinNet());
    expect(toggleValue(plugin.getParams(), 'start')).toBe(false);
  });

  it('nbody', async () => {
    const plugin = new NBodyPlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(nbodySet());
    plugin.updateParams({ start: true });
    expect(toggleValue(plugin.getParams(), 'start')).toBe(true);

    await plugin.loadData(nbodySet());
    expect(toggleValue(plugin.getParams(), 'start')).toBe(false);
  });

  it('particles', async () => {
    const plugin = new ParticlePlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(particlesDat());
    plugin.updateParams({ start: true });
    expect(toggleValue(plugin.getParams(), 'start')).toBe(true);

    await plugin.loadData(particlesDat());
    expect(toggleValue(plugin.getParams(), 'start')).toBe(false);
  });

  it('wave', async () => {
    const plugin = new WavePlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(waveField());
    plugin.updateParams({ start: true });
    expect(toggleValue(plugin.getParams(), 'start')).toBe(true);

    await plugin.loadData(waveField());
    expect(toggleValue(plugin.getParams(), 'start')).toBe(false);
  });

  it('double pendulum', async () => {
    const plugin = new DoublePendulumPlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(pendulumIC());
    plugin.updateParams({ start: true });
    expect(toggleValue(plugin.getParams(), 'start')).toBe(true);

    await plugin.loadData(pendulumIC());
    expect(toggleValue(plugin.getParams(), 'start')).toBe(false);
  });
});

// ---- entering a plugin must not start it ---------------------------------

describe('structure plugin opens paused', () => {
  const truss = () =>
    new File(
      [
        JSON.stringify({
          nodes: [
            { x: 0, y: 0.5 },
            { x: 0.5, y: 0.5 },
            { x: 1, y: 0.5 },
          ],
          members: [
            { a: 0, b: 1 },
            { a: 1, b: 2 },
          ],
        }),
      ],
      'truss.json',
    );

  it('opens empty, refuses ▶ Run without data, and requires ▶ Run once loaded', async () => {
    const plugin = new StructurePlugin();
    await plugin.init(fakeApi());
    await plugin.activate({
      container: { canvas2d: null } as unknown as ContainerCapabilities,
    });

    // The plugin must not fabricate a truss on open — and with nothing staged
    // it must refuse to run instead of "running" an empty bench.
    expect((plugin as any).joints.length).toBe(0);
    expect(toggleValue(plugin.getParams(), 'run')).toBe(false);
    plugin.updateParams({ run: true });
    expect(toggleValue(plugin.getParams(), 'run')).toBe(false);

    // The run toggle is the only way in once a structure is loaded.
    await plugin.loadData(truss());
    expect(toggleValue(plugin.getParams(), 'run')).toBe(false);

    plugin.updateParams({ run: true });
    expect(toggleValue(plugin.getParams(), 'run')).toBe(true);

    // Loading a structure halts the run and stages the new one paused.
    await plugin.loadData(truss());
    expect(toggleValue(plugin.getParams(), 'run')).toBe(false);

    // …and it can still be started again afterwards.
    plugin.updateParams({ run: true });
    expect(toggleValue(plugin.getParams(), 'run')).toBe(true);
    plugin.updateParams({ run: false });
  });
});

// ---- nbody JSON sanitization ----------------------------------------------

describe('nbody JSON import is defensive about untrusted values', () => {
  async function bodiesOf(json: string) {
    const plugin = new NBodyPlugin();
    await plugin.init(fakeApi());
    await plugin.loadData(new File([json], 'nbody.json'));
    return (plugin as unknown as { raw: NBodyBody[] }).raw;
  }

  it('coerces numeric strings and falls back for bad velocities/mass', async () => {
    const bodies = await bodiesOf(
      JSON.stringify({
        bodies: [
          { x: '1', y: '2', z: '3', vx: '0.5', vy: null, vz: 'oops', mass: '4' },
          { x: 0, y: 0, z: 0, vx: 1, vy: 2, vz: 3, mass: 'x' },
          { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, mass: -3 },
        ],
      }),
    );
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toEqual({ x: 1, y: 2, z: 3, vx: 0.5, vy: 0, vz: 0, mass: 4 });
    // Non-positive / non-numeric mass falls back to 1 instead of NaN.
    expect(bodies[1]!.mass).toBe(1);
    expect(bodies[2]!.mass).toBe(1);
  });

  it('handles the array shorthand and drops rows with bad positions', async () => {
    const bodies = await bodiesOf(
      JSON.stringify({
        bodies: [
          ['0', '1', '2', 'x', '-1', '2', '5'],
          ['3', '4', '5', null, '0', '0', '2'],
          ['bad', 1, 2, 0, 0, 0, 1],
        ],
      }),
    );
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual({ x: 0, y: 1, z: 2, vx: 0, vy: -1, vz: 2, mass: 5 });
    expect(bodies[1]).toEqual({ x: 3, y: 4, z: 5, vx: 0, vy: 0, vz: 0, mass: 2 });
  });
});

// ---- life speed slider restarts the timer ----------------------------------

describe('life speed change while playing', () => {
  it('restarts the interval at the new speed', () => {
    vi.useFakeTimers();
    try {
      const plugin = new LifePlugin();
      const ctx2d: Record<string, unknown> = {};
      const g = new Proxy(ctx2d, {
        get: (t, prop) => t[prop as string] ?? (() => {}),
        set: (t, prop, value) => {
          t[prop as string] = value;
          return true;
        },
      });
      const canvas = { clientWidth: 160, clientHeight: 120, width: 0, height: 0, getContext: () => g };
      const p = plugin as unknown as { ctx: unknown; state: { playing: boolean } };
      p.ctx = { canvas2d: canvas };
      p.state.playing = false;

      plugin.updateParams({ playing: true });
      expect(vi.getTimerCount()).toBe(1);

      // The old bug: changing speed only updated state, so the live interval
      // kept firing at the original delay.
      plugin.updateParams({ speed: 300 });
      expect(vi.getTimerCount()).toBe(1);
      plugin.updateParams({ playing: false });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---- treemap / box plot first-row handling ---------------------------------

describe('parsers keep the first data row of label-first formats', () => {
  it('treemap: `label,size` rows are both kept', () => {
    const root = parseTreemapData('alpha,10\nbeta,20\n');
    expect(root).not.toBeNull();
    const names = root!.children.map((c) => c.name);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    expect(root!.size).toBe(30);
  });

  it('treemap: an actual non-numeric header row is still skipped', () => {
    const root = parseTreemapData('name,size\nalpha,10\nbeta,20\n');
    expect(root!.children.map((c) => c.name)).toEqual(['alpha', 'beta']);
  });

  it('box plot: grouped `group,value` keeps the first row in group A', () => {
    const stats = parseBoxData('A,1\nA,3\nB,10\n');
    expect(stats).toHaveLength(2);
    const a = stats.find((s) => s.name === 'A')!;
    const b = stats.find((s) => s.name === 'B')!;
    // Old code skipped line 0, leaving group A with only [3] (median 3).
    expect(a.median).toBe(2);
    expect(a.min).toBe(1);
    expect(a.max).toBe(3);
    expect(b.median).toBe(10);
  });

  it('box plot: a genuine text header is still skipped', () => {
    const stats = parseBoxData('group,value\nA,1\nA,3\n');
    expect(stats).toHaveLength(1);
    expect(stats[0]!.name).toBe('A');
    expect(stats[0]!.median).toBe(2);
  });
});

// ---- contour marching-squares topology -------------------------------------

describe('contour marching squares saddle handling', () => {
  function render(grid: number[][]) {
    const moves: Array<[number, number]> = [];
    const lines: Array<[number, number]> = [];
    const g = {
      beginPath: () => {},
      stroke: () => {},
      moveTo: (x: number, y: number) => moves.push([x, y]),
      lineTo: (x: number, y: number) => lines.push([x, y]),
    };
    const plugin = new ContourPlugin();
    const p = plugin as unknown as {
      grid: number[][];
      min: number;
      max: number;
      state: { levels: number };
      drawContours: (g: unknown, c: unknown) => void;
    };
    p.grid = grid;
    p.min = -1;
    p.max = 1;
    p.state.levels = 1; // single contour at level 0
    p.drawContours(g, { width: 100, height: 100 });
    return { moves, lines };
  }

  it('draws two finite segments for a saddle cell (4 crossings)', () => {
    const { moves, lines } = render([
      [1, -1],
      [-1, 1],
    ]);
    expect(lines).toHaveLength(2);
    expect(moves).toHaveLength(2);
    for (const [x, y] of [...moves, ...lines]) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });

  it('draws one segment for an ordinary 2-crossing cell', () => {
    const { moves, lines } = render([
      [-1, -1],
      [1, 1],
    ]);
    expect(lines).toHaveLength(1);
    expect(moves).toHaveLength(1);
    for (const [x, y] of [...moves, ...lines]) {
      expect(Number.isFinite(x)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
});

// ---- GPU resources are allocated/compiled once per lattice -----------------

function makeFakeGpu() {
  const created: Array<{ size: number; destroyed: boolean; write: ReturnType<typeof vi.fn>; read: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }> = [];
  const createBuffer = vi.fn((size: number) => {
    const b = {
      size,
      destroyed: false,
      write: vi.fn(() => {}),
      read: vi.fn(async () => new ArrayBuffer(size)),
      destroy: vi.fn(() => {
        b.destroyed = true;
      }),
    };
    created.push(b);
    return b;
  });
  const compileKernel = vi.fn(() => ({ label: 'k', compilationInfo: async () => [] }));
  const run = vi.fn(() => true);
  const gpu = {
    available: true,
    backend: 'native' as const,
    createBuffer,
    compileKernel,
    run,
  } as unknown as GpuComputeApi;
  return { gpu, created, createBuffer, compileKernel, run };
}

describe('fluid GPU resource reuse', () => {
  it('allocates buffers / compiles kernels once across batches and frees on destroy', async () => {
    const plugin = new FluidPlugin();
    await plugin.init(fakeApi());
    const { gpu, created, createBuffer, compileKernel } = makeFakeGpu();
    const advance = (plugin as unknown as {
      gpuAdvance: (g: GpuComputeApi, steps: number) => Promise<boolean>;
    }).gpuAdvance;

    expect(await advance.call(plugin, gpu, 2)).toBe(true);
    expect(createBuffer).toHaveBeenCalledTimes(5);
    expect(compileKernel).toHaveBeenCalledTimes(3);

    // Second batch: same lattice size — reuse everything (old code rebuilt
    // five buffers and recompiled three kernels every single frame).
    expect(await advance.call(plugin, gpu, 2)).toBe(true);
    expect(createBuffer).toHaveBeenCalledTimes(5);
    expect(compileKernel).toHaveBeenCalledTimes(3);
    expect(created.every((b) => !b.destroyed)).toBe(true);

    await plugin.destroy();
    expect(created.every((b) => b.destroyed)).toBe(true);
  });
});

describe('wave GPU resource reuse', () => {
  it('allocates six buffers / one kernel once and frees on destroy', async () => {
    const plugin = new WavePlugin();
    await plugin.init(fakeApi());
    const { gpu, created, createBuffer, compileKernel } = makeFakeGpu();
    const advance = (plugin as unknown as {
      gpuAdvance: (g: GpuComputeApi, steps: number) => Promise<boolean>;
    }).gpuAdvance;

    expect(await advance.call(plugin, gpu, 2)).toBe(true);
    expect(createBuffer).toHaveBeenCalledTimes(6);
    expect(compileKernel).toHaveBeenCalledTimes(1);

    expect(await advance.call(plugin, gpu, 2)).toBe(true);
    expect(createBuffer).toHaveBeenCalledTimes(6);
    expect(compileKernel).toHaveBeenCalledTimes(1);

    await plugin.destroy();
    expect(created.every((b) => b.destroyed)).toBe(true);
  });
});

// ---- double-click ingest must not interleave two iterators -----------------

describe('chunk store double ingest of the same file', () => {
  it('only the latest run survives and DATA_INGESTED fires once', async () => {
    const entry: FileEntry = {
      id: 'f1',
      name: 'sample.csv',
      size: 24,
      mimeType: 'text/csv',
      format: 'csv',
      content: 'a,b\n1,2\n3,4\n5,6\n',
    };
    let ingested = 0;
    const sub = on(DATA_INGESTED, () => {
      ingested += 1;
    });
    useChunkStore.getState().reset();
    try {
      // Two synchronous starts simulate a fast double click on "Preview".
      const a = useChunkStore.getState().startIngest(entry, 2);
      const b = useChunkStore.getState().startIngest(entry, 2);
      await Promise.all([a, b]);

      const s = useChunkStore.getState().state;
      expect(s).not.toBeNull();
      expect(s!.runId).toBe(2);
      expect(s!.done).toBe(true);
      expect(s!.running).toBe(false);
      expect(ingested).toBe(1);
    } finally {
      sub.unsubscribe();
      useChunkStore.getState().reset();
    }
  });
});
