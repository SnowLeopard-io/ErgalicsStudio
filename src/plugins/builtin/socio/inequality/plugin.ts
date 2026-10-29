// ==========================================================================
// socio-inequality — income inequality workbench
//
// Left canvas panel: the Lorenz curve with the equality diagonal, the shaded
// inequality gap area and a Gini annotation (or the parent-child rank scatter
// when the mobility view is selected). Right panel: the income histogram on
// log bins, or a pre-tax vs post-tax Lorenz overlay when a tax regime is
// active. Every recompute republishes structured scientific outputs (Gini
// with bootstrap CI, Palma, Theil, Atkinson, 90/10, post-tax Gini and the
// redistribution effect, rank-rank slope, distribution verdict).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { inequalityManifest } from './manifest';
import { inequalityFigurePanels, incomeHistogramBars } from './figure';
import {
  applyTax,
  atkinsonIndex,
  classifyInequality,
  gini,
  giniBootstrapCI,
  generateIncomes,
  identifyDistribution,
  INEQUALITY_BENCHMARK,
  lorenzCurve,
  p90p10,
  p50p10,
  palmaRatio,
  runInequalityBenchmark,
  simulateMobility,
  theilIndex,
  type DistIdentification,
  type Distribution,
  type GiniBootstrapCI,
  type InequalityBenchmark,
  type LorenzPoint,
  type MobilityResult,
  type TaxRegime,
  type TaxResult,
} from './kernel';

export { inequalityManifest } from './manifest';

const N_OPTIONS = ['200', '500', '1000', '2000', '5000', '20000'];
const BOOT_OPTIONS = ['0', '100', '200', '500'];
const ATKINSON_EPSILON = 0.5;

const LORENZ_COLOR = 'rgba(96,168,255,0.95)';
const POST_TAX_COLOR = 'rgba(93,208,168,0.95)';
const EQUALITY_COLOR = 'rgba(160,172,190,0.85)';
const GAP_FILL = 'rgba(96,168,255,0.16)';
const BAR_FILL = 'rgba(96,168,255,0.55)';
const SCATTER_FILL = 'rgba(184,154,224,0.65)';

/** Default shape parameter per distribution family. */
const SHAPE_DEFAULT: Record<Distribution, number> = {
  'log-normal': 0.8,
  pareto: 3,
  'power-law': 2,
  exponential: 1,
};

interface IneqParams {
  distribution: Distribution;
  n: number;
  shape: number;
  bootReps: number;
  taxRegime: TaxRegime;
  taxRate: number;
  elasticity: number;
  view: 'distribution' | 'mobility';
  seed: number;
}

function severityOf(key: 'low' | 'moderate' | 'high' | 'severe'): ScienceMetric['severity'] {
  if (key === 'low') return 'ok';
  if (key === 'moderate') return 'info';
  if (key === 'high') return 'warn';
  return 'error';
}

export class InequalityPlugin implements Plugin {
  readonly manifest = inequalityManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  private params: IneqParams = {
    distribution: 'log-normal',
    n: 2000,
    shape: 0.8,
    bootReps: 200,
    taxRegime: 'progressive',
    taxRate: 0.35,
    elasticity: 0.4,
    view: 'distribution',
    seed: 20261029,
  };

  private incomes: number[] = [];
  private lorenz: LorenzPoint[] = [];
  private lorenzPost: LorenzPoint[] | null = null;
  private tax: TaxResult | null = null;
  private ci: GiniBootstrapCI | null = null;
  private ident: DistIdentification | null = null;
  private mobility: MobilityResult | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    this.recompute();
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    // No timers to stop — computation is click-driven.
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    const shapeLabel =
      this.params.distribution === 'log-normal'
        ? this.zh
          ? '形状参数 σ（对数正态）'
          : 'Shape sigma (log-normal)'
        : this.zh
          ? '形状参数 α（尾部指数）'
          : 'Shape alpha (tail exponent)';
    return [
      {
        key: 'distribution',
        label: 'Distribution',
        labelI18n: { 'zh-CN': '分布族', 'en-US': 'Distribution' },
        type: 'select',
        options: [
          { value: 'log-normal', label: this.zh ? '对数正态' : 'log-normal', labelI18n: { 'zh-CN': '对数正态', 'en-US': 'log-normal' } },
          { value: 'pareto', label: this.zh ? '帕累托' : 'Pareto', labelI18n: { 'zh-CN': '帕累托', 'en-US': 'Pareto' } },
          { value: 'power-law', label: this.zh ? '幂律（截断）' : 'power-law (truncated)', labelI18n: { 'zh-CN': '幂律（截断）', 'en-US': 'power-law (truncated)' } },
          { value: 'exponential', label: this.zh ? '指数' : 'exponential', labelI18n: { 'zh-CN': '指数', 'en-US': 'exponential' } },
        ],
        value: this.params.distribution,
      },
      {
        key: 'n',
        label: 'Population n',
        labelI18n: { 'zh-CN': '总体规模 n', 'en-US': 'Population n' },
        type: 'select',
        options: N_OPTIONS.map((v) => ({ value: v, label: v, labelI18n: { 'zh-CN': v, 'en-US': v } })),
        value: String(this.params.n),
      },
      {
        key: 'shape',
        label: shapeLabel,
        labelI18n: { 'zh-CN': shapeLabel, 'en-US': shapeLabel },
        type: 'range',
        min: 0.1,
        max: 8,
        step: 0.05,
        value: this.params.shape,
        hint: this.zh ? '对数正态取 σ（≤2.5），帕累托/幂律取尾部指数 α（≥1.2）' : 'sigma for log-normal (<= 2.5), tail exponent alpha for Pareto / power-law (>= 1.2)',
      },
      {
        key: 'bootReps',
        label: 'Bootstrap reps',
        labelI18n: { 'zh-CN': '自助重抽次数', 'en-US': 'Bootstrap reps' },
        type: 'select',
        options: BOOT_OPTIONS.map((v) => ({ value: v, label: v, labelI18n: { 'zh-CN': v, 'en-US': v } })),
        value: String(this.params.bootReps),
        hint: this.zh ? '0 = 不计算置信区间' : '0 = no confidence interval',
      },
      {
        key: 'taxRegime',
        label: 'Tax regime',
        labelI18n: { 'zh-CN': '税制', 'en-US': 'Tax regime' },
        type: 'select',
        options: [
          { value: 'none', label: this.zh ? '无税' : 'none', labelI18n: { 'zh-CN': '无税', 'en-US': 'none' } },
          { value: 'progressive', label: this.zh ? '累进' : 'progressive', labelI18n: { 'zh-CN': '累进', 'en-US': 'progressive' } },
          { value: 'flat', label: this.zh ? '比例' : 'flat', labelI18n: { 'zh-CN': '比例', 'en-US': 'flat' } },
          { value: 'regressive', label: this.zh ? '累退' : 'regressive', labelI18n: { 'zh-CN': '累退', 'en-US': 'regressive' } },
        ],
        value: this.params.taxRegime,
      },
      {
        key: 'taxRate',
        label: 'Tax rate',
        labelI18n: { 'zh-CN': '税率', 'en-US': 'Tax rate' },
        type: 'range',
        min: 0,
        max: 0.6,
        step: 0.05,
        value: this.params.taxRate,
        hint: this.zh ? '最高边际税率；级距按中位数划定（0.5m, 2m）' : 'top marginal rate; brackets at 0.5m and 2m of the median',
      },
      {
        key: 'elasticity',
        label: 'Mobility elasticity',
        labelI18n: { 'zh-CN': '代际弹性', 'en-US': 'Mobility elasticity' },
        type: 'range',
        min: 0,
        max: 0.9,
        step: 0.05,
        value: this.params.elasticity,
        hint: this.zh ? '子女对数收入对父母的代际弹性 ρ' : 'intergenerational elasticity rho of child log-income',
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'distribution', label: this.zh ? '分布与洛伦兹' : 'distribution & Lorenz', labelI18n: { 'zh-CN': '分布与洛伦兹', 'en-US': 'distribution & Lorenz' } },
          { value: 'mobility', label: this.zh ? '代际流动' : 'mobility', labelI18n: { 'zh-CN': '代际流动', 'en-US': 'mobility' } },
        ],
        value: this.params.view,
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
        hint: this.zh ? '固定种子 ⇒ 结果完全可复现' : 'fixed seed => fully reproducible results',
      },
      actionButton('recompute', 'Recompute', '重新计算', 'primary'),
      actionButton('mobility', 'Run mobility simulation', '运行代际流动模拟'),
      actionButton('benchmark', 'Run benchmark', '运行基准验证'),
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, apply: (v: number) => void): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) apply(params[k] as number);
    };
    if (typeof params.distribution === 'string' && params.distribution in SHAPE_DEFAULT) {
      const d = params.distribution as Distribution;
      if (d !== this.params.distribution) {
        this.params.distribution = d;
        this.params.shape = SHAPE_DEFAULT[d];
      }
    }
    if (typeof params.n === 'string' && N_OPTIONS.includes(params.n)) {
      const n = Number(params.n);
      if (n !== this.params.n) {
        this.params.n = n;
        this.recompute();
      }
    }
    if (typeof params.bootReps === 'string' && BOOT_OPTIONS.includes(params.bootReps)) {
      const reps = Number(params.bootReps);
      if (reps !== this.params.bootReps) {
        this.params.bootReps = reps;
        this.recompute();
      }
    }
    if (typeof params.taxRegime === 'string' && ['none', 'progressive', 'flat', 'regressive'].includes(params.taxRegime)) {
      this.params.taxRegime = params.taxRegime as TaxRegime;
    }
    if (typeof params.view === 'string' && (params.view === 'distribution' || params.view === 'mobility')) {
      this.params.view = params.view;
    }
    num('shape', (v) => {
      this.params.shape = Math.min(8, Math.max(0.1, v));
    });
    num('taxRate', (v) => {
      this.params.taxRate = Math.min(0.6, Math.max(0, v));
    });
    num('elasticity', (v) => {
      this.params.elasticity = Math.min(0.9, Math.max(0, v));
    });
    num('seed', (v) => {
      const s = Math.max(1, Math.round(v));
      if (s !== this.params.seed) {
        this.params.seed = s;
        this.recompute();
      }
    });

    if (actionFired(params, 'recompute')) this.recompute();
    if (actionFired(params, 'mobility')) this.runMobility();
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
    if (this.tax === null || this.params.taxRegime !== 'none' || this.lorenzPost === null) this.applyTaxAndLorenz();
    this.publishOutputs();
    this.draw();
  }

  // ---- computation -----------------------------------------------------------

  /** Regenerate the sample and all distribution-level statistics. */
  private recompute() {
    this.incomes = generateIncomes({
      distribution: this.params.distribution,
      n: this.params.n,
      shape: this.params.shape,
      seed: this.params.seed,
    });
    this.ci = this.params.bootReps > 0 ? giniBootstrapCI(this.incomes, this.params.bootReps, this.params.seed + 1) : null;
    this.ident = identifyDistribution(this.incomes, this.params.distribution);
    this.mobility = null;
    this.applyTaxAndLorenz();
    this.publishOutputs();
  }

  /** (Re)apply the tax counterfactual and refresh both Lorenz curves. */
  private applyTaxAndLorenz() {
    this.tax = applyTax(this.incomes, this.params.taxRegime, this.params.taxRate);
    this.lorenz = lorenzCurve(this.incomes);
    this.lorenzPost =
      this.params.taxRegime === 'none' ? null : lorenzCurve(this.tax.postTax);
  }

  private runMobility() {
    this.mobility = simulateMobility(this.params.n, this.params.elasticity, this.params.seed + 2);
    this.params.view = 'mobility';
    this.publishOutputs();
    notify(
      this.api,
      'success',
      `Mobility simulation done: rank-rank slope ${this.mobility.rankRankSlope.toFixed(4)}, IGE ${this.mobility.igeSlope.toFixed(4)}.`,
      `代际流动模拟完成：秩-秩斜率 ${this.mobility.rankRankSlope.toFixed(4)}，代际弹性估计 ${this.mobility.igeSlope.toFixed(4)}。`,
    );
  }

  // ---- scientific outputs -------------------------------------------------------

  private publishOutputs() {
    if (this.incomes.length === 0) {
      setScienceOutputs(this.manifest.id, []);
      return;
    }
    const zh = this.zh;
    const gEst = gini({ incomes: this.incomes });
    const verdict = classifyInequality(gEst);
    const metrics: ScienceMetric[] = [
      {
        key: 'n',
        label: 'n',
        value: String(this.incomes.length),
        severity: 'info',
        hint: zh ? `${this.params.distribution}，种子=${this.params.seed}` : `${this.params.distribution}, seed=${this.params.seed}`,
      },
      {
        key: 'gini',
        label: 'Gini',
        value: this.ci
          ? `${fmtMetric(this.ci.estimate)} [${fmtMetric(this.ci.lo)}, ${fmtMetric(this.ci.hi)}]`
          : fmtMetric(gEst),
        severity: severityOf(verdict.key),
        hint: zh
          ? '精确平均绝对差公式；方括号为 95% 自助百分位区间（固定种子）'
          : 'exact mean-absolute-difference formula; brackets = 95% seeded bootstrap percentile interval',
      },
      {
        key: 'palma',
        label: 'Palma',
        value: fmtMetric(palmaRatio(this.incomes)),
        severity: 'info',
        hint: zh ? '前 10% 收入份额 / 后 40% 收入份额（Palma 2011）' : 'top 10% income share / bottom 40% share (Palma 2011)',
      },
      {
        key: 'theil',
        label: 'Theil',
        value: fmtMetric(theilIndex(this.incomes)),
        severity: 'info',
        hint: zh ? '可分解 Theil 指数（Theil 1967）' : 'decomposable Theil index (Theil 1967)',
      },
      {
        key: 'atkinson',
        label: `Atkinson (eps=${ATKINSON_EPSILON})`,
        value: fmtMetric(atkinsonIndex(this.incomes, ATKINSON_EPSILON)),
        severity: 'info',
        hint: zh ? 'Atkinson 指数，不平等厌恶 ε=0.5（Atkinson 1970）' : 'Atkinson index at inequality aversion eps=0.5 (Atkinson 1970)',
      },
      {
        key: 'p90p10',
        label: '90/10',
        value: fmtMetric(p90p10(this.incomes)),
        severity: 'info',
        hint: zh ? 'P90/P10 分位比（50/10 见导出 CSV）' : 'P90/P10 percentile ratio (P50/P10 in the CSV export)',
      },
    ];

    if (this.ident) {
      const idLabel = this.ident.distribution === 'log-normal' ? 'sigma' : 'alpha';
      metrics.push({
        key: 'identification',
        label: zh ? '矩识别' : 'Moment fit',
        value: this.ident.hasIdentity
          ? `${idLabel}=${fmtMetric(this.ident.shape)}, G_th=${fmtMetric(this.ident.theoreticalGini)}, |dG|=${fmtMetric(this.ident.giniGap)}`
          : `${idLabel}=${fmtMetric(this.ident.shape)} (no closed-form G)`,
        severity: this.ident.hasIdentity && this.ident.giniGap < 0.05 ? 'ok' : 'info',
        hint: zh
          ? '矩估计参数；G_th 为该族理论基尼（幂律截断族无闭式解，仅报参数）'
          : 'moment-based shape estimate; G_th = theoretical Gini of the family (no closed form for the truncated power law)',
      });
    }

    if (this.tax && this.params.taxRegime !== 'none' && this.lorenzPost) {
      metrics.push({
        key: 'gini-post',
        label: zh ? '税后 Gini' : 'Post-tax Gini',
        value: fmtMetric(this.tax.giniPost),
        severity: severityOf(classifyInequality(this.tax.giniPost).key),
        hint: zh ? `${this.params.taxRegime === 'progressive' ? '累进' : this.params.taxRegime === 'flat' ? '比例' : '累退'}税制，平均税率 ${fmtMetric(this.tax.avgTaxRate)}` : `${this.params.taxRegime} regime, average tax rate ${fmtMetric(this.tax.avgTaxRate)}`,
      });
      metrics.push({
        key: 'redistribution',
        label: zh ? '再分配效应' : 'Redistribution',
        value: fmtMetric(this.tax.redistribution),
        severity: this.tax.redistribution > 0 ? 'ok' : 'info',
        hint: zh ? 'Reynolds-Smolensky 式效应：税前 Gini − 税后 Gini（不含再排序项）' : 'Reynolds-Smolensky-style effect: pre-tax minus post-tax Gini (no reranking term)',
      });
    }

    if (this.mobility) {
      metrics.push({
        key: 'rank-rank',
        label: zh ? '秩-秩斜率' : 'Rank-rank slope',
        value: fmtMetric(this.mobility.rankRankSlope),
        severity: 'info',
        hint: zh ? `子女百分位秩对父母百分位秩的 OLS 斜率；IGE=${fmtMetric(this.mobility.igeSlope)}` : `OLS slope of child percentile rank on parent rank; IGE=${fmtMetric(this.mobility.igeSlope)}`,
      });
    }

    metrics.push({
      key: 'verdict',
      label: zh ? '分布判据' : 'Distribution verdict',
      value: zh ? verdict.zh : verdict.en,
      severity: severityOf(verdict.key),
      hint: zh
        ? '点估计基尼的定性严重度分级：<0.25 低；0.25–0.35 中；0.35–0.45 高；≥0.45 严重'
        : 'qualitative severity classification of the point-estimate Gini: <0.25 low; 0.25-0.35 moderate; 0.35-0.45 high; >=0.45 severe',
    });

    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmark() {
    const b: InequalityBenchmark = runInequalityBenchmark();
    const d = b.details;
    const zh = this.zh;
    const ok = (flag: boolean) => (flag ? (zh ? '通过' : 'pass') : zh ? '未通过' : 'FAIL');
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-status',
        label: 'Benchmark',
        value: b.pass ? (zh ? '全部通过' : 'ALL PASS') : zh ? '未通过' : 'FAIL',
        severity: b.pass ? 'ok' : 'error',
        hint: zh ? '内嵌不平等度量验证组（非用户数据）：gini-exact + lorenz-closure' : 'embedded inequality validation battery (not user data): gini-exact + lorenz-closure',
      },
      {
        key: 'bench-tiny',
        label: zh ? '极小总体精确基尼' : 'Tiny-population exact Gini',
        value: ok(d.giniTinyExact),
        severity: d.giniTinyExact ? 'ok' : 'error',
        hint: zh ? '[1,1,1,1]=0、[0,0,0,4]=0.75、[1,2,3,4]=0.25（手工计算）' : '[1,1,1,1]=0, [0,0,0,4]=0.75, [1,2,3,4]=0.25 (hand-computed)',
      },
      {
        key: 'bench-ln',
        label: zh ? '对数正态恒等误差' : 'Log-normal identity err',
        value: fmtMetric(d.lognormalGiniErr),
        severity: d.lognormalGiniErr < 0.02 ? 'ok' : 'error',
        hint: zh ? `σ=${INEQUALITY_BENCHMARK.sigma}，n=${INEQUALITY_BENCHMARK.n}：|G_emp − (2Φ(σ/√2)−1)| < 0.02` : `sigma=${INEQUALITY_BENCHMARK.sigma}, n=${INEQUALITY_BENCHMARK.n}: |G_emp - (2*Phi(sigma/sqrt2)-1)| < 0.02`,
      },
      {
        key: 'bench-pareto',
        label: zh ? '帕累托恒等误差' : 'Pareto identity err',
        value: fmtMetric(d.paretoGiniErr),
        severity: d.paretoGiniErr < 0.02 ? 'ok' : 'error',
        hint: zh ? `α=${INEQUALITY_BENCHMARK.alpha}：|G_emp − 1/(2α−1)| < 0.02` : `alpha=${INEQUALITY_BENCHMARK.alpha}: |G_emp - 1/(2a-1)| < 0.02`,
      },
      {
        key: 'bench-exp',
        label: zh ? '指数恒等误差' : 'Exponential identity err',
        value: fmtMetric(d.exponentialGiniErr),
        severity: d.exponentialGiniErr < 0.02 ? 'ok' : 'error',
        hint: zh ? '指数分布基尼恒等于 1/2' : 'the exponential Gini is exactly 1/2',
      },
      {
        key: 'bench-closure',
        label: zh ? '洛伦兹端点闭合' : 'Lorenz closure',
        value: ok(d.lorenzClosure),
        severity: d.lorenzClosure ? 'ok' : 'error',
        hint: zh ? '曲线起点 (0,0)、终点 (1,1)' : 'curve starts at (0,0) and ends at (1,1)',
      },
      {
        key: 'bench-ci',
        label: zh ? '自助区间合理性' : 'Bootstrap CI sanity',
        value: ok(d.ciContainsEstimate && d.ciWidthPositive),
        severity: d.ciContainsEstimate && d.ciWidthPositive ? 'ok' : 'error',
        hint: zh ? '固定种子 95% 区间包含点估计且宽度为正' : 'the fixed-seed 95% interval contains the point estimate and has positive width',
      },
      {
        key: 'bench-determinism',
        label: zh ? '固定种子确定性' : 'Seed determinism',
        value: ok(d.deterministic),
        severity: d.deterministic ? 'ok' : 'error',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      b.pass ? 'success' : 'warning',
      `Benchmark ${b.pass ? 'passed' : 'FAILED'}: Gini identities, Lorenz closure, CI sanity, determinism.`,
      `基准验证${b.pass ? '通过' : '未通过'}：基尼恒等式、洛伦兹闭合、区间合理性、确定性。`,
    );
  }

  // imports are hoisted; keep the constant reference local for the hint text above
  private exportCsv() {
    const rows: Array<Array<number | string>> = [];
    for (let i = 0; i < this.lorenz.length; i += 1) {
      const p = this.lorenz[i]!;
      rows.push(['lorenz', Number(p.p.toFixed(6)), Number(p.l.toFixed(6)), this.lorenzPost ? Number(this.lorenzPost[i]?.l.toFixed(6) ?? '') : '']);
    }
    const gEst = gini({ incomes: this.incomes });
    const verdict = classifyInequality(gEst);
    const metricRows: Array<Array<number | string>> = [
      ['metric', 'n', this.incomes.length, ''],
      ['metric', 'gini', Number(gEst.toFixed(6)), this.ci ? Number(this.ci.estimate.toFixed(6)) : ''],
      ['metric', 'gini_ci_lo', this.ci ? Number(this.ci.lo.toFixed(6)) : '', ''],
      ['metric', 'gini_ci_hi', this.ci ? Number(this.ci.hi.toFixed(6)) : '', ''],
      ['metric', 'palma', Number(palmaRatio(this.incomes).toFixed(6)), ''],
      ['metric', 'theil', Number(theilIndex(this.incomes).toFixed(6)), ''],
      ['metric', 'atkinson_eps0.5', Number(atkinsonIndex(this.incomes, ATKINSON_EPSILON).toFixed(6)), ''],
      ['metric', 'p90p10', Number(p90p10(this.incomes).toFixed(6)), ''],
      ['metric', 'p50p10', Number(p50p10(this.incomes).toFixed(6)), ''],
      ['metric', 'gini_post_tax', this.tax ? Number(this.tax.giniPost.toFixed(6)) : '', ''],
      ['metric', 'redistribution', this.tax ? Number(this.tax.redistribution.toFixed(6)) : '', ''],
      ['metric', 'rank_rank_slope', this.mobility ? Number(this.mobility.rankRankSlope.toFixed(6)) : '', ''],
      ['metric', 'verdict', verdict.en, ''],
    ];
    exportRowsCsv(this.api, 'socio-inequality', ['kind', 'a', 'b', 'c'], [...rows, ...metricRows]);
  }

  private async sendToFigure(): Promise<void> {
    const gEst = gini({ incomes: this.incomes });
    const verdict = classifyInequality(gEst);
    const taxNote =
      this.tax && this.params.taxRegime !== 'none' && this.lorenzPost
        ? this.zh
          ? `税后基尼 ${this.tax.giniPost.toFixed(4)}（再分配 ${this.tax.redistribution.toFixed(4)}）。`
          : `Post-tax Gini ${this.tax.giniPost.toFixed(4)} (redistribution ${this.tax.redistribution.toFixed(4)}).`
        : '';
    const caption: Bilingual = {
      zh: `不平等分析（${this.params.distribution}，n=${this.incomes.length}，种子=${this.params.seed}）：基尼 ${gEst.toFixed(4)}${this.ci ? ` [${this.ci.lo.toFixed(4)}, ${this.ci.hi.toFixed(4)}]` : ''}，Palma ${palmaRatio(this.incomes).toFixed(3)}，Theil ${theilIndex(this.incomes).toFixed(4)}，${verdict.zh}。${taxNote}`,
      en: `Inequality analysis (${this.params.distribution}, n=${this.incomes.length}, seed=${this.params.seed}): Gini ${gEst.toFixed(4)}${this.ci ? ` [${this.ci.lo.toFixed(4)}, ${this.ci.hi.toFixed(4)}]` : ''}, Palma ${palmaRatio(this.incomes).toFixed(3)}, Theil ${theilIndex(this.incomes).toFixed(4)}, ${verdict.en}. ${taxNote}`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '不平等分析', en: 'Inequality Analysis' },
      caption,
      inequalityFigurePanels({
        lorenz: this.lorenz,
        lorenzPostTax: this.lorenzPost,
        incomes: this.incomes,
        mobilityPairs: this.mobility ? this.mobility.pairs : null,
      }),
    );
  }

  // ---- drawing -------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 900;
    canvas.height = canvas.clientHeight || 440;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '不平等分析器：洛伦兹曲线与收入分布' : 'Inequality Analyzer: Lorenz curve and income distribution', canvas.width / 2, 24);

    const panelTop = 46;
    const panelBottom = canvas.height - 56;
    const h = Math.max(60, panelBottom - panelTop);
    const half = canvas.width / 2;
    const leftX = 58;
    const leftW = Math.max(60, half - leftX - 14);
    const rightX = half + 14;
    const rightW = Math.max(60, canvas.width - rightX - 24);

    if (this.params.view === 'mobility' && this.mobility) {
      this.drawRankScatter(g, leftX, panelTop, leftW, h);
    } else {
      this.drawLorenzPanel(g, leftX, panelTop, leftW, h);
    }
    if (this.params.taxRegime !== 'none' && this.lorenzPost && this.tax) {
      this.drawLorenzOverlay(g, rightX, panelTop, rightW, h);
    } else {
      this.drawHistogram(g, rightX, panelTop, rightW, h);
    }
    this.drawFooter(g, canvas);
  }

  /** Shared unit-square axes: ticks every 0.25 with roomy label spacing. */
  private drawUnitAxes(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number, xLabel: string, yLabel: string): void {
    const zh = this.zh;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.strokeRect(ox, oy, w, h);
    g.font = '10px Consolas, monospace';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k += 1) {
      const v = k / 4;
      const py = oy + h - v * h;
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(ox, py);
      g.lineTo(ox + w, py);
      g.stroke();
      g.fillText(v.toFixed(2), ox - 5, py + 3);
    }
    g.textAlign = 'center';
    for (let k = 0; k <= 4; k += 1) {
      const v = k / 4;
      const px = ox + v * w;
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(px, oy);
      g.lineTo(px, oy + h);
      g.stroke();
      g.fillText(v.toFixed(2), px, oy + h + 13);
    }
    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(xLabel, ox + w / 2, oy + h + 26);
    g.save();
    g.translate(ox - 34, oy + h / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(yLabel, 0, 0);
    g.restore();
  }

  private drawLorenzPanel(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number): void {
    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '洛伦兹曲线（阴影 = 不平等面积）' : 'Lorenz curve (shaded = inequality area)', ox + w / 2, oy - 8);
    this.drawUnitAxes(g, ox, oy, w, h, zh ? '累计人口份额' : 'cumulative population share', zh ? '累计收入份额' : 'cumulative income share');

    const px = (p: number) => ox + w * p;
    const py = (l: number) => oy + h - h * l;

    // shaded gap between the equality diagonal and the Lorenz curve
    g.beginPath();
    g.moveTo(px(0), py(0));
    g.lineTo(px(1), py(1));
    for (let i = this.lorenz.length - 1; i >= 0; i -= 1) {
      g.lineTo(px(this.lorenz[i]!.p), py(this.lorenz[i]!.l));
    }
    g.closePath();
    g.fillStyle = GAP_FILL;
    g.fill();

    // equality diagonal
    g.strokeStyle = EQUALITY_COLOR;
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(px(0), py(0));
    g.lineTo(px(1), py(1));
    g.stroke();
    g.setLineDash([]);

    // Lorenz curve
    g.strokeStyle = LORENZ_COLOR;
    g.lineWidth = 1.8;
    g.beginPath();
    this.lorenz.forEach((p, i) => {
      if (i === 0) g.moveTo(px(p.p), py(p.l));
      else g.lineTo(px(p.p), py(p.l));
    });
    g.stroke();

    // Gini annotation
    const gEst = this.ci ? this.ci.estimate : gini({ incomes: this.incomes });
    g.textAlign = 'left';
    g.font = '11px Consolas, monospace';
    g.fillStyle = 'rgba(220,230,245,0.95)';
    const ann = this.ci
      ? `G = ${gEst.toFixed(4)}  [${this.ci.lo.toFixed(4)}, ${this.ci.hi.toFixed(4)}]`
      : `G = ${gEst.toFixed(4)}`;
    g.fillText(ann, ox + 8, oy + 16);
  }

  private drawLorenzOverlay(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number): void {
    const zh = this.zh;
    const post = this.lorenzPost!;
    const tax = this.tax!;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '税前 vs 税后洛伦兹曲线' : 'Pre-tax vs post-tax Lorenz', ox + w / 2, oy - 8);
    this.drawUnitAxes(g, ox, oy, w, h, zh ? '累计人口份额' : 'cumulative population share', zh ? '累计收入份额' : 'cumulative income share');

    const px = (p: number) => ox + w * p;
    const py = (l: number) => oy + h - h * l;

    g.strokeStyle = EQUALITY_COLOR;
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(px(0), py(0));
    g.lineTo(px(1), py(1));
    g.stroke();
    g.setLineDash([]);

    const curve = (pts: LorenzPoint[], color: string, width: number): void => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      pts.forEach((p, i) => {
        if (i === 0) g.moveTo(px(p.p), py(p.l));
        else g.lineTo(px(p.p), py(p.l));
      });
      g.stroke();
    };
    curve(post, POST_TAX_COLOR, 1.8);
    curve(this.lorenz, LORENZ_COLOR, 1.4);

    // legend
    g.textAlign = 'left';
    g.font = '10px Consolas, monospace';
    g.fillStyle = LORENZ_COLOR;
    g.fillText(zh ? '— 税前' : '- pre-tax', ox + 8, oy + 14);
    g.fillStyle = POST_TAX_COLOR;
    g.fillText(zh ? '— 税后' : '- post-tax', ox + 8, oy + 27);
    g.fillStyle = 'rgba(220,230,245,0.95)';
    g.font = '11px Consolas, monospace';
    g.fillText(
      zh
        ? `G ${tax.giniPre.toFixed(4)} -> ${tax.giniPost.toFixed(4)}  (RS = ${tax.redistribution.toFixed(4)})`
        : `G ${tax.giniPre.toFixed(4)} -> ${tax.giniPost.toFixed(4)}  (RS = ${tax.redistribution.toFixed(4)})`,
      ox + 8,
      oy + 44,
    );
  }

  private drawHistogram(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number): void {
    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '收入直方图（对数分箱）' : 'Income histogram (log bins)', ox + w / 2, oy - 8);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(ox, oy, w, h);

    const bars = incomeHistogramBars(this.incomes);
    if (bars.length === 0) return;
    const lo = bars[0]!.x0;
    const hi = bars[bars.length - 1]!.x1;
    let maxCount = 0;
    for (const b of bars) maxCount = Math.max(maxCount, b.y);
    const yStep = Math.max(1, Math.ceil(maxCount / 4));

    g.font = '10px Consolas, monospace';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.textAlign = 'right';
    for (let v = 0; v <= maxCount + yStep * 0.5; v += yStep) {
      const py = oy + h - (v / maxCount) * h;
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(ox, py);
      g.lineTo(ox + w, py);
      g.stroke();
      g.fillText(String(v), ox - 5, py + 3);
    }
    g.textAlign = 'center';
    const lo0 = Math.ceil(lo);
    const hi0 = Math.floor(hi);
    const step = Math.max(1, Math.ceil((hi0 - lo0) / 5));
    for (let t = lo0; t <= hi0; t += step) {
      const pxx = ox + ((t - lo) / (hi - lo)) * w;
      g.strokeStyle = 'rgba(255,255,255,0.06)';
      g.beginPath();
      g.moveTo(pxx, oy);
      g.lineTo(pxx, oy + h);
      g.stroke();
      g.fillText(`10^${t}`, pxx, oy + h + 13);
    }

    g.fillStyle = BAR_FILL;
    for (const b of bars) {
      const bx = ox + ((b.x0 - lo) / (hi - lo)) * w;
      const bw = Math.max(1, ((b.x1 - b.x0) / (hi - lo)) * w - 1);
      const bh = (b.y / maxCount) * h;
      g.fillRect(bx, oy + h - bh, bw, bh);
    }

    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? 'log10(收入)' : 'log10(income)', ox + w / 2, oy + h + 26);
    g.save();
    g.translate(ox - 34, oy + h / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(zh ? '频数' : 'count', 0, 0);
    g.restore();
  }

  private drawRankScatter(g: CanvasRenderingContext2D, ox: number, oy: number, w: number, h: number): void {
    const zh = this.zh;
    const mob = this.mobility!;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '代际流动：父母-子女百分位秩' : 'Mobility: parent-child percentile ranks', ox + w / 2, oy - 8);
    this.drawUnitAxes(g, ox, oy, w, h, zh ? '父母百分位秩' : 'parent percentile rank', zh ? '子女百分位秩' : 'child percentile rank');

    const px = (p: number) => ox + w * p;
    const py = (l: number) => oy + h - h * l;

    g.strokeStyle = EQUALITY_COLOR;
    g.lineWidth = 1;
    g.setLineDash([4, 3]);
    g.beginPath();
    g.moveTo(px(0), py(0));
    g.lineTo(px(1), py(1));
    g.stroke();
    g.setLineDash([]);

    g.fillStyle = SCATTER_FILL;
    for (const p of mob.pairs) {
      g.beginPath();
      g.arc(px(p.parentRank), py(p.childRank), 2, 0, 2 * Math.PI);
      g.fill();
    }

    g.textAlign = 'left';
    g.font = '11px Consolas, monospace';
    g.fillStyle = 'rgba(220,230,245,0.95)';
    g.fillText(`rho = ${mob.elasticity.toFixed(2)}  rank-rank = ${mob.rankRankSlope.toFixed(4)}`, ox + 8, oy + 16);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const zh = this.zh;
    const gEst = this.ci ? this.ci.estimate : gini({ incomes: this.incomes });
    const verdict = classifyInequality(gEst);
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = zh
      ? `n=${this.incomes.length}  ·  ${this.params.distribution} ${this.params.distribution === 'log-normal' ? 'σ' : 'α'}=${this.params.shape.toFixed(2)}  ·  种子=${this.params.seed}  ·  自助=${this.params.bootReps}  ·  税制=${this.params.taxRegime === 'progressive' ? '累进' : this.params.taxRegime === 'flat' ? '比例' : this.params.taxRegime === 'regressive' ? '累退' : '无'}(${(this.params.taxRate * 100).toFixed(0)}%)`
      : `n=${this.incomes.length}  ·  ${this.params.distribution} ${this.params.distribution === 'log-normal' ? 'sigma' : 'alpha'}=${this.params.shape.toFixed(2)}  ·  seed=${this.params.seed}  ·  bootstrap=${this.params.bootReps}  ·  tax=${this.params.taxRegime}(${(this.params.taxRate * 100).toFixed(0)}%)`;
    g.fillText(l1, 54, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const taxPart =
      this.params.taxRegime !== 'none' && this.tax
        ? zh
          ? `  ·  税后 G=${this.tax.giniPost.toFixed(4)}（再分配 ${this.tax.redistribution.toFixed(4)}）`
          : `  ·  post-tax G=${this.tax.giniPost.toFixed(4)} (redistribution ${this.tax.redistribution.toFixed(4)})`
        : '';
    const l2 = zh
      ? `G=${gEst.toFixed(4)}  ·  Palma=${palmaRatio(this.incomes).toFixed(3)}  ·  Theil=${theilIndex(this.incomes).toFixed(4)}  ·  90/10=${p90p10(this.incomes).toFixed(2)}${taxPart}  ·  ${verdict.zh}`
      : `G=${gEst.toFixed(4)}  ·  Palma=${palmaRatio(this.incomes).toFixed(3)}  ·  Theil=${theilIndex(this.incomes).toFixed(4)}  ·  90/10=${p90p10(this.incomes).toFixed(2)}${taxPart}  ·  ${verdict.en}`;
    g.fillText(l2, 54, canvas.height - 14);
  }
}

export default function createInequalityPlugin(): Plugin {
  return new InequalityPlugin();
}
