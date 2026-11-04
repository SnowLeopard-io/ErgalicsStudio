// ==========================================================================
// bio-epidemic — SIR / SEIR compartment epidemiology workbench (2-D)
//
// Plots the susceptible / exposed / infectious / recovered curves over time,
// overlays R_eff = R₀·S/N (the herd-immunity cross-over) and reports the
// peak infectious load, peak day, final attack rate and the herd-immunity
// threshold. Defaults to a deterministic measles-like SIR demo so the panel
// opens with content; a one-click demo button also burns in an R₀ sensitivity
// overlay illustrating how lowering R₀ suppresses the peak.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  drawEmptyCanvas,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { bioEpidemicManifest } from './manifest';
import {
  DEFAULT_CONFIG,
  conservationDrift,
  earlyGrowthRt,
  estimateRt,
  finalSizeCheck,
  metapopConservationDrift,
  parseIncidenceCsv,
  parseMobilityMatrix,
  parseObservedSeries,
  parseRegionCsv,
  reportEpidemic,
  simulateEpidemic,
  simulateMetapop,
  type EpidemicReport,
  type InterventionWindow,
  type MetapopConfig,
  type MetapopResult,
  type ModelConfig,
  type ObservedSeries,
  type RegionSpec,
  type RtEstimate,
  type Trajectory,
} from './epidemic';

export { bioEpidemicManifest } from './manifest';

interface State {
  model: ModelConfig['model'];
  r0: number;
  infectiousDays: number;
  latentDays: number;
  population: number;
  initialInfected: number;
  days: number;
  showSensitivity: boolean;
  logY: boolean;
  /** Workbench mode: single population, multi-region SEIR, or Rt from data. */
  mode: 'single' | 'metapop' | 'rt';
  /** Region table text (CSV columns region,population,infected). */
  regionsText: string;
  mobilityMode: 'gravity' | 'manual';
  gravityCoeff: number;
  mobilityText: string;
  metapopStacked: boolean;
  ageStructure: boolean;
  ageContactScale: number;
  vaccRate: number;
  vaccEff: number;
  waningRate: number;
  strain2Enabled: boolean;
  strain2R0: number;
  strain2Share: number;
  lockdownStart: number;
  lockdownEnd: number;
  lockdownEff: number;
  maskStart: number;
  maskEnd: number;
  maskEff: number;
  travelStart: number;
  travelEnd: number;
  travelEff: number;
  siMean: number;
  siSd: number;
  rtWindow: number;
}

/** Low-saturation academic palette for per-region curves. */
const EPI_PALETTE = ['#6f8fae', '#ae8f6f', '#6fae8f', '#ae6f8f', '#8f6fae', '#a0ae6f', '#6fa0ae', '#ae7f6f'];

/** Compact count formatting for canvas axis ticks. */
function fmtCount(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  return v.toFixed(0);
}

export class BioEpidemicPlugin implements Plugin {
  readonly manifest = bioEpidemicManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private hasData = false;
  private observed: ObservedSeries | null = null;
  private state: State = {
    model: DEFAULT_CONFIG.model,
    r0: DEFAULT_CONFIG.r0,
    infectiousDays: DEFAULT_CONFIG.infectiousDays,
    latentDays: DEFAULT_CONFIG.latentDays,
    population: DEFAULT_CONFIG.population,
    initialInfected: DEFAULT_CONFIG.initialInfected,
    days: DEFAULT_CONFIG.days,
    showSensitivity: false,
    logY: false,
    mode: 'single',
    regionsText: '',
    mobilityMode: 'gravity',
    gravityCoeff: 0.005,
    mobilityText: '',
    metapopStacked: false,
    ageStructure: false,
    ageContactScale: 1,
    vaccRate: 0,
    vaccEff: 0.7,
    waningRate: 0,
    strain2Enabled: false,
    strain2R0: 3.5,
    strain2Share: 0.2,
    lockdownStart: 30,
    lockdownEnd: 60,
    lockdownEff: 0,
    maskStart: 30,
    maskEnd: 60,
    maskEff: 0,
    travelStart: 30,
    travelEnd: 60,
    travelEff: 0,
    siMean: 5.2,
    siSd: 1.7,
    rtWindow: 7,
  };
  private report: EpidemicReport | null = null;
  private lastTraj: Trajectory | null = null;
  private trajectories: Array<{ r0: number; lat?: number[]; inc?: number[]; fr?: number[]; rec: number[]; days: number[] }> = [];
  private regions: RegionSpec[] | null = null;
  private regionsInvalid = false;
  private mobilityInvalid = false;
  private meta: MetapopResult | null = null;
  private rtSeries: ObservedSeries | null = null;
  private rtEst: RtEstimate | null = null;

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

  private config(): ModelConfig {
    return {
      model: this.state.model,
      r0: this.state.r0,
      infectiousDays: this.state.infectiousDays,
      latentDays: this.state.latentDays,
      population: this.state.population,
      initialInfected: this.state.initialInfected,
      initialExposed: 0,
      days: this.state.days,
    };
  }

  getParams(): ParamDefinition[] {
    const notRt = { key: 'mode', notIn: ['rt'] } as const;
    const onlySingle = { key: 'mode', in: ['single'] } as const;
    const onlyMeta = { key: 'mode', in: ['metapop'] } as const;
    const onlyRt = { key: 'mode', in: ['rt'] } as const;
    return [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '模式', 'en-US': 'Mode' },
        type: 'select',
        options: [
          { value: 'single', label: 'Single population', labelI18n: { 'zh-CN': '单区域（SIR/SEIR）', 'en-US': 'Single population' } },
          { value: 'metapop', label: 'Multi-region SEIR', labelI18n: { 'zh-CN': '多区域 SEIR', 'en-US': 'Multi-region SEIR' } },
          { value: 'rt', label: 'Rt from data', labelI18n: { 'zh-CN': 'Rt 估计（数据）', 'en-US': 'Rt from data' } },
        ],
        value: this.state.mode,
      },
      {
        key: 'model',
        label: 'Model',
        labelI18n: { 'zh-CN': '模型', 'en-US': 'Model' },
        type: 'select',
        options: [
          { value: 'SIR', label: 'SIR', labelI18n: { 'zh-CN': 'SIR（无潜伏期）', 'en-US': 'SIR' } },
          { value: 'SEIR', label: 'SEIR', labelI18n: { 'zh-CN': 'SEIR（含潜伏期）', 'en-US': 'SEIR' } },
        ],
        value: this.state.model,
        visibleWhen: onlySingle,
      },
      {
        key: 'r0',
        label: 'R₀',
        labelI18n: { 'zh-CN': '基本再生数 R₀', 'en-US': 'Basic reproduction R₀' },
        type: 'range',
        min: 0.5,
        max: 8,
        step: 0.1,
        value: this.state.r0,
        visibleWhen: notRt,
      },
      {
        key: 'infectiousDays',
        label: 'D_inf',
        labelI18n: { 'zh-CN': '传染期（天）', 'en-US': 'Infectious period (d)' },
        type: 'range',
        min: 1,
        max: 20,
        step: 1,
        value: this.state.infectiousDays,
        visibleWhen: notRt,
      },
      {
        key: 'latentDays',
        label: 'D_lat',
        labelI18n: { 'zh-CN': '潜伏期（天，SEIR）', 'en-US': 'Latent period (d, SEIR)' },
        type: 'range',
        min: 1,
        max: 20,
        step: 1,
        value: this.state.latentDays,
        visibleWhen: notRt,
      },
      {
        key: 'population',
        label: 'N',
        labelI18n: { 'zh-CN': '总人口 N', 'en-US': 'Population N' },
        type: 'select',
        options: [1e5, 1e6, 1e7, 1e8].map((v) => ({
          value: String(v),
          label: String(v),
          labelI18n: { 'zh-CN': String(v), 'en-US': String(v) },
        })),
        value: String(this.state.population),
        visibleWhen: onlySingle,
      },
      {
        key: 'initialInfected',
        label: 'I₀',
        labelI18n: { 'zh-CN': '初始感染者 I₀', 'en-US': 'Initial infected I₀' },
        type: 'range',
        min: 1,
        max: 2000,
        step: 1,
        value: this.state.initialInfected,
        visibleWhen: onlySingle,
      },
      {
        key: 'days',
        label: 'Days',
        labelI18n: { 'zh-CN': '模拟天数', 'en-US': 'Days' },
        type: 'range',
        min: 30,
        max: 365,
        step: 5,
        value: this.state.days,
      },
      // ---- multi-region (metapop) ----
      {
        key: 'regionsText',
        label: 'Regions CSV',
        labelI18n: { 'zh-CN': '区域定义（CSV 文本）', 'en-US': 'Regions CSV' },
        type: 'text',
        value: this.state.regionsText,
        placeholder: 'region,population,infected\nNorth,1200000,40\nSouth,900000,25',
        hint: 'One row per region, columns region,population,infected; or load a region CSV file.',
        visibleWhen: onlyMeta,
      },
      {
        key: 'mobilityMode',
        label: 'Mobility',
        labelI18n: { 'zh-CN': '区域间迁移', 'en-US': 'Mobility' },
        type: 'select',
        options: [
          { value: 'gravity', label: 'Gravity model', labelI18n: { 'zh-CN': '重力模型（按人口比例）', 'en-US': 'Gravity model' } },
          { value: 'manual', label: 'Manual matrix', labelI18n: { 'zh-CN': '手动矩阵', 'en-US': 'Manual matrix' } },
        ],
        value: this.state.mobilityMode,
        visibleWhen: onlyMeta,
      },
      {
        key: 'gravityCoeff',
        label: 'Gravity coeff',
        labelI18n: { 'zh-CN': '重力系数 g', 'en-US': 'Gravity coeff' },
        type: 'range',
        min: 0,
        max: 0.05,
        step: 0.001,
        value: this.state.gravityCoeff,
        hint: 'Per-day inter-region migration rate g; flux_ij = g * Ni * Nj / N^2.',
        visibleWhen: onlyMeta,
      },
      {
        key: 'mobilityText',
        label: 'Mobility matrix',
        labelI18n: { 'zh-CN': '迁移率矩阵（每日比例）', 'en-US': 'Mobility matrix' },
        type: 'text',
        value: this.state.mobilityText,
        placeholder: '0 0.001 0.0005\n0.001 0 0.002\n0.0005 0.002 0',
        hint: 'n x n symmetric per-day migration rates (upper triangle also accepted); rows must match region count.',
        visibleWhen: onlyMeta,
      },
      {
        key: 'metapopStacked',
        label: 'Stacked totals',
        labelI18n: { 'zh-CN': '堆叠总量图', 'en-US': 'Stacked totals' },
        type: 'checkbox',
        value: this.state.metapopStacked,
        visibleWhen: onlyMeta,
      },
      {
        key: 'ageStructure',
        label: 'Age groups (3)',
        labelI18n: { 'zh-CN': '年龄分组（3 组）', 'en-US': 'Age groups (3)' },
        type: 'checkbox',
        value: this.state.ageStructure,
        hint: 'Children / adults / elderly with a fixed simplified POLYMOD 3x3 contact matrix.',
        visibleWhen: onlyMeta,
      },
      {
        key: 'ageContactScale',
        label: 'Contact scale',
        labelI18n: { 'zh-CN': '接触矩阵缩放', 'en-US': 'Contact scale' },
        type: 'range',
        min: 0.2,
        max: 3,
        step: 0.1,
        value: this.state.ageContactScale,
        visibleWhen: { key: 'ageStructure', in: [true] },
      },
      // ---- vaccination / waning / second strain (single + metapop) ----
      {
        key: 'vaccRate',
        label: 'Vax rate /day',
        labelI18n: { 'zh-CN': '疫苗接种率（每日比例）', 'en-US': 'Vaccination rate (per day)' },
        type: 'range',
        min: 0,
        max: 0.05,
        step: 0.001,
        value: this.state.vaccRate,
        visibleWhen: notRt,
      },
      {
        key: 'vaccEff',
        label: 'Vax efficacy',
        labelI18n: { 'zh-CN': '疫苗效力（降低易感性）', 'en-US': 'Vaccine efficacy (1 - susceptibility)' },
        type: 'range',
        min: 0,
        max: 1,
        step: 0.05,
        value: this.state.vaccEff,
        visibleWhen: notRt,
      },
      {
        key: 'waningRate',
        label: 'Waning /day',
        labelI18n: { 'zh-CN': '免疫衰减率（R/V→S）', 'en-US': 'Immunity waning (R/V to S)' },
        type: 'range',
        min: 0,
        max: 0.05,
        step: 0.001,
        value: this.state.waningRate,
        visibleWhen: notRt,
      },
      {
        key: 'strain2Enabled',
        label: 'Second strain',
        labelI18n: { 'zh-CN': '启用第二毒株', 'en-US': 'Second strain' },
        type: 'checkbox',
        value: this.state.strain2Enabled,
        hint: 'Both strains compete for the same susceptible pool; recovery from one grants immunity to both.',
        visibleWhen: notRt,
      },
      {
        key: 'strain2R0',
        label: 'R₀ strain 2',
        labelI18n: { 'zh-CN': '第二毒株 R₀', 'en-US': 'R₀ of strain 2' },
        type: 'range',
        min: 0.5,
        max: 8,
        step: 0.1,
        value: this.state.strain2R0,
        visibleWhen: { key: 'strain2Enabled', in: [true] },
      },
      {
        key: 'strain2Share',
        label: 'Strain 2 share',
        labelI18n: { 'zh-CN': '第二毒株初始占比', 'en-US': 'Initial share of strain 2' },
        type: 'range',
        min: 0,
        max: 1,
        step: 0.05,
        value: this.state.strain2Share,
        visibleWhen: { key: 'strain2Enabled', in: [true] },
      },
      // ---- scheduled interventions (single + metapop; travel metapop only) ----
      {
        key: 'lockdownStart',
        label: 'Lockdown start',
        labelI18n: { 'zh-CN': '封锁开始（天）', 'en-US': 'Lockdown start (d)' },
        type: 'number',
        min: 0,
        max: 365,
        step: 1,
        value: this.state.lockdownStart,
        visibleWhen: notRt,
      },
      {
        key: 'lockdownEnd',
        label: 'Lockdown end',
        labelI18n: { 'zh-CN': '封锁结束（天）', 'en-US': 'Lockdown end (d)' },
        type: 'number',
        min: 0,
        max: 365,
        step: 1,
        value: this.state.lockdownEnd,
        visibleWhen: notRt,
      },
      {
        key: 'lockdownEff',
        label: 'Lockdown strength',
        labelI18n: { 'zh-CN': '封锁强度（接触率折扣）', 'en-US': 'Lockdown strength (contact cut)' },
        type: 'range',
        min: 0,
        max: 0.95,
        step: 0.05,
        value: this.state.lockdownEff,
        visibleWhen: notRt,
      },
      {
        key: 'maskStart',
        label: 'Mask start',
        labelI18n: { 'zh-CN': '口罩开始（天）', 'en-US': 'Mask start (d)' },
        type: 'number',
        min: 0,
        max: 365,
        step: 1,
        value: this.state.maskStart,
        visibleWhen: notRt,
      },
      {
        key: 'maskEnd',
        label: 'Mask end',
        labelI18n: { 'zh-CN': '口罩结束（天）', 'en-US': 'Mask end (d)' },
        type: 'number',
        min: 0,
        max: 365,
        step: 1,
        value: this.state.maskEnd,
        visibleWhen: notRt,
      },
      {
        key: 'maskEff',
        label: 'Mask strength',
        labelI18n: { 'zh-CN': '口罩强度（传播折扣）', 'en-US': 'Mask strength (transmission cut)' },
        type: 'range',
        min: 0,
        max: 0.95,
        step: 0.05,
        value: this.state.maskEff,
        visibleWhen: notRt,
      },
      {
        key: 'travelStart',
        label: 'Travel start',
        labelI18n: { 'zh-CN': '旅行限制开始（天）', 'en-US': 'Travel restriction start (d)' },
        type: 'number',
        min: 0,
        max: 365,
        step: 1,
        value: this.state.travelStart,
        visibleWhen: onlyMeta,
      },
      {
        key: 'travelEnd',
        label: 'Travel end',
        labelI18n: { 'zh-CN': '旅行限制结束（天）', 'en-US': 'Travel restriction end (d)' },
        type: 'number',
        min: 0,
        max: 365,
        step: 1,
        value: this.state.travelEnd,
        visibleWhen: onlyMeta,
      },
      {
        key: 'travelEff',
        label: 'Travel strength',
        labelI18n: { 'zh-CN': '旅行限制强度（迁移折扣）', 'en-US': 'Travel restriction strength (mobility cut)' },
        type: 'range',
        min: 0,
        max: 0.95,
        step: 0.05,
        value: this.state.travelEff,
        visibleWhen: onlyMeta,
      },
      // ---- Rt estimation (rt mode) ----
      {
        key: 'siMean',
        label: 'SI mean (d)',
        labelI18n: { 'zh-CN': '世代间隔均值（天）', 'en-US': 'Serial interval mean (d)' },
        type: 'range',
        min: 1,
        max: 14,
        step: 0.1,
        value: this.state.siMean,
        hint: 'Gamma-distributed serial interval, discretized on daily units (default 5.2 d).',
        visibleWhen: onlyRt,
      },
      {
        key: 'siSd',
        label: 'SI SD (d)',
        labelI18n: { 'zh-CN': '世代间隔标准差（天）', 'en-US': 'Serial interval SD (d)' },
        type: 'range',
        min: 0.5,
        max: 5,
        step: 0.1,
        value: this.state.siSd,
        visibleWhen: onlyRt,
      },
      {
        key: 'rtWindow',
        label: 'Rt window (d)',
        labelI18n: { 'zh-CN': 'Rt 滑窗（天）', 'en-US': 'Rt window (d)' },
        type: 'range',
        min: 3,
        max: 21,
        step: 1,
        value: this.state.rtWindow,
        hint: 'Cori et al. (2013) sliding window width; Gamma(1, 5) prior.',
        visibleWhen: onlyRt,
      },
      // ---- display ----
      {
        key: 'logY',
        label: 'log scale',
        labelI18n: { 'zh-CN': '对数纵轴（log10）', 'en-US': 'Log y-axis (log10)' },
        type: 'checkbox',
        value: this.state.logY,
        visibleWhen: notRt,
      },
      {
        key: 'showSensitivity',
        label: 'R₀ sensitivity',
        labelI18n: { 'zh-CN': 'R₀ 敏感性叠加', 'en-US': 'R₀ sensitivity overlay' },
        type: 'checkbox',
        value: this.state.showSensitivity,
        visibleWhen: onlySingle,
      },
      actionButton('overlay', 'Overlay R₀ curves', '叠加 R₀ 敏感性曲线', 'primary'),
      actionButton('exportCsv', 'Export CSV', '导出数据 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, cb: (n: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (cb(params[k] as number)) this.draw();
      }
    };
    const changed = (k: keyof State, v: unknown) => {
      if ((this.state[k] as unknown) !== v) this.state[k] = v as never;
      else return;
      this.recompute();
      this.draw();
    };
    if (typeof params.model === 'string' && (params.model === 'SIR' || params.model === 'SEIR')) changed('model', params.model);
    num('r0', (n) => {
      if (n === this.state.r0) return false;
      this.state.r0 = Math.max(0.1, n);
      this.recompute();
      return true;
    });
    num('infectiousDays', (n) => {
      if (n === this.state.infectiousDays) return false;
      this.state.infectiousDays = Math.max(0.5, n);
      this.recompute();
      return true;
    });
    num('latentDays', (n) => {
      if (n === this.state.latentDays) return false;
      this.state.latentDays = Math.max(0.5, n);
      this.recompute();
      return true;
    });
    if (typeof params.population === 'string' || typeof params.population === 'number') {
      const pv = typeof params.population === 'string' ? Number(params.population) : params.population;
      if (Number.isFinite(pv) && pv !== this.state.population) {
        this.state.population = Math.max(100, pv);
        this.recompute();
        this.draw();
      }
    }
    num('initialInfected', (n) => {
      if (n === this.state.initialInfected) return false;
      this.state.initialInfected = Math.max(1, n);
      this.recompute();
      return true;
    });
    num('days', (n) => {
      if (n === this.state.days) return false;
      this.state.days = Math.max(10, n);
      this.recompute();
      return true;
    });
    if (typeof params.logY === 'boolean' && params.logY !== this.state.logY) {
      this.state.logY = params.logY;
      this.draw();
    }
    if (typeof params.showSensitivity === 'boolean' && params.showSensitivity !== this.state.showSensitivity) {
      this.state.showSensitivity = params.showSensitivity;
      this.draw();
    }
    if (actionFired(params, 'overlay')) {
      this.state.showSensitivity = !this.state.showSensitivity;
      this.draw();
    }

    if (actionFired(params, 'exportCsv')) this.exportCsv();

    // ---- extended modes ----
    if (
      typeof params.mode === 'string' &&
      (params.mode === 'single' || params.mode === 'metapop' || params.mode === 'rt')
    ) {
      changed('mode', params.mode);
    }
    if (typeof params.regionsText === 'string' && params.regionsText !== this.state.regionsText) {
      this.state.regionsText = params.regionsText;
      const parsed = parseRegionCsv(params.regionsText);
      this.regions = parsed;
      this.regionsInvalid = parsed === null && params.regionsText.trim().length > 0;
      this.recompute();
      this.draw();
    }
    if (typeof params.mobilityMode === 'string' && (params.mobilityMode === 'gravity' || params.mobilityMode === 'manual')) {
      changed('mobilityMode', params.mobilityMode);
    }
    if (typeof params.mobilityText === 'string' && params.mobilityText !== this.state.mobilityText) {
      this.state.mobilityText = params.mobilityText;
      this.recompute();
      this.draw();
    }
    num('gravityCoeff', (n) => {
      if (n === this.state.gravityCoeff) return false;
      this.state.gravityCoeff = Math.max(0, n);
      this.recompute();
      return true;
    });
    if (typeof params.metapopStacked === 'boolean' && params.metapopStacked !== this.state.metapopStacked) {
      this.state.metapopStacked = params.metapopStacked;
      this.draw();
    }
    if (typeof params.ageStructure === 'boolean' && params.ageStructure !== this.state.ageStructure) {
      changed('ageStructure', params.ageStructure);
    }
    num('ageContactScale', (n) => {
      if (n === this.state.ageContactScale) return false;
      this.state.ageContactScale = Math.max(0.05, n);
      this.recompute();
      return true;
    });
    num('vaccRate', (n) => {
      if (n === this.state.vaccRate) return false;
      this.state.vaccRate = Math.max(0, n);
      this.recompute();
      return true;
    });
    num('vaccEff', (n) => {
      if (n === this.state.vaccEff) return false;
      this.state.vaccEff = Math.min(1, Math.max(0, n));
      this.recompute();
      return true;
    });
    num('waningRate', (n) => {
      if (n === this.state.waningRate) return false;
      this.state.waningRate = Math.max(0, n);
      this.recompute();
      return true;
    });
    if (typeof params.strain2Enabled === 'boolean' && params.strain2Enabled !== this.state.strain2Enabled) {
      changed('strain2Enabled', params.strain2Enabled);
    }
    num('strain2R0', (n) => {
      if (n === this.state.strain2R0) return false;
      this.state.strain2R0 = Math.max(0.1, n);
      this.recompute();
      return true;
    });
    num('strain2Share', (n) => {
      if (n === this.state.strain2Share) return false;
      this.state.strain2Share = Math.min(1, Math.max(0, n));
      this.recompute();
      return true;
    });
    for (const key of ['lockdownStart', 'lockdownEnd', 'maskStart', 'maskEnd', 'travelStart', 'travelEnd'] as const) {
      num(key, (n) => {
        if (n === this.state[key]) return false;
        this.state[key] = Math.min(365, Math.max(0, Math.round(n)));
        this.recompute();
        return true;
      });
    }
    for (const key of ['lockdownEff', 'maskEff', 'travelEff'] as const) {
      num(key, (n) => {
        if (n === this.state[key]) return false;
        this.state[key] = Math.min(0.95, Math.max(0, n));
        this.recompute();
        return true;
      });
    }
    num('siMean', (n) => {
      if (n === this.state.siMean) return false;
      this.state.siMean = Math.max(0.5, n);
      this.recompute();
      return true;
    });
    num('siSd', (n) => {
      if (n === this.state.siSd) return false;
      this.state.siSd = Math.max(0.1, n);
      this.recompute();
      return true;
    });
    num('rtWindow', (n) => {
      if (n === this.state.rtWindow) return false;
      this.state.rtWindow = Math.min(30, Math.max(1, Math.round(n)));
      this.recompute();
      return true;
    });
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    const isJson = low.endsWith('.json');
    const isTabular = low.endsWith('.csv') || low.endsWith('.tsv') || low.endsWith('.txt') || low.endsWith('.dat');
    if (!isJson && !isTabular) {
      notify(this.api, 'warning', 'Epidemic accepts model-config JSON or daily-case CSV/TSV.', '传染病插件接受模型配置 JSON 或逐日病例 CSV/TSV。');
      return;
    }
    const text = await file.text();
    if (isTabular) {
      // Classify the table by its header: region table, incidence series, or
      // the legacy (day, cases) observed series.
      const headerLine =
        text
          .trim()
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l && !l.startsWith('#')) ?? '';
      const header = headerLine.toLowerCase().split(/[,;\t]+/).map((c) => c.trim());
      const isRegionTable = header.includes('region') && (header.includes('population') || header.includes('pop'));
      const isIncidence =
        header.includes('date') || (header.includes('time') && (header.includes('incidence') || header.includes('new_cases')));
      if (isRegionTable) {
        const regions = parseRegionCsv(text);
        if (!regions) {
          notify(
            this.api,
            'error',
            'Region CSV must have columns region,population,infected - file rejected.',
            '区域 CSV 必须包含 region,population,infected 列，已拒绝该文件。',
          );
          return;
        }
        this.regions = regions;
        this.regionsInvalid = false;
        this.state.regionsText = text;
        this.state.mode = 'metapop';
        this.hasData = true;
        this.recompute();
        const total = regions.reduce((s, r) => s + r.population, 0);
        notify(
          this.api,
          'success',
          `Loaded ${regions.length} regions (total population ${total.toLocaleString()}), switched to multi-region mode.`,
          `已载入 ${regions.length} 个区域（总人口 ${total.toLocaleString()}），已切换到多区域模式。`,
        );
        this.draw();
        return;
      }
      if (isIncidence) {
        const obs = parseIncidenceCsv(text);
        if (!obs) {
          notify(
            this.api,
            'error',
            'Incidence CSV must have columns date,new_cases (or time,incidence) - file rejected.',
            '发病 CSV 必须包含 date,new_cases（或 time,incidence）列，已拒绝该文件。',
          );
          return;
        }
        this.rtSeries = obs;
        this.state.mode = 'rt';
        this.hasData = true;
        this.recompute();
        notify(
          this.api,
          'success',
          `Loaded ${obs.days.length} incidence rows, estimating Rt.`,
          `已载入 ${obs.days.length} 行发病数据，正在估计 Rt。`,
        );
        this.draw();
        return;
      }
      if (this.state.mode !== 'single') {
        notify(
          this.api,
          'warning',
          'In this mode the CSV must be a region table (region,population,infected) or an incidence series (date,new_cases).',
          '当前模式下 CSV 必须是区域表（region,population,infected）或发病序列（date,new_cases）。',
        );
        return;
      }
      const obs = parseObservedSeries(text);
      if (!obs) {
        notify(this.api, 'warning', 'Need at least 2 day, cases rows.', '至少需要 2 行 day,cases 数据。');
        return;
      }
      this.observed = obs;
      this.hasData = true;
      // Align the model horizon with the observed series so the overlay fits.
      this.state.days = Math.max(this.state.days, obs.days[obs.days.length - 1]! + 1);
      const src = obs.cumulative[obs.cumulative.length - 1]!;
      // Infer a plausible total population from the cumulative case total + margin.
      if (src > 0) this.state.population = Math.max(this.state.population, Math.round(src * 4));
      this.recompute();
      notify(
        this.api,
        'success',
        `Loaded ${obs.days.length} daily-case rows (peak new ${Math.max(...obs.newCases)}).`,
        `已加载 ${obs.days.length} 行逐日病例（新增峰值 ${Math.max(...obs.newCases)}）。`,
      );
      this.draw();
      return;
    }
    if (this.state.mode !== 'single') {
      notify(this.api, 'warning', 'Model-config JSON applies to the single-population mode only.', '模型配置 JSON 仅适用于单区域模式。');
      return;
    }
    try {
      const cfg = JSON.parse(text) as Partial<ModelConfig>;
      const s = this.state;
      if (typeof cfg.r0 === 'number') s.r0 = cfg.r0;
      if (typeof cfg.infectiousDays === 'number') s.infectiousDays = cfg.infectiousDays;
      if (typeof cfg.latentDays === 'number') s.latentDays = cfg.latentDays;
      if (typeof cfg.population === 'number') s.population = cfg.population;
      if (typeof cfg.initialInfected === 'number') s.initialInfected = cfg.initialInfected;
      if (typeof cfg.days === 'number') s.days = cfg.days;
      if (cfg.model === 'SIR' || cfg.model === 'SEIR') s.model = cfg.model;
      this.hasData = true;
      this.recompute();
      notify(this.api, 'success', 'Config loaded.', '已加载模型配置。');
      this.draw();
    } catch {
      notify(this.api, 'error', 'Invalid JSON config.', '无效的 JSON 配置。');
    }
  }

  /** Whether the single-population mode needs the extended kernel (vaccine, waning, strain 2 or interventions). */
  private extendedSingleActive(): boolean {
    const s = this.state;
    const win = (a: number, b: number, e: number): boolean => e > 0 && b > a;
    return (
      s.mode === 'single' &&
      (s.vaccRate > 0 ||
        s.waningRate > 0 ||
        s.strain2Enabled ||
        win(s.lockdownStart, s.lockdownEnd, s.lockdownEff) ||
        win(s.maskStart, s.maskEnd, s.maskEff))
    );
  }

  /** Build the metapop kernel config from the current state (null when no valid regions). */
  private metapopConfig(): MetapopConfig | null {
    const s = this.state;
    const isMeta = s.mode === 'metapop';
    const regions: RegionSpec[] = isMeta
      ? (this.regions ?? [])
      : [{ name: 'Population', population: s.population, infected: s.initialInfected }];
    if (regions.length === 0) return null;
    let mobility: number[][] | null = null;
    this.mobilityInvalid = false;
    let gravity = 0;
    if (isMeta) {
      if (s.mobilityMode === 'manual') {
        if (s.mobilityText.trim()) {
          mobility = parseMobilityMatrix(s.mobilityText, regions.length);
          this.mobilityInvalid = mobility === null;
        }
      } else {
        gravity = s.gravityCoeff;
      }
    }
    const win = (a: number, b: number, e: number): InterventionWindow | null =>
      e > 0 && b > a ? { start: a, end: b, strength: Math.min(0.95, e) } : null;
    return {
      regions,
      r0: s.r0,
      infectiousDays: s.infectiousDays,
      latentDays: s.latentDays,
      days: s.days,
      mobility,
      gravityCoeff: mobility ? 0 : gravity,
      ageStructure: isMeta && s.ageStructure,
      ageContactScale: s.ageContactScale,
      vaccinationRate: s.vaccRate,
      vaccineEfficacy: s.vaccEff,
      waningRate: s.waningRate,
      strain2Enabled: s.strain2Enabled,
      strain2R0: s.strain2R0,
      strain2Share: s.strain2Share,
      lockdown: win(s.lockdownStart, s.lockdownEnd, s.lockdownEff),
      mask: win(s.maskStart, s.maskEnd, s.maskEff),
      travelRestriction: isMeta ? win(s.travelStart, s.travelEnd, s.travelEff) : null,
    };
  }

  /** Map a 1-region metapop result onto the classic compartment report. */
  private singleReportFromMeta(res: MetapopResult): EpidemicReport | null {
    const rg = res.regions[0];
    const sum = res.perRegion[0];
    if (!rg || !sum) return null;
    const last = res.days.length - 1;
    const pop = Math.max(1, rg.population);
    return {
      peakInfectious: sum.peakInfectious,
      peakDay: sum.peakDay,
      peakFraction: sum.peakInfectious / pop,
      finalRecoveredFraction: (rg.recovered[last]! + rg.vaccinated[last]!) / pop,
      finalSusceptibleFraction: rg.susceptible[last]! / pop,
      totalCasesFraction: sum.totalInfections / pop,
      r0: this.state.r0,
      herdImmunityFraction: this.state.r0 > 1 ? 1 - 1 / this.state.r0 : 0,
      attackRateFraction: sum.totalInfections / pop,
    };
  }

  private recompute() {
    const s = this.state;
    if (s.mode === 'rt') {
      this.rtEst = this.rtSeries
        ? estimateRt(this.rtSeries.newCases, { siMean: s.siMean, siSd: s.siSd, window: s.rtWindow })
        : null;
      this.report = null;
      this.lastTraj = null;
      this.meta = null;
      this.publish();
      return;
    }
    if (s.mode === 'metapop' || this.extendedSingleActive()) {
      const mcfg = this.metapopConfig();
      this.meta = mcfg ? simulateMetapop(mcfg) : null;
      this.report = this.meta ? this.singleReportFromMeta(this.meta) : null;
      this.lastTraj = null;
      this.publish();
      return;
    }
    const cfg = this.config();
    const traj = simulateEpidemic(cfg);
    this.report = reportEpidemic(cfg, traj);
    this.lastTraj = traj;
    this.meta = null;
    this.publish();
    if (s.showSensitivity) this.trajectories = this.overlayTrajectories();
  }

  /**
   * Publish the run's scientific outputs. Mode-dependent: Rt windows for the
   * data mode, per-region peaks / attack rates for the metapop mode, and the
   * classic conservation / final-size diagnostics for the single mode. Only
   * published once the user has loaded a config / data - never fabricated.
   */
  private publish() {
    const zh = this.zh;
    if (this.state.mode === 'rt') {
      const est = this.rtEst;
      if (!est || est.points.length === 0 || !est.latest) {
        clearScienceOutputs(this.manifest.id);
        return;
      }
      const latest = est.latest;
      const metrics: ScienceMetric[] = [
        {
          key: 'rt-latest',
          label: 'R_t (latest)',
          value: fmtMetric(latest.rt),
          severity: latest.rt >= 1 ? 'warn' : 'ok',
          hint: zh
            ? `Cori et al. (2013) 贝叶斯滑窗估计（窗宽 ${est.window} 天，Γ(1,5) 先验）；世代间隔 Γ 分布按天离散化（均值 5.2、标准差 1.7 天）`
            : `Cori et al. (2013) Bayesian sliding window (width ${est.window} d, Gamma(1,5) prior); Gamma serial interval discretized on daily units (mean 5.2, SD 1.7 d)`,
        },
        {
          key: 'rt-cri',
          label: '95% CrI',
          value: `[${fmtMetric(latest.lo)}, ${fmtMetric(latest.hi)}]`,
          severity: 'info',
          hint: zh ? '最新窗口 Rt 的 95% 贝叶斯可信区间（Γ 后验分位数）' : '95% Bayesian credible interval of the latest Rt (Gamma posterior quantiles)',
        },
        {
          key: 'rt-growth',
          label: 'r (tail)',
          value: Number.isFinite(est.growthRate) ? fmtMetric(est.growthRate) : '—',
          unit: '1/d',
          severity: 'info',
          hint: zh ? '末段 14 天 ln(发病率) 对数线性拟合的每日增长率' : 'log-linear growth rate of ln(incidence) over the trailing 14 days',
        },
        {
          key: 'rt-points',
          label: 'windows',
          value: String(est.points.length),
          severity: 'info',
          hint: zh ? '已估计的滑窗数量（首窗止于第 window 天）' : 'number of estimated windows (first window ends at day `window`)',
        },
      ];
      setScienceOutputs(this.manifest.id, metrics);
      return;
    }
    if (this.meta) {
      const res = this.meta;
      const drift = metapopConservationDrift(res);
      const metrics: ScienceMetric[] = [
        {
          key: 'n-conservation',
          label: '|ΔN|/N',
          value: fmtMetric(drift),
          severity: drift <= 1e-6 ? 'ok' : drift <= 1e-3 ? 'warn' : 'error',
          hint: zh
            ? '所有区域所有分室总和相对初始总人口的最大漂移（RK4 守恒诊断）'
            : 'max relative drift of the global compartment total across all regions (RK4 conservation check)',
        },
        {
          key: 'r0',
          label: 'R₀',
          value: fmtMetric(this.state.r0),
          severity: 'info',
          hint: zh
            ? '毒株 1 基本再生数（启用年龄结构时按接触矩阵谱半径归一）'
            : 'strain-1 basic reproduction number (normalized by the contact-matrix spectral radius under age structure)',
        },
      ];
      const listed = res.perRegion.slice(0, 6);
      for (const rg of listed) {
        metrics.push({
          key: `peak-${rg.name}`,
          label: `Peak · ${rg.name}`,
          value: fmtMetric(rg.peakDay),
          unit: 'd',
          severity: 'info',
          hint: zh
            ? `${rg.name}：感染峰值 ${Math.round(rg.peakInfectious).toLocaleString()} 人；总感染占比 ${(rg.attackRate * 100).toFixed(1)}%（人口 ${rg.population.toLocaleString()}）`
            : `${rg.name}: peak infectious ${Math.round(rg.peakInfectious).toLocaleString()}; total infections ${(rg.attackRate * 100).toFixed(1)}% of population ${rg.population.toLocaleString()}`,
        });
      }
      const rest = res.perRegion.slice(6);
      if (rest.length > 0) {
        const pop = rest.reduce((s2, r) => s2 + r.population, 0);
        const cum = rest.reduce((s2, r) => s2 + r.totalInfections, 0);
        const peakMax = rest.reduce((m, r) => Math.max(m, r.peakInfectious), 0);
        metrics.push({
          key: 'peak-other',
          label: 'Peak · other',
          value: '—',
          severity: 'info',
          hint: zh
            ? `其余 ${rest.length} 个区域合并：单区域感染峰值最高 ${Math.round(peakMax).toLocaleString()} 人；合并总感染占比 ${pop > 0 ? ((cum / pop) * 100).toFixed(1) : '0'}%`
            : `${rest.length} remaining regions merged: max regional peak ${Math.round(peakMax).toLocaleString()}; combined attack rate ${pop > 0 ? ((cum / pop) * 100).toFixed(1) : '0'}%`,
        });
      }
      const totalCum = res.perRegion.reduce((s2, r) => s2 + r.totalInfections, 0);
      const totalPop = Math.max(1, res.totalPopulation);
      metrics.push({
        key: 'attack-total',
        label: 'Attack (all)',
        value: fmtMetric((totalCum / totalPop) * 100) + '%',
        severity: 'info',
        hint: zh
          ? `全人群累计感染 ${Math.round(totalCum).toLocaleString()} 人（含疫苗突破感染）`
          : `cumulative infections ${Math.round(totalCum).toLocaleString()} (incl. vaccine breakthroughs)`,
      });
      if (res.strain2CumulativeShare !== null) {
        metrics.push({
          key: 'strain2-share',
          label: 'Strain 2 share',
          value: fmtMetric(res.strain2CumulativeShare * 100) + '%',
          severity: 'info',
          hint: zh
            ? '第二毒株占累计感染的比例（两毒株竞争同一易感库）'
            : 'share of cumulative infections caused by strain 2 (both strains compete for the same susceptible pool)',
        });
      }
      if (res.severeEstimate) {
        const total = res.severeEstimate.reduce((s2, a) => s2 + a.severe, 0);
        const detail = res.severeEstimate.map((a) => `${a.name} ${Math.round(a.severe).toLocaleString()}`).join(' / ');
        metrics.push({
          key: 'severe-est',
          label: 'Severe (est.)',
          value: Math.round(total).toLocaleString(),
          severity: 'info',
          hint: zh
            ? `按固定年龄重症率（儿童 0.4%、成人 1.1%、老年 5.5%）对累计感染分层估计：${detail}`
            : `age-stratified estimate of cumulative infections with fixed severity rates (children 0.4%, adults 1.1%, elderly 5.5%): ${detail}`,
        });
      }
      setScienceOutputs(this.manifest.id, metrics);
      return;
    }
    if (!this.hasData || !this.report || !this.lastTraj) {
      clearScienceOutputs(this.manifest.id);
      return;
    }
    const cfg = this.config();
    const traj = this.lastTraj;
    const r = this.report;
    const drift = conservationDrift(traj, cfg.population);
    const growth = earlyGrowthRt(cfg, traj);
    const fin = finalSizeCheck(cfg, traj);
    const metrics: ScienceMetric[] = [
      {
        key: 'n-conservation',
        label: '|ΔN|/N',
        value: fmtMetric(drift),
        severity: drift <= 1e-6 ? 'ok' : drift <= 1e-3 ? 'warn' : 'error',
        hint: zh ? '分室总人口 N(t)=S+E+I+R 的最大相对漂移（RK4 守恒诊断）' : 'max relative drift of the total N(t)=S+E+I+R (RK4 conservation check)',
      },
      { key: 'r0', label: 'R₀', value: fmtMetric(cfg.r0), severity: 'info', hint: zh ? '基本再生数（输入参数）' : 'basic reproduction number (input)' },
      {
        key: 'rt-early',
        label: 'R_t (early)',
        value: growth ? fmtMetric(growth.rt) : '—',
        severity: 'info',
        hint: zh
          ? `早期指数增长：ln I(t) 对数斜率拟合 r=${growth ? fmtMetric(growth.growthRate) : '—'}（n=${growth?.points ?? 0}），R_t≈1+r·D_inf`
          : `early exponential growth: log-slope r=${growth ? fmtMetric(growth.growthRate) : '—'} (n=${growth?.points ?? 0}), R_t ≈ 1 + r·D_inf`,
      },
      {
        key: 'peak-day',
        label: 't_peak',
        value: fmtMetric(r.peakDay),
        unit: 'd',
        severity: 'info',
        hint: zh ? `感染峰值 ${r.peakInfectious.toLocaleString()} 人（占比 ${(r.peakFraction * 100).toFixed(1)}%）` : `peak infectious ${r.peakInfectious.toLocaleString()} (${(r.peakFraction * 100).toFixed(1)}% of N)`,
      },
      {
        key: 'final-size',
        label: 'R∞ err',
        value: fin ? fmtMetric(fin.relErr * 100) + '%' : '—',
        severity: fin ? (fin.relErr < 0.01 ? 'ok' : fin.relErr < 0.05 ? 'warn' : 'error') : 'info',
        hint: zh
          ? `终局关系校验：−ln(s∞)=${fin ? fmtMetric(fin.lhs) : '—'} vs R₀(1−s∞)=${fin ? fmtMetric(fin.rhs) : '—'}`
          : `final-size relation: −ln(s∞)=${fin ? fmtMetric(fin.lhs) : '—'} vs R₀(1−s∞)=${fin ? fmtMetric(fin.rhs) : '—'}`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private overlayTrajectories() {
    // R₀ grid overlays I(t) to show how lowering reproduction number
    // suppresses and delays the epidemic peak.
    const base = this.config();
    const out: Array<{ r0: number; inc?: number[]; fro?: number[]; rec: number[]; days: number[] }> = [];
    for (const r0 of [1.5, 2.5, 3.5]) {
      const t = simulateEpidemic({ ...base, r0 });
      out.push({ r0, inc: t.infectious, rec: t.recovered, days: t.days });
    }
    return out;
  }

  private exportCsv() {
    if (this.state.mode === 'rt') {
      const est = this.rtEst;
      const series = this.rtSeries;
      if (!est || !series) {
        notify(this.api, 'warning', 'No Rt results to export yet.', '尚无 Rt 结果可导出。');
        return;
      }
      const head = ['day', 'new_cases', 'Rt', 'lo95', 'hi95'];
      const rows = est.points.map((p) => [
        String(p.day),
        String(Math.round(series.newCases[p.day] ?? 0)),
        p.rt.toFixed(4),
        p.lo.toFixed(4),
        p.hi.toFixed(4),
      ]);
      exportRowsCsv(this.api, 'epidemic-rt', head, rows);
      return;
    }
    if (this.meta) {
      const res = this.meta;
      const head = ['day', ...res.regions.map((r) => `I_${r.name}`), 'I_total'];
      const rows = res.days.map((d, i) => [
        d.toFixed(1),
        ...res.regions.map((r) => String(Math.round(r.infectious[i]!))),
        String(Math.round(res.totalInfectious[i]!)),
      ]);
      exportRowsCsv(this.api, 'epidemic-metapop', head, rows);
      return;
    }
    const cfg = this.config();
    const traj = simulateEpidemic(cfg);
    const head: string[] = ['day', 'susceptible', 'infectious', 'recovered'];
    const rows: string[][] = traj.days.map((d, i) => [
      d.toFixed(1),
      Math.round(traj.susceptible[i]!).toString(),
      Math.round(traj.infectious[i]!).toString(),
      Math.round(traj.recovered[i]!).toString(),
    ]);
    if (traj.exposed) {
      head.splice(2, 0, 'exposed');
      for (let i = 0; i < rows.length; i += 1) rows[i]!.splice(2, 0, Math.round(traj.exposed![i]!).toString());
    }
    exportRowsCsv(this.api, 'epidemic-trajectory', head, rows);
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    if (this.state.mode === 'rt') {
      if (!this.rtSeries || !this.rtEst || this.rtEst.points.length === 0) {
        clearScienceOutputs(this.manifest.id);
        drawEmptyCanvas(this.api, canvas, {
          title: 'No incidence data',
          titleZh: '尚未加载发病数据',
          hint: 'Load a CSV with columns date,new_cases (or time,incidence) to estimate Rt.',
          hintZh: '载入 date,new_cases（或 time,incidence）列的 CSV 以估计 Rt。',
        });
        return;
      }
      g.fillStyle = bg;
      g.fillRect(0, 0, canvas.width, canvas.height);
      this.drawRt(g, canvas);
      return;
    }
    if (this.state.mode === 'metapop') {
      if (!this.meta) {
        clearScienceOutputs(this.manifest.id);
        drawEmptyCanvas(this.api, canvas, {
          title: this.regionsInvalid ? 'Region table invalid' : 'No region data',
          titleZh: this.regionsInvalid ? '区域表格式无效' : '尚未加载区域数据',
          hint: 'Enter a region table (region,population,infected) in the panel or load a region CSV file.',
          hintZh: '在参数面板填写区域表（region,population,infected）或载入区域 CSV 文件。',
        });
        return;
      }
      g.fillStyle = bg;
      g.fillRect(0, 0, canvas.width, canvas.height);
      this.drawMetapop(g, canvas);
      return;
    }
    if (!this.hasData) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: 'No epidemic data',
        titleZh: '尚未加载传染病数据',
        hint: 'Load a model-config JSON or a daily case-count CSV / TSV to run the model.',
        hintZh: '载入模型配置 JSON 或逐日病例 CSV/TSV 以运行模型。',
      });
      return;
    }
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (this.meta) {
      // Extended single population: run through the metapop kernel
      // (vaccination / waning / second strain / scheduled interventions).
      const rg = this.meta.regions[0]!;
      const pop = rg.population;
      const recMerged = rg.recovered.map((v, i) => v + rg.vaccinated[i]!);
      this.plotCompartment(g, canvas, this.meta.days, rg.susceptible, rg.infectious, recMerged, rg.exposed, pop);
      this.shadeInterventions(g, canvas, this.meta.days[this.meta.days.length - 1]!);
      if (this.observed) this.plotObserved(g, canvas, pop);
      return;
    }
    const cfg = this.config();
    const traj = simulateEpidemic(cfg);
    const N = cfg.population;
    this.plotCompartment(g, canvas, traj.days, traj.susceptible, traj.infectious, traj.recovered, traj.exposed ?? null, N);

    if (this.observed) this.plotObserved(g, canvas, N);

    if (this.state.showSensitivity) {
      for (const t of this.trajectories.length ? this.trajectories : this.overlayTrajectories()) {
        this.plotOverlay(g, canvas, t.days, t.inc!, N, t.r0);
      }
    }
  }

  /** Active intervention windows with drawing metadata (travel only in metapop). */
  private activeWindows(): Array<{ start: number; end: number; strength: number; color: string; label: string }> {
    const s = this.state;
    const zh = this.zh;
    const out: Array<{ start: number; end: number; strength: number; color: string; label: string }> = [];
    const add = (start: number, end: number, strength: number, color: string, en: string, zhLabel: string): void => {
      if (strength > 0 && end > start) out.push({ start, end, strength, color, label: zh ? zhLabel : en });
    };
    add(s.lockdownStart, s.lockdownEnd, s.lockdownEff, 'rgba(235,150,70,', 'lockdown', '封锁');
    add(s.maskStart, s.maskEnd, s.maskEff, 'rgba(90,180,180,', 'mask', '口罩');
    if (s.mode === 'metapop') add(s.travelStart, s.travelEnd, s.travelEff, 'rgba(160,120,210,', 'travel', '旅行限制');
    return out;
  }

  /** Shade active intervention windows over the time axis and label them. */
  private shadeInterventions(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, maxDay: number) {
    const wins = this.activeWindows();
    if (wins.length === 0) return;
    const x0 = 62;
    const x1 = canvas.width - 20;
    const plotW = Math.max(x1 - x0, 10);
    const px = (d: number) => x0 + (plotW * Math.min(d, maxDay)) / maxDay;
    g.font = `10px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    for (const w of wins) {
      const xa = Math.max(px(w.start), x0);
      const xb = Math.min(px(w.end), x1);
      if (xb <= xa) continue;
      g.fillStyle = w.color + '0.10)';
      g.fillRect(xa, 46, xb - xa, canvas.height - 92);
      g.fillStyle = w.color + '0.9)';
      g.fillText(`${w.label} ${(w.strength * 100).toFixed(0)}%`, xa + 2, 56);
    }
  }

  /** Multi-region view: one low-saturation curve per region, optional stacked totals. */
  private drawMetapop(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const res = this.meta;
    if (!res) return;
    const zh = this.zh;
    const days = res.days;
    const maxDay = days[days.length - 1]!;
    const x0 = 62;
    const x1 = canvas.width - 20;
    const y0 = 46;
    const y1 = canvas.height - 46;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const px = (d: number) => x0 + (plotW * d) / maxDay;
    const logY = this.state.logY;
    const maxCurve = Math.max(...res.regions.map((r) => Math.max(...r.infectious, 1)));
    const maxVal = logY ? Math.log10(maxCurve * 1.1) : maxCurve * 1.1;
    const py = (v: number) => {
      const vv = logY ? Math.log10(Math.max(v, 1)) : v;
      return y1 - (plotH * vv) / maxVal;
    };

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh
        ? `多区域 SEIR（${res.regions.length} 区域 · 总人口 N=${res.totalPopulation.toLocaleString()}）`
        : `Multi-region SEIR (${res.regions.length} regions, N=${res.totalPopulation.toLocaleString()})`,
      canvas.width / 2,
      20,
    );
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // grid: x ticks + y ticks (absolute counts)
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    for (let i = 0; i <= 6; i += 1) {
      const dv = (maxDay * i) / 6;
      const sx = px(dv);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.fillText(Math.round(dv) + 'd', sx, y1 + 14);
    }
    for (let i = 0; i <= 4; i += 1) {
      const v = (maxVal * i) / 4;
      const sy = y1 - (plotH * i) / 4;
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillText(logY ? `1e${v.toFixed(1)}` : fmtCount(v), x0 - 6, sy + 4);
    }

    // intervention shading behind the curves
    this.shadeInterventions(g, canvas, maxDay);

    if (this.state.metapopStacked && !logY) {
      // stacked areas of regional infectious totals
      const cum = new Array<number>(days.length).fill(0);
      res.regions.forEach((r, ri) => {
        g.fillStyle = EPI_PALETTE[ri % EPI_PALETTE.length]! + 'aa';
        g.beginPath();
        for (let i = 0; i < days.length; i += 1) {
          const top = cum[i]! + r.infectious[i]!;
          if (i === 0) g.moveTo(px(days[i]!), py(top));
          else g.lineTo(px(days[i]!), py(top));
        }
        for (let i = days.length - 1; i >= 0; i -= 1) g.lineTo(px(days[i]!), py(cum[i]!));
        g.closePath();
        g.fill();
        for (let i = 0; i < days.length; i += 1) cum[i] = cum[i]! + r.infectious[i]!;
      });
    } else {
      res.regions.forEach((r, ri) => {
        g.strokeStyle = EPI_PALETTE[ri % EPI_PALETTE.length]!;
        g.lineWidth = 2;
        g.beginPath();
        for (let i = 0; i < days.length; i += 1) {
          const sx = px(days[i]!);
          const sy = py(r.infectious[i]!);
          if (i === 0) g.moveTo(sx, sy);
          else g.lineTo(sx, sy);
        }
        g.stroke();
      });
    }
    // dashed total strain-2 infectious curve when enabled
    if (res.strain2Share) {
      g.strokeStyle = 'rgba(200,140,200,0.85)';
      g.lineWidth = 1.4;
      g.setLineDash([5, 3]);
      g.beginPath();
      for (let i = 0; i < days.length; i += 1) {
        const v = res.totalInfectious[i]! * res.strain2Share[i]!;
        const sx = px(days[i]!);
        const sy = py(v);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
      g.setLineDash([]);
    }

    // legend (up to 8 regions)
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    let ly = y0 + 4;
    const legendRows = res.regions.slice(0, 8);
    for (let i = 0; i < legendRows.length; i += 1) {
      const r = legendRows[i]!;
      g.fillStyle = EPI_PALETTE[i % EPI_PALETTE.length]!;
      g.fillRect(x1 - 160, ly, 18, 4);
      g.fillStyle = 'rgba(210,222,238,0.95)';
      const nm = r.name.length > 10 ? r.name.slice(0, 10) + '…' : r.name;
      g.fillText(zh ? `I  ${nm}` : `I  ${nm}`, x1 - 136, ly + 6);
      ly += 15;
    }
    if (res.strain2Share && ly < y0 + 8 * 15) {
      g.strokeStyle = 'rgba(200,140,200,0.85)';
      g.setLineDash([4, 2]);
      g.beginPath();
      g.moveTo(x1 - 160, ly + 2);
      g.lineTo(x1 - 142, ly + 2);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(210,222,238,0.95)';
      g.fillText(zh ? 'I₂（毒株 2）' : 'I2 (strain 2)', x1 - 136, ly + 6);
      ly += 15;
    }

    // headline strip
    let peak = 0;
    let peakDay = 0;
    for (let i = 0; i < res.totalInfectious.length; i += 1) {
      if (res.totalInfectious[i]! > peak) {
        peak = res.totalInfectious[i]!;
        peakDay = res.days[i]!;
      }
    }
    const totalCum = res.perRegion.reduce((s, r) => s + r.totalInfections, 0);
    const attack = (totalCum / Math.max(1, res.totalPopulation)) * 100;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(232,238,248,0.95)';
    const mob = this.state.mode === 'metapop' && this.state.mobilityMode === 'gravity' ? ` · g=${this.state.gravityCoeff}` : '';
    const warn = this.mobilityInvalid
      ? zh
        ? ' · 迁移矩阵格式无效，已忽略'
        : ' · invalid mobility matrix ignored'
      : '';
    g.fillText(
      zh
        ? `总峰值感染 ${fmtCount(peak)} 人（第 ${peakDay.toFixed(0)} 天） · 全人群感染率 ${attack.toFixed(1)}% · R₀=${this.state.r0}${mob}${warn}`
        : `Total peak ${fmtCount(peak)} @ day ${peakDay.toFixed(0)} · attack ${attack.toFixed(1)}% · R0=${this.state.r0}${mob}${warn}`,
      62,
      canvas.height - 16,
    );
  }

  /** Rt view: incidence bars on top, Rt curve with 95% CrI band below. */
  private drawRt(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement) {
    const est = this.rtEst!;
    const series = this.rtSeries!;
    const zh = this.zh;
    const maxDay = Math.max(series.days[series.days.length - 1]!, est.points[est.points.length - 1]!.day, 1);
    const x0 = 62;
    const x1 = canvas.width - 20;
    const plotW = Math.max(x1 - x0, 10);
    const px = (d: number) => x0 + (plotW * d) / maxDay;

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? 'Rt 估计（Cori et al. 2013，贝叶斯滑窗）' : 'Rt estimation (Cori et al. 2013, Bayesian sliding window)', canvas.width / 2, 20);

    // top panel: daily incidence bars
    const tTop = 40;
    const tBot = Math.round(canvas.height * 0.42);
    const tH = Math.max(tBot - tTop, 10);
    const maxInc = Math.max(...series.newCases, 1);
    const barW = Math.max(plotW / (maxDay + 1), 1);
    g.fillStyle = 'rgba(110,150,200,0.85)';
    for (let i = 0; i < series.days.length; i += 1) {
      const h = (tH * series.newCases[i]!) / maxInc;
      g.fillRect(px(series.days[i]!), tBot - h, Math.max(barW - 0.5, 0.5), h);
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, tTop, plotW, tH);
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,190,220,0.95)';
    g.fillText(zh ? `每日新增病例（峰值 ${fmtCount(maxInc)}）` : `daily new cases (peak ${fmtCount(maxInc)})`, x0 + 4, tTop + 14);

    // bottom panel: Rt with credible band
    const bTop = tBot + 30;
    const bBot = canvas.height - 46;
    const bH = Math.max(bBot - bTop, 10);
    const maxRt = Math.max(...est.points.map((p) => p.hi), 2) * 1.1;
    const pyR = (v: number) => bBot - (bH * v) / maxRt;
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, bTop, plotW, bH);
    // CrI band
    g.fillStyle = 'rgba(200,120,120,0.16)';
    g.beginPath();
    est.points.forEach((p, i) => {
      const sx = px(p.day);
      const sy = pyR(p.lo);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    });
    for (let i = est.points.length - 1; i >= 0; i -= 1) {
      const p = est.points[i]!;
      g.lineTo(px(p.day), pyR(p.hi));
    }
    g.closePath();
    g.fill();
    // threshold Rt = 1
    g.strokeStyle = 'rgba(170,182,200,0.7)';
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(x0, pyR(1));
    g.lineTo(x1, pyR(1));
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.fillText('Rt = 1', x1 - 52, pyR(1) - 4);
    // Rt line
    g.strokeStyle = 'rgba(200,110,110,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    est.points.forEach((p, i) => {
      const sx = px(p.day);
      const sy = pyR(p.rt);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    });
    g.stroke();
    g.lineWidth = 1;
    g.fillStyle = 'rgba(170,190,220,0.95)';
    g.fillText(zh ? 'Rt（95% 可信区间）' : 'Rt (95% CrI)', x0 + 4, bTop + 14);

    // shared x ticks
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    for (let i = 0; i <= 6; i += 1) {
      const dv = (maxDay * i) / 6;
      g.fillText(Math.round(dv) + 'd', px(dv), canvas.height - 46 + 14);
    }

    // headline strip
    const latest = est.latest!;
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(232,238,248,0.95)';
    g.fillText(
      zh
        ? `最新 Rt=${latest.rt.toFixed(2)}（95% CrI ${latest.lo.toFixed(2)}–${latest.hi.toFixed(2)}） · 末段增长率 r=${Number.isFinite(est.growthRate) ? est.growthRate.toFixed(3) : '—'}/天 · 窗宽 ${est.window} 天`
        : `Latest Rt=${latest.rt.toFixed(2)} (95% CrI ${latest.lo.toFixed(2)}-${latest.hi.toFixed(2)}) · tail growth r=${Number.isFinite(est.growthRate) ? est.growthRate.toFixed(3) : '-'}/d · window ${est.window} d`,
      62,
      canvas.height - 16,
    );
  }

  /** Overlay observed daily case counts as a filled blue step + dots. */
  private plotObserved(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, pop: number) {
    const obs = this.observed;
    if (!obs || obs.days.length === 0) return;
    const maxDay = Math.max(this.config().days, obs.days[obs.days.length - 1]!);
    const maxVal = this.state.logY ? Math.log10(Math.max(pop * 1.05, Math.max(...obs.newCases, 1))) : Math.max(pop * 1.05, Math.max(...obs.newCases));
    const x0 = 62;
    const x1 = canvas.width - 20;
    const y0 = 46;
    const y1 = canvas.height - 46;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const px = (d: number) => x0 + (plotW * d) / maxDay;
    const py = (v: number) => {
      const vv = this.state.logY ? Math.log10(Math.max(v, 1)) : v;
      return y1 - (plotH * vv) / maxVal;
    };
    g.fillStyle = 'rgba(120,200,250,0.25)';
    g.beginPath();
    for (let i = 0; i < obs.days.length; i += 1) {
      const x = px(obs.days[i]!);
      const y = py(obs.newCases[i]!);
      if (i === 0) g.moveTo(x, y1);
      g.lineTo(x, y);
    }
    const lastX = px(obs.days[obs.days.length - 1]!);
    g.lineTo(lastX, y1);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(120,200,250,0.9)';
    g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i < obs.days.length; i += 1) {
      const x = px(obs.days[i]!);
      const y = py(obs.newCases[i]!);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = 'rgba(150,220,255,0.95)';
    for (let i = 0; i < obs.days.length; i += 1) {
      g.beginPath();
      g.arc(px(obs.days[i]!), py(obs.newCases[i]!), 2.4, 0, Math.PI * 2);
      g.fill();
    }
    g.font = `${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(150,220,255,0.95)';
    g.textAlign = 'left';
    g.fillText(this.zh ? '观测新增病例' : 'observed new cases', x0 + 4, y0 + 12);
  }

  private plotCompartment(
    g: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    days: number[],
    sus: number[],
    inf: number[],
    rec: number[],
    exp: number[] | null,
    pop: number,
  ) {
    const zh = this.zh;
    const maxDay = days[days.length - 1]!;
    const maxVal = this.state.logY ? Math.log10(pop * 1.05) : pop * 1.05;
    const padL = 62;
    const padR = 20;
    const padT = 46;
    const padB = 46;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const px = (d: number) => x0 + (plotW * d) / maxDay;
    const py = (v: number) => {
      const vv = this.state.logY ? Math.log10(Math.max(v, 1)) : v;
      return y1 - (plotH * vv) / maxVal;
    };

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const modelLabel = this.meta ? (zh ? '扩展 SEIR（疫苗/干预）' : 'extended SEIR (vaccine/interventions)') : this.state.model;
    g.fillText(zh ? `${modelLabel} 分室模型（种群 N=${pop.toLocaleString()}）` : `${modelLabel} compartment model (N=${pop.toLocaleString()})`, canvas.width / 2, 20);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // grid
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    for (let i = 0; i <= 6; i += 1) {
      const dv = (maxDay * i) / 6;
      const sx = px(dv);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(sx, y0);
      g.lineTo(sx, y1);
      g.stroke();
      g.fillText(Math.round(dv) + 'd', sx, y1 + 14);
    }

    const lines = this.state.logY ? [1, 10, 100, 1000, 1e4, 1e5] : [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    const yMax = maxVal;
    for (const t of lines) {
      const lo = this.state.logY ? Math.log10(t) : t * maxVal;
      const sy = y1 - (plotH * lo) / yMax;
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.textAlign = 'right';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(this.state.logY ? String(t) : (t * 100).toFixed(0) + '%', x0 - 6, sy + 4);
    }

    const line = (vals: number[], color: string, width = 2) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      for (let i = 0; i < vals.length; i += 1) {
        const sx = px(days[i]!);
        const sy = py(vals[i]!);
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.stroke();
    };

    line(sus, 'rgba(120,170,250,0.95)');
    if (exp) line(exp, 'rgba(240,200,90,0.9)', 1.5);
    line(inf, 'rgba(240,110,110,0.95)');
    line(rec, 'rgba(110,210,160,0.95)');

    // legend
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    let ly = y0 + 4;
    const legend: Array<[string, string, string]> = [
      ['rgba(120,170,250,0.95)', 'S', zh ? '易感' : 'susceptible'],
      ['rgba(110,210,160,0.95)', 'R', zh ? '康复/免疫' : 'recovered'],
      ['rgba(240,110,110,0.95)', 'I', zh ? '感染' : 'infectious'],
    ];
    if (exp) legend.splice(1, 0, ['rgba(240,200,90,0.9)', 'E', zh ? '暴露' : 'exposed']);
    for (const [c, sym, name] of legend) {
      g.fillStyle = c;
      g.fillRect(x1 - 170, ly, 18, 4);
      g.fillStyle = 'rgba(210,222,238,0.95)';
      g.fillText(`${sym}  ${name}`, x1 - 146, ly + 6);
      ly += 15;
    }

    // axis labels
    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText(this.state.logY ? (zh ? '人数（log10）' : 'count (log10)') : zh ? '占比（%）' : 'fraction (%)', x0 - 6, y0 - 8);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText(zh ? '时间（天）' : 'time (days)', x1 - 14, y1 + 30);

    // headline metrics strip
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(232,238,248,0.95)';
    const r = this.report;
    const fmt = (x: number) => (x < 100 ? x.toFixed(0) : x.toLocaleString());
    if (!r) return;
    g.fillText(
      zh
        ? `峰值感染 ${fmt(r.peakInfectious)}（第 ${r.peakDay.toFixed(1)} 天） · 峰占比 ${(r.peakFraction * 100).toFixed(1)}% · 总感染率 ${(r.attackRateFraction * 100).toFixed(1)}% · R₀=${r.r0} · 群体免疫阈值 ${(r.herdImmunityFraction * 100).toFixed(1)}%`
        : `Peak ${fmt(r.peakInfectious)} @ day ${r.peakDay.toFixed(1)} · peak ${(r.peakFraction * 100).toFixed(1)}% · attack ${(r.attackRateFraction * 100).toFixed(1)}% · R₀=${r.r0} · herd ${(r.herdImmunityFraction * 100).toFixed(1)}%`,
      62,
      canvas.height - 16,
    );
  }

  private plotOverlay(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, days: number[], inf: number[], pop: number, r0: number) {
    const zh = this.zh;
    const maxDay = days[days.length - 1]!;
    const maxVal = this.state.logY ? Math.log10(pop * 1.05) : pop * 1.05;
    const x0 = 62;
    const x1 = canvas.width - 20;
    const y0 = 46;
    const y1 = canvas.height - 46;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);
    const px = (d: number) => x0 + (plotW * d) / maxDay;
    const py = (v: number) => {
      const vv = this.state.logY ? Math.log10(Math.max(v, 1)) : v;
      return y1 - (plotH * vv) / maxVal;
    };
    g.strokeStyle = `hsla(${r0 * 40}, 80%, 60%, 0.85)`;
    g.lineWidth = 1.4;
    g.setLineDash([4, 3]);
    g.beginPath();
    for (let i = 0; i < inf.length; i += 1) {
      const sx = px(days[i]!);
      const sy = py(inf[i]!);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = `hsla(${r0 * 40}, 80%, 65%, 1)`;
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const lastX = px(days[days.length - 2]!);
    g.fillText(`R₀=${r0.toFixed(1)}`, lastX, py(inf[inf.length - 2]!) - 6);
  }
}

export default function createBioEpidemicPlugin(): Plugin {
  return new BioEpidemicPlugin();
}