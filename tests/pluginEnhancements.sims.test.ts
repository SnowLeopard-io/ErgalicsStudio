// Regression + feature tests for the simulation-viewer builtins' export /
// reset enhancements:
//   - targeted plugins expose one-click data CSV buttons with zh/en labels;
//   - CSV export fires in BOTH emission shapes (host action object
//     `{ key: { action: key } }` and the plain test/worker call `{ key: true }`)
//     and never touches the plugin's running state;
//   - CSV export is refused (with a notification) before data exists;
//   - electromag / optics offer reset buttons restoring the loaded scene.
//
// Plugin-level PNG snapshot export was removed from every plugin: the
// canvas-level unified export menu handles PNG now, so no plugin declares
// an exportPng button.
//
// ai-training cannot run tf.js in node, so its history is injected directly.
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { NBodyPlugin } from '@/plugins/builtin/physics/nbody/plugin';
import { FluidPlugin } from '@/plugins/builtin/physics/fluid/plugin';
import { WavePlugin } from '@/plugins/builtin/physics/wave/plugin';
import { DoublePendulumPlugin } from '@/plugins/builtin/physics/pendulum/plugin';
import { AITrainingPlugin } from '@/plugins/builtin/data/ai-training/plugin';
import { ElectromagPlugin } from '@/plugins/builtin/physics/electromag/plugin';
import { OpticsPlugin } from '@/plugins/builtin/physics/optics/plugin';
import { StructurePlugin } from '@/plugins/builtin/engineering/structure/plugin';
import { PointCloudPlugin } from '@/plugins/builtin/charts/pointCloud/plugin';
import { PointCloud3DPlugin } from '@/plugins/builtin/charts/pointCloud3D/plugin';
import { ParticlePlugin } from '@/plugins/builtin/physics/particles/plugin';
import { ProteinPlugin } from '@/plugins/builtin/bio/protein/plugin';
import type { ParamDefinition, Plugin, PluginApi } from '@/types/plugin';

type MockFn = ReturnType<typeof vi.fn>;

// The animation loops schedule frames; node has no rAF.
beforeAll(() => {
  (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = () => 1;
  (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = () => undefined;
});

// ---- harness ---------------------------------------------------------------

type Harness<P extends Plugin = Plugin> = {
  plugin: P;
  api: PluginApi;
  exportFile: MockFn;
  notify: MockFn;
};

function makeApi() {
  const exportFile = vi.fn();
  const notify = vi.fn();
  const api = {
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
  } as unknown as PluginApi;
  return { api, exportFile, notify };
}

async function fresh<P extends Plugin>(Ctor: { new (): P }): Promise<Harness<P>> {
  const { api, exportFile, notify } = makeApi();
  const plugin = new Ctor();
  await plugin.init(api);
  return { plugin, api, exportFile, notify };
}

function buttonDefs(plugin: Plugin): ParamDefinition[] {
  // All targeted plugins return the definitions synchronously.
  return plugin.getParams() as ParamDefinition[];
}

function assertActionButton(plugin: Plugin, key: string): void {
  const def = buttonDefs(plugin).find((d) => d.key === key);
  expect(def, `missing button param ${key}`).toBeTruthy();
  expect(def!.type).toBe('button');
  const button = def as Extract<ParamDefinition, { type: 'button' }>;
  expect(button.action).toBe(key);
  expect(def!.labelI18n?.['en-US']).toBeTruthy();
  expect(def!.labelI18n?.['zh-CN']).toBeTruthy();
}

async function expectCsvExported(spy: MockFn): Promise<string> {
  expect(spy).toHaveBeenCalledTimes(1);
  const [name, blob, mime] = spy.mock.calls[0] as [string, Blob, string];
  expect(name).toMatch(/\.csv$/);
  expect(blob).toBeInstanceOf(Blob);
  expect(mime).toContain('csv');
  return blob.text();
}

// ---- sample files ----------------------------------------------------------

function nbodyFile(): File {
  return new File(
    [
      JSON.stringify({
        bodies: [
          { x: 0, y: 0, z: 0, vx: 0.1, vy: 0, vz: 0, mass: 1 },
          { x: 1, y: 1, z: 1, vx: 0, vy: 0.1, vz: 0, mass: 2 },
          { x: -1, y: 0.5, z: 0.2, vx: 0, vy: 0, vz: -0.1, mass: 1 },
        ],
      }),
    ],
    'nbody.json',
  );
}

function fluidFile(): File {
  const values = Array.from({ length: 32 }, () => new Array<number>(48).fill(0));
  for (let y = 12; y < 20; y += 1) for (let x = 18; x < 30; x += 1) values[y]![x] = 1;
  return new File([JSON.stringify({ values })], 'mask.json');
}

function waveFile(): File {
  const u = Array.from({ length: 24 }, (_, y) =>
    Array.from({ length: 32 }, (_, x) => Math.exp(-((x - 16) ** 2 + (y - 12) ** 2) / 20)),
  );
  return new File([JSON.stringify({ u })], 'wave.json');
}

function pendulumFile(): File {
  return new File([JSON.stringify({ th1: 30, th2: 60 })], 'ic.json');
}

function particlesFile(): File {
  return new File(['0 0 1 1\n1 1 2 2\n2 2 3 3\n'], 'particles.dat');
}

function structureFile(): File {
  return new File(
    [
      JSON.stringify({
        nodes: [
          { x: 0.2, y: 0.5, fixed: true },
          { x: 0.5, y: 0.9 },
          { x: 0.8, y: 0.5, fixed: true },
        ],
        members: [
          { a: 0, b: 1 },
          { a: 1, b: 2 },
        ],
      }),
    ],
    'truss.json',
  );
}

function proteinFile(): File {
  const proteins = [
    { id: 'p0', name: 'p0' },
    { id: 'p1', name: 'p1' },
    { id: 'p2', name: 'p2' },
    { id: 'p3', name: 'p3' },
  ];
  return new File([JSON.stringify({ proteins, interactions: [] })], 'protein.json');
}

/** Star network: p0 connects to every leaf → p0 is the unique degree-z hub. */
function proteinStarFile(): File {
  const proteins = [
    { id: 'p0', name: 'p0' },
    { id: 'p1', name: 'p1' },
    { id: 'p2', name: 'p2' },
    { id: 'p3', name: 'p3' },
    { id: 'p4', name: 'p4' },
    { id: 'p5', name: 'p5' },
  ];
  const interactions = [1, 2, 3, 4, 5].map((b) => ({ a: 0, b, weight: 1 }));
  return new File([JSON.stringify({ proteins, interactions })], 'star.json');
}

function pointsFile(): File {
  return new File(['0 0 1\n1 1 2\n2 2 3\n'], 'cloud.xyz');
}

function electromagFile(): File {
  return new File(
    [
      JSON.stringify({
        B: 1.2,
        charges: [
          { x: 0.3, y: 0.4, q: 1 },
          { x: 0.6, y: 0.6, q: -1 },
        ],
      }),
    ],
    'charges.json',
  );
}

function opticsFile(): File {
  return new File(
    [
      JSON.stringify({
        source: { x: 0.1, y: 0.5 },
        lensX: 0.5,
        screenX: 0.8,
        lensType: 'convex',
        focal: 120,
        prism: false,
        screen: true,
      }),
    ],
    'optics.json',
  );
}

function aiCsvFile(): File {
  return new File(['a,b,y\n1,2,0\n2,3,1\n3,4,0\n4,5,1\n5,6,1\n'], 'linear.csv');
}

// ---- n-body ---------------------------------------------------------------

describe('nbody export buttons', () => {
  it('exposes the localized CSV button (no plugin-level PNG export)', async () => {
    const { plugin } = await fresh(NBodyPlugin);
    expect(buttonDefs(plugin).some((d) => d.key === 'exportPng')).toBe(false);
    assertActionButton(plugin, 'exportCsv');
  });

  it('exports the bodies as CSV after loading and refuses before loading', async () => {
    const empty = await fresh(NBodyPlugin);
    empty.plugin.updateParams({ exportCsv: true });
    expect(empty.exportFile).not.toHaveBeenCalled();
    expect(empty.notify).toHaveBeenCalledWith('warning', expect.any(String));

    const h = await fresh(NBodyPlugin);
    await h.plugin.loadData(nbodyFile());
    h.plugin.updateParams({ exportCsv: { action: 'exportCsv' } });
    const text = await expectCsvExported(h.exportFile);
    expect(text).toContain('x,y,z,vx,vy,vz,mass');
    expect(text.split(/\r?\n/)).toHaveLength(4);

    // A second, plain-boolean emission must work the same way.
    h.exportFile.mockClear();
    h.plugin.updateParams({ exportCsv: true });
    expect(h.exportFile).toHaveBeenCalledTimes(1);
  });

  it('does not stop a running simulation on export', async () => {
    const h = await fresh(NBodyPlugin);
    await h.plugin.loadData(nbodyFile());
    const state = h.plugin as unknown as { state: { running: boolean } };
    h.plugin.updateParams({ start: true });
    expect(state.state.running).toBe(true);
    h.plugin.updateParams({ exportCsv: true });
    expect(state.state.running).toBe(true);
    h.plugin.updateParams({ start: false });
    expect(state.state.running).toBe(false);
  });
});

// ---- fluid ----------------------------------------------------------------

describe('fluid export buttons', () => {
  it('exposes the localized CSV button (no plugin-level PNG export)', async () => {
    const { plugin } = await fresh(FluidPlugin);
    expect(buttonDefs(plugin).some((d) => d.key === 'exportPng')).toBe(false);
    assertActionButton(plugin, 'exportCsv');
  });

  it('refuses field CSV before a mask is loaded', async () => {
    const h = await fresh(FluidPlugin);
    h.plugin.updateParams({ exportCsv: true });
    expect(h.exportFile).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith('warning', expect.any(String));
  });

  it('exports the macroscopic field as CSV after loading', async () => {
    const h = await fresh(FluidPlugin);
    await h.plugin.loadData(fluidFile());
    h.plugin.updateParams({ exportCsv: true });
    const text = await expectCsvExported(h.exportFile);
    expect(text).toContain('x,y,rho,ux,uy');
    expect(text.split(/\r?\n/).length).toBeGreaterThan(2);
  });

  it('does not stop a running simulation on export', async () => {
    const h = await fresh(FluidPlugin);
    await h.plugin.loadData(fluidFile());
    const state = h.plugin as unknown as { state: { running: boolean } };
    h.plugin.updateParams({ start: true });
    expect(state.state.running).toBe(true);
    h.plugin.updateParams({ exportCsv: true });
    expect(state.state.running).toBe(true);
    h.plugin.updateParams({ start: false });
  });
});

// ---- wave -----------------------------------------------------------------

describe('wave export buttons', () => {
  it('exposes the localized CSV button (no plugin-level PNG export)', async () => {
    const { plugin } = await fresh(WavePlugin);
    expect(buttonDefs(plugin).some((d) => d.key === 'exportPng')).toBe(false);
    assertActionButton(plugin, 'exportCsv');
  });

  it('exports the wave field CSV after loading and refuses before', async () => {
    const empty = await fresh(WavePlugin);
    empty.plugin.updateParams({ exportCsv: true });
    expect(empty.exportFile).not.toHaveBeenCalled();

    const h = await fresh(WavePlugin);
    await h.plugin.loadData(waveFile());
    h.plugin.updateParams({ exportCsv: true });
    const text = await expectCsvExported(h.exportFile);
    expect(text).toContain('x,y,u');
  });
});

// ---- double pendulum ------------------------------------------------------

describe('double pendulum export buttons', () => {
  it('exposes the localized CSV button (no plugin-level PNG export)', async () => {
    const { plugin } = await fresh(DoublePendulumPlugin);
    expect(buttonDefs(plugin).some((d) => d.key === 'exportPng')).toBe(false);
    assertActionButton(plugin, 'exportCsv');
  });

  it('exports no trace CSV before loading, then the seeded t=0 row', async () => {
    const empty = await fresh(DoublePendulumPlugin);
    empty.plugin.updateParams({ exportCsv: true });
    expect(empty.exportFile).not.toHaveBeenCalled();

    const h = await fresh(DoublePendulumPlugin);
    await h.plugin.loadData(pendulumFile());
    h.plugin.updateParams({ exportCsv: true });
    const text = await expectCsvExported(h.exportFile);
    expect(text).toContain('t,th1,th2');
    // Header + the single seeded trace row [0, th1, th2].
    expect(text.split(/\r?\n/)).toHaveLength(2);
  });
});

// ---- geo map --------------------------------------------------------------
// geoMap no longer declares any export button: PNG moved to the canvas-level
// unified export menu and it never had a CSV export.

// ---- ai training ----------------------------------------------------------

describe('ai-training metrics export button', () => {
  it('exposes the localized metrics CSV button', async () => {
    const { plugin } = await fresh(AITrainingPlugin);
    assertActionButton(plugin, 'exportCsv');
  });

  it('loads a CSV dataset without starting training', async () => {
    const h = await fresh(AITrainingPlugin);
    await expect(h.plugin.loadData(aiCsvFile())).resolves.toBeUndefined();
  });

  it('does not export metrics before training produced history', async () => {
    const h = await fresh(AITrainingPlugin);
    h.plugin.updateParams({ exportCsv: true });
    expect(h.exportFile).not.toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith('warning', expect.any(String));
  });

  it('exports per-epoch history (including missing accuracy)', async () => {
    const h = await fresh(AITrainingPlugin);
    const internal = h.plugin as unknown as {
      status: { history: Array<{ epoch: number; loss: number; accuracy?: number }> };
    };
    internal.status.history = [
      { epoch: 1, loss: 0.5, accuracy: 0.9 },
      { epoch: 2, loss: 0.4 },
    ];
    h.plugin.updateParams({ exportCsv: { action: 'exportCsv' } });
    const text = await expectCsvExported(h.exportFile);
    expect(text).toContain('epoch,loss,accuracy');
    expect(text).toContain('1,0.5,0.9');
    expect(text).toContain('2,0.4,');
  });
});

// ---- electromag -----------------------------------------------------------

describe('electromag reset + export buttons', () => {
  it('exposes the localized reset-charges button (no CSV, no plugin-level PNG)', async () => {
    const h = await fresh(ElectromagPlugin);
    assertActionButton(h.plugin, 'resetCharges');
    expect(buttonDefs(h.plugin).some((d) => d.key === 'exportCsv')).toBe(false);
    expect(buttonDefs(h.plugin).some((d) => d.key === 'exportPng')).toBe(false);
  });

  it('warns when reset is pressed with no loaded scene', async () => {
    const h = await fresh(ElectromagPlugin);
    h.plugin.updateParams({ resetCharges: true });
    expect(h.notify).toHaveBeenCalledWith('warning', expect.any(String));
  });

  it('restores the loaded charges after they have moved', async () => {
    const h = await fresh(ElectromagPlugin);
    await h.plugin.loadData(electromagFile());
    const internal = h.plugin as unknown as { charges: Array<{ x: number; y: number }> };
    const original = internal.charges.map((c) => ({ x: c.x, y: c.y }));
    internal.charges[0]!.x = -999;
    h.plugin.updateParams({ resetCharges: { action: 'resetCharges' } });
    expect(internal.charges.map((c) => ({ x: c.x, y: c.y }))).toEqual(original);
  });
});

// ---- optics ---------------------------------------------------------------

describe('optics reset + export buttons', () => {
  it('exposes the localized reset-elements button (no plugin-level PNG export)', async () => {
    const h = await fresh(OpticsPlugin);
    assertActionButton(h.plugin, 'resetElements');
    expect(buttonDefs(h.plugin).some((d) => d.key === 'exportPng')).toBe(false);
  });

  it('warns when reset is pressed with no loaded layout', async () => {
    const h = await fresh(OpticsPlugin);
    h.plugin.updateParams({ resetElements: true });
    expect(h.notify).toHaveBeenCalledWith('warning', expect.any(String));
  });

  it('restores the loaded element arrangement', async () => {
    const h = await fresh(OpticsPlugin);
    await h.plugin.loadData(opticsFile());
    const internal = h.plugin as unknown as {
      lensX: number;
      source: { x: number; y: number };
      state: { focal: number; lensType: string };
    };
    const snapshot = {
      lensX: internal.lensX,
      source: { ...internal.source },
      focal: internal.state.focal,
      lensType: internal.state.lensType,
    };
    internal.lensX = 1;
    internal.source = { x: 2, y: 3 };
    internal.state.focal = 7;
    internal.state.lensType = 'concave';
    h.plugin.updateParams({ resetElements: true });
    expect(internal.lensX).toBe(snapshot.lensX);
    expect(internal.source).toEqual(snapshot.source);
    expect(internal.state.focal).toBe(snapshot.focal);
    expect(internal.state.lensType).toBe(snapshot.lensType);
  });
});

// ---- structure ------------------------------------------------------------

describe('structure export buttons', () => {
  it('exposes the localized CSV button (no plugin-level PNG export)', async () => {
    const { plugin } = await fresh(StructurePlugin);
    expect(buttonDefs(plugin).some((d) => d.key === 'exportPng')).toBe(false);
    assertActionButton(plugin, 'exportCsv');
  });

  it('refuses members CSV before a truss is loaded', async () => {
    const h = await fresh(StructurePlugin);
    h.plugin.updateParams({ exportCsv: true });
    expect(h.exportFile).not.toHaveBeenCalled();
  });

  it('exports the member table after loading (id, nodeA, nodeB, length, force)', async () => {
    const h = await fresh(StructurePlugin);
    await h.plugin.loadData(structureFile());
    h.plugin.updateParams({ exportCsv: true });
    const text = await expectCsvExported(h.exportFile);
    expect(text).toContain('id,nodeA,nodeB,length,force');
    expect(text).toContain('1,0,1,');
    expect(text).toContain('2,1,2,');
  });
});

// ---- point cloud 2-D ------------------------------------------------------

describe('point cloud 2-D export buttons', () => {
  it('exposes the localized CSV button (no plugin-level PNG export)', async () => {
    const { plugin } = await fresh(PointCloudPlugin);
    expect(buttonDefs(plugin).some((d) => d.key === 'exportPng')).toBe(false);
    assertActionButton(plugin, 'exportCsv');
  });

  it('exports x/y rows (no z column) and accepts both emission shapes', async () => {
    const empty = await fresh(PointCloudPlugin);
    empty.plugin.updateParams({ exportCsv: true });
    expect(empty.exportFile).not.toHaveBeenCalled();

    const h = await fresh(PointCloudPlugin);
    await h.plugin.loadData(pointsFile());
    h.plugin.updateParams({ exportCsv: { action: 'exportCsv' } });
    const text = await expectCsvExported(h.exportFile);
    expect(text).toContain('x,y');
    expect(text).not.toContain('x,y,z');
    expect(text).toContain('1,1');
    expect(text.split(/\r?\n/)).toHaveLength(4);
  });
});

// ---- point cloud 3-D ------------------------------------------------------

describe('point cloud 3-D export buttons', () => {
  it('exposes the localized CSV button (no plugin-level PNG export)', async () => {
    const { plugin } = await fresh(PointCloud3DPlugin);
    expect(buttonDefs(plugin).some((d) => d.key === 'exportPng')).toBe(false);
    assertActionButton(plugin, 'exportCsv');
  });

  it('exports x/y/z rows from the position buffer', async () => {
    const empty = await fresh(PointCloud3DPlugin);
    empty.plugin.updateParams({ exportCsv: true });
    expect(empty.exportFile).not.toHaveBeenCalled();

    const h = await fresh(PointCloud3DPlugin);
    await h.plugin.loadData(pointsFile());
    h.plugin.updateParams({ exportCsv: true });
    const text = await expectCsvExported(h.exportFile);
    expect(text).toContain('x,y,z');
    expect(text).toContain('0,0,1');
    expect(text).toContain('2,2,3');
  });
});

// ---- particles ------------------------------------------------------------

describe('particles export buttons', () => {
  it('exposes the localized CSV button (no plugin-level PNG export)', async () => {
    const { plugin } = await fresh(ParticlePlugin);
    expect(buttonDefs(plugin).some((d) => d.key === 'exportPng')).toBe(false);
    assertActionButton(plugin, 'exportCsv');
  });

  it('exports the particles (x, y, vx, vy) after loading and refuses before', async () => {
    const empty = await fresh(ParticlePlugin);
    empty.plugin.updateParams({ exportCsv: true });
    expect(empty.exportFile).not.toHaveBeenCalled();

    const h = await fresh(ParticlePlugin);
    await h.plugin.loadData(particlesFile());
    h.plugin.updateParams({ exportCsv: true });
    const text = await expectCsvExported(h.exportFile);
    expect(text).toContain('x,y,vx,vy');
    // The loader normalizes every column by the largest |position| (2 here),
    // so the first row 0,0,1,1 is exported as 0,0,0.5,0.5.
    expect(text).toContain('0,0,0.5,0.5');
    expect(text.split(/\r?\n/)).toHaveLength(4);
  });
});

// ---- protein --------------------------------------------------------------

describe('protein export buttons', () => {
  it('exposes the localized CSV button (no plugin-level PNG export)', async () => {
    const { plugin } = await fresh(ProteinPlugin);
    expect(buttonDefs(plugin).some((d) => d.key === 'exportPng')).toBe(false);
    assertActionButton(plugin, 'exportCsv');
  });

  it('exports node rows (id, name, degree, module, hub, x, y) after loading and refuses before', async () => {
    const empty = await fresh(ProteinPlugin);
    empty.plugin.updateParams({ exportCsv: true });
    expect(empty.exportFile).not.toHaveBeenCalled();

    const h = await fresh(ProteinPlugin);
    await h.plugin.loadData(proteinFile());
    h.plugin.updateParams({ exportCsv: true });
    const text = await expectCsvExported(h.exportFile);
    expect(text).toContain('id,name,degree,module,hub,x,y');
    expect(text).toContain('p0,p0,');
  });

  it('stamps the center of a star network as the hub in the exported rows', async () => {
    const h = await fresh(ProteinPlugin);
    await h.plugin.loadData(proteinStarFile());
    h.plugin.updateParams({ exportCsv: true });
    const text = await expectCsvExported(h.exportFile);
    // p0 has degree 5 → the single degree-z hub; leaves are not hubs.
    expect(text).toContain('p0,p0,5,0,hub,');
    expect(text).toContain('\r\np1,p1,1,0,,');
  });
});
