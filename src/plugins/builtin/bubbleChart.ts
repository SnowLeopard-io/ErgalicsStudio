// ==========================================================================
// Example plugin: Bubble Chart (气泡图)
//
// Renders 3-dimensional numeric data (x, y, size) as a bubble chart with
// optional 4th-column color mapping. Accepts .csv/.dat/.xyz.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  ContainerCapabilities,
} from '@/types/plugin';
import { actionButton, exportCanvasPng, exportRowsCsv } from './shared/enhance';

export { bubbleChartManifest } from './bubbleChartManifest';
import { bubbleChartManifest } from './bubbleChartManifest';

interface Bubble {
  x: number;
  y: number;
  size: number;
  /** Numeric 4th column, used for the value-based color ramp. */
  c?: number;
  /** Non-numeric 4th column, treated as a categorical group. */
  group?: string;
}

interface State {
  maxSize: number;
  opacity: number;
  colorBy: 'auto' | 'solid';
  hasData: boolean;
}

const MAX_BUBBLES = 10_000;

export class BubbleChartPlugin implements Plugin {
  readonly manifest = bubbleChartManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private bubbles: Bubble[] = [];
  private cMin = 0;
  private cMax = 1;
  private state: State = { maxSize: 30, opacity: 0.6, colorBy: 'auto', hasData: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.bubbles = [];
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
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'bubble-chart');
    }
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (typeof params.maxSize === 'number') this.state.maxSize = params.maxSize;
    if (typeof params.opacity === 'number') this.state.opacity = params.opacity;
    if (params.colorBy === 'auto' || params.colorBy === 'solid') this.state.colorBy = params.colorBy;
    this.draw();
  }

  private exportCsv() {
    const hasColor = this.bubbles.some((b) => b.c !== undefined);
    const hasGroup = this.bubbles.some((b) => b.group !== undefined);
    const header: string[] = ['x', 'y', 'size'];
    if (hasColor) header.push('color');
    if (hasGroup) header.push('group');
    const rows: Array<Array<string | number>> = this.bubbles.map((b) => {
      const row: Array<string | number> = [b.x, b.y, b.size];
      if (hasColor) row.push(b.c ?? '');
      if (hasGroup) row.push(b.group ?? '');
      return row;
    });
    exportRowsCsv(this.api, 'bubble-chart', header, rows);
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'maxSize',
        label: 'Max Bubble Size',
        labelI18n: { 'zh-CN': '最大气泡', 'en-US': 'Max Bubble Size' },
        type: 'range',
        min: 5,
        max: 60,
        step: 1,
        value: this.state.maxSize,
      },
      {
        key: 'opacity',
        label: 'Opacity',
        labelI18n: { 'zh-CN': '透明度', 'en-US': 'Opacity' },
        type: 'range',
        min: 0.1,
        max: 1,
        step: 0.05,
        value: this.state.opacity,
      },
      {
        key: 'colorBy',
        label: 'Color',
        labelI18n: { 'zh-CN': '颜色', 'en-US': 'Color' },
        type: 'select',
        value: this.state.colorBy,
        options: [
          { value: 'auto', label: 'By 4th col', labelI18n: { 'zh-CN': '按第四列值', 'en-US': 'By 4th col' } },
          { value: 'solid', label: 'Solid', labelI18n: { 'zh-CN': '单色', 'en-US': 'Solid' } },
        ],
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
    const bubbles = parseBubbles(text);
    if (bubbles.length < 1) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '未找到有效的气泡数据（至少需要 x y size 三列）'
          : 'No valid bubble data (need at least x, y, size columns)',
      );
      return;
    }
    this.bubbles = bubbles;
    this.state.hasData = true;
    let cMin = Infinity;
    let cMax = -Infinity;
    for (const b of bubbles) {
      if (b.c !== undefined) {
        if (b.c < cMin) cMin = b.c;
        if (b.c > cMax) cMax = b.c;
      }
    }
    if (Number.isFinite(cMin)) {
      this.cMin = cMin;
      this.cMax = cMax;
    }
    this.api.reportDataScale(bubbles.length);
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

    if (!this.state.hasData || this.bubbles.length === 0) {
      this.drawEmpty(g, canvas);
      return;
    }

    const w = canvas.width;
    const h = canvas.height;
    const margin = { left: 46, right: 14, top: 14, bottom: 34 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    let minX = Infinity; let maxX = -Infinity;
    let minY = Infinity; let maxY = -Infinity;
    let minS = Infinity; let maxS = -Infinity;
    for (const b of this.bubbles) {
      if (b.x < minX) minX = b.x;
      if (b.x > maxX) maxX = b.x;
      if (b.y < minY) minY = b.y;
      if (b.y > maxY) maxY = b.y;
      if (b.size < minS) minS = b.size;
      if (b.size > maxS) maxS = b.size;
    }
    const rangeX = maxX - minX || 1;
    const rangeY = maxY - minY || 1;
    const rangeS = maxS - minS || 1;
    const px = (v: number) => margin.left + ((v - minX) / rangeX) * plotW;
    const py = (v: number) => margin.top + (1 - (v - minY) / rangeY) * plotH;

    // Axes
    g.strokeStyle = 'rgba(148, 163, 184, 0.4)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(margin.left, margin.top);
    g.lineTo(margin.left, h - margin.bottom);
    g.lineTo(w - margin.right, h - margin.bottom);
    g.stroke();

    g.fillStyle = 'rgba(148, 163, 184, 0.7)';
    g.font = `10px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    for (let k = 0; k <= 4; k += 1) {
      const t = k / 4;
      g.fillText(short(minX + rangeX * t), px(minX + rangeX * t), h - margin.bottom + 14);
      g.textAlign = 'right';
      g.fillText(short(minY + rangeY * t), margin.left - 6, py(minY + rangeY * t) + 3);
      g.textAlign = 'center';
    }

    const span = Math.max(this.cMax - this.cMin, 1e-9);
    const step = Math.max(1, Math.floor(this.bubbles.length / 5000));
    for (let i = 0; i < this.bubbles.length; i += step) {
      const b = this.bubbles[i]!;
      const cx = px(b.x);
      const cy = py(b.y);
      const r = 3 + ((b.size - minS) / rangeS) * (this.state.maxSize - 3);

      if (this.state.colorBy === 'solid' || b.c === undefined) {
        g.fillStyle = `rgba(45, 212, 191, ${this.state.opacity})`;
      } else {
        const t = Math.max(0, Math.min(1, (b.c - this.cMin) / span));
        const c = ramp(t);
        g.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${this.state.opacity})`;
      }
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawEmpty(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载气泡数据 — 拖入 .csv 文件（x y size [color]）'
        : 'No bubble data — drop a .csv (x y size [color])';
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

/** Parse `x y size [color|group]` per line; a non-numeric 4th token is a group. */
export function parseBubbles(text: string): Bubble[] {
  const bubbles: Bubble[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (bubbles.length >= MAX_BUBBLES) break;
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/[\s,]+/);
    const nums = parts.map((s) => parseFloat(s));
    if (nums.length < 3 || nums.slice(0, 3).some((n) => !Number.isFinite(n))) continue;
    const fourth = parts[3]?.trim();
    bubbles.push({
      x: nums[0]!,
      y: nums[1]!,
      size: Math.max(0, nums[2]!),
      c: fourth !== undefined && fourth !== '' && Number.isFinite(nums[3]) ? nums[3] : undefined,
      group: fourth && !Number.isFinite(nums[3]) ? fourth : undefined,
    });
  }
  return bubbles;
}

function ramp(t: number): [number, number, number] {
  const a: [number, number, number] = [96, 165, 250];
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

export default function createBubbleChartPlugin(): Plugin {
  return new BubbleChartPlugin();
}
