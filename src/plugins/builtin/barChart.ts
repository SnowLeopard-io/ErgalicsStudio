// ==========================================================================
// Example plugin: Bar Chart (柱状图)
//
// Renders numeric categories as vertical bars. Accepts .csv/.dat with the
// format: label,value per line. Supports horizontal/vertical orientation
// and palette selection.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  ContainerCapabilities,
} from '@/types/plugin';
import { actionButton, exportCanvasPng, exportRowsCsv } from './shared/enhance';

export { barChartManifest } from './barChartManifest';
import { barChartManifest } from './barChartManifest';

interface Bar {
  label: string;
  value: number;
}

type SortOrder = 'none' | 'asc' | 'desc';

interface State {
  orientation: 'vertical' | 'horizontal';
  palette: string;
  showLabels: boolean;
  order: SortOrder;
  hasData: boolean;
}

const PALETTES: Record<string, string[]> = {
  ocean: ['#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af'],
  sunset: ['#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e'],
  forest: ['#34d399', '#10b981', '#059669', '#047857', '#065f46'],
  berry: ['#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d'],
};

export class BarChartPlugin implements Plugin {
  readonly manifest = barChartManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private bars: Bar[] = [];
  private state: State = { orientation: 'vertical', palette: 'ocean', showLabels: true, order: 'none', hasData: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.bars = [];
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
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'bar-chart');
    }
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (params.orientation === 'vertical' || params.orientation === 'horizontal') {
      this.state.orientation = params.orientation;
    }
    if (typeof params.palette === 'string') this.state.palette = params.palette;
    if (params.order === 'none' || params.order === 'asc' || params.order === 'desc') {
      this.state.order = params.order;
    }
    if (typeof params.showLabels === 'boolean') this.state.showLabels = params.showLabels;
    this.draw();
  }

  private exportCsv() {
    exportRowsCsv(
      this.api,
      'bar-chart',
      ['category', 'value'],
      this.orderedBars().map((b) => [b.label, b.value]),
    );
  }

  /** Bars in the currently selected display order (import order kept for 'none'). */
  private orderedBars(): Bar[] {
    if (this.state.order === 'none') return this.bars;
    const sorted = [...this.bars];
    sorted.sort((a, b) => (this.state.order === 'asc' ? a.value - b.value : b.value - a.value));
    return sorted;
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'orientation',
        label: 'Orientation',
        labelI18n: { 'zh-CN': '方向', 'en-US': 'Orientation' },
        type: 'select',
        value: this.state.orientation,
        options: [
          { value: 'vertical', label: 'Vertical', labelI18n: { 'zh-CN': '垂直', 'en-US': 'Vertical' } },
          { value: 'horizontal', label: 'Horizontal', labelI18n: { 'zh-CN': '水平', 'en-US': 'Horizontal' } },
        ],
      },
      {
        key: 'palette',
        label: 'Palette',
        labelI18n: { 'zh-CN': '配色', 'en-US': 'Palette' },
        type: 'select',
        value: this.state.palette,
        options: [
          { value: 'ocean', label: 'Ocean', labelI18n: { 'zh-CN': '海洋', 'en-US': 'Ocean' } },
          { value: 'sunset', label: 'Sunset', labelI18n: { 'zh-CN': '日落', 'en-US': 'Sunset' } },
          { value: 'forest', label: 'Forest', labelI18n: { 'zh-CN': '森林', 'en-US': 'Forest' } },
          { value: 'berry', label: 'Berry', labelI18n: { 'zh-CN': '莓果', 'en-US': 'Berry' } },
        ],
      },
      {
        key: 'order',
        label: 'Sort',
        labelI18n: { 'zh-CN': '排序', 'en-US': 'Sort' },
        type: 'select',
        value: this.state.order,
        options: [
          { value: 'none', label: 'None', labelI18n: { 'zh-CN': '不排序', 'en-US': 'None' } },
          { value: 'asc', label: 'Ascending', labelI18n: { 'zh-CN': '升序', 'en-US': 'Ascending' } },
          { value: 'desc', label: 'Descending', labelI18n: { 'zh-CN': '降序', 'en-US': 'Descending' } },
        ],
      },
      {
        key: 'showLabels',
        label: 'Show Labels',
        labelI18n: { 'zh-CN': '显示标签', 'en-US': 'Show Labels' },
        type: 'checkbox',
        value: this.state.showLabels,
      },
      actionButton('exportPng', 'Export PNG', '导出 PNG'),
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const bars = parseBars(text);
    if (bars.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '未找到可用的分类数据（格式：标签,数值）'
          : 'No valid categorical data found (format: label,value)',
      );
      return;
    }
    this.bars = bars;
    this.state.hasData = true;
    this.api.reportDataScale(bars.length);
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

    if (!this.state.hasData || this.bars.length === 0) {
      this.drawEmpty(g, canvas);
      return;
    }

    const w = canvas.width;
    const h = canvas.height;
    const margin = { left: 50, right: 14, top: 14, bottom: 40 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    const palette = PALETTES[this.state.palette] ?? PALETTES.ocean!;

    let maxVal = -Infinity;
    let minVal = Infinity;
    for (const b of this.bars) {
      if (b.value > maxVal) maxVal = b.value;
      if (b.value < minVal) minVal = b.value;
    }
    if (minVal > 0) minVal = 0;
    if (maxVal < 0) maxVal = 0;
    const range = maxVal - minVal || 1;

    const bars = this.orderedBars();
    const n = bars.length;
    const font = `${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, 10px, monospace`;

    if (this.state.orientation === 'vertical') {
      const barW = plotW / n * 0.8;
      const gap = plotW / n * 0.2;
      const baseline = margin.top + (maxVal / range) * plotH;

      // Axis
      g.strokeStyle = 'rgba(148, 163, 184, 0.4)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(margin.left, margin.top);
      g.lineTo(margin.left, h - margin.bottom);
      g.lineTo(w - margin.right, h - margin.bottom);
      g.stroke();
      // Zero baseline
      if (minVal < 0) {
        g.strokeStyle = 'rgba(148, 163, 184, 0.3)';
        g.beginPath();
        g.moveTo(margin.left, baseline);
        g.lineTo(w - margin.right, baseline);
        g.stroke();
      }

      g.font = font;
      g.textAlign = 'center';
      for (let i = 0; i < n; i++) {
        const bar = bars[i]!;
        const x = margin.left + i * (plotW / n) + gap / 2;
        const barH = (Math.abs(bar.value) / range) * plotH;
        const y = bar.value >= 0 ? baseline - barH : baseline;
        g.fillStyle = palette[i % palette.length]!;
        g.fillRect(x, y, barW, barH);
        if (this.state.showLabels) {
          g.fillStyle = 'rgba(200, 214, 228, 0.85)';
          g.save();
          g.translate(x + barW / 2, h - margin.bottom + 6);
          g.rotate(-Math.PI / 6);
          g.textAlign = 'right';
          g.fillText(bar.label.slice(0, 12), 0, 10);
          g.restore();
          g.textAlign = 'center';
          g.fillText(short(bar.value), x + barW / 2, y - 4);
        }
      }
    } else {
      // Horizontal
      const barH = plotH / n * 0.7;
      const gap = plotH / n * 0.3;
      g.strokeStyle = 'rgba(148, 163, 184, 0.4)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(margin.left, margin.top);
      g.lineTo(margin.left, h - margin.bottom);
      g.lineTo(w - margin.right, h - margin.bottom);
      g.stroke();

      g.font = font;
      g.textAlign = 'right';
      for (let i = 0; i < n; i++) {
        const bar = bars[i]!;
        const y = margin.top + i * (plotH / n) + gap / 2;
        const barW = (Math.abs(bar.value) / range) * plotW;
        g.fillStyle = palette[i % palette.length]!;
        g.fillRect(margin.left, y, barW, barH);
        if (this.state.showLabels) {
          g.fillStyle = 'rgba(200, 214, 228, 0.85)';
          g.fillText(bar.label.slice(0, 14), margin.left - 4, y + barH / 2 + 3);
          g.textAlign = 'left';
          g.fillText(short(bar.value), margin.left + barW + 4, y + barH / 2 + 3);
          g.textAlign = 'right';
        }
      }
    }
  }

  private drawEmpty(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载柱状图数据 — 拖入 .csv 文件（标签,数值）'
        : 'No bar data — drop a .csv file (label,value)';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }
}

/**
 * Buttons arrive as `updateParams({ [action]: true })`; the host ParamPanel
 * historically emits `{ [key]: { action } }` instead, so accept both shapes.
 */
function actionFired(params: Record<string, unknown>, key: string): boolean {
  const v = params[key];
  return v === true || (typeof v === 'object' && v !== null && (v as { action?: unknown }).action === key);
}

/** Parse `label,value` or `label value` per line. */
export function parseBars(text: string): Bar[] {
  const bars: Bar[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Try comma first, then whitespace
    const parts = trimmed.includes(',')
      ? trimmed.split(',')
      : trimmed.split(/[\s]+/);
    if (parts.length < 2) {
      // Single numeric token = auto-label
      const v = parseFloat(trimmed);
      if (Number.isFinite(v)) bars.push({ label: `#${bars.length + 1}`, value: v });
      continue;
    }
    const value = parseFloat(parts[parts.length - 1]!);
    const label = parts.slice(0, -1).join(' ');
    if (Number.isFinite(value) && label) {
      bars.push({ label, value });
    } else {
      // Maybe it's all numbers (first col = value)
      const v0 = parseFloat(parts[0]!);
      if (Number.isFinite(v0)) bars.push({ label: parts[1] ?? `#${bars.length + 1}`, value: v0 });
    }
  }
  return bars.slice(0, 500);
}

function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(0);
  return v.toFixed(1);
}

export default function createBarChartPlugin(): Plugin {
  return new BarChartPlugin();
}
