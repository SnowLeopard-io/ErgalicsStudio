// ==========================================================================
// Fun plugin: Harmonograph (谐振记录仪)
//
// Damped pendulum curves: sum of decaying sinusoids per axis. Canvas 2D.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';
import { actionButton, exportCanvasPng } from './shared/enhance';

/** Host button presses arrive as `{ [action]: true }`; accept the legacy
 *  `{ action }` payload shape too. */
function buttonPressed(params: Record<string, unknown>, key: string): boolean {
  const v = params[key];
  return v === true || (typeof v === 'object' && v !== null && (v as { action?: string }).action === key);
}

const HG_COLORS = ['#a78bfa', '#22d3ee', '#34d399', '#f472b6', '#fbbf24'];
const randFreq = () => Math.round((1 + Math.random() * 5) * 100) / 100;

export const harmonographManifest: PluginManifest = {
  id: 'fun.harmonograph',
  name: 'Harmonograph',
  nameI18n: { 'zh-CN': '谐振记录仪', 'en-US': 'Harmonograph' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Damped pendulum curve art (sum of decaying sinusoids).',
  descriptionI18n: {
    'zh-CN': '由衰减正弦叠加生成的谐振曲线艺术。',
    'en-US': 'Curve art from summed decaying sinusoids.',
  },
  license: 'MIT',
  entry: 'fun.harmonograph',
  category: 'fun',
  icon: '♪',
};

interface State {
  f1: number;
  f2: number;
  f3: number;
  f4: number;
  damping: number;
  color: string;
  lineWidth: number;
  animate: boolean;
  phase: number;
}

export class HarmonographPlugin implements Plugin {
  readonly manifest = harmonographManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private raf = 0;
  private state: State = {
    f1: 2,
    f2: 3,
    f3: 2.01,
    f4: 3.0,
    damping: 0.002,
    color: '#a78bfa',
    lineWidth: 0.6,
    animate: false,
    phase: 0,
  };

  async init(api: PluginApi) {
    this.api = api;
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
    if (buttonPressed(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d, 'harmonograph');
      return;
    }
    if (buttonPressed(params, 'randomize')) {
      this.randomize();
      if (!this.state.animate) this.draw();
      return;
    }
    let changed = false;
    if (typeof params.f1 === 'number') { this.state.f1 = params.f1; changed = true; }
    if (typeof params.f2 === 'number') { this.state.f2 = params.f2; changed = true; }
    if (typeof params.f3 === 'number') { this.state.f3 = params.f3; changed = true; }
    if (typeof params.f4 === 'number') { this.state.f4 = params.f4; changed = true; }
    if (typeof params.damping === 'number') { this.state.damping = Math.max(0, Math.min(0.02, params.damping)); changed = true; }
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
      { key: 'f1', label: 'Freq f1', labelI18n: { 'zh-CN': '频率 f1', 'en-US': 'Freq f1' }, type: 'range', min: 1, max: 6, step: 0.01, value: this.state.f1 },
      { key: 'f2', label: 'Freq f2', labelI18n: { 'zh-CN': '频率 f2', 'en-US': 'Freq f2' }, type: 'range', min: 1, max: 6, step: 0.01, value: this.state.f2 },
      { key: 'f3', label: 'Freq f3', labelI18n: { 'zh-CN': '频率 f3', 'en-US': 'Freq f3' }, type: 'range', min: 1, max: 6, step: 0.01, value: this.state.f3 },
      { key: 'f4', label: 'Freq f4', labelI18n: { 'zh-CN': '频率 f4', 'en-US': 'Freq f4' }, type: 'range', min: 1, max: 6, step: 0.01, value: this.state.f4 },
      { key: 'damping', label: 'Damping', labelI18n: { 'zh-CN': '阻尼', 'en-US': 'Damping' }, type: 'range', min: 0, max: 0.02, step: 0.001, value: this.state.damping },
      { key: 'lineWidth', label: 'Line width', labelI18n: { 'zh-CN': '线宽', 'en-US': 'Line width' }, type: 'range', min: 0.3, max: 3, step: 0.1, value: this.state.lineWidth },
      { key: 'color', label: 'Color', labelI18n: { 'zh-CN': '颜色', 'en-US': 'Color' }, type: 'select', options: [
        { value: '#a78bfa', label: 'Violet' },
        { value: '#22d3ee', label: 'Cyan' },
        { value: '#34d399', label: 'Emerald' },
        { value: '#f472b6', label: 'Pink' },
        { value: '#fbbf24', label: 'Amber' },
      ], value: this.state.color },
      { key: 'animate', label: 'Morph', labelI18n: { 'zh-CN': '渐变', 'en-US': 'Morph' }, type: 'toggle', offLabel: 'Morph', onLabel: 'Morphing', offLabelI18n: { 'zh-CN': '渐变', 'en-US': 'Morph' }, onLabelI18n: { 'zh-CN': '渐变中', 'en-US': 'Morphing' }, value: this.state.animate },
      actionButton('randomize', 'Randomize', '随机参数'),
      actionButton('exportPng', 'Export PNG', '导出 PNG'),
    ];
  }

  /** Randomize every tunable curve parameter (morph state is left alone). */
  private randomize() {
    this.state.f1 = randFreq();
    this.state.f2 = randFreq();
    this.state.f3 = Math.round((this.state.f1 + (Math.random() - 0.5) * 0.06 + 0.01) * 100) / 100;
    this.state.f4 = randFreq();
    this.state.damping = Math.round(Math.random() * 0.01 * 1000) / 1000;
    this.state.lineWidth = Math.round((0.3 + Math.random() * 1.7) * 10) / 10;
    this.state.color = HG_COLORS[Math.floor(Math.random() * HG_COLORS.length)]!;
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
    const { f1, f2, f3, f4, damping, color, lineWidth, phase } = this.state;
    const T = 2 * Math.PI * 12;
    const steps = 12000;

    g.strokeStyle = color;
    g.lineWidth = lineWidth;
    g.lineJoin = 'round';
    g.globalAlpha = 0.7;
    g.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const t = (i / steps) * T;
      const env = Math.exp(-damping * t);
      const x = cx + amp * env * (Math.sin(f1 * t + phase) + Math.sin(f3 * t) * 0.5);
      const y = cy + amp * env * (Math.sin(f2 * t) + Math.sin(f4 * t) * 0.5);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.globalAlpha = 1;
  }

  private startLoop() {
    this.stopLoop();
    const tick = () => {
      this.state.phase += 0.01;
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

export default function createHarmonographPlugin(): Plugin {
  return new HarmonographPlugin();
}
