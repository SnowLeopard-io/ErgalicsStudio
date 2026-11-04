// ==========================================================================
// socio-popforecast — Leslie matrix population projection workbench
//
// Left canvas panel: the animated age-structure pyramid (population per age
// class at the current projection year, stable axis over the whole horizon).
// Right panel: total population over time plus the 65+ share series. Run/
// pause advances one year per timer tick, step advances ten, and the full
// deterministic projection is precomputed on rebuild. Every step republishes
// structured scientific outputs (total, growth rate lambda, 65+ share,
// dependency ratio, UN aging verdict).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { popForecastManifest } from './manifest';
import { popForecastFigurePanels } from './figure';
import {
  classifyAging,
  runPopForecastBenchmark,
  SCENARIO_MULTIPLIER,
  simulatePopForecast,
  DEFAULT_POP_PARAMS,
  type FertilityScenario,
  type PopForecastParams,
  type PopRun,
} from './kernel';

export { popForecastManifest } from './manifest';

const CLASS_OPTIONS = ['8', '10', '16'];
const SCENARIO_ZH: Record<FertilityScenario, string> = { high: '高', medium: '中', low: '低' };
const PYRAMID_COLOR = 'rgba(108,142,176,0.92)';
const TOTAL_COLOR = 'rgba(118,158,196,0.95)';
const SHARE_COLOR = 'rgba(198,158,112,0.95)';

export class PopForecastPlugin implements Plugin {
  readonly manifest = popForecastManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  private params: PopForecastParams = { ...DEFAULT_POP_PARAMS };
  private run: PopRun | null = null;
  private t = 0;
  private running = false;
  private timer: number | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    this.rebuild();
  }

  async destroy() {
    this.stopTimer();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stopTimer();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'classes',
        label: 'Age classes',
        labelI18n: { 'zh-CN': '年龄组数', 'en-US': 'Age classes' },
        type: 'select',
        options: CLASS_OPTIONS.map((v) => ({
          value: v,
          label: `${v} (${(80 / Number(v)).toFixed(0)}y)`,
          labelI18n: { 'zh-CN': `${v} 组（${(80 / Number(v)).toFixed(0)} 岁/组）`, 'en-US': `${v} (${(80 / Number(v)).toFixed(0)}y each)` },
        })),
        value: String(this.params.classes),
        hint: this.zh ? '每组宽度 = 80 / 组数（岁）' : 'class width = 80 / classes (years)',
      },
      {
        key: 'baseFertility',
        label: 'Fertility scale',
        labelI18n: { 'zh-CN': '生育率乘数', 'en-US': 'Fertility scale' },
        type: 'range',
        min: 0.4,
        max: 2.5,
        step: 0.05,
        value: this.params.baseFertility,
        hint: this.zh ? '乘在标准分年龄生育率表上（1 = 参照情形）' : 'multiplier on the standard fertility schedule (1 = reference)',
      },
      {
        key: 'survivalScale',
        label: 'Survival scale',
        labelI18n: { 'zh-CN': '存活率乘数', 'en-US': 'Survival scale' },
        type: 'range',
        min: 0.8,
        max: 1.1,
        step: 0.005,
        value: this.params.survivalScale,
        hint: this.zh ? '乘在标准分年龄存活率表上（截断于 0.9995）' : 'multiplier on the standard survival schedule (capped at 0.9995)',
      },
      {
        key: 'scenario',
        label: 'Fertility scenario',
        labelI18n: { 'zh-CN': '生育情景', 'en-US': 'Fertility scenario' },
        type: 'select',
        options: [
          { value: 'high', label: this.zh ? '高（×1.25）' : 'high (x1.25)', labelI18n: { 'zh-CN': '高（×1.25）', 'en-US': 'high (x1.25)' } },
          { value: 'medium', label: this.zh ? '中（×1.00）' : 'medium (x1.00)', labelI18n: { 'zh-CN': '中（×1.00）', 'en-US': 'medium (x1.00)' } },
          { value: 'low', label: this.zh ? '低（×0.75）' : 'low (x0.75)', labelI18n: { 'zh-CN': '低（×0.75）', 'en-US': 'low (x0.75)' } },
        ],
        value: this.params.scenario,
      },
      {
        key: 'migrationPerYear',
        label: 'Net migration / yr',
        labelI18n: { 'zh-CN': '每年净迁移', 'en-US': 'Net migration / yr' },
        type: 'range',
        min: -50000,
        max: 50000,
        step: 500,
        value: this.params.migrationPerYear,
        hint: this.zh ? '每年净迁移总量，均匀分配到各年龄组' : 'yearly net-migration total, spread uniformly across age classes',
      },
      {
        key: 'years',
        label: 'Years to project',
        labelI18n: { 'zh-CN': '预测年数', 'en-US': 'Years to project' },
        type: 'range',
        min: 20,
        max: 300,
        step: 10,
        value: this.params.years,
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Seed' },
        type: 'range',
        min: 1,
        max: 999999,
        step: 1,
        value: this.params.seed,
        hint: this.zh ? '固定种子 ⇒ 初始分布与预测完全可复现' : 'fixed seed ⇒ fully reproducible initial state and projection',
      },
      actionButton('step10', 'Step x10', '步进 ×10'),
      actionButton('start', 'Run', '运行', 'primary'),
      actionButton('stop', 'Pause', '暂停'),
      actionButton('reset', 'Reset', '重置'),
      actionButton('benchmark', 'Run benchmark', '运行基准验证'),
      actionButton('exportCsv', 'Export population series', '导出人口序列'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, apply: (n: number) => void): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) apply(params[k] as number);
    };
    num('baseFertility', (n) => {
      const v = Math.min(2.5, Math.max(0.4, n));
      if (v !== this.params.baseFertility) {
        this.params.baseFertility = v;
        this.rebuild();
      }
    });
    num('survivalScale', (n) => {
      const v = Math.min(1.1, Math.max(0.8, n));
      if (v !== this.params.survivalScale) {
        this.params.survivalScale = v;
        this.rebuild();
      }
    });
    num('migrationPerYear', (n) => {
      const v = Math.min(50000, Math.max(-50000, Math.round(n / 500) * 500));
      if (v !== this.params.migrationPerYear) {
        this.params.migrationPerYear = v;
        this.rebuild();
      }
    });
    num('years', (n) => {
      const v = Math.min(300, Math.max(20, Math.round(n)));
      if (v !== this.params.years) {
        this.params.years = v;
        this.rebuild();
      }
    });
    num('seed', (n) => {
      const s = Math.max(1, Math.round(n));
      if (s !== this.params.seed) {
        this.params.seed = s;
        this.rebuild();
      }
    });
    if (typeof params.classes === 'string' && CLASS_OPTIONS.includes(params.classes)) {
      const n = Number(params.classes);
      if (n !== this.params.classes) {
        this.params.classes = n;
        this.rebuild();
      }
    }
    if (typeof params.scenario === 'string' && (params.scenario === 'high' || params.scenario === 'medium' || params.scenario === 'low')) {
      if (params.scenario !== this.params.scenario) {
        this.params.scenario = params.scenario as FertilityScenario;
        this.rebuild();
      }
    }

    if (actionFired(params, 'step10')) {
      this.stopTimer();
      for (let i = 0; i < 10; i += 1) this.stepOnce();
    }
    if (actionFired(params, 'start')) this.startTimer();
    if (actionFired(params, 'stop')) this.stopTimer();
    if (actionFired(params, 'reset')) {
      this.stopTimer();
      this.rebuild();
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
    this.draw();
  }

  // ---- simulation control -----------------------------------------------------

  /** Precompute the full deterministic projection and rewind to year 0. */
  private rebuild() {
    this.stopTimer();
    this.run = simulatePopForecast(this.params);
    this.t = 0;
    this.publishOutputs();
  }

  private stepOnce() {
    const run = this.run;
    if (!run) return;
    if (this.t < run.years) {
      this.t += 1;
      this.publishOutputs();
    }
    if (this.t >= run.years) this.stopTimer();
  }

  private startTimer() {
    if (this.running) return;
    const run = this.run;
    if (!run || this.t >= run.years) return;
    this.running = true;
    this.timer = window.setInterval(() => {
      this.stepOnce();
      this.draw();
    }, 120);
  }

  private stopTimer() {
    this.running = false;
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ---- scientific outputs -------------------------------------------------------

  private publishOutputs() {
    const run = this.run;
    if (!run) {
      setScienceOutputs(this.manifest.id, []);
      return;
    }
    const zh = this.zh;
    const total = run.totals[this.t] ?? 0;
    const share = run.share65[this.t] ?? 0;
    const dep = run.dependency[this.t] ?? 0;
    const verdict = classifyAging(share);
    const severity = verdict.key === 'young' ? 'ok' : verdict.key === 'aging' ? 'info' : 'warn';
    const scenMul = SCENARIO_MULTIPLIER[this.params.scenario] ?? 1;
    const metrics: ScienceMetric[] = [
      {
        key: 'year',
        label: zh ? '年份' : 'Year',
        value: `${this.t} / ${run.years}`,
        severity: 'info',
        hint: zh
          ? `${run.classes} 个年龄组（${(80 / run.classes).toFixed(0)} 岁/组），生育 ×${(this.params.baseFertility * scenMul).toFixed(2)}，存活 ×${this.params.survivalScale.toFixed(3)}`
          : `${run.classes} classes of ${(80 / run.classes).toFixed(0)}y, fertility x${(this.params.baseFertility * scenMul).toFixed(2)}, survival x${this.params.survivalScale.toFixed(3)}`,
      },
      {
        key: 'total',
        label: zh ? '总人口' : 'Total',
        value: fmtMetric(total),
        severity: 'info',
        hint: zh ? '当前年份各年龄组人口之和（初始规模 100 万）' : 'sum over age classes at the current year (initial size 1,000,000)',
      },
      {
        key: 'lambda',
        label: 'λ',
        value: fmtMetric(run.lambda),
        severity: run.lambda >= 1 ? 'ok' : 'warn',
        hint: zh
          ? 'Leslie 矩阵主导特征值 = 长期年增长率（幂法，固定 600 次迭代）'
          : 'dominant eigenvalue of the Leslie matrix = long-run annual growth rate (power iteration, fixed 600 iterations)',
      },
      {
        key: 'share65',
        label: zh ? '65+ 占比' : '65+ share',
        value: fmtMetric(share * 100),
        unit: '%',
        severity,
        hint: zh
          ? '65 岁及以上人口占比（联合国判据：<7% 年轻、7–14% 老龄化、>14% 老年）'
          : 'population share aged 65+ (UN convention: <7% young, 7-14% aging, >14% aged)',
      },
      {
        key: 'dependency',
        label: zh ? '抚养比' : 'Dependency',
        value: fmtMetric(dep),
        unit: '%',
        severity: 'info',
        hint: zh
          ? '（近似 0–14 岁 + 65+ 岁）/（近似 15–64 岁）×100，按年龄组下界归组'
          : '(approx. 0-14 + 65+) / (approx. 15-64) x 100; classes assigned by lower age bound',
      },
      {
        key: 'verdict',
        label: zh ? '老龄化判据' : 'Aging verdict',
        value: zh ? verdict.zh : verdict.en,
        severity,
        hint: zh ? '按当前年份 65+ 占比的定性分类' : 'qualitative classification of the current 65+ share',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmark() {
    const b = runPopForecastBenchmark();
    const d = b.details;
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-status',
        label: 'Benchmark',
        value: b.pass ? (this.zh ? '全部通过' : 'ALL PASS') : this.zh ? '未通过' : 'FAIL',
        severity: b.pass ? 'ok' : 'error',
        hint: this.zh ? '内嵌 Leslie 特征值/投影验证组（非用户数据）' : 'embedded Leslie eigen/projection validation battery (not user data)',
      },
      {
        key: 'bench-eigen',
        label: this.zh ? '特征值误差' : 'Eigenvalue error',
        value: fmtMetric(d.eigenError),
        severity: b.eigenOk ? 'ok' : 'error',
        hint: this.zh
          ? 'L=[[0,4,9],[0.5,0,0],[0,0.6,0]]：幂法 λ 与特征方程 λ³−2λ−2.7=0 的卡尔丹诺闭式解之相对误差'
          : 'L=[[0,4,9],[0.5,0,0],[0,0.6,0]]: relative |power-iteration lambda - Cardano root| of lambda^3 - 2 lambda - 2.7 = 0',
      },
      {
        key: 'bench-stable',
        label: this.zh ? '稳定分布收敛' : 'Stable distribution',
        value: b.stableConvergence ? (this.zh ? '收敛' : 'converged') : this.zh ? '未收敛' : 'diverged',
        severity: b.stableConvergence ? 'ok' : 'error',
        hint: this.zh
          ? `400 年投影的年龄构成 vs 优势特征向量，最大分量偏差 ${fmtMetric(d.stableMaxDiff)}`
          : `max component deviation of the 400-year projected composition vs the dominant eigenvector: ${fmtMetric(d.stableMaxDiff)}`,
      },
      {
        key: 'bench-extinct',
        label: this.zh ? '零生育消亡' : 'Zero-fertility extinction',
        value: b.extinction ? (this.zh ? '几何消亡' : 'geometric decay') : this.zh ? '未消亡' : 'persisting',
        severity: b.extinction ? 'ok' : 'error',
        hint: this.zh ? `240 年后末/初总人口比 ${d.extinctionRatio.toExponential(2)}（判据 < 1e-12）` : `final/initial total ratio after 240 years: ${d.extinctionRatio.toExponential(2)} (criterion < 1e-12)`,
      },
      {
        key: 'bench-migration',
        label: this.zh ? '迁移累加恒等' : 'Migration cumulative sum',
        value: b.migrationCumulative ? (this.zh ? '精确' : 'exact') : this.zh ? '偏差' : 'biased',
        severity: b.migrationCumulative ? 'ok' : 'error',
        hint: this.zh
          ? `1 阶恒等 Leslie 矩阵 L=[[1]]：100 年最大 |total_t − (total_0 + t·Σm)| = ${fmtMetric(d.migrationMaxErr)}`
          : '1-class identity Leslie L=[[1]]: max |total_t - (total_0 + t*sum(m))| over 100 years',
      },
      {
        key: 'bench-determinism',
        label: this.zh ? '固定种子确定性' : 'Seed determinism',
        value: b.deterministic ? (this.zh ? '可复现' : 'reproducible') : this.zh ? '不可复现' : 'irreproducible',
        severity: b.deterministic ? 'ok' : 'error',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      b.pass ? 'success' : 'warning',
      `Benchmark ${b.pass ? 'passed' : 'FAILED'}: eigen err ${d.eigenError.toExponential(2)}, stable diff ${d.stableMaxDiff.toExponential(2)}, migration err ${d.migrationMaxErr.toExponential(2)}`,
      `基准验证${b.pass ? '通过' : '未通过'}：特征值误差 ${d.eigenError.toExponential(2)}、稳定分布偏差 ${d.stableMaxDiff.toExponential(2)}、迁移误差 ${d.migrationMaxErr.toExponential(2)}`,
    );
  }

  private exportCsv() {
    const run = this.run;
    if (!run) {
      notify(this.api, 'warning', 'No projection to export yet.', '暂无可导出的预测结果。');
      return;
    }
    const rows: Array<Array<number | string>> = run.totals.map((total, t) => [
      t,
      Number(total.toFixed(4)),
      Number((run.share65[t] ?? 0).toFixed(6)),
      Number((run.dependency[t] ?? 0).toFixed(4)),
    ]);
    exportRowsCsv(this.api, 'popforecast-timeseries', ['year', 'total', 'share_65plus', 'dependency_ratio_pct'], rows);
  }

  private async sendToFigure(): Promise<void> {
    const run = this.run;
    if (!run) {
      notify(this.api, 'warning', 'No projection to send yet.', '暂无可发送的预测结果。');
      return;
    }
    const verdict = classifyAging(run.share65[this.t] ?? 0);
    const scenMul = SCENARIO_MULTIPLIER[this.params.scenario] ?? 1;
    const caption: Bilingual = {
      zh: `Leslie 矩阵人口预测（${run.classes} 组，生育 ×${(this.params.baseFertility * scenMul).toFixed(2)}，存活 ×${this.params.survivalScale.toFixed(3)}，净迁移 ${this.params.migrationPerYear}/年）：λ=${run.lambda.toFixed(4)}，第 ${this.t} 年总人口=${fmtMetric(run.totals[this.t] ?? 0)}，${verdict.zh}。`,
      en: `Leslie matrix population projection (${run.classes} classes, fertility x${(this.params.baseFertility * scenMul).toFixed(2)}, survival x${this.params.survivalScale.toFixed(3)}, net migration ${this.params.migrationPerYear}/yr): lambda=${run.lambda.toFixed(4)}, year ${this.t} total=${fmtMetric(run.totals[this.t] ?? 0)}, ${verdict.en}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: 'Leslie 矩阵人口预测', en: 'Leslie Matrix Population Projection' },
      caption,
      popForecastFigurePanels({
        classes: run.classes,
        populations: run.populations,
        totals: run.totals,
        share65: run.share65,
        years: run.years,
      }),
    );
  }

  // ---- drawing -------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (!this.run) return;

    const panelTop = 42;
    const panelBottom = canvas.height - 52;
    const pyrW = Math.max(180, canvas.width * 0.4);
    this.drawPyramid(g, 54, panelTop, pyrW, panelBottom - panelTop);
    this.drawSeriesPanel(g, 54 + pyrW + 28, panelTop, canvas.width - (54 + pyrW + 28) - 20, panelBottom - panelTop);
    this.drawFooter(g, canvas);
  }

  private drawPyramid(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number) {
    const run = this.run;
    if (!run || w < 80 || h < 40) return;
    const zh = this.zh;
    const k = run.classes;
    const width = 80 / k;
    const labelW = 42;
    const plotX = ox + labelW;
    const plotW = Math.max(20, w - labelW - 4);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? `年龄结构金字塔 · 第 ${this.t} 年` : `Age pyramid — year ${this.t}`, ox + w / 2, oy - 8);

    // Stable axis: largest single-class population over the whole projection.
    let maxRef = 1e-9;
    for (const n of run.populations) {
      for (let i = 0; i < k; i += 1) maxRef = Math.max(maxRef, n[i] ?? 0);
    }
    const current = run.populations[this.t] ?? run.populations[run.populations.length - 1] ?? [];
    const barH = Math.max(2, h / k - 3);
    for (let i = 0; i < k; i += 1) {
      const y = oy + (i * h) / k;
      const bw = ((current[i] ?? 0) / maxRef) * plotW;
      g.fillStyle = PYRAMID_COLOR;
      g.fillRect(plotX, y, bw, barH);
      g.textAlign = 'right';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.font = '9px Consolas, monospace';
      g.fillText(String(Math.round(i * width)), plotX - 5, y + barH - 1);
    }
    g.textAlign = 'left';
    g.strokeStyle = 'rgba(255,255,255,0.25)';
    g.lineWidth = 1;
    g.strokeRect(plotX, oy, plotW, h);
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = '9px Consolas, monospace';
    g.fillText(zh ? '年龄(岁)' : 'age (y)', plotX + 2, oy + h + 12);
  }

  private drawSeriesPanel(
    g: CanvasRenderingContext2D,
    ox: number,
    oy: number,
    w: number,
    h: number,
  ) {
    const run = this.run;
    if (!run || w < 60 || h < 40) return;
    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '总人口与 65+ 占比时间序列' : 'Total population and 65+ share', ox + w / 2, oy - 8);

    let maxTotal = 1e-9;
    for (const v of run.totals) maxTotal = Math.max(maxTotal, v);
    let maxShare = 0.25;
    for (const v of run.share65) maxShare = Math.max(maxShare, v);

    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.strokeRect(ox, oy, w, h);
    g.font = '10px Consolas, monospace';
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText('0', ox - 4, oy + h);
    g.fillText(fmtMetric(maxTotal), ox - 4, oy + 8);
    g.fillText('0%', ox + w + 14, oy + h);
    g.fillText(`${(maxShare * 100).toFixed(0)}%`, ox + w + 14, oy + 8);

    const n = Math.max(run.years + 1, 2);
    const px = (t: number) => ox + (w * t) / (n - 1);
    const pyTotal = (v: number) => oy + h - (v / maxTotal) * h;
    const pyShare = (v: number) => oy + h - (v / maxShare) * h;
    const upTo = Math.min(this.t, run.years);

    g.strokeStyle = TOTAL_COLOR;
    g.lineWidth = 1.6;
    g.beginPath();
    for (let t = 0; t <= upTo; t += 1) {
      const x = px(t);
      const y = pyTotal(run.totals[t] ?? 0);
      if (t === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    g.strokeStyle = SHARE_COLOR;
    g.lineWidth = 1.4;
    g.beginPath();
    for (let t = 0; t <= upTo; t += 1) {
      const x = px(t);
      const y = pyShare(run.share65[t] ?? 0);
      if (t === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    // Legend (top-right inside the panel).
    g.textAlign = 'left';
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = TOTAL_COLOR;
    g.fillRect(ox + w - 150, oy + 6, 10, 3);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText(zh ? '总人口' : 'total', ox + w - 136, oy + 12);
    g.fillStyle = SHARE_COLOR;
    g.fillRect(ox + w - 84, oy + 6, 10, 3);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText(zh ? '65+ 占比' : '65+ share', ox + w - 70, oy + 12);

    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = '10px Consolas, monospace';
    g.fillText('0', ox, oy + h + 13);
    g.fillText(String(run.years), ox + w - 20, oy + h + 13);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const run = this.run;
    if (!run) return;
    const zh = this.zh;
    const total = run.totals[this.t] ?? 0;
    const share = run.share65[this.t] ?? 0;
    const dep = run.dependency[this.t] ?? 0;
    const verdict = classifyAging(share);
    const scenMul = SCENARIO_MULTIPLIER[this.params.scenario] ?? 1;
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const mig = this.params.migrationPerYear;
    const l1 = zh
      ? `年份 ${this.t}/${run.years}  ·  ${run.classes} 组（${(80 / run.classes).toFixed(0)} 岁/组）  ·  生育 ×${(this.params.baseFertility * scenMul).toFixed(2)}  ·  存活 ×${this.params.survivalScale.toFixed(3)}  ·  ${SCENARIO_ZH[this.params.scenario]}情景  ·  净迁移 ${mig >= 0 ? '+' : ''}${mig}/年  ·  λ=${run.lambda.toFixed(4)}`
      : `Year ${this.t}/${run.years}  ·  ${run.classes} classes of ${(80 / run.classes).toFixed(0)}y  ·  fertility x${(this.params.baseFertility * scenMul).toFixed(2)}  ·  survival x${this.params.survivalScale.toFixed(3)}  ·  ${this.params.scenario} scenario  ·  net migration ${mig >= 0 ? '+' : ''}${mig}/yr  ·  lambda=${run.lambda.toFixed(4)}`;
    g.fillText(l1, 54, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = zh
      ? `总人口=${fmtMetric(total)}  ·  65+ 占比=${(share * 100).toFixed(2)}%  ·  抚养比=${dep.toFixed(1)}%  ·  ${verdict.zh}`
      : `total=${fmtMetric(total)}  ·  65+ share=${(share * 100).toFixed(2)}%  ·  dependency=${dep.toFixed(1)}%  ·  ${verdict.en}`;
    g.fillText(l2, 54, canvas.height - 14);
  }
}

export default function createPopForecastPlugin(): Plugin {
  return new PopForecastPlugin();
}
