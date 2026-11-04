// ==========================================================================
// Example plugin: N-Body Gravity Simulator (3D)
//
// Astrophysics direct-summation N-body integration in three dimensions.
// Demonstrates the heavy "embarrassingly parallel" scientific workload that
// benefits most from GPU compute: every body feels the gravitational pull of
// every other body (O(N²) per step). On the GPU it runs an all-pairs WGSL
// kernel with ping-pong buffers; on the CPU it runs the exact same integrator
// (used as the fallback and for the interactive animation). The trajectory is
// identical in both modes — only the speed differs.
//
// Data-driven: the plugin never fabricates a dataset. It renders an empty 3D
// scene until the user drops a `.json` file or loads sample data.
// ==========================================================================

import * as THREE from 'three';
import type {
  ComputeBufferHandle,
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  GpuComputeApi,
  ParamDefinition,
  Plugin,
  PluginApi,
  Scene3DHandle,
} from '@/types/plugin';
import { logger } from '@/core/logger';
import { emit } from '@/core/events';
import {
  actionButton,
  exportRowsCsv,
} from '@/core/plugin-tools/enhance';
import { setScienceOutputs, clearScienceOutputs, fmtMetric, type ScienceMetric } from '@/core/research/scienceOutput';
import { mulberry32 } from '@/core/repro/random';
import {
  advanceNBodyCPU,
  nbodyBufferBytes,
  nbodyKernelWGSL,
  NBODY_BUFFER_USAGE,
  NBODY_PARAMS_USAGE,
  packBodies,
  packNBodyParams,
  unpackBodies,
  type NBodyBody,
} from '@/core/wgsl';

export { nbodyManifest } from './manifest';
import { nbodyManifest } from './manifest';

/** Hard cap on the CPU path so the one-shot Compute button cannot freeze the
 *  main thread. The GPU path is not capped — it dispatches the full N. */
const CPU_NBODY_CAP = 3000;
/**
 * Bodies the *interactive* loop can integrate every frame.
 *
 * Higher than the one-shot cap because the all-pairs sweep now evaluates
 * each pair once (Newton's third law) instead of twice, and because the run
 * loop is the only place where a partial sweep is visible: integrating a
 * prefix used to leave every body past the cap frozen in place on screen.
 */
const INTERACTIVE_NBODY_CAP = 4096;
const MAX_BODIES = 8192;
/** Slider granularity for the Bodies count (also its lower bound). */
const NBODY_COUNT_STEP = 64;

interface State {
  count: number;
  G: number;
  softening: number;
  dt: number;
  steps: number;
  seed: number;
  simTime: number;
  running: boolean;
  hasData: boolean;
}

export class NBodyPlugin implements Plugin {
  readonly manifest = nbodyManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private state: State = {
    count: 4096,
    G: 0.05,
    softening: 0.03,
    dt: 0.004,
    steps: 120,
    seed: 42,
    simTime: 0,
    running: false,
    hasData: false,
  };
  private bodies: NBodyBody[] = [];
  /** Original loaded dataset, never mutated — resampling reads from here so
   *  lowering the count and raising it again restores the full set (the old
   *  code resampled from the already-downsampled working set, which
   *  permanently destroyed the loaded data). */
  private raw: NBodyBody[] = [];
  private pointsMesh: THREE.Points | null = null;
  private positionAttr = new Float32Array(0);
  private colorAttr = new Float32Array(0);
  private posBufAttr: THREE.BufferAttribute | null = null;
  private colBufAttr: THREE.BufferAttribute | null = null;
  private rafId = 0;
  /** Total energy at the baseline state (t = 0 of the current run). */
  private e0: number | null = null;
  /** Last science-output publish time (throttle: ≥ 0.5 s between writes). */
  private lastPub = 0;
  /** Set by the host cancel handler while a one-shot compute is in flight;
   *  the step loops check it between steps and bail out cleanly. */
  private computeCancel = false;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.stop();
    this.clearMesh();
    this.three = null;
    this.ctx = null;
    clearScienceOutputs(this.manifest.id);
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stop();
    this.clearMesh();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    // The host mounts `three` only for plugins declaring renderToScene.
    if (container.three) this.three = container.three;
    this.draw();
  }

  /** Explicit entry point for the host-managed Three.js scene. */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.draw();
  }

  /**
   * Upper bound of the Bodies slider.
   *
   * Resampling draws from the loaded initial conditions, so a fixed
   * `MAX_BODIES` ceiling let the slider run past the end of the data: the
   * request was silently clamped and the control appeared to do nothing.
   * Reported bounds now match the dataset actually available.
   */
  private get countMax(): number {
    if (!this.state.hasData) return MAX_BODIES;
    const step = NBODY_COUNT_STEP;
    const n = this.raw.length;
    return Math.max(step, Math.min(MAX_BODIES, Math.ceil(n / step) * step));
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.count === 'number' && params.count !== this.state.count) {
      this.state.count = Math.max(
        NBODY_COUNT_STEP,
        Math.min(this.countMax, Math.floor(params.count)),
      );
      // Only resample a real dataset; never fabricate one.
      if (this.state.hasData) this.resampleLoaded();
    }
    if (typeof params.G === 'number') {
      if (params.G !== this.state.G) this.e0 = null; // baseline energy no longer comparable
      this.state.G = params.G;
    }
    if (typeof params.softening === 'number') {
      if (params.softening !== this.state.softening) this.e0 = null;
      this.state.softening = params.softening;
    }
    if (typeof params.dt === 'number') this.state.dt = params.dt;
    if (typeof params.steps === 'number') this.state.steps = Math.max(1, Math.floor(params.steps));
    if (typeof params.seed === 'number' && Number.isFinite(params.seed)) {
      this.state.seed = Math.max(0, Math.min(0xffffffff, Math.floor(params.seed))) >>> 0;
    }
    if (this.buttonFired(params, 'genICs')) {
      this.generateSeededICs();
      return;
    }
    if (this.buttonFired(params, 'runKepler')) {
      void this.runKeplerBenchmark();
      return;
    }
    if (typeof params.start === 'boolean') {
      if (params.start) this.start();
      else this.stop();
    }
    if ((params as { compute?: { action?: string } })?.compute?.action === 'gpu-compute') void this.runCompute();
    // Export buttons accept both the host's `{ key: { action } }` emission and
    // a plain `{ key: true }` call. They never touch the running state.

    if (this.buttonFired(params, 'exportCsv')) {
      this.exportCsv();
    }
  }

  /** True when a button param arrives as `true` (direct call/test) or as the
   *  host's `{ action: key }` emission. */
  private buttonFired(params: Record<string, unknown>, key: string): boolean {
    const v = params[key];
    return v === true || (typeof v === 'object' && v !== null && (v as { action?: string }).action === key);
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'count',
        label: 'Bodies',
        labelI18n: { 'zh-CN': '天体数量', 'en-US': 'Bodies' },
        type: 'range',
        min: NBODY_COUNT_STEP,
        max: this.countMax,
        step: NBODY_COUNT_STEP,
        value: this.state.count,
      },
      { key: 'G', label: 'Gravity G', labelI18n: { 'zh-CN': '引力常数 G', 'en-US': 'Gravity G' }, type: 'range', min: 0.005, max: 0.5, step: 0.005, value: this.state.G, hint: this.zh() ? '模拟单位 L³/(M·T²)，范围 0.005–0.5' : 'simulation units L³/(M·T²), range 0.005–0.5' },
      { key: 'softening', label: 'Softening', labelI18n: { 'zh-CN': '软化因子', 'en-US': 'Softening' }, type: 'range', min: 0.005, max: 0.3, step: 0.005, value: this.state.softening, hint: this.zh() ? '模拟单位 L，范围 0.005–0.3（Plummer 软化，避免近距奇点）' : 'simulation units L, range 0.005–0.3 (Plummer softening against close-encounter singularities)' },
      { key: 'dt', label: 'Timestep', labelI18n: { 'zh-CN': '时间步长', 'en-US': 'Timestep' }, type: 'range', min: 0.0005, max: 0.02, step: 0.0005, value: this.state.dt, hint: this.zh() ? '模拟单位 T，范围 0.0005–0.02（辛欧拉积分器）' : 'simulation units T, range 0.0005–0.02 (symplectic Euler integrator)' },
      { key: 'steps', label: 'Compute steps', labelI18n: { 'zh-CN': '计算步数', 'en-US': 'Compute steps' }, type: 'range', min: 10, max: 400, step: 10, value: this.state.steps },
      { key: 'seed', label: 'RNG seed', labelI18n: { 'zh-CN': '随机种子', 'en-US': 'RNG seed' }, type: 'number', min: 0, max: 4294967295, step: 1, value: this.state.seed, hint: this.zh() ? 'mulberry32 种子：相同种子生成完全相同的随机初始条件' : 'mulberry32 seed: the same seed regenerates identical random ICs' },
      {
        key: 'start',
        label: 'Run',
        type: 'toggle',
        value: this.state.running,
        offLabelI18n: { 'zh-CN': '▶ 开始模拟', 'en-US': '▶ Run' },
        onLabelI18n: { 'zh-CN': '■ 停止模拟', 'en-US': '■ Stop' },
      },
      {
        key: 'compute',
        label: 'Compute',
        type: 'button',
        variant: 'primary',
        action: 'gpu-compute',
        labelI18n: { 'zh-CN': 'GPU 全配对计算', 'en-US': 'GPU all-pairs' },
      },
      actionButton('exportCsv', 'Export Bodies CSV', '导出天体 CSV'),
      actionButton('genICs', 'Seeded Random ICs', '随机初始条件（种子）'),
      actionButton('runKepler', 'Two-Body Kepler Benchmark', '二体开普勒基准（benchmark）', 'primary'),
    ];
  }

  private zh(): boolean {
    return this.api.locale.startsWith('zh');
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const bodies = this.parseData(text);
    if (bodies.length < 2) {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '无法解析数据文件' : 'Could not parse data file');
      return;
    }
    // A new dataset invalidates a *running* simulation: halt it first so the
    // freshly loaded bodies are not immediately integrated by the still-running
    // frame loop. The user restarts explicitly with Start.
    if (this.state.running) this.stop();
    this.bodies = bodies;
    // Keep a pristine copy of the loaded dataset for non-destructive
    // resampling (body objects are mutated in place by the integrators).
    this.raw = bodies.map((b) => ({ ...b }));
    this.state.hasData = true;
    this.state.simTime = 0;
    this.e0 = null; // recaptured lazily on the next publish (pre-integration state)
    // Never keep more bodies on screen than the slider can report: a loader
    // handing us more than MAX_BODIES would otherwise leave `state.count` and
    // the drawn set disagreeing (the same "slider cannot be filled" defect the
    // protein network had). Resampling from the pristine copy keeps every
    // loaded body recoverable.
    if (this.bodies.length > MAX_BODIES) {
      this.state.count = MAX_BODIES;
      this.resampleLoaded();
    } else {
      this.state.count = Math.max(NBODY_COUNT_STEP, this.bodies.length);
      this.api.reportDataScale(this.bodies.length);
      this.rebuildMesh();
    }
    this.fitCamera();
    this.draw();
    this.publish(true);
  }

  /**
   * Advance the simulation `steps` times. Uses the real WGSL all-pairs kernel
   * when a GPU is available (no per-step read-back — ping-pong buffers keep it
   * on the device), and the CPU-equivalent integrator otherwise. Reports the
   * measured time to the perf panel.
   */
  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    this.computeCancel = false;
    // Host cancellation (status-bar 取消 / stop): flip the flag so the step
    // loops below can bail out between steps; always unsubscribe on settle.
    const offCancel = this.api.onCancel?.(() => {
      this.computeCancel = true;
    });
    try {
      if (this.bodies.length === 0) {
        return { ok: false, error: this.api.locale === 'zh-CN' ? '未加载数据 — 请先拖入 .json 文件或打开「示例数据」' : 'no data — load a .json file or sample data first' };
      }
      const steps = this.state.steps;
      const { dt, G, softening } = this.state;
      const t0 = performance.now();
      const gpu = this.api.gpu;
      const n = this.bodies.length;

      if (gpu?.available) {
        this.api.setStatus('computing');
        const ok = await this.gpuIntegrate(gpu, steps, onProgress, () => this.computeCancel);
        this.api.setStatus('ready');
        if (this.computeCancel) {
          // Cancelled mid-dispatch: report and stop — never fall through to
          // the CPU fallback (a plain `ok === false` there means kernel failure).
          this.api.notify('info', this.api.locale === 'zh-CN' ? '计算已取消' : 'Compute cancelled');
          return { ok: false, error: 'cancelled' };
        }
        if (ok) {
          const ms = performance.now() - t0;
          const engine = gpu.backend;
          this.api.reportGpuTime(ms);
          this.state.simTime += dt * steps;
          this.updateGeometry();
          this.publish(true);
          const result: ComputeResult = { ok: true, output: n, metrics: { gpuMs: ms, bytes: nbodyBufferBytes(n) } };
          // Background completion (the user switched plugins mid-run): the
          // instance keeps the result (singleton state), but never draw into
          // the shared canvas the now-active plugin owns — surface a
          // non-intrusive jump-back toast instead.
          if (this.api.isActive?.() === false) {
            const zh = this.api.locale === 'zh-CN';
            this.api.notify(
              'success',
              zh
                ? `计算完成（后台，${engine}）— ${ms.toFixed(1)} ms`
                : `Compute finished (background, ${engine}) — ${ms.toFixed(1)} ms`,
              { label: zh ? '查看结果' : 'View results', run: () => emit('plugin:activate-request', { id: this.manifest.id }) },
            );
            return result;
          }
          this.draw();
          return result;
        }
      }

      // CPU fallback — mirror of the WGSL kernel.
      const cap = Math.min(n, CPU_NBODY_CAP);
      if (cap < n) {
        this.api.notify(
          'info',
          this.api.locale === 'zh-CN'
            ? `CPU 模式仅模拟前 ${cap} / ${n} 个天体（GPU 模式使用全部）`
            : `CPU mode simulates the first ${cap} / ${n} bodies (GPU uses all)`,
        );
      }
      const work = this.bodies.slice(0, cap);
      for (let s = 0; s < steps; s += 1) {
        if (this.computeCancel) {
          this.api.setStatus('ready');
          this.api.notify('info', this.api.locale === 'zh-CN' ? '计算已取消' : 'Compute cancelled');
          return { ok: false, error: 'cancelled' };
        }
        advanceNBodyCPU(work, dt, G, softening);
        onProgress?.({ done: s + 1, total: steps });
      }
      for (let i = 0; i < cap; i += 1) this.bodies[i] = work[i] as NBodyBody;
      this.state.simTime += dt * steps;
      this.updateGeometry();
      this.publish(true);
      const ms = performance.now() - t0;
      this.api.reportGpuTime(ms);
      // Report the work actually done — the CPU path only simulated `cap` bodies,
      // so `bytes` must not claim the full-N buffer allocation.
      const result: ComputeResult = { ok: true, output: cap, metrics: { gpuMs: ms, bytes: nbodyBufferBytes(cap) } };
      // Background completion: same contract as the GPU path — keep the
      // result on the instance, notify with a jump-back, never draw.
      if (this.api.isActive?.() === false) {
        const zh = this.api.locale === 'zh-CN';
        this.api.notify(
          'success',
          zh
            ? `计算完成（后台，cpu）— ${ms.toFixed(1)} ms`
            : `Compute finished (background, cpu) — ${ms.toFixed(1)} ms`,
          { label: zh ? '查看结果' : 'View results', run: () => emit('plugin:activate-request', { id: this.manifest.id }) },
        );
        return result;
      }
      this.draw();
      return result;
    } finally {
      offCancel?.();
    }
  }

  /** Trigger the accelerated compute path from the params button. */
  private async runCompute() {
    if (this.bodies.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '请先加载数据 — 拖入 .json 文件或打开「示例数据」'
          : 'Load data first — drop a .json file or open sample data',
      );
      return;
    }
    const result = await this.compute(null, (p) => {
      this.api.notify('info', `${p.done}/${p.total}`);
    });
    if (result.ok) {
      // A background completion already surfaced its own jump-back toast in
      // compute() — don't double-notify.
      if (this.api.isActive?.() === false) return;
      const engine = this.api.gpu?.available ? this.api.gpu?.backend : 'cpu';
      this.api.notify(
        'success',
        this.api.locale === 'zh-CN'
          ? `计算完成（${engine}）— ${result.metrics?.gpuMs?.toFixed(1) ?? '?'} ms`
          : `Compute done (${engine}) — ${result.metrics?.gpuMs?.toFixed(1) ?? '?'} ms`,
      );
    } else if (result.error === 'cancelled') {
      // Cancelled by the user — informational, not an error.
      this.api.notify(
        'info',
        this.api.locale === 'zh-CN' ? '计算已取消' : 'Compute cancelled',
      );
    } else {
      this.api.notify('error', result.error ?? 'compute failed');
    }
  }

  /** Snapshot the host-managed 3-D scene as a PNG. */

  /** Snapshot only the bodies (transparent background, no grid/axes) as PNG. */

  /** Export the currently drawn bodies (position, velocity, mass) as a full
   *  system snapshot with the current simulation time column. The set is
   *  already capped at MAX_BODIES (< 50k rows), so every body is exported. */
  private exportCsv() {
    const bodies = this.bodies;
    const MAX_ROWS = 50000;
    const stride = Math.max(1, Math.ceil(bodies.length / MAX_ROWS));
    const t = this.state.simTime;
    const rows: number[][] = [];
    for (let i = 0; i < bodies.length; i += stride) {
      const b = bodies[i] as NBodyBody;
      rows.push([t, b.x, b.y, b.z, b.vx, b.vy, b.vz, b.mass]);
    }
    exportRowsCsv(this.api, 'nbody-bodies', ['t', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'mass'], rows);
  }

  /**
   * Real WGSL all-pairs path with ping-pong buffers so the N step dispatches
   * stay on the device (no per-step read-back). Returns false on any failure
   * so `compute()` can transparently fall back to CPU — except when the
   * `isCancelled` predicate fires, which `compute()` detects via its own
   * cancel flag and reports as a cancellation instead of a fallback.
   */
  private async gpuIntegrate(
    gpu: GpuComputeApi,
    steps: number,
    onProgress?: (p: ComputeProgress) => void,
    isCancelled?: () => boolean,
  ): Promise<boolean> {
    const n = this.bodies.length;
    let bufA: ComputeBufferHandle | null = null;
    let bufB: ComputeBufferHandle | null = null;
    let paramsBuf: ComputeBufferHandle | null = null;
    try {
      bufA = gpu.createBuffer(
        nbodyBufferBytes(n),
        NBODY_BUFFER_USAGE,
        'nbody.A',
      );
      bufB = gpu.createBuffer(
        nbodyBufferBytes(n),
        NBODY_BUFFER_USAGE,
        'nbody.B',
      );
      paramsBuf = gpu.createBuffer(
        16,
        NBODY_PARAMS_USAGE,
        'nbody.params',
      );
      if (!bufA || !bufB || !paramsBuf) return false;

      const kernel = gpu.compileKernel({
        label: 'nbody.integrate',
        wgsl: nbodyKernelWGSL(),
        workgroupSize: [64, 1, 1],
        bindings: [
          { binding: 0, bufferType: 'read-only-storage' },
          { binding: 1, bufferType: 'storage' },
          { binding: 2, bufferType: 'uniform' },
        ],
      });
      if (!kernel) return false;

      bufA.write(packBodies(this.bodies));
      paramsBuf.write(new Uint8Array(packNBodyParams(this.state.dt, this.state.G, this.state.softening, n)));
      const workgroups = Math.max(1, Math.ceil(n / 64));

      let lastOut: ComputeBufferHandle = bufB;
      for (let s = 0; s < steps; s += 1) {
        // Bail before the next dispatch when the host cancelled: the finally
        // block destroys the buffers and no result is read back.
        if (isCancelled?.()) return false;
        const inBuf = s % 2 === 0 ? bufA : bufB;
        const outBuf = s % 2 === 0 ? bufB : bufA;
        if (!gpu.run(kernel, [inBuf, outBuf, paramsBuf], workgroups, 1, 1)) return false;
        lastOut = outBuf;
        onProgress?.({ done: s + 1, total: steps });
      }

      const result = await lastOut.read();
      unpackBodies(new Float32Array(result), this.bodies);
      this.api.reportDataScale(this.bodies.length);
      return true;
    } catch (err) {
      logger.warn('nbody', 'GPU compute failed, falling back to CPU', err);
      return false;
    } finally {
      bufA?.destroy();
      bufB?.destroy();
      paramsBuf?.destroy();
    }
  }

  /** Parse JSON ICs (7-column arrays or {x,y,z,vx,vy,vz,mass} objects). */
  private parseData(text: string): NBodyBody[] {
    const trimmed = text.trim();
    let parsed: unknown = null;
    if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = null;
      }
    }
    const arr = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? (parsed as { bodies?: unknown }).bodies : null;
    if (Array.isArray(arr)) {
      const out: NBodyBody[] = [];
      // JSON values are untrusted: strings like "1.0", null or booleans all
      // arrive as non-number primitives that would poison Float32 uploads.
      const num = (v: unknown): number => {
        const n = Number(v);
        return Number.isFinite(n) ? n : Number.NaN;
      };
      const velocity = (v: unknown): number => {
        const n = num(v);
        return Number.isFinite(n) ? n : 0;
      };
      const mass = (v: unknown): number => {
        const n = num(v);
        return Number.isFinite(n) && n > 0 ? n : 1;
      };
      for (const item of arr) {
        if (Array.isArray(item)) {
          const it = item as unknown[];
          const x = num(it[0]);
          const y = num(it[1]);
          const z = num(it[2]);
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            out.push({ x, y, z, vx: velocity(it[3]), vy: velocity(it[4]), vz: velocity(it[5]), mass: mass(it[6]) });
          }
        } else if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const x = num(o.x);
          const y = num(o.y);
          const z = num(o.z);
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            out.push({
              x, y, z,
              vx: velocity(o.vx),
              vy: velocity(o.vy),
              vz: velocity(o.vz),
              mass: mass(o.mass ?? o.m),
            });
          }
        }
      }
      if (out.length) return out;
    }
    // Fallback: whitespace/comma columns [x y z vx vy vz mass].
    const out: NBodyBody[] = [];
    for (const line of trimmed.split(/\r?\n/)) {
      const parts = line
        .trim()
        .split(/[\s,]+/)
        .map((s) => parseFloat(s))
        .filter(Number.isFinite);
      if (parts.length >= 3) {
        out.push({
          x: parts[0] as number,
          y: parts[1] as number,
          z: parts[2] as number,
          vx: parts[3] ?? 0,
          vy: parts[4] ?? 0,
          vz: parts[5] ?? 0,
          mass: parts[6] ?? 1,
        });
      }
    }
    return out;
  }

  /** Resample the loaded dataset down to the current count (from the pristine
   *  copy, so the operation is non-destructive). */
  private resampleLoaded() {
    const n = this.raw.length;
    const target = Math.min(this.state.count, n);
    const next: NBodyBody[] = [];
    for (let i = 0; i < target; i += 1) {
      const idx = Math.min(Math.floor((i * n) / target), n - 1);
      next.push({ ...(this.raw[idx] as NBodyBody) });
    }
    this.bodies = next;
    this.api.reportDataScale(this.bodies.length);
    this.rebuildMesh();
    this.draw();
  }

  private start() {
    if (this.state.running) return;
    if (this.bodies.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '请先加载数据 — 拖入 .json 文件或打开「示例数据」'
          : 'Load data first — drop a .json file or open sample data',
      );
      return;
    }
    // Cap the set *once*, before the loop starts, rather than integrating a
    // prefix every frame: bodies past the cap would never move. The resample
    // is non-destructive — the pristine copy keeps every loaded body, so
    // lowering the count and raising it again restores the full dataset.
    if (this.bodies.length > INTERACTIVE_NBODY_CAP) {
      this.state.count = INTERACTIVE_NBODY_CAP;
      this.resampleLoaded();
      this.api.notify(
        'info',
        this.api.locale === 'zh-CN'
          ? `交互式模拟运行前 ${INTERACTIVE_NBODY_CAP} / ${this.raw.length} 个天体（算力上限）`
          : `Interactive run uses the first ${INTERACTIVE_NBODY_CAP} / ${this.raw.length} bodies (compute limit)`,
      );
    }
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
    // One integration step per frame, over the *whole* drawn set. Slicing a
    // prefix here (the old CPU cap) left every remaining body pinned at its
    // initial position — a ring of motionless points that looked like a
    // rendering bug. The set is capped once, when the run starts, instead.
    advanceNBodyCPU(this.bodies, this.state.dt, this.state.G, this.state.softening);
    this.state.simTime += this.state.dt;
    this.updateGeometry();
    this.draw();
    // Conservation diagnostics to the science strip, throttled to ≥ 0.5 s so
    // the animation loop never floods the store.
    this.publish();
    this.rafId = requestAnimationFrame(this.tick);
  };

  // ---- Scientific outputs -------------------------------------------------

  /**
   * Total energy E = Σ ½mv² − Σ_{i<j} G m_i m_j / r, with the same Plummer
   * softening as the integrator so the diagnostic tracks the actual equations
   * of motion. For large N the pair sum is evaluated on a fixed strided
   * subsample (scaled by stride²) — an unbiased estimator that keeps the
   * per-publish cost bounded; the subsample is disclosed in the metric hint.
   */
  private totalEnergy(bs: NBodyBody[], G: number, softening: number): number {
    let ke = 0;
    for (const b of bs) ke += 0.5 * b.mass * (b.vx * b.vx + b.vy * b.vy + b.vz * b.vz);
    const eps2 = softening * softening;
    const n = bs.length;
    let pe = 0;
    if (n <= 800) {
      for (let i = 0; i < n; i += 1) {
        const a = bs[i]!;
        for (let j = i + 1; j < n; j += 1) {
          const b = bs[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const r = Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
          pe -= (G * a.mass * b.mass) / r;
        }
      }
    } else {
      const stride = Math.ceil(n / 800);
      for (let i = 0; i < n; i += stride) {
        const a = bs[i]!;
        for (let j = i + stride; j < n; j += stride) {
          const b = bs[j]!;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const r = Math.sqrt(dx * dx + dy * dy + dz * dz + eps2);
          pe -= (G * a.mass * b.mass) / r;
        }
      }
      pe *= stride * stride;
    }
    return ke + pe;
  }

  /** Publish conservation / state diagnostics (throttled; empty set clears). */
  private publish(force = false) {
    const now = performance.now();
    if (!force && now - this.lastPub < 500) return;
    this.lastPub = now;
    if (!this.state.hasData || this.bodies.length === 0) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const zh = this.zh();
    if (this.e0 === null) this.e0 = this.totalEnergy(this.bodies, this.state.G, this.state.softening);
    const E = this.totalEnergy(this.bodies, this.state.G, this.state.softening);
    const denom = Math.max(Math.abs(this.e0), 1e-30);
    const drift = Math.abs(E - this.e0) / denom;
    const metrics: ScienceMetric[] = [
      {
        key: 'energy-drift',
        label: '|ΔE/E₀|',
        value: fmtMetric(drift),
        severity: drift < 1e-3 ? 'ok' : drift < 1e-2 ? 'warn' : 'error',
        hint: zh
          ? '总能量 E=Σ½mv²−ΣGmm/r 相对基线的漂移；<1e-3 良好，<1e-2 警告。N>800 时势能按固定跨步子采样估计（×stride²）'
          : 'Drift of total energy E=Σ½mv²−ΣGmm/r against its baseline; <1e-3 ok, <1e-2 warn. For N>800 the pair sum is a fixed-stride subsample (×stride²)',
      },
      {
        key: 'energy',
        label: 'E',
        value: fmtMetric(E),
        severity: 'info',
        hint: zh ? '当前总能量（模拟单位 M·L²/T²）' : 'Current total energy (simulation units M·L²/T²)',
      },
      {
        key: 'n-bodies',
        label: 'N',
        value: String(this.bodies.length),
        severity: 'info',
      },
      {
        key: 'sim-time',
        label: 't',
        value: fmtMetric(this.state.simTime),
        severity: 'info',
        hint: zh ? '累积模拟时间（模拟单位 T）' : 'Accumulated simulation time (simulation units T)',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  /**
   * Seeded random initial conditions (mulberry32): a rotationally-supported
   * disc of `count` bodies. Explicitly user-requested generation — never
   * fabricated as a silent default — and fully reproducible from the seed.
   */
  private generateSeededICs() {
    if (this.state.running) this.stop();
    const rng = mulberry32(this.state.seed);
    const n = Math.max(NBODY_COUNT_STEP, Math.min(this.countMax, this.state.count));
    const R = 2;
    const bodies: NBodyBody[] = [];
    let totalMass = 0;
    for (let i = 0; i < n; i += 1) {
      const m = 0.5 + rng() * 1.5;
      totalMass += m;
      const r = 0.3 + rng() * (R - 0.3);
      const th = rng() * Math.PI * 2;
      bodies.push({
        x: r * Math.cos(th),
        y: r * Math.sin(th),
        z: (rng() - 0.5) * 0.3 * (1 - r / R),
        vx: 0,
        vy: 0,
        vz: 0,
        mass: m,
      });
    }
    // Near-circular tangential speeds for the mass enclosed in r (uniform disc
    // approximation), with 5% scatter — a stable rotating disc, not a cold collapse.
    for (const b of bodies) {
      const r = Math.max(0.1, Math.hypot(b.x, b.y));
      const mEnc = totalMass * Math.min(1, (r * r) / (R * R));
      const v = Math.sqrt((this.state.G * mEnc) / r);
      const th = Math.atan2(b.y, b.x);
      const jitter = 1 + (rng() - 0.5) * 0.1;
      b.vx = -v * Math.sin(th) * jitter;
      b.vy = v * Math.cos(th) * jitter;
      b.vz = (rng() - 0.5) * 0.04 * v;
    }
    this.bodies = bodies;
    this.raw = bodies.map((b) => ({ ...b }));
    this.state.count = Math.max(NBODY_COUNT_STEP, Math.min(this.countMax, n));
    this.state.hasData = true;
    this.state.simTime = 0;
    this.e0 = null;
    this.rebuildMesh();
    this.fitCamera();
    this.draw();
    this.publish(true);
    this.api.notify(
      'success',
      this.zh()
        ? `已生成 ${n} 个天体的随机初始条件（mulberry32 种子 ${this.state.seed}）`
        : `Generated ${n} seeded random ICs (mulberry32 seed ${this.state.seed})`,
    );
  }

  /**
   * Two-body Kepler benchmark [benchmark]: circular-orbit initial conditions
   * for an equal-mass pair, integrated in isolation. The measured orbital
   * period (first 2π crossing of the unwrapped relative angle) is compared
   * against Kepler's third law T = 2π·√(a³/GM).
   */
  private runKeplerBenchmark() {
    if (this.state.running) this.stop();
    const G = this.state.G;
    const m1 = 1;
    const m2 = 1;
    const M = m1 + m2;
    const a = 1; // separation = semi-major axis (circular)
    const vRel = Math.sqrt((G * M) / a);
    const bodies: NBodyBody[] = [
      { x: (-a * m2) / M, y: 0, z: 0, vx: 0, vy: (-vRel * m2) / M, vz: 0, mass: m1 },
      { x: (a * m1) / M, y: 0, z: 0, vx: 0, vy: (vRel * m1) / M, vz: 0, mass: m2 },
    ];
    this.bodies = bodies;
    this.raw = bodies.map((b) => ({ ...b }));
    this.state.hasData = true;
    this.rebuildMesh();
    this.fitCamera();
    this.draw();

    const T = 2 * Math.PI * Math.sqrt((a * a * a) / (G * M));
    const dt = Math.min(this.state.dt, T / 4000);
    const softening = 0; // circular orbit keeps r = a — no softening needed
    const maxSteps = Math.min(200000, Math.ceil((1.3 * T) / dt));
    const e0 = this.totalEnergy(bodies, G, softening);
    const TWO_PI = Math.PI * 2;
    let prev = Math.atan2(bodies[1]!.y - bodies[0]!.y, bodies[1]!.x - bodies[0]!.x);
    let unwrapped = prev;
    let tPeriod = Number.NaN;
    let maxDrift = 0;
    for (let s = 1; s <= maxSteps; s += 1) {
      advanceNBodyCPU(bodies, dt, G, softening);
      const rx = bodies[1]!.x - bodies[0]!.x;
      const ry = bodies[1]!.y - bodies[0]!.y;
      const th = Math.atan2(ry, rx);
      let d = th - prev;
      if (d > Math.PI) d -= TWO_PI;
      if (d < -Math.PI) d += TWO_PI;
      const a0 = unwrapped;
      unwrapped = a0 + d;
      prev = th;
      if (a0 < TWO_PI && unwrapped >= TWO_PI) {
        const frac = (TWO_PI - a0) / Math.max(1e-30, d);
        tPeriod = (s - 1 + frac) * dt;
        break;
      }
      if (s % 50 === 0) {
        const E = this.totalEnergy(bodies, G, softening);
        maxDrift = Math.max(maxDrift, Math.abs(E - e0) / Math.max(Math.abs(e0), 1e-30));
      }
    }
    const err = Number.isFinite(tPeriod) ? Math.abs(tPeriod - T) / T : Number.NaN;
    const zh = this.zh();
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-T-sim',
        label: 'T_sim [bench]',
        value: fmtMetric(tPeriod),
        severity: 'info',
        hint: zh
          ? '二体开普勒基准：相对角首次转过 2π 的模拟时刻（圆轨道，a=1，等质量）'
          : 'Two-body Kepler benchmark [benchmark]: simulated time for the relative angle to first sweep 2π (circular orbit, a=1, equal masses)',
      },
      {
        key: 'bench-T-kepler',
        label: 'T_Kepler',
        value: fmtMetric(T),
        severity: 'info',
        hint: zh ? '开普勒第三定律 T=2π√(a³/GM) 的解析值' : 'Analytic Kepler third law T=2π√(a³/GM)',
      },
      {
        key: 'bench-period-err',
        label: '|ΔT/T|',
        value: fmtMetric(err),
        severity: err < 5e-3 ? 'ok' : err < 2e-2 ? 'warn' : 'error',
        hint: zh ? '测量周期与开普勒解析周期的相对误差（辛欧拉频率误差 O((ω·dt)²)）' : 'Relative period error vs the Kepler analytic value (symplectic-Euler frequency error O((ω·dt)²))',
      },
      {
        key: 'bench-energy-drift',
        label: '|ΔE/E₀| [bench]',
        value: fmtMetric(maxDrift),
        severity: maxDrift < 1e-3 ? 'ok' : maxDrift < 1e-2 ? 'warn' : 'error',
        hint: zh ? '基准积分全程的最大能量漂移' : 'Maximum energy drift over the benchmark integration',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    this.state.simTime = Number.isFinite(tPeriod) ? tPeriod : 0;
    this.e0 = e0;
    this.api.notify(
      'success',
      zh
        ? `二体开普勒基准完成：|ΔT/T| = ${fmtMetric(err)}（T_sim=${fmtMetric(tPeriod)}, T_Kepler=${fmtMetric(T)}）`
        : `Two-body Kepler benchmark done: |ΔT/T| = ${fmtMetric(err)} (T_sim=${fmtMetric(tPeriod)}, T_Kepler=${fmtMetric(T)})`,
    );
  }

  // ---- 3-D rendering ----

  private clearMesh() {
    if (!this.pointsMesh) return;
    this.three?.scene.remove(this.pointsMesh);
    this.pointsMesh.geometry.dispose();
    (this.pointsMesh.material as THREE.Material).dispose();
    this.pointsMesh = null;
  }

  private rebuildMesh() {
    if (!this.three) return;
    this.clearMesh();
    const n = this.bodies.length;
    if (n === 0) return;

    this.positionAttr = new Float32Array(n * 3);
    this.colorAttr = new Float32Array(n * 3);

    const geometry = new THREE.BufferGeometry();
    this.posBufAttr = new THREE.BufferAttribute(this.positionAttr, 3);
    this.colBufAttr = new THREE.BufferAttribute(this.colorAttr, 3);
    geometry.setAttribute('position', this.posBufAttr);
    geometry.setAttribute('color', this.colBufAttr);

    const material = new THREE.PointsMaterial({
      size: 0.02,
      sizeAttenuation: true,
      vertexColors: true,
    });

    this.pointsMesh = new THREE.Points(geometry, material);
    this.three.scene.add(this.pointsMesh);
    this.updateGeometry();
  }

  /** Copy current body positions + speed colors into the mesh attributes. */
  private updateGeometry() {
    if (!this.pointsMesh) return;
    const n = this.bodies.length;
    if (this.positionAttr.length !== n * 3) {
      this.rebuildMesh();
      return;
    }
    let maxV = 1e-6;
    for (const b of this.bodies) maxV = Math.max(maxV, Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz));

    for (let i = 0; i < n; i += 1) {
      const b = this.bodies[i] as NBodyBody;
      this.positionAttr[i * 3] = b.x;
      this.positionAttr[i * 3 + 1] = b.y;
      this.positionAttr[i * 3 + 2] = b.z;
      const t = Math.min(1, Math.sqrt(b.vx * b.vx + b.vy * b.vy + b.vz * b.vz) / maxV);
      const [r, g, bl] = speedRgb(t);
      this.colorAttr[i * 3] = r;
      this.colorAttr[i * 3 + 1] = g;
      this.colorAttr[i * 3 + 2] = bl;
    }
    this.posBufAttr!.needsUpdate = true;
    this.colBufAttr!.needsUpdate = true;
  }

  private fitCamera() {
    if (!this.three) return;
    if (this.bodies.length === 0) {
      this.three.render();
      return;
    }
    let maxR = 1e-6;
    for (const b of this.bodies) maxR = Math.max(maxR, Math.sqrt(b.x * b.x + b.y * b.y + b.z * b.z));
    const { camera, controls } = this.three;
    controls.target.set(0, 0, 0);
    const dist = Math.max(maxR * 2.8, 2);
    camera.position.set(dist * 0.7, dist * 0.55, dist);
    camera.near = Math.max(maxR / 100, 1e-3);
    camera.far = Math.max(maxR * 200, 100);
    camera.updateProjectionMatrix();
    controls.update();
  }

  private draw() {
    if (this.three) {
      if (this.bodies.length > 0 && !this.pointsMesh) this.rebuildMesh();
      this.three.render();
      return;
    }
    // Fallback: no 3-D container — show an informative 2-D hint.
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
    const msg =
      this.api.locale === 'zh-CN'
        ? '拖入 .json 初始条件或打开「示例数据」'
        : 'Drop a .json file or load sample data';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

/** Blue → cyan → yellow → red speed ramp, returned as RGB triplets. */
function speedRgb(t: number): [number, number, number] {
  const stops = [
    [37, 99, 235],
    [45, 212, 191],
    [251, 191, 36],
    [239, 68, 68],
  ];
  const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const local = t * (stops.length - 1) - seg;
  const a = stops[seg] as number[];
  const b = stops[seg + 1] as number[];
  return [
    Math.round(a[0]! + (b[0]! - a[0]!) * local) / 255,
    Math.round(a[1]! + (b[1]! - a[1]!) * local) / 255,
    Math.round(a[2]! + (b[2]! - a[2]!) * local) / 255,
  ];
}

export default function createNBodyPlugin(): Plugin {
  return new NBodyPlugin();
}
