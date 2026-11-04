// ==========================================================================
// bio-pk — pharmacokinetic compartment analysis (canvas workbench)
//
// Four workbench modes behind one "mode" select (default preserves the
// original single-subject workbench):
//   single     — concentration/effect–time profile from RK4 integration with
//                the analytic closed form overlaid, therapeutic-window band
//                (MEC/MSC) and optional semilog y-axis.
//   population — seeded lognormal Monte-Carlo over CL/V with a P5–P95
//                quantile band and median line.
//   ddi        — baseline vs perpetrator-drug curve (CL multiplier) with the
//                AUC ratio reported and flagged when it exceeds 2-fold.
//   tdm        — steady-state regimen preview (trough/peak/AUC), target-driven
//                dose recommendation and one-compartment CL/V least-squares
//                fit to imported time,conc observations.
// "Run benchmark" (single mode) publishes the numeric-vs-analytic validation
// errors and the AUC mass-conservation check to the scientific-output strip;
// every summary is also published there and exportable as CSV.
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
import { bioPkManifest } from './manifest';
import { pkFigurePanels } from './figure';
import {
  DEFAULT_PK_PARAMS,
  computePkMetrics,
  ddiScaledParams,
  emaxEffect,
  fitTdmOneComp,
  macroRates,
  oneCompIvConc,
  oneCompInfusionConc,
  oneCompOralConc,
  runPkBenchmarks,
  simulatePk,
  simulatePopulationPk,
  solveDoseForAuc,
  solveDoseForTrough,
  steadyStateAuc,
  steadyStateConc,
  steadyStatePeak,
  steadyStateTrough,
  twoCompIvAmount,
  twoCompOralAmount,
  type PdParams,
  type PkModel,
  type PkParams,
  type PkRoute,
  type TdmFitResult,
  type TdmObservation,
} from './kernel';

export { bioPkManifest } from './manifest';

type WorkbenchMode = 'single' | 'population' | 'ddi' | 'tdm';
type DdiType = 'none' | 'inhibitor' | 'inducer';
type TargetKind = 'trough' | 'auc';
type ViewKind = 'conc' | 'effect';

interface State {
  mode: WorkbenchMode;
  model: PkModel;
  route: PkRoute;
  dose: number;
  volume: number;
  ke: number;
  ka: number;
  k12: number;
  k21: number;
  f: number;
  tInf: number;
  tMax: number;
  mec: number;
  msc: number;
  logScale: boolean;
  view: ViewKind;
  pdEmax: number;
  pdEc50: number;
  pdHill: number;
  pdE0: number;
  popN: number;
  cvCl: number;
  cvV: number;
  seed: number;
  ddiType: DdiType;
  ddiFactor: number;
  tau: number;
  targetKind: TargetKind;
  targetTrough: number;
  targetAuc: number;
}

const MODEL_OPTIONS: Array<{ value: PkModel; en: string; zh: string }> = [
  { value: 'one-compartment', en: 'One-compartment', zh: '一室模型' },
  { value: 'two-compartment', en: 'Two-compartment', zh: '二室模型' },
];

const ROUTE_OPTIONS: Array<{ value: PkRoute; en: string; zh: string }> = [
  { value: 'iv-bolus', en: 'IV bolus', zh: '静脉推注' },
  { value: 'iv-infusion', en: 'IV infusion', zh: '静脉滴注' },
  { value: 'oral', en: 'Oral (1st-order)', zh: '口服（一级吸收）' },
];

const MODE_OPTIONS: Array<{ value: WorkbenchMode; en: string; zh: string }> = [
  { value: 'single', en: 'Standard profile', zh: '标准药时曲线' },
  { value: 'population', en: 'Population PK/PD', zh: '群体 PK/PD（蒙特卡洛）' },
  { value: 'ddi', en: 'Drug interaction', zh: '药物相互作用（DDI）' },
  { value: 'tdm', en: 'Dosing / TDM', zh: '剂量优化 / TDM' },
];

// ---- panel drawing primitives ----------------------------------------------

interface PanelPoint {
  x: number;
  y: number;
}

interface PanelLine {
  points: PanelPoint[];
  color: string;
  width?: number;
  dash?: number[];
  label: string;
}

interface PanelBand {
  upper: PanelPoint[];
  lower: PanelPoint[];
  color: string;
  label: string;
}

interface PanelPoints {
  points: PanelPoint[];
  color: string;
  label: string;
}

interface PanelRefLine {
  y: number;
  color: string;
  label: string;
}

interface PanelSpec {
  title: string;
  tMax: number;
  yHi: number;
  yLo?: number;
  logScale?: boolean;
  /** Therapeutic window band [mec, msc] in y units; null to omit. */
  window?: { mec: number; msc: number } | null;
  bands?: PanelBand[];
  lines: PanelLine[];
  points?: PanelPoints[];
  refLines?: PanelRefLine[];
  footer: string;
  yTickFmt?: (v: number) => string;
}

export class BioPkPlugin implements Plugin {
  readonly manifest = bioPkManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  /** Imported time,conc observations (TDM mode). */
  private obs: TdmObservation[] | null = null;
  private tdmFit: TdmFitResult | null = null;
  private state: State = {
    mode: 'single',
    model: DEFAULT_PK_PARAMS.model,
    route: DEFAULT_PK_PARAMS.route,
    dose: DEFAULT_PK_PARAMS.dose,
    volume: DEFAULT_PK_PARAMS.volume,
    ke: DEFAULT_PK_PARAMS.ke,
    ka: DEFAULT_PK_PARAMS.ka,
    k12: DEFAULT_PK_PARAMS.k12,
    k21: DEFAULT_PK_PARAMS.k21,
    f: 1,
    tInf: 1,
    tMax: 24,
    mec: 10,
    msc: 20,
    logScale: false,
    view: 'conc',
    pdEmax: 100,
    pdEc50: 10,
    pdHill: 1,
    pdE0: 0,
    popN: 100,
    cvCl: 0.3,
    cvV: 0.25,
    seed: 20260101,
    ddiType: 'inhibitor',
    ddiFactor: 0.25,
    tau: 12,
    targetKind: 'trough',
    targetTrough: 10,
    targetAuc: 120,
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

  private params(): PkParams {
    const s = this.state;
    return {
      model: s.model,
      route: s.route,
      dose: s.dose,
      volume: s.volume,
      ke: s.ke,
      ka: s.ka,
      k12: s.k12,
      k21: s.k21,
      f: s.f,
      tInf: s.tInf,
    };
  }

  private pd(): PdParams {
    const s = this.state;
    return { emax: s.pdEmax, ec50: s.pdEc50, hill: s.pdHill, e0: s.pdE0 };
  }

  private ddiFactorEffective(): number {
    return this.state.ddiType === 'none' ? 1 : this.state.ddiFactor;
  }

  getParams(): ParamDefinition[] {
    const s = this.state;
    const onlySingle = { key: 'mode', in: ['single'] } as const;
    const populationOnly = { key: 'mode', in: ['population'] } as const;
    const ddiOnly = { key: 'mode', in: ['ddi'] } as const;
    const tdmOnly = { key: 'mode', in: ['tdm'] } as const;
    const concView = { key: 'view', in: ['conc'] } as const;
    const effectView = { key: 'view', in: ['effect'] } as const;
    return [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '模式', 'en-US': 'Mode' },
        type: 'select',
        options: MODE_OPTIONS.map((m) => ({
          value: m.value,
          label: this.zh ? m.zh : m.en,
          labelI18n: { 'zh-CN': m.zh, 'en-US': m.en },
        })),
        value: s.mode,
      },
      {
        key: 'model',
        label: 'Model',
        labelI18n: { 'zh-CN': '室模型', 'en-US': 'Model' },
        type: 'select',
        options: MODEL_OPTIONS.map((m) => ({
          value: m.value,
          label: this.zh ? m.zh : m.en,
          labelI18n: { 'zh-CN': m.zh, 'en-US': m.en },
        })),
        value: s.model,
      },
      {
        key: 'route',
        label: 'Route',
        labelI18n: { 'zh-CN': '给药途径', 'en-US': 'Route' },
        type: 'select',
        options: ROUTE_OPTIONS.map((m) => ({
          value: m.value,
          label: this.zh ? m.zh : m.en,
          labelI18n: { 'zh-CN': m.zh, 'en-US': m.en },
        })),
        value: s.route,
      },
      {
        key: 'dose',
        label: 'D',
        labelI18n: {
          'zh-CN': '剂量 D (mg)',
          'en-US': 'Dose D (mg)',
        },
        type: 'range',
        min: 25,
        max: 1000,
        step: 25,
        value: s.dose,
      },
      {
        key: 'volume',
        label: 'Vd',
        labelI18n: { 'zh-CN': '表观分布容积 Vd (L)', 'en-US': 'Volume Vd (L)' },
        type: 'range',
        min: 5,
        max: 100,
        step: 1,
        value: s.volume,
        hint: this.zh ? '文献量级：茶碱 ≈ 0.5 L/kg' : 'literature scale: theophylline ≈ 0.5 L/kg',
      },
      {
        key: 'ke',
        label: 'ke',
        labelI18n: { 'zh-CN': '消除速率 ke (1/h)', 'en-US': 'Elimination ke (1/h)' },
        type: 'range',
        min: 0.02,
        max: 1,
        step: 0.01,
        value: s.ke,
      },
      {
        key: 'ka',
        label: 'ka',
        labelI18n: { 'zh-CN': '吸收速率 ka (1/h)', 'en-US': 'Absorption ka (1/h)' },
        type: 'range',
        min: 0.05,
        max: 4,
        step: 0.05,
        value: s.ka,
        hint: this.zh ? '仅口服途径使用' : 'oral route only',
        visibleWhen: { key: 'route', in: ['oral'] },
      },
      {
        key: 'f',
        label: 'F',
        labelI18n: { 'zh-CN': '生物利用度 F', 'en-US': 'Bioavailability F' },
        type: 'range',
        min: 0.05,
        max: 1,
        step: 0.05,
        value: s.f,
        hint: this.zh ? '口服途径的吸收分数，AUC = F·D/(ke·V)' : 'oral absorption fraction; AUC = F·D/(ke·V)',
        visibleWhen: { key: 'route', in: ['oral'] },
      },
      {
        key: 'tInf',
        label: 'T_inf',
        labelI18n: { 'zh-CN': '滴注时长 T_inf (h)', 'en-US': 'Infusion duration T_inf (h)' },
        type: 'range',
        min: 0.5,
        max: 12,
        step: 0.5,
        value: s.tInf,
        hint: this.zh ? '仅静脉滴注途径使用' : 'IV infusion route only',
        visibleWhen: { key: 'route', in: ['iv-infusion'] },
      },
      {
        key: 'k12',
        label: 'k12',
        labelI18n: { 'zh-CN': '外周转运 k12 (1/h)', 'en-US': 'Transfer k12 (1/h)' },
        type: 'range',
        min: 0,
        max: 2,
        step: 0.05,
        value: s.k12,
        hint: this.zh ? '仅二室模型使用' : 'two-compartment only',
        visibleWhen: { key: 'model', in: ['two-compartment'] },
      },
      {
        key: 'k21',
        label: 'k21',
        labelI18n: { 'zh-CN': '返回转运 k21 (1/h)', 'en-US': 'Return k21 (1/h)' },
        type: 'range',
        min: 0,
        max: 2,
        step: 0.05,
        value: s.k21,
        visibleWhen: { key: 'model', in: ['two-compartment'] },
      },
      {
        key: 'tMax',
        label: 't range',
        labelI18n: { 'zh-CN': '仿真时长 (h)', 'en-US': 'Simulated span (h)' },
        type: 'range',
        min: 6,
        max: 72,
        step: 2,
        value: s.tMax,
      },
      // ---- population mode ----
      {
        key: 'popN',
        label: 'N subjects',
        labelI18n: { 'zh-CN': '虚拟个体数 N', 'en-US': 'Virtual subjects N' },
        type: 'range',
        min: 20,
        max: 500,
        step: 20,
        value: s.popN,
        hint: this.zh ? '固定种子的蒙特卡洛个体数' : 'fixed-seed Monte-Carlo sample size',
        visibleWhen: populationOnly,
      },
      {
        key: 'cvCl',
        label: 'CV CL',
        labelI18n: { 'zh-CN': 'CL 个体间变异 CV', 'en-US': 'CL inter-individual CV' },
        type: 'range',
        min: 0,
        max: 0.8,
        step: 0.05,
        value: s.cvCl,
        hint: this.zh ? '对数正态变异系数（均值保持不变）' : 'lognormal coefficient of variation (mean preserved)',
        visibleWhen: populationOnly,
      },
      {
        key: 'cvV',
        label: 'CV V',
        labelI18n: { 'zh-CN': 'V 个体间变异 CV', 'en-US': 'V inter-individual CV' },
        type: 'range',
        min: 0,
        max: 0.8,
        step: 0.05,
        value: s.cvV,
        visibleWhen: populationOnly,
      },
      {
        key: 'seed',
        label: 'Seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'PRNG seed' },
        type: 'number',
        min: 0,
        step: 1,
        value: s.seed,
        hint: this.zh ? '固定种子保证结果可复现' : 'fixed seed keeps results reproducible',
        visibleWhen: populationOnly,
      },
      // ---- PD / effect view (single + population + ddi) ----
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'conc', label: 'Concentration', labelI18n: { 'zh-CN': '浓度-时间', 'en-US': 'Concentration' } },
          { value: 'effect', label: 'Effect (PD)', labelI18n: { 'zh-CN': '效应-时间（PD）', 'en-US': 'Effect (PD)' } },
        ],
        value: s.view,
        visibleWhen: { key: 'mode', in: ['single', 'population', 'ddi'] },
      },
      {
        key: 'pdEmax',
        label: 'Emax',
        labelI18n: { 'zh-CN': '最大效应 Emax', 'en-US': 'Max effect Emax' },
        type: 'range',
        min: 1,
        max: 200,
        step: 1,
        value: s.pdEmax,
        hint: this.zh ? 'sigmoid-Emax：E = E0 + Emax·C^h/(EC50^h + C^h)' : 'sigmoid-Emax: E = E0 + Emax·C^h/(EC50^h + C^h)',
        visibleWhen: effectView,
      },
      {
        key: 'pdEc50',
        label: 'EC50',
        labelI18n: { 'zh-CN': '半效浓度 EC50 (mg/L)', 'en-US': 'EC50 (mg/L)' },
        type: 'range',
        min: 0.5,
        max: 50,
        step: 0.5,
        value: s.pdEc50,
        visibleWhen: effectView,
      },
      {
        key: 'pdHill',
        label: 'Hill h',
        labelI18n: { 'zh-CN': 'Hill 系数 h', 'en-US': 'Hill coefficient h' },
        type: 'range',
        min: 0.5,
        max: 5,
        step: 0.1,
        value: s.pdHill,
        hint: this.zh ? 'h = 1 退化为普通 Emax 模型' : 'h = 1 reduces to the plain Emax model',
        visibleWhen: effectView,
      },
      {
        key: 'pdE0',
        label: 'E0',
        labelI18n: { 'zh-CN': '基线效应 E0', 'en-US': 'Baseline effect E0' },
        type: 'range',
        min: 0,
        max: 50,
        step: 1,
        value: s.pdE0,
        visibleWhen: effectView,
      },
      // ---- DDI mode ----
      {
        key: 'ddiType',
        label: 'Perpetrator',
        labelI18n: { 'zh-CN': '相互作用药物', 'en-US': 'Perpetrator drug' },
        type: 'select',
        options: [
          { value: 'none', label: 'None', labelI18n: { 'zh-CN': '无（基线）', 'en-US': 'None (baseline)' } },
          { value: 'inhibitor', label: 'Inhibitor', labelI18n: { 'zh-CN': '抑制剂（CL 降低）', 'en-US': 'Inhibitor (CL reduced)' } },
          { value: 'inducer', label: 'Inducer', labelI18n: { 'zh-CN': '诱导剂（CL 升高）', 'en-US': 'Inducer (CL increased)' } },
        ],
        value: s.ddiType,
        hint: this.zh ? '强抑制 ×0.25、强诱导 ×2.5 为经典强度' : 'strong inhibition x0.25, strong induction x2.5 are classic strengths',
        visibleWhen: ddiOnly,
      },
      {
        key: 'ddiFactor',
        label: 'CL factor',
        labelI18n: { 'zh-CN': 'CL 倍数', 'en-US': 'CL multiplier' },
        type: 'range',
        min: 0.1,
        max: 5,
        step: 0.05,
        value: s.ddiFactor,
        hint: this.zh ? '合用药物对清除率的倍数（AUC 比值 = 1/倍数）' : 'CL multiplier by the perpetrator (AUC ratio = 1/multiplier)',
        visibleWhen: ddiOnly,
      },
      // ---- TDM mode ----
      {
        key: 'tau',
        label: 'Tau',
        labelI18n: { 'zh-CN': '给药间隔 τ (h)', 'en-US': 'Dosing interval tau (h)' },
        type: 'range',
        min: 2,
        max: 72,
        step: 1,
        value: s.tau,
        visibleWhen: tdmOnly,
      },
      {
        key: 'targetKind',
        label: 'Target',
        labelI18n: { 'zh-CN': '优化目标', 'en-US': 'Optimization target' },
        type: 'select',
        options: [
          { value: 'trough', label: 'Steady-state trough', labelI18n: { 'zh-CN': '稳态谷浓度', 'en-US': 'Steady-state trough' } },
          { value: 'auc', label: 'AUC0-tau', labelI18n: { 'zh-CN': 'AUC0-τ', 'en-US': 'AUC0-tau' } },
        ],
        value: s.targetKind,
        visibleWhen: tdmOnly,
      },
      {
        key: 'targetTrough',
        label: 'C_trough*',
        labelI18n: { 'zh-CN': '目标谷浓度 (mg/L)', 'en-US': 'Target trough (mg/L)' },
        type: 'range',
        min: 0.5,
        max: 30,
        step: 0.5,
        value: s.targetTrough,
        visibleWhen: { key: 'targetKind', in: ['trough'] },
      },
      {
        key: 'targetAuc',
        label: 'AUC*',
        labelI18n: { 'zh-CN': '目标 AUC0-τ (mg·h/L)', 'en-US': 'Target AUC0-tau (mg·h/L)' },
        type: 'range',
        min: 10,
        max: 2000,
        step: 10,
        value: s.targetAuc,
        visibleWhen: { key: 'targetKind', in: ['auc'] },
      },
      // ---- display ----
      {
        key: 'mec',
        label: 'MEC',
        labelI18n: { 'zh-CN': '最低有效浓度 MEC', 'en-US': 'MEC (min. effective conc.)' },
        type: 'range',
        min: 0,
        max: 30,
        step: 1,
        value: s.mec,
        visibleWhen: concView,
      },
      {
        key: 'msc',
        label: 'MSC',
        labelI18n: { 'zh-CN': '最低中毒浓度 MSC', 'en-US': 'MSC (max. safe conc.)' },
        type: 'range',
        min: 0,
        max: 40,
        step: 1,
        value: s.msc,
        visibleWhen: concView,
      },
      {
        key: 'logScale',
        label: 'Semilog y',
        labelI18n: { 'zh-CN': '半对数坐标', 'en-US': 'Semilog y-axis' },
        type: 'checkbox',
        value: s.logScale,
        visibleWhen: onlySingle,
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('tdmFit', 'Fit observed CL/V', '拟合观测 CL/V'),
      actionButton('exportCsv', 'Export profile CSV', '导出药时曲线 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: keyof State, min: number, apply?: (n: number) => void): void => {
      const v = params[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        const next = Math.max(min, v);
        if (next !== this.state[k]) {
          this.state[k] = next as never;
          apply?.(next);
          this.draw();
        }
      }
    };
    const sel = <K extends keyof State>(k: K, allowed: readonly string[]): void => {
      const v = params[k];
      if (typeof v === 'string' && allowed.includes(v) && v !== this.state[k]) {
        this.state[k] = v as never;
        this.draw();
      }
    };
    num('dose', 1);
    num('volume', 0.5);
    num('ke', 0.005);
    num('ka', 0.01);
    num('k12', 0);
    num('k21', 0);
    num('tMax', 2);
    num('mec', 0);
    num('msc', 0);
    num('f', 0.05);
    num('tInf', 0.5);
    num('pdEmax', 1);
    num('pdEc50', 0.5);
    num('pdHill', 0.5);
    num('pdE0', 0);
    num('popN', 20);
    num('cvCl', 0);
    num('cvV', 0);
    num('tau', 2);
    num('targetTrough', 0.5);
    num('targetAuc', 10);
    num('ddiFactor', 0.1);
    if (typeof params.seed === 'number' && Number.isFinite(params.seed) && params.seed >= 0 && params.seed !== this.state.seed) {
      this.state.seed = Math.round(params.seed);
      this.draw();
    }
    sel('model', MODEL_OPTIONS.map((m) => m.value));
    sel('route', ROUTE_OPTIONS.map((m) => m.value));
    sel('mode', MODE_OPTIONS.map((m) => m.value));
    sel('view', ['conc', 'effect']);
    sel('ddiType', ['none', 'inhibitor', 'inducer']);
    sel('targetKind', ['trough', 'auc']);
    if (typeof params.logScale === 'boolean' && params.logScale !== this.state.logScale) {
      this.state.logScale = params.logScale;
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'tdmFit')) this.runTdmFit();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.csv') && !low.endsWith('.tsv')) {
      notify(this.api, 'warning', 'bio-pk accepts time,concentration CSV/TSV.', 'bio-pk 仅接受 time,concentration 的 CSV/TSV。');
      return;
    }
    const text = await file.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
    const header = (lines[0] ?? '').toLowerCase().split(/[,;\t]+/).map((c) => c.trim());
    const timeIdx = header.findIndex((c) => c === 'time' || c === 'time_h' || c === 't');
    const concIdx = header.findIndex(
      (c) => c === 'conc' || c === 'concentration' || c === 'conc_mg_l' || c === 'conc_mg_per_l' || c === 'c',
    );
    const subjIdx = header.findIndex((c) => c === 'subject' || c === 'subj' || c === 'id');
    if (timeIdx >= 0 && concIdx >= 0) {
      const obs: TdmObservation[] = [];
      for (let i = 1; i < lines.length; i += 1) {
        const cells = lines[i]!.split(/[,;\t]+/).map((c) => c.trim());
        const t = Number(cells[timeIdx]);
        const c = Number(cells[concIdx]);
        if (!Number.isFinite(t) || !Number.isFinite(c)) continue;
        obs.push({ t, c, subject: subjIdx >= 0 ? (cells[subjIdx] ?? 'S1') : undefined });
      }
      if (obs.length < 2) {
        notify(
          this.api,
          'error',
          'Concentration CSV needs at least 2 numeric rows with time,conc columns - file rejected.',
          '浓度 CSV 需要至少 2 行有效的 time,conc 数值——已拒绝该文件。',
        );
        return;
      }
      this.obs = obs;
      this.tdmFit = null;
      this.state.mode = 'tdm';
      this.runTdmFit(true);
      const subjects = new Set(obs.map((o) => o.subject ?? 'all')).size;
      notify(
        this.api,
        'success',
        `Loaded ${obs.length} concentration observations (${subjects} subject group${subjects > 1 ? 's' : ''}); switched to TDM mode and fitted.`,
        `已载入 ${obs.length} 条浓度观测（${subjects} 个受试者组），已切换到 TDM 模式并完成拟合。`,
      );
      this.draw();
      return;
    }
    // Legacy behaviour: non-observation tables are accepted for provenance only.
    const rows = lines.length - 1;
    notify(
      this.api,
      'info',
      `Read ${rows} sampled rows — the model curve is parameter-driven; adjust the sliders to match your data.`,
      `读取 ${rows} 行采样数据——模型曲线由参数驱动，请调节滑块以拟合你的数据。`,
    );
  }

  // ---- science outputs -------------------------------------------------------

  private runBenchmark() {
    const bench = runPkBenchmarks();
    const worst = bench.cases.reduce((acc, c) => Math.max(acc, c.relErr), 0);
    const aucCase = bench.cases.find((c) => c.key === 'auc');
    const m = computePkMetricsSafe(this.params(), this.state.tMax, this.state.tMax / 1200);
    const tHalfTxt = Number.isFinite(m.halfLife) ? fmtMetric(m.halfLife) : '—';
    const metrics: ScienceMetric[] = bench.cases.map((c) => ({
      key: `pk-bench-${c.key}`,
      label: `Bench · ${c.key}`,
      value: fmtMetric(c.relErr * 100),
      unit: '%',
      severity: c.relErr < c.tolerance ? 'ok' : 'error',
      hint: `${c.label} — tol ${(c.tolerance * 100).toFixed(2)}%`,
    }));
    metrics.push(
      {
        key: 'cmax',
        label: 'Cmax',
        value: fmtMetric(m.cmax),
        unit: 'mg/L',
        severity: 'info',
        hint: this.zh ? '数值解峰值浓度' : 'peak of the numeric profile',
      },
      {
        key: 'tmax',
        label: 'Tmax',
        value: fmtMetric(m.tmax),
        unit: 'h',
        severity: 'info',
      },
      {
        key: 'half-life',
        label: 't½',
        value: tHalfTxt,
        unit: 'h',
        severity: 'info',
        hint:
          this.zh
            ? this.state.model === 'two-compartment'
              ? 'β 相消除半衰期 ln2/β'
              : 'ln2/λz'
            : this.state.model === 'two-compartment'
              ? 'β-phase elimination half-life ln2/β'
              : 'ln2/λz',
      },
      {
        key: 'auc-err',
        label: 'AUC err',
        value: fmtMetric(m.aucRelErr * 100),
        unit: '%',
        severity: (aucCase?.relErr ?? 1) < (aucCase?.tolerance ?? 0.01) ? 'ok' : 'warn',
        hint: this.zh
          ? '梯形积分+尾部修正 vs 解析 AUC=D/(ke·Vd)'
          : 'trapezoid + tail vs analytic AUC = D/(ke·Vd)',
      },
    );
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      bench.allPassed ? 'success' : 'warning',
      bench.allPassed
        ? `All PK benchmarks passed (worst rel. err ${(worst * 100).toFixed(4)}%).`
        : `PK benchmark failed — worst rel. err ${(worst * 100).toFixed(4)}%.`,
      bench.allPassed
        ? `全部 PK 基准通过（最大相对误差 ${(worst * 100).toFixed(4)}%）。`
        : `PK 基准未通过——最大相对误差 ${(worst * 100).toFixed(4)}%。`,
    );
  }

  /** Publish mode-specific scientific outputs (population / ddi / tdm). */
  private publishPopulationOutputs(res: ReturnType<typeof simulatePopulationPk>): void {
    const zh = this.zh;
    const med = (arr: number[]): number => {
      const s = arr.slice().sort((a, b) => a - b);
      return s.length ? s[Math.floor(s.length / 2)]! : Number.NaN;
    };
    const cmaxMed = med(res.individuals.map((i) => i.cmax));
    const aucMed = med(res.individuals.map((i) => i.auc));
    const thMed = med(res.individuals.map((i) => i.halfLife));
    setScienceOutputs(this.manifest.id, [
      {
        key: 'pop-cmax',
        label: 'Cmax (median)',
        value: fmtMetric(cmaxMed),
        unit: 'mg/L',
        severity: 'info',
        hint: zh
          ? `N=${this.state.popN} 个 lognormal 抽样个体的中位峰值（种子 ${this.state.seed}）`
          : `median peak over N=${this.state.popN} lognormal-sampled subjects (seed ${this.state.seed})`,
      },
      {
        key: 'pop-thalf',
        label: 't½ (median)',
        value: fmtMetric(thMed),
        unit: 'h',
        severity: 'info',
        hint: zh ? '个体半衰期 ln2/λz 的中位数' : 'median of individual ln2/lambda-z half-lives',
      },
      {
        key: 'pop-auc',
        label: 'AUC0-inf (median)',
        value: fmtMetric(aucMed),
        unit: 'mg·h/L',
        severity: 'info',
        hint: zh ? '个体 AUC0-∞ = F·D/CL 的中位数' : 'median of individual AUC0-inf = F·D/CL',
      },
      {
        key: 'pop-band',
        label: 'P5–P95 @t=tMax/2',
        value: `[${fmtMetric(res.p5[Math.floor(res.p5.length / 2)]!)}, ${fmtMetric(res.p95[Math.floor(res.p95.length / 2)]!)}]`,
        unit: 'mg/L',
        severity: 'info',
        hint: zh ? '中位时间的 P5–P95 浓度分位带（画布阴影）' : 'P5-P95 concentration band at mid-span (shaded on canvas)',
      },
    ]);
  }

  private publishDdiOutputs(): void {
    const zh = this.zh;
    const p = this.params();
    const factor = this.ddiFactorEffective();
    const aucBase = steadyStateAuc(p, this.state.tau);
    const aucDdi = steadyStateAuc(ddiScaledParams(p, factor), this.state.tau);
    const ratio = factor > 0 ? aucDdi / aucBase : Number.NaN;
    setScienceOutputs(this.manifest.id, [
      {
        key: 'ddi-auc-base',
        label: 'AUC baseline',
        value: fmtMetric(aucBase),
        unit: 'mg·h/L',
        severity: 'info',
        hint: zh ? '单药 AUC0-∞ = D/(ke·V)' : 'baseline AUC0-inf = D/(ke·V)',
      },
      {
        key: 'ddi-auc-ddi',
        label: 'AUC with DDI',
        value: fmtMetric(aucDdi),
        unit: 'mg·h/L',
        severity: 'info',
        hint: zh
          ? `${this.state.ddiType === 'inducer' ? '诱导剂' : '抑制剂'}使 CL ×${fmtMetric(factor)} 后的 AUC`
          : `AUC after the ${this.state.ddiType === 'inducer' ? 'inducer' : 'inhibitor'} scales CL by ${fmtMetric(factor)}`,
      },
      {
        key: 'ddi-ratio',
        label: 'AUC ratio',
        value: fmtMetric(ratio),
        severity: ratio > 2 ? 'warn' : 'ok',
        hint: zh
          ? ratio > 2
            ? 'AUC 比值超过 2 倍——临床需关注暴露量升高的毒性风险（演示，非临床建议）'
            : 'AUC(DDI)/AUC(base) = 1/CL倍数；线性药动学下比值与剂量无关'
          : ratio > 2
            ? 'AUC ratio exceeds 2-fold - exposure-related toxicity risk warrants review (demo, not clinical advice)'
            : 'AUC(ddi)/AUC(base) = 1/CL multiplier; ratio is dose-independent under linear kinetics',
      },
    ]);
  }

  private publishTdmOutputs(): void {
    const zh = this.zh;
    const p = this.params();
    const tau = this.state.tau;
    const trough = steadyStateTrough(p, tau);
    const peak = steadyStatePeak(p, tau);
    const auc = steadyStateAuc(p, tau);
    const recDose =
      this.state.targetKind === 'trough'
        ? solveDoseForTrough(p, tau, this.state.targetTrough)
        : solveDoseForAuc(p, this.state.targetAuc);
    const inWindow = peak <= this.state.msc && trough >= this.state.mec && this.state.msc > this.state.mec;
    const metrics: ScienceMetric[] = [
      {
        key: 'tdm-trough',
        label: 'Css min',
        value: fmtMetric(trough),
        unit: 'mg/L',
        severity: trough >= this.state.mec || this.state.mec === 0 ? 'ok' : 'warn',
        hint: zh ? `τ=${tau} h 给药间隔的稳态谷浓度（叠加原理）` : `steady-state trough at tau=${tau} h (superposition)`,
      },
      {
        key: 'tdm-peak',
        label: 'Css max',
        value: fmtMetric(peak),
        unit: 'mg/L',
        severity: peak <= this.state.msc ? 'ok' : 'error',
        hint: zh ? `稳态峰浓度；治疗窗 ${this.state.mec}–${this.state.msc} mg/L` : `steady-state peak; window ${this.state.mec}-${this.state.msc} mg/L`,
      },
      {
        key: 'tdm-auc',
        label: 'AUC0-tau,ss',
        value: fmtMetric(auc),
        unit: 'mg·h/L',
        severity: 'info',
        hint: zh ? '稳态 AUC0-τ = F·D/CL（线性叠加）' : 'steady-state AUC0-tau = F·D/CL (linear superposition)',
      },
      {
        key: 'tdm-dose',
        label: this.state.targetKind === 'trough' ? 'Dose for C*trough' : 'Dose for AUC*',
        value: fmtMetric(recDose),
        unit: 'mg',
        severity: 'info',
        hint: zh
          ? this.state.targetKind === 'trough'
            ? `达到目标谷浓度 ${this.state.targetTrough} mg/L 的单次剂量（方案精确反解）`
            : `达到目标 AUC0-τ ${this.state.targetAuc} mg·h/L 的单次剂量 D = AUC*·CL/F`
          : this.state.targetKind === 'trough'
            ? `single dose reaching target trough ${this.state.targetTrough} mg/L (exact regimen inversion)`
            : `single dose reaching target AUC0-tau ${this.state.targetAuc} mg·h/L: D = AUC*·CL/F`,
      },
      {
        key: 'tdm-window',
        label: 'Regimen vs window',
        value: inWindow ? (zh ? '谷/峰均在窗内' : 'trough & peak inside') : zh ? '越出治疗窗' : 'outside window',
        severity: inWindow ? 'ok' : peak > this.state.msc ? 'error' : 'warn',
        hint: zh ? '当前方案稳态谷峰相对 MEC–MSC 治疗窗的位置' : 'position of the steady-state trough/peak relative to the MEC-MSC window',
      },
    ];
    if (this.tdmFit) {
      const f = this.tdmFit;
      metrics.push(
        {
          key: 'tdm-fit-cl',
          label: 'CL (fit)',
          value: fmtMetric(f.cl),
          unit: 'L/h',
          severity: 'info',
          hint: zh ? `一室最小二乘拟合（RMSE ${fmtMetric(f.rmse)} mg/L，R² ${fmtMetric(f.r2)}）` : `one-compartment LS fit (RMSE ${fmtMetric(f.rmse)} mg/L, R2 ${fmtMetric(f.r2)})`,
        },
        {
          key: 'tdm-fit-v',
          label: 'V (fit)',
          value: fmtMetric(f.v),
          unit: 'L',
          severity: 'info',
        },
        {
          key: 'tdm-fit-thalf',
          label: 't½ (fit)',
          value: fmtMetric(Math.LN2 / f.ke),
          unit: 'h',
          severity: 'info',
          hint: zh ? '拟合 ke 的半衰期 ln2/ke' : 'half-life of the fitted ke: ln2/ke',
        },
      );
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- actions ---------------------------------------------------------------

  private runTdmFit(silent = false): void {
    if (!this.obs || this.obs.length < 3) {
      if (!silent) {
        notify(
          this.api,
          'warning',
          'Load a time,conc CSV first (at least 3 rows) to fit CL/V.',
          '请先载入 time,conc CSV（至少 3 行）再拟合 CL/V。',
        );
      }
      return;
    }
    // Fit on the largest subject group so multi-subject files stay per-individual.
    const groups = new Map<string, TdmObservation[]>();
    for (const o of this.obs) {
      const k = o.subject ?? 'all';
      const g = groups.get(k) ?? [];
      g.push(o);
      groups.set(k, g);
    }
    let best: TdmObservation[] = [];
    for (const g of groups.values()) if (g.length > best.length) best = g;
    const fit = fitTdmOneComp(best, this.state.route, this.state.dose, this.state.f, this.state.ka, this.state.tInf);
    if (!fit) {
      if (!silent) notify(this.api, 'error', 'Fit failed - observations are degenerate.', '拟合失败——观测数据退化。');
      return;
    }
    this.tdmFit = fit;
    if (!silent) {
      notify(
        this.api,
        'success',
        `Fitted CL=${fit.cl.toFixed(2)} L/h, V=${fit.v.toFixed(2)} L (t½=${(Math.LN2 / fit.ke).toFixed(2)} h, RMSE=${fit.rmse.toFixed(3)}).`,
        `拟合完成：CL=${fit.cl.toFixed(2)} L/h，V=${fit.v.toFixed(2)} L（t½=${(Math.LN2 / fit.ke).toFixed(2)} h，RMSE=${fit.rmse.toFixed(3)}）。`,
      );
    }
  }

  private exportCsv() {
    const s = this.state;
    if (s.mode === 'population') {
      const res = simulatePopulationPk(this.params(), {
        n: s.popN,
        cvCl: s.cvCl,
        cvV: s.cvV,
        seed: s.seed,
        tMax: s.tMax,
        gridPoints: 240,
      });
      exportRowsCsv(
        this.api,
        'bio-pk-population',
        ['time_h', 'P5_mg_per_L', 'P50_mg_per_L', 'P95_mg_per_L'],
        res.times.map((t, i) => [
          Number(t.toFixed(4)),
          Number(res.p5[i]!.toFixed(6)),
          Number(res.p50[i]!.toFixed(6)),
          Number(res.p95[i]!.toFixed(6)),
        ]),
      );
      return;
    }
    if (s.mode === 'ddi') {
      const p = this.params();
      const pd = ddiScaledParams(p, this.ddiFactorEffective());
      const dt = s.tMax / 600;
      const a = simulatePk(p, s.tMax, dt);
      const b = simulatePk(pd, s.tMax, dt);
      exportRowsCsv(
        this.api,
        'bio-pk-ddi',
        ['time_h', 'C_base_mg_per_L', 'C_ddi_mg_per_L'],
        a.times.map((t, i) => [
          Number(t.toFixed(4)),
          Number(a.concentration[i]!.toFixed(6)),
          Number(b.concentration[i]!.toFixed(6)),
        ]),
      );
      return;
    }
    if (s.mode === 'tdm') {
      if (this.obs) {
        const fitCurve = this.tdmFitPrediction();
        exportRowsCsv(
          this.api,
          'bio-pk-tdm',
          ['time_h', 'obs_mg_per_L', 'fit_mg_per_L', 'subject'],
          this.obs.map((o) => [
            Number(o.t.toFixed(4)),
            Number(o.c.toFixed(6)),
            fitCurve && fitCurve.get(o.t) !== undefined ? Number(fitCurve.get(o.t)!.toFixed(6)) : '',
            o.subject ?? 'all',
          ]),
        );
        return;
      }
      const p = this.params();
      const steps = 240;
      const span = Math.min(s.tMax, 2 * s.tau);
      exportRowsCsv(
        this.api,
        'bio-pk-steady-state',
        ['time_h', 'Css_mg_per_L'],
        Array.from({ length: steps + 1 }, (_, i) => {
          const t = (span * i) / steps;
          return [Number(t.toFixed(4)), Number(steadyStateConc(p, s.tau, t % s.tau).toFixed(6))];
        }),
      );
      return;
    }
    const p = this.params();
    const dt = s.tMax / 600;
    const series = simulatePk(p, s.tMax, dt);
    const rows: Array<Array<number | string>> = series.times.map((t, i) => [
      Number(t.toFixed(4)),
      Number(series.concentration[i]!.toFixed(6)),
      Number(series.peripheral[i]!.toFixed(6)),
      Number(series.gut[i]!.toFixed(6)),
    ]);
    exportRowsCsv(this.api, 'bio-pk-profile', ['time_h', 'C_mg_per_L', 'A2_peripheral_mg', 'A_gi_mg'], rows);
  }

  private async sendToFigure(): Promise<void> {
    const m = computePkMetricsSafe(this.params(), this.state.tMax, this.state.tMax / 1200);
    if (!Number.isFinite(m.cmax) || m.cmax <= 0) {
      notify(this.api, 'warning', 'No simulation yet — adjust parameters first.', '尚无仿真结果——请先设置参数。');
      return;
    }
    const tHalf = Number.isFinite(m.halfLife) ? m.halfLife.toFixed(2) : '—';
    const caption: Bilingual = {
      zh: `药代动力学：Cmax=${m.cmax.toFixed(2)} mg/L（Tmax=${m.tmax.toFixed(2)} h），t½=${tHalf} h，AUC=${m.aucAnalytic.toFixed(2)} mg·h/L（数值相对误差 ${(m.aucRelErr * 100).toFixed(3)}%）。`,
      en: `Pharmacokinetics: Cmax=${m.cmax.toFixed(2)} mg/L (Tmax=${m.tmax.toFixed(2)} h), t½=${tHalf} h, AUC=${m.aucAnalytic.toFixed(2)} mg·h/L (numeric rel. err ${(m.aucRelErr * 100).toFixed(3)}%).`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '药代动力学房室模型', en: 'Pharmacokinetic Compartment Model' },
      caption,
      pkFigurePanels({ params: this.params(), tMax: this.state.tMax, logScale: this.state.logScale }),
    );
  }

  /** Fitted one-compartment prediction per observation time (TDM overlay). */
  private tdmFitPrediction(): Map<number, number> | null {
    const fit = this.tdmFit;
    if (!fit || !this.obs) return null;
    const route = this.state.route === 'oral' ? 'oral' : this.state.route === 'iv-infusion' ? 'iv-infusion' : 'iv-bolus';
    const map = new Map<number, number>();
    for (const o of this.obs) {
      const c =
        route === 'iv-bolus'
          ? oneCompIvConc(o.t, this.state.dose, fit.v, fit.ke)
          : route === 'iv-infusion'
            ? oneCompInfusionConc(o.t, this.state.dose, fit.v, fit.ke, this.state.tInf)
            : oneCompOralConc(o.t, this.state.dose, fit.v, fit.ke, fit.ka, this.state.f);
      if (Number.isFinite(c)) map.set(o.t, c);
    }
    return map;
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    // Mode-specific outputs are refreshed on every redraw so the strip never
    // shows stale conclusions after a parameter change; entering the standard
    // mode drops the other modes' outputs until "Run benchmark" repopulates.
    if (this.state.mode === 'single') {
      if (this.lastMode !== null && this.lastMode !== 'single') clearScienceOutputs(this.manifest.id);
    }
    this.lastMode = this.state.mode;

    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    switch (this.state.mode) {
      case 'population': {
        const res = simulatePopulationPk(this.params(), {
          n: this.state.popN,
          cvCl: this.state.cvCl,
          cvV: this.state.cvV,
          seed: this.state.seed,
          tMax: this.state.tMax,
          gridPoints: 240,
        });
        this.publishPopulationOutputs(res);
        this.drawPopulation(g, canvas, res);
        break;
      }
      case 'ddi':
        this.publishDdiOutputs();
        this.drawDdi(g, canvas);
        break;
      case 'tdm':
        this.publishTdmOutputs();
        this.drawTdm(g, canvas);
        break;
      default:
        this.drawSingle(g, canvas);
        break;
    }
  }

  private lastMode: WorkbenchMode | null = null;

  /** Generic curve panel: axes, optional window band, bands, lines, points, legend, footer. */
  private renderPanel(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, spec: PanelSpec): void {
    const zh = this.zh;
    const padL = 56;
    const padR = 18;
    const padT = 46;
    const padB = 44;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const useLog = !!spec.logScale;
    const yHi = Math.max(spec.yHi, 1e-9);
    const yLo = useLog ? Math.max(spec.yLo ?? yHi * 1e-4, 1e-9) : spec.yLo ?? 0;

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(spec.title, canvas.width / 2, 20);

    const px = (t: number): number => x0 + (plotW * t) / Math.max(spec.tMax, 1e-9);
    const py = (c: number): number => {
      const v = Math.max(Math.min(c, yHi), yLo);
      if (useLog) {
        const f = (Math.log10(v) - Math.log10(yLo)) / (Math.log10(yHi) - Math.log10(yLo));
        return y1 - plotH * f;
      }
      return y1 - (plotH * v) / Math.max(yHi - yLo, 1e-12);
    };

    // therapeutic window band
    if (spec.window && spec.window.msc > spec.window.mec && spec.window.msc > 0) {
      const bandTop = py(spec.window.msc);
      const bandBottom = py(spec.window.mec);
      g.fillStyle = 'rgba(110, 220, 160, 0.12)';
      g.fillRect(x0, Math.min(bandTop, y1), plotW, Math.abs(bandBottom - bandTop));
      g.strokeStyle = 'rgba(110, 220, 160, 0.45)';
      g.setLineDash([4, 4]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x0, bandTop);
      g.lineTo(x1, bandTop);
      g.moveTo(x0, bandBottom);
      g.lineTo(x1, bandBottom);
      g.stroke();
      g.setLineDash([]);
      g.textAlign = 'left';
      g.fillStyle = 'rgba(120, 225, 170, 0.85)';
      g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillText(`MSC ${spec.window.msc}`, x0 + 4, Math.max(bandTop - 3, y0 + 8));
      g.fillText(`MEC ${spec.window.mec}`, x0 + 4, Math.min(bandBottom + 10, y1 - 3));
    }

    // frame + ticks
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.strokeRect(x0, y0, plotW, plotH);
    g.textAlign = 'right';
    g.font = `10px Consolas, monospace`;
    const fmtY = spec.yTickFmt ?? ((c: number) => (c >= 1 ? c.toFixed(1) : c.toExponential(0)));
    for (let i = 0; i <= 4; i += 1) {
      const c = yLo + ((yHi - yLo) * i) / 4;
      const sy = py(c);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(fmtY(c), x0 - 6, sy + 3);
    }
    g.textAlign = 'center';
    for (let i = 0; i <= 6; i += 1) {
      const t = (spec.tMax * i) / 6;
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(t.toFixed(0), px(t), y1 + 14);
    }

    // quantile bands
    for (const band of spec.bands ?? []) {
      if (band.upper.length < 2 || band.lower.length < 2) continue;
      g.fillStyle = band.color;
      g.beginPath();
      band.upper.forEach((p, i) => (i === 0 ? g.moveTo(px(p.x), py(p.y)) : g.lineTo(px(p.x), py(p.y))));
      for (let i = band.lower.length - 1; i >= 0; i -= 1) g.lineTo(px(band.lower[i]!.x), py(band.lower[i]!.y));
      g.closePath();
      g.fill();
    }

    // reference lines (e.g. E0, E0+Emax)
    for (const ref of spec.refLines ?? []) {
      if (!Number.isFinite(ref.y) || ref.y < yLo || ref.y > yHi) continue;
      g.strokeStyle = ref.color;
      g.setLineDash([6, 4]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x0, py(ref.y));
      g.lineTo(x1, py(ref.y));
      g.stroke();
      g.setLineDash([]);
      g.textAlign = 'left';
      g.fillStyle = ref.color;
      g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillText(ref.label, x0 + 4, py(ref.y) - 3);
    }

    // lines
    for (const line of spec.lines) {
      if (line.points.length < 2) continue;
      g.strokeStyle = line.color;
      g.lineWidth = line.width ?? 2;
      if (line.dash) g.setLineDash(line.dash);
      g.beginPath();
      let started = false;
      for (const p of line.points) {
        if (!Number.isFinite(p.y)) {
          started = false;
          continue;
        }
        if (!started) {
          g.moveTo(px(p.x), py(p.y));
          started = true;
        } else g.lineTo(px(p.x), py(p.y));
      }
      g.stroke();
      if (line.dash) g.setLineDash([]);
    }

    // points
    for (const pts of spec.points ?? []) {
      g.fillStyle = pts.color;
      for (const p of pts.points) {
        if (!Number.isFinite(p.y)) continue;
        g.beginPath();
        g.arc(px(p.x), py(p.y), 3, 0, Math.PI * 2);
        g.fill();
      }
    }

    // legend
    const legend: Array<{ color: string; dash?: boolean; text: string }> = [];
    for (const band of spec.bands ?? []) legend.push({ color: band.color, text: band.label });
    for (const line of spec.lines) legend.push({ color: line.color, dash: !!line.dash, text: line.label });
    for (const pts of spec.points ?? []) legend.push({ color: pts.color, text: pts.label });
    if (legend.length > 0) {
      g.textAlign = 'left';
      g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      let ly = y0 + 4;
      for (const item of legend) {
        if (item.dash) {
          g.strokeStyle = item.color;
          g.setLineDash([3, 3]);
          g.beginPath();
          g.moveTo(x1 - 158, ly + 1);
          g.lineTo(x1 - 144, ly + 1);
          g.stroke();
          g.setLineDash([]);
        } else {
          g.fillStyle = item.color;
          g.fillRect(x1 - 158, ly, 14, 3);
        }
        g.fillStyle = 'rgba(200, 214, 232, 0.95)';
        g.fillText(item.text, x1 - 140, ly + 6);
        ly += 14;
      }
    }

    // footer
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(spec.footer, 54, canvas.height - 14);
  }

  /** Closed-form reference for the current model/route, or null when degenerate. */
  private analyticRef(p: PkParams): ((t: number) => number) | null {
    if (p.model === 'one-compartment') {
      if (p.route === 'iv-bolus') return (t) => oneCompIvConc(t, p.dose, p.volume, p.ke);
      if (p.route === 'iv-infusion') return (t) => oneCompInfusionConc(t, p.dose, p.volume, p.ke, p.tInf ?? 0);
      return (t) => oneCompOralConc(t, p.dose, p.volume, p.ke, p.ka, p.f ?? 1);
    }
    const { alpha, beta } = macroRates(p.ke, p.k12, p.k21);
    if (p.route === 'iv-infusion' || Math.abs(alpha - beta) < 1e-12) return null;
    if (p.route === 'iv-bolus') {
      return (t) => twoCompIvAmount(t, p.dose, p.ke, p.k12, p.k21) / p.volume;
    }
    return (t) => twoCompOralAmount(t, p.dose, p.ke, p.k12, p.k21, p.ka, p.f ?? 1) / p.volume;
  }

  // ---- mode: single ----------------------------------------------------------

  private drawSingle(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const zh = this.zh;
    const s = this.state;
    const p = this.params();
    const dt = s.tMax / 900;
    const series = simulatePk(p, s.tMax, dt);
    const pdp = this.pd();

    if (s.view === 'effect') {
      const eff = series.concentration.map((c) => emaxEffect(c, pdp));
      const eTop = pdp.e0 + pdp.emax;
      const lines: PanelLine[] = [
        {
          points: series.times.map((t, i) => ({ x: t, y: eff[i]! })),
          color: 'rgba(120, 200, 250, 0.95)',
          label: zh ? '效应 E(t)（sigmoid-Emax）' : 'effect E(t) (sigmoid-Emax)',
        },
      ];
      this.renderPanel(g, canvas, {
        title: zh
          ? `效应-时间  ${s.model === 'two-compartment' ? '二室' : '一室'} · ${s.route === 'oral' ? '口服' : s.route === 'iv-infusion' ? '滴注' : '静脉推注'}  Emax=${s.pdEmax}  EC50=${s.pdEc50}  h=${s.pdHill}`
          : `Effect–time  ${s.model === 'two-compartment' ? 'two-compartment' : 'one-compartment'} · ${s.route === 'oral' ? 'oral' : s.route === 'iv-infusion' ? 'infusion' : 'IV bolus'}  Emax=${s.pdEmax}  EC50=${s.pdEc50}  h=${s.pdHill}`,
        tMax: s.tMax,
        yHi: eTop * 1.15,
        yLo: Math.min(0, pdp.e0),
        lines,
        refLines: [
          { y: pdp.e0, color: 'rgba(170,182,200,0.7)', label: `E0 ${s.pdE0}` },
          { y: eTop, color: 'rgba(240, 170, 110, 0.8)', label: `E0+Emax ${eTop}` },
        ],
        footer: zh
          ? `E(0)=${eff[0]!.toFixed(2)}  Emax 处 C=∞；EC50=${s.pdEc50} mg/L 对应 E0+Emax/2=${(pdp.e0 + pdp.emax / 2).toFixed(1)}`
          : `E(0)=${eff[0]!.toFixed(2)}  C->infty gives Emax; EC50=${s.pdEc50} mg/L maps to E0+Emax/2=${(pdp.e0 + pdp.emax / 2).toFixed(1)}`,
      });
      return;
    }

    const refAt = this.analyticRef(p);
    const lines: PanelLine[] = [
      {
        points: series.times.map((t, i) => ({ x: t, y: series.concentration[i]! })),
        color: 'rgba(120, 200, 250, 0.95)',
        label: zh ? 'RK4 数值解' : 'RK4 numeric',
      },
    ];
    if (refAt) {
      const refPts: PanelPoint[] = [];
      for (let i = 0; i <= 300; i += 1) {
        const t = (s.tMax * i) / 300;
        const c = refAt(t);
        if (Number.isFinite(c)) refPts.push({ x: t, y: c });
      }
      lines.push({
        points: refPts,
        color: 'rgba(240, 170, 110, 0.9)',
        width: 1.5,
        dash: [5, 4],
        label: zh ? '解析解（对照）' : 'analytic reference',
      });
    }
    const m = computePkMetricsSafe(p, s.tMax, s.tMax / 1200);
    const tHalfTxt = Number.isFinite(m.halfLife) ? m.halfLife.toFixed(2) : '—';
    const cmax = Math.max(...series.concentration, s.msc, 1e-6);
    const routeTxt = zh ? (s.route === 'oral' ? '口服' : s.route === 'iv-infusion' ? '滴注' : '静脉推注') : s.route === 'oral' ? 'oral' : s.route === 'iv-infusion' ? 'infusion' : 'IV bolus';
    this.renderPanel(g, canvas, {
      title: zh
        ? `药时曲线  ${s.model === 'two-compartment' ? '二室' : '一室'} · ${routeTxt}  D=${s.dose} mg  Vd=${s.volume} L`
        : `Concentration–time  ${s.model === 'two-compartment' ? 'two-compartment' : 'one-compartment'} · ${routeTxt}  D=${s.dose} mg  Vd=${s.volume} L`,
      tMax: s.tMax,
      yHi: cmax * 1.15,
      logScale: s.logScale,
      window: { mec: s.mec, msc: s.msc },
      lines,
      footer: zh
        ? `Cmax=${m.cmax.toFixed(2)} mg/L  Tmax=${m.tmax.toFixed(2)} h  t½=${tHalfTxt} h  AUC(数值)=${m.aucNumeric.toFixed(2)}  AUC(解析)=${m.aucAnalytic.toFixed(2)} mg·h/L  相对误差=${(m.aucRelErr * 100).toFixed(3)}%`
        : `Cmax=${m.cmax.toFixed(2)} mg/L  Tmax=${m.tmax.toFixed(2)} h  t½=${tHalfTxt} h  AUC(num)=${m.aucNumeric.toFixed(2)}  AUC(analytic)=${m.aucAnalytic.toFixed(2)} mg·h/L  rel.err=${(m.aucRelErr * 100).toFixed(3)}%`,
    });
  }

  // ---- mode: population ------------------------------------------------------

  private drawPopulation(
    g: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    res: ReturnType<typeof simulatePopulationPk>,
  ): void {
    const zh = this.zh;
    const s = this.state;
    const sorted = res.individuals.map((i) => i.cmax).sort((a, b) => a - b);
    const cmaxMed = sorted[Math.floor(sorted.length / 2)] ?? 1;
    const yHi = Math.max(...res.p95, s.msc, 1e-6) * 1.1;
    const mid = Math.floor(res.times.length / 2);
    const aucVals = res.individuals.map((i) => i.auc).sort((a, b) => a - b);
    const aucMed = aucVals[Math.floor(aucVals.length / 2)] ?? Number.NaN;
    this.renderPanel(g, canvas, {
      title: zh
        ? `群体药时曲线  N=${s.popN}  CV(CL)=${(s.cvCl * 100).toFixed(0)}%  CV(V)=${(s.cvV * 100).toFixed(0)}%  seed=${s.seed}`
        : `Population profile  N=${s.popN}  CV(CL)=${(s.cvCl * 100).toFixed(0)}%  CV(V)=${(s.cvV * 100).toFixed(0)}%  seed=${s.seed}`,
      tMax: s.tMax,
      yHi,
      window: { mec: s.mec, msc: s.msc },
      bands: [
        {
          upper: res.times.map((t, i) => ({ x: t, y: res.p95[i]! })),
          lower: res.times.map((t, i) => ({ x: t, y: res.p5[i]! })),
          color: 'rgba(120, 200, 250, 0.18)',
          label: zh ? 'P5–P95 分位带' : 'P5–P95 band',
        },
      ],
      lines: [
        {
          points: res.times.map((t, i) => ({ x: t, y: res.p50[i]! })),
          color: 'rgba(120, 200, 250, 0.95)',
          label: zh ? '中位线 P50' : 'median P50',
        },
      ],
      footer: zh
        ? `Cmax(中位)=${cmaxMed.toFixed(2)} mg/L  AUC0-∞(中位)=${Number.isFinite(aucMed) ? aucMed.toFixed(2) : '—'} mg·h/L  t=${res.times[mid]!.toFixed(1)} h 处 P5–P95=[${res.p5[mid]!.toFixed(2)}, ${res.p95[mid]!.toFixed(2)}]`
        : `Cmax(median)=${cmaxMed.toFixed(2)} mg/L  AUC0-inf(median)=${Number.isFinite(aucMed) ? aucMed.toFixed(2) : '—'} mg·h/L  P5–P95 @t=${res.times[mid]!.toFixed(1)} h = [${res.p5[mid]!.toFixed(2)}, ${res.p95[mid]!.toFixed(2)}]`,
    });
  }

  // ---- mode: ddi -------------------------------------------------------------

  private drawDdi(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const zh = this.zh;
    const s = this.state;
    const p = this.params();
    const factor = this.ddiFactorEffective();
    const pd = ddiScaledParams(p, factor);
    const dt = s.tMax / 900;
    const base = simulatePk(p, s.tMax, dt);
    const withDdi = simulatePk(pd, s.tMax, dt);
    const aucBase = steadyStateAuc(p, s.tau);
    const aucDdi = steadyStateAuc(pd, s.tau);
    const ratio = factor > 0 ? aucDdi / aucBase : Number.NaN;
    const yHi = Math.max(...base.concentration, ...withDdi.concentration, s.msc, 1e-6) * 1.15;
    const typeTxt = s.ddiType === 'none' ? (zh ? '无' : 'none') : s.ddiType === 'inhibitor' ? (zh ? '抑制剂' : 'inhibitor') : zh ? '诱导剂' : 'inducer';
    this.renderPanel(g, canvas, {
      title: zh
        ? `药物相互作用  ${typeTxt} · CL×${factor}  AUC ratio=${Number.isFinite(ratio) ? ratio.toFixed(2) : '—'}`
        : `Drug interaction  ${typeTxt} · CLx${factor}  AUC ratio=${Number.isFinite(ratio) ? ratio.toFixed(2) : '—'}`,
      tMax: s.tMax,
      yHi,
      window: { mec: s.mec, msc: s.msc },
      lines: [
        {
          points: base.times.map((t, i) => ({ x: t, y: base.concentration[i]! })),
          color: 'rgba(120, 200, 250, 0.95)',
          label: zh ? '基线（单药）' : 'baseline',
        },
        {
          points: withDdi.times.map((t, i) => ({ x: t, y: withDdi.concentration[i]! })),
          color: 'rgba(240, 150, 130, 0.95)',
          label: zh ? `合用 ${typeTxt}` : `with ${typeTxt}`,
        },
      ],
      footer: zh
        ? `AUC(基线)=${aucBase.toFixed(2)}  AUC(合用)=${aucDdi.toFixed(2)} mg·h/L  比值=${Number.isFinite(ratio) ? ratio.toFixed(2) : '—'}${ratio > 2 ? ' — 暴露量升高超过 2 倍，需关注毒性风险' : ''}`
        : `AUC(base)=${aucBase.toFixed(2)}  AUC(ddi)=${aucDdi.toFixed(2)} mg·h/L  ratio=${Number.isFinite(ratio) ? ratio.toFixed(2) : '—'}${ratio > 2 ? ' - exposure raised >2-fold, review toxicity risk' : ''}`,
    });
  }

  // ---- mode: tdm -------------------------------------------------------------

  private drawTdm(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const zh = this.zh;
    const s = this.state;
    const p = this.params();
    const tau = s.tau;
    const maxObsT = this.obs && this.obs.length > 0 ? Math.max(...this.obs.map((o) => o.t)) : 0;
    const span = Math.max(Math.min(s.tMax, 72), 2 * tau, maxObsT * 1.1, 6);
    const steps = 300;
    const ssTimes: number[] = [];
    const ssConc: number[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = (span * i) / steps;
      ssTimes.push(t);
      ssConc.push(steadyStateConc(p, tau, t % tau));
    }
    const trough = steadyStateTrough(p, tau);
    const peak = steadyStatePeak(p, tau);
    const recDose =
      s.targetKind === 'trough' ? solveDoseForTrough(p, tau, s.targetTrough) : solveDoseForAuc(p, s.targetAuc);

    const lines: PanelLine[] = [
      {
        points: ssTimes.map((t, i) => ({ x: t, y: ssConc[i]! })),
        color: 'rgba(120, 200, 250, 0.95)',
        label: zh ? `稳态曲线（τ=${tau} h）` : `steady state (tau=${tau} h)`,
      },
    ];
    if (this.tdmFit) {
      const fit = this.tdmFit;
      const route = s.route === 'oral' ? 'oral' : s.route === 'iv-infusion' ? 'iv-infusion' : 'iv-bolus';
      const pts: PanelPoint[] = [];
      for (let i = 0; i <= 200; i += 1) {
        const t = (span * i) / 200;
        const c =
          route === 'iv-bolus'
            ? oneCompIvConc(t, s.dose, fit.v, fit.ke)
            : route === 'iv-infusion'
              ? oneCompInfusionConc(t, s.dose, fit.v, fit.ke, s.tInf)
              : oneCompOralConc(t, s.dose, fit.v, fit.ke, fit.ka, s.f);
        if (Number.isFinite(c)) pts.push({ x: t, y: c });
      }
      if (pts.length >= 2) {
        lines.push({
          points: pts,
          color: 'rgba(240, 170, 110, 0.9)',
          width: 1.5,
          dash: [5, 4],
          label: zh ? '单剂量拟合曲线' : 'single-dose fit',
        });
      }
    }
    const points: PanelPoints[] | undefined =
      this.obs && this.obs.length > 0
        ? [
            {
              points: this.obs.map((o) => ({ x: o.t, y: o.c })),
              color: 'rgba(150, 235, 180, 0.95)',
              label: zh ? '实测浓度' : 'observed C',
            },
          ]
        : undefined;
    const yHi = Math.max(...ssConc, ...(this.obs?.map((o) => o.c) ?? [0]), s.msc, 1e-6) * 1.15;
    const targetTxt =
      s.targetKind === 'trough'
        ? zh
          ? `目标谷 ${s.targetTrough} → 推荐 D=${Number.isFinite(recDose) ? recDose.toFixed(1) : '—'} mg`
          : `target trough ${s.targetTrough} -> D=${Number.isFinite(recDose) ? recDose.toFixed(1) : '—'} mg`
        : zh
          ? `目标 AUC0-τ ${s.targetAuc} → 推荐 D=${Number.isFinite(recDose) ? recDose.toFixed(1) : '—'} mg`
          : `target AUC0-tau ${s.targetAuc} -> D=${Number.isFinite(recDose) ? recDose.toFixed(1) : '—'} mg`;
    this.renderPanel(g, canvas, {
      title: zh
        ? `剂量优化 / TDM  D=${s.dose} mg · τ=${tau} h  稳态谷=${trough.toFixed(2)} 峰=${peak.toFixed(2)} mg/L`
        : `Dosing / TDM  D=${s.dose} mg · tau=${tau} h  Css min=${trough.toFixed(2)} max=${peak.toFixed(2)} mg/L`,
      tMax: span,
      yHi,
      window: { mec: s.mec, msc: s.msc },
      lines,
      points,
      footer: `${targetTxt}  ·  AUC0-τ,ss=${steadyStateAuc(p, tau).toFixed(2)} mg·h/L${
        this.tdmFit
          ? zh
            ? `  ·  拟合 CL=${this.tdmFit.cl.toFixed(2)} L/h  V=${this.tdmFit.v.toFixed(2)} L  t½=${(Math.LN2 / this.tdmFit.ke).toFixed(2)} h`
            : `  ·  fit CL=${this.tdmFit.cl.toFixed(2)} L/h  V=${this.tdmFit.v.toFixed(2)} L  t½=${(Math.LN2 / this.tdmFit.ke).toFixed(2)} h`
          : ''
      }`,
    });
  }
}

/** Thin wrapper so the draw path never throws on degenerate parameters. */
function computePkMetricsSafe(p: PkParams, tMax: number, dt: number) {
  try {
    return computePkMetrics(p, tMax, dt);
  } catch {
    return { cmax: NaN, tmax: NaN, halfLife: NaN, aucNumeric: NaN, aucAnalytic: NaN, aucRelErr: NaN };
  }
}

export default function createBioPkPlugin(): Plugin {
  return new BioPkPlugin();
}
