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
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
  ComputeProgress,
  ComputeResult,
} from '@/types/plugin';

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
  private state: State = { count: 5000, speed: 1, running: false, hasData: false };
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
      this.state.count = params.count;
      this.resetParticles();
      this.draw();
    }
    if (typeof params.speed === 'number') this.state.speed = params.speed;
    if (typeof params.start === 'boolean') {
      if (params.start) this.start();
      else this.stop();
    }
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'count', label: 'Count', type: 'range', min: 500, max: 50000, step: 500, value: this.state.count },
      { key: 'speed', label: 'Speed', type: 'range', min: 0.1, max: 5, step: 0.1, value: this.state.speed },
      { key: 'start', label: 'Run', type: 'checkbox', value: this.state.running },
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
    this.state.count = Math.min(50000, Math.max(500, this.raw.length));
    this.state.hasData = true;
    this.resetParticles();
    // Show the loaded data statically; the user starts the run via Run toggle.
    this.draw();
  }

  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    const steps = 20;
    const t0 = performance.now();
    for (let i = 0; i < steps; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      onProgress?.({ done: i + 1, total: steps });
    }
    const gpuMs = performance.now() - t0;
    this.api.reportGpuTime(gpuMs);
    return { ok: true, metrics: { gpuMs } };
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
    if (this.raw.length > 0) {
      this.state.hasData = true;
      const n = Math.min(this.state.count, Math.max(1, this.raw.length));
      this.particles = [];
      for (let i = 0; i < n; i += 1) {
        const idx = Math.min(Math.floor((i * this.raw.length) / n), this.raw.length - 1);
        const r = this.raw[idx];
        if (r) this.particles.push({ ...r });
      }
    } else {
      this.state.hasData = false;
      this.particles = Array.from({ length: this.state.count }, () => ({
        x: Math.random() * 2 - 1,
        y: Math.random() * 2 - 1,
        vx: (Math.random() - 0.5) * 0.02,
        vy: (Math.random() - 0.5) * 0.02,
      }));
    }
    this.api.reportDataScale(this.particles.length);
  }

  private start() {
    if (this.state.running) return;
    // If nothing has been loaded yet, generate a default random set so the
    // user always sees something once they start the run.
    if (this.particles.length === 0) this.resetParticles();
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
      p.x += p.vx * dt * this.state.speed;
      p.y += p.vy * dt * this.state.speed;
      if (p.x > 1 || p.x < -1) p.vx *= -1;
      if (p.y > 1 || p.y < -1) p.vy *= -1;
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