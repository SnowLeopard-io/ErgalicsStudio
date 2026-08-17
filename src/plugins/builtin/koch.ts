// ==========================================================================
// Fun plugin: Koch Snowflake (科赫雪花)
//
// Iteratively builds the Koch snowflake fractal on a canvas. Pure geometry,
// no data input required.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const kochManifest: PluginManifest = {
  id: 'fun.koch',
  name: 'Koch Snowflake',
  nameI18n: { 'zh-CN': '科赫雪花', 'en-US': 'Koch Snowflake' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Fractal snowflake built from recursive segments.',
  descriptionI18n: {
    'zh-CN': '用递归折线构造的科赫雪花分形，支持迭代深度调节。',
    'en-US': 'The Koch snowflake fractal, built from recursive segments.',
  },
  license: 'MIT',
  entry: 'fun.koch',
  category: 'fun',
  icon: '❋',
};

interface State {
  iterations: number;
  color: string;
}

export class KochPlugin implements Plugin {
  readonly manifest = kochManifest;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { iterations: 3, color: '#a5f3fc' };

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
    if (typeof params.iterations === 'number') {
      this.state.iterations = Math.max(0, Math.min(6, Math.round(params.iterations)));
    }
    if (typeof params.color === 'string') this.state.color = params.color;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'iterations',
        label: 'Depth',
        labelI18n: { 'zh-CN': '迭代深度', 'en-US': 'Depth' },
        type: 'range',
        min: 0,
        max: 6,
        step: 1,
        value: this.state.iterations,
      },
      {
        key: 'color',
        label: 'Color',
        labelI18n: { 'zh-CN': '颜色', 'en-US': 'Color' },
        type: 'select',
        options: [
          { value: '#a5f3fc', label: 'Ice', labelI18n: { 'zh-CN': '冰蓝', 'en-US': 'Ice' } },
          { value: '#fde68a', label: 'Gold', labelI18n: { 'zh-CN': '金色', 'en-US': 'Gold' } },
          { value: '#f0abfc', label: 'Orchid', labelI18n: { 'zh-CN': '粉紫', 'en-US': 'Orchid' } },
          { value: '#86efac', label: 'Mint', labelI18n: { 'zh-CN': '薄荷', 'en-US': 'Mint' } },
        ],
        value: this.state.color,
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

    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.38;
    // Equilateral triangle pointing down (so one edge is flat on top).
    const p0 = { x: cx, y: cy - radius };
    const p1 = { x: cx + radius * Math.sin(Math.PI / 3), y: cy + radius * Math.cos(Math.PI / 3) };
    const p2 = { x: cx - radius * Math.sin(Math.PI / 3), y: cy + radius * Math.cos(Math.PI / 3) };

    g.strokeStyle = this.state.color;
    g.lineWidth = 1.5;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    this.koch(g, p0.x, p0.y, p1.x, p1.y, this.state.iterations);
    this.koch(g, p1.x, p1.y, p2.x, p2.y, this.state.iterations);
    this.koch(g, p2.x, p2.y, p0.x, p0.y, this.state.iterations);
    g.stroke();
  }

  private koch(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, depth: number) {
    if (depth <= 0) {
      g.lineTo(x2, y2);
      return;
    }
    const dx = x2 - x1;
    const dy = y2 - y1;
    const xa = x1 + dx / 3;
    const ya = y1 + dy / 3;
    const xb = x1 + (2 * dx) / 3;
    const yb = y1 + (2 * dy) / 3;
    const seg = Math.sqrt((xb - xa) * (xb - xa) + (yb - ya) * (yb - ya));
    const mx = (xa + xb) / 2 - ((yb - ya) / seg) * (seg * Math.sin(Math.PI / 3));
    const my = (ya + yb) / 2 + ((xb - xa) / seg) * (seg * Math.sin(Math.PI / 3));

    this.koch(g, x1, y1, xa, ya, depth - 1);
    this.koch(g, xa, ya, mx, my, depth - 1);
    this.koch(g, mx, my, xb, yb, depth - 1);
    this.koch(g, xb, yb, x2, y2, depth - 1);
  }
}

export default function createKochPlugin(): Plugin {
  return new KochPlugin();
}
