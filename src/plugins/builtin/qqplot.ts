// ==========================================================================
// Example plugin: QQ Plot (分位数-分位数图)
//
// Compares a single numeric sample column against the standard normal
// distribution. Points along the reference diagonal mean the sample is
// approximately normally distributed.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  ContainerCapabilities,
} from '@/types/plugin';

export const qqplotManifest: PluginManifest = {
  id: 'example.qqplot',
  name: 'QQ Plot',
  nameI18n: { 'zh-CN': 'QQ 图（正态检验）', 'en-US': 'QQ Plot' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Sample quantiles vs normal quantiles with reference line.',
  descriptionI18n: {
    'zh-CN': '样本分位数与标准正态分位数对比，偏离对角线表示非正态。',
    'en-US': 'Sample quantiles vs standard-normal quantiles; deviation from the diagonal signals non-normality.',
  },
  license: 'MIT',
  entry: 'example.qqplot',
  category: 'scientific',
  icon: '↗',
  formats: [
    { extension: '.csv', mimeTypes: ['text/csv', 'text/plain'], description: 'CSV (single numeric column)' },
    { extension: '.dat', mimeTypes: ['application/octet-stream'], description: 'Raw data' },
    { extension: '.txt', mimeTypes: ['text/plain'], description: 'Text' },
  ],
};

interface State {
  showRef: boolean;
  hasData: boolean;
}

const MAX_POINTS = 20_000;

export class QQPlotPlugin implements Plugin {
  readonly manifest = qqplotManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private quantiles: number[] = [];
  private mean = 0;
  private std = 1;
  private state: State = { showRef: true, hasData: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    this.quantiles = [];
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
    if (typeof params.showRef === 'boolean') this.state.showRef = params.showRef;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'showRef',
        label: 'Reference line',
        labelI18n: { 'zh-CN': '参考线', 'en-US': 'Reference line' },
        type: 'checkbox',
        value: this.state.showRef,
      },
    ];
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const values = parseNumericColumn(text);
    if (values.length < 4) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '需要至少 4 个数值'
          : 'Need at least 4 numeric values',
      );
      return;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    // Downsample for very large inputs.
    const step = Math.max(1, Math.floor(n / MAX_POINTS));
    const sampled: number[] = [];
    for (let i = 0; i < n; i += step) sampled.push(sorted[i]!);
    const mean = sampled.reduce((s, v) => s + v, 0) / sampled.length;
    const variance = sampled.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, sampled.length - 1);
    const std = Math.sqrt(variance) || 1;
    this.quantiles = sampled;
    this.mean = mean;
    this.std = std;
    this.state.hasData = true;
    this.api.reportDataScale(sampled.length);
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

    if (!this.state.hasData || this.quantiles.length === 0) {
      this.drawEmpty(g, w, h);
      return;
    }

    const margin = { left: 52, right: 16, top: 16, bottom: 40 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;
    const font = `10px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;

    const n = this.quantiles.length;
    // Sample quantiles at probability p = (i + 0.5) / n.
    const theoretical: number[] = [];
    for (let i = 0; i < n; i += 1) theoretical.push(probit((i + 0.5) / n));

    let tMin = Infinity, tMax = -Infinity;
    let sMin = Infinity, sMax = -Infinity;
    for (let i = 0; i < n; i += 1) {
      const t = theoretical[i]!;
      const s = (this.quantiles[i]! - this.mean) / this.std;
      if (t < tMin) tMin = t;
      if (t > tMax) tMax = t;
      if (s < sMin) sMin = s;
      if (s > sMax) sMax = s;
    }
    // Symmetric axis around 0 for the theoretical side.
    const tSpan = Math.max(3, tMax - tMin);
    tMin = -tSpan / 2;
    tMax = tSpan / 2;
    const pad = (sMax - sMin) * 0.05 || 1;
    sMin -= pad;
    sMax += pad;

    const px = (v: number) => margin.left + ((v - tMin) / (tMax - tMin)) * plotW;
    const py = (v: number) => margin.top + (1 - (v - sMin) / (sMax - sMin)) * plotH;

    // Grid + labels.
    g.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    g.lineWidth = 1;
    g.fillStyle = 'rgba(148, 163, 184, 0.7)';
    g.font = font;
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k += 1) {
      const t = k / 4;
      const sv = sMin + (sMax - sMin) * t;
      const y = py(sv);
      g.beginPath();
      g.moveTo(margin.left, y);
      g.lineTo(w - margin.right, y);
      g.stroke();
      g.fillText(short(sv), margin.left - 6, y + 3);
    }
    g.textAlign = 'center';
    for (let k = 0; k <= 4; k += 1) {
      const t = k / 4;
      const tv = tMin + (tMax - tMin) * t;
      const x = px(tv);
      g.fillText(short(tv), x, h - margin.bottom + 16);
    }

    // Reference line: through the Q1/Q3 points (robust to outliers).
    if (this.state.showRef) {
      const q = (p: number) => {
        const idx = (n - 1) * p;
        const lo = Math.floor(idx);
        const hi = Math.ceil(idx);
        const a = this.quantiles[lo]!;
        const b = this.quantiles[hi]!;
        return (a + b) / 2;
      };
      const q1 = q(0.25);
      const q3 = q(0.75);
      const t1 = probit(0.25);
      const t3 = probit(0.75);
      const slope = (q3 - q1) / (t3 - t1);
      const intercept = q1 - slope * t1;
      const yAt = (t: number) => py((intercept + slope * t - this.mean) / this.std);
      g.strokeStyle = 'rgba(251, 191, 36, 0.65)';
      g.lineWidth = 1.5;
      g.setLineDash([6, 4]);
      g.beginPath();
      g.moveTo(px(tMin), yAt(tMin));
      g.lineTo(px(tMax), yAt(tMax));
      g.stroke();
      g.setLineDash([]);
    }

    // Points.
    g.fillStyle = '#60a5fa';
    const r = Math.max(1.5, Math.min(3, Math.sqrt(plotW * plotH) / 220));
    for (let i = 0; i < n; i += 1) {
      const x = px(theoretical[i]!);
      const y = py((this.quantiles[i]! - this.mean) / this.std);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }

  private drawEmpty(g: CanvasRenderingContext2D, w: number, h: number) {
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    const msg =
      this.api.locale === 'zh-CN'
        ? '未加载 QQ 图数据 — 拖入单列数值文件'
        : 'No QQ data — drop a single-column numeric file';
    g.fillText(msg, w / 2, h / 2);
  }
}

/** Read one numeric column from CSV / whitespace text (header tolerated). */
export function parseNumericColumn(text: string): number[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  const out: number[] = [];
  for (const line of lines) {
    const parts = line.split(/[\s,]+/);
    for (const p of parts) {
      const v = Number(p);
      if (Number.isFinite(v)) out.push(v);
    }
  }
  return out;
}

/** Inverse standard-normal CDF (Acklam's rational approximation). */
export function probit(p: number): number {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const plow = 0.02425;
  const phigh = 1 - plow;

  let q: number;
  let r: number;
  let x: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  } else if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    x = (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  return x;
}

function short(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return v.toFixed(1);
  return v.toFixed(2);
}

export default function createQQPlotPlugin(): Plugin {
  return new QQPlotPlugin();
}
