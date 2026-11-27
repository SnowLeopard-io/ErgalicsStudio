// ==========================================================================
// stats-conformal — split conformal prediction lab
//
// Three linked views: prediction intervals over the data (conformal band vs
// the Gaussian ±z·σ̂ band), the coverage-vs-nominal calibration curve, and the
// calibration score histogram with the conformal quantile marked.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@ergalics/plugin-sdk';
import { actionButton, actionFired, exportRowsCsv, notify } from '@ergalics/plugin-sdk/tools';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@ergalics/plugin-sdk/bridges';
import { statsConformalManifest } from './manifest';
import {
  runConformal,
  type ConformalConfig,
  type ConformalResult,
  type DatasetKind,
  type Pt,
  type ScoreMethod,
} from './kernel';

export { statsConformalManifest } from './manifest';

type View = 'intervals' | 'coverage' | 'scores';

interface State {
  kind: DatasetKind;
  n: number;
  noise: number;
  degree: number;
  alpha: number;
  method: ScoreMethod;
  seed: number;
  view: View;
}

const PAD = { l: 64, r: 20, t: 36, b: 42 };

export class ConformalPlugin implements Plugin {
  readonly manifest = statsConformalManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    kind: 'hetero',
    n: 1500,
    noise: 0.22,
    degree: 4,
    alpha: 0.1,
    method: 'normalized',
    seed: 42,
    view: 'intervals',
  };
  private result: ConformalResult | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    if (!this.result) this.run();
    else this.draw();
  }

  // ---- params --------------------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    return [
      actionButton('run', 'Recompute', '重新计算', 'primary'),
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        value: s.view,
        options: [
          { value: 'intervals', label: 'Intervals', labelI18n: { 'zh-CN': '预测区间', 'en-US': 'Intervals' } },
          { value: 'coverage', label: 'Coverage curve', labelI18n: { 'zh-CN': '覆盖率曲线', 'en-US': 'Coverage curve' } },
          { value: 'scores', label: 'Score distribution', labelI18n: { 'zh-CN': '分数分布', 'en-US': 'Score distribution' } },
        ],
      },
      {
        key: 'kind',
        label: 'Noise model',
        labelI18n: { 'zh-CN': '噪声模型', 'en-US': 'Noise model' },
        type: 'select',
        value: s.kind,
        options: [
          { value: 'hetero', label: 'Heteroscedastic', labelI18n: { 'zh-CN': '异方差', 'en-US': 'Heteroscedastic' } },
          { value: 'homo', label: 'Homoscedastic', labelI18n: { 'zh-CN': '同方差', 'en-US': 'Homoscedastic' } },
          { value: 'skewed', label: 'Skewed (exponential)', labelI18n: { 'zh-CN': '偏态（指数）', 'en-US': 'Skewed (exponential)' } },
        ],
      },
      {
        key: 'method',
        label: 'Score',
        labelI18n: { 'zh-CN': '非一致性分数', 'en-US': 'Score' },
        type: 'select',
        value: s.method,
        options: [
          { value: 'absolute', label: '|y − ŷ|', labelI18n: { 'zh-CN': '|y − ŷ|（绝对）', 'en-US': '|y − ŷ| (absolute)' } },
          { value: 'normalized', label: '|y − ŷ| / σ̂(x)', labelI18n: { 'zh-CN': '|y − ŷ| / σ̂(x)（归一化）', 'en-US': '|y − ŷ| / σ̂(x) (normalised)' } },
        ],
      },
      {
        key: 'alpha',
        label: 'Miscoverage α',
        labelI18n: { 'zh-CN': '误覆盖率 α', 'en-US': 'Miscoverage α' },
        type: 'range',
        min: 0.02,
        max: 0.4,
        step: 0.01,
        value: s.alpha,
        hint: this.zh
          ? '目标覆盖率 = 1 − α；分裂共形给出边际有限样本保证。'
          : 'Target coverage = 1 − α; split conformal gives a marginal finite-sample guarantee.',
      },
      {
        key: 'degree',
        label: 'Polynomial degree',
        labelI18n: { 'zh-CN': '多项式阶数', 'en-US': 'Polynomial degree' },
        type: 'range',
        min: 1,
        max: 9,
        step: 1,
        value: s.degree,
      },
      {
        key: 'n',
        label: 'Samples N',
        labelI18n: { 'zh-CN': '样本数 N', 'en-US': 'Samples N' },
        type: 'number',
        value: s.n,
      },
      {
        key: 'noise',
        label: 'Noise level',
        labelI18n: { 'zh-CN': '噪声强度', 'en-US': 'Noise level' },
        type: 'range',
        min: 0.02,
        max: 0.6,
        step: 0.02,
        value: s.noise,
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Seed' },
        type: 'number',
        value: s.seed,
      },
      actionButton('exportCsv', 'Export intervals CSV', '导出区间 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (actionFired(params, 'run')) {
      this.run();
      return;
    }
    let dirty = false;
    if (typeof params.view === 'string') {
      s.view = params.view as View;
      this.draw();
      return;
    }
    if (typeof params.kind === 'string') {
      s.kind = params.kind as DatasetKind;
      dirty = true;
    }
    if (typeof params.method === 'string') {
      s.method = params.method as ScoreMethod;
      dirty = true;
    }
    if (typeof params.alpha === 'number') {
      s.alpha = Math.min(0.4, Math.max(0.02, params.alpha));
      dirty = true;
    }
    if (typeof params.degree === 'number') {
      s.degree = clampRound(params.degree, 1, 9, 1);
      dirty = true;
    }
    if (typeof params.n === 'number') {
      s.n = Math.min(2000, Math.max(60, Math.round(params.n)));
      dirty = true;
    }
    if (typeof params.noise === 'number') {
      s.noise = Math.min(0.6, Math.max(0.02, params.noise));
      dirty = true;
    }
    if (typeof params.seed === 'number') {
      s.seed = Math.round(params.seed);
      dirty = true;
    }
    if (dirty) this.run();
  }

  // ---- compute -------------------------------------------------------------

  private config(): ConformalConfig {
    const s = this.state;
    return {
      kind: s.kind,
      n: s.n,
      noise: s.noise,
      degree: s.degree,
      alpha: s.alpha,
      method: s.method,
      seed: s.seed,
    };
  }

  private run(): void {
    try {
      this.result = runConformal(this.config());
      this.publishMetrics(this.result);
      if (!Number.isFinite(this.result.qhat)) {
        notify(
          this.api,
          'warning',
          'Calibration split too small for this alpha: no finite interval exists.',
          '校准集相对该 α 过小：不存在有限区间（共形分位数趋于无穷）。',
        );
      }
    } catch (e) {
      this.result = null;
      this.api.notify('error', e instanceof Error ? e.message : String(e));
      clearScienceOutputs(this.manifest.id);
    }
    this.draw();
  }

  async compute(_input: unknown) {
    if (!this.result) this.run();
    const r = this.result;
    if (!r) return { ok: false, error: 'compute failed' };
    return {
      ok: true,
      output: {
        coverage: r.coverage,
        target: r.target,
        coverageGaussian: r.coverageNaive,
        meanWidth: r.meanWidth,
        meanWidthGaussian: r.meanWidthNaive,
        qhat: r.qhat,
        nCal: r.nCal,
      },
      metrics: { bytes: r.nCal * 8 },
    };
  }

  private publishMetrics(r: ConformalResult): void {
    const zh = this.zh;
    const gap = r.coverage - r.target;
    const metrics: ScienceMetric[] = [
      {
        key: 'cov',
        label: zh ? '实测覆盖率' : 'Coverage',
        value: `${(r.coverage * 100).toFixed(1)}% / ${(r.target * 100).toFixed(0)}%`,
        severity: Math.abs(gap) < 0.03 ? 'ok' : Math.abs(gap) < 0.07 ? 'warn' : 'error',
        hint: zh ? '测试集实测覆盖 / 目标覆盖（1−α）' : 'test coverage / target (1-alpha)',
      },
      {
        key: 'covGauss',
        label: zh ? '高斯区间覆盖率' : 'Gaussian coverage',
        value: `${(r.coverageNaive * 100).toFixed(1)}%`,
        severity: r.coverageNaive >= r.target - 0.04 ? 'ok' : 'error',
      },
      {
        key: 'covTercile',
        label: zh ? '共形低/高 x 覆盖' : 'Conformal low/high-x',
        value: `${(r.covLow * 100).toFixed(0)}% / ${(r.covHigh * 100).toFixed(0)}%`,
        hint: zh ? 'x 低/高三分位上的条件覆盖率' : 'conditional coverage in the low/high x terciles',
      },
      {
        key: 'covTercileGauss',
        label: zh ? '高斯低/高 x 覆盖' : 'Gaussian low/high-x',
        value: `${(r.covLowNaive * 100).toFixed(0)}% / ${(r.covHighNaive * 100).toFixed(0)}%`,
        severity: r.covHighNaive >= r.target - 0.1 ? 'ok' : 'error',
        hint: zh
          ? '单一全局 σ̂ 使高方差一端欠覆盖'
          : 'a single global σ̂ under-covers the high-variance tail',
      },
      { key: 'q', label: zh ? '共形分位数 q̂' : 'Conformal q̂', value: fmtMetric(r.qhat) },
      { key: 'width', label: zh ? '平均区间宽度' : 'Mean width', value: fmtMetric(r.meanWidth) },
      { key: 'widthGauss', label: zh ? '高斯区间宽度' : 'Gaussian width', value: fmtMetric(r.meanWidthNaive) },
      { key: 'rmse', label: zh ? '测试 RMSE' : 'Test RMSE', value: fmtMetric(r.rmse) },
      { key: 'ncal', label: zh ? '校准集 n' : 'Calibration n', value: String(r.nCal) },
      { key: 'sigma', label: zh ? '训练残差 σ̂' : 'Train σ̂', value: fmtMetric(r.sigmaHat) },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private exportCsv(): void {
    const r = this.result;
    if (!r) {
      notify(this.api, 'warning', 'Compute the intervals first.', '请先计算区间。');
      return;
    }
    const header = ['split', 'x', 'y', 'y_hat', 'conformal_lo', 'conformal_hi', 'gaussian_lo', 'gaussian_hi'];
    const rows: Array<number | string>[] = [];
    const push = (split: string, pts: Pt[]) => {
      for (const p of pts) {
        const fit = nearest(r.fit, p.x);
        const band = nearest(r.band, p.x);
        const nb = nearest(r.naiveBand, p.x);
        rows.push([split, p.x, p.y, fit.y, band.lo, band.hi, nb.lo, nb.hi]);
      }
    };
    push('train', r.train);
    push('cal', r.cal);
    push('test', r.test);
    exportRowsCsv(this.api, 'conformal-intervals', header, rows);
  }

  // ---- drawing -------------------------------------------------------------

  private draw(): void {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 430;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (!this.result) return;
    const r = this.result;
    if (this.state.view === 'coverage') this.drawCoverage(g, canvas, r);
    else if (this.state.view === 'scores') this.drawScores(g, canvas, r);
    else this.drawIntervals(g, canvas, r);
  }

  private axes(
    g: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    title: string,
    xLabel: string,
    yLabel: string,
    xr: [number, number],
    yr: [number, number],
  ) {
    const pw = Math.max(40, canvas.width - PAD.l - PAD.r);
    const ph = Math.max(40, canvas.height - PAD.t - PAD.b);
    const x0 = PAD.l;
    const y0 = PAD.t;
    const tx = (x: number) => x0 + ((x - xr[0]) / (xr[1] - xr[0] || 1)) * pw;
    const ty = (y: number) => y0 + ph - ((y - yr[0]) / (yr[1] - yr[0] || 1)) * ph;

    g.textAlign = 'left';
    g.fillStyle = 'rgba(232,238,246,0.95)';
    g.font = `13px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(title, x0, 20);
    g.strokeStyle = 'rgba(120,135,155,0.55)';
    g.lineWidth = 1;
    g.strokeRect(x0, y0, pw, ph);

    g.font = `10px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    for (let i = 0; i <= 5; i += 1) {
      const f = i / 5;
      const yy = y0 + ph - f * ph;
      g.strokeStyle = 'rgba(120,135,155,0.16)';
      g.beginPath();
      g.moveTo(x0, yy);
      g.lineTo(x0 + pw, yy);
      g.stroke();
      g.fillStyle = 'rgba(168,182,200,0.9)';
      g.textAlign = 'right';
      g.fillText(fmtAxis(yr[0] + (yr[1] - yr[0]) * f), x0 - 8, yy + 3);
      g.textAlign = 'center';
      g.fillStyle = 'rgba(168,182,200,0.9)';
      g.fillText(fmtAxis(xr[0] + (xr[1] - xr[0]) * f), x0 + f * pw, y0 + ph + 15);
    }
    g.textAlign = 'center';
    g.fillStyle = 'rgba(168,182,200,0.85)';
    g.fillText(xLabel, x0 + pw / 2, y0 + ph + 32);
    g.save();
    g.translate(16, y0 + ph / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(yLabel, 0, 0);
    g.restore();
    return { x0, y0, pw, ph, tx, ty };
  }

  private drawIntervals(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, r: ConformalResult): void {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of [...r.train, ...r.test]) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
    const pad = (hi - lo) * 0.08 + 1e-6;
    const f = this.axes(
      g,
      canvas,
      this.zh
        ? `预测区间 · 覆盖 ${(r.coverage * 100).toFixed(1)}% / 目标 ${(r.target * 100).toFixed(0)}% · 高斯 ${(r.coverageNaive * 100).toFixed(1)}%`
        : `Intervals · coverage ${(r.coverage * 100).toFixed(1)}% / target ${(r.target * 100).toFixed(0)}% · Gaussian ${(r.coverageNaive * 100).toFixed(1)}%`,
      'x',
      'y',
      [0, 1],
      [lo - pad, hi + pad],
    );

    // Conformal band (filled) then Gaussian band edges (dashed). An infinite
    // q-hat (calibration split too small for alpha) means there is no finite
    // band to draw — the warning in run() carries that message.
    if (Number.isFinite(r.qhat)) {
      g.fillStyle = 'rgba(90,169,201,0.20)';
      g.beginPath();
      g.moveTo(f.tx(r.band[0]!.x), f.ty(r.band[0]!.hi));
      for (const b of r.band) g.lineTo(f.tx(b.x), f.ty(b.hi));
      for (let i = r.band.length - 1; i >= 0; i -= 1) {
        const b = r.band[i]!;
        g.lineTo(f.tx(b.x), f.ty(b.lo));
      }
      g.closePath();
      g.fill();
    }

    g.strokeStyle = 'rgba(221,127,87,0.85)';
    g.setLineDash([6, 4]);
    g.lineWidth = 1.2;
    for (const key of ['lo', 'hi'] as const) {
      g.beginPath();
      r.naiveBand.forEach((b, i) => (i === 0 ? g.moveTo(f.tx(b.x), f.ty(b[key])) : g.lineTo(f.tx(b.x), f.ty(b[key]))));
      g.stroke();
    }
    g.setLineDash([]);

    // Points by split; test points red when outside the conformal band.
    const scatter = (pts: Pt[], color: string, radius: number) => {
      g.fillStyle = color;
      for (const p of pts) {
        g.beginPath();
        g.arc(f.tx(p.x), f.ty(p.y), radius, 0, Math.PI * 2);
        g.fill();
      }
    };
    scatter(r.train, 'rgba(150,165,185,0.45)', 1.7);
    scatter(r.cal, 'rgba(226,176,74,0.55)', 2.0);
    for (const p of r.test) {
      const b = nearest(r.band, p.x);
      const covered = p.y >= b.lo && p.y <= b.hi;
      g.fillStyle = covered ? 'rgba(94,180,214,0.95)' : 'rgba(231,104,115,0.95)';
      g.beginPath();
      g.arc(f.tx(p.x), f.ty(p.y), 2.4, 0, Math.PI * 2);
      g.fill();
    }

    // Fitted curve on top.
    g.strokeStyle = 'rgba(232,238,246,0.95)';
    g.lineWidth = 1.6;
    g.beginPath();
    r.fit.forEach((p, i) => (i === 0 ? g.moveTo(f.tx(p.x), f.ty(p.y)) : g.lineTo(f.tx(p.x), f.ty(p.y))));
    g.stroke();

    this.legend(g, f.x0 + 8, f.y0 + 14, [
      ['rgba(232,238,246,0.95)', this.zh ? '拟合' : 'fit'],
      ['rgba(90,169,201,0.65)', this.zh ? '共形区间' : 'conformal band'],
      ['rgba(221,127,87,0.85)', this.zh ? '高斯 ±zσ̂' : 'Gaussian ±zσ̂'],
      ['rgba(231,104,115,0.95)', this.zh ? '未覆盖' : 'missed'],
    ]);
  }

  private drawCoverage(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, r: ConformalResult): void {
    const f = this.axes(
      g,
      canvas,
      this.zh ? '覆盖率 vs 名义水平（校准诊断）' : 'Coverage vs nominal level (calibration check)',
      this.zh ? '名义覆盖率 1−α' : 'nominal coverage 1−α',
      this.zh ? '实测覆盖率' : 'empirical coverage',
      [0.5, 1],
      [0.4, 1.02],
    );
    // Diagonal: perfect calibration.
    g.strokeStyle = 'rgba(160,176,196,0.6)';
    g.setLineDash([5, 5]);
    g.beginPath();
    g.moveTo(f.tx(0.5), f.ty(0.5));
    g.lineTo(f.tx(1), f.ty(1));
    g.stroke();
    g.setLineDash([]);

    const series: Array<['conformal' | 'naive', string]> = [
      ['conformal', '#5aa9c9'],
      ['naive', '#dd7f57'],
    ];
    for (const [key, color] of series) {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      r.sweep.forEach((s, i) => {
        const x = 1 - s.alpha;
        const y = s[key];
        if (i === 0) g.moveTo(f.tx(x), f.ty(y));
        else g.lineTo(f.tx(x), f.ty(y));
      });
      g.stroke();
      for (const s of r.sweep) {
        g.fillStyle = color;
        g.beginPath();
        g.arc(f.tx(1 - s.alpha), f.ty(s[key]), 2, 0, Math.PI * 2);
        g.fill();
      }
    }
    this.legend(g, f.x0 + 8, f.y0 + 14, [
      ['#5aa9c9', this.zh ? '分裂共形' : 'split conformal'],
      ['#dd7f57', this.zh ? '高斯区间' : 'Gaussian interval'],
      ['rgba(160,176,196,0.6)', this.zh ? '理想校准线' : 'ideal calibration'],
    ]);
  }

  private drawScores(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, r: ConformalResult): void {
    const scores = r.scores;
    const max = Math.max(...scores, r.qhat * 1.2 || 1);
    const bins = 26;
    const counts = new Array(bins).fill(0) as number[];
    for (const s of scores) {
      const k = Math.min(bins - 1, Math.floor((s / max) * bins));
      counts[k] = (counts[k] as number) + 1;
    }
    const peak = Math.max(1, ...counts);
    const f = this.axes(
      g,
      canvas,
      this.zh ? `校准分数分布 · q̂ = ${fmtMetric(r.qhat)}` : `Calibration scores · q̂ = ${fmtMetric(r.qhat)}`,
      this.zh ? '非一致性分数' : 'nonconformity score',
      this.zh ? '频数' : 'count',
      [0, max],
      [0, peak * 1.12],
    );
    const bw = f.pw / bins;
    for (let i = 0; i < bins; i += 1) {
      const h = ((counts[i] as number) / peak) * f.ph;
      g.fillStyle = i * (max / bins) <= r.qhat ? 'rgba(90,169,201,0.75)' : 'rgba(150,165,185,0.30)';
      g.fillRect(f.x0 + i * bw + 0.5, f.y0 + f.ph - h, Math.max(1, bw - 1), h);
    }
    g.strokeStyle = 'rgba(231,104,115,0.95)';
    g.lineWidth = 1.8;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(f.tx(r.qhat), f.y0);
    g.lineTo(f.tx(r.qhat), f.y0 + f.ph);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(231,104,115,0.95)';
    g.font = `11px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.fillText(`⌈(n+1)(1−α)⌉-th = ${fmtMetric(r.qhat)}`, f.tx(r.qhat) + 6, f.y0 + 14);
  }

  private legend(g: CanvasRenderingContext2D, x: number, y: number, items: Array<[string, string]>): void {
    g.font = `10px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    let lx = x;
    for (const [color, label] of items) {
      g.fillStyle = color;
      g.fillRect(lx, y - 8, 10, 10);
      g.fillStyle = 'rgba(214,225,238,0.92)';
      g.fillText(label, lx + 14, y);
      lx += 14 + g.measureText(label).width + 12;
    }
  }
}

function clampRound(v: number, lo: number, hi: number, step: number): number {
  return Math.min(hi, Math.max(lo, Math.round(v / step) * step));
}

function fmtAxis(v: number): string {
  const a = Math.abs(v);
  if (a === 0) return '0';
  if (a >= 100 || a < 0.01) return v.toExponential(1);
  return String(Number(v.toPrecision(2)));
}

/** Linear interpolation into a sampled curve (curves share a sorted x grid). */
function nearest<T extends { x: number }>(curve: T[], x: number): T & { y: number } {
  const first = curve[0] as T;
  const last = curve[curve.length - 1] as T;
  if (x <= first.x) return first as T & { y: number };
  if (x >= last.x) return last as T & { y: number };
  const step = (last.x - first.x) / (curve.length - 1);
  const i = Math.min(curve.length - 2, Math.max(0, Math.floor((x - first.x) / step)));
  return curve[i] as T & { y: number };
}

export default function createConformalPlugin(): Plugin {
  return new ConformalPlugin();
}
