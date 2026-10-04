// ==========================================================================
// Example plugin: 3-D plume dispersion — real CFD
//
// The analytic Gaussian-plume voxel view grew a genuine fluid solver: an
// incompressible Navier–Stokes "Stable Fluids" scheme (semi-Lagrangian
// advection + Gauss-Seidel pressure projection, see ./cfd.ts) drives a smoke
// density field from a continuous stack inflow with thermal buoyancy and an
// ambient wind. The concentration isosurface is meshed every frame with
// three's MarchingCubes (smooth surface instead of voxel blocks); the solver
// state feeds a downwind cross-section and a canvas-texture panel that
// overlays the CFD centreline against the analytic Gaussian plume with peak
// positions and a normalised RMSE — the same verify-culture as the
// fluid-cfd-coupler's verify view.
//
// Pure helpers kept for the test suite: `computePlumeField` (the analytic
// reference) and `parseConcCsv` (external x,y,z,conc fields, rendered through
// the same MarchingCubes path). The rAF tick starts on activate and is
// cancelled on deactivate/destroy, with geometry/material disposal — the
// host scene is shared between 3-D plugins.
// ==========================================================================

import * as THREE from 'three';
import { MarchingCubes } from 'three/examples/jsm/objects/MarchingCubes.js';
import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, Scene3DHandle } from '@/types/plugin';
import { plumeConcentration, type StabilityClass } from './envCore';
import { setScienceOutputs, clearScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { actionButton, actionFired, exportSnapshotPng, notify } from '@/core/plugin-tools/enhance';
import { buildTerrainMesh } from '../geo/terrain3d';
import type { AscGrid } from '../geo/terrain';
import { FluidSolver, PRESSURE_ITERATIONS, RESOLUTION_PRESETS, type CfdQuality, type CfdSourceSpec } from './cfd';
import { LabelSet } from './label3d';
import { plume3dManifest } from './plume3dManifest';

// ---- physical + world-space extents ----------------------------------------

const X_MAX = 10000; // m downwind
const Y_MAX = 2000; // m crosswind
const Z_MAX = 600; // m vertical

/** World-space compute-domain box (three.js units, Y-up) — the plume and the
 * section live inside it; the analytic compare quotes metres separately. */
const DOM_W = 1.9;
const DOM_H = 0.62;
const DOM_D = 0.9;
const DOM_X0 = -0.75;
const DOM_Y0 = 0.06;
const DOM_CX = DOM_X0 + DOM_W / 2;
const DOM_CY = DOM_Y0 + DOM_H / 2;

/** m/s wind → cells/step (teaching tuning, not physics). */
const WIND_SCALE = 0.15;
/** Solver substeps per frame (cap 2). */
const SUBSTEPS = 2;
/** Stack-top downwind cell (a little off the inflow face). */
const STACK_I = 2;

// ---- analytic reference + CSV import (exported for tests) -------------------

export interface VoxelField3D {
  nx: number;
  ny: number;
  nz: number;
  c: Float64Array;
  cMax: number;
}

/** Gaussian plume sampled at cell centres (μq/s → μg/m³ with Q in μg/s). */
export function computePlumeField(q: number, u: number, cls: StabilityClass, stackH: number, dim: number): VoxelField3D {
  const nx = dim;
  const ny = Math.max(8, Math.round(dim / 2));
  const nz = Math.max(6, Math.round(dim / 3));
  const c = new Float64Array(nx * ny * nz);
  let cMax = 0;
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const x = ((i + 0.5) / nx) * X_MAX;
        const y = ((j + 0.5) / ny - 0.5) * 2 * Y_MAX;
        const z = ((k + 0.5) / nz) * Z_MAX;
        const v = plumeConcentration(q, u, cls, stackH, x, y, z);
        c[(k * ny + j) * nx + i] = v;
        if (v > cMax) cMax = v;
      }
    }
  }
  return { nx, ny, nz, c, cMax };
}

/** Optional `x,y,z,conc` override (any unit) — normalised onto a 24³ grid. */
export function parseConcCsv(text: string): VoxelField3D | null {
  const rows = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
  if (rows.length < 8) return null;
  const vals: Array<[number, number, number, number]> = [];
  for (const line of rows) {
    const cells = line.split(/[,;\t]+/).map((s) => s.trim());
    const nums = cells.map((s) => Number(s));
    if (nums.length < 4 || nums.slice(0, 4).some((n) => !Number.isFinite(n))) continue;
    if (nums[0]! < 0 || nums[1]! < 0 || nums[2]! < 0) continue;
    vals.push([nums[0]!, nums[1]!, nums[2]!, Math.max(0, nums[3]!)]);
  }
  if (vals.length < 8) return null;
  const maxX = Math.max(...vals.map((v) => v[0]), 1);
  const maxY = Math.max(...vals.map((v) => v[1]), 1);
  const maxZ = Math.max(...vals.map((v) => v[2]), 1);
  const nx = 24;
  const ny = 24;
  const nz = 24;
  const c = new Float64Array(nx * ny * nz);
  let cMax = 0;
  for (const [x, y, z, conc] of vals) {
    const i = Math.min(nx - 1, Math.floor((x / maxX) * nx));
    const j = Math.min(ny - 1, Math.floor((y / maxY) * ny));
    const k = Math.min(nz - 1, Math.floor((z / maxZ) * nz));
    const idx = (k * ny + j) * nx + i;
    const cur = c[idx] ?? 0;
    const v = cur + conc;
    c[idx] = v;
    if (v > cMax) cMax = v;
  }
  return { nx, ny, nz, c, cMax };
}

/** Gentle synthetic teaching DEM (sin hills), shared geometry with the geo terrain builder. */
function syntheticDem(n = 40): AscGrid {
  const values = new Float64Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      values[y * n + x] =
        90 +
        55 * Math.sin((x / n) * Math.PI * 2 + 0.7) * Math.cos((y / n) * Math.PI * 1.5) +
        30 * Math.sin((x / n) * Math.PI * 5.3);
    }
  }
  return { ncols: n, nrows: n, xllcorner: 0, yllcorner: 0, cellsize: 10, nodata: -9999, values };
}

// ---- Plugin ----------------------------------------------------------------

interface State {
  q: number;
  u: number;
  cls: StabilityClass;
  stackH: number;
  dim: CfdQuality;
  showSection: boolean;
  /** Overlay the analytic Gaussian centreline against the CFD one. */
  compareGauss: boolean;
  /** Run the solver (false = pause). */
  play: boolean;
  thresholdT: number; // isosurface threshold, fraction of the smoke peak
  /** When set, the CSV field replaces the live simulation. */
  custom: VoxelField3D | null;
}

const DEFAULTS: State = {
  q: 100,
  u: 4,
  cls: 'C',
  stackH: 50,
  dim: '48',
  showSection: false,
  compareGauss: true,
  play: true,
  thresholdT: 0.05,
  custom: null,
};

const CFD_COLOR = '#f5a25a';
const GAUSS_COLOR = '#58a6d6';

/** Restrained scientific ramp for the ground panels: deep blue-grey (low)
 * through slate and tan to amber / burnt orange (high) — replaces the
 * rainbow so the terrain never competes with the plume for attention. */
const GROUND_STOPS: Array<[number, number, number]> = [
  [38, 48, 66],
  [88, 100, 116],
  [172, 158, 126],
  [224, 160, 66],
  [192, 78, 38],
];

function groundRamp3(t: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, t));
  const seg = x * (GROUND_STOPS.length - 1);
  const i = Math.min(GROUND_STOPS.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = GROUND_STOPS[i]!;
  const b = GROUND_STOPS[i + 1]!;
  return [(a[0] + f * (b[0] - a[0])) / 255, (a[1] + f * (b[1] - a[1])) / 255, (a[2] + f * (b[2] - a[2])) / 255];
}

export class Plume3DPlugin implements Plugin {
  readonly manifest = plume3dManifest;
  private api!: PluginApi;
  private three: Scene3DHandle | null = null;
  private group: THREE.Group | null = null;
  /** Fit the camera only on first show / re-activation — never yank it back
   * while the user is orbiting or dragging parameter sliders. */
  private needsFit = true;
  private rafId = 0;
  private frame = 0;

  private state: State = { ...DEFAULTS };
  private solver: FluidSolver | null = null;
  private densMaxSm = 0; // smoothed smoke peak (steady isosurface threshold)
  private nanNotified = false;
  /** Bilingual scene annotations (stack / domain / isosurface / ground). */
  private labels = new LabelSet();

  // scene refs (all owned by `group`, cleared with it)
  private mc: MarchingCubes | null = null;
  /** Fainter lower-threshold halo around the main isosurface (edge dissipation). */
  private mcOuter: MarchingCubes | null = null;
  private stackLabel: THREE.Sprite | null = null;
  private mcSize = 48;
  private mapI: Int32Array | null = null;
  private mapJ: Int32Array | null = null;
  private mapK: Int32Array | null = null;
  private mapSrc = '';
  private sectionMesh: THREE.Mesh | null = null;
  private sectionColors: THREE.BufferAttribute | null = null;
  private stackMesh: THREE.Mesh | null = null;
  private hudMesh: THREE.Mesh | null = null;
  private hudCanvas: HTMLCanvasElement | null = null;
  private hudCtx: CanvasRenderingContext2D | null = null;
  private hudTexture: THREE.CanvasTexture | null = null;

  async init(api: PluginApi) {
    this.api = api;
    api.onLocaleChange((l) => {
      this.labels.refresh(l === 'zh-CN' ? 'zh-CN' : 'en-US');
      this.redrawHud(); // guards itself when no panel exists yet
    });
    if (api.gpu) {
      api.log('info', `GPU compute surface: ${api.gpu.available ? api.gpu.backend : 'unavailable'} — the stable-fluids solver stays on CPU`);
    }
  }

  async destroy() {
    this.stopTick();
    this.clearGroup();
    this.three?.setVisible(false);
    this.three = null;
    this.solver = null;
    this.state.custom = null;
    clearScienceOutputs(this.manifest.id);
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.three = context.container.three ?? null;
    this.needsFit = true;
    this.rebuild();
  }

  /** Host-driven 3D wiring (mirrors the geo 3-D plugins). */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.needsFit = true;
    this.rebuild();
  }

  async deactivate() {
    this.stopTick();
    this.clearGroup();
    this.three?.setVisible(false);
  }

  render(container: ContainerCapabilities) {
    if (container.three) this.three = container.three;
    this.rebuild();
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'q', label: 'Source strength Q (g/s)', labelI18n: { 'zh-CN': '源强 Q（g/s）', 'en-US': 'Source strength Q (g/s)' }, type: 'number', min: 1, max: 10000, step: 10, value: this.state.q },
      { key: 'u', label: 'Wind speed u (m/s)', labelI18n: { 'zh-CN': '平均风速 u（m/s）', 'en-US': 'Wind speed u (m/s)' }, type: 'range', min: 0.5, max: 12, step: 0.5, value: this.state.u },
      {
        key: 'cls',
        label: 'Stability class',
        labelI18n: { 'zh-CN': '稳定度等级', 'en-US': 'Stability class' },
        type: 'select',
        value: this.state.cls,
        options: (['A', 'B', 'C', 'D', 'E', 'F'] as StabilityClass[]).map((c) => ({ value: c, label: c, labelI18n: { 'zh-CN': c, 'en-US': c } })),
      },
      { key: 'stackH', label: 'Effective stack height H (m)', labelI18n: { 'zh-CN': '有效源高 H（m）', 'en-US': 'Effective stack height H (m)' }, type: 'number', min: 5, max: 300, step: 5, value: this.state.stackH },
      {
        key: 'dim',
        label: 'Solver resolution',
        labelI18n: { 'zh-CN': '求解器分辨率', 'en-US': 'Solver resolution' },
        type: 'select',
        value: this.state.dim,
        hint: 'Stable-fluids grid (nx×ny×nz)',
        options: [
          { value: '32', label: 'Low · 32×32×24', labelI18n: { 'zh-CN': '低 · 32×32×24', 'en-US': 'Low · 32×32×24' } },
          { value: '48', label: 'Medium · 48×32×24', labelI18n: { 'zh-CN': '中 · 48×32×24', 'en-US': 'Medium · 48×32×24' } },
          { value: '64', label: 'High · 64×40×28', labelI18n: { 'zh-CN': '高 · 64×40×28', 'en-US': 'High · 64×40×28' } },
        ],
      },
      { key: 'threshold', label: 'Isosurface threshold', labelI18n: { 'zh-CN': '等值面阈值', 'en-US': 'Isosurface threshold' }, type: 'range', min: 0.01, max: 0.5, step: 0.005, value: this.state.thresholdT, hint: '× smoke peak' },
      { key: 'showSection', label: 'Show downwind cross-section', labelI18n: { 'zh-CN': '显示横切面', 'en-US': 'Show downwind cross-section' }, type: 'checkbox', value: this.state.showSection },
      { key: 'compareGauss', label: 'Compare analytic solution', labelI18n: { 'zh-CN': '对照解析解', 'en-US': 'Compare analytic solution' }, type: 'checkbox', value: this.state.compareGauss, hint: 'CFD vs Gaussian centreline' },
      {
        key: 'play',
        label: 'Simulation',
        labelI18n: { 'zh-CN': '仿真播放', 'en-US': 'Simulation' },
        type: 'toggle',
        value: this.state.play,
        offLabel: 'Play',
        onLabel: 'Pause',
        offLabelI18n: { 'zh-CN': '播放', 'en-US': 'Play' },
        onLabelI18n: { 'zh-CN': '暂停', 'en-US': 'Pause' },
      },
      actionButton('resetSim', 'Reset simulation', '重置仿真'),
      { key: 'reset', label: 'Reset to defaults', labelI18n: { 'zh-CN': '回到初始参数', 'en-US': 'Reset to defaults' }, type: 'button', action: 'reset' },
      actionButton('fitView', 'Fit view', '重置视角'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportPngTransparent', 'Snapshot PNG (transparent)', '快照 PNG（透明）'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    if (actionFired(params, 'exportPng')) {
      exportSnapshotPng(this.api, this.three?.snapshot() ?? null, 'env-plume3d');
      return;
    }
    if (actionFired(params, 'exportPngTransparent')) {
      exportSnapshotPng(this.api, this.three?.snapshot({ transparent: true }) ?? null, 'env-plume3d');
      return;
    }
    if (actionFired(params, 'fitView')) {
      this.fitCamera();
      return;
    }
    if (actionFired(params, 'reloadPlugin')) {
      notify(this.api, 'info', 'Resetting plugin…', '正在重置插件…');
      void this.api.reload?.();
      return;
    }
    if (actionFired(params, 'resetSim')) {
      this.solver?.reset();
      this.densMaxSm = 0;
      this.nanNotified = false;
      notify(this.api, 'success', 'Simulation reset', '仿真已重置');
      return;
    }
    if (actionFired(params, 'reset')) {
      this.state = { ...DEFAULTS };
      this.rebuild();
      return;
    }

    // Live source/wind/stability changes ride the running solver.
    if (typeof params.q === 'number' && params.q >= 1 && params.q !== this.state.q) this.state.q = params.q;
    if (typeof params.u === 'number' && params.u > 0 && params.u !== this.state.u) this.state.u = params.u;
    if (typeof params.cls === 'string' && /^[A-F]$/.test(params.cls) && params.cls !== this.state.cls) {
      this.state.cls = params.cls as StabilityClass;
    }
    if (typeof params.stackH === 'number' && params.stackH >= 5 && params.stackH !== this.state.stackH) {
      this.state.stackH = params.stackH;
      this.updateStack(); // chimney + source cell follow, the run continues
    }
    if (typeof params.dim === 'string' && params.dim in RESOLUTION_PRESETS && params.dim !== this.state.dim) {
      this.state.dim = params.dim as CfdQuality;
      this.rebuild(); // new grid → fresh solver
      return;
    }
    if (typeof params.threshold === 'number' && params.threshold !== this.state.thresholdT) {
      this.state.thresholdT = params.threshold; // read every frame
    }
    if (typeof params.showSection === 'boolean' && params.showSection !== this.state.showSection) {
      this.state.showSection = params.showSection;
      if (this.sectionMesh) {
        this.sectionMesh.visible = params.showSection;
        if (params.showSection) this.updateSection();
      }
    }
    if (typeof params.compareGauss === 'boolean' && params.compareGauss !== this.state.compareGauss) {
      this.state.compareGauss = params.compareGauss;
      if (this.hudMesh) {
        this.hudMesh.visible = params.compareGauss && !this.state.custom;
        if (params.compareGauss) this.redrawHud();
      }
    }
    if (typeof params.play === 'boolean' && params.play !== this.state.play) {
      this.state.play = params.play;
    }
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const field = parseConcCsv(await file.text());
    if (!field) {
      notify(this.api, 'warning', 'Expected x,y,z,conc rows (≥8)', '需要 x,y,z,conc 数据行（≥8 行）');
      return;
    }
    this.state.custom = field;
    this.api.reportDataScale(field.nx * field.ny * field.nz);
    notify(this.api, 'success', 'External concentration field loaded', '外部浓度场已加载');
    this.rebuild();
  }

  // ---- solver mapping --------------------------------------------------------

  private sourceK(): number {
    const res = RESOLUTION_PRESETS[this.state.dim];
    return Math.min(res.nz - 2, Math.max(1, Math.round((this.state.stackH / Z_MAX) * (res.nz - 1))));
  }

  private buildSourceSpec(): CfdSourceSpec {
    const res = RESOLUTION_PRESETS[this.state.dim];
    return {
      i: STACK_I,
      j: res.ny >> 1,
      k: this.sourceK(),
      wind: this.state.u * WIND_SCALE,
      densIn: Math.min(3, Math.max(0.2, 0.2 + this.state.q / 80)),
      heatIn: 1.0,
      exitV: 0.9,
      buoyancy: 0.06,
    };
  }

  /** Peak-relative isolation for the MarchingCubes surface (fast attack, slow decay). */
  private isolationValue(): number {
    const raw = this.state.custom ? this.state.custom.cMax : this.solver?.densMax ?? 0;
    this.densMaxSm = Math.max(raw, this.densMaxSm * 0.97);
    return Math.min(4, Math.max(0.008, this.state.thresholdT * this.densMaxSm));
  }

  /** Resampling maps sim (nx,ny,nz) → MarchingCubes cube of `size`³ (nearest). */
  private ensureMaps(snx: number, sny: number, snz: number): void {
    const key = `${snx}:${sny}:${snz}:${this.mcSize}`;
    if (this.mapSrc === key && this.mapI && this.mapJ && this.mapK) return;
    const axis = (src: number) => {
      const m = new Int32Array(this.mcSize);
      for (let a = 0; a < this.mcSize; a += 1) {
        m[a] = Math.min(src - 1, Math.round((a / (this.mcSize - 1)) * (src - 1)));
      }
      return m;
    };
    this.mapI = axis(snx);
    this.mapJ = axis(sny);
    this.mapK = axis(snz);
    this.mapSrc = key;
  }

  /** reset() → write density → isolation → update() on the MarchingCubes mesh. */
  private updateMcField(): void {
    const mc = this.mc;
    if (!mc) return;
    const custom = this.state.custom;
    const solver = this.solver;
    const src = custom ? custom.c : solver?.dens;
    if (!src) return;
    const snx = custom ? custom.nx : solver!.nx;
    const sny = custom ? custom.ny : solver!.ny;
    const snz = custom ? custom.nz : solver!.nz;
    this.ensureMaps(snx, sny, snz);

    mc.reset();
    const field = mc.field;
    const size = this.mcSize;
    const size2 = size * size;
    const mi = this.mapI!;
    const mj = this.mapJ!;
    const mk = this.mapK!;
    for (let mz = 0; mz < size; mz += 1) {
      const zBase = mk[mz]! * sny * snx;
      const offZ = mz * size2;
      for (let my = 0; my < size; my += 1) {
        const yBase = zBase + mj[my]! * snx;
        const off = offZ + my * size;
        for (let mx = 0; mx < size; mx += 1) {
          field[off + mx] = src[yBase + mi[mx]!]!;
        }
      }
    }
    mc.isolation = this.isolationValue();
    mc.update();
    // The halo reuses the same sampled field at a lower isolation — a bigger,
    // fainter envelope that sells the smoke's edge dissipation.
    const halo = this.mcOuter;
    if (halo) {
      halo.field.set(mc.field);
      halo.isolation = Math.max(0.004, mc.isolation * 0.45);
      halo.update();
    }
  }

  /** Sample the custom field at normalised (x,y,z) ∈ [0,1]³. */
  private sampleCustom(f: VoxelField3D, tx: number, ty: number, tz: number): number {
    const i = Math.min(f.nx - 1, Math.max(0, Math.floor(tx * f.nx)));
    const j = Math.min(f.ny - 1, Math.max(0, Math.floor(ty * f.ny)));
    const k = Math.min(f.nz - 1, Math.max(0, Math.floor(tz * f.nz)));
    return f.c[(k * f.ny + j) * f.nx + i] ?? 0;
  }

  /** Refresh the y=0 section colours from the active field. */
  private updateSection(): void {
    const attr = this.sectionColors;
    if (!attr) return;
    const custom = this.state.custom;
    const solver = this.solver;
    const norm = Math.max(custom ? custom.cMax : this.densMaxSm, 1e-9);
    const colors = attr.array as Float32Array;
    const snx = this.sectionNx;
    const snz = this.sectionNz;
    const srcNz = custom ? custom.nz : solver?.nz ?? 1;
    for (let k = 0; k <= snz; k += 1) {
      const tz = k / snz;
      const sk = Math.min(srcNz - 1, Math.round(tz * (srcNz - 1)));
      for (let i = 0; i <= snx; i += 1) {
        const tx = i / snx;
        let v: number;
        if (custom) {
          v = this.sampleCustom(custom, tx, 0.5, tz);
        } else if (solver) {
          const si = Math.min(solver.nx - 1, Math.round(tx * (solver.nx - 1)));
          v = solver.dens[(sk * solver.ny + (solver.ny >> 1)) * solver.nx + si] ?? 0;
        } else {
          v = 0;
        }
        const [r, g2, b] = groundRamp3(Math.min(1, Math.max(0, v / norm)));
        const o = (k * (snx + 1) + i) * 3;
        colors[o] = r;
        colors[o + 1] = g2;
        colors[o + 2] = b;
      }
    }
    attr.needsUpdate = true;
  }

  private sectionNx = 60;
  private sectionNz = 24;

  // ---- scientific outputs -----------------------------------------------------

  /**
   * Publish the domain parameters, the CFD-vs-analytic centreline agreement
   * and the grid-convergence note. `nrmse`/peaks are null while no live CFD
   * centreline exists (CSV import or paused start).
   */
  private publishScience(nrmse: number | null, peakCfdKm: number | null, peakGauKm: number | null): void {
    const zh = this.api.locale === 'zh-CN';
    const custom = this.state.custom;
    const res = RESOLUTION_PRESETS[this.state.dim];
    const grid = custom ? `${custom.nx}×${custom.ny}×${custom.nz} (imported)` : `${res.nx}×${res.ny}×${res.nz}`;
    const metrics: ScienceMetric[] = [
      {
        key: 'grid',
        label: 'GRID',
        value: `${grid} · GS×${PRESSURE_ITERATIONS}`,
        hint: zh
          ? 'Stable-fluids 网格（nx×ny×nz）与压力投影 Gauss-Seidel 迭代数'
          : 'stable-fluids grid (nx×ny×nz) and Gauss-Seidel pressure iterations',
      },
      {
        key: 'domain',
        label: 'DOMAIN',
        value: `${X_MAX / 1000}×${(2 * Y_MAX) / 1000}×${Z_MAX / 1000} km`,
        hint: zh ? '物理域尺寸：下风 × 侧风 × 垂直' : 'physical extent: downwind × crosswind × vertical',
      },
      {
        key: 'src',
        label: 'SRC/WIND',
        value: `Q=${this.state.q} g/s · u=${this.state.u} m/s · ${this.state.cls} · H=${this.state.stackH} m`,
        hint: zh ? '源强、风速、稳定度等级与有效源高' : 'source strength, wind speed, stability class, effective stack height',
      },
    ];
    if (nrmse !== null) {
      metrics.push({
        key: 'nrmse',
        label: 'nRMSE CFD-Gauss',
        value: `${(nrmse * 100).toFixed(1)}%`,
        severity: nrmse <= 0.35 ? 'ok' : 'warn',
        hint: zh
          ? 'CFD 与高斯解析解中心线（z=H，归一化）的归一化 RMSE；CFD 含湍流与数值扩散，偏差属预期'
          : 'normalised RMSE between CFD and the analytic Gaussian centreline (z=H, normalised); CFD turbulence and numerical diffusion make the offset expected',
      });
      if (peakCfdKm !== null && peakGauKm !== null) {
        metrics.push({
          key: 'peak',
          label: 'PEAK Δx',
          value: `${peakCfdKm.toFixed(1)} vs ${peakGauKm.toFixed(1)} km (Δ ${(peakCfdKm - peakGauKm).toFixed(1)})`,
          hint: zh ? 'CFD 与解析解的峰值下风距离及偏移' : 'peak downwind positions (CFD vs analytic) and their offset',
        });
      }
    }
    metrics.push({
      key: 'convergence',
      label: 'CONVERGENCE',
      value: this.state.dim,
      hint: zh
        ? '网格收敛注记：结果依赖分辨率；对比 低/中/高 预设，网格加密时中心线 nRMSE 应下降（教学注记，未内嵌系统性收敛研究）'
        : 'grid-convergence note: results are resolution-dependent; compare the Low/Medium/High presets — centreline nRMSE should drop as the grid refines (teaching note, no embedded convergence study)',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- HUD (CFD vs analytic centreline) --------------------------------------

  private redrawHud(): void {
    const ctx = this.hudCtx;
    const canvas = this.hudCanvas;
    if (!ctx || !canvas) return;
    const zh = this.api.locale === 'zh-CN';
    const W = canvas.width;
    const H = canvas.height;
    const font = (px: number) => `${px}px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10, 14, 20, 0.85)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#3d5a80';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    ctx.fillStyle = 'rgba(230,238,248,0.95)';
    ctx.font = font(14);
    ctx.textAlign = 'left';
    ctx.fillText(zh ? '中心线浓度对比（z = H，归一化）' : 'Centreline comparison (z = H, normalised)', 12, 22);

    // Sample both centreline profiles.
    const N = 64;
    const gau: number[] = [];
    const cfd: number[] = [];
    const solver = this.solver;
    const custom = this.state.custom;
    const live = !!solver && !custom;
    let cfdMax = 0;
    for (let s = 0; s < N; s += 1) {
      const t = s / (N - 1);
      gau.push(plumeConcentration(this.state.q * 1e6, this.state.u, this.state.cls, this.state.stackH, t * X_MAX, 0, this.state.stackH));
      if (solver && live) {
        const si = Math.round(t * (solver.nx - 1));
        const v = solver.dens[(this.sourceK() * solver.ny + (solver.ny >> 1)) * solver.nx + si] ?? 0;
        cfd.push(v);
        if (v > cfdMax) cfdMax = v;
      }
    }
    let gauMax = 0;
    for (const g of gau) if (g > gauMax) gauMax = g;
    const cfdOk = live && cfdMax > 0 && gauMax > 0;
    if (gauMax > 0) for (let s = 0; s < N; s += 1) gau[s] = gau[s]! / gauMax;
    if (cfdMax > 0) for (let s = 0; s < N; s += 1) cfd[s] = cfd[s]! / cfdMax;

    // Plot frame.
    const x0 = 46;
    const x1 = W - 14;
    const y0 = 34;
    const y1 = 186;
    ctx.strokeStyle = 'rgba(120,132,150,0.7)';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.fillStyle = 'rgba(150,165,185,0.9)';
    ctx.font = font(10);
    ctx.textAlign = 'center';
    for (let km = 0; km <= 10; km += 2) {
      ctx.fillText(`${km}`, x0 + (km / 10) * (x1 - x0), y1 + 12);
    }
    ctx.fillText(zh ? '下风距离 km' : 'downwind km', x1 - 18, y1 + 24);

    const drawCurve = (vals: number[], color: string) => {
      if (vals.length === 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let s = 0; s < vals.length; s += 1) {
        const px = x0 + (s / (vals.length - 1)) * (x1 - x0);
        const py = y1 - Math.min(1, Math.max(0, vals[s]!)) * (y1 - y0 - 6) - 3;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    };
    drawCurve(gau, GAUSS_COLOR);
    if (cfdOk) drawCurve(cfd, CFD_COLOR);

    // Legend.
    ctx.font = font(11);
    ctx.textAlign = 'left';
    const legend = (lx: number, color: string, label: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(lx, 40, 14, 3);
      ctx.fillText(label, lx + 18, 46);
    };
    if (cfdOk) legend(x1 - 150, CFD_COLOR, 'CFD');
    legend(x1 - 70, GAUSS_COLOR, zh ? '高斯解析' : 'Gaussian');

    // Footnote: peak positions + normalised RMSE.
    const peakOf = (vals: number[]) => {
      let best = 0;
      for (let s = 0; s < vals.length; s += 1) if (vals[s]! > vals[best]!) best = s;
      return ((best / Math.max(1, vals.length - 1)) * X_MAX) / 1000;
    };
    ctx.font = font(11);
    ctx.fillStyle = 'rgba(200,212,228,0.95)';
    if (!cfdOk) {
      ctx.fillText(zh ? 'CFD 曲线随仿真播放生成' : 'The CFD curve builds up while the simulation plays', 12, H - 34);
      this.publishScience(null, null, null);
    } else {
      let se = 0;
      for (let s = 0; s < N; s += 1) {
        const d = cfd[s]! - gau[s]!;
        se += d * d;
      }
      const nrmse = Math.sqrt(se / N);
      const pkCfd = peakOf(cfd);
      const pkGau = peakOf(gau);
      const text = zh
        ? `峰值 CFD @ ${pkCfd.toFixed(1)} km · 高斯 @ ${pkGau.toFixed(1)} km · 归一化 RMSE ${nrmse.toFixed(3)} · GS×${PRESSURE_ITERATIONS}`
        : `peak CFD @ ${pkCfd.toFixed(1)} km · Gaussian @ ${pkGau.toFixed(1)} km · nRMSE ${nrmse.toFixed(3)} · GS×${PRESSURE_ITERATIONS}`;
      ctx.fillText(text, 12, H - 34);
      this.publishScience(nrmse, pkCfd, pkGau);
    }
    // Explain the CFD-vs-analytic peak offset so the mismatch reads as
    // physics, not a bug.
    ctx.font = font(10);
    ctx.fillStyle = 'rgba(150,164,182,0.9)';
    if (zh) {
      ctx.fillText('注：CFD 含湍流/数值扩散且非稳态，峰值偏下游属预期；解析解假设理想稳态高斯烟羽', 12, H - 8);
    } else {
      ctx.fillText('Note: CFD includes turbulence, numerical diffusion and transient effects —', 12, H - 20);
      ctx.fillText('a downstream-shifted peak is expected; the analytic plume is idealised steady Gaussian.', 12, H - 8);
    }
    this.hudTexture!.needsUpdate = true;
  }

  // ---- scene assembly ----------------------------------------------------------

  private clearGroup() {
    if (!this.group) return;
    this.three?.scene.remove(this.group);
    // Dispose the label sprites (textures + materials) and detach them before
    // the mesh traverse — sprites share a module-level geometry that must not
    // be disposed here. LabelSet stays reusable for the next rebuild.
    this.labels.dispose();
    this.group.traverse((obj) => {
      const withGeo = obj as THREE.Mesh;
      withGeo.geometry?.dispose();
      const mat = (withGeo as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
    this.hudTexture?.dispose();
    this.mc = null;
    this.mcOuter = null;
    this.stackLabel = null;
    this.sectionMesh = null;
    this.sectionColors = null;
    this.stackMesh = null;
    this.hudMesh = null;
    this.hudCanvas = null;
    this.hudCtx = null;
    this.hudTexture = null;
    this.group = null;
  }

  private fitCamera() {
    if (!this.three) return;
    // Oblique "stack → plume → downwind" story view: ~35° azimuth, ~25°
    // elevation — the stack sits in the left third of the frame and the
    // plume drifts to the right, never a top-down carpet view.
    const target = new THREE.Vector3(DOM_CX, 0.3, 0);
    this.three.camera.position.set(1.7, 1.55, 2.15);
    this.three.camera.lookAt(target);
    this.three.controls.target.copy(target);
    this.three.controls.update?.();
    this.three.render();
  }

  private rebuild() {
    const three = this.three;
    if (!three) return;
    this.stopTick();
    this.clearGroup();
    const group = new THREE.Group();

    // Lights (leave with the group, mirroring the geo 3-D plugins).
    group.add(new THREE.AmbientLight(0x9fb4cc, 1.0));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2.4, 3.2, 1.6);
    group.add(sun);

    // Teaching terrain as the ground-concentration board: recoloured to the
    // restrained scientific ramp, semi-transparent, flattened slightly and
    // clipped to the exact compute-domain footprint so it stops competing
    // with the plume (the raw mesh spans 2×2 world units, the box only 1.9×0.9).
    const terrain = buildTerrainMesh(syntheticDem(), 0.18);
    const tPos = terrain.geometry.getAttribute('position');
    const tCol = terrain.geometry.getAttribute('color');
    const hMax = 0.55 * 0.18;
    for (let v = 0; v < tCol.count; v += 1) {
      const [r, g, b] = groundRamp3(tPos.getY(v) / hMax);
      tCol.setXYZ(v, r, g, b);
    }
    tCol.needsUpdate = true;
    const tMat = terrain.material as THREE.MeshStandardMaterial;
    tMat.transparent = true;
    tMat.opacity = 0.88;
    tMat.needsUpdate = true;
    terrain.scale.set(DOM_W / 2, 1, DOM_D / 2); // [-1,1]² footprint → domain box footprint
    terrain.position.set(DOM_CX, 0, 0);
    group.add(terrain);

    // Compute-domain wireframe.
    const box = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(DOM_W, DOM_H, DOM_D)),
      new THREE.LineBasicMaterial({ color: 0x44607e, transparent: true, opacity: 0.6 }),
    );
    box.position.set(DOM_CX, DOM_CY, 0);
    group.add(box);

    // Solver (fresh grid on every rebuild) + data-scale report.
    const res = RESOLUTION_PRESETS[this.state.dim];
    this.solver = new FluidSolver(res.nx, res.ny, res.nz);
    this.densMaxSm = 0;
    this.nanNotified = false;
    this.api.reportDataScale(this.state.custom ? this.state.custom.nx * this.state.custom.ny * this.state.custom.nz : this.solver.cells);

    // Smoke isosurface (MarchingCubes over the density field) — a matte
    // grey-white translucent shell plus a fainter, lower-threshold halo so
    // the plume reads as smoke dissolving at its edges instead of glass.
    this.mcSize = res.nx;
    const smokeShell = () =>
      new THREE.MeshStandardMaterial({
        color: 0xcfd8dc,
        transparent: true,
        roughness: 0.95,
        metalness: 0.0,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
    const innerMat = smokeShell();
    innerMat.opacity = 0.24;
    const outerMat = smokeShell();
    outerMat.color.set(0xdde4e8);
    outerMat.opacity = 0.1;
    const mc = new MarchingCubes(this.mcSize, innerMat, false, false, 40000);
    // MC field is indexed size²·z + size·y + x with x = downwind, y = crosswind,
    // z = vertical, so local z must map onto world Y (up) and local y onto
    // world Z (crosswind). The previous scale swapped these two: the plume
    // rose sideways and poked through the box's top/bottom faces.
    mc.scale.set(DOM_W / 2, DOM_H / 2, DOM_D / 2);
    mc.position.set(DOM_CX, DOM_CY, 0);
    mc.renderOrder = 2;
    this.mc = mc;
    group.add(mc);
    const halo = new MarchingCubes(this.mcSize, outerMat, false, false, 40000);
    halo.scale.copy(mc.scale);
    halo.position.copy(mc.position);
    halo.renderOrder = 2;
    this.mcOuter = halo;
    group.add(halo);

    // Stack chimney up to the source cell.
    const stack = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.02, 1, 12),
      new THREE.MeshStandardMaterial({ color: 0x9aa7b4, roughness: 0.55, metalness: 0.15 }),
    );
    this.stackMesh = stack;
    group.add(stack);
    this.updateStack();

    // Downwind cross-section at y = 0 (vertex colours refreshed per frame).
    const snx = this.sectionNx;
    const snz = this.sectionNz;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let k = 0; k <= snz; k += 1) {
      for (let i = 0; i <= snx; i += 1) {
        positions.push(DOM_X0 + (i / snx) * DOM_W, DOM_Y0 + (k / snz) * DOM_H, 0);
      }
    }
    for (let k = 0; k < snz; k += 1) {
      for (let i = 0; i < snx; i += 1) {
        const a = k * (snx + 1) + i;
        indices.push(a, a + snx + 1, a + 1, a + 1, a + snx + 1, a + snx + 2);
      }
    }
    const secGeom = new THREE.BufferGeometry();
    secGeom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.sectionColors = new THREE.BufferAttribute(new Float32Array((snx + 1) * (snz + 1) * 3), 3);
    secGeom.setAttribute('color', this.sectionColors);
    secGeom.setIndex(indices);
    const section = new THREE.Mesh(
      secGeom,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }),
    );
    section.visible = this.state.showSection;
    section.renderOrder = 1;
    this.sectionMesh = section;
    group.add(section);

    // Compare panel (canvas texture, camera-facing).
    const hudCanvas = document.createElement('canvas');
    hudCanvas.width = 512;
    hudCanvas.height = 256;
    const hudTexture = new THREE.CanvasTexture(hudCanvas);
    hudTexture.colorSpace = THREE.SRGBColorSpace;
    const hud = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.475),
      new THREE.MeshBasicMaterial({ map: hudTexture, transparent: true, depthWrite: false }),
    );
    hud.position.set(DOM_CX, 0.4, DOM_D / 2 + 0.28);
    hud.visible = this.state.compareGauss && !this.state.custom;
    hud.renderOrder = 3;
    this.hudMesh = hud;
    this.hudCanvas = hudCanvas;
    this.hudCtx = hudCanvas.getContext('2d');
    this.hudTexture = hudTexture;
    group.add(hud);

    // Bilingual annotations (the stack is the source — one label covers both).
    const locale: 'zh-CN' | 'en-US' = this.api.locale === 'zh-CN' ? 'zh-CN' : 'en-US';
    this.stackLabel = this.labels.add('烟囱（源）', 'Stack (source)', locale, [DOM_X0, 0.4, 0], { font: 36 });
    this.labels.add('计算域', 'Domain', locale, [DOM_X0, DOM_Y0 + DOM_H + 0.07, DOM_D / 2], { font: 36 });
    this.labels.add('烟羽浓度等值面', 'Plume isosurface', locale, [0.55, DOM_Y0 + DOM_H + 0.09, -DOM_D / 2], { font: 36 });
    this.labels.add('地面浓度', 'Ground concentration', locale, [DOM_X0 + DOM_W - 0.22, 0.03, DOM_D / 2 + 0.14], { font: 36 });
    group.add(this.labels.group);
    this.updateStack(); // place the mesh and its label at the current stack height

    this.group = group;
    three.scene.add(group);

    // Static fields (CSV import / paused start) paint once here; the live
    // sim repaints in the tick loop.
    if (this.state.custom) {
      this.updateMcField();
      this.updateSection();
      this.redrawHud();
    }
    this.frame = 0;
    if (this.needsFit) {
      this.fitCamera();
      this.needsFit = false;
    }
    three.setVisible(true);
    three.render();
    this.rafId = requestAnimationFrame(this.tick);
  }

  /** Move the chimney and the solver source cell to the current stack height. */
  private updateStack(): void {
    const mesh = this.stackMesh;
    if (!mesh) return;
    const res = RESOLUTION_PRESETS[this.state.dim];
    const k = this.sourceK();
    const topY = DOM_Y0 + ((k + 0.5) / res.nz) * DOM_H;
    const baseY = DOM_Y0 - 0.04;
    const h = Math.max(0.02, topY - baseY);
    mesh.scale.set(1, h, 1);
    mesh.position.set(DOM_X0 + ((STACK_I + 0.5) / res.nx) * DOM_W, baseY + h / 2, 0);
    this.stackLabel?.position.set(mesh.position.x, baseY + h + 0.1, 0);
  }

  // ---- tick loop ---------------------------------------------------------------

  private stopTick() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private tick = (_t: number) => {
    this.rafId = 0;
    const three = this.three;
    if (!three || !this.group) return;
    this.frame += 1;
    const solver = this.solver;
    if (this.state.play && solver && !this.state.custom) {
      const src = this.buildSourceSpec();
      for (let s = 0; s < SUBSTEPS; s += 1) solver.step(src);
      if (solver.hadNaN) {
        solver.reset();
        this.densMaxSm = 0;
        if (!this.nanNotified) {
          this.nanNotified = true;
          notify(this.api, 'warning', 'Numerical instability detected — velocity field reset', '检测到数值发散，速度场已重置');
        }
      }
      this.updateMcField();
      this.updateSection();
      if (this.state.compareGauss && this.frame % 20 === 0) this.redrawHud();
    }
    if (this.hudMesh?.visible) this.hudMesh.quaternion.copy(three.camera.quaternion);
    three.controls.update?.();
    three.render();
    this.rafId = requestAnimationFrame(this.tick);
  };
}

export default function createPlume3DPlugin(): Plugin {
  return new Plume3DPlugin();
}
