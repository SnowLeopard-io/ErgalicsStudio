// ==========================================================================
// math-dist — Probability Distribution Lab
//
// Dual-panel interactive view of a selected family: the left panel draws the
// pdf / pmf curve with a density histogram of the current data (seeded
// Monte-Carlo sampling, or a built-in sample dataset with its MLE fit), the
// right panel draws the cdf with the empirical step ECDF and the fitted cdf
// (see kernel.ts for the incomplete-gamma / incomplete-beta numerics, the
// reproducible RNG and the MLE estimators). Parameter sliders update both
// panels live; the science strip reports sample moments or MLE estimates.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { distFigurePanels } from './figure';
import { mathDistManifest } from './manifest';
import {
  allDefaultParams,
  DISTS,
  distCdf,
  distPdf,
  getDist,
  histogramBars,
  mleFit,
  plotXRange,
  runDistBenchmarks,
  sampleDist,
  summarize,
  SAMPLE_DATASETS,
  type DistDef,
  type DistId,
  type DistParamDef,
  type MleFit,
  type SampleDataset,
  type SampleSummary,
} from './kernel';

export { mathDistManifest } from './manifest';

interface State {
  dist: DistId;
  /** Values of every slider key across all families (only the active one is shown). */
  params: Record<string, number>;
  /** Monte-Carlo sample size (sampling mode). */
  sampleSize: number;
  /** RNG seed; sampling is fully reproducible from it. */
  seed: number;
  /** `'none'` = seeded sampling, otherwise a SAMPLE_DATASETS id. */
  dataset: string;
}

/** Flat lookup of every slider key → its metadata. */
const PARAM_DEFS = new Map<string, DistParamDef>();
for (const d of DISTS) for (const pd of d.params) PARAM_DEFS.set(pd.key, pd);

function isDistId(v: unknown): v is DistId {
  return typeof v === 'string' && DISTS.some((d) => d.id === v);
}

/** Axis tick label with adaptive precision (no emoji, publication-neutral). */
function fmtTick(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-3 || a >= 1e5)) return v.toExponential(1);
  return String(Number(v.toPrecision(3)));
}

interface PanelRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Data-space → pixel mapper of one panel rectangle. */
function mapper(r: PanelRect, xr: [number, number], yr: [number, number]) {
  const dx = xr[1] - xr[0] || 1;
  const dy = yr[1] - yr[0] || 1;
  return {
    x: (v: number) => r.x0 + ((v - xr[0]) / dx) * (r.x1 - r.x0),
    y: (v: number) => r.y1 - ((v - yr[0]) / dy) * (r.y1 - r.y0),
  };
}

/** Frame, grid, ticks and axis labels of one panel. */
function drawFrame(
  g: CanvasRenderingContext2D,
  r: PanelRect,
  xr: [number, number],
  yr: [number, number],
  xLab: string,
  yLab: string,
): void {
  g.save();
  g.strokeStyle = 'rgba(140,155,180,0.55)';
  g.lineWidth = 1;
  g.strokeRect(r.x0 + 0.5, r.y0 + 0.5, r.x1 - r.x0, r.y1 - r.y0);
  g.font = '9px Consolas, monospace';
  for (let i = 0; i <= 4; i += 1) {
    const t = i / 4;
    const px = r.x0 + t * (r.x1 - r.x0);
    const xv = xr[0] + t * (xr[1] - xr[0]);
    g.strokeStyle = 'rgba(120,135,160,0.16)';
    g.beginPath();
    g.moveTo(px, r.y0);
    g.lineTo(px, r.y1);
    g.stroke();
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.textAlign = 'center';
    g.fillText(fmtTick(xv), px, r.y1 + 12);
  }
  for (let i = 0; i <= 4; i += 1) {
    const t = i / 4;
    const py = r.y0 + t * (r.y1 - r.y0);
    const yv = yr[1] + t * (yr[0] - yr[1]);
    g.strokeStyle = 'rgba(120,135,160,0.16)';
    g.beginPath();
    g.moveTo(r.x0, py);
    g.lineTo(r.x1, py);
    g.stroke();
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.textAlign = 'right';
    g.fillText(fmtTick(yv), r.x0 - 5, py + 3);
  }
  g.font = '10px Consolas, monospace';
  g.fillStyle = 'rgba(190,200,215,0.95)';
  g.textAlign = 'center';
  g.fillText(xLab, (r.x0 + r.x1) / 2, r.y1 - 7);
  g.textAlign = 'left';
  g.fillText(yLab, r.x0 + 7, r.y0 + 14);
  g.restore();
}

/** Compact colour-key legend row drawn above one panel. */
function drawLegend(g: CanvasRenderingContext2D, items: Array<{ color: string; text: string }>, x: number, y: number): void {
  g.save();
  g.font = '10px Consolas, monospace';
  g.textAlign = 'left';
  let cx = x;
  for (const it of items) {
    g.strokeStyle = it.color;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(cx, y - 3);
    g.lineTo(cx + 14, y - 3);
    g.stroke();
    g.fillStyle = 'rgba(215,224,236,0.95)';
    g.fillText(it.text, cx + 18, y);
    cx += 18 + g.measureText(it.text).width + 14;
  }
  g.restore();
}

export class MathDistPlugin implements Plugin {
  readonly manifest = mathDistManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    dist: 'normal',
    params: allDefaultParams(),
    sampleSize: 2000,
    seed: 42,
    dataset: 'none',
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
    const def = getDist(this.state.dist);
    return [
      {
        key: 'dist',
        label: 'Distribution',
        labelI18n: { 'zh-CN': '分布族', 'en-US': 'Distribution' },
        type: 'select',
        options: DISTS.map((d) => ({
          value: d.id,
          label: this.zh ? d.labelZh : d.labelEn,
          labelI18n: { 'zh-CN': d.labelZh, 'en-US': d.labelEn },
        })),
        value: this.state.dist,
      },
      ...def.params.map((pd): ParamDefinition => ({
        key: pd.key,
        label: pd.labelEn,
        labelI18n: { 'zh-CN': pd.labelZh, 'en-US': pd.labelEn },
        type: 'range',
        min: pd.min,
        max: pd.max,
        step: pd.step,
        value: this.state.params[pd.key] ?? pd.default,
      })),
      {
        key: 'dataset',
        label: 'Sample dataset',
        labelI18n: { 'zh-CN': '样本数据集', 'en-US': 'Sample dataset' },
        type: 'select',
        options: [
          {
            value: 'none',
            label: this.zh ? '无（固定种子模拟采样）' : 'None (seeded Monte-Carlo sampling)',
            labelI18n: {
              'zh-CN': '无（固定种子模拟采样）',
              'en-US': 'None (seeded Monte-Carlo sampling)',
            },
          },
          ...SAMPLE_DATASETS.map((d) => ({
            value: d.id,
            label: this.zh ? d.labelZh : d.labelEn,
            labelI18n: { 'zh-CN': d.labelZh, 'en-US': d.labelEn },
          })),
        ],
        value: this.state.dataset,
        hint: this.zh
          ? '选择数据集后自动切换到其分布族，叠加直方图与 MLE 拟合曲线'
          : 'A dataset switches to its family and overlays the histogram plus the MLE fit',
      },
      {
        key: 'sampleSize',
        label: 'Sample size',
        labelI18n: { 'zh-CN': '采样样本量', 'en-US': 'Sample size' },
        type: 'range',
        min: 200,
        max: 8000,
        step: 100,
        value: this.state.sampleSize,
        hint: this.zh ? '模拟采样规模' : 'Monte-Carlo sample size',
        visibleWhen: { key: 'dataset', in: ['none'] },
      },
      {
        key: 'seed',
        label: 'RNG seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'RNG seed' },
        type: 'range',
        min: 1,
        max: 9999,
        step: 1,
        value: this.state.seed,
        hint: this.zh ? '固定种子使采样与直方图完全可复现' : 'A fixed seed makes sampling and the histogram reproducible',
        visibleWhen: { key: 'dataset', in: ['none'] },
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, cb: (v: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (cb(params[k] as number)) this.draw();
      }
    };
    for (const [key, pd] of PARAM_DEFS) {
      num(key, (v) => {
        const x = Math.min(pd.max, Math.max(pd.min, v));
        if (x === (this.state.params[key] ?? pd.default)) return false;
        this.state.params[key] = x;
        return true;
      });
    }
    num('sampleSize', (v) => {
      const x = Math.round(Math.min(8000, Math.max(200, v)));
      if (x === this.state.sampleSize) return false;
      this.state.sampleSize = x;
      return true;
    });
    num('seed', (v) => {
      const x = Math.round(Math.min(9999, Math.max(1, v)));
      if (x === this.state.seed) return false;
      this.state.seed = x;
      return true;
    });
    if (typeof params.dist === 'string' && params.dist !== this.state.dist && isDistId(params.dist)) {
      this.state.dist = params.dist;
      const ds = this.dataset();
      if (ds && ds.family !== this.state.dist) this.state.dataset = 'none';
      this.draw();
    }
    if (typeof params.dataset === 'string' && params.dataset !== this.state.dataset) {
      const ds = SAMPLE_DATASETS.find((d) => d.id === params.dataset);
      this.state.dataset = ds ? ds.id : 'none';
      if (ds) this.state.dist = ds.family;
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- actions ---------------------------------------------------------------

  /** Run the embedded validation suite and publish one metric per benchmark. */
  private runBenchmark() {
    const bench = runDistBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: this.zh ? b.detailZh : b.detailEn,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0
        ? `All ${bench.length} distribution benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项概率分布基准通过。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  /** Build the density + CDF panels and push them into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    const def = getDist(this.state.dist);
    const { values, dataset, fit } = this.currentData();
    const summary = summarize(values);
    const paramStr = def.params
      .map((pd) => `${pd.symbol}=${fmtMetric(this.state.params[pd.key] ?? pd.default)}`)
      .join('  ');
    const fitStr = fit
      ? Object.entries(fit.params)
          .map(([k, v]) => `${PARAM_DEFS.get(k)?.symbol ?? k}=${fmtMetric(v)}`)
          .join('  ')
      : '—';
    const caption: Bilingual = dataset
      ? {
          zh: `${def.labelZh}（${paramStr}）：数据集「${dataset.labelZh}」n=${summary.n}，MLE 拟合 ${fitStr}，对数似然 ${fmtMetric(fit ? fit.logLik : NaN)}。`,
          en: `${def.labelEn} (${paramStr}): dataset "${dataset.labelEn}" n=${summary.n}, MLE fit ${fitStr}, log-likelihood ${fmtMetric(fit ? fit.logLik : NaN)}.`,
        }
      : {
          zh: `${def.labelZh}（${paramStr}）：固定种子采样 n=${summary.n}，seed=${this.state.seed}，样本均值 ${fmtMetric(summary.mean)}。`,
          en: `${def.labelEn} (${paramStr}): seeded sampling n=${summary.n}, seed=${this.state.seed}, sample mean ${fmtMetric(summary.mean)}.`,
        };
    await pushPanelsToFigure(
      this.api,
      { zh: '概率分布 PDF 与 CDF', en: 'Distribution PDF & CDF' },
      caption,
      distFigurePanels({ dist: this.state.dist, params: this.state.params, samples: values, fit }),
    );
  }

  // ---- data helpers ------------------------------------------------------------

  private dataset(): SampleDataset | undefined {
    return this.state.dataset !== 'none' ? SAMPLE_DATASETS.find((d) => d.id === this.state.dataset) : undefined;
  }

  /** Current data source: dataset values (+ its MLE fit) or a seeded sample. */
  private currentData(): { values: number[]; dataset: SampleDataset | undefined; fit: MleFit | null } {
    const dataset = this.dataset();
    if (dataset) {
      return { values: dataset.values, dataset, fit: mleFit(dataset.family, dataset.values) };
    }
    return {
      values: sampleDist(this.state.dist, this.state.params, this.state.sampleSize, this.state.seed),
      dataset: undefined,
      fit: null,
    };
  }

  // ---- science outputs ----------------------------------------------------------

  /** Publish MLE estimates (dataset mode) or sample moments (sampling mode). */
  private publishScience(dataset: SampleDataset | undefined, fit: MleFit | null, summary: SampleSummary) {
    const zh = this.zh;
    const def: DistDef = getDist(this.state.dist);
    const metrics: ScienceMetric[] = [];
    if (dataset && fit) {
      for (const [key, v] of Object.entries(fit.params)) {
        const pd = PARAM_DEFS.get(key);
        metrics.push({
          key: `fit-${key}`,
          label: `MLE ${zh ? pd?.labelZh ?? key : pd?.labelEn ?? key}`,
          value: fmtMetric(v),
          severity: 'ok',
          hint: zh
            ? `n=${summary.n}  标准误 SE=${fmtMetric(fit.se[key] ?? NaN)}  ln L=${fmtMetric(fit.logLik)}`
            : `n=${summary.n}  standard error SE=${fmtMetric(fit.se[key] ?? NaN)}  log-lik ${fmtMetric(fit.logLik)}`,
        });
      }
      metrics.push({
        key: 'fit-loglik',
        label: zh ? '对数似然 ln L' : 'Log-likelihood ln L',
        value: fmtMetric(fit.logLik),
        severity: 'ok',
        hint: zh
          ? `数据集「${dataset.labelZh}」的极大似然拟合`
          : `maximum-likelihood fit of dataset "${dataset.labelEn}"`,
      });
      metrics.push({
        key: 'data-mean',
        label: zh ? '样本均值' : 'Sample mean',
        value: fmtMetric(summary.mean),
        severity: 'info',
        hint: zh
          ? `n=${summary.n}  样本标准差 ${fmtMetric(summary.sd)}`
          : `n=${summary.n}  sample sd ${fmtMetric(summary.sd)}`,
      });
      setScienceOutputs(this.manifest.id, metrics);
      return;
    }
    // Seeded-sampling mode: compare the sample moments with theory.
    const theo = def.mean(this.state.params);
    const nearZero = !Number.isFinite(theo) || Math.abs(theo) < 1e-9;
    const dev = nearZero
      ? Math.abs(summary.mean - (Number.isFinite(theo) ? theo : 0))
      : Math.abs((summary.mean - theo) / theo);
    const sd = Math.sqrt(def.variance(this.state.params));
    const scale = Number.isFinite(sd) && sd > 0 ? sd : summary.sd;
    const converged = nearZero ? dev < 0.1 * scale : dev < 0.05;
    const devKind = nearZero ? (zh ? '绝对偏差' : 'absolute deviation') : zh ? '相对偏差' : 'relative deviation';
    metrics.push({
      key: 'sample-mean',
      label: zh ? '样本均值' : 'Sample mean',
      value: fmtMetric(summary.mean),
      severity: converged ? 'ok' : 'warn',
      hint: zh
        ? `理论均值 ${fmtTick(theo)}  ${devKind} ${fmtMetric(dev)}  seed=${this.state.seed}  n=${summary.n}`
        : `theoretical mean ${fmtTick(theo)}  ${devKind} ${fmtMetric(dev)}  seed=${this.state.seed}  n=${summary.n}`,
    });
    metrics.push({
      key: 'sample-sd',
      label: zh ? '样本标准差' : 'Sample sd',
      value: fmtMetric(summary.sd),
      severity: 'info',
      hint: zh
        ? `理论标准差 ${fmtTick(sd)}  n=${summary.n}  Box–Muller / 逆变换采样可复现`
        : `theoretical sd ${fmtTick(sd)}  n=${summary.n}  reproducible Box-Muller / inverse-transform sampling`,
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- drawing ------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = this.zh;
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, W, H);

    const def: DistDef = getDist(this.state.dist);
    const p = this.state.params;
    const discrete = def.kind === 'discrete';
    const { values, dataset, fit } = this.currentData();
    const summary = summarize(values);
    const [xlo, xhi] = plotXRange(this.state.dist, p, values);
    const xr: [number, number] = [xlo, xhi];
    const theoMean = def.mean(p);
    const cl01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

    // ---- layout: two side-by-side panels -----------------------------------------
    const margin = 40;
    const gap = 48;
    const pTop = 40;
    const pBot = H - 58;
    const pw = Math.max(120, (W - 2 * margin - gap) / 2);
    const left: PanelRect = { x0: margin, y0: pTop, x1: margin + pw, y1: pBot };
    const right: PanelRect = { x0: margin + pw + gap, y0: pTop, x1: margin + 2 * pw + gap, y1: pBot };

    // ---- density content: histogram + pdf/pmf + fit -------------------------------
    const hlo = discrete ? Math.floor(xlo) - 0.5 : xlo;
    const hhi = discrete ? Math.ceil(xhi) + 0.5 : xhi;
    const bins = discrete ? Math.max(1, Math.round(hhi - hlo)) : 32;
    const bars = histogramBars(values, hlo, hhi, bins);

    const dens: Array<{ x: number; y: number }> = [];
    let yMax = 0;
    if (discrete) {
      for (let k = Math.ceil(xlo); k <= Math.floor(xhi); k += 1) {
        const y = distPdf(this.state.dist, p, k);
        if (Number.isFinite(y)) {
          dens.push({ x: k, y });
          yMax = Math.max(yMax, y);
        }
      }
    } else {
      const N = 160;
      for (let i = 0; i <= N; i += 1) {
        const x = xlo + ((xhi - xlo) * i) / N;
        const y = distPdf(this.state.dist, p, x);
        if (Number.isFinite(y)) {
          dens.push({ x, y });
          yMax = Math.max(yMax, y);
        }
      }
    }
    for (const b of bars) if (Number.isFinite(b.y)) yMax = Math.max(yMax, b.y);

    const fitPts: Array<{ x: number; y: number }> = [];
    const fitDis = fit ? getDist(fit.dist).kind === 'discrete' : false;
    if (fit) {
      if (fitDis) {
        for (let k = Math.ceil(xlo); k <= Math.floor(xhi); k += 1) {
          const y = distPdf(fit.dist, fit.params, k);
          if (Number.isFinite(y)) {
            fitPts.push({ x: k, y });
            yMax = Math.max(yMax, y);
          }
        }
      } else {
        const N = 160;
        for (let i = 0; i <= N; i += 1) {
          const x = xlo + ((xhi - xlo) * i) / N;
          const y = distPdf(fit.dist, fit.params, x);
          if (Number.isFinite(y)) {
            fitPts.push({ x, y });
            yMax = Math.max(yMax, y);
          }
        }
      }
    }
    if (!(yMax > 0)) yMax = 1;

    const yrL: [number, number] = [0, yMax * 1.15];
    const yrR: [number, number] = [0, 1];
    const ml = mapper(left, xr, yrL);
    const mr = mapper(right, xr, yrR);

    /** Trace the cdf of one parameter set into the current path (right panel). */
    const traceCdf = (id: DistId, prm: Record<string, number>): void => {
      if (discrete) {
        const k0 = Math.floor(xlo);
        const k1 = Math.ceil(xhi);
        g.moveTo(mr.x(xlo), mr.y(cl01(distCdf(id, prm, k0))));
        for (let k = k0; k < k1; k += 1) {
          const nx = Math.min(k + 1, xhi);
          g.lineTo(mr.x(nx), mr.y(cl01(distCdf(id, prm, k))));
          if (nx < xhi) g.lineTo(mr.x(nx), mr.y(cl01(distCdf(id, prm, k + 1))));
        }
      } else {
        const N = 160;
        for (let i = 0; i <= N; i += 1) {
          const x = xlo + ((xhi - xlo) * i) / N;
          const y = cl01(distCdf(id, prm, x));
          if (i === 0) g.moveTo(mr.x(x), mr.y(y));
          else g.lineTo(mr.x(x), mr.y(y));
        }
      }
    };

    // ---- left panel: density -------------------------------------------------------
    g.save();
    g.beginPath();
    g.rect(left.x0, left.y0, left.x1 - left.x0, left.y1 - left.y0);
    g.clip();
    g.fillStyle = 'rgba(75,225,195,0.20)';
    g.strokeStyle = 'rgba(75,225,195,0.55)';
    g.lineWidth = 1;
    for (const b of bars) {
      const bx0 = ml.x(b.x0);
      const bx1 = ml.x(b.x1);
      const by = ml.y(b.y);
      g.fillRect(bx0, by, bx1 - bx0, ml.y(0) - by);
      g.strokeRect(bx0 + 0.5, by + 0.5, bx1 - bx0 - 1, ml.y(0) - by);
    }
    g.lineWidth = 2;
    if (discrete) {
      g.strokeStyle = '#6db4ff';
      g.fillStyle = '#6db4ff';
      g.beginPath();
      for (const pt of dens) {
        g.moveTo(ml.x(pt.x), ml.y(0));
        g.lineTo(ml.x(pt.x), ml.y(pt.y));
      }
      g.stroke();
      for (const pt of dens) {
        g.beginPath();
        g.arc(ml.x(pt.x), ml.y(pt.y), 2.5, 0, 2 * Math.PI);
        g.fill();
      }
    } else {
      g.strokeStyle = '#6db4ff';
      g.beginPath();
      dens.forEach((pt, i) => {
        if (i === 0) g.moveTo(ml.x(pt.x), ml.y(pt.y));
        else g.lineTo(ml.x(pt.x), ml.y(pt.y));
      });
      g.stroke();
    }
    if (fitPts.length > 0) {
      g.save();
      g.setLineDash([6, 4]);
      g.strokeStyle = '#f5a623';
      g.lineWidth = 2;
      g.beginPath();
      if (fitDis) {
        for (const pt of fitPts) {
          g.moveTo(ml.x(pt.x), ml.y(0));
          g.lineTo(ml.x(pt.x), ml.y(pt.y));
        }
      } else {
        fitPts.forEach((pt, i) => {
          if (i === 0) g.moveTo(ml.x(pt.x), ml.y(pt.y));
          else g.lineTo(ml.x(pt.x), ml.y(pt.y));
        });
      }
      g.stroke();
      g.restore();
    }
    if (Number.isFinite(theoMean) && theoMean >= xlo && theoMean <= xhi) {
      g.save();
      g.setLineDash([4, 4]);
      g.strokeStyle = '#ff7a7a';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(ml.x(theoMean), ml.y(0));
      g.lineTo(ml.x(theoMean), ml.y(yrL[1]));
      g.stroke();
      g.restore();
    }
    g.restore();
    drawFrame(g, left, xr, yrL, 'x', discrete ? 'pmf' : 'density');

    // ---- right panel: CDF + ECDF + fit ---------------------------------------------
    g.save();
    g.beginPath();
    g.rect(right.x0, right.y0, right.x1 - right.x0, right.y1 - right.y0);
    g.clip();
    g.strokeStyle = '#ffb250';
    g.lineWidth = 2;
    g.beginPath();
    traceCdf(this.state.dist, p);
    g.stroke();
    const sorted = values.filter((v) => Number.isFinite(v) && v >= xlo && v <= xhi).sort((a, b) => a - b);
    const n = sorted.length;
    if (n > 0) {
      g.strokeStyle = '#4be1c3';
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(mr.x(xlo), mr.y(0));
      for (let i = 0; i < n; i += 1) {
        const v = sorted[i]!;
        g.lineTo(mr.x(v), mr.y(i / n));
        g.lineTo(mr.x(v), mr.y((i + 1) / n));
      }
      g.lineTo(mr.x(xhi), mr.y(1));
      g.stroke();
    }
    if (fit) {
      g.save();
      g.setLineDash([6, 4]);
      g.strokeStyle = '#f5a623';
      g.lineWidth = 1.5;
      g.beginPath();
      traceCdf(fit.dist, fit.params);
      g.stroke();
      g.restore();
    }
    g.restore();
    drawFrame(g, right, xr, yrR, 'x', 'F(x)');

    // ---- legends, bilingual title + footer ------------------------------------------
    drawLegend(
      g,
      [
        { color: '#6db4ff', text: discrete ? 'PMF' : zh ? '密度' : 'pdf' },
        { color: '#4be1c3', text: zh ? '直方图' : 'hist' },
        ...(fitPts.length > 0 ? [{ color: '#f5a623', text: zh ? 'MLE 拟合' : 'MLE fit' }] : []),
        { color: '#ff7a7a', text: zh ? '理论均值' : 'mean' },
      ],
      left.x0,
      pTop - 6,
    );
    drawLegend(
      g,
      [
        { color: '#ffb250', text: 'CDF' },
        { color: '#4be1c3', text: 'ECDF' },
        ...(fit ? [{ color: '#f5a623', text: zh ? '拟合 CDF' : 'fit CDF' }] : []),
      ],
      right.x0,
      pTop - 6,
    );

    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(240,244,250,0.92)';
    g.fillText(`${def.labelZh} ${def.labelEn} · PDF/PMF 与 CDF / PDF & CDF`, W / 2, 18);

    const paramStr = def.params.map((pd) => `${pd.symbol}=${fmtTick(p[pd.key] ?? pd.default)}`).join('  ');
    const fitStr = fit
      ? Object.entries(fit.params)
          .map(([k, v]) => `${PARAM_DEFS.get(k)?.symbol ?? k}=${fmtTick(v)}`)
          .join('  ')
      : '—';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    if (dataset && fit) {
      g.font = `11px 'Microsoft YaHei', monospace`;
      g.fillText(
        `数据集「${dataset.labelZh}」 n=${summary.n}  MLE ${fitStr}  ln L=${fmtMetric(fit.logLik)}  样本均值 ${fmtTick(summary.mean)}`,
        54,
        H - 28,
      );
      g.font = '11px Consolas, monospace';
      g.fillText(
        `dataset "${dataset.labelEn}" n=${summary.n}  MLE ${fitStr}  log-lik ${fmtMetric(fit.logLik)}  sample mean ${fmtTick(summary.mean)}`,
        54,
        H - 12,
      );
    } else {
      g.font = `11px 'Microsoft YaHei', monospace`;
      g.fillText(
        `参数 ${paramStr}  seed=${this.state.seed}  n=${summary.n}  理论均值 ${fmtTick(theoMean)}  样本均值 ${fmtTick(summary.mean)}`,
        54,
        H - 28,
      );
      g.font = '11px Consolas, monospace';
      g.fillText(
        `params ${paramStr}  seed=${this.state.seed}  n=${summary.n}  E[X]=${fmtTick(theoMean)}  sample mean ${fmtTick(summary.mean)}`,
        54,
        H - 12,
      );
    }

    this.publishScience(dataset, fit, summary);
  }
}

export default function createMathDistPlugin(): Plugin {
  return new MathDistPlugin();
}
