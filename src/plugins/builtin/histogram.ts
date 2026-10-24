// ==========================================================================
// Example plugin: Histogram
// Reads a 1-D numeric series from text (.csv/.dat/.json/.txt) and renders a
// histogram with configurable bin count, log scale and palette.
// ==========================================================================

import type {
  ParamDefinition,
  Plugin,
  PluginApi,
  ContainerCapabilities,
  ComputeProgress,
  ComputeResult,
} from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportRowsCsv,
} from '@/core/plugin-tools/enhance';
import { setScienceOutputs, clearScienceOutputs, fmtMetric, type ScienceMetric } from '@/core/research/scienceOutput';
import {
  meanOf, sdOf, skewnessOf, excessKurtosisOf, sturgesK, freedmanDiaconisW, silvermanBw, bi,
} from './chartStats';

export { histogramManifest } from './histogramManifest';
import { histogramManifest } from './histogramManifest';

type BinRule = 'manual' | 'sturges' | 'fd';

interface State {
  values: number[];
  bins: number;
  binRule: BinRule;
  palette: string;
  log: boolean;
  density: boolean;
  cumulative: boolean;
  showKde: boolean;
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
  private state: State = { values: [], bins: 30, binRule: 'manual', palette: 'teal', log: false, density: false, cumulative: false, showKde: false };

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.ctx = null;
    clearScienceOutputs(this.manifest.id);
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
    let statsChanged = false;
    if (typeof params.bins === 'number') {
      const bins = Math.max(5, Math.min(100, Math.round(params.bins)));
      if (bins !== this.state.bins) {
        this.state.bins = bins;
        statsChanged = true;
      }
    }
    if (params.binRule === 'manual' || params.binRule === 'sturges' || params.binRule === 'fd') {
      if (params.binRule !== this.state.binRule) {
        this.state.binRule = params.binRule;
        statsChanged = true;
      }
    }
    if (typeof params.palette === 'string') this.state.palette = params.palette;
    if (typeof params.log === 'boolean') this.state.log = params.log;
    if (typeof params.density === 'boolean') this.state.density = params.density;
    if (typeof params.cumulative === 'boolean') this.state.cumulative = params.cumulative;
    if (typeof params.showKde === 'boolean') {
      if (params.showKde !== this.state.showKde) {
        this.state.showKde = params.showKde;
        statsChanged = true;
      }
    }

    if (actionFired(params, 'exportCsv')) this.exportCsv();
    this.draw();
    if (statsChanged) this.publishStats();
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
      {
        key: 'binRule',
        label: 'Bin Rule',
        labelI18n: { 'zh-CN': '分箱规则', 'en-US': 'Bin Rule' },
        type: 'select',
        value: this.state.binRule,
        options: [
          { value: 'manual', label: 'Manual (slider)', labelI18n: { 'zh-CN': '手动（滑块）', 'en-US': 'Manual (slider)' } },
          { value: 'sturges', label: 'Sturges', labelI18n: { 'zh-CN': 'Sturges', 'en-US': 'Sturges' } },
          { value: 'fd', label: 'Freedman–Diaconis', labelI18n: { 'zh-CN': 'Freedman–Diaconis', 'en-US': 'Freedman–Diaconis' } },
        ],
      },
      { key: 'log', label: 'Log scale', type: 'checkbox', value: this.state.log },
      {
        key: 'density',
        label: 'Density',
        labelI18n: { 'zh-CN': '密度', 'en-US': 'Density' },
        type: 'checkbox',
        value: this.state.density,
      },
      {
        key: 'cumulative',
        label: 'Cumulative',
        labelI18n: { 'zh-CN': '累积分布', 'en-US': 'Cumulative' },
        type: 'checkbox',
        value: this.state.cumulative,
      },
      {
        key: 'showKde',
        label: 'KDE Overlay',
        labelI18n: { 'zh-CN': 'KDE 叠加', 'en-US': 'KDE Overlay' },
        hint: this.api?.locale.startsWith('zh')
          ? '高斯核密度估计，Silverman 带宽'
          : 'Gaussian KDE with Silverman bandwidth',
        type: 'checkbox',
        value: this.state.showKde,
      },
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
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
    this.publishStats();
  }

  /**
   * Publish the distribution summary: n / mean / sd / skewness / excess
   * kurtosis, the actually used bin count + rule, and the Sturges and
   * Freedman–Diaconis candidates side by side; plus the Silverman KDE
   * bandwidth when the overlay is on.
   */
  private publishStats() {
    const values = this.state.values;
    if (values.length === 0) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const metrics: ScienceMetric[] = [];
    const n = values.length;
    metrics.push({ key: 'n', label: 'n', value: String(n), severity: 'info' });
    metrics.push({
      key: 'mean',
      label: 'μ',
      value: fmtMetric(meanOf(values)),
      severity: 'info',
      hint: bi(this.api, 'Sample mean.', '样本均值。'),
    });
    metrics.push({
      key: 'sd',
      label: 's',
      value: fmtMetric(sdOf(values)),
      severity: 'info',
      hint: bi(this.api, 'Sample standard deviation (n−1).', '样本标准差（n−1）。'),
    });
    const skew = skewnessOf(values);
    if (Number.isFinite(skew)) {
      metrics.push({
        key: 'skew',
        label: 'g1',
        value: fmtMetric(skew),
        severity: 'info',
        hint: bi(this.api, 'Fisher–Pearson standardized skewness (normal ≡ 0).', 'Fisher–Pearson 标准化偏度（正态为 0）。'),
      });
    }
    const kurt = excessKurtosisOf(values);
    if (Number.isFinite(kurt)) {
      metrics.push({
        key: 'kurt',
        label: 'g2',
        value: fmtMetric(kurt),
        severity: 'info',
        hint: bi(this.api, 'Excess kurtosis (normal ≡ 0).', '超额峰度（正态为 0）。'),
      });
    }
    const kSturges = sturgesK(n);
    metrics.push({
      key: 'kSturges',
      label: 'k(S)',
      value: String(kSturges),
      severity: 'info',
      hint: bi(this.api, "Sturges' rule bin count 1+⌈log2(n)⌉.", 'Sturges 规则分箱数 1+⌈log₂(n)⌉。'),
    });
    const wFd = freedmanDiaconisW([...values].sort((a, b) => a - b));
    if (wFd !== null) {
      metrics.push({
        key: 'wFD',
        label: 'w(FD)',
        value: fmtMetric(wFd),
        severity: 'info',
        hint: bi(this.api, 'Freedman–Diaconis bin width 2·IQR/n^(1/3).', 'Freedman–Diaconis 箱宽 2·IQR/n^(1/3)。'),
      });
    }
    const built = this.buildBins();
    if (built) {
      metrics.push({
        key: 'bins',
        label: 'bins',
        value: `${built.counts.length}·${built.rule}`,
        severity: 'info',
        hint: bi(this.api, 'Bin count actually drawn and the rule that chose it.', '实际绘制的分箱数及所选规则。'),
      });
    }
    if (this.state.showKde) {
      const h = silvermanBw(values);
      if (h > 0) {
        metrics.push({
          key: 'hKde',
          label: 'h(KDE)',
          value: fmtMetric(h),
          severity: 'info',
          hint: bi(this.api, 'Silverman bandwidth 0.9·min(s, IQR/1.34)·n^(−1/5).', 'Silverman 带宽 0.9·min(s, IQR/1.34)·n^(−1/5)。'),
        });
      }
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  async compute(_input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    const total = 8;
    for (let i = 0; i < total; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      onProgress?.({ done: i + 1, total });
    }
    if (this.state.values.length === 0) return { ok: false, error: 'no data' };
    const sum = this.state.values.reduce((a, b) => a + b, 0);
    // Iterate instead of Math.min(...array): spreading a large array throws
    // RangeError (maximum call stack size exceeded).
    let min = Infinity;
    let max = -Infinity;
    for (const v of this.state.values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return {
      ok: true,
      output: {
        count: this.state.values.length,
        min,
        max,
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
      clearScienceOutputs(this.manifest.id);
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
    const built = this.buildBins();
    if (!built) return;
    const { min: binMin, binW, counts } = built;
    const bins = counts.length;
    const total = values.length;
    let maxCount = 1;
    let maxDensity = 1e-12;
    for (const c of counts) {
      if (c > maxCount) maxCount = c;
      const d = c / (total * binW);
      if (d > maxDensity) maxDensity = d;
    }

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
    const barHeight = (c: number): number => {
      if (this.state.density) {
        return (c / (total * binW) / maxDensity) * plotH;
      }
      return this.state.log
        ? (Math.log2(c + 1) / Math.log2(maxCount + 1)) * plotH
        : (c / maxCount) * plotH;
    };
    for (let i = 0; i < bins; i += 1) {
      const c = counts[i]!;
      const h = barHeight(c);
      if (h <= 0) continue;
      const x = padL + i * barW;
      g.fillStyle = i % 2 === 0 ? color : this.shade(color, 0.82);
      g.fillRect(x + 1, canvas.height - padB - h, Math.max(1, barW - 2), h);
    }

    // Optional Gaussian KDE overlay (Silverman bandwidth). Skipped on the
    // log axis, where a density curve would be meaningless.
    if (this.state.showKde && !this.state.log) {
      const h = silvermanBw(values);
      if (h > 0) {
        const spanAll = binW * bins;
        const steps = 120;
        g.strokeStyle = '#a78bfa';
        g.lineWidth = 1.5;
        g.beginPath();
        for (let s = 0; s <= steps; s += 1) {
          const x = binMin + (spanAll * s) / steps;
          let d = 0;
          for (const v of values) {
            const u = (x - v) / h;
            d += Math.exp(-0.5 * u * u);
          }
          d /= total * h;
          const frac = this.state.density
            ? d / maxDensity
            : (d * total * binW) / maxCount;
          const xPix = padL + ((x - binMin) / spanAll) * plotW;
          const yPix = canvas.height - padB - Math.max(0, frac) * plotH;
          if (s === 0) g.moveTo(xPix, yPix);
          else g.lineTo(xPix, yPix);
        }
        g.stroke();
        g.lineWidth = 1;
      }
    }

    // Cumulative-frequency polyline (fraction of samples <= bin end).
    if (this.state.cumulative) {
      g.strokeStyle = '#fbbf24';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(padL, canvas.height - padB);
      let cum = 0;
      for (let i = 0; i < bins; i += 1) {
        cum += counts[i]!;
        const x = padL + (i + 1) * barW;
        const y = canvas.height - padB - (cum / total) * plotH;
        g.lineTo(x, y);
      }
      g.stroke();
      g.lineWidth = 1;
    }

    // count label
    g.textAlign = 'left';
    g.font = `11px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(200, 214, 228, 0.85)';
    g.fillText(`${values.length} samples`, padL + 2, canvas.height - 5);
  }

  /** Bin the loaded values; null when there is no data. */
  private buildBins(): { min: number; binW: number; counts: number[]; rule: BinRule } | null {
    const values = this.state.values;
    if (values.length === 0) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const span = max - min || 1;
    let bins = Math.max(2, Math.round(this.state.bins));
    let rule: BinRule = 'manual';
    if (this.state.binRule === 'sturges') {
      bins = sturgesK(values.length);
      rule = 'sturges';
    } else if (this.state.binRule === 'fd') {
      const sorted = [...values].sort((a, b) => a - b);
      const w = freedmanDiaconisW(sorted);
      if (w !== null) {
        // Clamp so a pathological IQR cannot request a absurd bin count.
        bins = Math.max(2, Math.min(200, Math.ceil(span / w)));
        rule = 'fd';
      } else {
        // Zero-IQR data has no FD width — fall back to Sturges honestly.
        bins = sturgesK(values.length);
        rule = 'sturges';
      }
    }
    const counts = new Array<number>(bins).fill(0);
    for (const v of values) {
      let idx = Math.floor(((v - min) / span) * bins);
      if (idx === bins) idx = bins - 1;
      counts[idx]! += 1;
    }
    return { min, binW: span / bins, counts, rule };
  }

  private exportCsv() {
    const built = this.buildBins();
    if (!built) {
      exportRowsCsv(this.api, 'histogram', [], []);
      return;
    }
    const { min, binW, counts } = built;
    const total = this.state.values.length;
    const withDensity = this.state.density;
    const header = withDensity
      ? ['binStart', 'binEnd', 'count', 'density']
      : ['binStart', 'binEnd', 'count'];
    const rows: Array<Array<number>> = counts.map((c, i) => {
      const start = min + i * binW;
      const end = start + binW;
      return withDensity ? [start, end, c, c / (total * binW)] : [start, end, c];
    });
    exportRowsCsv(this.api, 'histogram', header, rows);
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