// ==========================================================================
// Example plugin: 3-D Fluid Flow (fluid3d)
//
// A generic D3Q19 lattice-Boltzmann solver that imports an arbitrary 3-D model
// (GLB / GLTF / STL / OBJ / PLY) or uses a built-in primitive, voxelises it into
// the flow domain and simulates the flow around it. The wake is shown as a real
// three-dimensional field (speed-coloured tracers / streamline trails / a slice
// volume), with drag/lift metrics and an optional single cross-section.
//
// The collide+stream pair runs as WGSL kernels on the GPU with ping-pong buffers
// (falling back to the CPU-equivalent when no WebGPU device is available),
// mirroring the 2-D D2Q9 plugin but in three dimensions.
//
// Fully decoupled: imports only `three` (+ its loader addons) and `@/core/*`.
// ==========================================================================

import * as THREE from 'three';
import type {
  ComputeBufferHandle,
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  GpuComputeApi,
  GpuKernelHandle,
  ParamDefinition,
  Plugin,
  PluginApi,
  Scene3DHandle,
  SelectOption,
} from '@/types/plugin';
import { emit } from '@/core/events';
import { logger } from '@/core/logger';
import { actionButton, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { disposeObjectTree } from '@/core/three-utils';
import {
  LBM3D_DIRECTIONS,
  LBM3D_FIELD_USAGE,
  LBM3D_FLAGS_USAGE,
  LBM3D_PARAMS_USAGE,
  LBM3D_SPONGE_STRENGTH,
  equilibrium3D,
  lbm3dCollideKernelWGSL,
  lbm3dFieldBytes,
  lbm3dMacroBytes,
  lbm3dMacroKernelWGSL,
  lbm3dScalarBytes,
  lbm3dSpongeWidth,
  lbm3dStreamKernelWGSL,
  macroCPU3D,
  packLbm3dParams,
  stepCPU3D,
  wakeSurvey3D,
} from './lbm3d';
import {
  countSolidCells,
  frontalAreaCells,
  loadModelGeometry,
  planFit,
  voxelizeGeometry,
  type ModelFit,
} from './geometry3d';
import { PRESETS, presetById, type PresetId } from './presets';
import {
  MultiSliceField,
  ObstacleView,
  SliceField,
  StreamlineTrails,
  TracerCloud,
  buildDomainOutline,
  fitDomainCamera,
  speedColors,
  speedRamp,
  vorticityRamp,
} from './render3d';

export { fluid3dManifest } from './manifest';
import { fluid3dManifest } from './manifest';

// Lattice sizes (multiples of the 8×8 workgroup tile → no overhang). Each
// population field is cells × 19 × 4 bytes; the GPU tiers stay ≤ ~48 MB.
const SIZES = {
  'gpu-standard': { nx: 88, ny: 64, nz: 64 },
  'gpu-high': { nx: 112, ny: 72, nz: 72 },
  'cpu-standard': { nx: 56, ny: 44, nz: 44 },
  'cpu-high': { nx: 72, ny: 56, nz: 56 },
} as const;

/**
 * Steps over which the inflow is ramped from rest to the requested speed after
 * every reseed — an impulsive start launches a compression wave that reflects
 * off the outflow edge and sloshes for thousands of steps.
 */
const INFLOW_RAMP_STEPS = 300;

/** A diverging lattice is never local — sample it instead of sweeping it. */
const STABILITY_SCAN_STRIDE = 97;

/** Relaxation bounds (ω = 2 − 1/τ; the ceiling keeps τ clear of 0.5). */
const OMEGA_MIN = 1.6;
const OMEGA_MAX = 1.95;

type ViewMode = 'particles' | 'streamlines' | 'slices' | 'slice';
type Resolution = 'standard' | 'high';

interface State {
  shape: PresetId | 'model';
  u0: number;
  omega: number;
  resolution: Resolution;
  steps: number;
  view: ViewMode;
  /** Cross-section position across the span, 0..1 → z index. */
  sliceFrac: number;
  running: boolean;
}

/** Cached WebGPU buffers + compiled kernels, keyed by lattice dimensions. */
interface GpuResourceSet {
  key: string;
  fieldA: ComputeBufferHandle;
  fieldB: ComputeBufferHandle;
  flagsBuf: ComputeBufferHandle;
  paramsBuf: ComputeBufferHandle;
  macroBuf: ComputeBufferHandle;
  collide: GpuKernelHandle;
  stream: GpuKernelHandle;
  macro: GpuKernelHandle;
}

export class Fluid3dPlugin implements Plugin {
  readonly manifest = fluid3dManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private state: State = {
    shape: 'sphere',
    u0: 0.1,
    omega: 1.8,
    resolution: 'standard',
    steps: 2,
    view: 'particles',
    sliceFrac: 0.5,
    running: false,
  };

  private nx = 0;
  private ny = 0;
  private nz = 0;
  private flags = new Float32Array(0);
  private f = new Float32Array(0);
  private fpost = new Float32Array(0);
  private macroOut: { rho: Float32Array; ux: Float32Array; uy: Float32Array; uz: Float32Array } | null = null;

  /** Loaded model geometry (kept so a shape/domain change can re-voxelise). */
  private modelGeometry: THREE.BufferGeometry | null = null;
  private modelName = '';
  /** Geometry currently displayed/solid — owned by the ObstacleView. */
  private obstacleGeometry: THREE.BufferGeometry | null = null;
  private displayFit: ModelFit | null = null;

  private stepsPerFrame = 2;
  private rafId = 0;
  private gpuDirty = true;
  private stepsSinceSeed = 0;
  private frameNo = 0;
  private diverged = false;
  private gpuRes: GpuResourceSet | null = null;
  /** GPU macro read-back (4 f32 per cell, interleaved) before deinterleave. */
  private macroRaw: Float32Array | null = null;

  // Scene objects (owned; rebuilt when the domain size or scene handle changes).
  private group: THREE.Group | null = null;
  private sceneHandle: Scene3DHandle | null = null;
  private groupKey = '';
  private obstacle: ObstacleView | null = null;
  private outline: THREE.LineSegments | null = null;
  private slice: SliceField | null = null;
  private multiSlice: MultiSliceField | null = null;
  private trails: StreamlineTrails | null = null;
  private tracers: TracerCloud | null = null;
  /** Streamline seed count, sized to the lattice in `seedTracers`. */
  private trailSeeds = 300;

  // Reused per-frame buffers.
  private sliceRgba: Uint8Array | null = null;
  private curlSlice: Float32Array | null = null;

  // Tracer particle state (lattice coordinates).
  private tracerXyz = new Float32Array(0);
  private tracerWorld = new Float32Array(0);
  private tracerAge = new Float32Array(0);
  private tracerSpeeds = new Float32Array(0);
  private tracerColors = new Float32Array(0);
  private tracerCount = 0;
  /** Deterministic PRNG state so reseeding is reproducible. */
  private rngState = 0x9e3779b9;

  /** Inflow speed actually fed to the solver (smoothstep ramp since reseed). */
  private get inflowU0(): number {
    if (this.stepsSinceSeed >= INFLOW_RAMP_STEPS) return this.state.u0;
    const t = Math.max(0, this.stepsSinceSeed / INFLOW_RAMP_STEPS);
    return this.state.u0 * t * t * (3 - 2 * t);
  }

  private rand(): number {
    // mulberry32
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  async init(api: PluginApi) {
    this.api = api;
    // Pick the engine-appropriate lattice size once: the CPU integrator cannot
    // hold interactive rates at full resolution.
    const gpu = api.gpu?.available ?? false;
    this.stepsPerFrame = gpu ? 2 : 1;
    this.applyLattice(gpu ? 'gpu-standard' : 'cpu-standard');
    this.buildObstacle();
    this.seed();
  }

  async destroy() {
    this.stop();
    this.dropGroup();
    this.destroyGpuResources();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
    this.three = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
    this.draw();
  }

  async deactivate() {
    this.stop();
    this.three?.setVisible(false);
    // Detach the owned objects but keep the state, so reactivation is instant.
    if (this.group && this.group.parent) this.group.parent.remove(this.group);
  }

  async render(container: ContainerCapabilities) {
    this.ctx = container;
    if (container.three) this.three = container.three;
    if (!this.three) {
      this.drawHint();
      return;
    }
    this.draw();
  }

  /** Host entry for 3-D-capable plugins. */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- parameter handling ---------------------------------------------------

  updateParams(params: Record<string, unknown>) {
    // Export buttons accept both the host's `{ key: { action } }` emission and
    // a plain `{ key: true }` call; they never touch the running state.
    const fired = (key: string): boolean => {
      const v = params[key];
      return v === true || (typeof v === 'object' && v !== null && (v as { action?: string }).action === key);
    };

    if (fired('exportCsv')) {
      this.exportCsv();
      return;
    }
    if (typeof params.shape === 'string') {
      const shape = params.shape;
      const valid = shape === 'sphere' || shape === 'cube' || shape === 'cylinder' || shape === 'model';
      if (valid && shape !== this.state.shape && (shape !== 'model' || this.modelGeometry)) {
        this.stop();
        this.state.shape = shape as PresetId | 'model';
        this.buildObstacle();
        this.seed();
        this.draw();
      }
    }
    if (typeof params.u0 === 'number') {
      this.state.u0 = Math.max(0.02, Math.min(0.16, params.u0));
    }
    if (typeof params.omega === 'number') {
      this.state.omega = Math.max(OMEGA_MIN, Math.min(OMEGA_MAX, params.omega));
    }
    if (
      (params.resolution === 'standard' || params.resolution === 'high') &&
      params.resolution !== this.state.resolution
    ) {
      // Re-allocate the lattice: pause first so the tick never reads a
      // half-swapped field set, then replay the obstacle and reseed.
      this.stop();
      this.state.resolution = params.resolution;
      const gpu = this.api.gpu?.available ?? false;
      this.applyLattice(`${gpu ? 'gpu' : 'cpu'}-${params.resolution}` as keyof typeof SIZES);
      this.buildObstacle();
      this.seed();
      this.draw();
    }
    if (typeof params.steps === 'number') {
      this.state.steps = Math.max(1, Math.min(10, Math.round(params.steps)));
      this.stepsPerFrame = this.state.steps;
    }
    if (
      params.view === 'particles' ||
      params.view === 'streamlines' ||
      params.view === 'slices' ||
      params.view === 'slice'
    ) {
      this.state.view = params.view;
      this.draw();
    }
    if (typeof params.sliceFrac === 'number') {
      this.state.sliceFrac = Math.max(0, Math.min(1, params.sliceFrac));
      this.draw();
    }
    if (typeof params.start === 'boolean') {
      if (params.start) this.start();
      else this.stop();
    }
    const reset = params.reset as { action?: string } | undefined;
    if (reset?.action === 'reset') {
      this.reset();
    }
  }

  getParams(): ParamDefinition[] {
    const shapeOptions: SelectOption[] = PRESETS.map((p) => ({ value: p.id, label: p.label, labelI18n: p.labelI18n }));
    if (this.modelGeometry) {
      shapeOptions.push({
        value: 'model',
        label: 'Imported model',
        labelI18n: { 'zh-CN': `导入模型${this.modelName ? `（${this.modelName}）` : ''}`, 'en-US': `Imported model${this.modelName ? ` (${this.modelName})` : ''}` },
      });
    }
    return [
      {
        key: 'shape',
        label: 'Obstacle',
        labelI18n: { 'zh-CN': '障碍物', 'en-US': 'Obstacle' },
        type: 'select',
        value: this.state.shape,
        options: shapeOptions,
      },
      {
        key: 'u0',
        label: 'Inflow Speed',
        labelI18n: { 'zh-CN': '入流速度', 'en-US': 'Inflow Speed' },
        type: 'range',
        min: 0.02,
        max: 0.16,
        step: 0.01,
        value: this.state.u0,
      },
      {
        key: 'omega',
        label: 'Relaxation (1/viscosity)',
        labelI18n: { 'zh-CN': '松弛率（黏度倒数）', 'en-US': 'Relaxation (1/viscosity)' },
        type: 'range',
        min: OMEGA_MIN,
        max: OMEGA_MAX,
        step: 0.01,
        value: this.state.omega,
      },
      {
        key: 'resolution',
        label: 'Lattice Detail',
        labelI18n: { 'zh-CN': '网格精度', 'en-US': 'Lattice Detail' },
        type: 'select',
        value: this.state.resolution,
        options: [
          { value: 'standard', label: 'Standard', labelI18n: { 'zh-CN': '标准', 'en-US': 'Standard' } },
          { value: 'high', label: 'High', labelI18n: { 'zh-CN': '高', 'en-US': 'High' } },
        ],
      },
      {
        key: 'steps',
        label: 'Steps / Frame',
        labelI18n: { 'zh-CN': '每帧步数', 'en-US': 'Steps / Frame' },
        type: 'range',
        min: 1,
        max: 10,
        step: 1,
        value: this.state.steps,
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        value: this.state.view,
        options: [
          { value: 'particles', label: 'Flow Tracers 3D', labelI18n: { 'zh-CN': '示踪粒子（三维）', 'en-US': 'Flow Tracers 3D' } },
          { value: 'streamlines', label: 'Streamline Trails', labelI18n: { 'zh-CN': '流线轨迹', 'en-US': 'Streamline Trails' } },
          { value: 'slices', label: 'Slice Volume', labelI18n: { 'zh-CN': '分层切片体', 'en-US': 'Slice Volume' } },
          { value: 'slice', label: 'Vorticity Slice', labelI18n: { 'zh-CN': '涡量切片', 'en-US': 'Vorticity Slice' } },
        ],
      },
      {
        key: 'sliceFrac',
        label: 'Slice position',
        labelI18n: { 'zh-CN': '切片位置', 'en-US': 'Slice position' },
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
        value: this.state.sliceFrac,
      },
      {
        key: 'start',
        label: 'Run',
        type: 'toggle',
        value: this.state.running,
        offLabelI18n: { 'zh-CN': '▶ 开始模拟', 'en-US': '▶ Start' },
        onLabelI18n: { 'zh-CN': '■ 停止模拟', 'en-US': '■ Stop' },
      },
      {
        key: 'reset',
        label: 'Reset Flow',
        labelI18n: { 'zh-CN': '重置流场', 'en-US': 'Reset Flow' },
        type: 'button',
        variant: 'default',
        action: 'reset',
      },
      actionButton('exportCsv', 'Export Slice CSV', '导出切片 CSV'),
    ];
  }

  private refreshParams() {
    emit('host:params:changed', { pluginId: this.manifest.id });
  }

  // ---- data import ----------------------------------------------------------

  async loadData(file: File) {
    let geometry: THREE.BufferGeometry;
    try {
      const loaded = await loadModelGeometry(file);
      geometry = loaded.geometry;
      this.modelName = loaded.name;
    } catch (err) {
      logger.warn('fluid3d', 'model load failed', err);
      notify(
        this.api,
        'error',
        'Failed to load the model (need GLB/GLTF/STL/OBJ/PLY with triangles).',
        '模型加载失败（需为含三角面的 GLB/GLTF/STL/OBJ/PLY）。',
      );
      return;
    }
    // A new obstacle invalidates a running field: halt, rebuild, reseed.
    this.modelGeometry?.dispose();
    this.modelGeometry = geometry;
    this.stop();
    this.state.shape = 'model';
    this.buildObstacle();
    this.seed();
    this.refreshParams();
    this.draw();
    notify(
      this.api,
      'info',
      `Model loaded: ${this.modelName} (${countSolidCells(this.flags)} solid cells).`,
      `已加载模型：${this.modelName}（${countSolidCells(this.flags)} 个固体格子）。`,
    );
  }

  // ---- allocation / seeding -------------------------------------------------

  /** Re-allocate the lattice arrays for an engine + tier pair. */
  private applyLattice(key: keyof typeof SIZES) {
    const size = SIZES[key];
    this.nx = size.nx;
    this.ny = size.ny;
    this.nz = size.nz;
    // GPU buffers are sized to the old lattice — drop them; the next GPU batch
    // rebuilds the set and re-uploads the reseeded field.
    this.destroyGpuResources();
    const cells = this.nx * this.ny * this.nz;
    this.flags = new Float32Array(cells);
    this.f = new Float32Array(cells * LBM3D_DIRECTIONS);
    this.fpost = new Float32Array(cells * LBM3D_DIRECTIONS);
    this.macroOut = {
      rho: new Float32Array(cells),
      ux: new Float32Array(cells),
      uy: new Float32Array(cells),
      uz: new Float32Array(cells),
    };
    this.macroRaw = null;
    this.sliceRgba = null;
    this.curlSlice = null;
    this.gpuDirty = true;
    this.stepsSinceSeed = 0;
    this.seedTracers();
    this.dropGroup();
  }

  /** Build the current obstacle (preset or imported model) and voxelise it. */
  private buildObstacle() {
    const { nx, ny, nz } = this;
    const useModel = this.state.shape === 'model' && this.modelGeometry;
    const geometry = useModel ? this.modelGeometry!.clone() : presetById(this.state.shape as PresetId).build();
    const fit = planFit(geometry, nx, ny, nz);
    this.obstacleGeometry = geometry;
    this.displayFit = fit;
    this.flags = voxelizeGeometry(geometry, fit, nx, ny, nz);
    this.gpuDirty = true;
  }

  /** Seed the flow field: uniform inflow equilibrium + a weak inlet wiggle. */
  private seed() {
    this.stepsSinceSeed = 0;
    const uStart = this.inflowU0;
    const feq = equilibrium3D(1, uStart, 0, 0);
    const { nx, ny, nz } = this;
    for (let cell = 0; cell < nx * ny * nz; cell += 1) {
      const base = cell * LBM3D_DIRECTIONS;
      for (let d = 0; d < LBM3D_DIRECTIONS; d += 1) this.f[base + d] = feq[d]!;
    }
    // Weak inlet perturbation so the wake breaks symmetry and sheds.
    for (let z = 0; z < nz; z += 1) {
      for (let y = 0; y < ny; y += 1) {
        const uy = uStart * 0.05 * Math.sin((2 * Math.PI * 3 * y) / ny);
        const base = (z * ny + y) * nx + 1;
        const feqWiggle = equilibrium3D(1, uStart, uy, 0);
        for (let d = 0; d < LBM3D_DIRECTIONS; d += 1) this.f[base * LBM3D_DIRECTIONS + d] = feqWiggle[d]!;
      }
    }
    this.gpuDirty = true;
    this.recomputeMacroCPU();
  }

  private recomputeMacroCPU() {
    if (!this.macroOut) return;
    macroCPU3D(this.f, this.nx, this.ny, this.nz, this.macroOut);
  }

  private reset() {
    this.stop();
    this.diverged = false;
    this.seed();
    clearScienceOutputs(this.manifest.id);
    this.draw();
  }

  // ---- run loop -------------------------------------------------------------

  private start() {
    if (this.state.running) return;
    if (countSolidCells(this.flags) === 0) {
      notify(this.api, 'warning', 'No obstacle in the flow — nothing to simulate.', '流场中没有障碍物，无法模拟。');
      return;
    }
    this.diverged = false;
    this.state.running = true;
    this.api.setStatus('computing');
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stop() {
    this.state.running = false;
    cancelAnimationFrame(this.rafId);
    this.api.setStatus('ready');
  }

  private tick = () => {
    if (!this.state.running) return;
    const gpu = this.api.gpu;
    if (gpu?.available) {
      void this.gpuAdvance(gpu, this.stepsPerFrame).then(
        (ok) => {
          if (ok) this.draw();
          else this.drawCpuFrame();
        },
        (err) => {
          logger.warn('fluid3d', 'GPU frame failed', err);
          this.drawCpuFrame();
        },
      );
    } else {
      this.stepCpu();
      this.draw();
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private stepCpu() {
    for (let s = 0; s < this.stepsPerFrame; s += 1) {
      stepCPU3D(this.f, this.fpost, this.flags, this.nx, this.ny, this.nz, this.state.omega, this.inflowU0);
      this.stepsSinceSeed += 1;
    }
    this.recomputeMacroCPU();
  }

  /** CPU fallback frame (used when the GPU batch failed mid-run). */
  private drawCpuFrame() {
    this.stepCpu();
    this.draw();
  }

  private hasDiverged(macro: { rho: Float32Array; ux: Float32Array; uy: Float32Array; uz: Float32Array }): boolean {
    for (let cell = 0; cell < macro.rho.length; cell += STABILITY_SCAN_STRIDE) {
      if (this.flags[cell]! > 0.5) continue;
      const r = macro.rho[cell]!;
      const speed = Math.abs(macro.ux[cell]!) + Math.abs(macro.uy[cell]!) + Math.abs(macro.uz[cell]!);
      if (!Number.isFinite(r) || !Number.isFinite(speed)) return true;
      if (r < 0.2 || r > 3 || speed > 0.75) return true;
    }
    return false;
  }

  private recoverFromDivergence() {
    if (this.diverged) return; // already reported — do not reseed every frame
    this.diverged = true;
    this.stop();
    this.seed();
    notify(
      this.api,
      'warning',
      'Flow diverged — reset automatically. Lower the inflow speed or relaxation rate, then restart.',
      '流场数值发散 — 已自动重置。请降低入流速度或松弛率后重新开始。',
    );
  }

  // ---- GPU path -------------------------------------------------------------

  /**
   * Advance the GPU field `steps` steps. `upload` pushes the CPU field to the
   * GPU (also implied whenever the lattice was reseeded — `gpuDirty`); the
   * macroscopic buffer is always read back for rendering/metrics. Returns false
   * on any failure (caller falls back to CPU).
   */
  private async gpuAdvance(
    gpu: GpuComputeApi,
    steps: number,
    onProgress?: (p: ComputeProgress) => Promise<void> | void,
    opts: { upload?: boolean; read?: boolean } = {},
  ): Promise<boolean> {
    const upload = opts.upload === true || this.gpuDirty;
    const read = opts.read === true || upload;
    const { nx, ny, nz } = this;
    const cells = nx * ny * nz;
    const key = `${nx}x${ny}x${nz}`;

    let res = this.gpuRes;
    let fresh = false;
    if (!res || res.key !== key) {
      res = this.createGpuResources(gpu, cells, key);
      if (!res) {
        this.gpuDirty = true;
        return false;
      }
      this.gpuRes = res;
      fresh = true;
    }

    try {
      if (upload) res.fieldA.write(this.f);
      // Flags are immutable between obstacle/domain changes (both set gpuDirty):
      // upload on a fresh set or a reseed, not every frame.
      if (fresh || upload) res.flagsBuf.write(this.flags);
      res.paramsBuf.write(
        new Uint8Array(
          packLbm3dParams(nx, ny, nz, this.state.omega, this.inflowU0, lbm3dSpongeWidth(nx), LBM3D_SPONGE_STRENGTH),
        ),
      );
      const wgX = Math.ceil(nx / 8);
      const wgY = Math.ceil(ny / 8);

      for (let s = 0; s < steps; s += 1) {
        if (!gpu.run(res.collide, [res.fieldA, res.fieldB, res.flagsBuf, res.paramsBuf], wgX, wgY, nz)) {
          this.failGpuResources();
          return false;
        }
        if (!gpu.run(res.stream, [res.fieldB, res.fieldA, res.flagsBuf, res.paramsBuf], wgX, wgY, nz)) {
          this.failGpuResources();
          return false;
        }
        this.stepsSinceSeed += 1;
        await onProgress?.({ done: s + 1, total: steps });
      }

      if (!gpu.run(res.macro, [res.fieldA, res.macroBuf, res.paramsBuf], wgX, wgY, nz)) {
        this.failGpuResources();
        return false;
      }
      const macroBytes = await res.macroBuf.read();
      this.macroRaw = new Float32Array(macroBytes);
      this.deinterleaveMacro();

      if (read) {
        const fieldBytes = await res.fieldA.read();
        this.f.set(new Float32Array(fieldBytes));
      }
      if (upload) this.gpuDirty = false;
      return true;
    } catch (err) {
      logger.warn('fluid3d', 'GPU compute failed, falling back to CPU', err);
      this.failGpuResources();
      return false;
    }
  }

  private deinterleaveMacro() {
    const raw = this.macroRaw;
    const macro = this.macroOut;
    if (!raw || !macro) return;
    const cells = this.nx * this.ny * this.nz;
    for (let i = 0; i < cells; i += 1) {
      macro.rho[i] = raw[i * 4]!;
      macro.ux[i] = raw[i * 4 + 1]!;
      macro.uy[i] = raw[i * 4 + 2]!;
      macro.uz[i] = raw[i * 4 + 3]!;
    }
  }

  /** Allocate the five buffers and compile the three kernels once per size. */
  private createGpuResources(gpu: GpuComputeApi, cells: number, key: string): GpuResourceSet | null {
    const buffers: Array<ComputeBufferHandle | null> = [];
    const cleanup = () => {
      for (const b of buffers) {
        try {
          b?.destroy();
        } catch {
          /* device lost */
        }
      }
    };
    try {
      const fieldA = gpu.createBuffer(lbm3dFieldBytes(cells), LBM3D_FIELD_USAGE, 'fluid3d.fieldA');
      const fieldB = gpu.createBuffer(lbm3dFieldBytes(cells), LBM3D_FIELD_USAGE, 'fluid3d.fieldB');
      const flagsBuf = gpu.createBuffer(lbm3dScalarBytes(cells), LBM3D_FLAGS_USAGE, 'fluid3d.flags');
      const paramsBuf = gpu.createBuffer(32, LBM3D_PARAMS_USAGE, 'fluid3d.params');
      const macroBuf = gpu.createBuffer(lbm3dMacroBytes(cells), LBM3D_FIELD_USAGE, 'fluid3d.macro');
      buffers.push(fieldA, fieldB, flagsBuf, paramsBuf, macroBuf);
      if (!fieldA || !fieldB || !flagsBuf || !paramsBuf || !macroBuf) {
        cleanup();
        return null;
      }

      const collide = gpu.compileKernel({
        label: 'fluid3d.collide',
        wgsl: lbm3dCollideKernelWGSL(),
        workgroupSize: [8, 8, 1],
        bindings: [
          { binding: 0, bufferType: 'read-only-storage' },
          { binding: 1, bufferType: 'storage' },
          { binding: 2, bufferType: 'read-only-storage' },
          { binding: 3, bufferType: 'uniform' },
        ],
      });
      const stream = gpu.compileKernel({
        label: 'fluid3d.stream',
        wgsl: lbm3dStreamKernelWGSL(),
        workgroupSize: [8, 8, 1],
        bindings: [
          { binding: 0, bufferType: 'read-only-storage' },
          { binding: 1, bufferType: 'storage' },
          { binding: 2, bufferType: 'read-only-storage' },
          { binding: 3, bufferType: 'uniform' },
        ],
      });
      const macro = gpu.compileKernel({
        label: 'fluid3d.macro',
        wgsl: lbm3dMacroKernelWGSL(),
        workgroupSize: [8, 8, 1],
        bindings: [
          { binding: 0, bufferType: 'read-only-storage' },
          { binding: 1, bufferType: 'storage' },
          { binding: 2, bufferType: 'uniform' },
        ],
      });
      if (!collide || !stream || !macro) {
        // Kernels have no destroy handle; release the buffers so a failed build
        // never leaks half a resource set.
        cleanup();
        return null;
      }
      return { key, fieldA, fieldB, flagsBuf, paramsBuf, macroBuf, collide, stream, macro };
    } catch (err) {
      logger.warn('fluid3d', 'GPU resource creation failed, falling back to CPU', err);
      cleanup();
      return null;
    }
  }

  private destroyGpuResources(): void {
    const r = this.gpuRes;
    if (!r) return;
    this.gpuRes = null;
    for (const buf of [r.fieldA, r.fieldB, r.flagsBuf, r.paramsBuf, r.macroBuf]) {
      try {
        buf.destroy();
      } catch {
        /* already destroyed / device lost */
      }
    }
  }

  /** A dispatch/read failed: drop the suspect set and force a full re-upload. */
  private failGpuResources(): void {
    this.destroyGpuResources();
    this.gpuDirty = true;
  }

  // ---- one-shot compute -----------------------------------------------------

  async compute(
    _input: unknown,
    onProgress?: (p: ComputeProgress) => Promise<void> | void,
  ): Promise<ComputeResult> {
    if (countSolidCells(this.flags) === 0) {
      return { ok: false, error: 'no body — nothing in the flow to survey' };
    }
    const steps = 200;
    const cells = this.nx * this.ny * this.nz;
    const t0 = performance.now();
    const gpu = this.api.gpu;

    if (gpu?.available) {
      this.api.setStatus('computing');
      const gpuOk = await this.gpuAdvance(gpu, steps, onProgress, { upload: true, read: true });
      this.api.setStatus('ready');
      if (gpuOk) {
        const gpuMs = performance.now() - t0;
        this.api.reportGpuTime(gpuMs);
        this.publishMetrics();
        if (this.api.isActive?.() === false) {
          // Background completion: never draw over the now-active plugin; surface
          // a non-intrusive jump-back toast instead.
          const zh = this.api.locale === 'zh-CN';
          this.api.notify(
            'success',
            zh ? `绕流计算已完成（后台，${gpu.backend}）— ${gpuMs.toFixed(1)} ms` : `Compute finished (background, ${gpu.backend}) — ${gpuMs.toFixed(1)} ms`,
            { label: zh ? '查看结果' : 'View results', run: () => emit('plugin:activate-request', { id: this.manifest.id }) },
          );
          return { ok: true, output: cells, metrics: { gpuMs, bytes: lbm3dFieldBytes(cells) } };
        }
        this.draw();
        return { ok: true, output: cells, metrics: { gpuMs, bytes: lbm3dFieldBytes(cells) } };
      }
    }

    for (let s = 0; s < steps; s += 1) {
      stepCPU3D(this.f, this.fpost, this.flags, this.nx, this.ny, this.nz, this.state.omega, this.inflowU0);
      this.stepsSinceSeed += 1;
      await onProgress?.({ done: s + 1, total: steps });
    }
    this.recomputeMacroCPU();
    const cpuMs = performance.now() - t0;
    this.api.reportGpuTime(cpuMs);
    this.publishMetrics();
    if (this.api.isActive?.() === false) {
      const zh = this.api.locale === 'zh-CN';
      this.api.notify(
        'success',
        zh ? `绕流计算已完成（后台，cpu）— ${cpuMs.toFixed(1)} ms` : `Compute finished (background, cpu) — ${cpuMs.toFixed(1)} ms`,
        { label: zh ? '查看结果' : 'View results', run: () => emit('plugin:activate-request', { id: this.manifest.id }) },
      );
      return { ok: true, output: cells, metrics: { gpuMs: cpuMs, bytes: lbm3dFieldBytes(cells) } };
    }
    this.draw();
    return { ok: true, output: cells, metrics: { gpuMs: cpuMs, bytes: lbm3dFieldBytes(cells) } };
  }

  // ---- metrics --------------------------------------------------------------

  /** Characteristic body length (largest bbox extent) in lattice cells. */
  private characteristicLength(): number {
    const geom = this.obstacleGeometry;
    const fit = this.displayFit;
    if (!geom || !fit) return 0;
    if (!geom.boundingBox) geom.computeBoundingBox();
    const bb = geom.boundingBox;
    if (!bb) return 0;
    const size = bb.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z) * fit.scale;
  }

  private publishMetrics() {
    const macro = this.macroOut;
    if (!macro) return;
    const { nx, ny, nz } = this;
    const aRef = frontalAreaCells(this.flags, nx, ny, nz);
    const survey = wakeSurvey3D(macro, nx, ny, nz, Math.floor(nx * 0.8), this.state.u0, this.flags);
    const q = 0.5 * this.state.u0 * this.state.u0;
    const Cd = aRef > 0 && q > 0 ? survey.drag / (q * aRef) : 0;
    const Cl = aRef > 0 && q > 0 ? survey.lift / (q * aRef) : 0;
    const nu = (1 / this.state.omega - 0.5) / 3;
    const L = this.characteristicLength();
    const Re = nu > 0 ? (this.state.u0 * L) / nu : 0;
    const solid = countSolidCells(this.flags);
    const zh = this.api.locale === 'zh-CN';
    const metrics: ScienceMetric[] = [
      {
        key: 'cd',
        label: 'C_d',
        value: fmtMetric(Cd),
        severity: 'info',
        hint: zh
          ? `阻力系数 = 尾迹动量亏损 / (½u₀²A_ref)，A_ref = 迎流面积 ${aRef} 格，尾迹取样平面 x=${Math.floor(nx * 0.8)}。`
          : `Drag coefficient = wake momentum deficit / (½u₀²A_ref), A_ref = frontal area ${aRef} cells, survey plane x=${Math.floor(nx * 0.8)}.`,
      },
      {
        key: 'cl',
        label: 'C_l',
        value: fmtMetric(Cl),
        severity: 'info',
        hint: zh ? '升力系数，取自尾迹垂直动量通量 ∫ρuv。' : 'Lift coefficient from the wake vertical momentum flux ∫ρuv.',
      },
      {
        key: 're',
        label: 'Re',
        value: fmtMetric(Re),
        severity: 'info',
        hint: zh
          ? `雷诺数 = u₀L/ν，ν=(1/ω−½)/3，L=${L.toFixed(2)} 格（物体最大跨度）。`
          : `Reynolds number = u₀L/ν, ν=(1/ω−½)/3, L=${L.toFixed(2)} cells (largest body extent).`,
      },
      {
        key: 'solid',
        label: zh ? '固体格子' : 'Solid cells',
        value: fmtMetric(solid),
        severity: 'info',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- CSV export -----------------------------------------------------------

  private currentSliceZ(): number {
    const { nz } = this;
    return Math.max(0, Math.min(nz - 1, Math.round(this.state.sliceFrac * (nz - 1))));
  }

  private exportCsv() {
    const macro = this.macroOut;
    if (!macro) {
      notify(this.api, 'warning', 'No field data to export yet.', '暂无可导出的流场数据。');
      return;
    }
    const { nx, ny } = this;
    const z = this.currentSliceZ();
    const rows: number[][] = [];
    for (let y = 0; y < ny; y += 1) {
      for (let x = 0; x < nx; x += 1) {
        const cell = (z * ny + y) * nx + x;
        rows.push([x, y, macro.rho[cell]!, macro.ux[cell]!, macro.uy[cell]!, macro.uz[cell]!]);
      }
    }
    exportRowsCsv(this.api, 'fluid3d-slice', ['x', 'y', 'rho', 'ux', 'uy', 'uz'], rows);
  }

  // ---- scene management -----------------------------------------------------

  private ensureScene(three: Scene3DHandle) {
    const key = `${this.nx}x${this.ny}x${this.nz}`;
    const same = this.group && this.groupKey === key && this.sceneHandle === three;
    if (!same) {
      this.dropGroup();
      this.createScene(three);
    }
    if (this.group && this.group.parent !== three.scene) three.scene.add(this.group);
  }

  private createScene(three: Scene3DHandle) {
    const { nx, ny, nz } = this;
    const group = new THREE.Group();
    this.outline = buildDomainOutline(nx, ny, nz);
    this.slice = new SliceField(nx, ny);
    this.multiSlice = new MultiSliceField(nx, ny);
    this.trails = new StreamlineTrails(this.trailSeeds);
    this.tracers = new TracerCloud(Math.max(1, this.tracerCount));
    this.obstacle = new ObstacleView();
    group.add(
      this.outline,
      this.slice.mesh,
      this.multiSlice.group,
      this.trails.lines,
      this.tracers.points,
      this.obstacle.mesh,
    );
    this.group = group;
    this.groupKey = `${nx}x${ny}x${nz}`;
    this.sceneHandle = three;
    three.scene.add(group);
    // Frame the whole domain once per domain-size / scene-handle change.
    fitDomainCamera(three.camera, three.controls, nx, ny, nz);
  }

  private dropGroup() {
    if (this.group) {
      if (this.group.parent) this.group.parent.remove(this.group);
      disposeObjectTree(this.group);
      this.group = null;
    }
    this.obstacle = null;
    this.outline = null;
    this.slice = null;
    this.multiSlice = null;
    this.trails = null;
    this.tracers = null;
    this.groupKey = '';
    this.sceneHandle = null;
  }

  // ---- tracers --------------------------------------------------------------

  private seedTracers() {
    const cells = this.nx * this.ny * this.nz;
    this.tracerCount = Math.max(3200, Math.min(4000, Math.floor(cells / 120)));
    this.trailSeeds = Math.max(250, Math.min(400, Math.floor(cells / 1500)));
    this.tracerXyz = new Float32Array(this.tracerCount * 3);
    this.tracerWorld = new Float32Array(this.tracerCount * 3);
    this.tracerAge = new Float32Array(this.tracerCount);
    this.tracerSpeeds = new Float32Array(this.tracerCount);
    this.tracerColors = new Float32Array(this.tracerCount * 3);
    for (let i = 0; i < this.tracerCount; i += 1) {
      this.tracerXyz[i * 3] = this.rand() * this.nx;
      this.tracerXyz[i * 3 + 1] = this.rand() * this.ny;
      this.tracerXyz[i * 3 + 2] = this.rand() * this.nz;
      this.tracerAge[i] = this.rand() * 120;
    }
  }

  /** Trilinear velocity sample at lattice coordinates. */
  private sampleVelocity3D(
    fx: number,
    fy: number,
    fz: number,
    macro: { rho: Float32Array; ux: Float32Array; uy: Float32Array; uz: Float32Array },
  ): [number, number, number] {
    const { nx, ny, nz } = this;
    const x = Math.max(0, Math.min(nx - 1, fx));
    const y = Math.max(0, Math.min(ny - 1, fy));
    const z = Math.max(0, Math.min(nz - 1, fz));
    const x0 = Math.min(Math.floor(x), Math.max(0, nx - 2));
    const y0 = Math.min(Math.floor(y), Math.max(0, ny - 2));
    const z0 = Math.min(Math.floor(z), Math.max(0, nz - 2));
    const tx = x - x0;
    const ty = y - y0;
    const tz = z - z0;
    const sxy = nx;
    const sxyz = nx * ny;
    let vx = 0;
    let vy = 0;
    let vz = 0;
    for (let dz = 0; dz <= 1; dz += 1) {
      const wz = dz === 0 ? 1 - tz : tz;
      for (let dy = 0; dy <= 1; dy += 1) {
        const wy = dy === 0 ? 1 - ty : ty;
        for (let dx = 0; dx <= 1; dx += 1) {
          const wx = dx === 0 ? 1 - tx : tx;
          const w = wx * wy * wz;
          const cell = (z0 + dz) * sxyz + (y0 + dy) * sxy + (x0 + dx);
          vx += macro.ux[cell]! * w;
          vy += macro.uy[cell]! * w;
          vz += macro.uz[cell]! * w;
        }
      }
    }
    return [vx, vy, vz];
  }

  /** Advect tracers by the local velocity; respawn those leaving the domain. */
  private stepTracers(macro: { rho: Float32Array; ux: Float32Array; uy: Float32Array; uz: Float32Array }) {
    const { nx, ny, nz } = this;
    const k = 20;
    const maxAge = Math.ceil(nx / Math.max(1e-6, this.state.u0 * k)) + 40;
    for (let i = 0; i < this.tracerCount; i += 1) {
      const fx = this.tracerXyz[i * 3]!;
      const fy = this.tracerXyz[i * 3 + 1]!;
      const fz = this.tracerXyz[i * 3 + 2]!;
      const [vx, vy, vz] = this.sampleVelocity3D(fx, fy, fz, macro);
      let px = fx + vx * k;
      let py = fy + vy * k;
      let pz = fz + vz * k;
      let age = this.tracerAge[i]! + 1;
      const ci = Math.floor(pz) * nx * ny + Math.floor(py) * nx + Math.floor(px);
      const inside = px >= 0 && px < nx - 1 && py >= 0 && py < ny - 1 && pz >= 0 && pz < nz - 1;
      const blocked = !inside || (ci >= 0 && ci < this.flags.length && this.flags[ci]! > 0.5);
      if (blocked || age > maxAge) {
        // Respawn just inside the inflow face.
        px = this.rand() * 3;
        py = 1 + this.rand() * (ny - 2);
        pz = 1 + this.rand() * (nz - 2);
        age = 0;
      }
      this.tracerXyz[i * 3] = px;
      this.tracerXyz[i * 3 + 1] = py;
      this.tracerXyz[i * 3 + 2] = pz;
      this.tracerAge[i] = age;
      this.tracerSpeeds[i] = Math.sqrt(vx * vx + vy * vy + vz * vz);
    }
  }

  // ---- rendering ------------------------------------------------------------

  private draw() {
    const three = this.three;
    if (!three) {
      this.drawHint();
      return;
    }
    if (this.state.running) {
      this.frameNo += 1;
      const macro = this.macroOut;
      if (macro && this.hasDiverged(macro)) this.recoverFromDivergence();
      if (this.frameNo % 15 === 0) this.publishMetrics();
    }
    this.ensureScene(three);
    this.updateScene(this.macroOut);
    three.setVisible(true);
    three.render();
  }

  private updateScene(macro: { rho: Float32Array; ux: Float32Array; uy: Float32Array; uz: Float32Array } | null) {
    const { nx, ny, nz } = this;
    if (this.obstacle && this.obstacleGeometry && this.displayFit) {
      this.obstacle.set(this.obstacleGeometry, this.displayFit, nx, ny, nz);
    }
    const view = this.state.view;
    if (this.slice) this.slice.mesh.visible = view === 'slice';
    if (this.multiSlice) this.multiSlice.group.visible = view === 'slices';
    if (this.trails) this.trails.lines.visible = view === 'streamlines';
    if (this.tracers) this.tracers.points.visible = view === 'particles';
    if (!macro) return;

    if (view === 'particles' && this.tracers) {
      this.stepTracers(macro);
      const w = this.tracerWorld;
      const ox = (nx - 1) / 2;
      const oy = (ny - 1) / 2;
      const oz = (nz - 1) / 2;
      for (let i = 0; i < this.tracerCount; i += 1) {
        w[i * 3] = this.tracerXyz[i * 3]! - ox;
        w[i * 3 + 1] = this.tracerXyz[i * 3 + 1]! - oy;
        w[i * 3 + 2] = this.tracerXyz[i * 3 + 2]! - oz;
      }
      speedColors(this.tracerSpeeds, this.tracerCount, this.state.u0, this.tracerColors);
      this.tracers.update(w, this.tracerColors, this.tracerCount);
      return;
    }

    if (view === 'streamlines' && this.trails) {
      this.trails.step(
        (x, y, z) => this.sampleVelocity3D(x, y, z, macro),
        nx,
        ny,
        nz,
        this.flags,
        this.state.u0,
      );
      this.trails.update();
      return;
    }

    if (view === 'slices' && this.multiSlice) {
      this.multiSlice.update((zi) => this.fillSliceRgba(macro, zi, 'speed'), nx, ny, nz);
      return;
    }

    if (view === 'slice' && this.slice) {
      const z = this.currentSliceZ();
      this.slice.update(this.fillSliceRgba(macro, z, 'curl'), z, nx, ny, nz);
    }
  }

  /** Paint one cross-section plane: `speed` → velocity ramp, `curl` → vorticity. */
  private fillSliceRgba(
    macro: { rho: Float32Array; ux: Float32Array; uy: Float32Array; uz: Float32Array },
    z: number,
    mode: 'speed' | 'curl',
  ): Uint8Array {
    const { nx, ny } = this;
    const bytes = nx * ny * 4;
    if (!this.sliceRgba || this.sliceRgba.length !== bytes) this.sliceRgba = new Uint8Array(bytes);
    const rgba = this.sliceRgba;
    const plane = z * ny * nx;

    if (mode === 'speed') {
      const u0 = Math.max(1e-9, this.state.u0);
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          const cell = plane + y * nx + x;
          const o = (y * nx + x) * 4;
          if (this.flags[cell]! > 0.5) {
            rgba[o] = 60;
            rgba[o + 1] = 66;
            rgba[o + 2] = 80;
            rgba[o + 3] = 255;
            continue;
          }
          const sp = Math.sqrt(macro.ux[cell]! ** 2 + macro.uy[cell]! ** 2 + macro.uz[cell]! ** 2) / u0;
          const c = speedRamp(sp);
          rgba[o] = Math.round(c[0] * 255);
          rgba[o + 1] = Math.round(c[1] * 255);
          rgba[o + 2] = Math.round(c[2] * 255);
          rgba[o + 3] = 255;
        }
      }
    } else {
      // In-plane vorticity ωz = ∂uy/∂x − ∂ux/∂y on the slice, finite differences.
      if (!this.curlSlice || this.curlSlice.length !== nx * ny) this.curlSlice = new Float32Array(nx * ny);
      const curl = this.curlSlice;
      let peak = 1e-9;
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          const cell = plane + y * nx + x;
          if (this.flags[cell]! > 0.5) {
            curl[y * nx + x] = 0;
            continue;
          }
          const xm = x > 0 ? cell - 1 : cell;
          const xp = x < nx - 1 ? cell + 1 : cell;
          const ym = y > 0 ? cell - nx : cell;
          const yp = y < ny - 1 ? cell + nx : cell;
          const dxSpan = x > 0 && x < nx - 1 ? 2 : 1;
          const dySpan = y > 0 && y < ny - 1 ? 2 : 1;
          const duy = (macro.uy[xp]! - macro.uy[xm]!) / dxSpan;
          const dux = (macro.ux[yp]! - macro.ux[ym]!) / dySpan;
          const w = duy - dux;
          curl[y * nx + x] = w;
          const aw = Math.abs(w);
          if (aw > peak) peak = aw;
        }
      }
      const norm = 1 / peak;
      for (let y = 0; y < ny; y += 1) {
        for (let x = 0; x < nx; x += 1) {
          const cell = plane + y * nx + x;
          const o = (y * nx + x) * 4;
          if (this.flags[cell]! > 0.5) {
            rgba[o] = 60;
            rgba[o + 1] = 66;
            rgba[o + 2] = 80;
            rgba[o + 3] = 255;
            continue;
          }
          const c = vorticityRamp(curl[y * nx + x]! * norm);
          rgba[o] = Math.round(c[0] * 255);
          rgba[o + 1] = Math.round(c[1] * 255);
          rgba[o + 2] = Math.round(c[2] * 255);
          rgba[o + 3] = 255;
        }
      }
    }
    return rgba;
  }

  /** 2-D hint when the host has no 3-D surface available. */
  private drawHint() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 400;
    canvas.height = canvas.clientHeight || 300;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(
      this.api.locale === 'zh-CN' ? '该插件需要三维视口' : 'This plugin needs the 3-D viewport',
      canvas.width / 2,
      canvas.height / 2,
    );
  }
}

export default function createFluid3dPlugin(): Plugin {
  return new Fluid3dPlugin();
}
