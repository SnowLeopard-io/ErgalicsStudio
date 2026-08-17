// ==========================================================================
// Utility plugin: Color Palette Explorer (配色探索器)
//
// Visualizes a two-stop gradient with generated swatches. Canvas 2D.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const paletteManifest: PluginManifest = {
  id: 'fun.palette',
  name: 'Palette Explorer',
  nameI18n: { 'zh-CN': '配色探索器', 'en-US': 'Palette Explorer' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Two-stop gradient preview with generated color swatches.',
  descriptionI18n: {
    'zh-CN': '两色渐变预览，并生成可查看的色板样例。',
    'en-US': 'Two-stop gradient preview with generated swatches.',
  },
  license: 'MIT',
  entry: 'fun.palette',
  category: 'utility',
  icon: '❖',
};

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [120, 120, 120];
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

interface State {
  colorA: string;
  colorB: string;
  stops: number;
}

export class PalettePlugin implements Plugin {
  readonly manifest = paletteManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = {
    colorA: '#22d3ee',
    colorB: '#f59e0b',
    stops: 6,
  };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    if (typeof params.colorA === 'string') { this.state.colorA = params.colorA; changed = true; }
    if (typeof params.colorB === 'string') { this.state.colorB = params.colorB; changed = true; }
    if (typeof params.stops === 'number') { this.state.stops = Math.max(2, Math.min(12, Math.round(params.stops))); changed = true; }
    if (changed) this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'colorA', label: 'Color A', labelI18n: { 'zh-CN': '颜色 A', 'en-US': 'Color A' }, type: 'text', value: this.state.colorA, placeholder: '#22d3ee' },
      { key: 'colorB', label: 'Color B', labelI18n: { 'zh-CN': '颜色 B', 'en-US': 'Color B' }, type: 'text', value: this.state.colorB, placeholder: '#f59e0b' },
      { key: 'stops', label: 'Swatches', labelI18n: { 'zh-CN': '色板数', 'en-US': 'Swatches' }, type: 'range', min: 2, max: 12, step: 1, value: this.state.stops },
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

    const [ar, ag, ab] = hexToRgb(this.state.colorA);
    const [br, bg, bb] = hexToRgb(this.state.colorB);
    const n = this.state.stops;

    const pad = 24;
    const barH = 64;
    const barY = 28;
    const barW = w - pad * 2;

    // Gradient bar.
    for (let x = 0; x < barW; x += 1) {
      const t = x / barW;
      g.fillStyle = `rgb(${ar + (br - ar) * t},${ag + (bg - ag) * t},${ab + (bb - ab) * t})`;
      g.fillRect(pad + x, barY, 1, barH);
    }

    // Swatches.
    const swatchH = Math.max(40, h - barY - barH - 70);
    const gap = 10;
    const sw = (barW - gap * (n - 1)) / n;
    g.font = `11px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    for (let i = 0; i < n; i += 1) {
      const t = n === 1 ? 0 : i / (n - 1);
      const r = ar + (br - ar) * t;
      const gg = ag + (bg - ag) * t;
      const b = ab + (bb - ab) * t;
      const x = pad + i * (sw + gap);
      const y = barY + barH + 24;
      g.fillStyle = `rgb(${r},${gg},${b})`;
      g.fillRect(x, y, sw, swatchH);
      g.fillStyle = 'rgba(200,210,225,0.9)';
      g.fillText(rgbToHex(r, gg, b).toUpperCase(), x + sw / 2, y + swatchH + 18);
    }
  }
}

export default function createPalettePlugin(): Plugin {
  return new PalettePlugin();
}
