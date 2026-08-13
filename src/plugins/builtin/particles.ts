// ==========================================================================
// Example plugin: Particle Simulator
// Demonstrates the compute + progress + 3D-ish (DOM canvas) pipeline and
// the performance reporting hooks.
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

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface State {
  count: number;
  speed: number;
  running: boolean;
}

export class ParticlePlugin implements Plugin {
  readonly manifest = particleManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { count: 5000, speed: 1, running: false };
  private particles: Particle[] = [];
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
    this.resetParticles();
    this.start();
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.count === 'number' && params.count !== this.state.count) {
      this.state.count = params.count;
      this.resetParticles();
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
    const values = text.trim().split(/\s+/).map(Number).filter(Number.isFinite);
    if (values.length < 8) return;
    this.state.count = Math.min(50000, Math.max(500, Math.floor(values.length / 4)));
    this.resetParticles();
    this.start();
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

  private resetParticles() {
    this.particles = Array.from({ length: this.state.count }, () => ({
      x: Math.random() * 2 - 1,
      y: Math.random() * 2 - 1,
      vx: (Math.random() - 0.5) * 0.02,
      vy: (Math.random() - 0.5) * 0.02,
    }));
    this.api.reportDataScale(this.particles.length);
  }

  private start() {
    if (this.state.running) return;
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
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0c0e11';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#3b82f6';
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const scale = Math.min(canvas.width, canvas.height) / 2.2;
    const step = Math.max(1, Math.floor(this.particles.length / 30000));
    for (let i = 0; i < this.particles.length; i += step) {
      const p = this.particles[i];
      if (!p) continue;
      g.fillRect(cx + p.x * scale, cy + p.y * scale, 2, 2);
    }
  }
}

export default function createParticlePlugin(): Plugin {
  return new ParticlePlugin();
}
