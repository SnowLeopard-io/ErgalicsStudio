// ==========================================================================
// Fun plugin: Fireworks (烟花)
//
// Canvas particle fireworks with gravity. Toggle auto-launch or fire one
// burst from a button. No data input required.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const fireworksManifest: PluginManifest = {
  id: 'fun.fireworks',
  name: 'Fireworks',
  nameI18n: { 'zh-CN': '烟花', 'en-US': 'Fireworks' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Particle fireworks with gravity and trails.',
  descriptionI18n: {
    'zh-CN': '带重力与拖尾的粒子烟花，支持自动连发与手动引爆。',
    'en-US': 'Particle fireworks with gravity and trails; auto-launch or manual bursts.',
  },
  license: 'MIT',
  entry: 'fun.fireworks',
  category: 'fun',
  icon: '✹',
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface State {
  auto: boolean;
  colors: string;
  gravity: number;
}

const PALETTES: Record<string, string[]> = {
  candy: ['#f472b6', '#fb923c', '#fde047', '#a3e635', '#67e8f9'],
  neon: ['#22d3ee', '#a78bfa', '#f0abfc', '#fda4af'],
  gold: ['#fde047', '#fbbf24', '#fb923c', '#fef3c7'],
  ice: ['#93c5fd', '#67e8f9', '#c7d2fe', '#e0f2fe'],
};

const MAX_PARTICLES = 6_000;

export class FireworksPlugin implements Plugin {
  readonly manifest = fireworksManifest;
  private ctx: ContainerCapabilities | null = null;
  private particles: Particle[] = [];
  private raf: number | null = null;
  private lastTime = 0;
  private autoTimer = 0;
  private state: State = { auto: true, colors: 'candy', gravity: 0.05 };

  async init(_api: PluginApi) {}

  async destroy() {
    this.stopLoop();
    this.ctx = null;
    this.particles = [];
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.startLoop();
  }

  async deactivate() {
    this.stopLoop();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.startLoop();
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.auto === 'boolean') {
      this.state.auto = params.auto;
      if (this.state.auto) this.startLoop();
    }
    if (typeof params.colors === 'string') this.state.colors = params.colors;
    if (typeof params.gravity === 'number') {
      this.state.gravity = Math.max(0, Math.min(0.2, params.gravity));
    }
    const fire = params.fire as { action?: string } | undefined;
    if (fire?.action === 'fire') this.burst();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'auto',
        label: 'Auto fire',
        labelI18n: { 'zh-CN': '自动连发', 'en-US': 'Auto fire' },
        type: 'toggle',
        offLabel: 'Stopped',
        onLabel: 'Firing',
        offLabelI18n: { 'zh-CN': '已停止', 'en-US': 'Stopped' },
        onLabelI18n: { 'zh-CN': '连发中', 'en-US': 'Firing' },
        value: this.state.auto,
      },
      {
        key: 'colors',
        label: 'Palette',
        labelI18n: { 'zh-CN': '配色', 'en-US': 'Palette' },
        type: 'select',
        options: [
          { value: 'candy', label: 'Candy', labelI18n: { 'zh-CN': '糖果', 'en-US': 'Candy' } },
          { value: 'neon', label: 'Neon', labelI18n: { 'zh-CN': '霓虹', 'en-US': 'Neon' } },
          { value: 'gold', label: 'Gold', labelI18n: { 'zh-CN': '金色', 'en-US': 'Gold' } },
          { value: 'ice', label: 'Ice', labelI18n: { 'zh-CN': '冰蓝', 'en-US': 'Ice' } },
        ],
        value: this.state.colors,
      },
      {
        key: 'gravity',
        label: 'Gravity',
        labelI18n: { 'zh-CN': '重力', 'en-US': 'Gravity' },
        type: 'range',
        min: 0,
        max: 0.2,
        step: 0.01,
        value: this.state.gravity,
      },
      {
        key: 'fire',
        label: 'Fire one',
        labelI18n: { 'zh-CN': '放一朵', 'en-US': 'Fire one' },
        type: 'button',
        variant: 'primary',
        action: 'fire',
      },
    ];
  }

  private startLoop() {
    if (this.raf !== null) return;
    this.lastTime = performance.now();
    const loop = (t: number) => {
      const dt = Math.min(50, t - this.lastTime);
      this.lastTime = t;
      this.autoTimer += dt;
      if (this.state.auto && this.autoTimer > 700) {
        this.autoTimer = 0;
        this.burst();
      }
      this.step(dt);
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private stopLoop() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  private burst() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const w = canvas.clientWidth || 480;
    const h = canvas.clientHeight || 360;
    const x = w * (0.2 + Math.random() * 0.6);
    const y = h * (0.15 + Math.random() * 0.3);
    const palette = PALETTES[this.state.colors] ?? PALETTES.candy!;
    const count = 70 + Math.floor(Math.random() * 40);
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.6 + Math.random() * 3.4;
      const color = palette[Math.floor(Math.random() * palette.length)]!;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 60 + Math.random() * 50,
        color,
        size: 1 + Math.random() * 1.6,
      });
    }
    // Cull oldest particles beyond the cap.
    if (this.particles.length > MAX_PARTICLES) {
      this.particles.splice(0, this.particles.length - MAX_PARTICLES);
    }
  }

  private step(dt: number) {
    const k = dt / 16.7;
    for (const p of this.particles) {
      p.vy += this.state.gravity * k;
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vx *= Math.pow(0.985, k);
      p.vy *= Math.pow(0.985, k);
      p.life += k;
    }
    this.particles = this.particles.filter((p) => p.life < p.maxLife);
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const w = canvas.width = canvas.clientWidth || 480;
    const h = canvas.height = canvas.clientHeight || 360;
    const g = canvas.getContext('2d');
    if (!g) return;
    // Fade-out trails via translucent black overlay.
    g.fillStyle = 'rgba(10, 14, 19, 0.22)';
    g.fillRect(0, 0, w, h);

    for (const p of this.particles) {
      const alpha = Math.max(0, 1 - p.life / p.maxLife);
      g.globalAlpha = alpha * 0.9;
      g.fillStyle = p.color;
      g.beginPath();
      g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      g.fill();
      // Sparkle: short velocity-aligned streak.
      g.globalAlpha = alpha * 0.35;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * 1.6, p.y - p.vy * 1.6);
      g.strokeStyle = p.color;
      g.lineWidth = p.size * 0.6;
      g.stroke();
    }
    g.globalAlpha = 1;
    g.lineWidth = 1;
  }
}

export default function createFireworksPlugin(): Plugin {
  return new FireworksPlugin();
}
