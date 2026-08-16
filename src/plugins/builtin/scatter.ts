// ==========================================================================
// Example plugin: Scatter Plot (散点图)
//
// Renders numeric columns (x y [value]) as a 2-D scatter with an optional
// third-column color ramp. Accepts .dat/.csv/.xyz delimited data.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const scatterManifest: PluginManifest = {
  id: 'example.scatter',
  name: 'Scatter Plot',
  nameI18n: { 'zh-CN': '散点图', 'en-US': 'Scatter Plot' },
  version: '1.0.0',
  author: 'Ergalics',
  description: '2-D scatter with color-by-value.',
  descriptionI18n: {
    'zh-CN': '渲染数值列（x y [值]）为二维散点，第三列可作为颜色通道。',
    'en-US': 'Render numeric columns (x y [value]) as a 2-D scatter; 3rd column optional color ramp.',
  },
  license: 'MIT',
  entry: 'example.scatter',
  formats: [
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Scatter data' },
    { extension: '.csv', mimeTypes: ['text/csv'], description: 'Scatter data' },
    { extension: '.xyz', mimeTypes: ['text/plain', 'chemical/x-xyz'], description: 'Scatter data' },
  ],
};

const MAX_POINTS = 60_000;

interface Row {
  x: number;
  y: number;
  c?: number;
}

interface State {
  size: number;
  colorBy: 'auto' | 'solid';
  hasData: boolean;
}

export class ScatterPlugin implements Plugin {
  readonly manifest = scatterManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private rows: Row[] = [];
  private cMin = 0;
  private cMax = 1;
  private state: State = { size: 2, colorBy: 'auto', hasData: false };

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
    if (typeof params.size === 'number' && params.size !== this.state.size) {
      this.state.size = Math.max(1, Math.min(8, Math.round(params.size)));
      this.draw();
    }
    if (params.colorBy === 'auto' || params.colorBy === 'solid') {
      if (params.colorBy !== this.state.colorBy) {
        this.state.colorBy = params.colorBy;
        this.draw();
      }
    }
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'size', label: 'Point Size', labelI18n: { 'zh-CN': '点大小', 'en-US': 'Point Size' }, type: 'range', min: 1, max: 8, step: 1, value: this.state.size },
      {
        key: 'colorBy',
        label: 'Color',
        labelI18n: { 'zh-CN': '颜色', 'en-US': 'Color' },
        type: 'select',
        options: [
          { value: 'auto', label: 'By value (3rd col)', labelI18n: { 'zh-CN': '按第三列值', 'en-US': 'By value (3rd col)' } },
          { value: 'solid', label: 'Solid', labelI18n: { 'zh-CN': '单色', 'en-US': 'Solid' } },
        ],
        value: this.state.colorBy,
      },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const rows = this.parse(text);
    if (rows.length < 2) {
      // A file with no usable points used to fail silently — the canvas just
      // stayed empty with no feedback, looking like a hung plugin.
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '文件中没有可用的数值点（至少需要 2 个）'
          : 'No numeric points found in file (need at least 2)',
      );
      return;
    }
    this.rows = rows;
    this.state.hasData = true;
    let cMin = Infinity;
    let cMax = -Infinity;
    for (const r of rows) {
      if (r.c !== undefined) {
        if (r.c < cMin) cMin = r.c;
        if (r.c > cMax) cMax = r.c;
      }
    }
    if (Number.isFinite(cMin)) {
      this.cMin = cMin;
      this.cMax = cMax;
    }
    this.api.reportDataScale(rows.length);
    this.draw();
  }

  /** Parse delimited numeric columns: x y [c]. */
  private parse(text: string): Row[] {
    return parseScatter(text);
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 400;
    canvas.height = canvas.clientHeight || 300;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    if (!this.state.hasData || this.rows.length === 0) {
      this.drawEmpty(g, canvas);
      return;
    }

    // Bounds + margins for axes.
    const w = canvas.width;
    const h = canvas.height;
    const margin = { left: 46, right: 14, top: 14, bottom: 34 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const r of this.rows) {
      if (r.x < minX) minX = r.x;
      if (r.x > maxX) maxX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.y > maxY) maxY = r.y;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const px = (v: number) => margin.left + ((v - minX) / rangeX) * plotW;
    const py = (v: number) => margin.top + (1 - (v - minY) / rangeY) * plotH;

    // Axes.
    g.strokeStyle = 'rgba(148, 163, 184, 0.5)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(margin.left, margin.top);
    g.lineTo(margin.left, h - margin.bottom);
    g.lineTo(w - margin.right, h - margin.bottom);
    g.stroke();
    g.fillStyle = 'rgba(148, 163, 184, 0.8)';
    g.font = `10px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    for (let k = 0; k <= 4; k += 1) {
      const t = k / 4;
      const xv = minX + rangeX * t;
      const yv = minY + rangeY * t;
      g.fillText(short(xv), px(xv), h - margin.bottom + 14);
      g.fillText(short(yv), margin.left - 8, py(yv) + 3);
    }

    // Points.
    const size = this.state.size;
    const span = Math.max(this.cMax - this.cMin, 1e-9);
    const step = Math.max(1, Math.floor(this.rows.length / 25_000));
    for (let i = 0; i < this.rows.length; i += step) {
      const r = this.rows[i];
      if (!r) continue;
      const cx = px(r.x);
      const cy = py(r.y);
      if (cx < margin.left || cx > w - margin.right || cy < margin.top || cy > h - margin.bottom) continue;
      if (this.state.colorBy === 'solid' || r.c === undefined) {
        g.fillStyle = '#2dd4bf';
      } else {
        const t = Math.max(0, Math.min(1, (r.c - this.cMin) / span));
        const c = ramp(t);
        g.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      }
      g.fillRect(cx - size / 2, cy - size / 2, size, size);
    }
  }

  private drawEmpty(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载散点数据 — 拖入 .dat/.csv 文件或从「示例数据」加载'
        : 'No scatter data — drop a .dat/.csv file or load sample data';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

/**
 * Parse delimited numeric columns: `x y [c]`. Header lines and non-numeric
 * tokens are skipped. Exported for unit tests.
 */
export function parseScatter(text: string): Row[] {
  const rows: Row[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (rows.length >= MAX_POINTS) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[\s,]+/);
    const nums = parts.map((s) => parseFloat(s));
    if (nums.length < 2 || nums.slice(0, 3).some((n) => !Number.isFinite(n))) continue;
    rows.push({
      x: nums[0]!,
      y: nums[1]!,
      c: nums[2] !== undefined && Number.isFinite(nums[2]) ? nums[2] : undefined,
    });
  }
  return rows;
}

/** teal → amber ramp for the value channel. */
function ramp(t: number): [number, number, number] {
  const a: [number, number, number] = [45, 212, 191];
  const b: [number, number, number] = [251, 191, 36];
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

export default function createScatterPlugin(): Plugin {
  return new ScatterPlugin();
}
