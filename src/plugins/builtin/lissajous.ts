// ==========================================================================
// Fun plugin: Lissajous curves (利萨茹曲线)
//
// Animated parametric curves x = A·sin(a·t + δ), y = B·sin(b·t). Canvas 2D.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const lissajousManifest: PluginManifest = {
  id: 'fun.lissajous',
  name: 'Lissajous',
  nameI18n: { 'zh-CN': '利萨茹曲线', 'en-US': 'Lissajous' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Animated Lissajous-style parametric curves.',
  descriptionI18n: {
    'zh-CN': '动画利萨茹参数曲线，可调频率与相位。',
    'en-US': 'Animated Lissajous parametric curves with tunable frequency and phase.',
  },
  license: 'MIT',
  entry: 'fun.lissajous',
  category: 'fun',
  icon: '∿',
};

interface State {
  a: number;
  b: number;
  delta: number;
  lineWidth: number;
  color: string;
  animate: boolean;
}

export class LissajousPlugin implements Plugin {
  readonly manifest = lissajousManifest;
  private ctx: ContainerCapabilities | null = null;
  private raf = 0;
  private state: State = {
    a: 3,
    b: 2,
    delta: Math.PI / 2,
    lineWidth: 1.6,
    color: '#34d399',
    animate: true,
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
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    if (typeof params.a === 'number') { this.state.a = params.a; changed = true; }
    if (typeof params.b === 'number') { this.state.b = params.b; changed = true; }
    if (typeof params.delta === 'number') { this.state.delta = params.delta; changed = true; }
    if (typeof params.lineWidth === 'number') { this.state.lineWidth = params.lineWidth; changed = true; }
    if (typeof params.color === 'string') { this.state.color = params.color; changed = true; }
    if (typeof params.animate === 'boolean' && params.animate !== this.state.animate) {
      this.state.animate = params.animate;
      if (params.animate) this.startLoop();
      else this.stopLoop();
    }
    if (changed && !this.state.animate) this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'a', label: 'Freq a', labelI18n: { 'zh-CN': '频率 a', 'en-US': 'Freq a' }, type: 'range', min: 1, max: 12, step: 1, value: this.state.a },
      { key: 'b', label: 'Freq b', labelI18n: { 'zh-CN': '频率 b', 'en-US': 'Freq b' }, type: 'range', min: 1, max: 12, step: 1, value: this.state.b },
      { key: 'delta', label: 'Phase δ', labelI18n: { 'zh-CN': '相位 δ', 'en-US': 'Phase δ' }, type: 'range', min: 0, max: 6.28, step: 0.01, value: this.state.delta },
      { key: 'lineWidth', label: 'Line width', labelI18n: { 'zh-CN': '线宽', 'en-US': 'Line width' }, type: 'range', min: 0.4, max: 4, step: 0.1, value: this.state.lineWidth },
      { key: 'color', label: 'Color', labelI18n: { 'zh-CN': '颜色', 'en-US': 'Color' }, type: 'select', options: [
        { value: '#34d399', label: 'Emerald' },
        { value: '#22d3ee', label: 'Cyan' },
        { value: '#a78bfa', label: 'Violet' },
        { value: '#f472b6', label: 'Pink' },
        { value: '#fbbf24', label: 'Amber' },
      ], value: this.state.color },
      { key: 'animate', label: 'Animate', labelI18n: { 'zh-CN': '动画', 'en-US': 'Animate' }, type: 'toggle', offLabel: 'Animate', onLabel: 'Animating', offLabelI18n: { 'zh-CN': '动画', 'en-US': 'Animate' }, onLabelI18n: { 'zh-CN': '动画中', 'en-US': 'Animating' }, value: this.state.animate },
    ];
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const w = canvas.width = canvas.clientWidth || 480;
    const h = canvas.height = canvas.clientHeight || 360;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#0a0e13';
    g.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const amp = Math.min(w, h) * 0.42;
    const steps = 2000;
    const { a, b, delta, color, lineWidth } = this.state;

    g.strokeStyle = color;
    g.lineWidth = lineWidth;
    g.lineJoin = 'round';
    g.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * 2 * Math.PI;
      const x = cx + amp * Math.sin(a * t + delta);
      const y = cy + amp * Math.sin(b * t);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  private startLoop() {
    this.stopLoop();
    const tick = () => {
      this.state.delta += 0.01;
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

export default function createLissajousPlugin(): Plugin {
  return new LissajousPlugin();
}
