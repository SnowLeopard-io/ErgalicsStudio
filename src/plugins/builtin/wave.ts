// ==========================================================================
// Example plugin: Wave Equation (2-D finite differences)
//
// Solves u_tt = c² ∇²u with a velocity-field leapfrog scheme, matching the
// WGSL kernel math exactly on the CPU fallback.
//
// Data-driven: the plugin starts empty and never fabricates an initial
// field. A scenario file (JSON) supplies the initial displacement `u` and/
// or the `drive` layout (drive < 0 = reflecting barrier, drive > 0 =
// continuous sinusoidal source of that amplitude); both are bundled as
// sample data (pulse / twin-source interference / double slit).
// ==========================================================================

import type {
  ComputeBufferHandle,
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  GpuComputeApi,
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
} from '@/types/plugin';
import { logger } from '@/core/logger';
import {
  WAVE_DRIVE_USAGE,
  WAVE_FIELD_USAGE,
  WAVE_PARAMS_USAGE,
  packWaveParams,
  waveFieldBytes,
  waveKernelWGSL,
  waveStepCPU,
} from '@/core/wgsl';

export const waveManifest: PluginManifest = {
  id: 'example.wave',
  name: 'Wave Equation',
  nameI18n: { 'zh-CN': '波动方程', 'en-US': 'Wave Equation' },
  version: '1.0.0',
  author: 'Ergalics',
  description: '2-D wave equation: pulse, interference, double slit.',
  descriptionI18n: {
    'zh-CN': '二维波动方程有限差分模拟：高斯脉冲、双源干涉、双缝衍射三种场景，GPU 逐步计算 + CPU 降级。',
    'en-US': '2-D finite-difference wave equation: gaussian pulse, two-source interference, and double-slit diffraction; GPU stepping with CPU fallback.',
  },
  license: 'MIT',
  entry: 'example.wave',
  category: 'scientific',
  icon: '◎',
  formats: [
    { extension: '.json', mimeTypes: ['application/json'], description: 'Wave scenario: { u?: grid, drive?: grid }' },
  ],
};

// Fixed grid (multiple of the 8×8 workgroup tile → no overhang).
// 640×400 = 256k cells: fine interference fringes; the GPU path carries the
// interactive loop, the CPU fallback runs at reduced steps per frame.
const W = 640;
const H = 400;

const MAX_GRID = 512;

interface State {
  speed: number; // wave speed c (k = c² with Δx = Δt = 1)
  damping: number;
  running: boolean;
  /** True once a scenario file has been loaded — the plugin never
   * fabricates a default field; without data it stays empty. */
  hasData: boolean;
}

/**
 * Diverging wave palette, linear in displacement so the transition matches
 * the physics: the rest state sits at the dark background colour and the
 * field brightens smoothly toward the wave crests/troughs — gold for
 * positive, cyan for negative, easing to white only at the extremes.
 * t ∈ [-1, 1] (normalized displacement).
 */
function waveColor(t: number): [number, number, number] {
  const x = Math.max(-1, Math.min(1, t));
  const a = Math.abs(x);
  const lerp = (p: number, q: number, f: number) => p + (q - p) * f;
  const e = Math.max(0, (a - 0.85) / 0.15); // peak-only white ease
  if (x >= 0) {
    // Dark navy → gold, then → white at the very peaks.
    return [
      Math.round(lerp(lerp(12, 255, a), 255, e)),
      Math.round(lerp(lerp(16, 190, a), 255, e)),
      Math.round(lerp(lerp(26, 70, a), 235, e)),
    ];
  }
  // Dark navy → cyan, then → white at the very troughs.
  return [
    Math.round(lerp(lerp(12, 70, a), 220, e)),
    Math.round(lerp(lerp(16, 210, a), 250, e)),
    Math.round(lerp(lerp(26, 255, a), 255, e)),
  ];
}

export class WavePlugin implements Plugin {
  readonly manifest = waveManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { speed: 0.45, damping: 0.999, running: false, hasData: false };
  private u = new Float32Array(W * H);
  private v = new Float32Array(W * H);
  private unew = new Float32Array(W * H);
  private vnew = new Float32Array(W * H);
  private drive = new Float32Array(W * H);
  /** Pristine copies of the loaded scenario, replayed by Reset. */
  private initialU: Float32Array | null = null;
  private initialDrive: Float32Array | null = null;
  private time = 0;
  private stepsPerFrame = 2;
  private rafId = 0;
  /** Smoothed peak displacement driving the color scale (anti-flicker). */
  private visPeak = 0;
  /** Offscreen grid-resolution canvas, bilinearly upscaled when drawn. */
  private offscreen: HTMLCanvasElement | null = null;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.stop();
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
    if (typeof params.speed === 'number') {
      // Clamp to the declared range [0.05, 0.7] — k = c² must stay ≤ 0.5 for
      // the leapfrog scheme to be stable; 0.7 is the practical ceiling with
      // damping, anything higher oscillates wildly.
      this.state.speed = Math.max(0.05, Math.min(0.7, params.speed));
    }
    if (typeof params.damping === 'number') {
      this.state.damping = Math.max(0.95, Math.min(1, params.damping));
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
      // Reset replays the loaded scenario's initial conditions; it never
      // fabricates a default field when no data has been loaded.
      if (!this.state.hasData) {
        this.api.notify(
          'warning',
          this.api.locale === 'zh-CN'
            ? '尚未加载波场数据 — 拖入 JSON 场文件或打开「示例数据」'
            : 'No wave data loaded — drop a JSON field file or open sample data',
        );
        return;
      }
      this.replayLoaded();
      this.draw();
    }
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'speed',
        label: 'Wave Speed',
        labelI18n: { 'zh-CN': '波速', 'en-US': 'Wave Speed' },
        type: 'range',
        min: 0.05,
        max: 0.7,
        step: 0.05,
        value: this.state.speed,
      },
      {
        key: 'damping',
        label: 'Damping',
        labelI18n: { 'zh-CN': '阻尼', 'en-US': 'Damping' },
        type: 'range',
        min: 0.95,
        max: 1,
        step: 0.001,
        value: this.state.damping,
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
        key: 'start',
        label: 'Run',
        type: 'toggle',
        value: this.state.running,
        offLabelI18n: { 'zh-CN': '▶ 开始模拟', 'en-US': '▶ Start' },
        onLabelI18n: { 'zh-CN': '■ 停止模拟', 'en-US': '■ Stop' },
      },
      {
        key: 'reset',
        label: 'Reset Field',
        labelI18n: { 'zh-CN': '重置波场', 'en-US': 'Reset Field' },
        type: 'button',
        variant: 'default',
        action: 'reset',
      },
    ];
  }

  /**
   * One-shot compute: advance the wave `steps` steps on the GPU when
   * available, else on the CPU. Reports measured time to the perf panel.
   */
  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => Promise<void> | void): Promise<ComputeResult> {
    if (!this.state.hasData) {
      return { ok: false, error: 'no data — load a wave scenario file first' };
    }
    const steps = 240;
    const t0 = performance.now();
    const gpu = this.api.gpu;

    if (gpu?.available) {
      this.api.setStatus('computing');
      const gpuOk = await this.gpuAdvance(gpu, steps, onProgress);
      this.api.setStatus('ready');
      if (gpuOk) {
        const gpuMs = performance.now() - t0;
        this.api.reportGpuTime(gpuMs);
        this.draw();
        return { ok: true, output: W * H, metrics: { gpuMs, bytes: waveFieldBytes(W * H) } };
      }
    }

    const k = this.state.speed * this.state.speed;
    for (let s = 0; s < steps; s += 1) {
      this.time += 1;
      waveStepCPU(this.u, this.v, this.unew, this.vnew, this.drive, W, H, k, this.state.damping, this.time);
      await onProgress?.({ done: s + 1, total: steps });
    }
    this.draw();
    const cpuMs = performance.now() - t0;
    this.api.reportGpuTime(cpuMs);
    return { ok: true, output: W * H, metrics: { gpuMs: cpuMs, bytes: waveFieldBytes(W * H) } };
  }

  /**
   * Load a scenario file: `{ u?: grid, drive?: grid }` (a bare grid is
   * accepted as `u`). `u` seeds the initial displacement, `drive` encodes
   * barriers (negative) and continuous sources (positive amplitude); both
   * are nearest-neighbour resampled onto the lattice.
   */
  async loadData(file: File) {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '无法解析波场文件（JSON）' : 'Could not parse wave file (JSON)');
      return;
    }
    const data = parseWaveData(parsed);
    if (!data) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '需要 JSON 对象：{ "u": 数值网格, "drive": 数值网格 }（至少其一）'
          : 'Expected a JSON object: { "u": grid, "drive": grid } (at least one)',
      );
      return;
    }
    this.initialU = data.u ? resampleGrid(data.u, W, H) : new Float32Array(W * H);
    this.initialDrive = data.drive ? resampleGrid(data.drive, W, H) : new Float32Array(W * H);
    this.state.hasData = true;
    this.replayLoaded();
    this.api.reportDataScale(W * H);
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  /** Apply the pristine loaded scenario: zero velocities, t = 0. */
  private replayLoaded() {
    if (!this.initialU || !this.initialDrive) return;
    this.u.set(this.initialU);
    this.drive.set(this.initialDrive);
    this.v.fill(0);
    this.time = 0;
    this.visPeak = 0;
  }

  private start() {
    if (this.state.running) return;
    if (!this.state.hasData) {
      // Data-driven: without a loaded scenario there is nothing to simulate.
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '请先加载波场数据 — 拖入 JSON 场文件或打开「示例数据」'
          : 'Load wave data first — drop a JSON field file or open sample data',
      );
      return;
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
    const gpu = this.api.gpu;
    if (gpu?.available) {
      // GPU path: advance a batch and read the displacement back; the CPU
      // fields stay authoritative so the fallback resumes seamlessly.
      void this.gpuAdvance(gpu, this.stepsPerFrame).then(
        (ok) => {
          if (ok) this.draw();
          else {
            this.stepCpu();
            this.draw();
          }
        },
        (err) => {
          logger.warn('wave', 'GPU frame failed', err);
          this.stepCpu();
          this.draw();
        },
      );
    } else {
      this.stepCpu();
      this.draw();
    }
    this.rafId = requestAnimationFrame(this.tick);
  };

  private stepCpu() {
    const k = this.state.speed * this.state.speed;
    for (let s = 0; s < this.stepsPerFrame; s += 1) {
      this.time += 1;
      waveStepCPU(this.u, this.v, this.unew, this.vnew, this.drive, W, H, k, this.state.damping, this.time);
    }
  }

  private async gpuAdvance(
    gpu: GpuComputeApi,
    steps: number,
    onProgress?: (p: ComputeProgress) => Promise<void> | void,
  ): Promise<boolean> {
    let uA: ComputeBufferHandle | null = null;
    let uB: ComputeBufferHandle | null = null;
    let vA: ComputeBufferHandle | null = null;
    let vB: ComputeBufferHandle | null = null;
    let driveBuf: ComputeBufferHandle | null = null;
    let paramsBuf: ComputeBufferHandle | null = null;
    try {
      const cells = W * H;
      uA = gpu.createBuffer(waveFieldBytes(cells), WAVE_FIELD_USAGE, 'wave.uA');
      uB = gpu.createBuffer(waveFieldBytes(cells), WAVE_FIELD_USAGE, 'wave.uB');
      vA = gpu.createBuffer(waveFieldBytes(cells), WAVE_FIELD_USAGE, 'wave.vA');
      vB = gpu.createBuffer(waveFieldBytes(cells), WAVE_FIELD_USAGE, 'wave.vB');
      driveBuf = gpu.createBuffer(waveFieldBytes(cells), WAVE_DRIVE_USAGE, 'wave.drive');
      paramsBuf = gpu.createBuffer(24, WAVE_PARAMS_USAGE, 'wave.params');
      if (!uA || !uB || !vA || !vB || !driveBuf || !paramsBuf) return false;

      const kernel = gpu.compileKernel({
        label: 'wave.step',
        wgsl: waveKernelWGSL(),
        workgroupSize: [8, 8, 1],
        bindings: [
          { binding: 0, bufferType: 'read-only-storage' },
          { binding: 1, bufferType: 'read-only-storage' },
          { binding: 2, bufferType: 'storage' },
          { binding: 3, bufferType: 'storage' },
          { binding: 4, bufferType: 'read-only-storage' },
          { binding: 5, bufferType: 'uniform' },
        ],
      });
      if (!kernel) return false;

      uA.write(this.u);
      vA.write(this.v);
      driveBuf.write(this.drive);
      const wgX = Math.ceil(W / 8);
      const wgY = Math.ceil(H / 8);

      for (let s = 0; s < steps; s += 1) {
        paramsBuf.write(new Uint8Array(packWaveParams(W, H, this.state.speed ** 2, this.state.damping, this.time + s + 1)));
        if (!gpu.run(kernel, [uA, vA, uB, vB, driveBuf, paramsBuf], wgX, wgY, 1)) return false;
        // Ping-pong.
        [uA, uB] = [uB, uA];
        [vA, vB] = [vB, vA];
        await onProgress?.({ done: s + 1, total: steps });
      }
      this.time += steps;

      const uBytes = await uA.read();
      this.u.set(new Float32Array(uBytes));
      const vBytes = await vA.read();
      this.v.set(new Float32Array(vBytes));
      return true;
    } catch (err) {
      logger.warn('wave', 'GPU compute failed, falling back to CPU', err);
      return false;
    } finally {
      uA?.destroy();
      uB?.destroy();
      vA?.destroy();
      vB?.destroy();
      driveBuf?.destroy();
      paramsBuf?.destroy();
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
      // Empty state: no scenario loaded — never render a fabricated field.
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      const msg =
        this.api.locale === 'zh-CN'
          ? '未加载数据 — 拖入 JSON 波场文件或打开「示例数据」'
          : 'No data — drop a JSON wave field or load sample data';
      g.fillText(msg, canvas.width / 2, canvas.height / 2);
      return;
    }

    // Rasterize the grid 1:1 on an offscreen canvas, then upscale with
    // bilinear filtering — smooth fringes, no visible cells.
    if (!this.offscreen) this.offscreen = document.createElement('canvas');
    this.offscreen.width = W;
    this.offscreen.height = H;
    const og = this.offscreen.getContext('2d');
    if (!og) return;
    const img = og.createImageData(W, H);

    let peak = 0;
    for (let i = 0; i < this.u.length; i += 1) peak = Math.max(peak, Math.abs(this.u[i]!));
    // Exponentially smoothed normalization: the instantaneous peak bounces
    // frame to frame, which pumped the whole color scale and made the
    // interference pattern visibly flicker.
    this.visPeak = this.visPeak === 0 ? peak : this.visPeak * 0.92 + peak * 0.08;
    const norm = this.visPeak > 1e-9 ? 1 / this.visPeak : 0;

    for (let cell = 0; cell < W * H; cell += 1) {
      let r: number;
      let gg: number;
      let b: number;
      if (this.drive[cell]! < 0) {
        r = 70;
        gg = 78;
        b = 92;
      } else {
        // Scale to 95% of peak so the brightest white appears only at true
        // antinodes, keeping the ramp's dynamic range fully usable.
        const c = waveColor(this.u[cell]! * norm * 0.95);
        r = c[0];
        gg = c[1];
        b = c[2];
      }
      const o = cell * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
    og.putImageData(img, 0, 0);

    const scale = Math.min(canvas.width / W, canvas.height / H);
    const dw = W * scale;
    const dh = H * scale;
    const ox = (canvas.width - dw) / 2;
    const oy = (canvas.height - dh) / 2;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
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
 * Parse a rectangular numeric grid: `number[][]` or `{ values: number[][] }`.
 * Returns `null` for ragged / non-numeric input.
 */
export function parseGrid(parsed: unknown): number[][] | null {
  let node: unknown = parsed;
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.values)) node = obj.values;
  }
  if (!Array.isArray(node)) return null;
  const rows = node as unknown[];
  const values: number[][] = [];
  let width = -1;
  for (const row of rows.slice(0, MAX_GRID)) {
    if (!Array.isArray(row)) return null;
    const nums = (row as unknown[]).slice(0, MAX_GRID).map((v) => Number(v));
    if (nums.some((v) => !Number.isFinite(v))) return null;
    if (width === -1) width = nums.length;
    if (nums.length !== width) return null;
    values.push(nums);
  }
  if (values.length < 2 || width < 2) return null;
  return values;
}

export interface WaveScenario {
  /** Initial displacement grid (may be null). */
  u: number[][] | null;
  /** Drive layout grid: < 0 barrier, > 0 source amplitude (may be null). */
  drive: number[][] | null;
}

/**
 * Parse a wave scenario file: `{ u?: grid, drive?: grid }` — a bare grid is
 * accepted as `u`. Returns `null` when neither field is a valid grid.
 */
export function parseWaveData(parsed: unknown): WaveScenario | null {
  if (Array.isArray(parsed)) {
    const u = parseGrid(parsed);
    return u ? { u, drive: null } : null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const u = obj.u !== undefined ? parseGrid(obj.u) : null;
  const drive = obj.drive !== undefined ? parseGrid(obj.drive) : null;
  if (obj.u !== undefined && !u && obj.drive !== undefined && !drive) return null;
  if (!u && !drive) return null;
  return { u, drive };
}

/** Nearest-neighbour resample of a grid onto a width×height Float32Array. */
export function resampleGrid(grid: number[][], width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  const gh = grid.length;
  const gw = grid[0]!.length;
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(gh - 1, Math.floor((y * gh) / height));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(gw - 1, Math.floor((x * gw) / width));
      out[y * width + x] = grid[sy]![sx]!;
    }
  }
  return out;
}

export default function createWavePlugin(): Plugin {
  return new WavePlugin();
}
