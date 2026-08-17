// ==========================================================================
// Fun plugin: Truchet Tiles (特鲁谢瓷砖)
//
// Randomly oriented quarter-circle arcs over a tile grid create flowing
// patterns. Pure Canvas 2D; no data input required.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const truchetManifest: PluginManifest = {
  id: 'fun.truchet',
  name: 'Truchet Tiles',
  nameI18n: { 'zh-CN': '特鲁谢瓷砖', 'en-US': 'Truchet Tiles' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Random quarter-circle arcs tiled into flowing patterns.',
  descriptionI18n: {
    'zh-CN': '用随机朝向的圆弧瓷砖拼出流动图案，支持密度与配色调节。',
    'en-US': 'Randomly oriented quarter-circle tiles forming flowing patterns.',
  },
  license: 'MIT',
  entry: 'fun.truchet',
  category: 'fun',
  icon: '⌗',
};

interface State {
  density: number;
  color: string;
  seed: number;
  lineWidth: number;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TruchetPlugin implements Plugin {
  readonly manifest = truchetManifest;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { density: 1, color: '#5eead4', seed: 42, lineWidth: 2 };

  async init(_api: PluginApi) {}

  async destroy() {
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.draw();
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.density === 'number') {
      this.state.density = Math.max(0.25, Math.min(2, params.density));
    }
    if (typeof params.color === 'string') this.state.color = params.color;
    if (typeof params.lineWidth === 'number') {
      this.state.lineWidth = Math.max(1, Math.min(6, params.lineWidth));
    }
    if (typeof params.seed === 'number') this.state.seed = Math.round(params.seed);
    const reseed = params.regenerate as { action?: string } | undefined;
    if (reseed?.action === 'regenerate') this.state.seed = (this.state.seed + 1) % 1_000_000;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'density',
        label: 'Density',
        labelI18n: { 'zh-CN': '密度', 'en-US': 'Density' },
        type: 'range',
        min: 0.25,
        max: 2,
        step: 0.05,
        value: this.state.density,
      },
      {
        key: 'lineWidth',
        label: 'Stroke',
        labelI18n: { 'zh-CN': '线宽', 'en-US': 'Stroke' },
        type: 'range',
        min: 1,
        max: 6,
        step: 0.5,
        value: this.state.lineWidth,
      },
      {
        key: 'color',
        label: 'Color',
        labelI18n: { 'zh-CN': '颜色', 'en-US': 'Color' },
        type: 'select',
        options: [
          { value: '#5eead4', label: 'Teal', labelI18n: { 'zh-CN': '青绿', 'en-US': 'Teal' } },
          { value: '#c4b5fd', label: 'Lavender', labelI18n: { 'zh-CN': '薰衣草', 'en-US': 'Lavender' } },
          { value: '#fda4af', label: 'Rose', labelI18n: { 'zh-CN': '玫红', 'en-US': 'Rose' } },
          { value: '#fcd34d', label: 'Gold', labelI18n: { 'zh-CN': '金色', 'en-US': 'Gold' } },
        ],
        value: this.state.color,
      },
      {
        key: 'regenerate',
        label: 'Regenerate',
        labelI18n: { 'zh-CN': '重新生成', 'en-US': 'Regenerate' },
        type: 'button',
        variant: 'primary',
        action: 'regenerate',
      },
    ];
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const w = canvas.width = canvas.clientWidth || 480;
    const h = canvas.height = canvas.clientHeight || 360;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, w, h);

    const base = 56;
    const tile = Math.max(16, Math.round(base * (1 / this.state.density)));
    const cols = Math.ceil(w / tile);
    const rows = Math.ceil(h / tile);
    const rand = mulberry32(this.state.seed * 40503 + 7);

    g.strokeStyle = this.state.color;
    g.lineWidth = this.state.lineWidth;
    g.lineCap = 'round';

    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const x0 = i * tile;
        const y0 = j * tile;
        // 4 rotations of the classic quarter-circle tile.
        const kind = Math.floor(rand() * 4);
        g.beginPath();
        if (kind === 0) {
          g.arc(x0, y0, tile, 0, Math.PI / 2);
        } else if (kind === 1) {
          g.arc(x0 + tile, y0, tile, Math.PI / 2, Math.PI);
        } else if (kind === 2) {
          g.arc(x0 + tile, y0 + tile, tile, Math.PI, Math.PI * 1.5);
        } else {
          g.arc(x0, y0 + tile, tile, Math.PI * 1.5, Math.PI * 2);
        }
        g.stroke();
      }
    }
  }
}

export default function createTruchetPlugin(): Plugin {
  return new TruchetPlugin();
}
