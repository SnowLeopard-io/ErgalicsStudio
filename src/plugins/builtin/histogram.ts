// ==========================================================================
// Example plugin: Histogram
// Reads a 1-D numeric series from text (.csv/.dat/.json/.txt) and renders a
// histogram with configurable bin count, log scale and palette.
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

export const histogramManifest: PluginManifest = {
  id: 'example.histogram',
  name: 'Histogram',
  nameI18n: { 'zh-CN': '直方图', 'en-US': 'Histogram' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Distribution histogram for numeric data.',
  descriptionI18n: {
    'zh-CN': '对一维数值数据绘制分布直方图，可调节分箱数。',
    'en-US': 'Render a distribution histogram for numeric data.',
  },
  license: 'MIT',
  entry: 'example.histogram',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};

interface State {
  values: number[];
  bins: number;
  palette: string;
  log: boolean;
}

const PALETTES: Record<string, string> = {
  teal: '#2dd4bf',
  blue: '#60a5fa',
  amber: '#fbbf24',
  violet: '#a78bfa',
};

export class HistogramPlugin implements Plugin {
  readonly manifest = histogramManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = { values: [], bins: 30, palette: 'teal', log: false };

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
    if (typeof params.bins === 'number') this.state.bins = params.bins;
    if (typeof params.palette === 'string') this.state.palette = params.palette;
    if (typeof params.log === 'boolean') this.state.log = params.log;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'bins', label: 'Bins', type: 'range', min: 5, max: 100, step: 1, value: this.state.bins },
      {
        key: 'palette',
        label: 'Color',
        type: 'select',
        value: this.state.palette,
        options: [
          { value: 'teal', label: 'Teal', labelI18n: { 'zh-CN': '青绿', 'en-US': 'Teal' } },
          { value: 'blue', label: 'Blue', labelI18n: { 'zh-CN': '蓝', 'en-US': 'Blue' } },
          { value: 'amber', label: 'Amber', labelI18n: { 'zh-CN': '琥珀', 'en-US': 'Amber' } },
          { value: 'violet', label: 'Violet', labelI18n: { 'zh-CN': '紫', 'en-US': 'Violet' } },
        ],
      },
      { key: 'log', label: 'Log scale', type: 'checkbox', value: this.state.log },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const values = this.parseValues(text);
    if (values.length < 4) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN' ? '未找到足够的数值数据' : 'Not enough numeric values',
      );
      return;
    }
    this.state.values = values;
    this.api.reportDataScale(values.length);
    this.draw();
  }

  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    const total = 8;
    for (let i = 0; i < total; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      onProgress?.({ done: i + 1, total });
    }
    if (this.state.values.length === 0) return { ok: false, error: 'no data' };
    const sum = this.state.values.reduce((a, b) => a + b, 0);
    return {
      ok: true,
      output: {
        count: this.state.values.length,
        min: Math.min(...this.state.values),
        max: Math.max(...this.state.values),
        mean: sum / this.state.values.length,
      },
    };
  }

  private parseValues(text: string): number[] {
    const trimmed = text.trim();
    // JSON: extract every number (metadata + observations).
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return text.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
    }
    const values: number[] = [];
    for (const line of text.split(/\r?\n/)) {
      const lineTrim = line.trim();
      if (!lineTrim) continue;
      // CSV row: take the first numeric token (handles multi-column rows).
      const tokens = lineTrim.split(/[,\s]+/);
      for (const tok of tokens) {
        const v = parseFloat(tok);
        if (Number.isFinite(v)) {
          values.push(v);
          break;
        }
      }
    }
    if (values.length < 4) {
      return text.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)?.map(Number) ?? [];
    }
    return values;
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

    if (this.state.values.length === 0) {
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      const msg =
        this.api.locale === 'zh-CN'
          ? '未加载数据 — 拖入 .csv/.dat/.json 文件或打开「示例数据」'
          : 'No data — drop a .csv/.dat/.json file or load sample data';
      g.fillText(msg, canvas.width / 2, canvas.height / 2);
      return;
    }

    const values = this.state.values;
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min || 1;
    const bins = Math.max(2, Math.round(this.state.bins));
    const counts = new Array(bins).fill(0);
    for (const v of values) {
      let idx = Math.floor(((v - min) / span) * bins);
      if (idx === bins) idx = bins - 1;
      counts[idx]! += 1;
    }
    let maxCount = 1;
    for (const c of counts) if (c > maxCount) maxCount = c;

    const padL = 34;
    const padB = 18;
    const plotW = canvas.width - padL - 8;
    const plotH = canvas.height - padB - 10;
    const barW = plotW / bins;

    // axes
    g.strokeStyle = 'rgba(127, 140, 160, 0.35)';
    g.beginPath();
    g.moveTo(padL, 10);
    g.lineTo(padL, canvas.height - padB);
    g.lineTo(canvas.width - 8, canvas.height - padB);
    g.stroke();

    const color = (PALETTES[this.state.palette] ?? PALETTES.teal) as string;
    for (let i = 0; i < bins; i += 1) {
      const c = counts[i]!;
      const h = this.state.log
        ? (Math.log2(c + 1) / Math.log2(maxCount + 1)) * plotH
        : (c / maxCount) * plotH;
      if (h <= 0) continue;
      const x = padL + i * barW;
      g.fillStyle = i % 2 === 0 ? color : this.shade(color, 0.82);
      g.fillRect(x + 1, canvas.height - padB - h, Math.max(1, barW - 2), h);
    }

    // count label
    g.textAlign = 'left';
    g.font = `11px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(200, 214, 228, 0.85)';
    g.fillText(`${values.length} samples`, padL + 2, canvas.height - 5);
  }

  private shade(hex: string, k: number): string {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.round(((n >> 16) & 255) * k);
    const g = Math.round(((n >> 8) & 255) * k);
    const b = Math.round((n & 255) * k);
    return `rgb(${r},${g},${b})`;
  }
}

export default function createHistogramPlugin(): Plugin {
  return new HistogramPlugin();
}