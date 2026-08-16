// ==========================================================================
// Example plugin: Polar/Radar Plot (雷达图)
//
// Renders multi-series radar/polar plots from CSV data. Each column becomes
// an axis; each row becomes a series. Supports fill opacity and axis count.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const polarPlotManifest: PluginManifest = {
  id: 'example.polar',
  name: 'Polar Plot',
  nameI18n: { 'zh-CN': '雷达图', 'en-US': 'Polar Plot' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Multi-series radar/polar chart.',
  descriptionI18n: {
    'zh-CN': '渲染多系列雷达/极坐标图，每列一个维度，每行一个系列。',
    'en-US': 'Multi-series radar/polar chart; each column is an axis, each row a series.',
  },
  license: 'MIT',
  entry: 'example.polar',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};

interface State {
  fill: number;
  showLabels: boolean;
  hasData: boolean;
}

const COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb7185'];

export class PolarPlotPlugin implements Plugin {
  readonly manifest = polarPlotManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private labels: string[] = [];
  private series: { name: string; values: number[] }[] = [];
  private state: State = { fill: 0.25, showLabels: true, hasData: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.labels = [];
    this.series = [];
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
    if (typeof params.fill === 'number') {
      this.state.fill = Math.max(0, Math.min(1, params.fill));
    }
    if (typeof params.showLabels === 'boolean') this.state.showLabels = params.showLabels;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'fill',
        label: 'Fill Opacity',
        labelI18n: { 'zh-CN': '填充透明度', 'en-US': 'Fill Opacity' },
        type: 'range',
        min: 0,
        max: 1,
        step: 0.05,
        value: this.state.fill,
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
    const { labels, series } = parseRadar(text);
    if (labels.length < 3 || series.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '需要至少 3 个维度和 1 个系列'
          : 'Need at least 3 dimensions and 1 series',
      );
      return;
    }
    this.labels = labels;
    this.series = series;
    this.state.hasData = true;
    this.api.reportDataScale(labels.length * series.length);
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

    if (!this.state.hasData || this.labels.length === 0) {
      this.drawEmpty(g, canvas);
      return;
    }

    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.min(canvas.width, canvas.height) / 2 - 30;
    const n = this.labels.length;
    const font = `10px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;

    // Grid rings
    g.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    g.lineWidth = 1;
    for (let ring = 1; ring <= 4; ring += 1) {
      const r = (radius * ring) / 4;
      g.beginPath();
      for (let i = 0; i <= n; i += 1) {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }

    // Axes
    g.strokeStyle = 'rgba(148, 163, 184, 0.3)';
    for (let i = 0; i < n; i += 1) {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
      g.stroke();
    }

    // Labels
    if (this.state.showLabels) {
      g.font = font;
      g.fillStyle = 'rgba(200, 214, 228, 0.85)';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let i = 0; i < n; i += 1) {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const lx = cx + Math.cos(angle) * (radius + 16);
        const ly = cy + Math.sin(angle) * (radius + 16);
        g.fillText(this.labels[i]!, lx, ly);
      }
    }

    // Series
    for (let s = 0; s < this.series.length; s += 1) {
      const ser = this.series[s]!;
      const color = COLORS[s % COLORS.length]!;
      let maxVal = 1;
      for (const v of ser.values) if (Math.abs(v) > maxVal) maxVal = Math.abs(v);

      g.strokeStyle = color;
      g.fillStyle = color;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i <= n; i += 1) {
        const idx = i % n;
        const v = ser.values[idx] ?? 0;
        const angle = (idx / n) * Math.PI * 2 - Math.PI / 2;
        const r = (v / maxVal) * radius;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      g.globalAlpha = this.state.fill;
      g.fill();
      g.globalAlpha = 1;
      g.stroke();

      // Vertices
      for (let i = 0; i < n; i += 1) {
        const v = ser.values[i] ?? 0;
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        const r = (v / maxVal) * radius;
        g.beginPath();
        g.arc(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, 2, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  private drawEmpty(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载雷达图数据 — 拖入 .csv 文件'
        : 'No polar data — drop a .csv file';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

/**
 * Parse CSV-like text for radar data.
 * First row = column headers (axis labels).
 * Each subsequent row = a series (first cell = series name, rest = values).
 */
export function parseRadar(text: string): {
  labels: string[];
  series: { name: string; values: number[] }[];
} {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { labels: [], series: [] };

  const sep = lines[0]!.includes(',') ? ',' : /\s+/;
  const headers = lines[0]!.split(sep).map((h) => h.trim());
  // If first column is numeric, it's not a label → auto-generate
  const firstVal = parseFloat(headers[0]!);
  const hasHeaderRow = !Number.isFinite(firstVal);
  const labels = hasHeaderRow
    ? headers.slice(1).length >= 3
      ? headers.slice(1)
      : headers
    : headers.map((_, i) => `A${i + 1}`);

  const series: { name: string; values: number[] }[] = [];
  const dataStart = hasHeaderRow ? 1 : 0;
  for (let i = dataStart; i < lines.length; i += 1) {
    const parts = lines[i]!.split(sep).map((p) => p.trim());
    const name = Number.isFinite(parseFloat(parts[0]!)) ? `S${series.length + 1}` : parts[0]!;
    const valStart = Number.isFinite(parseFloat(parts[0]!)) ? 0 : 1;
    const values = parts.slice(valStart).map((v) => parseFloat(v)).filter(Number.isFinite);
    if (values.length >= 3) series.push({ name, values });
  }
  return { labels, series };
}

export default function createPolarPlotPlugin(): Plugin {
  return new PolarPlotPlugin();
}
