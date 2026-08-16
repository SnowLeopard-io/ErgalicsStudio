// ==========================================================================
// Example plugin: Violin/Density Plot (小提琴图)
//
// Renders kernel density estimates for multiple groups. Accepts CSV data
// with "group,value" per line. Computes a Gaussian KDE per group and draws
// mirrored density shapes.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const violinPlotManifest: PluginManifest = {
  id: 'example.violin',
  name: 'Violin Plot',
  nameI18n: { 'zh-CN': '小提琴图', 'en-US': 'Violin Plot' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Kernel density violin plot for grouped data.',
  descriptionI18n: {
    'zh-CN': '对分组数值数据绘制核密度小提琴图，支持带宽调节与箱线图叠加。',
    'en-US': 'Kernel density violin plot for grouped data; adjustable bandwidth with box overlay.',
  },
  license: 'MIT',
  entry: 'example.violin',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (group,value)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.json', mimeTypes: ['application/json'], description: 'JSON' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};

interface State {
  bandwidth: number;
  showBox: boolean;
  hasData: boolean;
}

const MAX_POINTS = 50_000;
const BINS = 64;

const COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#22d3ee', '#c084fc'];

export class ViolinPlotPlugin implements Plugin {
  readonly manifest = violinPlotManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private groups: Map<string, number[]> = new Map();
  private state: State = { bandwidth: 1, showBox: true, hasData: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.groups.clear();
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
    if (typeof params.bandwidth === 'number') this.state.bandwidth = params.bandwidth;
    if (typeof params.showBox === 'boolean') this.state.showBox = params.showBox;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'bandwidth',
        label: 'Bandwidth',
        labelI18n: { 'zh-CN': '带宽', 'en-US': 'Bandwidth' },
        type: 'range',
        min: 0.1,
        max: 3,
        step: 0.1,
        value: this.state.bandwidth,
      },
      {
        key: 'showBox',
        label: 'Show Box Plot',
        labelI18n: { 'zh-CN': '显示箱线图', 'en-US': 'Show Box Plot' },
        type: 'checkbox',
        value: this.state.showBox,
      },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const groups = parseViolin(text);
    if (groups.size === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '未找到有效的分组数据（格式：分组,数值）'
          : 'No valid grouped data found (format: group,value)',
      );
      return;
    }
    this.groups = groups;
    this.state.hasData = true;
    let total = 0;
    for (const arr of groups.values()) total += arr.length;
    this.api.reportDataScale(total);
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

    if (!this.state.hasData || this.groups.size === 0) {
      this.drawEmpty(g, canvas);
      return;
    }

    const w = canvas.width;
    const h = canvas.height;
    const margin = { left: 50, right: 14, top: 14, bottom: 34 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    const font = `10px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;

    // Global value range
    let minVal = Infinity; let maxVal = -Infinity;
    for (const arr of this.groups.values()) {
      for (const v of arr) {
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }
    const range = maxVal - minVal || 1;
    // Pad range
    minVal -= range * 0.05;
    maxVal += range * 0.05;
    const span = maxVal - minVal;
    const py = (v: number) => margin.top + (1 - (v - minVal) / span) * plotH;

    const groupNames = Array.from(this.groups.keys());
    const n = groupNames.length;
    const slotW = plotW / n;

    // Axes
    g.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(margin.left, margin.top);
    g.lineTo(margin.left, h - margin.bottom);
    g.lineTo(w - margin.right, h - margin.bottom);
    g.stroke();

    g.fillStyle = 'rgba(148, 163, 184, 0.7)';
    g.font = font;
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k += 1) {
      const t = k / 4;
      const v = minVal + span * t;
      g.fillText(short(v), margin.left - 6, py(v) + 3);
    }

    for (let gi = 0; gi < n; gi += 1) {
      const name = groupNames[gi]!;
      const values = this.groups.get(name)!;
      const color = COLORS[gi % COLORS.length]!;
      const centerX = margin.left + gi * slotW + slotW / 2;
      const maxW = slotW * 0.4;

      // KDE
      const bw = this.state.bandwidth;
      const std = Math.sqrt(variance(values)) || 1;
      const h2 = bw * std * 1.06 * Math.pow(values.length, -0.2);
      const densities: { y: number; d: number }[] = [];
      let maxD = 0;
      for (let b = 0; b <= BINS; b += 1) {
        const y = minVal + (span * b) / BINS;
        let d = 0;
        for (const v of values) {
          const u = (y - v) / h2;
          d += Math.exp(-0.5 * u * u);
        }
        d /= values.length * h2;
        densities.push({ y, d });
        if (d > maxD) maxD = d;
      }

      // Draw violin
      g.fillStyle = color + '40'; // 25% alpha
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.beginPath();
      for (let b = 0; b <= BINS; b += 1) {
        const { y, d } = densities[b]!;
        const r = (d / maxD) * maxW;
        const px = centerX + r;
        const py_ = py(y);
        if (b === 0) g.moveTo(px, py_);
        else g.lineTo(px, py_);
      }
      for (let b = BINS; b >= 0; b -= 1) {
        const { y, d } = densities[b]!;
        const r = (d / maxD) * maxW;
        g.lineTo(centerX - r, py(y));
      }
      g.closePath();
      g.fill();
      g.stroke();

      // Box plot overlay
      if (this.state.showBox) {
        const sorted = [...values].sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
        const med = sorted[Math.floor(sorted.length * 0.5)]!;
        const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
        const bw2 = 6;
        g.fillStyle = 'rgba(30, 41, 59, 0.8)';
        g.strokeStyle = 'rgba(200, 214, 228, 0.9)';
        g.lineWidth = 1;
        g.fillRect(centerX - bw2, py(q3), bw2 * 2, py(q1) - py(q3));
        g.strokeRect(centerX - bw2, py(q3), bw2 * 2, py(q1) - py(q3));
        // Median line
        g.beginPath();
        g.moveTo(centerX - bw2, py(med));
        g.lineTo(centerX + bw2, py(med));
        g.stroke();
      }

      // Group label
      g.fillStyle = 'rgba(200, 214, 228, 0.85)';
      g.font = font;
      g.textAlign = 'center';
      g.fillText(name.slice(0, 10), centerX, h - margin.bottom + 14);
    }
  }

  private drawEmpty(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载小提琴图数据 — 拖入 .csv 文件（分组,数值）'
        : 'No violin data — drop a .csv (group,value)';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

function variance(arr: number[]): number {
  if (arr.length === 0) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
}

/** Parse `group,value` per line (or whitespace-delimited). */
export function parseViolin(text: string): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    if (count >= MAX_POINTS) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.includes(',') ? trimmed.split(',') : trimmed.split(/\s+/);
    if (parts.length < 2) continue;
    // Find first non-numeric token as group, first numeric as value
    let group = '';
    let value = NaN;
    for (let i = 0; i < parts.length; i += 1) {
      const v = parseFloat(parts[i]!);
      if (!Number.isFinite(v)) {
        if (!group) group = parts[i]!.trim();
      } else {
        value = v;
        break;
      }
    }
    if (!group || !Number.isFinite(value)) {
      // Maybe all numeric → single group
      const v0 = parseFloat(parts[0]!);
      if (Number.isFinite(v0)) {
        group = 'Group 1';
        value = v0;
      } else continue;
    }
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group)!.push(value);
    count += 1;
  }
  return groups;
}

function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

export default function createViolinPlotPlugin(): Plugin {
  return new ViolinPlotPlugin();
}
