// ==========================================================================
// Example plugin: Error Band Chart (误差带图)
//
// Renders a line plus a shaded confidence band. Accepts CSV with columns
//   x,y,err          (symmetric ±err)
//   x,y,ymin,ymax    (explicit band edges)
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const errorbandManifest: PluginManifest = {
  id: 'example.errorband',
  name: 'Error Band',
  nameI18n: { 'zh-CN': '误差带图', 'en-US': 'Error Band' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Line chart with a shaded confidence / error band.',
  descriptionI18n: {
    'zh-CN': '折线 + 半透明误差带（置信区间）图，适合带不确定性的测量数据。',
    'en-US': 'Line chart with a shaded confidence/error band for noisy measurements.',
  },
  license: 'MIT',
  entry: 'example.errorband',
  category: 'scientific',
  icon: '∾',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (x,y,err | x,y,ymin,ymax)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};

interface BandRow {
  x: number;
  y: number;
  lo: number;
  hi: number;
}

interface State {
  showGrid: boolean;
  hasData: boolean;
}

const MAX_POINTS = 20_000;

export class ErrorBandPlugin implements Plugin {
  readonly manifest = errorbandManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private rows: BandRow[] = [];
  private state: State = { showGrid: true, hasData: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.rows = [];
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
    if (typeof params.showGrid === 'boolean') this.state.showGrid = params.showGrid;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'showGrid',
        label: 'Grid',
        labelI18n: { 'zh-CN': '网格线', 'en-US': 'Grid' },
        type: 'checkbox',
        value: this.state.showGrid,
      },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const rows = parseBandData(text);
    if (rows.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '未找到有效的 x,y,err 数据'
          : 'No valid x,y,err data found',
      );
      return;
    }
    this.rows = rows;
    this.state.hasData = true;
    this.api.reportDataScale(rows.length);
    this.draw();
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

    if (!this.state.hasData || this.rows.length === 0) {
      this.drawEmpty(g, w, h);
      return;
    }

    const margin = { left: 52, right: 16, top: 16, bottom: 40 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    const font = `10px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;

    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    for (const r of this.rows) {
      if (r.x < xMin) xMin = r.x;
      if (r.x > xMax) xMax = r.x;
      if (r.lo < yMin) yMin = r.lo;
      if (r.hi > yMax) yMax = r.hi;
    }
    if (xMax === xMin) xMax = xMin + 1;
    if (yMax === yMin) yMax = yMin + 1;
    const padY = (yMax - yMin) * 0.05;
    yMin -= padY;
    yMax += padY;
    const px = (v: number) => margin.left + ((v - xMin) / (xMax - xMin)) * plotW;
    const py = (v: number) => margin.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

    if (this.state.showGrid) {
      g.strokeStyle = 'rgba(148, 163, 184, 0.15)';
      g.lineWidth = 1;
      g.fillStyle = 'rgba(148, 163, 184, 0.7)';
      g.font = font;
      g.textAlign = 'right';
      for (let k = 0; k <= 4; k += 1) {
        const t = k / 4;
        const v = yMin + (yMax - yMin) * t;
        const y = py(v);
        g.beginPath();
        g.moveTo(margin.left, y);
        g.lineTo(w - margin.right, y);
        g.stroke();
        g.fillText(short(v), margin.left - 6, y + 3);
      }
      g.textAlign = 'center';
      for (let k = 0; k <= 4; k += 1) {
        const t = k / 4;
        const v = xMin + (xMax - xMin) * t;
        const x = px(v);
        g.fillText(short(v), x, h - margin.bottom + 16);
      }
    }

    // Band fill: out along hi edge, back along lo edge.
    const n = this.rows.length;
    const loColor = '#60a5fa';
    g.beginPath();
    for (let i = 0; i < n; i += 1) {
      const r = this.rows[i]!;
      const x = px(r.x);
      if (i === 0) g.moveTo(x, py(r.hi));
      else g.lineTo(x, py(r.hi));
    }
    for (let i = n - 1; i >= 0; i -= 1) {
      const r = this.rows[i]!;
      g.lineTo(px(r.x), py(r.lo));
    }
    g.closePath();
    g.fillStyle = loColor + '38';
    g.fill();

    // Band edge paths (subtle).
    g.strokeStyle = loColor + '55';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < n; i += 1) {
      const x = px(this.rows[i]!.x);
      const y = py(this.rows[i]!.hi);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.beginPath();
    for (let i = 0; i < n; i += 1) {
      const x = px(this.rows[i]!.x);
      const y = py(this.rows[i]!.lo);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    // Center line.
    g.strokeStyle = '#93c5fd';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < n; i += 1) {
      const x = px(this.rows[i]!.x);
      const y = py(this.rows[i]!.y);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }

  private drawEmpty(g: CanvasRenderingContext2D, w: number, h: number) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载误差带数据 — 拖入 .csv (x,y,err) 文件'
        : 'No band data — drop a .csv (x,y,err) file';
    g.fillText(msg, w / 2, h / 2);
  }
}

/** Parse `x,y,err` or `x,y,ymin,ymax` CSV into band rows. */
export function parseBandData(text: string): BandRow[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0]!.includes(',') ? ',' : /\s+/;
  const firstNumeric = Number.isFinite(Number(lines[0]!.split(sep)[0]));
  const start = firstNumeric ? 0 : 1;
  const rows: BandRow[] = [];
  for (let i = start; i < lines.length && rows.length < MAX_POINTS; i += 1) {
    const parts = lines[i]!.split(sep).map((p) => p.trim());
    const nums = parts.map(Number);
    if (nums.length < 3 || nums.slice(0, 3).some((n) => !Number.isFinite(n))) continue;
    const x = nums[0]!;
    const y = nums[1]!;
    if (nums.length >= 4 && Number.isFinite(nums[2]!) && Number.isFinite(nums[3]!)) {
      rows.push({ x, y, lo: nums[2]!, hi: nums[3]! });
    } else {
      const err = Math.abs(nums[2]!);
      rows.push({ x, y, lo: y - err, hi: y + err });
    }
  }
  rows.sort((a, b) => a.x - b.x);
  return rows;
}

function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

export default function createErrorBandPlugin(): Plugin {
  return new ErrorBandPlugin();
}
