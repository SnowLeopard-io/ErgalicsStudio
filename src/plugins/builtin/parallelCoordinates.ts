// ==========================================================================
// Example plugin: Parallel Coordinates (平行坐标图)
//
// Renders multi-variate data as parallel vertical axes, one polyline per row.
// Accepts multi-column CSV with an optional categorical color column.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const parallelCoordinatesManifest: PluginManifest = {
  id: 'example.parallel',
  name: 'Parallel Coordinates',
  nameI18n: { 'zh-CN': '平行坐标图', 'en-US': 'Parallel Coordinates' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Multi-variate parallel axes plot.',
  descriptionI18n: {
    'zh-CN': '将多变量数据绘制为平行坐标轴，每行一条折线，可用类别列着色。',
    'en-US': 'Render multi-variate data as parallel axes; one polyline per row, optional color column.',
  },
  license: 'MIT',
  entry: 'example.parallel',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};

interface State {
  opacity: number;
  showLabels: boolean;
  hasData: boolean;
}

const MAX_ROWS = 20_000;

export class ParallelCoordinatesPlugin implements Plugin {
  readonly manifest = parallelCoordinatesManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private columns: string[] = [];
  private rows: number[][] = [];
  private categories: string[] = [];
  private state: State = { opacity: 0.25, showLabels: true, hasData: false };

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
    if (typeof params.opacity === 'number') this.state.opacity = params.opacity;
    if (typeof params.showLabels === 'boolean') this.state.showLabels = params.showLabels;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'opacity',
        label: 'Line Opacity',
        labelI18n: { 'zh-CN': '线透明度', 'en-US': 'Line Opacity' },
        type: 'range',
        min: 0.05,
        max: 1,
        step: 0.05,
        value: this.state.opacity,
      },
      {
        key: 'showLabels',
        label: 'Show Axis Labels',
        labelI18n: { 'zh-CN': '显示轴标签', 'en-US': 'Show Axis Labels' },
        type: 'checkbox',
        value: this.state.showLabels,
      },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const { columns, rows, categories } = parseParallel(text);
    if (columns.length < 2 || rows.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '需要至少 2 个数值列和 1 行数据'
          : 'Need at least 2 numeric columns and 1 row',
      );
      return;
    }
    this.columns = columns;
    this.rows = rows;
    this.categories = categories;
    this.state.hasData = true;
    this.api.reportDataScale(rows.length);
    this.draw();
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

    const w = canvas.width;
    const h = canvas.height;
    const margin = { left: 30, right: 30, top: 20, bottom: 20 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    const n = this.columns.length;

    // Per-column min/max
    const mins: number[] = [];
    const maxs: number[] = [];
    for (let c = 0; c < n; c += 1) {
      let mn = Infinity;
      let mx = -Infinity;
      for (const row of this.rows) {
        const v = row[c];
        if (v === undefined) continue;
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
      mins[c] = Number.isFinite(mn) ? mn : 0;
      maxs[c] = Number.isFinite(mx) ? mx : 1;
    }

    const xOf = (c: number) => (n === 1 ? margin.left + plotW / 2 : margin.left + (c / (n - 1)) * plotW);
    const yOf = (c: number, v: number) => {
      const span = maxs[c]! - mins[c]! || 1;
      return margin.top + (1 - (v - mins[c]!) / span) * plotH;
    };

    // Axes
    g.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    g.lineWidth = 1;
    const font = `10px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    for (let c = 0; c < n; c += 1) {
      const x = xOf(c);
      g.beginPath();
      g.moveTo(x, margin.top);
      g.lineTo(x, margin.top + plotH);
      g.stroke();
      if (this.state.showLabels) {
        g.fillStyle = 'rgba(200, 214, 228, 0.85)';
        g.font = font;
        g.textAlign = 'center';
        g.fillText(this.columns[c]!.slice(0, 12), x, margin.top + plotH + 14);
      }
    }

    // Unique categories → palette index
    const catSet = new Set(this.categories.filter(Boolean));
    const catIndex = new Map<string, number>();
    let ci = 0;
    for (const c of catSet) catIndex.set(c, ci++);
    const hasCat = catIndex.size > 0;

    // Polylines
    for (let r = 0; r < this.rows.length; r += 1) {
      const row = this.rows[r]!;
      const cat = this.categories[r];
      if (hasCat && cat) {
        const idx = catIndex.get(cat)!;
        const color = palette(idx);
        g.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${this.state.opacity + 0.15})`;
      } else {
        g.strokeStyle = `rgba(45, 212, 191, ${this.state.opacity})`;
      }
      g.beginPath();
      let started = false;
      for (let c = 0; c < n; c += 1) {
        const v = row[c];
        if (v === undefined || !Number.isFinite(v)) continue;
        const x = xOf(c);
        const y = yOf(c, v);
        if (!started) {
          g.moveTo(x, y);
          started = true;
        } else {
          g.lineTo(x, y);
        }
      }
      g.stroke();
    }

    // Legend (categories)
    if (hasCat) {
      let lx = margin.left;
      g.font = font;
      for (const [cat, idx] of catIndex) {
        const color = palette(idx);
        g.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
        g.fillRect(lx, 4, 8, 8);
        g.fillStyle = 'rgba(200, 214, 228, 0.85)';
        g.textAlign = 'left';
        g.fillText(cat.slice(0, 10), lx + 11, 11);
        lx += 11 + g.measureText(cat.slice(0, 10)).width + 12;
        if (lx > w - margin.right) break;
      }
    }
  }

  private drawEmpty(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载平行坐标数据 — 拖入多列 .csv 文件'
        : 'No parallel data — drop a multi-column .csv';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

/** Distinct categorical palette. */
function palette(i: number): [number, number, number] {
  const colors: [number, number, number][] = [
    [96, 165, 250],
    [244, 114, 182],
    [52, 211, 153],
    [251, 191, 36],
    [167, 139, 250],
    [251, 113, 133],
  ];
  return colors[i % colors.length]!;
}

/**
 * Parse multi-column CSV. The last column is treated as a categorical color
 * column when it is non-numeric; otherwise all columns are numeric.
 */
export function parseParallel(text: string): {
  columns: string[];
  rows: number[][];
  categories: string[];
} {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { columns: [], rows: [], categories: [] };

  const sep = lines[0]!.includes(',') ? ',' : /\s+/;
  const headerTokens = lines[0]!.split(sep).map((t) => t.trim());

  // Determine which columns are numeric (using up to a few data rows).
  const sampleRows = lines.slice(1, Math.min(8, lines.length)).map((l) => l.split(sep).map((t) => t.trim()));
  const width = Math.max(headerTokens.length, ...sampleRows.map((r) => r.length));
  const numericFlags: boolean[] = [];
  for (let c = 0; c < width; c += 1) {
    const vals = sampleRows.map((r) => Number(r[c]));
    numericFlags[c] = vals.every((v) => Number.isFinite(v));
  }

  const hasHeader = headerTokens.some((t) => !Number.isFinite(Number(t)));
  const dataStart = hasHeader ? 1 : 0;

  // Categorical color column = last non-numeric column (if any).
  let colorCol = -1;
  for (let c = width - 1; c >= 0; c -= 1) {
    if (!numericFlags[c]) {
      colorCol = c;
      break;
    }
  }

  const numericCols: number[] = [];
  for (let c = 0; c < width; c += 1) {
    if (c !== colorCol && numericFlags[c]) numericCols.push(c);
  }
  if (numericCols.length < 2) {
    // Fall back: treat every column as numeric if fewer than 2 are numeric.
    numericCols.length = 0;
    for (let c = 0; c < width; c += 1) numericCols.push(c);
    colorCol = -1;
  }

  const columns = numericCols.map((c) => headerTokens[c] ?? `col${c + 1}`);
  const rows: number[][] = [];
  const categories: string[] = [];

  for (let i = dataStart; i < lines.length; i += 1) {
    if (rows.length >= MAX_ROWS) break;
    const parts = lines[i]!.split(sep).map((t) => t.trim());
    const row = numericCols.map((c) => Number(parts[c]));
    if (row.some((v) => !Number.isFinite(v))) continue;
    rows.push(row);
    categories.push(colorCol >= 0 ? (parts[colorCol] ?? '') : '');
  }

  return { columns, rows, categories };
}

export default function createParallelCoordinatesPlugin(): Plugin {
  return new ParallelCoordinatesPlugin();
}
