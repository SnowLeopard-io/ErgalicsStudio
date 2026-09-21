// ==========================================================================
// Example plugin: Box Plot (箱线图)
//
// Renders box-and-whisker plots for grouped numeric data. Accepts CSV with
// "group,value" per line or multi-column numeric CSV (one box per column).
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  ContainerCapabilities,
} from '@/types/plugin';
import { actionButton, actionFired, exportCanvasPng, exportRowsCsv, notify } from './shared/enhance';

export { boxPlotManifest } from './boxPlotManifest';
import { boxPlotManifest } from './boxPlotManifest';

interface BoxStats {
  name: string;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  n: number;
  outliers: number[];
}

interface State {
  showOutliers: boolean;
  showMean: boolean;
  hasData: boolean;
}

const MAX_POINTS = 50_000;
const COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#fb7185', '#22d3ee', '#c084fc'];

export class BoxPlotPlugin implements Plugin {
  readonly manifest = boxPlotManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private boxes: BoxStats[] = [];
  private state: State = { showOutliers: true, showMean: false, hasData: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.boxes = [];
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
    if (typeof params.showOutliers === 'boolean') this.state.showOutliers = params.showOutliers;
    if (typeof params.showMean === 'boolean') this.state.showMean = params.showMean;
    if (actionFired(params, 'exportPng')) this.exportPng();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'showOutliers',
        label: 'Show Outliers',
        labelI18n: { 'zh-CN': '显示离群点', 'en-US': 'Show Outliers' },
        type: 'checkbox',
        value: this.state.showOutliers,
      },
      {
        key: 'showMean',
        label: 'Show Mean',
        labelI18n: { 'zh-CN': '显示均值', 'en-US': 'Show Mean' },
        type: 'checkbox',
        value: this.state.showMean,
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
    const boxes = parseBoxData(text);
    if (boxes.length === 0) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '未找到有效的数值数据'
          : 'No valid numeric data found',
      );
      return;
    }
    this.boxes = boxes;
    this.state.hasData = true;
    let total = 0;
    for (const b of boxes) total += (b.outliers.length || 0) + 5;
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

    if (!this.state.hasData || this.boxes.length === 0) {
      this.drawEmpty(g, canvas);
      return;
    }

    const w = canvas.width;
    const h = canvas.height;
    const margin = { left: 50, right: 14, top: 14, bottom: 40 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    const font = `10px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;

    let minVal = Infinity;
    let maxVal = -Infinity;
    for (const b of this.boxes) {
      if (b.min < minVal) minVal = b.min;
      if (b.max > maxVal) maxVal = b.max;
      for (const o of b.outliers) {
        if (o < minVal) minVal = o;
        if (o > maxVal) maxVal = o;
      }
    }
    const span = maxVal - minVal || 1;
    minVal -= span * 0.05;
    maxVal += span * 0.05;
    const range = maxVal - minVal;
    const py = (v: number) => margin.top + (1 - (v - minVal) / range) * plotH;

    // Grid + y labels
    g.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    g.lineWidth = 1;
    g.fillStyle = 'rgba(148, 163, 184, 0.7)';
    g.font = font;
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k += 1) {
      const t = k / 4;
      const v = minVal + range * t;
      const y = py(v);
      g.beginPath();
      g.moveTo(margin.left, y);
      g.lineTo(w - margin.right, y);
      g.stroke();
      g.fillText(short(v), margin.left - 6, y + 3);
    }

    const n = this.boxes.length;
    const slotW = plotW / n;
    for (let i = 0; i < n; i += 1) {
      const box = this.boxes[i]!;
      const color = COLORS[i % COLORS.length]!;
      const centerX = margin.left + i * slotW + slotW / 2;
      const boxW = Math.min(44, slotW * 0.6);

      // Whiskers (min → q1, q3 → max)
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(centerX, py(box.min));
      g.lineTo(centerX, py(box.q1));
      g.moveTo(centerX, py(box.q3));
      g.lineTo(centerX, py(box.max));
      g.stroke();

      // Whisker caps
      g.beginPath();
      g.moveTo(centerX - boxW / 3, py(box.min));
      g.lineTo(centerX + boxW / 3, py(box.min));
      g.moveTo(centerX - boxW / 3, py(box.max));
      g.lineTo(centerX + boxW / 3, py(box.max));
      g.stroke();

      // Box (q1 → q3)
      const y1 = py(box.q3);
      const y2 = py(box.q1);
      g.fillStyle = color + '40';
      g.fillRect(centerX - boxW / 2, y1, boxW, y2 - y1);
      g.strokeRect(centerX - boxW / 2, y1, boxW, y2 - y1);

      // Median
      g.beginPath();
      g.moveTo(centerX - boxW / 2, py(box.median));
      g.lineTo(centerX + boxW / 2, py(box.median));
      g.lineWidth = 2;
      g.stroke();
      g.lineWidth = 1.5;

      // Outliers
      if (this.state.showOutliers) {
        g.fillStyle = color;
        for (const o of box.outliers) {
          g.beginPath();
          g.arc(centerX, py(o), 2, 0, Math.PI * 2);
          g.fill();
        }
      }

      // Mean marker (diamond).
      if (this.state.showMean) {
        const my = py(box.mean);
        const r = 4;
        g.beginPath();
        g.moveTo(centerX, my - r);
        g.lineTo(centerX + r, my);
        g.lineTo(centerX, my + r);
        g.lineTo(centerX - r, my);
        g.closePath();
        g.fillStyle = '#f8fafc';
        g.fill();
        g.strokeStyle = color;
        g.lineWidth = 1.5;
        g.stroke();
      }

      // Label
      g.fillStyle = 'rgba(200, 214, 228, 0.85)';
      g.font = font;
      g.textAlign = 'center';
      g.fillText(box.name.slice(0, 10), centerX, h - margin.bottom + 14);
    }
  }

  private drawEmpty(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载箱线图数据 — 拖入 .csv 文件'
        : 'No box data — drop a .csv file';
    g.fillText(msg, canvas.width / 2, canvas.height / 2);
  }

  private exportPng() {
    if (!this.state.hasData || this.boxes.length === 0) {
      notify(this.api, 'warning', 'No data to export yet.', '暂无可导出的数据。');
      return;
    }
    exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'box-plot');
  }

  private exportCsv() {
    const rows = this.boxes.map((b) => [b.name, b.min, b.q1, b.median, b.q3, b.max, b.n]);
    exportRowsCsv(this.api, 'box-plot', ['name', 'min', 'q1', 'median', 'q3', 'max', 'n'], rows);
  }
}

/** Compute box statistics from a sorted array. */
function stats(values: number[]): { min: number; q1: number; median: number; q3: number; max: number; mean: number; n: number; outliers: number[] } {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p: number) => {
    const idx = (sorted.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return (sorted[lo]! + sorted[hi]!) / 2;
  };
  const q1 = q(0.25);
  const median = q(0.5);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const loFence = q1 - 1.5 * iqr;
  const hiFence = q3 + 1.5 * iqr;
  const inliers = sorted.filter((v) => v >= loFence && v <= hiFence);
  const outliers = sorted.filter((v) => v < loFence || v > hiFence);
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    min: inliers[0] ?? sorted[0]!,
    q1,
    median,
    q3,
    max: inliers[inliers.length - 1] ?? sorted[sorted.length - 1]!,
    mean: sum / sorted.length,
    n: sorted.length,
    outliers,
  };
}

/** Parse grouped CSV (`group,value`) or multi-column numeric CSV into boxes. */
export function parseBoxData(text: string): BoxStats[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Detect: first line with a non-numeric first token → grouped format.
  const firstTokens = lines[0]!.trim().split(/[\s,]+/);
  const firstNumeric = Number.isFinite(Number(firstTokens[0]));
  const sep = lines[0]!.includes(',') ? ',' : /\s+/;

  if (!firstNumeric) {
    // Grouped: group,value[,value...]. Line 0 is only a header when its value
    // columns are non-numeric too — otherwise it is the first data row
    // (e.g. `A,1.5`) and starting the loop at 1 silently dropped it.
    const restHasNumeric = firstTokens.slice(1).some((t) => Number.isFinite(Number(t)));
    const start = restHasNumeric ? 0 : 1;
    const groups = new Map<string, number[]>();
    let count = 0;
    for (let i = start; i < lines.length; i += 1) {
      if (count >= MAX_POINTS) break;
      const parts = lines[i]!.split(sep).map((p) => p.trim());
      if (parts.length < 2) continue;
      const group = parts[0]!;
      const vals = parts.slice(1).map((p) => Number(p)).filter(Number.isFinite);
      if (!group || vals.length === 0) continue;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group)!.push(...vals);
      count += vals.length;
    }
    return Array.from(groups.entries()).map(([name, values]) => ({
      name,
      ...stats(values),
    }));
  }

  // Multi-column numeric: one box per column (header row optional).
  const hasHeader = lines[0]!.split(sep).some((t) => !Number.isFinite(Number(t)));
  const header = hasHeader ? lines[0]!.split(sep).map((t) => t.trim()) : null;
  const dataStart = hasHeader ? 1 : 0;
  const columns: number[][] = [];
  for (let i = dataStart; i < lines.length; i += 1) {
    const nums = lines[i]!.split(sep).map((p) => Number(p));
    if (nums.some((n) => !Number.isFinite(n))) continue;
    for (let c = 0; c < nums.length; c += 1) {
      (columns[c] ??= []).push(nums[c]!);
    }
  }
  return columns
    .filter((c) => c.length > 0)
    .map((values, i) => ({
      name: header?.[i] ?? `col${i + 1}`,
      ...stats(values),
    }));
}

function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

export default function createBoxPlotPlugin(): Plugin {
  return new BoxPlotPlugin();
}
