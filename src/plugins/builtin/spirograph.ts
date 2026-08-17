// ==========================================================================
// Fun plugin: Spirograph (万花尺 / 螺旋仪)
//
// Hypotrochoid / epitrochoid curve generator. Pure Canvas 2D, no data.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const spirographManifest: PluginManifest = {
  id: 'fun.spirograph',
  name: 'Spirograph',
  nameI18n: { 'zh-CN': '万花尺', 'en-US': 'Spirograph' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Hypotrochoid / epitrochoid spiral art generator.',
  descriptionI18n: {
    'zh-CN': '生成内旋轮线（万花尺）曲线艺术。',
    'en-US': 'Generate hypotrochoid / epitrochoid spiral art.',
  },
  license: 'MIT',
  entry: 'fun.spirograph',
  category: 'fun',
  icon: '✺',
};

type Shape = 'hypo' | 'epi';

interface State {
  shape: Shape;
  R: number;
  r: number;
  d: number;
  lineWidth: number;
  color: string;
  animate: boolean;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export class SpirographPlugin implements Plugin {
  readonly manifest = spirographManifest;
  private ctx: ContainerCapabilities | null = null;
  private raf = 0;
  private angle = 0;
  private state: State = {
    shape: 'hypo',
    R: 220,
    r: 65,
    d: 90,
    lineWidth: 1.4,
    color: '#f472b6',
    animate: false,
  };

  async init(_api: PluginApi) {
  }

  async destroy() {
    this.stopLoop();
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (this.state.animate) this.startLoop();
  }

  async deactivate() {
    this.stopLoop();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw(0);
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    if (params.shape === 'hypo' || params.shape === 'epi') {
      if (params.shape !== this.state.shape) {
        this.state.shape = params.shape;
        changed = true;
      }
    }
    if (typeof params.R === 'number') { this.state.R = params.R; changed = true; }
    if (typeof params.r === 'number') { this.state.r = params.r; changed = true; }
    if (typeof params.d === 'number') { this.state.d = params.d; changed = true; }
    if (typeof params.lineWidth === 'number') { this.state.lineWidth = params.lineWidth; changed = true; }
    if (typeof params.color === 'string') { this.state.color = params.color; changed = true; }
    if (typeof params.animate === 'boolean' && params.animate !== this.state.animate) {
      this.state.animate = params.animate;
      if (params.animate) this.startLoop();
      else this.stopLoop();
    }
    if (changed && !this.state.animate) this.draw(0);
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'shape',
        label: 'Curve',
        labelI18n: { 'zh-CN': '曲线', 'en-US': 'Curve' },
        type: 'select',
        options: [
          { value: 'hypo', label: 'Hypotrochoid', labelI18n: { 'zh-CN': '内旋轮线', 'en-US': 'Hypotrochoid' } },
          { value: 'epi', label: 'Epitrochoid', labelI18n: { 'zh-CN': '外旋轮线', 'en-US': 'Epitrochoid' } },
        ],
        value: this.state.shape,
      },
      { key: 'R', label: 'Fixed radius R', labelI18n: { 'zh-CN': '固定半径 R', 'en-US': 'Fixed radius R' }, type: 'range', min: 40, max: 320, step: 1, value: this.state.R },
      { key: 'r', label: 'Rolling radius r', labelI18n: { 'zh-CN': '滚动半径 r', 'en-US': 'Rolling radius r' }, type: 'range', min: 10, max: 220, step: 1, value: this.state.r },
      { key: 'd', label: 'Pen offset d', labelI18n: { 'zh-CN': '笔距 d', 'en-US': 'Pen offset d' }, type: 'range', min: 10, max: 220, step: 1, value: this.state.d },
      { key: 'lineWidth', label: 'Line width', labelI18n: { 'zh-CN': '线宽', 'en-US': 'Line width' }, type: 'range', min: 0.4, max: 4, step: 0.1, value: this.state.lineWidth },
      { key: 'color', label: 'Color', labelI18n: { 'zh-CN': '颜色', 'en-US': 'Color' }, type: 'select', options: [
        { value: '#f472b6', label: 'Pink' },
        { value: '#22d3ee', label: 'Cyan' },
        { value: '#a78bfa', label: 'Violet' },
        { value: '#34d399', label: 'Emerald' },
        { value: '#fbbf24', label: 'Amber' },
      ], value: this.state.color },
      { key: 'animate', label: 'Spin', labelI18n: { 'zh-CN': '旋转', 'en-US': 'Spin' }, type: 'toggle', offLabel: 'Spin', onLabel: 'Spinning', offLabelI18n: { 'zh-CN': '旋转', 'en-US': 'Spin' }, onLabelI18n: { 'zh-CN': '旋转中', 'en-US': 'Spinning' }, value: this.state.animate },
    ];
  }

  private computePoints(): Array<[number, number]> {
    const { shape, R, r, d } = this.state;
    const g = gcd(Math.round(R), Math.round(r)) || 1;
    const rotations = shape === 'hypo' ? Math.round(r) / g : Math.round(R) / g;
    const tMax = 2 * Math.PI * rotations;
    const steps = Math.max(2000, Math.min(40000, Math.round(rotations * 1200)));
    const pts: Array<[number, number]> = [];
    const diff = shape === 'hypo' ? R - r : R + r;
    const k = diff / r;
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * tMax;
      const x = diff * Math.cos(t) + d * Math.cos(k * t);
      const y = diff * Math.sin(t) - d * Math.sin(k * t);
      pts.push([x, y]);
    }
    return pts;
  }

  private draw(rot: number) {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const w = canvas.width = canvas.clientWidth || 480;
    const h = canvas.height = canvas.clientHeight || 360;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#0a0e13';
    g.fillRect(0, 0, w, h);

    const pts = this.computePoints();
    let maxR = 1;
    for (const [x, y] of pts) maxR = Math.max(maxR, Math.hypot(x, y));
    const scale = (Math.min(w, h) * 0.46) / maxR;
    const cx = w / 2;
    const cy = h / 2;

    g.save();
    g.translate(cx, cy);
    g.rotate(rot);
    g.scale(scale, scale);
    g.strokeStyle = this.state.color;
    g.lineWidth = this.state.lineWidth / scale;
    g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i < pts.length; i += 1) {
      const [x, y] = pts[i]!;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.restore();
  }

  private startLoop() {
    this.stopLoop();
    const tick = () => {
      this.angle += 0.004;
      this.draw(this.angle);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

export default function createSpirographPlugin(): Plugin {
  return new SpirographPlugin();
}
