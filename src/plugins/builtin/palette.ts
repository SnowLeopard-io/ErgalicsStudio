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
import { actionButton, exportRowsCsv, notify } from './shared/enhance';

/** Host button presses arrive as `{ [action]: true }`; accept the legacy
 *  `{ action }` payload shape too. */
function buttonPressed(params: Record<string, unknown>, key: string): boolean {
  const v = params[key];
  return v === true || (typeof v === 'object' && v !== null && (v as { action?: string }).action === key);
}

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

interface Swatch {
  name: string;
  hex: string;
  r: number;
  g: number;
  b: number;
}

export class PalettePlugin implements Plugin {
  readonly manifest = paletteManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private colors: Swatch[] = [];
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
    if (buttonPressed(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (buttonPressed(params, 'exportCss')) {
      this.exportCss();
      return;
    }
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
      actionButton('exportCsv', 'Export Palette CSV', '导出色板 CSV'),
      actionButton('exportCss', 'Export CSS', '导出 CSS'),
    ];
  }

  /** Build the current gradient swatches (name/hex/rgb) and cache them. */
  private generateColors(): Swatch[] {
    const [ar, ag, ab] = hexToRgb(this.state.colorA);
    const [br, bg, bb] = hexToRgb(this.state.colorB);
    const n = this.state.stops;
    const colors: Swatch[] = [];
    for (let i = 0; i < n; i += 1) {
      const t = n === 1 ? 0 : i / (n - 1);
      const r = ar + (br - ar) * t;
      const g = ag + (bg - ag) * t;
      const b = ab + (bb - ab) * t;
      colors.push({
        name: `color-${i + 1}`,
        hex: rgbToHex(r, g, b),
        r: Math.max(0, Math.min(255, Math.round(r))),
        g: Math.max(0, Math.min(255, Math.round(g))),
        b: Math.max(0, Math.min(255, Math.round(b))),
      });
    }
    this.colors = colors;
    return colors;
  }

  private exportCsv() {
    const colors = this.colors.length > 0 ? this.colors : this.generateColors();
    const ok = exportRowsCsv(
      this.api,
      'palette',
      ['name', 'hex', 'r', 'g', 'b'],
      colors.map((c) => [c.name, c.hex, c.r, c.g, c.b]),
    );
    if (ok) notify(this.api, 'success', 'Palette CSV exported.', '色板 CSV 已导出。');
  }

  private exportCss() {
    const colors = this.colors.length > 0 ? this.colors : this.generateColors();
    if (colors.length === 0) {
      notify(this.api, 'warning', 'No colors to export yet.', '暂无可导出的颜色。');
      return;
    }
    const vars = colors.map((c) => ` --${c.name}:${c.hex};`).join('');
    const text = `:root{${vars} }`;
    this.api.exportFile('palette.css', text, 'text/css');
    notify(this.api, 'success', 'Palette CSS exported.', '色板 CSS 已导出。');
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

    // Swatches (also cached as the exportable color list).
    const colors = this.generateColors();
    const swatchH = Math.max(40, h - barY - barH - 70);
    const gap = 10;
    const sw = (barW - gap * (n - 1)) / n;
    g.font = `11px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    for (let i = 0; i < n; i += 1) {
      const c = colors[i]!;
      const x = pad + i * (sw + gap);
      const y = barY + barH + 24;
      g.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
      g.fillRect(x, y, sw, swatchH);
      g.fillStyle = 'rgba(200,210,225,0.9)';
      g.fillText(c.hex.toUpperCase(), x + sw / 2, y + swatchH + 18);
    }
  }
}

export default function createPalettePlugin(): Plugin {
  return new PalettePlugin();
}
