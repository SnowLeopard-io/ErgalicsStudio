// ==========================================================================
// Example plugin: Lattice Boltzmann Fluid (D2Q9, 2-D channel flow)
//
// Two-dimensional lattice-Boltzmann channel flow with an internal obstacle.
// Demonstrates vortex shedding (Kármán street) and the "embarrassingly
// parallel" timestep pattern: the collide+stream pair runs as WGSL kernels
// on the GPU with ping-pong buffers, or as the exact CPU-equivalent when
// no WebGPU device is available.
//
// Data-driven: the obstacle shape can be supplied as a mask file (JSON grid,
// 1 = solid) via loadData; without a file a built-in inclined ellipse seeds
// the vortex street. The flow field itself is a simulation state, not data.
// ==========================================================================

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
} from '@/types/plugin';
import { logger } from '@/core/logger';
import { actionButton, exportCanvasPng, exportRowsCsv, notify } from './shared/enhance';
import {
  FLUID_DIRECTIONS,
  FLUID_FIELD_USAGE,
  FLUID_FLAGS_USAGE,
  FLUID_PARAMS_USAGE,
  fluidCollideKernelWGSL,
  fluidCurlBytes,
  fluidCurlKernelWGSL,
  fluidEquilibrium,
  fluidFieldBytes,
  fluidFlagsBytes,
  fluidMacroCPU,
  fluidCurlCPU,
  fluidStepCPU,
  fluidStreamKernelWGSL,
  packFluidParams,
} from '@/core/wgsl';

export { fluidManifest } from './fluidManifest';
import { fluidManifest } from './fluidManifest';

// Lattice sizes (multiples of the 8×8 workgroup tile → no overhang).
// The GPU path runs full resolution; the CPU fallback drops to a quarter of
// the cells so interactive frame rates survive without WebGPU. The "high"
// tier trades frame rate for sharper obstacle edges (airfoil silhouette).
const SIZES = {
  'gpu-standard': { cols: 576, rows: 336 },
  'gpu-high': { cols: 768, rows: 448 },
  'cpu-standard': { cols: 288, rows: 168 },
  'cpu-high': { cols: 432, rows: 248 },
} as const;

const MAX_MASK = 512;

/**
 * Steps over which the inflow is ramped from rest to the requested speed
 * after every reseed.
 *
 * Seeding the channel at full speed with the obstacle already in place is an
 * impulsive start: it launches a compression wave that crosses the domain,
 * reflects off the downstream edge and sloshes back and forth for thousands
 * of steps. Ramping the inflow removes the shock at the source.
 */
const INFLOW_RAMP_STEPS = 300;

/** A diverging lattice is never local — sample it instead of sweeping it. */
const STABILITY_SCAN_STRIDE = 97;

/**
 * Relaxation bounds. ω = 2 − 1/τ, so the ceiling fixes how close to the
 * τ = 0.5 stability limit the solver is allowed to run.
 */
const OMEGA_MIN = 1.6;
const OMEGA_MAX = 1.9;

/**
 * Frames between full field read-backs on the GPU path. The per-frame
 * read-back is deliberately limited to the small curl buffer (the
 * population field is several MB), but the CPU copy still has to be
 * refreshed now and then so the divergence guard sees real data.
 */
const GPU_SYNC_EVERY = 30;

interface State {
  omega: number;
  u0: number;
  view: 'curl' | 'speed' | 'flow';
  running: boolean;
  /** Lattice detail tier — re-allocates the arrays and replays the mask. */
  lattice: 'standard' | 'high';
  /** True once an obstacle mask has been loaded — the plugin never
   * fabricates a default obstacle; without data it stays empty. */
  hasData: boolean;
}

/** Cached WebGPU buffers + compiled kernels, keyed by lattice dimensions. */
interface GpuResourceSet {
  key: string;
  fieldA: ComputeBufferHandle;
  fieldB: ComputeBufferHandle;
  flagsBuf: ComputeBufferHandle;
  paramsBuf: ComputeBufferHandle;
  curlBuf: ComputeBufferHandle;
  collide: GpuKernelHandle;
  stream: GpuKernelHandle;
  observe: GpuKernelHandle;
}

export class FluidPlugin implements Plugin {
  readonly manifest = fluidManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = {
    omega: 1.8,
    u0: 0.1,
    // Velocity view by default: the incoming flow is visible across the
    // whole channel; vorticity (zero for uniform flow) is one switch away.
    view: 'speed',
    running: false,
    lattice: 'standard',
    hasData: false,
  };
  /** Lattice size, chosen by engine + detail tier (see SIZES). */
  private cols: number = SIZES['cpu-standard'].cols;
  private rows: number = SIZES['cpu-standard'].rows;
  private flags = new Float32Array(0);
  private f = new Float32Array(0);
  private fpost = new Float32Array(0);
  /** Parsed obstacle mask kept so a lattice change can replay it. */
  private maskData: { width: number; height: number; values: number[][] } | null = null;
  private stepsPerFrame = 2;
  private rafId = 0;
  /**
   * Set whenever the CPU lattice was (re)seeded — the next GPU batch must
   * re-upload the field. After a synced batch the GPU field evolves on its
   * own and only the small curl buffer is read back per frame (the full
   * population field is several MB — too heavy to copy every frame).
   */
  private gpuDirty = true;
  /** Steps taken since the last reseed — drives the inflow ramp. */
  private stepsSinceSeed = 0;
  /** Frame counter for the periodic GPU → CPU field sync. */
  private frameNo = 0;
  /** Set once a divergence has been reported, so it is not re-reported on
   *  every frame until the user restarts or reloads. */
  private diverged = false;

  /**
   * Persistent GPU resources for the current lattice size.
   *
   * The old path created five buffers and recompiled three kernels on EVERY
   * frame — hundreds of allocations + WGSL compiles per second, with the
   * ping-pong field recreated zero-filled each time (the GPU field could
   * never evolve beyond the first batch). Buffers and kernels now live for
   * the plugin's lifetime and are only rebuilt when the lattice dimensions
   * change (or after a failure); the field carries across frames in
   * fieldA (collide A→B, stream B→A).
   */
  private gpuRes: GpuResourceSet | null = null;

  /**
   * Inflow speed actually fed to the solver.
   *
   * Smoothstep from rest to `state.u0` over `INFLOW_RAMP_STEPS`.
   */
  private get inflowU0(): number {
    if (this.stepsSinceSeed >= INFLOW_RAMP_STEPS) return this.state.u0;
    const t = Math.max(0, this.stepsSinceSeed / INFLOW_RAMP_STEPS);
    return this.state.u0 * t * t * (3 - 2 * t);
  }

  async init(api: PluginApi) {
    this.api = api;
    // Pick the lattice size once, by engine: the CPU integrator cannot hold
    // interactive rates at full resolution (194k cells × 9 populations).
    const gpu = api.gpu?.available ?? false;
    this.applyLattice(gpu ? 'gpu-standard' : 'cpu-standard');
    this.stepsPerFrame = gpu ? 2 : 1;
  }

  /** Re-allocate the lattice for an engine + tier pair and replay the mask. */
  private applyLattice(key: keyof typeof SIZES) {
    const size = SIZES[key];
    this.cols = size.cols;
    this.rows = size.rows;
    // GPU buffers are sized to the old lattice — drop them; the next GPU
    // batch rebuilds the set and re-uploads the reseeded field.
    this.destroyGpuResources();
    this.flags = new Float32Array(this.cols * this.rows);
    this.f = new Float32Array(this.cols * this.rows * FLUID_DIRECTIONS);
    this.fpost = new Float32Array(this.cols * this.rows * FLUID_DIRECTIONS);
    this.lastCurl = null;
    if (this.maskData) {
      this.applyMask(this.maskData);
      this.seed();
    }
    this.draw();
  }

  async destroy() {
    this.stop();
    this.destroyGpuResources();
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stop();
  }

  async render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    // Export buttons accept both the host's `{ key: { action } }` emission and
    // a plain `{ key: true }` call. They never touch the running state.
    const fired = (key: string): boolean => {
      const v = params[key];
      return v === true || (typeof v === 'object' && v !== null && (v as { action?: string }).action === key);
    };
    if (fired('exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'fluid');
      return;
    }
    if (fired('exportCsv')) {
      this.exportCsv();
      return;
    }
    if (typeof params.omega === 'number') {
      // Clamp to the declared range [1.6, 1.9] — ω → 2 means relaxation
      // time τ → 0.5, where BGK goes numerically unstable at this
      // resolution (τ = 0.513 at the old 1.95 ceiling diverged on a
      // routine channel run).
      this.state.omega = Math.max(OMEGA_MIN, Math.min(OMEGA_MAX, params.omega));
    }
    if (typeof params.u0 === 'number') {
      // Clamp to the declared range [0.02, 0.18] — above ~0.18 the LBM
      // equilibrium expansion leaves the low-Mach regime and blows up.
      this.state.u0 = Math.max(0.02, Math.min(0.18, params.u0));
    }
    if (params.view === 'curl' || params.view === 'speed' || params.view === 'flow') {
      this.state.view = params.view;
    }
    if (
      (params.lattice === 'standard' || params.lattice === 'high') &&
      params.lattice !== this.state.lattice
    ) {
      this.state.lattice = params.lattice;
      // Re-allocate the lattice: pause first so the tick never reads a
      // half-swapped field set.
      this.stop();
      const gpu = this.api.gpu?.available ?? false;
      this.applyLattice(`${gpu ? 'gpu' : 'cpu'}-${params.lattice}` as keyof typeof SIZES);
    }
    if (typeof params.steps === 'number') {
      this.stepsPerFrame = Math.max(1, Math.min(10, Math.round(params.steps)));
    }
    if (typeof params.start === 'boolean') {
      if (params.start) this.start();
      else this.stop();
    }
    const reset = params.reset as { action?: string } | undefined;
    if (reset?.action === 'reset') {
      // Reset replays the loaded mask's initial conditions; it never
      // fabricates a default obstacle when no data has been loaded.
      if (!this.state.hasData) {
        this.api.notify(
          'warning',
          this.api.locale === 'zh-CN'
            ? '尚未加载障碍掩膜 — 拖入 JSON 掩膜或打开「示例数据」'
            : 'No obstacle mask loaded — drop a JSON mask or open sample data',
        );
        return;
      }
      this.seed();
      this.draw();
    }
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'u0',
        label: 'Inflow Speed',
        labelI18n: { 'zh-CN': '入流速度', 'en-US': 'Inflow Speed' },
        type: 'range',
        min: 0.02,
        max: 0.18,
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
        key: 'lattice',
        label: 'Lattice Detail',
        labelI18n: { 'zh-CN': '网格精度', 'en-US': 'Lattice Detail' },
        type: 'select',
        value: this.state.lattice,
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
        value: this.stepsPerFrame,
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        value: this.state.view,
        options: [
          { value: 'flow', label: 'Wind Flow', labelI18n: { 'zh-CN': '气流线', 'en-US': 'Wind Flow' } },
          { value: 'speed', label: 'Velocity', labelI18n: { 'zh-CN': '流速', 'en-US': 'Velocity' } },
          { value: 'curl', label: 'Vorticity', labelI18n: { 'zh-CN': '涡量', 'en-US': 'Vorticity' } },
        ],
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
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportCsv', 'Export Field CSV', '导出流场 CSV'),
    ];
  }

  /** Export macroscopic field samples (x, y, rho, ux, uy) as CSV. The grid is
   *  sampled at an equal stride so the output stays under 10k rows. */
  private exportCsv() {
    if (!this.state.hasData) {
      notify(
        this.api,
        'warning',
        'No field data to export yet.',
        '暂无可导出的流场数据。',
      );
      return;
    }
    const { rho, ux, uy } = this.macro();
    const cells = this.cols * this.rows;
    const MAX_ROWS = 10000;
    const stride = Math.max(1, Math.ceil(cells / MAX_ROWS));
    const rows: number[][] = [];
    for (let cell = 0; cell < cells; cell += stride) {
      rows.push([cell % this.cols, Math.floor(cell / this.cols), rho[cell]!, ux[cell]!, uy[cell]!]);
    }
    exportRowsCsv(this.api, 'fluid-field', ['x', 'y', 'rho', 'ux', 'uy'], rows);
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  /** Load an obstacle mask (JSON grid: 1 = solid). */
  async loadData(file: File) {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '无法解析掩膜文件（JSON）' : 'Could not parse mask file (JSON)');
      return;
    }
    const mask = parseMask(parsed);
    if (!mask) {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '需要 0/1 二值网格作为障碍掩膜' : 'Expected a 0/1 grid as the obstacle mask');
      return;
    }
    // A new mask invalidates a *running* simulation: halt it first so the
    // freshly seeded field is not immediately advanced by the still-running
    // frame loop. The user restarts explicitly with Run.
    if (this.state.running) this.stop();
    // Keep the parsed mask so a Lattice Detail change can replay it.
    this.maskData = mask;
    this.state.hasData = true;
    this.diverged = false;
    this.applyMask(mask);
    this.seed();
    this.draw();
  }

  /** Resample a mask onto the lattice (nearest neighbour, fluid borders). */
  private applyMask(mask: { width: number; height: number; values: number[][] }): void {
    this.flags.fill(0);
    for (let y = 0; y < this.rows; y += 1) {
      const sy = Math.min(mask.height - 1, Math.floor((y * mask.height) / this.rows));
      for (let x = 0; x < this.cols; x += 1) {
        const sx = Math.min(mask.width - 1, Math.floor((x * mask.width) / this.cols));
        this.flags[y * this.cols + x] = mask.values[sy]![sx]! > 0.5 ? 1 : 0;
      }
    }
    // Keep the boundary columns fluid so inflow/outflow still work.
    for (let y = 0; y < this.rows; y += 1) {
      this.flags[y * this.cols] = 0;
      this.flags[y * this.cols + this.cols - 1] = 0;
    }
    this.gpuDirty = true;
  }

  /**
   * One-shot compute: advance the flow `steps` steps on the GPU when
   * available, else on the CPU. Reports measured time to the perf panel.
   */
  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => Promise<void> | void): Promise<ComputeResult> {
    if (!this.state.hasData) {
      return { ok: false, error: 'no data — load an obstacle mask first' };
    }
    const steps = 120;
    const t0 = performance.now();
    const gpu = this.api.gpu;

    if (gpu?.available) {
      this.api.setStatus('computing');
      // One-shot compute keeps the CPU field authoritative.
      const gpuOk = await this.gpuAdvance(gpu, steps, onProgress, { upload: true, read: true });
      this.api.setStatus('ready');
      if (gpuOk) {
        const gpuMs = performance.now() - t0;
        this.api.reportGpuTime(gpuMs);
        this.draw();
        return {
          ok: true,
          output: this.cols * this.rows,
          metrics: { gpuMs, bytes: fluidFieldBytes(this.cols * this.rows) },
        };
      }
    }

    for (let s = 0; s < steps; s += 1) {
      fluidStepCPU(this.f, this.fpost, this.flags, this.cols, this.rows, this.state.omega, this.inflowU0);
      this.stepsSinceSeed += 1;
      await onProgress?.({ done: s + 1, total: steps });
    }
    this.draw();
    const cpuMs = performance.now() - t0;
    this.api.reportGpuTime(cpuMs);
    return { ok: true, output: this.cols * this.rows, metrics: { gpuMs: cpuMs, bytes: fluidFieldBytes(this.cols * this.rows) } };
  }

  /**
   * Seed the flow field: uniform inflow equilibrium + a weak inlet
   * perturbation so the wake sheds. The obstacle comes exclusively from the
   * loaded mask — there is no built-in default shape.
   */
  private seed() {
    // Restart the inflow ramp: the field is seeded at rest and the inflow
    // eases in, so the obstacle never appears "all at once" (the impulsive
    // start that produced the domain-crossing pressure wave).
    this.stepsSinceSeed = 0;
    const uStart = this.inflowU0;
    const feq = fluidEquilibrium(1, uStart, 0);
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        const base = (y * this.cols + x) * FLUID_DIRECTIONS;
        for (let d = 0; d < FLUID_DIRECTIONS; d += 1) {
          this.f[base + d] = feq[d]!;
        }
      }
    }
    // Weak inlet perturbation so the wake breaks symmetry and sheds.
    for (let y = 0; y < this.rows; y += 1) {
      const uy = uStart * 0.05 * Math.sin((2 * Math.PI * 3 * y) / this.rows);
      const base = (y * this.cols + 1) * FLUID_DIRECTIONS;
      const feqWiggle = fluidEquilibrium(1, uStart, uy);
      for (let d = 0; d < FLUID_DIRECTIONS; d += 1) this.f[base + d] = feqWiggle[d]!;
    }
    this.gpuDirty = true;
  }

  private start() {
    if (this.state.running) return;
    if (!this.state.hasData) {
      // Data-driven: without a loaded mask there is nothing to simulate.
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '请先加载障碍掩膜 — 拖入 JSON 掩膜或打开「示例数据」'
          : 'Load an obstacle mask first — drop a JSON mask or open sample data',
      );
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
      // GPU path: advance a batch, read the result + curl back, then draw.
      // The wind-flow view additionally needs the velocity field every frame
      // for particle advection, so it forces a field readback; every other
      // view pulls the full field back periodically so the CPU-side copy the
      // divergence guard inspects never goes stale.
      this.frameNo += 1;
      const opts =
        this.state.view === 'flow' || this.frameNo % GPU_SYNC_EVERY === 0 ? { read: true } : {};
      void this.gpuAdvance(gpu, this.stepsPerFrame, undefined, opts).then(
        (ok) => {
          if (ok) this.draw();
          else this.drawCpuFrame();
        },
        (err) => {
          logger.warn('fluid', 'GPU frame failed', err);
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
      fluidStepCPU(this.f, this.fpost, this.flags, this.cols, this.rows, this.state.omega, this.inflowU0);
      this.stepsSinceSeed += 1;
    }
  }

  /** CPU fallback frame (used when the GPU batch failed mid-run). */
  private drawCpuFrame() {
    this.stepCpu();
    this.draw();
  }

  /**
   * Whether the lattice has diverged.
   *
   * A BGK run that goes unstable never recovers by itself — the populations
   * fill with NaN/inf and every later frame renders garbage. Sampling the
   * macroscopic fields (and, on the GPU path, the curl read back each frame)
   * catches it while it is cheap to fix.
   */
  private hasDiverged(rho: Float32Array, ux: Float32Array, uy: Float32Array): boolean {
    for (let cell = 0; cell < rho.length; cell += STABILITY_SCAN_STRIDE) {
      // Solid cells legitimately hold zero populations.
      if (this.flags[cell]! > 0.5) continue;
      const r = rho[cell]!;
      const speed = Math.abs(ux[cell]!) + Math.abs(uy[cell]!);
      // Thresholds sit far outside anything physical (u0 ≤ 0.18, so a
      // legitimate peak is well under 1) — only a diverged run reaches them.
      if (!Number.isFinite(r) || !Number.isFinite(speed)) return true;
      if (r < 0.2 || r > 3 || speed > 0.75) return true;
    }
    return false;
  }

  /** Recover from a diverged lattice: reseed, stop, and tell the user. */
  private recoverFromDivergence() {
    if (this.diverged) return; // already reported — do not reseed every frame
    this.diverged = true;
    this.stop();
    this.seed();
    this.api.notify(
      'warning',
      this.api.locale === 'zh-CN'
        ? '流场数值发散 — 已自动重置。请降低入流速度或松弛率后重新开始'
        : 'Flow diverged — reset automatically. Lower the inflow speed or relaxation rate, then restart',
    );
  }

  /**
   * Advance the GPU field `steps` steps.
   *
   * - `upload`: push the CPU field to the GPU first (also implied whenever
   *   the lattice was reseeded — `gpuDirty`).
   * - `read`: pull the field back into the CPU arrays afterwards (needed by
   *   the flow view for particle advection, and after reseeded batches).
   *
   * Without either, only the small curl buffer is read per frame (the full
   * population field is several MB — too heavy to copy every frame).
   * Returns false on any failure (caller falls back to CPU).
   */
  private async gpuAdvance(
    gpu: GpuComputeApi,
    steps: number,
    onProgress?: (p: ComputeProgress) => Promise<void> | void,
    opts: { upload?: boolean; read?: boolean } = {},
  ): Promise<boolean> {
    const upload = opts.upload === true || this.gpuDirty;
    const read = opts.read === true || upload;
    const cells = this.cols * this.rows;
    const key = `${this.cols}x${this.rows}`;

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
      // Flags are immutable between mask/lattice changes (both set
      // gpuDirty); upload on a fresh set or a reseed, not every frame.
      if (fresh || upload) res.flagsBuf.write(this.flags);
      // 16 bytes — cheap, and omega/the inflow ramp change per frame.
      res.paramsBuf.write(new Uint8Array(packFluidParams(this.cols, this.rows, this.state.omega, this.inflowU0)));
      const wgX = Math.ceil(this.cols / 8);
      const wgY = Math.ceil(this.rows / 8);

      for (let s = 0; s < steps; s += 1) {
        if (!gpu.run(res.collide, [res.fieldA, res.fieldB, res.flagsBuf, res.paramsBuf], wgX, wgY, 1)) {
          this.failGpuResources();
          return false;
        }
        if (!gpu.run(res.stream, [res.fieldB, res.fieldA, res.flagsBuf, res.paramsBuf], wgX, wgY, 1)) {
          this.failGpuResources();
          return false;
        }
        this.stepsSinceSeed += 1;
        await onProgress?.({ done: s + 1, total: steps });
      }

      if (!gpu.run(res.observe, [res.fieldA, res.curlBuf, res.paramsBuf], wgX, wgY, 1)) {
        this.failGpuResources();
        return false;
      }
      const curlBytes = await res.curlBuf.read();
      const curl = new Float32Array(curlBytes);

      // Pull the field back when requested or when it was just uploaded —
      // the per-frame readback stays limited to the small curl buffer.
      if (read) {
        const fieldBytes = await res.fieldA.read();
        this.f.set(new Float32Array(fieldBytes));
      }
      if (upload) this.gpuDirty = false;
      this.lastCurl = curl;
      return true;
    } catch (err) {
      logger.warn('fluid', 'GPU compute failed, falling back to CPU', err);
      this.failGpuResources();
      return false;
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
      const fieldA = gpu.createBuffer(fluidFieldBytes(cells), FLUID_FIELD_USAGE, 'fluid.fieldA');
      const fieldB = gpu.createBuffer(fluidFieldBytes(cells), FLUID_FIELD_USAGE, 'fluid.fieldB');
      const flagsBuf = gpu.createBuffer(fluidFlagsBytes(cells), FLUID_FLAGS_USAGE, 'fluid.flags');
      const paramsBuf = gpu.createBuffer(16, FLUID_PARAMS_USAGE, 'fluid.params');
      const curlBuf = gpu.createBuffer(fluidCurlBytes(cells), FLUID_FIELD_USAGE, 'fluid.curl');
      buffers.push(fieldA, fieldB, flagsBuf, paramsBuf, curlBuf);
      if (!fieldA || !fieldB || !flagsBuf || !paramsBuf || !curlBuf) {
        cleanup();
        return null;
      }

      const collide = gpu.compileKernel({
        label: 'fluid.collide',
        wgsl: fluidCollideKernelWGSL(),
        workgroupSize: [8, 8, 1],
        bindings: [
          { binding: 0, bufferType: 'read-only-storage' },
          { binding: 1, bufferType: 'storage' },
          { binding: 2, bufferType: 'read-only-storage' },
          { binding: 3, bufferType: 'uniform' },
        ],
      });
      const stream = gpu.compileKernel({
        label: 'fluid.stream',
        wgsl: fluidStreamKernelWGSL(),
        workgroupSize: [8, 8, 1],
        bindings: [
          { binding: 0, bufferType: 'read-only-storage' },
          { binding: 1, bufferType: 'storage' },
          { binding: 2, bufferType: 'read-only-storage' },
          { binding: 3, bufferType: 'uniform' },
        ],
      });
      const observe = gpu.compileKernel({
        label: 'fluid.curl',
        wgsl: fluidCurlKernelWGSL(),
        workgroupSize: [8, 8, 1],
        bindings: [
          { binding: 0, bufferType: 'read-only-storage' },
          { binding: 1, bufferType: 'storage' },
          { binding: 2, bufferType: 'uniform' },
        ],
      });
      if (!collide || !stream || !observe) {
        // Kernels have no destroy handle; release the buffers so a failed
        // build never leaks half a resource set.
        cleanup();
        return null;
      }

      return { key, fieldA, fieldB, flagsBuf, paramsBuf, curlBuf, collide, stream, observe };
    } catch (err) {
      logger.warn('fluid', 'GPU resource creation failed, falling back to CPU', err);
      cleanup();
      return null;
    }
  }

  /** Tear down cached buffers (lattice change, failure or plugin destroy). */
  private destroyGpuResources(): void {
    const r = this.gpuRes;
    if (!r) return;
    this.gpuRes = null;
    for (const buf of [r.fieldA, r.fieldB, r.flagsBuf, r.paramsBuf, r.curlBuf]) {
      try {
        buf.destroy();
      } catch {
        /* already destroyed / device lost */
      }
    }
  }

  /** A dispatch/read failed: drop the (suspect) resource set and force a
   *  full re-upload on the next successful rebuild. */
  private failGpuResources(): void {
    this.destroyGpuResources();
    this.gpuDirty = true;
  }

  private lastCurl: Float32Array | null = null;
  /** Reused macroscopic buffers — see `fluidMacroCPU`'s `out` parameter. */
  private macroBuf: { rho: Float32Array; ux: Float32Array; uy: Float32Array } | null = null;

  /** Macroscopic fields for the current population field, without allocating
   *  three `cells`-sized arrays on every frame. */
  private macro() {
    const cells = this.cols * this.rows;
    if (!this.macroBuf || this.macroBuf.rho.length !== cells) {
      this.macroBuf = {
        rho: new Float32Array(cells),
        ux: new Float32Array(cells),
        uy: new Float32Array(cells),
      };
    }
    return fluidMacroCPU(this.f, this.cols, this.rows, this.macroBuf);
  }
  /** Offscreen grid-resolution canvas, bilinearly upscaled when drawn. */
  private offscreen: HTMLCanvasElement | null = null;

  // ---- Wind-flow tracer particles (lattice coordinates) ----------------
  private flowX: Float32Array = new Float32Array(0);
  private flowY: Float32Array = new Float32Array(0);
  private flowPrevX: Float32Array = new Float32Array(0);
  private flowPrevY: Float32Array = new Float32Array(0);
  private flowAge: Float32Array = new Float32Array(0);
  private flowCount = 0;
  /** Deterministic PRNG state so reseeding is reproducible. */
  private rngState = 0x9e3779b9;

  private rand(): number {
    // mulberry32
    this.rngState = (this.rngState + 0x6d2b79f5) | 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** (Re)seed tracer particles for the current lattice size. */
  private seedFlow() {
    this.flowCount = Math.max(400, Math.floor((this.cols * this.rows) / 55));
    this.flowX = new Float32Array(this.flowCount);
    this.flowY = new Float32Array(this.flowCount);
    this.flowPrevX = new Float32Array(this.flowCount);
    this.flowPrevY = new Float32Array(this.flowCount);
    this.flowAge = new Float32Array(this.flowCount);
    // Spread over the whole domain so the first frame is already full.
    for (let i = 0; i < this.flowCount; i += 1) {
      this.flowX[i] = this.rand() * this.cols;
      this.flowY[i] = this.rand() * this.rows;
      this.flowPrevX[i] = this.flowX[i]!;
      this.flowPrevY[i] = this.flowY[i]!;
      this.flowAge[i] = this.rand() * 120;
    }
  }

  /** Bilinear velocity sample at lattice coordinates. */
  private sampleVelocity(fx: number, fy: number, ux: Float32Array, uy: Float32Array): [number, number] {
    const x = Math.max(0, Math.min(this.cols - 1.001, fx));
    const y = Math.max(0, Math.min(this.rows - 1.001, fy));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const i00 = y0 * this.cols + x0;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    const vx =
      ux[i00]! * w00 + ux[i00 + 1]! * w10 + ux[i00 + this.cols]! * w01 + ux[i00 + this.cols + 1]! * w11;
    const vy =
      uy[i00]! * w00 + uy[i00 + 1]! * w10 + uy[i00 + this.cols]! * w01 + uy[i00 + this.cols + 1]! * w11;
    return [vx, vy];
  }

  /** Advect tracers by the local velocity; respawn at the inlet when spent. */
  private stepFlow(ux: Float32Array, uy: Float32Array): void {
    // u ≈ u0 lattice units per step; scale so the streaks clearly move.
    const k = 26;
    // Lifetime must be long enough to cross the whole channel at the inflow
    // speed — a fixed cap left a permanently empty band at the downstream
    // end (particles expired before reaching it).
    const maxAge = Math.ceil(this.cols / Math.max(1e-6, this.state.u0 * k)) + 40;
    for (let i = 0; i < this.flowCount; i += 1) {
      const fx = this.flowX[i]!;
      const fy = this.flowY[i]!;
      this.flowPrevX[i] = fx;
      this.flowPrevY[i] = fy;
      const [vx, vy] = this.sampleVelocity(fx, fy, ux, uy);
      let nx = fx + vx * k;
      let ny = fy + vy * k;
      let age = this.flowAge[i]! + 1;
      const cell = Math.floor(ny) * this.cols + Math.floor(nx);
      const blocked =
        nx < 0 ||
        nx >= this.cols - 1 ||
        ny < 0 ||
        ny >= this.rows - 1 ||
        (nx >= 0 && ny >= 0 && this.flags[cell]! > 0.5);
      if (blocked || age > maxAge) {
        // Respawn just inside the inflow boundary.
        nx = this.rand() * 3;
        ny = 1 + this.rand() * (this.rows - 2);
        age = 0;
        this.flowPrevX[i] = nx;
        this.flowPrevY[i] = ny;
      }
      this.flowX[i] = nx;
      this.flowY[i] = ny;
      this.flowAge[i] = age;
    }
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 400;
    canvas.height = canvas.clientHeight || 300;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    if (!this.state.hasData) {
      // Empty state: no mask loaded — never render a fabricated flow.
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      const msg =
        this.api.locale === 'zh-CN'
          ? '未加载数据 — 拖入 JSON 障碍掩膜或打开「示例数据」'
          : 'No data — drop a JSON obstacle mask or load sample data';
      g.fillText(msg, canvas.width / 2, canvas.height / 2);
      return;
    }

    // Wind-flow view: dark channel + obstacle silhouette, with tracer
    // particles advected by the velocity field drawn as streaks on top —
    // the incoming wind and its bending around the airfoil made visible.
    if (this.state.view === 'flow') {
      if (!this.offscreen) this.offscreen = document.createElement('canvas');
      this.offscreen.width = this.cols;
      this.offscreen.height = this.rows;
      const og = this.offscreen.getContext('2d');
      if (!og) return;
      og.fillStyle = '#10141c';
      og.fillRect(0, 0, this.cols, this.rows);
      const img = og.createImageData(this.cols, this.rows);
      for (let cell = 0; cell < this.cols * this.rows; cell += 1) {
        if (this.flags[cell]! > 0.5) {
          const o = cell * 4;
          img.data[o] = 70;
          img.data[o + 1] = 78;
          img.data[o + 2] = 92;
          img.data[o + 3] = 255;
        } else {
          const o = cell * 4;
          img.data[o + 3] = 255;
        }
      }
      og.putImageData(img, 0, 0);

      const scale = Math.min(canvas.width / this.cols, canvas.height / this.rows);
      const dw = this.cols * scale;
      const dh = this.rows * scale;
      const ox = (canvas.width - dw) / 2;
      const oy = (canvas.height - dh) / 2;
      g.imageSmoothingEnabled = false;
      g.drawImage(this.offscreen, ox, oy, dw, dh);

      // Advect + draw the tracers (seeded lazily / on lattice change).
      if (this.flowCount !== Math.max(400, Math.floor((this.cols * this.rows) / 55))) {
        this.seedFlow();
      }
      let macro = this.macro();
      if (this.hasDiverged(macro.rho, macro.ux, macro.uy)) {
        this.recoverFromDivergence();
        macro = this.macro();
      }
      this.stepFlow(macro.ux, macro.uy);
      g.strokeStyle = 'rgba(120, 220, 255, 0.5)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < this.flowCount; i += 1) {
        g.moveTo(ox + this.flowPrevX[i]! * scale, oy + this.flowPrevY[i]! * scale);
        g.lineTo(ox + this.flowX[i]! * scale, oy + this.flowY[i]! * scale);
      }
      g.stroke();

      if (!this.state.running) {
        g.fillStyle = 'rgba(150, 165, 185, 0.85)';
        g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
        g.textAlign = 'center';
        const msg =
          this.api.locale === 'zh-CN'
            ? '数据已加载 — 勾选 Run 开始模拟'
            : 'Data loaded — tick Run to start';
        g.fillText(msg, canvas.width / 2, oy + dh + 16);
      }
      return;
    }

    // Rasterize the lattice 1:1 on an offscreen canvas, then upscale with
    // bilinear filtering — smooth gradients, no visible cells.
    if (!this.offscreen) this.offscreen = document.createElement('canvas');
    this.offscreen.width = this.cols;
    this.offscreen.height = this.rows;
    const og = this.offscreen.getContext('2d');
    if (!og) return;
    const img = og.createImageData(this.cols, this.rows);

    let macro = this.macro();
    if (this.hasDiverged(macro.rho, macro.ux, macro.uy)) {
      this.recoverFromDivergence();
      macro = this.macro();
    }
    const curl = this.lastCurl ?? fluidCurlCPU(macro.ux, macro.uy, this.cols, this.rows);
    let peak = 0;
    for (let i = 0; i < curl.length; i += 1) peak = Math.max(peak, Math.abs(curl[i]!));
    const norm = peak > 1e-9 ? 1 / peak : 0;

    for (let cell = 0; cell < this.cols * this.rows; cell += 1) {
      let r: number;
      let gg: number;
      let b: number;
      if (this.flags[cell]! > 0.5) {
        r = 70;
        gg = 78;
        b = 92;
      } else if (this.state.view === 'curl') {
        // Diverging vorticity ramp, dark at zero (the physical rest state):
        // clockwise = blue, counter-clockwise = orange, linear in |ω|.
        const t = Math.max(-1, Math.min(1, curl[cell]! * norm * 1.6));
        const a = Math.abs(t);
        const lerp = (p: number, q: number, f: number) => p + (q - p) * f;
        if (t >= 0) {
          r = Math.round(lerp(16, 255, a));
          gg = Math.round(lerp(20, 150, a));
          b = Math.round(lerp(28, 40, a));
        } else {
          r = Math.round(lerp(16, 70, a));
          gg = Math.round(lerp(20, 150, a));
          b = Math.round(lerp(28, 255, a));
        }
      } else {
        // Velocity magnitude: dark background → cyan, easing to white at the
        // inflow ceiling — same dark-at-zero convention as the curl view.
        const sp = Math.sqrt(macro.ux[cell]! ** 2 + macro.uy[cell]! ** 2) / this.state.u0;
        const a = Math.min(1, sp);
        const e = Math.max(0, (a - 0.85) / 0.15);
        const lerp = (p: number, q: number, f: number) => p + (q - p) * f;
        r = Math.round(lerp(lerp(16, 80, a), 230, e));
        gg = Math.round(lerp(lerp(20, 210, a), 245, e));
        b = Math.round(lerp(lerp(28, 255, a), 255, e));
      }
      const o = cell * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
    og.putImageData(img, 0, 0);

    // Fit the lattice to the viewport, preserving aspect ratio. Nearest-
    // neighbour upscaling keeps the obstacle silhouette and vortex filaments
    // crisp — bilinear smoothing made the plate look blurry at CPU resolution.
    const scale = Math.min(canvas.width / this.cols, canvas.height / this.rows);
    const dw = this.cols * scale;
    const dh = this.rows * scale;
    const ox = (canvas.width - dw) / 2;
    const oy = (canvas.height - dh) / 2;
    g.imageSmoothingEnabled = false;
    g.drawImage(this.offscreen, ox, oy, dw, dh);

    if (!this.state.running) {
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      const msg =
        this.api.locale === 'zh-CN'
          ? '数据已加载 — 勾选 Run 开始模拟'
          : 'Data loaded — tick Run to start';
      g.fillText(msg, canvas.width / 2, oy + dh + 16);
    }
  }
}

/**
 * Parse an obstacle mask: `number[][]`, `{ values: number[][] }` or
 * `{ width, height, values }` with 0/1 (or boolean) cells. Returns `null`
 * for anything that is not a rectangular numeric grid.
 */
export function parseMask(parsed: unknown): { width: number; height: number; values: number[][] } | null {
  let node: unknown = parsed;
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.values)) node = obj.values;
  }
  if (!Array.isArray(node)) return null;
  const rows = node as unknown[];
  const values: number[][] = [];
  let width = -1;
  for (const row of rows.slice(0, MAX_MASK)) {
    if (!Array.isArray(row)) return null;
    const nums: number[] = [];
    for (const v of (row as unknown[]).slice(0, MAX_MASK)) {
      if (typeof v === 'boolean') {
        nums.push(v ? 1 : 0);
      } else {
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        nums.push(n);
      }
    }
    if (width === -1) width = nums.length;
    if (nums.length !== width) return null;
    values.push(nums);
  }
  if (values.length < 2 || width < 2) return null;
  return { width, height: values.length, values };
}

export default function createFluidPlugin(): Plugin {
  return new FluidPlugin();
}
