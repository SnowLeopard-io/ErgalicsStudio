// ==========================================================================
// Example plugin: Particle Simulator
// Demonstrates the compute + progress + 3D-ish (DOM canvas) pipeline and
// the performance reporting hooks.
//
// Data-driven: loadData() consumes the actual file values (position +
// velocity columns) so different datasets produce visibly different
// simulations. Loaded data persists across activations/projects.
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
  advanceParticleCPU,
  packParticleParams,
  packParticles,
  particleBufferBytes,
  particleKernelWGSL,
  PARTICLES_BUFFER_USAGE,
  PARTICLES_UNIFORM_USAGE,
  unpackParticles,
} from '@/core/wgsl';

export const particleManifest: PluginManifest = {
  id: 'example.particles',
  name: 'Particles',
  nameI18n: { 'zh-CN': '粒子模拟', 'en-US': 'Particles' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Interactive particle simulation with compute progress.',
  descriptionI18n: {
    'zh-CN': '交互式粒子模拟，演示计算进度与性能上报。',
    'en-US': 'Interactive particle simulation demo.',
  },
  license: 'MIT',
  entry: 'example.particles',
  formats: [
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Particle data' },
  ],
};

interface RawParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface State {
  count: number;
  speed: number;
  running: boolean;
  hasData: boolean;
}

export class ParticlePlugin implements Plugin {
  readonly manifest = particleManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { count: 8000, speed: 1, running: false, hasData: false };
  private raw: RawParticle[] = [];
  private particles: RawParticle[] = [];
  private rafId = 0;
  private lastFrame = 0;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.stop();
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stop();
  }

  async render(container: ContainerCapabilities) {
    this.ctx = container;
    // Do not auto-start: show the current state (empty-state hint or loaded
    // data) and let the user start the simulation via the Run toggle.
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.count === 'number' && params.count !== this.state.count) {
      // Clamp to the declared param range [500, 250000]. An out-of-range value
      // previously bypassed the slider bounds and could allocate an oversized
      // GPU buffer (count near 1e6 → ~32MB particle buffer).
      this.state.count = Math.max(500, Math.min(250000, Math.round(params.count)));
      // Only resample when real data is loaded; never fabricate a dataset.
      if (this.raw.length > 0) this.resetParticles();
      this.draw();
    }
    if (typeof params.speed === 'number') this.state.speed = params.speed;
    if (typeof params.start === 'boolean') {
      if (params.start) this.start();
      else this.stop();
    }
    if (
      params !== null &&
      typeof params === 'object' &&
      (params as { compute?: { action?: string } })?.compute?.action === 'gpu-compute'
    ) {
      void this.runCompute();
    }
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'count', label: 'Count', type: 'range', min: 500, max: 250000, step: 1000, value: this.state.count },
      { key: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 5, step: 0.1, value: this.state.speed },
      {
        key: 'start',
        label: 'Run',
        type: 'toggle',
        value: this.state.running,
        offLabelI18n: { 'zh-CN': '▶ 开始模拟', 'en-US': '▶ Start' },
        onLabelI18n: { 'zh-CN': '■ 停止模拟', 'en-US': '■ Stop' },
      },
      {
        key: 'compute',
        label: 'Compute',
        type: 'button',
        variant: 'primary',
        action: 'gpu-compute',
        labelI18n: { 'zh-CN': '⚡ GPU 加速计算', 'en-US': '⚡ GPU compute' },
      },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const rows = this.parseData(text);
    if (rows.length < 2) return;
    this.raw = rows;
    this.state.count = Math.min(250000, Math.max(500, this.raw.length));
    this.state.hasData = true;
    this.resetParticles();
    // Show the loaded data statically; the user starts the run via Run toggle.
    this.draw();
  }

  /**
   * Run `steps` integration steps, accelerated by a real WGSL kernel when a
   * GPU is available. Falls back to the CPU-equivalent integrator otherwise,
   * so the plugin behaves identically in both modes. Reports the measured
   * GPU time to the perf panel.
   */
  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    if (this.particles.length === 0) {
      return { ok: false, error: 'no data — load a .dat file first' };
    }
    const steps = 240;
    const t0 = performance.now();
    const gpu = this.api.gpu;

    if (gpu?.available) {
      this.api.setStatus('computing');
      const gpuOk = await this.gpuIntegrate(gpu, steps, onProgress);
      this.api.setStatus('ready');
      if (gpuOk) {
        const gpuMs = performance.now() - t0;
        this.api.reportGpuTime(gpuMs);
        return {
          ok: true,
          output: this.particles.length,
          metrics: { gpuMs, bytes: particleBufferBytes(this.particles.length) },
        };
      }
    }

    // CPU fallback — mirrors the WGSL integrator exactly.
    const dt = 1 / 60;
    for (let s = 0; s < steps; s += 1) {
      for (const p of this.particles) advanceParticleCPU(p, dt, this.state.speed);
      onProgress?.({ done: s + 1, total: steps });
    }
    this.draw();
    const cpuMs = performance.now() - t0;
    this.api.reportGpuTime(cpuMs);
    return {
      ok: true,
      output: this.particles.length,
      metrics: { gpuMs: cpuMs, bytes: particleBufferBytes(this.particles.length) },
    };
  }

  /** Trigger the accelerated compute path from the params panel button. */
  private async runCompute() {
    if (this.particles.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '请先加载数据 — 拖入 .dat 文件或打开「示例数据」'
          : 'Load data first — drop a .dat file or open sample data',
      );
      return;
    }
    const result = await this.compute(null, (p) => {
      this.api.notify('info', `${p.done}/${p.total}`);
    });
    if (result.ok) {
      const engine = this.api.gpu?.available ? this.api.gpu?.backend : 'cpu';
      this.api.notify(
        'success',
        this.api.locale === 'zh-CN'
          ? `计算完成（${engine}）— ${result.metrics?.gpuMs?.toFixed(1) ?? '?'} ms`
          : `Compute done (${engine}) — ${result.metrics?.gpuMs?.toFixed(1) ?? '?'} ms`,
      );
    } else {
      this.api.notify('error', result.error ?? 'compute failed');
    }
  }

  /**
   * Real WGSL compute path: upload particles + params, dispatch the
   * integration kernel `steps` times, read the result back and apply it.
   * Returns false on any failure so `compute()` can fall back to CPU.
   */
  private async gpuIntegrate(
    gpu: GpuComputeApi,
    steps: number,
    onProgress?: (p: ComputeProgress) => void,
  ): Promise<boolean> {
    const count = this.particles.length;
    let data: ComputeBufferHandle | null = null;
    let paramsBuf: ComputeBufferHandle | null = null;
    try {
      data = gpu.createBuffer(
        particleBufferBytes(count),
        PARTICLES_BUFFER_USAGE,
        'particles.data',
      );
      paramsBuf = gpu.createBuffer(
        16,
        PARTICLES_UNIFORM_USAGE,
        'particles.params',
      );
      if (!data || !paramsBuf) return false;

      const kernel = gpu.compileKernel({
        label: 'particles.integrate',
        wgsl: particleKernelWGSL(),
        workgroupSize: [64, 1, 1],
        bindings: [
          { binding: 0, bufferType: 'storage' },
          { binding: 1, bufferType: 'uniform' },
        ],
      });
      if (!kernel) return false;

      data.write(packParticles(this.particles));
      paramsBuf.write(packParticleParams(1 / 60, this.state.speed, count));
      const workgroups = Math.max(1, Math.ceil(count / 64));

      for (let s = 0; s < steps; s += 1) {
        if (!gpu.run(kernel, [data, paramsBuf], workgroups, 1, 1)) return false;
        onProgress?.({ done: s + 1, total: steps });
      }

      const result = await data.read();
      unpackParticles(new Float32Array(result), this.particles);
      this.api.reportDataScale(this.particles.length);
      this.draw();
      return true;
    } catch (err) {
      logger.warn('particles', 'GPU compute failed, falling back to CPU', err);
      return false;
    } finally {
      data?.destroy();
      paramsBuf?.destroy();
    }
  }

  /** Extract numeric columns from arbitrary delimited text. */
  private parseData(text: string): RawParticle[] {
    const rows: number[][] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parts = trimmed
        .split(/[\s,]+/)
        .map((s) => parseFloat(s))
        .filter(Number.isFinite);
      if (parts.length >= 2) rows.push(parts);
    }
    if (rows.length < 2) {
      const nums =
        text.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
      for (let i = 0; i + 1 < nums.length; i += 2) rows.push([nums[i]!, nums[i + 1]!]);
    }
    if (rows.length < 2) return [];

    const out = rows.map((r): RawParticle => {
      const [a, b, c, d] = r;
      if (r.length >= 4) {
        return { x: a!, y: b!, vx: c!, vy: d! };
      }
      return {
        x: a!,
        y: b!,
        vx: (Math.random() - 0.5) * 0.01,
        vy: (Math.random() - 0.5) * 0.01,
      };
    });

    // Normalize positions/velocities into a [-1, 1] viewport so any data
    // range maps onto the canvas consistently.
    let scale = 0;
    for (const p of out) {
      const a = Math.max(Math.abs(p.x), Math.abs(p.y));
      if (a > scale) scale = a;
    }
    if (scale === 0) scale = 1;
    for (const p of out) {
      p.x /= scale;
      p.y /= scale;
      p.vx /= scale;
      p.vy /= scale;
    }
    return out;
  }

  private resetParticles() {
    this.state.hasData = this.raw.length > 0;
    const n = this.raw.length > 0 ? Math.min(this.state.count, Math.max(1, this.raw.length)) : 0;
    this.particles = [];
    for (let i = 0; i < n; i += 1) {
      const idx = Math.min(Math.floor((i * this.raw.length) / n), this.raw.length - 1);
      const r = this.raw[idx];
      if (r) this.particles.push({ ...r });
    }
    this.api.reportDataScale(this.particles.length);
  }

  private start() {
    if (this.state.running) return;
    // Never fabricate a dataset: the simulation is data-driven, so it only
    // runs once data has actually been loaded.
    if (this.particles.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '请先加载数据 — 拖入 .dat 文件或打开「示例数据」'
          : 'Load data first — drop a .dat file or open sample data',
      );
      this.draw();
      return;
    }
    this.state.running = true;
    this.api.setStatus('computing');
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stop() {
    this.state.running = false;
    cancelAnimationFrame(this.rafId);
    this.api.setStatus('ready');
  }

  private tick = (now: number) => {
    if (!this.state.running) return;
    const dt = Math.min((now - this.lastFrame) / 16.667, 3);
    this.lastFrame = now;
    for (const p of this.particles) {
      advanceParticleCPU(p, dt, this.state.speed);
    }
    this.draw();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private draw() {
    if (!this.ctx?.canvas2d) return;
    const canvas = this.ctx.canvas2d;
    canvas.width = canvas.clientWidth || 400;
    canvas.height = canvas.clientHeight || 300;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = this.state.hasData ? '#2dd4bf' : '#3b82f6';
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const scale = Math.min(canvas.width, canvas.height) / 2.2;
    const step = Math.max(1, Math.floor(this.particles.length / 30000));
    for (let i = 0; i < this.particles.length; i += step) {
      const p = this.particles[i];
      if (!p) continue;
      g.fillRect(cx + p.x * scale, cy + p.y * scale, 2, 2);
    }
    if (!this.state.hasData) {
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      const msg =
        this.api.locale === 'zh-CN'
          ? '未加载数据 — 拖入 .dat 文件或打开「示例数据」'
          : 'No data — drop a .dat file or load sample data';
      g.fillText(msg, canvas.width / 2, canvas.height / 2);
    } else if (!this.state.running) {
      g.fillStyle = 'rgba(150, 165, 185, 0.7)';
      g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      const msg =
        this.api.locale === 'zh-CN'
          ? '数据已加载 — 勾选 Run 开始模拟'
          : 'Data loaded — tick Run to start';
      g.fillText(msg, canvas.width / 2, canvas.height / 2);
    }
  }
}

export default function createParticlePlugin(): Plugin {
  return new ParticlePlugin();
}