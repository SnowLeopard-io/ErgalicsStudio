// ==========================================================================
// math-numerics — Numerical Analysis Lab
//
// Four linked experiments on the canvas (see kernel.ts for the pure
// numerics): root-finding error decay for bisection / Newton–Raphson /
// secant (log y), quadrature error vs panel count on a log-log axis
// (trapezoidal / Simpson / Gauss–Legendre against the closed-form
// integral), finite-difference error vs step h (forward / backward /
// central truncation comparison), and interpolation of the selected sample
// (exact curve, Lagrange, natural and clamped cubic splines with the nodes
// overlaid). The footer reports measured against theoretical convergence
// orders; the science strip carries the corresponding relative errors
// under the unified metric |computed − analytic|/|analytic|.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import {
  clearScienceOutputs,
  fmtMetric,
  setScienceOutputs,
  type ScienceMetric,
  type ScienceSeverity,
} from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { numericsFigurePanels } from './figure';
import { mathNumericsManifest } from './manifest';
import {
  FD_STEP_LADDER,
  PANEL_LADDER,
  SAMPLE_FUNCTIONS,
  backwardDiff,
  bisectRoot,
  centralDiff,
  compositeGauss,
  cubicSpline,
  equiNodes,
  fitIterationOrder,
  fitLogLogOrder,
  forwardDiff,
  lagrangeInterp,
  newtonRoot,
  runNumericsBenchmarks,
  secantRoot,
  selectSample,
  simpson,
  simpsonEstimate,
  splineEval,
  trapezoidal,
  trapezoidalEstimate,
  type NumericsBenchmark,
  type RootResult,
  type SampleFunction,
} from './kernel';

export { mathNumericsManifest } from './manifest';

interface State {
  sample: string;
  /** Root iterations shown in the convergence chart. */
  iters: number;
  /** Quadrature panel count used for the reported errors. */
  panels: number;
  /** Interpolation node count. */
  nodes: number;
  /** Finite-difference step as a power of ten (h = 10^fdExp). */
  fdExp: number;
}

interface ChartPoint {
  x: number;
  y: number;
}

interface ChartSeries {
  name: string;
  color: string;
  pts: ChartPoint[];
}

interface MiniChart {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  xLabel: string;
  yLabel: string;
  logX: boolean;
  logY: boolean;
  series: ChartSeries[];
}

interface DrawData {
  roots: { bis: RootResult; newt: RootResult; sec: RootResult };
  quadErrs: { trap: ChartPoint[]; simp: ChartPoint[]; gauss: ChartPoint[] };
  quadAt: { trap: number; simp: number; gauss: number; trapEst: number; simpEst: number };
  fdH: number;
  fdRel: { forward: number; backward: number; central: number };
  fdPts: { fwd: ChartPoint[]; bwd: ChartPoint[]; cen: ChartPoint[] };
  interp: {
    exact: ChartPoint[];
    lag: ChartPoint[];
    nat: ChartPoint[];
    cla: ChartPoint[];
    nodes: ChartPoint[];
    lagMax: number;
    natMax: number;
    nodeMax: number;
    scale: number;
  };
  orders: { bisection: number; trap: number; simp: number; gauss: number; central: number };
}

// ---- canvas chart helpers -----------------------------------------------------------

const CHART_LEFT = 52;
const CHART_RIGHT = 8;
const CHART_TOP = 24;
const CHART_BOTTOM = 22;

function fmtTickLabel(v: number, logAxis: boolean): string {
  if (logAxis) {
    const l = Math.log10(v);
    const e = Math.round(l);
    if (Math.abs(l - e) < 0.06) return `1e${e}`;
    return v.toExponential(1);
  }
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(1);
  return String(Number(v.toPrecision(2)));
}

/** Draw one framed mini chart: title, log/linear axes, grid, series, legend. */
function drawMiniChart(g: CanvasRenderingContext2D, c: MiniChart): void {
  const pw = c.w - CHART_LEFT - CHART_RIGHT;
  const ph = c.h - CHART_TOP - CHART_BOTTOM;
  g.textAlign = 'left';
  g.font = `12px Consolas, 'Microsoft YaHei', monospace`;
  g.fillStyle = 'rgba(240,244,250,0.94)';
  g.fillText(c.title, c.x, c.y + 13);
  if (pw <= 20 || ph <= 20) return;

  const px0 = c.x + CHART_LEFT;
  const py0 = c.y + CHART_TOP;

  // data ranges in transformed space
  let tXmin = Infinity;
  let tXmax = -Infinity;
  let tYmin = Infinity;
  let tYmax = -Infinity;
  const usable = c.series.filter((s) => s.pts.length >= 2);
  for (const s of usable) {
    for (const p of s.pts) {
      if (c.logX && !(p.x > 0)) continue;
      if (c.logY && !(p.y > 0)) continue;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      const tx = c.logX ? Math.log10(p.x) : p.x;
      const ty = c.logY ? Math.log10(p.y) : p.y;
      if (tx < tXmin) tXmin = tx;
      if (tx > tXmax) tXmax = tx;
      if (ty < tYmin) tYmin = ty;
      if (ty > tYmax) tYmax = ty;
    }
  }
  if (!Number.isFinite(tXmin) || !Number.isFinite(tYmin)) {
    g.font = `11px Consolas, monospace`;
    g.fillStyle = 'rgba(150,165,190,0.85)';
    g.textAlign = 'center';
    g.fillText('no plottable data', px0 + pw / 2, py0 + ph / 2);
    return;
  }
  const spanX = tXmax - tXmin || 1;
  const spanY = tYmax - tYmin || 1;
  tXmin -= spanX * 0.05;
  tXmax += spanX * 0.05;
  tYmin -= spanY * 0.08;
  tYmax += spanY * 0.08;
  const sx = (t: number) => px0 + ((t - tXmin) / (tXmax - tXmin)) * pw;
  const sy = (t: number) => py0 + ph - ((t - tYmin) / (tYmax - tYmin)) * ph;

  // frame + grid + ticks
  g.font = `9px Consolas, monospace`;
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i += 1) {
    const tv = tXmin + (i * (tXmax - tXmin)) / 4;
    const X = sx(tv);
    g.strokeStyle = 'rgba(150,165,190,0.14)';
    g.beginPath();
    g.moveTo(X, py0);
    g.lineTo(X, py0 + ph);
    g.stroke();
    g.fillStyle = 'rgba(160,175,195,0.92)';
    g.textAlign = 'center';
    g.fillText(fmtTickLabel(c.logX ? Math.pow(10, tv) : tv, c.logX), X, py0 + ph + 12);

    const fv = tYmin + (i * (tYmax - tYmin)) / 4;
    const Y = sy(fv);
    g.strokeStyle = 'rgba(150,165,190,0.14)';
    g.beginPath();
    g.moveTo(px0, Y);
    g.lineTo(px0 + pw, Y);
    g.stroke();
    g.fillStyle = 'rgba(160,175,195,0.92)';
    g.textAlign = 'right';
    g.fillText(fmtTickLabel(c.logY ? Math.pow(10, fv) : fv, c.logY), px0 - 5, Y + 3);
  }
  g.strokeStyle = 'rgba(150,165,190,0.45)';
  g.strokeRect(px0, py0, pw, ph);

  // series polylines
  for (const s of usable) {
    g.strokeStyle = s.color;
    g.lineWidth = 1.6;
    g.beginPath();
    let pen = false;
    for (const p of s.pts) {
      if (c.logX && !(p.x > 0)) {
        pen = false;
        continue;
      }
      if (c.logY && !(p.y > 0)) {
        pen = false;
        continue;
      }
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        pen = false;
        continue;
      }
      const X = sx(c.logX ? Math.log10(p.x) : p.x);
      const Y = sy(c.logY ? Math.log10(p.y) : p.y);
      if (!pen) {
        g.moveTo(X, Y);
        pen = true;
      } else {
        g.lineTo(X, Y);
      }
    }
    g.stroke();
  }

  // legend (top-right inside the plot area)
  g.font = `10px Consolas, 'Microsoft YaHei', monospace`;
  let ly = py0 + 11;
  for (const s of usable) {
    const label = s.name;
    const w = g.measureText(label).width;
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(label, px0 + pw - 5, ly);
    g.fillStyle = s.color;
    g.fillRect(px0 + pw - 10 - w, ly - 7, 8, 6);
    ly += 11;
  }

  // axis captions
  g.font = `10px Consolas, 'Microsoft YaHei', monospace`;
  g.fillStyle = 'rgba(150,165,190,0.95)';
  g.textAlign = 'center';
  g.fillText(c.xLabel, px0 + pw / 2, c.y + c.h - 6);
  g.save();
  g.translate(c.x + 8, py0 + ph / 2);
  g.rotate(-Math.PI / 2);
  g.fillText(c.yLabel, 0, 0);
  g.restore();
}

function errSeverity(e: number): ScienceSeverity {
  if (!Number.isFinite(e)) return 'error';
  if (e < 1e-6) return 'ok';
  if (e < 1e-1) return 'warn';
  return 'error';
}

function orderSeverity(measured: number, theory: number): ScienceSeverity {
  if (!Number.isFinite(measured)) return 'info';
  return Math.abs(measured - theory) <= Math.max(0.3, 0.15 * theory) ? 'ok' : 'warn';
}

function fmtOrder(m: number): string {
  return Number.isFinite(m) ? m.toFixed(2) : '—';
}

export class MathNumericsPlugin implements Plugin {
  readonly manifest = mathNumericsManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    sample: SAMPLE_FUNCTIONS[0]!.id,
    iters: 30,
    panels: 8,
    nodes: 7,
    fdExp: -4,
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
    const sampleOptions = SAMPLE_FUNCTIONS.map((s) => ({
      value: s.id,
      label: this.zh ? s.labelZh : s.labelEn,
      labelI18n: { 'zh-CN': s.labelZh, 'en-US': s.labelEn },
    }));
    return [
      {
        key: 'sample',
        label: 'Sample function',
        labelI18n: { 'zh-CN': '样本函数', 'en-US': 'Sample function' },
        type: 'select',
        options: sampleOptions,
        value: this.state.sample,
        hint: this.zh ? '内置样本数据：求根区间、解析根、解析积分与解析导数一并给出' : 'Built-in sample data: bracket, closed-form root, integral and derivative in one entry',
      },
      {
        key: 'iters',
        label: 'Root iterations',
        labelI18n: { 'zh-CN': '求根迭代次数', 'en-US': 'Root iterations' },
        type: 'range',
        min: 5,
        max: 45,
        step: 1,
        value: this.state.iters,
        hint: this.zh ? '三种方法共用的迭代上限' : 'shared iteration cap for the three methods',
      },
      {
        key: 'panels',
        label: 'Quadrature panels',
        labelI18n: { 'zh-CN': '积分子区间数', 'en-US': 'Quadrature panels' },
        type: 'range',
        min: 2,
        max: 64,
        step: 2,
        value: this.state.panels,
        hint: this.zh ? '复合梯形/Simpson/Gauss 的子区间数（Simpson 自动取偶）' : 'subintervals for composite trapezoid/Simpson/Gauss (Simpson rounds to even)',
      },
      {
        key: 'nodes',
        label: 'Interpolation nodes',
        labelI18n: { 'zh-CN': '插值节点数', 'en-US': 'Interpolation nodes' },
        type: 'range',
        min: 3,
        max: 12,
        step: 1,
        value: this.state.nodes,
        hint: this.zh ? '等距节点；Lagrange、Newton 均差与三次样条共用' : 'equispaced nodes shared by Lagrange, Newton and the cubic splines',
      },
      {
        key: 'fdExp',
        label: 'FD step exponent (h = 10^e)',
        labelI18n: { 'zh-CN': '差分步长指数（h = 10^e）', 'en-US': 'FD step exponent (h = 10^e)' },
        type: 'range',
        min: -7,
        max: -1,
        step: 0.5,
        value: this.state.fdExp,
        hint: this.zh ? '报告相对误差所用的有限差分步长' : 'finite-difference step used for the reported relative errors',
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
    num('iters', (v) => {
      const x = Math.round(Math.min(45, Math.max(5, v)));
      if (x === this.state.iters) return false;
      this.state.iters = x;
      return true;
    });
    num('panels', (v) => {
      let x = Math.round(Math.min(64, Math.max(2, v)) / 2) * 2;
      if (x < 2) x = 2;
      if (x > 64) x = 64;
      if (x === this.state.panels) return false;
      this.state.panels = x;
      return true;
    });
    num('nodes', (v) => {
      const x = Math.round(Math.min(12, Math.max(3, v)));
      if (x === this.state.nodes) return false;
      this.state.nodes = x;
      return true;
    });
    num('fdExp', (v) => {
      const x = Math.round(Math.min(-1, Math.max(-7, v)) * 2) / 2;
      if (x === this.state.fdExp) return false;
      this.state.fdExp = x;
      return true;
    });
    if (typeof params.sample === 'string' && params.sample !== this.state.sample) {
      this.state.sample = params.sample;
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- actions ---------------------------------------------------------------

  /** Run the embedded validation suite and publish one metric per benchmark. */
  private runBenchmark() {
    const bench = runNumericsBenchmarks();
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
        ? `All ${bench.length} numerics benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b: NumericsBenchmark) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项数值分析基准通过。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  /** Build the convergence + method-comparison panels and push them into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    const sample = selectSample(this.state.sample);
    const data = this.buildPanels(sample);
    const caption: Bilingual = {
      zh: `数值分析收敛对比（样本：${sample.labelZh}；求根迭代 ${this.state.iters}，积分区间 ${this.state.panels}，插值节点 ${this.state.nodes}）：实测阶 二分 ${fmtOrder(data.orders.bisection)}（理论 1）、梯形 ${fmtOrder(data.orders.trap)}（2）、Simpson ${fmtOrder(data.orders.simp)}（4）、中心差分 ${fmtOrder(data.orders.central)}（2）。误差口径 |计算−解析|/|解析|。`,
      en: `Numerics convergence comparison (sample: ${sample.labelEn}; ${this.state.iters} root iterations, ${this.state.panels} quadrature panels, ${this.state.nodes} interpolation nodes): measured orders bisection ${fmtOrder(data.orders.bisection)} (theory 1), trapezoid ${fmtOrder(data.orders.trap)} (2), Simpson ${fmtOrder(data.orders.simp)} (4), central difference ${fmtOrder(data.orders.central)} (2). Error metric |computed − analytic|/|analytic|.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '数值分析收敛与方法对比', en: 'Numerics Convergence & Method Comparison' },
      caption,
      numericsFigurePanels({
        sample,
        iters: this.state.iters,
        panels: this.state.panels,
        nodes: this.state.nodes,
      }),
    );
  }

  // ---- computation ------------------------------------------------------------

  private buildPanels(sample: SampleFunction): DrawData {
    const st = this.state;
    const [ba, bb] = sample.bracket;
    const bis = bisectRoot(sample.f, ba, bb, st.iters, sample.root);
    const newt = newtonRoot(sample.f, sample.df, ba + 0.3 * (bb - ba), st.iters, sample.root);
    const sec = secantRoot(sample.f, ba, ba + 0.3 * (bb - ba), st.iters, sample.root);

    const ladder = [...new Set([...PANEL_LADDER, st.panels])].sort((a, b) => a - b);
    const ref = sample.integral.value;
    const quadErrs = { trap: [] as ChartPoint[], simp: [] as ChartPoint[], gauss: [] as ChartPoint[] };
    for (const n of ladder) {
      quadErrs.trap.push({ x: n, y: Math.abs(trapezoidal(sample.f, sample.integral.a, sample.integral.b, n) - ref) });
      quadErrs.simp.push({ x: n, y: Math.abs(simpson(sample.f, sample.integral.a, sample.integral.b, n) - ref) });
      quadErrs.gauss.push({
        x: n,
        y: Math.abs(compositeGauss(sample.f, sample.integral.a, sample.integral.b, n, 3) - ref),
      });
    }
    const trapEst = trapezoidalEstimate(sample.f, sample.integral.a, sample.integral.b, st.panels);
    const simpEst = simpsonEstimate(sample.f, sample.integral.a, sample.integral.b, st.panels);
    const quadAt = {
      trap: Math.abs(trapezoidal(sample.f, sample.integral.a, sample.integral.b, st.panels) - ref),
      simp: Math.abs(simpson(sample.f, sample.integral.a, sample.integral.b, st.panels) - ref),
      gauss: Math.abs(compositeGauss(sample.f, sample.integral.a, sample.integral.b, st.panels, 3) - ref),
      trapEst: trapEst.estimate,
      simpEst: simpEst.estimate,
    };

    const fdH = Math.pow(10, st.fdExp);
    const exactD = sample.df(sample.xDiff);
    const fdErr = (d: number) => Math.abs(d - exactD) / Math.abs(exactD);
    const fdRel = {
      forward: fdErr(forwardDiff(sample.f, sample.xDiff, fdH)),
      backward: fdErr(backwardDiff(sample.f, sample.xDiff, fdH)),
      central: fdErr(centralDiff(sample.f, sample.xDiff, fdH)),
    };
    const fdPts = { fwd: [] as ChartPoint[], bwd: [] as ChartPoint[], cen: [] as ChartPoint[] };
    for (const h of FD_STEP_LADDER) {
      fdPts.fwd.push({ x: h, y: Math.abs(forwardDiff(sample.f, sample.xDiff, h) - exactD) });
      fdPts.bwd.push({ x: h, y: Math.abs(backwardDiff(sample.f, sample.xDiff, h) - exactD) });
      fdPts.cen.push({ x: h, y: Math.abs(centralDiff(sample.f, sample.xDiff, h) - exactD) });
    }

    const xs = equiNodes(sample.range[0], sample.range[1], st.nodes);
    const ys = xs.map((x) => sample.f(x));
    const naturalSegs = cubicSpline(xs, ys, 'natural');
    const clampedSegs = cubicSpline(xs, ys, 'clamped', [sample.df(xs[0]!), sample.df(xs[xs.length - 1]!)]);
    const exact: ChartPoint[] = [];
    const lag: ChartPoint[] = [];
    const nat: ChartPoint[] = [];
    const cla: ChartPoint[] = [];
    let lagMax = 0;
    let natMax = 0;
    let scale = 0;
    const GRID = 160;
    for (let s = 0; s <= GRID; s += 1) {
      const x = sample.range[0] + ((sample.range[1] - sample.range[0]) * s) / GRID;
      const y = sample.f(x);
      const yl = lagrangeInterp(xs, ys, x);
      const yn = splineEval(naturalSegs, xs, x);
      const yc = splineEval(clampedSegs, xs, x);
      exact.push({ x, y });
      lag.push({ x, y: yl });
      nat.push({ x, y: yn });
      cla.push({ x, y: yc });
      if (Number.isFinite(y)) scale = Math.max(scale, Math.abs(y));
      if (Number.isFinite(yl) && Number.isFinite(y)) lagMax = Math.max(lagMax, Math.abs(yl - y));
      if (Number.isFinite(yn) && Number.isFinite(y)) natMax = Math.max(natMax, Math.abs(yn - y));
    }
    let nodeMax = 0;
    const nodePts: ChartPoint[] = [];
    for (let i = 0; i < xs.length; i += 1) {
      const d = Math.abs(splineEval(naturalSegs, xs, xs[i]!) - ys[i]!);
      if (Number.isFinite(d)) nodeMax = Math.max(nodeMax, d);
      nodePts.push({ x: xs[i]!, y: ys[i]! });
    }
    if (!(scale > 0)) scale = 1;

    const bisErrs = bis.steps.map((s) => s.err);
    const windowEnd = Math.max(0, Math.min(35, bisErrs.length - 1));
    const bisectionOrder = fitIterationOrder(bisErrs, Math.min(10, Math.max(0, windowEnd - 4)), windowEnd);
    const orderOf = (pts: ChartPoint[]): number =>
      fitLogLogOrder(
        pts.map((p) => p.x),
        pts.map((p) => p.y),
        1e-13,
      );
    const fdWindow = fdPts.cen.filter((p) => p.x >= 1e-4);
    const centralOrder = fitLogLogOrder(
      fdWindow.map((p) => p.x),
      fdWindow.map((p) => p.y),
      1e-13,
    );

    return {
      roots: { bis, newt, sec },
      quadErrs,
      quadAt,
      fdH,
      fdRel,
      fdPts,
      interp: { exact, lag, nat, cla, nodes: nodePts, lagMax, natMax, nodeMax, scale },
      orders: {
        bisection: bisectionOrder,
        trap: orderOf(quadErrs.trap),
        simp: orderOf(quadErrs.simp),
        gauss: orderOf(quadErrs.gauss),
        central: centralOrder,
      },
    };
  }

  // ---- science outputs ----------------------------------------------------------

  private publishScience(sample: SampleFunction, d: DrawData): void {
    const zh = this.zh;
    const metrics: ScienceMetric[] = [];
    const rootRel = (r: RootResult): number => {
      if (!Number.isFinite(r.root)) return NaN;
      return Math.abs(r.root - sample.root) / Math.abs(sample.root);
    };
    const rootRows: Array<{ key: string; labelZh: string; labelEn: string; r: RootResult }> = [
      { key: 'bisection', labelZh: '二分法', labelEn: 'bisection', r: d.roots.bis },
      { key: 'newton', labelZh: 'Newton', labelEn: 'Newton', r: d.roots.newt },
      { key: 'secant', labelZh: '割线法', labelEn: 'secant', r: d.roots.sec },
    ];
    for (const row of rootRows) {
      const r = row.r;
      const e = rootRel(r);
      metrics.push({
        key: `root-${row.key}`,
        label: zh ? `求根误差 ${row.labelZh}` : `Root error ${row.labelEn}`,
        value: fmtMetric(e),
        severity: !Number.isFinite(e) ? 'error' : e < 1e-6 ? 'ok' : e < 1e-2 ? 'warn' : 'error',
        hint: zh
          ? `对照解析根 ${fmtMetric(sample.root)}（${sample.formula}），${r.steps.length} 步${r.converged ? '内收敛' : '未标记收敛'}，口径 |计算−解析|/|解析|`
          : `against analytic root ${fmtMetric(sample.root)} (${sample.formula}), ${r.steps.length} steps, ${r.converged ? 'converged' : 'not flagged converged'}, metric |computed − analytic|/|analytic|`,
      });
    }
    metrics.push({
      key: 'order-bisection',
      label: zh ? '二分法实测收敛阶' : 'Bisection measured order',
      value: fmtOrder(d.orders.bisection),
      severity: orderSeverity(d.orders.bisection, 1),
      hint: zh
        ? 'log₂|误差| 对迭代号的最小二乘斜率；理论阶 1（相邻误差比 ≈ 1/2）'
        : 'least-squares slope of log2|error| vs iteration; theoretical order 1 (neighbouring error ratio ≈ 1/2)',
    });

    const quadRows: Array<[string, string, number, number]> = [
      ['trapezoid', '梯形法', d.quadAt.trap, d.quadAt.trapEst],
      ['simpson', 'Simpson', d.quadAt.simp, d.quadAt.simpEst],
      ['gauss3', 'Gauss-3 点', d.quadAt.gauss, Number.NaN],
    ];
    for (const [id, zhName, err, est] of quadRows) {
      const rel = err / Math.abs(sample.integral.value);
      metrics.push({
        key: `quad-${id}`,
        label: zh ? `积分误差 ${zhName}` : `Quadrature error ${id}`,
        value: fmtMetric(rel),
        severity: errSeverity(rel),
        hint: Number.isFinite(est)
          ? zh
            ? `${this.state.panels} 个子区间，解析 ∫ = ${fmtMetric(sample.integral.value)}，Richardson 误差估计 ${fmtMetric(est)}（口径 |计算−解析|/|解析|）`
            : `${this.state.panels} panels, analytic ∫ = ${fmtMetric(sample.integral.value)}, Richardson estimate ${fmtMetric(est)} (metric |computed − analytic|/|analytic|)`
          : zh
            ? `${this.state.panels} 个子区间 × 3 点 Gauss，解析 ∫ = ${fmtMetric(sample.integral.value)}（口径 |计算−解析|/|解析|）`
            : `${this.state.panels} panels × 3-point Gauss, analytic ∫ = ${fmtMetric(sample.integral.value)} (metric |computed − analytic|/|analytic|)`,
      });
    }

    const fdRows: Array<[string, string, number]> = [
      ['forward', '前向差分', d.fdRel.forward],
      ['backward', '后向差分', d.fdRel.backward],
      ['central', '中心差分', d.fdRel.central],
    ];
    for (const [id, zhName, rel] of fdRows) {
      metrics.push({
        key: `diff-${id}`,
        label: zh ? `微分误差 ${zhName}` : `Derivative error ${id}`,
        value: fmtMetric(rel),
        severity: errSeverity(rel),
        hint: zh
          ? `h = ${fmtMetric(d.fdH)}，f′(${fmtMetric(sample.xDiff)}) = ${fmtMetric(sample.df(sample.xDiff))}，前向/后向为 O(h)、中心为 O(h²)（口径 |计算−解析|/|解析|）`
          : `h = ${fmtMetric(d.fdH)}, f′(${fmtMetric(sample.xDiff)}) = ${fmtMetric(sample.df(sample.xDiff))}, forward/backward O(h) vs central O(h²) (metric |computed − analytic|/|analytic|)`,
      });
    }

    const lagRel = d.interp.lagMax / d.interp.scale;
    metrics.push({
      key: 'interp-lagrange',
      label: zh ? 'Lagrange 插值最大误差' : 'Lagrange max interpolation error',
      value: fmtMetric(lagRel),
      severity: errSeverity(lagRel),
      hint: zh
        ? `max|L − f| / max|f| 归一（解析函数过零，逐点相对误差在零点无定义），${this.state.nodes} 个等距节点`
        : 'max|L − f| / max|f| normalization (the reference crosses zero, pointwise relative error undefined there), equispaced nodes',
    });
    const nodeRel = d.interp.nodeMax / d.interp.scale;
    metrics.push({
      key: 'interp-spline-node',
      label: zh ? '样条节点复现误差' : 'Spline node reproduction error',
      value: fmtMetric(nodeRel),
      severity: nodeRel < 1e-9 ? 'ok' : nodeRel < 1e-6 ? 'warn' : 'error',
      hint: zh
        ? `max|S(x_i) − y_i| / max|f| = ${fmtMetric(d.interp.nodeMax)} / ${fmtMetric(d.interp.scale)}；自然样条整体 max|S − f| / max|f| = ${fmtMetric(d.interp.natMax / d.interp.scale)}`
        : `max|S(x_i) − y_i| / max|f| = ${fmtMetric(d.interp.nodeMax)} / ${fmtMetric(d.interp.scale)}; natural spline overall max|S − f| / max|f| = ${fmtMetric(d.interp.natMax / d.interp.scale)}`,
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
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const sample = selectSample(this.state.sample);
    const data = this.buildPanels(sample);
    this.publishScience(sample, data);

    const W = canvas.width;
    const H = canvas.height;
    const padX = 14;
    const gapX = 26;
    const gapY = 16;
    const top = 42;
    const footH = 34;
    const cw = (W - 2 * padX - gapX) / 2;
    const ch = Math.max(90, (H - top - footH - gapY) / 2);
    const col = [padX, padX + cw + gapX];
    const row = [top, top + ch + gapY];

    // series (locale labels)
    const rootSeries: ChartSeries[] = [
      {
        name: zh ? '二分法' : 'bisection',
        color: '#6db4ff',
        pts: data.roots.bis.steps.map((s) => ({ x: s.k, y: s.err })),
      },
      {
        name: 'Newton',
        color: '#ffb250',
        pts: data.roots.newt.steps.map((s) => ({ x: s.k, y: s.err })),
      },
      {
        name: zh ? '割线法' : 'secant',
        color: '#4be1c3',
        pts: data.roots.sec.steps.map((s) => ({ x: s.k, y: s.err })),
      },
    ];
    const orderTag = (m: number, t: number): string => (Number.isFinite(m) ? `${m.toFixed(1)}/${t}` : `–/${t}`);
    const quadSeries: ChartSeries[] = [
      {
        name: zh ? `梯形 ${orderTag(data.orders.trap, 2)}` : `trapezoid ${orderTag(data.orders.trap, 2)}`,
        color: '#6db4ff',
        pts: data.quadErrs.trap,
      },
      {
        name: zh ? `Simpson ${orderTag(data.orders.simp, 4)}` : `Simpson ${orderTag(data.orders.simp, 4)}`,
        color: '#ffb250',
        pts: data.quadErrs.simp,
      },
      {
        name: zh ? `Gauss-3 ${orderTag(data.orders.gauss, 6)}` : `Gauss-3 ${orderTag(data.orders.gauss, 6)}`,
        color: '#f5a623',
        pts: data.quadErrs.gauss,
      },
    ];
    const fdSeries: ChartSeries[] = [
      {
        name: zh ? '前向 O(h)' : 'forward O(h)',
        color: '#6db4ff',
        pts: data.fdPts.fwd,
      },
      {
        name: zh ? '后向 O(h)' : 'backward O(h)',
        color: '#ffb250',
        pts: data.fdPts.bwd,
      },
      {
        name: zh ? `中心 O(h²) ${orderTag(data.orders.central, 2)}` : `central O(h²) ${orderTag(data.orders.central, 2)}`,
        color: '#4be1c3',
        pts: data.fdPts.cen,
      },
    ];
    const interpSeries: ChartSeries[] = [
      { name: zh ? '解析曲线' : 'exact', color: '#c8d2e1', pts: data.interp.exact },
      { name: 'Lagrange', color: '#ffb250', pts: data.interp.lag },
      { name: zh ? '自然样条' : 'natural spline', color: '#4be1c3', pts: data.interp.nat },
      { name: zh ? '夹持样条' : 'clamped spline', color: '#f5a623', pts: data.interp.cla },
      { name: zh ? '插值节点' : 'nodes', color: '#ff7a7a', pts: data.interp.nodes },
    ];

    drawMiniChart(g, {
      x: col[0]!,
      y: row[0]!,
      w: cw,
      h: ch,
      title: zh ? '求根迭代误差衰减（对数纵轴）' : 'Root-finding error decay (log y)',
      xLabel: zh ? '迭代 k' : 'iteration k',
      yLabel: '|x_k − root|',
      logX: false,
      logY: true,
      series: rootSeries,
    });
    drawMiniChart(g, {
      x: col[1]!,
      y: row[0]!,
      w: cw,
      h: ch,
      title: zh ? '积分误差 vs 子区间数（log-log）' : 'Quadrature error vs panels (log-log)',
      xLabel: zh ? '子区间数 n' : 'panel count n',
      yLabel: '|I_h − I|',
      logX: true,
      logY: true,
      series: quadSeries,
    });
    drawMiniChart(g, {
      x: col[0]!,
      y: row[1]!,
      w: cw,
      h: ch,
      title: zh ? '差分误差 vs 步长 h（log-log）' : 'Finite-difference error vs h (log-log)',
      xLabel: 'h',
      yLabel: '|D_h − f′|',
      logX: true,
      logY: true,
      series: fdSeries,
    });
    drawMiniChart(g, {
      x: col[1]!,
      y: row[1]!,
      w: cw,
      h: ch,
      title: zh ? '插值与解析函数对比' : 'Interpolation vs exact function',
      xLabel: 'x',
      yLabel: 'f(x)',
      logX: false,
      logY: false,
      series: interpSeries,
    });

    // ---- title, info line, bilingual footer --------------------------------------
    g.font = `13px Consolas, 'Microsoft YaHei', monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(240,244,250,0.92)';
    g.fillText(`Numerical Analysis Lab · 数值分析实验室`, W / 2, 16);
    g.font = `10px Consolas, 'Microsoft YaHei', monospace`;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(
      zh
        ? `样例：${sample.labelZh}｜迭代 ${this.state.iters}｜积分区间 ${this.state.panels}｜节点 ${this.state.nodes}｜差分步长 10^${this.state.fdExp}`
        : `Sample: ${sample.labelEn} | iterations ${this.state.iters} | panels ${this.state.panels} | nodes ${this.state.nodes} | FD h = 1e${this.state.fdExp}`,
      padX,
      31,
    );
    g.textAlign = 'center';
    g.fillStyle = 'rgba(160,175,195,0.95)';
    g.fillText(
      zh
        ? `实测阶/理论：二分 ${fmtOrder(data.orders.bisection)}/1，梯形 ${fmtOrder(data.orders.trap)}/2，Simpson ${fmtOrder(data.orders.simp)}/4，Gauss-3 ${fmtOrder(data.orders.gauss)}/6，中心差分 ${fmtOrder(data.orders.central)}/2`
        : `Measured/theory: bisection ${fmtOrder(data.orders.bisection)}/1, trapezoid ${fmtOrder(data.orders.trap)}/2, Simpson ${fmtOrder(data.orders.simp)}/4, Gauss-3 ${fmtOrder(data.orders.gauss)}/6, central diff ${fmtOrder(data.orders.central)}/2`,
      W / 2,
      H - 21,
    );
    g.fillStyle = 'rgba(140,152,172,0.95)';
    g.fillText(
      zh
        ? '口径 |计算−解析|/|解析|（解析值为 0 时用绝对误差）；颜色：蓝=二分/梯形/前向，橙=Newton/Simpson/后向，青=割线/Gauss/中心'
        : 'metric |computed − analytic|/|analytic| (absolute error when the analytic value is 0); colors: blue = bisection/trapezoid/forward, orange = Newton/Simpson/backward, teal = secant/Gauss/central',
      W / 2,
      H - 7,
    );
  }
}

export default function createMathNumericsPlugin(): Plugin {
  return new MathNumericsPlugin();
}
