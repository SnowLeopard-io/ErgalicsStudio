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
  ContainerCapabilities,
  ComputeProgress,
  ComputeResult,
} from '@/types/plugin';

import { setScienceOutputs, clearScienceOutputs, fmtMetric, type ScienceMetric } from '@/core/research/scienceOutput';
import { olsTrend, mannKendall, lag1Autocorr, bi, pm, fmtP } from './chartStats';

export { timeSeriesManifest } from './timeSeriesManifest';
import { timeSeriesManifest } from './timeSeriesManifest';

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
  rollWindow: number;
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
    rollWindow: 0,
  };

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
    if (typeof params.palette === 'string') this.state.palette = params.palette;
    if (typeof params.width === 'number') this.state.width = params.width;
    if (typeof params.grid === 'boolean') this.state.grid = params.grid;
    if (typeof params.normalize === 'boolean') this.state.normalize = params.normalize;
    if (typeof params.selected === 'string') {
      const changed = params.selected !== this.state.selected;
      this.state.selected = params.selected;
      // The published statistics follow the visible series.
      if (changed) this.publishStats();
    }
    if (typeof params.rollWindow === 'number') {
      this.state.rollWindow = Math.max(0, Math.min(40, Math.round(params.rollWindow)));
    }

    this.draw();
  }

  getParams(): ParamDefinition[] {
    const zh = this.api?.locale === 'zh-CN';
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
      { key: 'width', label: 'Width', labelI18n: { 'zh-CN': '线宽', 'en-US': 'Width' }, type: 'range', min: 1, max: 4, step: 0.5, value: this.state.width },
      { key: 'grid', label: 'Grid', labelI18n: { 'zh-CN': '网格线', 'en-US': 'Grid' }, type: 'checkbox', value: this.state.grid },
      { key: 'normalize', label: 'Normalize', labelI18n: { 'zh-CN': '归一化', 'en-US': 'Normalize' }, type: 'checkbox', value: this.state.normalize },
      {
        key: 'rollWindow',
        label: 'Rolling Mean',
        labelI18n: { 'zh-CN': '移动平均', 'en-US': 'Rolling Mean' },
        hint: zh ? '0 = 关闭' : '0 = off',
        type: 'range',
        min: 0,
        max: 40,
        step: 1,
        value: this.state.rollWindow,
      },
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
    this.publishStats();
  }

  /**
   * Publish trend statistics for the visible series: OLS slope ± SE,
   * Mann-Kendall S / var(S) / two-sided p (tie-corrected), lag-1
   * autocorrelation, n. With a single visible series every statistic is
   * published; with several, one slope/p row per series (capped at 5).
   * Mann-Kendall is O(n²) and skipped for series longer than 5000 points.
   */
  private publishStats() {
    const visible = this.visibleSeries();
    if (visible.length === 0) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const metrics: ScienceMetric[] = [];
    const detail = visible.length === 1;
    const cap = detail ? 1 : 5;
    let nTotal = 0;
    for (const c of visible) nTotal += c.values.length;
    let published = 0;
    for (const c of visible) {
      if (published >= cap) break;
      published += 1;
      const shortName = c.name.length > 12 ? `${c.name.slice(0, 12)}…` : c.name;
      const trend = olsTrend(c.values);
      if (trend) {
        metrics.push({
          key: `trend:${c.name}`,
          label: detail ? 'slope' : `slope:${shortName}`,
          value: pm(trend.slope, trend.se),
          severity: 'info',
          hint: bi(this.api, 'OLS slope of the series against index t (±1 SE).', '序列对索引 t 的 OLS 斜率（±1 标准误）。'),
        });
        if (detail) {
          metrics.push({
            key: `ptrend:${c.name}`,
            label: 'p(slope)',
            value: fmtP(trend.p),
            severity: 'info',
            hint: bi(this.api, 'Two-sided p for zero OLS slope (t, df = n−2).', 'OLS 斜率为零的双侧 p 值（t 分布，df = n−2）。'),
          });
        }
      }
      const mk = c.values.length <= 5000 ? mannKendall(c.values) : null;
      if (mk) {
        if (detail) {
          metrics.push({
            key: `s:${c.name}`,
            label: 'S',
            value: fmtMetric(mk.s),
            severity: 'info',
            hint: bi(this.api, 'Mann-Kendall S statistic (sum of pairwise signs).', 'Mann-Kendall S 统计量（成对符号之和）。'),
          });
          metrics.push({
            key: `varS:${c.name}`,
            label: 'var(S)',
            value: fmtMetric(mk.varS),
            severity: 'info',
            hint: bi(this.api, 'Mann-Kendall variance with tie correction.', '经结修正的 Mann-Kendall 方差。'),
          });
        }
        metrics.push({
          key: `mkp:${c.name}`,
          label: detail ? 'p(MK)' : `p(MK):${shortName}`,
          value: fmtP(mk.p),
          severity: 'info',
          hint: bi(this.api, 'Two-sided Mann-Kendall trend p (normal approx with continuity correction).', 'Mann-Kendall 趋势双侧 p 值（正态近似，含连续性校正）。'),
        });
      }
      if (detail) {
        const rho1 = lag1Autocorr(c.values);
        if (rho1 !== null) {
          metrics.push({
            key: `rho1:${c.name}`,
            label: 'ρ₁',
            value: fmtMetric(rho1),
            severity: 'info',
            hint: bi(this.api, 'Lag-1 autocorrelation (persistence indicator).', '滞后 1 阶自相关（持续性指标）。'),
          });
        }
      }
    }
    metrics.push({ key: 'n', label: 'n', value: String(nTotal), severity: 'info' });
    setScienceOutputs(this.manifest.id, metrics);
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
      clearScienceOutputs(this.manifest.id);
      this.drawHint(g, canvas);
      return;
    }

    const visible = this.visibleSeries();
    if (visible.length === 0) {
      clearScienceOutputs(this.manifest.id);
      this.drawHint(g, canvas);
      return;
    }

    // The Normalize toggle was previously stored but never applied — every
    // series was drawn at its raw magnitude, so toggling did nothing. When
    // enabled, map each series to its own [0, 1] range so series with wildly
    // different scales become comparable.
    let series: SeriesCol[] = visible;
    if (this.state.normalize) {
      series = visible.map((s) => {
        let mn = Infinity;
        let mx = -Infinity;
        for (const v of s.values) {
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
        const span = mx - mn || 1;
        return { name: s.name, values: s.values.map((v) => (v - mn) / span) };
      });
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

    // Optional rolling-mean overlay (trailing window; 0/1 = off).
    if (this.state.rollWindow > 1) {
      const w = this.state.rollWindow;
      g.setLineDash([5, 3]);
      g.lineWidth = this.state.width + 0.5;
      for (let s = 0; s < series.length; s += 1) {
        const col = series[s]!;
        const color = colors[s % colors.length] ?? '#2dd4bf';
        g.strokeStyle = color;
        g.beginPath();
        let sum = 0;
        col.values.forEach((v, i) => {
          sum += v;
          if (i >= w) sum -= col.values[i - w]!;
          const m = i < w - 1 ? sum / (i + 1) : sum / w;
          const x = toX(i);
          const y = toY(m);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        });
        g.stroke();
      }
      g.setLineDash([]);
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