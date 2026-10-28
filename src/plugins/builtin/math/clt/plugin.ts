// ==========================================================================
// stats-clt — Central Limit Theorem demonstration bench
//
// Left inset: the population pdf (or the two Bernoulli masses). Main frame:
// the sampling distribution of the mean over m repetitions, with the
// analytic N(mu, sigma^2/n) overlay (population theoretical moments). The
// footer reports measured vs theoretical mean / variance plus normality
// diagnostics; the science strip carries the relative errors and the
// benchmark results. Fully seeded — identical inputs reproduce the identical
// histogram.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { statsCltManifest } from './manifest';
import { cltFigurePanels } from './figure';
import {
  BIMODAL_SIGMA,
  PARETO_XM,
  PARETO_UPPER,
  POPULATION_KINDS,
  clampParam,
  normalPdf,
  paramLabel,
  relErr,
  runClt,
  runCltBenchmark,
  sampleStats,
  standardized,
  type CltResult,
  type PopulationKind,
} from './kernel';

export { statsCltManifest } from './manifest';

interface State {
  kind: PopulationKind;
  param: number;
  n: number;
  m: number;
  seed: number;
}

const KIND_LABELS: Record<PopulationKind, { en: string; zh: string }> = {
  uniform: { en: 'Uniform U[0, w]', zh: '均匀分布 U[0, w]' },
  exponential: { en: 'Exponential Exp(λ)', zh: '指数分布 Exp(λ)' },
  bernoulli: { en: 'Bernoulli B(p)', zh: '伯努利分布 B(p)' },
  bimodal: { en: 'Bimodal mixture', zh: '双峰混合' },
  pareto: { en: 'Truncated Pareto', zh: '重尾 Pareto（截断）' },
};

export class StatsCltPlugin implements Plugin {
  readonly manifest = statsCltManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private result: CltResult | null = null;
  private state: State = {
    kind: 'uniform',
    param: 2,
    n: 30,
    m: 20000,
    seed: 20261011,
  };

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
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'kind',
        label: 'Population',
        labelI18n: { 'zh-CN': '母体分布', 'en-US': 'Population' },
        type: 'select',
        options: POPULATION_KINDS.map((k) => ({
          value: k,
          label: this.zh ? KIND_LABELS[k].zh : KIND_LABELS[k].en,
          labelI18n: { 'zh-CN': KIND_LABELS[k].zh, 'en-US': KIND_LABELS[k].en },
        })),
        value: this.state.kind,
      },
      {
        key: 'param',
        label: 'Population param',
        labelI18n: {
          'zh-CN': paramLabel(this.state.kind, true),
          'en-US': paramLabel(this.state.kind, false),
        },
        type: 'range',
        min: 0.05,
        max: 5,
        step: 0.05,
        value: this.state.param,
        hint: this.zh
          ? '含义随母体变化：均匀=w、指数=λ、伯努利=p、双峰=d、Pareto=α'
          : 'meaning depends on family: uniform=w, exponential=λ, bernoulli=p, bimodal=d, pareto=α',
      },
      {
        key: 'n',
        label: 'Sample size n',
        labelI18n: { 'zh-CN': '样本量 n', 'en-US': 'Sample size n' },
        type: 'range',
        min: 1,
        max: 200,
        step: 1,
        value: this.state.n,
      },
      {
        key: 'm',
        label: 'Repetitions m',
        labelI18n: { 'zh-CN': '重复次数 m', 'en-US': 'Repetitions m' },
        type: 'range',
        min: 1000,
        max: 100000,
        step: 1000,
        value: this.state.m,
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Seed' },
        type: 'number',
        min: 0,
        max: 4294967295,
        step: 1,
        value: this.state.seed,
      },
      actionButton('run', 'Run sampling', '运行采样', 'primary'),
      actionButton('benchmark', 'Run CLT benchmark', '运行 CLT 基准验证'),
      actionButton('exportCsv', 'Export histogram CSV', '导出直方图 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let dirty = false;
    if (typeof params.kind === 'string' && (POPULATION_KINDS as string[]).includes(params.kind)) {
      const kind = params.kind as PopulationKind;
      if (kind !== this.state.kind) {
        this.state.kind = kind;
        // Re-clamp the shape parameter into the new family's valid range.
        this.state.param = clampParam(kind, this.state.param);
        dirty = true;
      }
    }
    if (typeof params.param === 'number' && Number.isFinite(params.param)) {
      const p = clampParam(this.state.kind, params.param);
      if (p !== this.state.param) {
        this.state.param = p;
        dirty = true;
      }
    }
    if (typeof params.n === 'number' && Number.isFinite(params.n)) {
      const n = Math.min(200, Math.max(1, Math.round(params.n)));
      if (n !== this.state.n) {
        this.state.n = n;
        dirty = true;
      }
    }
    if (typeof params.m === 'number' && Number.isFinite(params.m)) {
      const m = Math.min(100000, Math.max(1000, Math.round(params.m / 1000) * 1000));
      if (m !== this.state.m) {
        this.state.m = m;
        dirty = true;
      }
    }
    if (typeof params.seed === 'number' && Number.isFinite(params.seed)) {
      const seed = Math.min(4294967295, Math.max(0, Math.round(params.seed)));
      if (seed !== this.state.seed) {
        this.state.seed = seed;
        dirty = true;
      }
    }
    if (dirty) this.runNow(false);

    if (actionFired(params, 'run')) this.runNow(true);
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    // The CLT bench is simulation-driven; it accepts no uploaded data.
    return [];
  }

  /** Recompute the sampling distribution (seeded, reproducible). */
  private runNow(explicit: boolean) {
    this.result = runClt(
      { kind: this.state.kind, param: this.state.param },
      this.state.n,
      this.state.m,
      this.state.seed,
    );
    this.publishOutputs();
    if (explicit) {
      notify(
        this.api,
        'success',
        `Sampled m=${this.state.m} means of n=${this.state.n} (seed=${this.state.seed}).`,
        `已采样 m=${this.state.m} 组、每组 n=${this.state.n}（种子=${this.state.seed}）。`,
      );
    }
    this.draw();
  }

  /**
   * Publish the scientific outputs: relative errors of the sample-mean
   * distribution's moments against the analytic values, plus normality
   * diagnostics of the standardized distribution.
   */
  private publishOutputs() {
    const res = this.result;
    if (!res) return;
    const varTheory = res.theory.variance / res.n;
    const errMean = relErr(res.stats.mean, res.theory.mean);
    const errVar = relErr(res.stats.variance, varTheory);
    const stdStats = sampleStats(
      standardized(res.means, res.theory.mean, Math.sqrt(res.theory.variance), res.n),
    );
    const kurtExcess = stdStats.kurtosis - 3;
    const provenance = this.zh
      ? `固定种子蒙特卡洛（seed=${res.seed}，n=${res.n}，m=${res.m}）`
      : `seeded Monte-Carlo (seed=${res.seed}, n=${res.n}, m=${res.m})`;
    const metrics: ScienceMetric[] = [
      {
        key: 'mean-rel-err',
        label: this.zh ? '均值相对误差' : 'Mean rel. error',
        value: fmtMetric(errMean * 100),
        unit: '%',
        severity: errMean < 0.02 ? 'ok' : 'warn',
        hint: `${provenance} · ${this.zh ? '基准阈值 2%' : 'benchmark threshold 2%'}`,
      },
      {
        key: 'var-rel-err',
        label: this.zh ? '方差相对误差' : 'Variance rel. error',
        value: fmtMetric(errVar * 100),
        unit: '%',
        severity: errVar < 0.02 ? 'ok' : 'warn',
        hint: `${provenance} · ${this.zh ? '对照 σ²/n' : 'vs σ²/n'} · ${this.zh ? '基准阈值 2%' : 'benchmark threshold 2%'}`,
      },
      {
        key: 'std-skew',
        label: this.zh ? '标准化偏度' : 'Std. skewness',
        value: fmtMetric(stdStats.skewness),
        severity: Math.abs(stdStats.skewness) < 0.1 ? 'ok' : 'info',
        hint: this.zh ? '基准阈值 |S| < 0.1' : 'benchmark threshold |S| < 0.1',
      },
      {
        key: 'std-kurt',
        label: this.zh ? '标准化峰度−3' : 'Std. kurtosis − 3',
        value: fmtMetric(kurtExcess),
        severity: Math.abs(kurtExcess) < 0.2 ? 'ok' : 'info',
        hint: this.zh ? '基准阈值 |K−3| < 0.2' : 'benchmark threshold |K−3| < 0.2',
      },
      {
        key: 'jarque-bera',
        label: 'Jarque–Bera',
        value: fmtMetric(res.jarqueBera),
        severity: 'info',
        hint: this.zh ? 'χ²(2) 渐近分布；仅供参考诊断' : 'asymptotically chi²(2); diagnostic only',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** Embedded L4 validation benchmark: analytic truth vs seeded Monte-Carlo. */
  private runBenchmark() {
    const bench = runCltBenchmark(this.state.seed);
    const okMoments = bench.uniformRelErrMean < 0.02 && bench.uniformRelErrVar < 0.02;
    const okNormality =
      Math.abs(bench.standardizedSkewness) < 0.1 && Math.abs(bench.standardizedKurtosis - 3) < 0.2;
    const okExpSkew = bench.exponentialRelErr < 0.1;
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-uniform-mean',
        label: this.zh ? '基准① 均值误差' : 'Bench ① mean err',
        value: fmtMetric(bench.uniformRelErrMean * 100),
        unit: '%',
        severity: bench.uniformRelErrMean < 0.02 ? 'ok' : 'warn',
        hint: this.zh
          ? `均匀母体 U[0,2]、n=30、m=50000：实测 ${fmtMetric(bench.uniformMeanSample)} vs 理论 ${fmtMetric(bench.uniformMeanTheory)}（固定种子）`
          : `uniform U[0,2], n=30, m=50000: measured ${fmtMetric(bench.uniformMeanSample)} vs theory ${fmtMetric(bench.uniformMeanTheory)} (fixed seed)`,
      },
      {
        key: 'bench-uniform-var',
        label: this.zh ? '基准① 方差误差' : 'Bench ① var err',
        value: fmtMetric(bench.uniformRelErrVar * 100),
        unit: '%',
        severity: bench.uniformRelErrVar < 0.02 ? 'ok' : 'warn',
        hint: this.zh
          ? `对照 σ²/(12n) = ${fmtMetric(bench.uniformVarTheory)}，实测 ${fmtMetric(bench.uniformVarSample)}`
          : `vs σ²/(12n) = ${fmtMetric(bench.uniformVarTheory)}, measured ${fmtMetric(bench.uniformVarSample)}`,
      },
      {
        key: 'bench-normality',
        label: this.zh ? '基准② S / K−3' : 'Bench ② S / K−3',
        value: `${fmtMetric(bench.standardizedSkewness)} / ${fmtMetric(bench.standardizedKurtosis - 3)}`,
        severity: okNormality ? 'ok' : 'warn',
        hint: this.zh ? '阈值 |S|<0.1、|K−3|<0.2' : 'thresholds |S|<0.1, |K−3|<0.2',
      },
      {
        key: 'bench-exp-skew',
        label: this.zh ? '基准③ 指数偏度误差' : 'Bench ③ exp. skew err',
        value: fmtMetric(bench.exponentialRelErr * 100),
        unit: '%',
        severity: okExpSkew ? 'ok' : 'warn',
        hint: this.zh
          ? `n=1 时均值分布即母体：实测偏度 ${fmtMetric(bench.exponentialSkewness)} vs 理论值 2（容差 10%，m 有限所致）`
          : `at n=1 the mean distribution is the population: measured skew ${fmtMetric(bench.exponentialSkewness)} vs exact 2 (10% tolerance, finite m)`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    const allOk = okMoments && okNormality && okExpSkew;
    notify(
      this.api,
      allOk ? 'success' : 'warning',
      `CLT benchmark ${allOk ? 'passed' : 'has warnings'}: mean err ${(bench.uniformRelErrMean * 100).toFixed(3)}%, var err ${(bench.uniformRelErrVar * 100).toFixed(3)}%, exp-skew err ${(bench.exponentialRelErr * 100).toFixed(2)}%.`,
      `CLT 基准${allOk ? '全部通过' : '存在警告'}：均值误差 ${(bench.uniformRelErrMean * 100).toFixed(3)}%，方差误差 ${(bench.uniformRelErrVar * 100).toFixed(3)}%，指数偏度误差 ${(bench.exponentialRelErr * 100).toFixed(2)}%。`,
    );
  }

  /** Histogram table with the analytic normal expectation per bin. */
  private exportCsv() {
    const res = this.result;
    if (!res) {
      notify(this.api, 'warning', 'Run the sampling first.', '请先运行一次采样。');
      return;
    }
    const rows: Array<Array<number | string>> = res.hist.centers.map((c, i) => {
      const expected = res.m * res.hist.binWidth * normalPdf(c, res.theory.mean, res.sdOfMean);
      return [Number(c.toFixed(6)), res.hist.counts[i] ?? 0, Number(expected.toFixed(4))];
    });
    exportRowsCsv(this.api, 'stats-clt-histogram', ['bin_center', 'count', 'expected_normal'], rows);
  }

  /** Stream the sample-mean histograms into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    if (!this.result) this.runNow(false); // seeded & deterministic, like the first draw
    const res = this.result;
    if (!res) {
      notify(this.api, 'warning', 'Run the sampling first.', '请先运行一次采样。');
      return;
    }
    const varTheory = res.theory.variance / res.n;
    const caption: Bilingual = {
      zh: `中心极限定理（n=${res.n}，m=${res.m}，种子 ${res.seed}）：实测均值 ${fmtMetric(res.stats.mean)} vs 理论 ${fmtMetric(res.theory.mean)}；实测方差 ${fmtMetric(res.stats.variance)} vs σ²/n=${fmtMetric(varTheory)}；Jarque–Bera=${fmtMetric(res.jarqueBera)}。`,
      en: `CLT (n=${res.n}, m=${res.m}, seed ${res.seed}): measured mean ${fmtMetric(res.stats.mean)} vs theory ${fmtMetric(res.theory.mean)}; measured variance ${fmtMetric(res.stats.variance)} vs sigma^2/n=${fmtMetric(varTheory)}; Jarque-Bera=${fmtMetric(res.jarqueBera)}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '样本均值分布（CLT）', en: 'Sample-Mean Distribution (CLT)' },
      caption,
      cltFigurePanels(res),
    );
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    if (!this.result) {
      // Seeded computation, no user data involved — run immediately instead
      // of showing an empty state.
      this.result = runClt(
        { kind: this.state.kind, param: this.state.param },
        this.state.n,
        this.state.m,
        this.state.seed,
      );
      this.publishOutputs();
    }
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const res = this.result;
    this.drawInset(g, res);
    this.drawHistogram(g, canvas, res);
    this.drawFooter(g, canvas, res);
  }

  /** Population pdf inset (top-left corner). */
  private drawInset(g: CanvasRenderingContext2D, res: CltResult) {
    const zx = 16;
    const zy = 30;
    const zw = 190;
    const zh = 86;
    const spec = res.spec;
    const a = spec.param;

    let lo = 0;
    let hi = 1;
    let pdf = (_x: number): number => 0;
    let discrete: Array<{ x: number; p: number }> | null = null;
    switch (spec.kind) {
      case 'uniform':
        lo = 0;
        hi = a;
        pdf = (x) => (x >= 0 && x <= a ? 1 / a : 0);
        break;
      case 'exponential':
        lo = 0;
        hi = 4 / a;
        pdf = (x) => (x >= 0 ? a * Math.exp(-a * x) : 0);
        break;
      case 'bernoulli':
        discrete = [
          { x: 0, p: 1 - a },
          { x: 1, p: a },
        ];
        lo = -0.35;
        hi = 1.35;
        break;
      case 'bimodal':
        lo = -(a + 4 * BIMODAL_SIGMA);
        hi = a + 4 * BIMODAL_SIGMA;
        pdf = (x) => {
          const f = (c: number) => {
            const z = (x - c) / BIMODAL_SIGMA;
            return Math.exp(-0.5 * z * z) / (BIMODAL_SIGMA * Math.sqrt(2 * Math.PI));
          };
          return 0.5 * (f(-a) + f(a));
        };
        break;
      case 'pareto': {
        lo = PARETO_XM;
        hi = PARETO_UPPER;
        const c = 1 - Math.pow(PARETO_UPPER, -a);
        pdf = (x) => (x >= PARETO_XM ? (a * Math.pow(x, -a - 1)) / c : 0);
        break;
      }
    }

    let fMax = 0;
    if (discrete) {
      for (const d of discrete) fMax = Math.max(fMax, d.p);
    } else {
      for (let i = 0; i <= 120; i += 1) fMax = Math.max(fMax, pdf(lo + ((hi - lo) * i) / 120));
    }
    fMax = Math.max(fMax, 1e-9);

    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.strokeRect(zx, zy, zw, zh);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = "10px 'Microsoft YaHei', Consolas, monospace";
    g.fillText(
      this.zh ? `母体 pdf · ${KIND_LABELS[spec.kind].zh}` : `population pdf · ${KIND_LABELS[spec.kind].en}`,
      zx + 4,
      zy - 4,
    );

    const px = (x: number) => zx + (zw * (x - lo)) / (hi - lo);
    const py = (f: number) => zy + zh - (zh * 0.94 * f) / fMax;
    if (discrete) {
      for (const d of discrete) {
        const x0 = px(d.x - 0.18);
        const x1 = px(d.x + 0.18);
        const y = py(d.p);
        g.fillStyle = 'rgba(140,200,250,0.75)';
        g.fillRect(x0, y, Math.max(2, x1 - x0), zy + zh - y);
      }
    } else {
      g.strokeStyle = 'rgba(140,200,250,0.95)';
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i <= 120; i += 1) {
        const x = lo + ((hi - lo) * i) / 120;
        const y = py(pdf(x));
        if (i === 0) g.moveTo(px(x), y);
        else g.lineTo(px(x), y);
      }
      g.stroke();
      g.lineWidth = 1;
    }
  }

  /** Main frame: histogram of sample means + N(mu, sigma^2/n) overlay. */
  private drawHistogram(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, res: CltResult) {
    const padL = 54;
    const padR = 18;
    const y0 = 128;
    const y1 = canvas.height - 58;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    const counts = res.hist.counts;
    let cMax = 0;
    for (const c of counts) cMax = Math.max(cMax, c);
    cMax = Math.max(cMax, 1);
    // Normal expectation per bin (analytic overlay, same count scale).
    const expected = res.hist.centers.map((c) =>
      res.m * res.hist.binWidth * normalPdf(c, res.theory.mean, res.sdOfMean),
    );
    let eMax = 0;
    for (const e of expected) eMax = Math.max(eMax, e);
    const yMax = Math.max(cMax, eMax) * 1.08;

    const px = (x: number) => x0 + (plotW * (x - res.hist.min)) / (res.hist.max - res.hist.min);
    const py = (c: number) => y1 - (plotH * c) / yMax;

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = "13px 'Microsoft YaHei', Consolas, monospace";
    g.fillText(
      this.zh
        ? `样本均值的分布  n=${res.n}，m=${res.m}（种子 ${res.seed}）`
        : `Distribution of the sample mean  n=${res.n}, m=${res.m} (seed ${res.seed})`,
      canvas.width / 2,
      18,
    );

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // y ticks
    g.textAlign = 'right';
    g.font = "10px Consolas, monospace";
    for (let i = 0; i <= 4; i += 1) {
      const v = (yMax * i) / 4;
      const sy = py(v);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0), x0 - 6, sy + 4);
    }
    // x ticks (5)
    g.textAlign = 'center';
    for (let i = 0; i <= 5; i += 1) {
      const xv = res.hist.min + ((res.hist.max - res.hist.min) * i) / 5;
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(Number(xv.toFixed(3)).toString(), px(xv), y1 + 14);
    }

    // histogram bars
    const bw = plotW / counts.length;
    g.fillStyle = 'rgba(120,170,240,0.55)';
    for (let i = 0; i < counts.length; i += 1) {
      const c = counts[i] ?? 0;
      if (c <= 0) continue;
      const bx = x0 + i * bw;
      g.fillRect(bx, py(c), Math.max(1, bw - 0.5), y1 - py(c));
    }

    // normal overlay
    g.strokeStyle = 'rgba(250,200,110,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 240; i += 1) {
      const x = res.hist.min + ((res.hist.max - res.hist.min) * i) / 240;
      const e = res.m * res.hist.binWidth * normalPdf(x, res.theory.mean, res.sdOfMean);
      const sy = py(e);
      if (i === 0) g.moveTo(px(x), sy);
      else g.lineTo(px(x), sy);
    }
    g.stroke();
    g.lineWidth = 1;

    // legend
    g.textAlign = 'left';
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    let ly = y0 + 14;
    const legend: Array<[string, string]> = [
      ['rgba(120,170,240,0.8)', this.zh ? '均值直方图' : 'histogram of means'],
      ['rgba(250,200,110,0.95)', this.zh ? 'N(μ, σ²/n) 理论叠加' : 'N(mu, sigma^2/n) overlay'],
    ];
    for (const [c, label] of legend) {
      g.fillStyle = c;
      g.fillRect(x1 - 168, ly, 16, 4);
      g.fillStyle = 'rgba(200,214,232,0.95)';
      g.fillText(label, x1 - 146, ly + 6);
      ly += 15;
    }
  }

  /** Footer: measured vs analytic moments + normality diagnostics. */
  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, res: CltResult) {
    const varTheory = res.theory.variance / res.n;
    g.textAlign = 'left';
    g.font = "11px 'Microsoft YaHei', Consolas, monospace";
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = this.zh
      ? `母体 μ=${fmtMetric(res.theory.mean)}，σ²=${fmtMetric(res.theory.variance)}  ·  ${paramLabel(res.spec.kind, true)}=${fmtMetric(res.spec.param)}`
      : `population mu=${fmtMetric(res.theory.mean)}, sigma^2=${fmtMetric(res.theory.variance)}  ·  ${paramLabel(res.spec.kind, false)}=${fmtMetric(res.spec.param)}`;
    g.fillText(l1, 54, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = this.zh
      ? `实测均值 ${fmtMetric(res.stats.mean)}（理论 ${fmtMetric(res.theory.mean)}，误差 ${(relErr(res.stats.mean, res.theory.mean) * 100).toFixed(3)}%）· 实测方差 ${fmtMetric(res.stats.variance)}（理论 ${fmtMetric(varTheory)}，误差 ${(relErr(res.stats.variance, varTheory) * 100).toFixed(3)}%）`
      : `measured mean ${fmtMetric(res.stats.mean)} (theory ${fmtMetric(res.theory.mean)}, err ${(relErr(res.stats.mean, res.theory.mean) * 100).toFixed(3)}%) · measured var ${fmtMetric(res.stats.variance)} (theory ${fmtMetric(varTheory)}, err ${(relErr(res.stats.variance, varTheory) * 100).toFixed(3)}%)`;
    g.fillText(l2, 54, canvas.height - 14);
  }
}

export default function createStatsCltPlugin(): Plugin {
  return new StatsCltPlugin();
}
