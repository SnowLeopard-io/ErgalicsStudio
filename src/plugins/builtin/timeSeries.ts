// ==========================================================================
// Example plugin: Time Series Plotter
// Loads .csv columns and draws each numeric series as a polyline with
// auto-fit axes. Demonstrates select/range/toggle params and multi-series
// rendering on the 2D canvas.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
  ComputeProgress,
  ComputeResult,
} from '@/types/plugin';

export const timeSeriesManifest: PluginManifest = {
  id: 'example.timeseries',
  name: 'Time Series',
  nameI18n: { 'zh-CN': '时间序列绘图', 'en-US': 'Time Series' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Plot CSV columns as time series.',
  descriptionI18n: {
    'zh-CN': '将 CSV 各列绘制为随时间变化的折线图。',
    'en-US': 'Plot CSV columns as time series.',
  },
  license: 'MIT',
  entry: 'example.timeseries',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'Time series CSV' },
  ],
};

interface SeriesCol {
  name: string;
  values: number[];
}

interface State {
  cols: SeriesCol[];
  selected: string; // 'all' or a column name
  palette: string;
  width: number;
  grid: boolean;
  normalize: boolean;
}

const PALETTES: Record<string, string[]> = {
  multi: ['#2dd4bf', '#fbbf24', '#60a5fa', '#a78bfa', '#34d399'],
  teal: ['#2dd4bf'],
  amber: ['#fbbf24'],
  blue: ['#60a5fa'],
};

export class TimeSeriesPlugin implements Plugin {
  readonly manifest = timeSeriesManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = {
    cols: [],
    selected: 'all',
    palette: 'multi',
    width: 1.5,
    grid: true,
    normalize: false,
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

  async deactivate() {
    this.ctx = null;
  }

  async render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    if (typeof params.palette === 'string') this.state.palette = params.palette;
    if (typeof params.width === 'number') this.state.width = params.width;
    if (typeof params.grid === 'boolean') this.state.grid = params.grid;
    if (typeof params.normalize === 'boolean') this.state.normalize = params.normalize;
    if (typeof params.selected === 'string') this.state.selected = params.selected;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    const all = this.state.cols.length > 0 ? this.state.cols.map((c) => c.name) : [];
    return [
      {
        key: 'selected',
        label: 'Series',
        type: 'select',
        value: this.state.selected,
        options: [
          { value: 'all', label: 'All', labelI18n: { 'zh-CN': '全部', 'en-US': 'All' } },
          ...all.map((name) => ({ value: name, label: name })),
        ],
      },
      {
        key: 'palette',
        label: 'Color',
        type: 'select',
        value: this.state.palette,
        options: [
          { value: 'multi', label: 'Multi', labelI18n: { 'zh-CN': '多彩', 'en-US': 'Multi' } },
          { value: 'teal', label: 'Teal', labelI18n: { 'zh-CN': '青绿', 'en-US': 'Teal' } },
          { value: 'amber', label: 'Amber', labelI18n: { 'zh-CN': '琥珀', 'en-US': 'Amber' } },
          { value: 'blue', label: 'Blue', labelI18n: { 'zh-CN': '蓝', 'en-US': 'Blue' } },
        ],
      },
      { key: 'width', label: 'Width', type: 'range', min: 1, max: 4, step: 0.5, value: this.state.width },
      { key: 'grid', label: 'Grid', type: 'checkbox', value: this.state.grid },
      { key: 'normalize', label: 'Normalize', type: 'checkbox', value: this.state.normalize },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const cols = this.parseCSV(text);
    if (cols.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN' ? 'CSV 中没有可绘制的数值列' : 'No numeric columns found in CSV',
      );
      return;
    }
    this.state.cols = cols;
    this.state.selected = 'all';
    this.api.reportDataScale(cols.reduce((n, c) => n + c.values.length, 0));
    this.draw();
  }

  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    const total = 8;
    for (let i = 0; i < total; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      onProgress?.({ done: i + 1, total });
    }
    if (this.state.cols.length === 0) return { ok: false, error: 'no data' };
    const stats = this.state.cols.map((c) => {
      // Iterate instead of Math.min(...array): spreading a large array throws
      // RangeError (maximum call stack size exceeded).
      let min = Infinity;
      let max = -Infinity;
      for (const v of c.values) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      return { name: c.name, count: c.values.length, min, max };
    });
    return { ok: true, output: { series: stats } };
  }

  private parseCSV(text: string): SeriesCol[] {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const split = (l: string) => l.split(',').map((s) => s.trim());
    const first = split(lines[0]!);
    const hasHeader = first.some((s) => Number.isNaN(parseFloat(s)));
    const dataLines = hasHeader ? lines.slice(1) : lines;
    const names = hasHeader ? first : first.map((_, i) => `col${i + 1}`);
    const cols: SeriesCol[] = names.map((name) => ({ name, values: [] }));
    for (const line of dataLines) {
      const parts = split(line);
      for (let i = 0; i < cols.length && i < parts.length; i += 1) {
        const v = parseFloat(parts[i]!);
        if (Number.isFinite(v)) cols[i]!.values.push(v);
      }
    }
    return cols.filter((c) => c.values.length >= 2);
  }

  private draw() {
    if (!this.ctx?.canvas2d) return;
    const canvas = this.ctx.canvas2d;
    canvas.width = canvas.clientWidth || 400;
    canvas.height = canvas.clientHeight || 300;
    const g = canvas.getContext('2d');
    if (!g) return;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);

    if (this.state.cols.length === 0) {
      this.drawHint(g, canvas);
      return;
    }

    const series = this.visibleSeries();
    if (series.length === 0) {
      this.drawHint(g, canvas);
      return;
    }

    const padL = 8;
    const padR = 8;
    const padT = 10;
    const padB = 14;
    const plotW = canvas.width - padL - padR;
    const plotH = canvas.height - padT - padB;

    // compute global domain
    let maxX = 1;
    for (const s of series) {
      if (s.values.length > 1) maxX = Math.max(maxX, s.values.length - 1);
    }
    let minY = 0;
    let maxY = 1;
    for (const s of series) {
      for (const v of s.values) {
        if (v < minY) minY = v;
        if (v > maxY) maxY = v;
      }
    }
    const spanY = maxY - minY || 1;

    if (this.state.grid) {
      g.strokeStyle = 'rgba(127, 140, 160, 0.1)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i <= 5; i += 1) {
        const y = padT + (plotH * i) / 5;
        g.moveTo(padL, y);
        g.lineTo(canvas.width - padR, y);
      }
      g.stroke();
    }

    // axes
    g.strokeStyle = 'rgba(127, 140, 160, 0.35)';
    g.beginPath();
    g.moveTo(padL, padT);
    g.lineTo(padL, canvas.height - padB);
    g.lineTo(canvas.width - padR, canvas.height - padB);
    g.stroke();

    const toX = (i: number) => padL + (i / maxX) * plotW;
    const toY = (v: number) => {
      const n = (v - minY) / spanY;
      return canvas.height - padB - n * plotH;
    };

    const colors = (PALETTES[this.state.palette] ?? PALETTES.multi) as string[];
    for (let s = 0; s < series.length; s += 1) {
      const col = series[s]!;
      const color = colors[s % colors.length] ?? '#2dd4bf';
      g.strokeStyle = color;
      g.lineWidth = this.state.width;
      g.lineJoin = 'round';
      g.beginPath();
      col.values.forEach((v, i) => {
        const x = toX(i);
        const y = toY(v);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      });
      g.stroke();
    }

    // legend
    g.textAlign = 'left';
    g.font = `11px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    let lx = padL;
    for (let s = 0; s < series.length; s += 1) {
      const col = series[s]!;
      const color = colors[s % colors.length] ?? '#2dd4bf';
      const label = col.name;
      g.fillStyle = color;
      g.fillRect(lx, 4, 10, 2);
      g.fillStyle = 'rgba(200, 214, 228, 0.9)';
      g.fillText(label, lx + 14, 9);
      lx += 18 + g.measureText(label).width;
      if (lx > canvas.width - 60) break;
    }
  }

  private visibleSeries(): SeriesCol[] {
    if (this.state.selected === 'all') return this.state.cols;
    return this.state.cols.filter((c) => c.name === this.state.selected);
  }

  private drawHint(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载数据 — 拖入 .csv 文件或打开「示例数据」'
        : 'No data — drop a .csv file or load sample data';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

export default function createTimeSeriesPlugin(): Plugin {
  return new TimeSeriesPlugin();
}