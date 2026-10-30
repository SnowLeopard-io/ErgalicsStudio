// ==========================================================================
// med-biostat — Biostatistics Toolkit (2-D canvas, five analysis modes)
//
// Mode 1  Sample      — sample size / power design: superiority (two means or
//                       two proportions), non-inferiority (margin), equivalence
//                       (TOST); power-vs-n curve with the chosen design marked.
// Mode 2  Randomize   — seeded allocation plans: fixed / random-length permuted
//                       blocks, stratified blocks (>= 2 factors), Pocock-Simon
//                       minimization; allocation table + balance chi-square.
// Mode 3  Endpoint    — two-arm trial table (arm, endpoint, optional secondary
//                       endpoint / event): Welch t with 95% CI and Cohen's d,
//                       or risk difference with chi-square / Fisher exact, RR/OR.
// Mode 4  Interim     — Lan-DeMets alpha-spending z boundaries (O'Brien-Fleming
//                       vs Pocock) with a continue/stop call at the current look.
// Mode 5  AE signals  — adverse-event count table (treatment,event,cases,n):
//                       rates, PRR vs other treatments, chi-square, PRR>=2 &
//                       chi2>=4 signal flags, table + bar chart.
// Plus:  per-mode CSV export and mode-specific scientific outputs.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, PluginRenderContext } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas, drawEmptyMessage, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { normalCdf, normalInv, studentTInv } from '@/core/stats/special';
import { medBiostatManifest } from './manifest';
import {
  aeSignalTable,
  binaryTwoGroup,
  equalInformationFractions,
  generateRandomization,
  isBinaryColumn,
  parseAeCsv,
  parseStrataSpec,
  parseTrialCsv,
  sampleSizeForPower,
  sequentialBoundaries,
  valuesByArm,
  welchTwoSample,
  type AeSignalRow,
  type BinaryTwoGroup,
  type RandomizationResult,
  type TrialData,
  type WelchResult,
} from './stats';

type Mode = 'sample' | 'randomize' | 'endpoint' | 'interim' | 'ae';
type Objective = 'superiority' | 'noninferiority' | 'equivalence';
type EndpointType = 'means' | 'proportions';
type RandMethod = 'block' | 'random-block' | 'stratified' | 'adaptive';
type EndpointSel = 'primary' | 'secondary' | 'event';
type CompareFamily = 'obf' | 'pocock' | 'both';

const MODES: Mode[] = ['sample', 'randomize', 'endpoint', 'interim', 'ae'];

const MODE_TITLES: Record<Mode, { en: string; zh: string }> = {
  sample: { en: 'Sample size & power', zh: '样本量与效能' },
  randomize: { en: 'Randomization', zh: '随机化方案' },
  endpoint: { en: 'Endpoint analysis', zh: '终点分析' },
  interim: { en: 'Interim monitoring', zh: '期中分析' },
  ae: { en: 'AE signal detection', zh: '不良事件信号' },
};

const MODE_HINTS: Record<Mode, { en: string; zh: string }> = {
  sample: { en: 'Design mode: parameters only, no data file required.', zh: '设计模式：仅用参数计算，无需数据文件。' },
  randomize: { en: 'Plan mode: parameters only, no data file required.', zh: '方案模式：仅用参数生成，无需数据文件。' },
  endpoint: {
    en: 'Expected columns: arm, endpoint (numeric); optional endpoint_secondary, event (0/1), age.',
    zh: '期望列：arm、endpoint（数值）；可选 endpoint_secondary、event（0/1）、age。',
  },
  interim: { en: 'Design mode: parameters only, no data file required.', zh: '设计模式：仅用参数计算，无需数据文件。' },
  ae: {
    en: 'Expected columns: treatment, event, cases, n.',
    zh: '期望列：treatment、event、cases、n。',
  },
};

const OBJECTIVE_LABELS: Record<Objective, { en: string; zh: string }> = {
  superiority: { en: 'Superiority', zh: '优效性' },
  noninferiority: { en: 'Non-inferiority', zh: '非劣效性' },
  equivalence: { en: 'Equivalence (TOST)', zh: '等效性（TOST）' },
};

const ENDPOINT_TYPE_LABELS: Record<EndpointType, { en: string; zh: string }> = {
  means: { en: 'Two means', zh: '两样本均值' },
  proportions: { en: 'Two proportions', zh: '两样本比例' },
};

const RAND_METHOD_LABELS: Record<RandMethod, { en: string; zh: string }> = {
  block: { en: 'Fixed-length blocks', zh: '固定长度区组' },
  'random-block': { en: 'Random-length blocks', zh: '随机长度区组' },
  stratified: { en: 'Stratified blocks', zh: '分层区组' },
  adaptive: { en: 'Pocock-Simon minimization', zh: 'Pocock-Simon 最小化' },
};

const RAND_RULES: Record<RandMethod, { en: string; zh: string }> = {
  block: { en: 'Permuted blocks of fixed even size, 1:1 within block.', zh: '固定偶数区组长度的置换区组，区组内 1:1。' },
  'random-block': { en: 'Permuted blocks with sizes drawn from {4, 6, 8}, 1:1 within block.', zh: '区组长度在 {4, 6, 8} 中随机抽取的置换区组，区组内 1:1。' },
  stratified: { en: 'Separate permuted blocks inside every stratum of the factor cross-classification.', zh: '在分层因素交叉形成的每个层内独立执行置换区组随机化。' },
  adaptive: {
    en: 'Pocock-Simon minimization: biased coin (p=0.8) toward the arm that minimizes total factor-level imbalance; ties broken 50/50.',
    zh: 'Pocock-Simon 最小化：以偏倚硬币（p=0.8）分配到使各因素水平不平衡度总和更小的组，平局时 50/50 随机。',
  },
};

// palette
const C_TEXT = 'rgba(230,238,248,0.92)';
const C_DIM = 'rgba(160,175,195,0.9)';
const C_GRID = 'rgba(120,140,165,0.18)';
const C_AXIS = 'rgba(150,165,190,0.55)';
const C_BLUE = 'rgba(74,163,255,0.92)';
const C_GREEN = 'rgba(57,196,143,0.92)';
const C_AMBER = 'rgba(224,166,60,0.92)';
const C_RED = 'rgba(226,106,106,0.95)';
const C_PURPLE = 'rgba(165,140,240,0.95)';
const C_BLUE_SOFT = 'rgba(74,163,255,0.4)';
const C_GREEN_SOFT = 'rgba(57,196,143,0.4)';

function fmtP(v: number): string {
  if (!Number.isFinite(v)) return '—';
  if (v < 1e-4) return v.toExponential(2);
  return v.toFixed(4);
}

function fmtN(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return '—';
  return String(Number(v.toPrecision(digits)));
}

interface State {
  mode: Mode;
  objective: Objective;
  endpointType: EndpointType;
  alpha: number;
  power: number;
  sigma: number;
  delta: number;
  margin: number;
  p1: number;
  p2: number;
  propMargin: number;
  allocRatio: number;
  randMethod: RandMethod;
  nSubjects: number;
  blockSize: number;
  strataText: string;
  seed: number;
  endpointSel: EndpointSel;
  looks: number;
  compare: CompareFamily;
  currentLook: number;
  currentZ: number;
}

interface Panel {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface EndpointAnalysis {
  binary: boolean;
  label: string;
  labels: [string, string];
  n1: number;
  n2: number;
  welch: WelchResult | null;
  bin: BinaryTwoGroup | null;
}

interface SpecLike {
  objective: Objective;
  endpoint: EndpointType;
  alpha: number;
  sigma: number;
  delta: number;
  margin: number;
  p1: number;
  p2: number;
}

/** Closed-form power at a given (n control, n treat) pair, matching the kernel. */
function powerAtN(spec: SpecLike, nC: number, nT: number): number {
  const za = spec.objective === 'superiority' ? normalInv(1 - spec.alpha / 2) : normalInv(1 - spec.alpha);
  if (spec.endpoint === 'means') {
    const se = spec.sigma * Math.sqrt(1 / nC + 1 / nT);
    if (!(se > 0)) return 0;
    if (spec.objective === 'superiority') return normalCdf(Math.abs(spec.delta) / se - za);
    const d = Math.abs(spec.delta);
    const eff = spec.margin - d;
    if (eff <= 0) return 0;
    const hi = normalCdf(eff / se - za);
    if (spec.objective === 'noninferiority') return hi;
    return Math.min(1, Math.max(0, hi + normalCdf((eff + 2 * d) / se - za) - 1));
  }
  const q1 = spec.p1 * (1 - spec.p1);
  const q2 = spec.p2 * (1 - spec.p2);
  const se = Math.sqrt(q1 / nC + q2 / nT);
  if (!(se > 0)) return 0;
  const diff = Math.abs(spec.p1 - spec.p2);
  if (spec.objective === 'superiority') return normalCdf(diff / se - za);
  const eff = spec.margin - diff;
  if (eff <= 0) return 0;
  const hi = normalCdf(eff / se - za);
  if (spec.objective === 'noninferiority') return hi;
  return Math.min(1, Math.max(0, hi + normalCdf((eff + 2 * diff) / se - za) - 1));
}

/** Word-wrap one string into the given pixel width. */
function wrapText(g: CanvasRenderingContext2D, text: string, x: number, maxX: number, y: number, lineH: number): void {
  let line = '';
  let cy = y;
  for (const ch of text) {
    const next = line + ch;
    if (x + g.measureText(next).width > maxX && line) {
      g.fillText(line, x, cy);
      line = ch;
      cy += lineH;
    } else line = next;
  }
  if (line) g.fillText(line, x, cy);
}

export class MedBiostatPlugin implements Plugin {
  readonly manifest = medBiostatManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;

  private rawText: string | null = null;
  private fileName = '';
  private trialMemo: { key: string; data: TrialData | null } | null = null;
  private aeMemo: { key: string; rows: AeSignalRow[] | null } | null = null;
  private randMemo: { key: string; res: RandomizationResult } | null = null;
  private boundMemo: { key: string; obf: number[]; pocock: number[] } | null = null;

  private state: State = {
    mode: 'sample',
    objective: 'superiority',
    endpointType: 'means',
    alpha: 0.05,
    power: 0.8,
    sigma: 10,
    delta: 5,
    margin: 2,
    p1: 0.25,
    p2: 0.15,
    propMargin: 0.1,
    allocRatio: 1,
    randMethod: 'block',
    nSubjects: 120,
    blockSize: 6,
    strataText: 'center:2,severity:2',
    seed: 20260,
    endpointSel: 'primary',
    looks: 5,
    compare: 'both',
    currentLook: 1,
    currentZ: 0,
  };

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.publish();
      this.draw();
    });
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: PluginRenderContext) {
    this.ctx = context.container;
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.publish();
    this.draw();
  }

  // ---- parameters ---------------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    const modeIs = (...m: Mode[]): Array<{ key: string; in: ReadonlyArray<string> }> => m.map((v) => ({ key: 'mode', in: [v] }));
    return [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '工作模式', 'en-US': 'Mode' },
        type: 'select',
        options: MODES.map((m) => ({
          value: m,
          label: MODE_TITLES[m].en,
          labelI18n: { 'zh-CN': MODE_TITLES[m].zh, 'en-US': MODE_TITLES[m].en },
        })),
        value: s.mode,
      },
      // ---- sample-size design ----
      {
        key: 'objective',
        label: 'Objective',
        labelI18n: { 'zh-CN': '设计目标', 'en-US': 'Objective' },
        type: 'select',
        options: (Object.keys(OBJECTIVE_LABELS) as Objective[]).map((o) => ({
          value: o,
          label: OBJECTIVE_LABELS[o].en,
          labelI18n: { 'zh-CN': OBJECTIVE_LABELS[o].zh, 'en-US': OBJECTIVE_LABELS[o].en },
        })),
        value: s.objective,
        visibleWhen: modeIs('sample'),
      },
      {
        key: 'endpointType',
        label: 'Endpoint type',
        labelI18n: { 'zh-CN': '终点类型', 'en-US': 'Endpoint type' },
        type: 'select',
        options: (Object.keys(ENDPOINT_TYPE_LABELS) as EndpointType[]).map((e) => ({
          value: e,
          label: ENDPOINT_TYPE_LABELS[e].en,
          labelI18n: { 'zh-CN': ENDPOINT_TYPE_LABELS[e].zh, 'en-US': ENDPOINT_TYPE_LABELS[e].en },
        })),
        value: s.endpointType,
        visibleWhen: modeIs('sample'),
      },
      {
        key: 'alpha',
        label: 'Alpha',
        labelI18n: { 'zh-CN': 'I 类错误 α', 'en-US': 'Alpha' },
        type: 'range',
        min: 0.005,
        max: 0.2,
        step: 0.005,
        value: s.alpha,
        visibleWhen: [...modeIs('sample'), ...modeIs('endpoint'), ...modeIs('interim')],
      },
      {
        key: 'power',
        label: 'Target power',
        labelI18n: { 'zh-CN': '目标效能 1−β', 'en-US': 'Target power' },
        type: 'range',
        min: 0.5,
        max: 0.99,
        step: 0.01,
        value: s.power,
        visibleWhen: modeIs('sample'),
      },
      {
        key: 'sigma',
        label: 'Common SD σ',
        labelI18n: { 'zh-CN': '合并标准差 σ', 'en-US': 'Common SD σ' },
        type: 'range',
        min: 0.5,
        max: 50,
        step: 0.5,
        value: s.sigma,
        visibleWhen: [...modeIs('sample'), { key: 'endpointType', in: ['means'] }],
      },
      {
        key: 'delta',
        label: 'Effect Δ (NI/equiv: assumed true diff)',
        labelI18n: { 'zh-CN': '效应量 Δ（非劣效/等效：假定真实差值）', 'en-US': 'Effect Δ (NI/equiv: assumed true diff)' },
        type: 'range',
        min: 0,
        max: 30,
        step: 0.5,
        value: s.delta,
        visibleWhen: [...modeIs('sample'), { key: 'endpointType', in: ['means'] }],
      },
      {
        key: 'margin',
        label: 'Margin M (mean scale)',
        labelI18n: { 'zh-CN': '界值 M（均值尺度）', 'en-US': 'Margin M (mean scale)' },
        type: 'range',
        min: 0.5,
        max: 15,
        step: 0.5,
        value: s.margin,
        visibleWhen: [...modeIs('sample'), { key: 'endpointType', in: ['means'] }, { key: 'objective', in: ['noninferiority', 'equivalence'] }],
      },
      {
        key: 'p1',
        label: 'Control rate p1',
        labelI18n: { 'zh-CN': '对照组率 p1', 'en-US': 'Control rate p1' },
        type: 'range',
        min: 0.01,
        max: 0.99,
        step: 0.01,
        value: s.p1,
        visibleWhen: [...modeIs('sample'), { key: 'endpointType', in: ['proportions'] }],
      },
      {
        key: 'p2',
        label: 'Treatment rate p2',
        labelI18n: { 'zh-CN': '试验组率 p2', 'en-US': 'Treatment rate p2' },
        type: 'range',
        min: 0.01,
        max: 0.99,
        step: 0.01,
        value: s.p2,
        visibleWhen: [...modeIs('sample'), { key: 'endpointType', in: ['proportions'] }],
      },
      {
        key: 'propMargin',
        label: 'Margin M (risk-difference scale)',
        labelI18n: { 'zh-CN': '界值 M（率差尺度）', 'en-US': 'Margin M (risk-difference scale)' },
        type: 'range',
        min: 0.02,
        max: 0.4,
        step: 0.01,
        value: s.propMargin,
        visibleWhen: [...modeIs('sample'), { key: 'endpointType', in: ['proportions'] }, { key: 'objective', in: ['noninferiority', 'equivalence'] }],
      },
      {
        key: 'allocRatio',
        label: 'Allocation ratio (T:C)',
        labelI18n: { 'zh-CN': '分配比（试验:对照）', 'en-US': 'Allocation ratio (T:C)' },
        type: 'range',
        min: 0.25,
        max: 4,
        step: 0.25,
        value: s.allocRatio,
        visibleWhen: modeIs('sample'),
      },
      // ---- randomization ----
      {
        key: 'randMethod',
        label: 'Randomization method',
        labelI18n: { 'zh-CN': '随机化方法', 'en-US': 'Randomization method' },
        type: 'select',
        options: (Object.keys(RAND_METHOD_LABELS) as RandMethod[]).map((m) => ({
          value: m,
          label: RAND_METHOD_LABELS[m].en,
          labelI18n: { 'zh-CN': RAND_METHOD_LABELS[m].zh, 'en-US': RAND_METHOD_LABELS[m].en },
        })),
        value: s.randMethod,
        visibleWhen: modeIs('randomize'),
      },
      {
        key: 'nSubjects',
        label: 'Subjects N',
        labelI18n: { 'zh-CN': '受试者数 N', 'en-US': 'Subjects N' },
        type: 'range',
        min: 20,
        max: 400,
        step: 10,
        value: s.nSubjects,
        visibleWhen: modeIs('randomize'),
      },
      {
        key: 'blockSize',
        label: 'Block size (even)',
        labelI18n: { 'zh-CN': '区组长度（偶数）', 'en-US': 'Block size (even)' },
        type: 'range',
        min: 2,
        max: 12,
        step: 2,
        value: s.blockSize,
        visibleWhen: [...modeIs('randomize'), { key: 'randMethod', in: ['block', 'stratified'] }],
      },
      {
        key: 'strataText',
        label: 'Strata factors (name:levels, ...)',
        labelI18n: { 'zh-CN': '分层因素（名称:水平数，…）', 'en-US': 'Strata factors (name:levels, ...)' },
        type: 'text',
        value: s.strataText,
        placeholder: 'center:2,severity:2',
        visibleWhen: [...modeIs('randomize'), { key: 'randMethod', in: ['stratified', 'adaptive'] }],
      },
      {
        key: 'seed',
        label: 'RNG seed',
        labelI18n: { 'zh-CN': '随机种子', 'en-US': 'RNG seed' },
        type: 'range',
        min: 1,
        max: 99999,
        step: 1,
        value: s.seed,
        visibleWhen: modeIs('randomize'),
      },
      // ---- endpoint ----
      {
        key: 'endpointSel',
        label: 'Endpoint column',
        labelI18n: { 'zh-CN': '终点列', 'en-US': 'Endpoint column' },
        type: 'select',
        options: [
          { value: 'primary', label: 'Primary', labelI18n: { 'zh-CN': '主要终点', 'en-US': 'Primary' } },
          { value: 'secondary', label: 'Secondary', labelI18n: { 'zh-CN': '次要终点', 'en-US': 'Secondary' } },
          { value: 'event', label: 'Event (binary)', labelI18n: { 'zh-CN': '事件（二分类）', 'en-US': 'Event (binary)' } },
        ],
        value: s.endpointSel,
        visibleWhen: modeIs('endpoint'),
      },
      // ---- interim ----
      {
        key: 'looks',
        label: 'Analyses k (incl. final)',
        labelI18n: { 'zh-CN': '分析次数 k（含最终）', 'en-US': 'Analyses k (incl. final)' },
        type: 'range',
        min: 2,
        max: 8,
        step: 1,
        value: s.looks,
        visibleWhen: modeIs('interim'),
      },
      {
        key: 'compare',
        label: 'Boundary family',
        labelI18n: { 'zh-CN': '边界族', 'en-US': 'Boundary family' },
        type: 'select',
        options: [
          { value: 'obf', label: "O'Brien-Fleming", labelI18n: { 'zh-CN': "O'Brien-Fleming", 'en-US': "O'Brien-Fleming" } },
          { value: 'pocock', label: 'Pocock', labelI18n: { 'zh-CN': 'Pocock', 'en-US': 'Pocock' } },
          { value: 'both', label: 'Both', labelI18n: { 'zh-CN': '两者对比', 'en-US': 'Both' } },
        ],
        value: s.compare,
        visibleWhen: modeIs('interim'),
      },
      {
        key: 'currentLook',
        label: 'Current look',
        labelI18n: { 'zh-CN': '当前期中次数', 'en-US': 'Current look' },
        type: 'range',
        min: 1,
        max: 8,
        step: 1,
        value: s.currentLook,
        visibleWhen: modeIs('interim'),
      },
      {
        key: 'currentZ',
        label: 'Observed z at current look',
        labelI18n: { 'zh-CN': '当前期中观测 z', 'en-US': 'Observed z at current look' },
        type: 'range',
        min: -6,
        max: 6,
        step: 0.1,
        value: s.currentZ,
        visibleWhen: modeIs('interim'),
      },
      { ...actionButton('exportCsv', 'Export CSV', '导出 CSV', 'primary'), visibleWhen: [...modeIs('randomize'), ...modeIs('endpoint'), ...modeIs('ae')] },
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    const rec = s as unknown as Record<string, unknown>;
    let changed = false;
    const setNum = (key: string, v: unknown, lo: number, hi: number, round = false) => {
      if (typeof v === 'number' && Number.isFinite(v)) {
        const c = round ? Math.round(Math.min(Math.max(v, lo), hi)) : Math.min(Math.max(v, lo), hi);
        if (c !== rec[key]) {
          rec[key] = c;
          changed = true;
        }
      }
    };
    const setStr = (key: string, v: unknown, allowed: readonly string[]) => {
      if (typeof v === 'string' && allowed.includes(v) && v !== rec[key]) {
        rec[key] = v;
        changed = true;
      }
    };
    setStr('mode', params.mode, MODES);
    setStr('objective', params.objective, ['superiority', 'noninferiority', 'equivalence']);
    setStr('endpointType', params.endpointType, ['means', 'proportions']);
    setNum('alpha', params.alpha, 0.005, 0.2);
    setNum('power', params.power, 0.5, 0.99);
    setNum('sigma', params.sigma, 0.5, 50);
    setNum('delta', params.delta, 0, 30);
    setNum('margin', params.margin, 0.5, 15);
    setNum('p1', params.p1, 0.01, 0.99);
    setNum('p2', params.p2, 0.01, 0.99);
    setNum('propMargin', params.propMargin, 0.02, 0.4);
    setNum('allocRatio', params.allocRatio, 0.25, 4);
    setStr('randMethod', params.randMethod, ['block', 'random-block', 'stratified', 'adaptive']);
    setNum('nSubjects', params.nSubjects, 20, 400, true);
    setNum('blockSize', params.blockSize, 2, 12, true);
    if (typeof params.strataText === 'string' && params.strataText !== s.strataText) {
      s.strataText = params.strataText.slice(0, 120);
      changed = true;
    }
    setNum('seed', params.seed, 1, 99999, true);
    setStr('endpointSel', params.endpointSel, ['primary', 'secondary', 'event']);
    setNum('looks', params.looks, 2, 8, true);
    setStr('compare', params.compare, ['obf', 'pocock', 'both']);
    setNum('currentLook', params.currentLook, 1, 8, true);
    setNum('currentZ', params.currentZ, -6, 6);
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (changed) {
      this.publish();
      this.draw();
    }
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- data intake --------------------------------------------------------

  async loadData(file: File) {
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      notify(this.api, 'warning', 'Biostatistics Toolkit loads CSV / TSV tables.', '生物统计工具箱接受 CSV/TSV 表格。');
      return;
    }
    const text = await file.text();
    this.rawText = text;
    this.fileName = file.name;
    this.trialMemo = null;
    this.aeMemo = null;
    const trial = this.ensureTrial();
    const ae = this.ensureAe();
    if (trial) {
      this.api.reportDataScale(trial.n);
      notify(
        this.api,
        'success',
        `Trial table loaded: ${trial.n} subjects, arms ${trial.armLabels.join(' vs ')} (from ${file.name}).`,
        `已载入试验表：${trial.n} 例受试者，分组 ${trial.armLabels.join(' vs ')}（${file.name}）。`,
      );
    } else if (ae) {
      this.api.reportDataScale(ae.length);
      notify(this.api, 'success', `AE count table loaded: ${ae.length} rows (from ${file.name}).`, `已载入不良事件计数表：${ae.length} 行（${file.name}）。`);
    } else {
      notify(
        this.api,
        'warning',
        `No trial (arm, endpoint, ...) or AE (treatment, event, cases, n) columns found in ${file.name}.`,
        `${file.name} 中未找到试验表（arm、endpoint 等）或 AE 计数表（treatment、event、cases、n）所需的列。`,
      );
    }
    this.publish();
    this.draw();
  }

  private dataKey(): string {
    return `${this.fileName}|${this.rawText ? this.rawText.length : 0}`;
  }

  private ensureTrial(): TrialData | null {
    if (!this.rawText) return null;
    const key = this.dataKey();
    if (this.trialMemo && this.trialMemo.key === key) return this.trialMemo.data;
    const data = parseTrialCsv(this.rawText);
    this.trialMemo = { key, data };
    return data;
  }

  private ensureAe(): AeSignalRow[] | null {
    if (!this.rawText) return null;
    const key = this.dataKey();
    if (this.aeMemo && this.aeMemo.key === key) return this.aeMemo.rows;
    const rows = parseAeCsv(this.rawText);
    const signalRows = rows ? aeSignalTable(rows) : null;
    this.aeMemo = { key, rows: signalRows };
    return signalRows;
  }

  // ---- memoized computations ----------------------------------------------

  private buildSpec(): SpecLike {
    const s = this.state;
    return {
      objective: s.objective,
      endpoint: s.endpointType,
      alpha: s.alpha,
      sigma: s.sigma,
      delta: s.delta,
      margin: s.endpointType === 'means' ? s.margin : s.propMargin,
      p1: s.p1,
      p2: s.p2,
    };
  }

  private randomization(): RandomizationResult {
    const s = this.state;
    const key = [s.randMethod, s.nSubjects, s.blockSize, s.strataText, s.seed].join('|');
    if (this.randMemo && this.randMemo.key === key) return this.randMemo.res;
    const res = generateRandomization({
      method: s.randMethod,
      n: s.nSubjects,
      blockSize: s.blockSize,
      factors: parseStrataSpec(s.strataText),
      seed: s.seed,
    });
    this.randMemo = { key, res };
    return res;
  }

  private boundaries(): { obf: number[]; pocock: number[] } {
    const s = this.state;
    const key = `${s.looks}|${s.alpha.toFixed(4)}`;
    if (this.boundMemo && this.boundMemo.key === key) return this.boundMemo;
    const times = equalInformationFractions(s.looks);
    const obf = sequentialBoundaries(times, s.alpha, 'obf');
    const pocock = sequentialBoundaries(times, s.alpha, 'pocock');
    this.boundMemo = { key, obf, pocock };
    return this.boundMemo;
  }

  private endpointAnalysis(): EndpointAnalysis | null {
    const data = this.ensureTrial();
    if (!data) return null;
    const labels: [string, string] = [data.armLabels[0] ?? 'A', data.armLabels[1] ?? 'B'];
    let values: number[] | null = null;
    let label = '';
    let binary = false;
    if (this.state.endpointSel === 'event') {
      if (!data.event) return null;
      values = data.event;
      label = 'event';
      binary = true;
    } else if (this.state.endpointSel === 'secondary') {
      if (!data.secondary) return null;
      values = data.secondary;
      label = 'endpoint_secondary';
      binary = isBinaryColumn(values);
    } else {
      values = data.primary;
      label = 'endpoint_primary';
      binary = isBinaryColumn(values);
    }
    const byArm = valuesByArm(data.arm, values, data.armLabels.slice(0, 2));
    if (binary) {
      const e1 = (byArm[0] ?? []).reduce((acc, v) => acc + (v === 1 ? 1 : 0), 0);
      const e2 = (byArm[1] ?? []).reduce((acc, v) => acc + (v === 1 ? 1 : 0), 0);
      const n1 = (byArm[0] ?? []).length;
      const n2 = (byArm[1] ?? []).length;
      const bin = binaryTwoGroup(e1, n1, e2, n2);
      if (!bin) return null;
      return { binary, label, labels, n1, n2, welch: null, bin };
    }
    const welch = welchTwoSample(byArm[0] ?? [], byArm[1] ?? [], this.state.alpha);
    if (!welch) return null;
    return { binary, label, labels, n1: welch.n1, n2: welch.n2, welch, bin: null };
  }

  // ---- scientific outputs -------------------------------------------------

  private publish() {
    const id = this.manifest.id;
    const metrics = this.buildMetrics();
    if (!metrics || metrics.length === 0) {
      clearScienceOutputs(id);
      return;
    }
    setScienceOutputs(id, metrics);
  }

  private buildMetrics(): ScienceMetric[] | null {
    const zh = this.zh;
    const s = this.state;
    switch (s.mode) {
      case 'sample': {
        const spec = {
          objective: s.objective,
          endpoint: s.endpointType,
          alpha: s.alpha,
          power: s.power,
          sigma: s.sigma,
          delta: s.delta,
          margin: s.endpointType === 'means' ? s.margin : s.propMargin,
          p1: s.p1,
          p2: s.p2,
          ratio: s.allocRatio,
        };
        const res = sampleSizeForPower(spec);
        if (!res) return null;
        const oneSided = s.objective !== 'superiority';
        return [
          {
            key: 'n-control',
            label: zh ? '每组 n（对照）' : 'n per group (control)',
            value: String(res.nControl),
            hint: zh ? '对照组样本量（向上取整）' : 'control-arm sample size (ceiled)',
          },
          {
            key: 'n-treat',
            label: zh ? '每组 n（试验）' : 'n per group (treatment)',
            value: String(res.nTreat),
            hint: zh ? '试验组样本量（向上取整，分配比 T:C）' : 'treatment-arm sample size (ceiled, T:C ratio)',
          },
          {
            key: 'power',
            label: zh ? '实际效能' : 'achieved power',
            value: fmtMetric(res.achievedPower),
            severity: res.achievedPower >= s.power ? 'ok' : 'info',
            hint: zh ? '取整后样本量对应的大样本近似效能' : 'large-sample power at the ceiled sample size',
          },
          {
            key: 'alpha',
            label: 'alpha',
            value: `${fmtN(s.alpha, 3)}${oneSided ? (zh ? '（单侧）' : ' (one-sided)') : zh ? '（双侧）' : ' (two-sided)'}`,
            hint: zh ? '优效性双侧检验；非劣效/等效性（TOST）单侧' : 'two-sided for superiority; one-sided for NI / TOST',
          },
        ];
      }
      case 'randomize': {
        const r = this.randomization();
        return [
          { key: 'n-a', label: 'n A', value: String(r.counts.a), hint: zh ? 'A 组例数' : 'subjects allocated to arm A' },
          { key: 'n-b', label: 'n B', value: String(r.counts.b), hint: zh ? 'B 组例数' : 'subjects allocated to arm B' },
          {
            key: 'balance-chi2',
            label: 'balance chi2',
            value: fmtMetric(r.chi2),
            hint: zh ? '组间均衡性拟合优度卡方（期望 1:1，df=1）' : 'goodness-of-fit chi-square of arm counts vs 1:1 (df=1)',
          },
          {
            key: 'balance-p',
            label: 'balance p',
            value: fmtMetric(r.balanceP),
            severity: r.balanceP >= 0.05 ? 'ok' : 'warn',
            hint: zh ? 'p 大说明组间例数与 1:1 无显著偏离' : 'large p means arm counts do not depart significantly from 1:1',
          },
        ];
      }
      case 'endpoint': {
        const a = this.endpointAnalysis();
        if (!a) return null;
        if (a.binary && a.bin) {
          const b = a.bin;
          const ciLo = b.diff - 1.959964 * b.se;
          const ciHi = b.diff + 1.959964 * b.se;
          return [
            {
              key: 'rate1',
              label: `${zh ? '率' : 'rate'} ${a.labels[0]}`,
              value: `${fmtN(b.rate1 * 100, 3)}%`,
              hint: zh ? `组内事件率（${b.events1}/${b.n1}）` : `event rate in arm 1 (${b.events1}/${b.n1})`,
            },
            {
              key: 'rate2',
              label: `${zh ? '率' : 'rate'} ${a.labels[1]}`,
              value: `${fmtN(b.rate2 * 100, 3)}%`,
              hint: zh ? `组内事件率（${b.events2}/${b.n2}）` : `event rate in arm 2 (${b.events2}/${b.n2})`,
            },
            {
              key: 'diff',
              label: zh ? '率差' : 'risk difference',
              value: fmtMetric(b.diff),
              hint: zh ? `95% CI ${fmtMetric(ciLo)} ~ ${fmtMetric(ciHi)}（Wald）` : `95% CI ${fmtMetric(ciLo)} to ${fmtMetric(ciHi)} (Wald)`,
            },
            {
              key: 'p',
              label: 'p (chi2)',
              value: fmtP(b.p),
              severity: b.p < s.alpha ? 'ok' : 'info',
              hint: zh ? `Pearson 卡方（df=1）；Fisher 精确 p=${fmtP(b.fisherP)}` : `Pearson chi-square (df=1); Fisher exact p=${fmtP(b.fisherP)}`,
            },
            { key: 'rr', label: 'RR', value: fmtMetric(b.rr), hint: zh ? '相对危险度（组1 vs 组2）' : 'risk ratio (arm 1 vs arm 2)' },
            { key: 'or', label: 'OR', value: fmtMetric(b.or), hint: zh ? '比值比（组1 vs 组2）' : 'odds ratio (arm 1 vs arm 2)' },
          ];
        }
        if (a.welch) {
          const w = a.welch;
          return [
            {
              key: 'diff',
              label: zh ? '均值差' : 'mean difference',
              value: fmtMetric(w.diff),
              hint: zh ? `${a.labels[0]} 均值 − ${a.labels[1]} 均值` : `mean(${a.labels[0]}) - mean(${a.labels[1]})`,
            },
            {
              key: 'ci',
              label: '95% CI',
              value: `${fmtMetric(w.ciLo)} ~ ${fmtMetric(w.ciHi)}`,
              severity: w.ciLo * w.ciHi < 0 ? 'info' : 'ok',
              hint: zh ? `Welch t 区间（df=${fmtN(w.df, 4)}）` : `Welch t interval (df=${fmtN(w.df, 4)})`,
            },
            {
              key: 'p',
              label: 'p (t)',
              value: fmtP(w.p),
              severity: w.p < s.alpha ? 'ok' : 'info',
              hint: zh ? `t=${fmtMetric(w.t)}，Welch 双侧 p` : `t=${fmtMetric(w.t)}, two-sided Welch p`,
            },
            { key: 'd', label: "Cohen's d", value: fmtMetric(w.cohensD), hint: zh ? '合并标准差标准化效应量' : 'effect size standardized by the pooled SD' },
          ];
        }
        return null;
      }
      case 'interim': {
        const b = this.boundaries();
        const k = s.looks;
        const metrics: ScienceMetric[] = [];
        if (s.compare !== 'pocock') {
          for (let j = 0; j < k; j += 1) {
            metrics.push({
              key: `obf-z${j + 1}`,
              label: `OBF z@${Math.round(((j + 1) / k) * 100)}%`,
              value: fmtMetric(b.obf[j] ?? NaN),
              hint: zh
                ? `第 ${j + 1} 次（信息分数 ${(j + 1) / k}）的 OBF 消耗函数 z 边界（双侧 α）`
                : `OBF alpha-spending z boundary at look ${j + 1} (information ${(j + 1) / k}, two-sided alpha)`,
            });
          }
        }
        if (s.compare !== 'obf') {
          for (let j = 0; j < k; j += 1) {
            metrics.push({
              key: `pocock-z${j + 1}`,
              label: `Pocock z@${Math.round(((j + 1) / k) * 100)}%`,
              value: fmtMetric(b.pocock[j] ?? NaN),
              hint: zh
                ? `第 ${j + 1} 次（信息分数 ${(j + 1) / k}）的 Pocock 消耗函数 z 边界（双侧 α）`
                : `Pocock alpha-spending z boundary at look ${j + 1} (information ${(j + 1) / k}, two-sided alpha)`,
            });
          }
        }
        const family: 'obf' | 'pocock' = s.compare === 'pocock' ? 'pocock' : 'obf';
        const lookIdx = Math.min(s.currentLook, k) - 1;
        const bound = (family === 'obf' ? b.obf[lookIdx] : b.pocock[lookIdx]) ?? NaN;
        const stop = Math.abs(s.currentZ) >= bound;
        metrics.push({
          key: 'decision',
          label: zh ? `当前结论（第 ${lookIdx + 1} 次）` : `decision (look ${lookIdx + 1})`,
          value: stop
            ? zh
              ? `|z|=${fmtMetric(Math.abs(s.currentZ))} ≥ 边界 ${fmtMetric(bound)}：停止并拒绝 H0`
              : `|z|=${fmtMetric(Math.abs(s.currentZ))} >= boundary ${fmtMetric(bound)}: stop, reject H0`
            : zh
              ? `|z|=${fmtMetric(Math.abs(s.currentZ))} < 边界 ${fmtMetric(bound)}：继续试验`
              : `|z|=${fmtMetric(Math.abs(s.currentZ))} < boundary ${fmtMetric(bound)}: continue`,
          severity: stop ? 'warn' : 'ok',
          hint: zh
            ? '以当前信息分数下的 |z| 与该侧边界比较；越过即触发有效性停止'
            : '|z| at the current information fraction vs the boundary; crossing triggers an efficacy stop',
        });
        return metrics;
      }
      case 'ae': {
        const rows = this.ensureAe();
        if (!rows) return null;
        const signals = rows.filter((r) => r.signal);
        const maxPrr = rows.reduce((m, r) => (Number.isFinite(r.prr) && r.prr > m ? r.prr : m), 0);
        return [
          {
            key: 'signals',
            label: zh ? '信号数' : 'signals',
            value: String(signals.length),
            severity: signals.length > 0 ? 'warn' : 'ok',
            hint: zh ? '满足 PRR ≥ 2 且 χ² ≥ 4 的（处理组，事件）组合数' : '(treatment, event) pairs with PRR >= 2 and chi-square >= 4',
          },
          {
            key: 'max-prr',
            label: zh ? '最大 PRR' : 'max PRR',
            value: fmtMetric(maxPrr),
            severity: maxPrr >= 2 ? 'warn' : 'info',
            hint: zh ? '各行报告比 PRR 的最大值（与其他处理组合并比较）' : 'largest proportional reporting ratio vs pooled other treatments',
          },
          { key: 'rows', label: zh ? '行数' : 'rows', value: String(rows.length), hint: zh ? '计数表行数' : 'rows in the count table' },
        ];
      }
    }
  }

  // ---- CSV export ---------------------------------------------------------

  private exportCsv() {
    const s = this.state;
    if (s.mode === 'randomize') {
      const r = this.randomization();
      exportRowsCsv(
        this.api,
        'med-biostat-randomization',
        ['subject', 'stratum_or_profile', 'arm'],
        r.arms.map((arm, i) => [String(i + 1), r.strata[i] ?? '', arm]),
      );
      return;
    }
    if (s.mode === 'endpoint') {
      const a = this.endpointAnalysis();
      if (!a) {
        notify(this.api, 'warning', 'No endpoint analysis to export yet.', '暂无可导出的终点分析结果。');
        return;
      }
      if (a.binary && a.bin) {
        const b = a.bin;
        exportRowsCsv(
          this.api,
          'med-biostat-endpoint',
          ['arm', 'n', 'events', 'rate'],
          [
            [a.labels[0], b.n1, b.events1, b.rate1],
            [a.labels[1], b.n2, b.events2, b.rate2],
          ],
        );
      } else if (a.welch) {
        const w = a.welch;
        // Per-arm 95% CIs; w.ciLo/ciHi describe the mean difference, not arms.
        const tc = studentTInv(0.975, w.df);
        const half1 = w.n1 > 0 ? (tc * w.sd1) / Math.sqrt(w.n1) : 0;
        const half2 = w.n2 > 0 ? (tc * w.sd2) / Math.sqrt(w.n2) : 0;
        exportRowsCsv(
          this.api,
          'med-biostat-endpoint',
          ['arm', 'n', 'mean', 'sd', 'ci_lo', 'ci_hi'],
          [
            [a.labels[0], w.n1, w.mean1, w.sd1, w.mean1 - half1, w.mean1 + half1],
            [a.labels[1], w.n2, w.mean2, w.sd2, w.mean2 - half2, w.mean2 + half2],
          ],
        );
      }
      return;
    }
    if (s.mode === 'ae') {
      const rows = this.ensureAe();
      if (!rows) {
        notify(this.api, 'warning', 'No AE table to export yet.', '暂无可导出的不良事件表。');
        return;
      }
      exportRowsCsv(
        this.api,
        'med-biostat-ae',
        ['treatment', 'event', 'cases', 'n', 'rate', 'prr', 'chi2', 'p', 'signal'],
        rows.map((r) => [r.treatment, r.event, r.cases, r.n, r.rate, Number.isFinite(r.prr) ? r.prr : 'Inf', r.chi2, r.p, r.signal ? 'WARN' : '']),
      );
      return;
    }
    notify(this.api, 'info', 'CSV export is available in the randomization, endpoint and AE modes.', 'CSV 导出在随机化、终点分析与不良事件信号模式下可用。');
  }

  // ---- canvas -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';

    switch (this.state.mode) {
      case 'sample':
        this.publish();
        this.drawSample(g, canvas);
        break;
      case 'randomize':
        this.publish();
        this.drawRandomize(g, canvas);
        break;
      case 'interim':
        this.publish();
        this.drawInterim(g, canvas);
        break;
      case 'endpoint': {
        if (!this.rawText || !this.ensureTrial()) {
          clearScienceOutputs(this.manifest.id);
          drawEmptyCanvas(this.api, canvas, {
            title: 'No trial data',
            titleZh: '尚未加载试验数据',
            hint: MODE_HINTS.endpoint.en,
            hintZh: MODE_HINTS.endpoint.zh,
          });
          return;
        }
        const analysis = this.endpointAnalysis();
        if (!analysis) {
          clearScienceOutputs(this.manifest.id);
          drawEmptyCanvas(this.api, canvas, {
            title: 'No usable endpoint column for this mode',
            titleZh: '当前模式下没有可分析的终点列',
            hint: MODE_HINTS.endpoint.en,
            hintZh: MODE_HINTS.endpoint.zh,
          });
          return;
        }
        this.publish();
        this.drawEndpoint(g, canvas, analysis);
        break;
      }
      case 'ae': {
        const rows = this.ensureAe();
        if (!this.rawText || !rows) {
          clearScienceOutputs(this.manifest.id);
          drawEmptyCanvas(this.api, canvas, {
            title: 'No AE count table',
            titleZh: '尚未加载不良事件计数表',
            hint: MODE_HINTS.ae.en,
            hintZh: MODE_HINTS.ae.zh,
          });
          return;
        }
        this.publish();
        this.drawAe(g, canvas, rows);
        break;
      }
    }
  }

  private font(px: number, bold = false): string {
    return `${bold ? 'bold ' : ''}${px}px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  }

  private title(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, text: string): void {
    g.fillStyle = C_TEXT;
    g.font = this.font(13, true);
    g.textAlign = 'left';
    g.fillText(text, 24, 26);
    g.strokeStyle = C_GRID;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(24, 34);
    g.lineTo(canvas.width - 24, 34);
    g.stroke();
  }

  private footer(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, text: string): void {
    g.fillStyle = C_DIM;
    g.font = this.font(11);
    g.textAlign = 'left';
    g.fillText(text, 24, canvas.height - 14);
  }

  // ---- mode 1: sample size --------------------------------------------------

  private drawSample(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const s = this.state;
    const zh = this.zh;
    const t = MODE_TITLES.sample;
    this.title(g, canvas, `${zh ? t.zh : t.en} — ${zh ? OBJECTIVE_LABELS[s.objective].zh : OBJECTIVE_LABELS[s.objective].en}, ${zh ? ENDPOINT_TYPE_LABELS[s.endpointType].zh : ENDPOINT_TYPE_LABELS[s.endpointType].en}`);
    const full = {
      objective: s.objective,
      endpoint: s.endpointType,
      alpha: s.alpha,
      power: s.power,
      sigma: s.sigma,
      delta: s.delta,
      margin: s.endpointType === 'means' ? s.margin : s.propMargin,
      p1: s.p1,
      p2: s.p2,
      ratio: s.allocRatio,
    };
    const res = sampleSizeForPower(full);
    if (!res) {
      drawEmptyMessage(
        g,
        canvas,
        zh
          ? '设计不可行：界值 M 必须大于假定的真实差值 |Δ|，且效应量需为正。'
          : 'Infeasible design: margin M must exceed the assumed true difference |delta|, and the effect must be positive.',
      );
      return;
    }
    const spec = this.buildSpec();
    const plot: Panel = { x0: 64, y0: 46, x1: canvas.width - 30, y1: canvas.height - 58 };
    const nMax = Math.max(30, Math.ceil(res.nControl * 2));
    const ratio = s.allocRatio;
    const yToPix = (p: number) => plot.y1 - p * (plot.y1 - plot.y0);
    const nToPix = (n: number) => plot.x0 + ((n - 2) / (nMax - 2)) * (plot.x1 - plot.x0);
    // axes + grid
    g.strokeStyle = C_AXIS;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(plot.x0, plot.y0);
    g.lineTo(plot.x0, plot.y1);
    g.lineTo(plot.x1, plot.y1);
    g.stroke();
    g.font = this.font(10);
    g.textAlign = 'right';
    for (let p = 0; p <= 1.001; p += 0.25) {
      const y = yToPix(p);
      g.strokeStyle = C_GRID;
      g.beginPath();
      g.moveTo(plot.x0, y);
      g.lineTo(plot.x1, y);
      g.stroke();
      g.fillStyle = C_DIM;
      g.fillText(p.toFixed(2), plot.x0 - 6, y + 3);
    }
    g.textAlign = 'center';
    const stepN = nMax <= 60 ? 10 : nMax <= 150 ? 25 : 50;
    for (let n = 2; n <= nMax; n += stepN) {
      const x = nToPix(n);
      g.strokeStyle = C_GRID;
      g.beginPath();
      g.moveTo(x, plot.y0);
      g.lineTo(x, plot.y1);
      g.stroke();
      g.fillStyle = C_DIM;
      g.fillText(String(n), x, plot.y1 + 14);
    }
    g.fillStyle = C_DIM;
    g.font = this.font(11);
    g.fillText(zh ? '每组样本量 n（对照）' : 'n per group (control)', (plot.x0 + plot.x1) / 2, plot.y1 + 30);
    g.save();
    g.translate(16, (plot.y0 + plot.y1) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText(zh ? '检验效能' : 'power', 0, 0);
    g.restore();
    // target power line
    g.strokeStyle = C_AMBER;
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(plot.x0, yToPix(s.power));
    g.lineTo(plot.x1, yToPix(s.power));
    g.stroke();
    g.setLineDash([]);
    g.textAlign = 'left';
    g.fillStyle = C_AMBER;
    g.font = this.font(10);
    g.fillText(`1−β = ${s.power.toFixed(2)}`, plot.x0 + 6, yToPix(s.power) - 5);
    // power curve
    g.strokeStyle = C_BLUE;
    g.lineWidth = 2;
    g.beginPath();
    for (let n = 2; n <= nMax; n += 1) {
      const p = Math.min(1, powerAtN(spec, n, Math.max(2, Math.round(n * ratio))));
      const x = nToPix(n);
      const y = yToPix(p);
      if (n === 2) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.lineWidth = 1;
    // chosen design marker
    const px = nToPix(res.nControl);
    const py = yToPix(Math.min(1, res.achievedPower));
    g.strokeStyle = C_GREEN;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(px, plot.y0);
    g.lineTo(px, plot.y1);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = C_GREEN;
    g.beginPath();
    g.arc(px, py, 4, 0, Math.PI * 2);
    g.fill();
    g.textAlign = 'center';
    g.font = this.font(10);
    g.fillText(`n=${res.nControl}`, px, plot.y0 + 10);
    // summary
    const oneSided = s.objective !== 'superiority';
    const assumedDiff = s.endpointType === 'means' ? s.delta : Math.abs(s.p1 - s.p2);
    const lines = zh
      ? [
          `每组 n：对照 ${res.nControl}，试验 ${res.nTreat}（分配比 ${ratio}:1），总计 ${res.totalN}`,
          `实际效能 ${fmtN(res.achievedPower, 4)}（目标 ${s.power.toFixed(2)}）`,
          `α=${fmtN(s.alpha, 3)}${oneSided ? '（单侧）' : '（双侧）'}，zα=${fmtN(res.zAlpha, 4)}，zβ=${fmtN(res.zBeta, 4)}`,
          s.objective === 'superiority'
            ? s.endpointType === 'means'
              ? `优效性：Δ=${fmtN(s.delta, 3)}，σ=${fmtN(s.sigma, 3)}（正态近似）`
              : `优效性：p1=${fmtN(s.p1, 3)}，p2=${fmtN(s.p2, 3)}（合并方差正态近似）`
            : `M=${fmtN(s.endpointType === 'means' ? s.margin : s.propMargin, 3)}，假定真实差值 |Δ|=${fmtN(assumedDiff, 3)}（有效界值 ${fmtN(res.effectiveDelta, 3)}）`,
        ]
      : [
          `n per group: control ${res.nControl}, treatment ${res.nTreat} (ratio ${ratio}:1), total ${res.totalN}`,
          `achieved power ${fmtN(res.achievedPower, 4)} (target ${s.power.toFixed(2)})`,
          `alpha=${fmtN(s.alpha, 3)}${oneSided ? ' (one-sided)' : ' (two-sided)'}, zA=${fmtN(res.zAlpha, 4)}, zB=${fmtN(res.zBeta, 4)}`,
          s.objective === 'superiority'
            ? s.endpointType === 'means'
              ? `superiority: delta=${fmtN(s.delta, 3)}, sigma=${fmtN(s.sigma, 3)} (normal approximation)`
              : `superiority: p1=${fmtN(s.p1, 3)}, p2=${fmtN(s.p2, 3)} (pooled-variance normal approximation)`
            : `M=${fmtN(s.endpointType === 'means' ? s.margin : s.propMargin, 3)}, assumed true diff |delta|=${fmtN(assumedDiff, 3)} (effective ${fmtN(res.effectiveDelta, 3)})`,
        ];
    g.textAlign = 'left';
    g.font = this.font(11);
    let ly = plot.y0 + 18;
    for (let i = 0; i < lines.length; i += 1) {
      g.fillStyle = i === 0 ? C_TEXT : C_DIM;
      g.fillText(lines[i]!, plot.x0 + 4 + 110, ly);
      ly += 17;
    }
    this.footer(g, canvas, zh ? '正态/大样本近似；供试验方案设计参考，非临床决策依据。' : 'Normal / large-sample approximation; for protocol drafting, not for clinical decisions.');
  }

  // ---- mode 2: randomization ------------------------------------------------

  private drawRandomize(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const zh = this.zh;
    const r = this.randomization();
    this.title(g, canvas, `${zh ? MODE_TITLES.randomize.zh : MODE_TITLES.randomize.en} — ${zh ? RAND_METHOD_LABELS[r.method].zh : RAND_METHOD_LABELS[r.method].en}, N=${r.n}, seed=${this.state.seed}`);
    g.font = this.font(12);
    g.fillStyle = C_TEXT;
    g.textAlign = 'left';
    g.fillText(`A: ${r.counts.a}   B: ${r.counts.b}`, 24, 54);
    g.fillStyle = r.balanceP >= 0.05 ? C_GREEN : C_AMBER;
    g.fillText(
      `χ²=${fmtN(r.chi2, 4)}, p=${fmtN(r.balanceP, 3)} ${zh ? (r.balanceP >= 0.05 ? '（均衡）' : '（偏离 1:1）') : r.balanceP >= 0.05 ? '(balanced)' : '(imbalanced)'}`,
      130,
      54,
    );
    g.fillStyle = C_DIM;
    g.font = this.font(11);
    g.fillText(zh ? RAND_RULES[r.method].zh : RAND_RULES[r.method].en, 24, 72);

    const tableTop = 88;
    const rowH = 17;
    const maxRows = Math.max(4, Math.floor((canvas.height - tableTop - 34) / rowH));
    const rowsShown = Math.min(r.n, maxRows);
    const showStrata = r.method === 'stratified' || r.method === 'adaptive';
    const armX = showStrata ? 310 : 52;
    g.fillStyle = C_DIM;
    g.font = this.font(11, true);
    g.fillText('#', 24, tableTop);
    if (showStrata) g.fillText(zh ? '层/协变量轮廓' : 'stratum / profile', 52, tableTop);
    g.fillText(zh ? '分组' : 'arm', armX, tableTop);
    g.font = this.font(11);
    for (let i = 0; i < rowsShown; i += 1) {
      const y = tableTop + 16 + i * rowH;
      g.fillStyle = C_DIM;
      g.fillText(String(i + 1), 24, y);
      if (showStrata) {
        g.fillStyle = C_TEXT;
        g.fillText(r.strata[i] || '—', 52, y);
      }
      const arm = r.arms[i] ?? '';
      g.fillStyle = arm === 'A' ? C_BLUE : C_GREEN;
      g.fillText(arm, armX, y);
    }
    // right panel: per-stratum balance or block sizes
    const rightX = Math.max(armX + 130, canvas.width - 250);
    let y = tableTop;
    g.fillStyle = C_DIM;
    g.font = this.font(11, true);
    if (r.method === 'block' || r.method === 'random-block') {
      g.fillText(zh ? '区组长度序列' : 'block sizes', rightX, y);
      y += 16;
      g.font = this.font(11);
      g.fillStyle = C_TEXT;
      const sizes = r.blockSizes.slice(0, 14).join(', ') + (r.blockSizes.length > 14 ? ', ...' : '');
      wrapText(g, sizes, rightX, canvas.width - 24, y, 15);
    } else if (r.perStratum.length > 0) {
      g.fillText(zh ? '分层均衡' : 'stratum balance', rightX, y);
      y += 16;
      g.font = this.font(11);
      const cap = Math.floor((canvas.height - y - 20) / 15);
      for (const st of r.perStratum.slice(0, Math.max(cap, 1))) {
        g.fillStyle = C_TEXT;
        g.fillText(st.stratum, rightX, y);
        g.fillStyle = st.a === st.b ? C_GREEN : C_AMBER;
        g.fillText(`${st.a} : ${st.b}`, rightX + 155, y);
        y += 15;
      }
    }
    this.footer(g, canvas, zh ? '固定种子可复现；导出 CSV 可获得完整分配表。' : 'Seeded and reproducible; export CSV for the full allocation table.');
  }

  // ---- mode 3: endpoint analysis ---------------------------------------------

  private drawEndpoint(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, a: EndpointAnalysis): void {
    const zh = this.zh;
    const s = this.state;
    const selLabel =
      s.endpointSel === 'event' ? (zh ? '事件（二分类）' : 'event (binary)') : s.endpointSel === 'secondary' ? (zh ? '次要终点' : 'secondary') : zh ? '主要终点' : 'primary';
    this.title(g, canvas, `${zh ? MODE_TITLES.endpoint.zh : MODE_TITLES.endpoint.en} — ${selLabel} [${a.label}]`);
    const plot: Panel = { x0: 70, y0: 48, x1: Math.max(230, canvas.width - 300), y1: canvas.height - 58 };
    const cx1 = plot.x0 + (plot.x1 - plot.x0) * 0.3;
    const cx2 = plot.x0 + (plot.x1 - plot.x0) * 0.7;
    if (a.binary && a.bin) {
      const b = a.bin;
      const bars = [
        { cx: cx1, rate: b.rate1, n: b.n1, label: a.labels[0], color: C_BLUE },
        { cx: cx2, rate: b.rate2, n: b.n2, label: a.labels[1], color: C_GREEN },
      ];
      const yMax = Math.min(1, Math.max(b.rate1, b.rate2) + 0.15);
      const yToPix = (v: number) => plot.y1 - (v / yMax) * (plot.y1 - plot.y0);
      g.strokeStyle = C_AXIS;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(plot.x0, plot.y0);
      g.lineTo(plot.x0, plot.y1);
      g.lineTo(plot.x1, plot.y1);
      g.stroke();
      g.font = this.font(10);
      g.textAlign = 'right';
      for (let i = 0; i <= 4; i += 1) {
        const p = (yMax * i) / 4;
        const y = yToPix(p);
        g.strokeStyle = C_GRID;
        g.beginPath();
        g.moveTo(plot.x0, y);
        g.lineTo(plot.x1, y);
        g.stroke();
        g.fillStyle = C_DIM;
        g.fillText(`${(p * 100).toFixed(0)}%`, plot.x0 - 6, y + 3);
      }
      g.textAlign = 'center';
      for (const bar of bars) {
        const se = Math.sqrt((bar.rate * (1 - bar.rate)) / bar.n);
        const y = yToPix(bar.rate);
        g.fillStyle = bar.color;
        g.fillRect(bar.cx - 30, y, 60, plot.y1 - y);
        g.strokeStyle = C_TEXT;
        g.strokeRect(bar.cx - 30, y, 60, plot.y1 - y);
        const yLo = yToPix(Math.max(0, bar.rate - 1.959964 * se));
        const yHi = yToPix(Math.min(1, bar.rate + 1.959964 * se));
        g.strokeStyle = C_TEXT;
        g.beginPath();
        g.moveTo(bar.cx, yLo);
        g.lineTo(bar.cx, yHi);
        g.moveTo(bar.cx - 8, yHi);
        g.lineTo(bar.cx + 8, yHi);
        g.moveTo(bar.cx - 8, yLo);
        g.lineTo(bar.cx + 8, yLo);
        g.stroke();
        g.fillStyle = C_TEXT;
        g.font = this.font(10);
        g.fillText(`${(bar.rate * 100).toFixed(1)}%`, bar.cx, y - 8);
        g.fillStyle = C_DIM;
        g.fillText(bar.label, bar.cx, plot.y1 + 16);
      }
      g.textAlign = 'left';
      g.fillStyle = C_DIM;
      g.font = this.font(11);
      g.fillText(zh ? '事件率（误差线为 95% Wald 区间）' : 'event rate (error bars: 95% Wald CI)', plot.x0 + 4, plot.y0 - 4);
      const sig = b.p < s.alpha;
      const lines = zh
        ? [
            `${a.labels[0]}: ${b.events1}/${b.n1} = ${(b.rate1 * 100).toFixed(1)}%`,
            `${a.labels[1]}: ${b.events2}/${b.n2} = ${(b.rate2 * 100).toFixed(1)}%`,
            `率差 = ${fmtN(b.diff, 3)}（95% CI ${fmtN(b.diff - 1.959964 * b.se, 3)} ~ ${fmtN(b.diff + 1.959964 * b.se, 3)}）`,
            `χ² = ${fmtN(b.chi2, 4)}（df=1）`,
            `p = ${fmtP(b.p)}${sig ? (zh ? '  ← 显著' : '  (significant)') : ''}`,
            `Fisher 精确 p = ${fmtP(b.fisherP)}`,
            `RR = ${fmtN(b.rr, 4)}   OR = ${fmtN(b.or, 4)}`,
          ]
        : [
            `${a.labels[0]}: ${b.events1}/${b.n1} = ${(b.rate1 * 100).toFixed(1)}%`,
            `${a.labels[1]}: ${b.events2}/${b.n2} = ${(b.rate2 * 100).toFixed(1)}%`,
            `risk difference = ${fmtN(b.diff, 3)} (95% CI ${fmtN(b.diff - 1.959964 * b.se, 3)} to ${fmtN(b.diff + 1.959964 * b.se, 3)})`,
            `chi2 = ${fmtN(b.chi2, 4)} (df=1)`,
            `p = ${fmtP(b.p)}${sig ? '  (significant)' : ''}`,
            `Fisher exact p = ${fmtP(b.fisherP)}`,
            `RR = ${fmtN(b.rr, 4)}   OR = ${fmtN(b.or, 4)}`,
          ];
      this.textPanel(g, canvas, lines, sig);
    } else if (a.welch) {
      const w = a.welch;
      const armsData = [
        { cx: cx1, mean: w.mean1, sd: w.sd1, n: w.n1, label: a.labels[0], color: C_BLUE, soft: C_BLUE_SOFT, idx: 0 },
        { cx: cx2, mean: w.mean2, sd: w.sd2, n: w.n2, label: a.labels[1], color: C_GREEN, soft: C_GREEN_SOFT, idx: 1 },
      ];
      const spread = Math.max(w.sd1, w.sd2, 1e-9) * 2.5;
      const lo = Math.min(w.mean1, w.mean2) - spread;
      const hi = Math.max(w.mean1, w.mean2) + spread;
      const yToPix = (v: number) => plot.y1 - ((v - lo) / (hi - lo)) * (plot.y1 - plot.y0);
      g.strokeStyle = C_AXIS;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(plot.x0, plot.y0);
      g.lineTo(plot.x0, plot.y1);
      g.lineTo(plot.x1, plot.y1);
      g.stroke();
      g.font = this.font(10);
      g.textAlign = 'right';
      for (let i = 0; i <= 4; i += 1) {
        const v = lo + ((hi - lo) * i) / 4;
        const y = yToPix(v);
        g.strokeStyle = C_GRID;
        g.beginPath();
        g.moveTo(plot.x0, y);
        g.lineTo(plot.x1, y);
        g.stroke();
        g.fillStyle = C_DIM;
        g.fillText(fmtN(v, 4), plot.x0 - 6, y + 3);
      }
      // jittered points
      const data = this.ensureTrial();
      if (data) {
        const values = s.endpointSel === 'event' ? data.event : s.endpointSel === 'secondary' ? data.secondary : data.primary;
        if (values) {
          const byArm = valuesByArm(data.arm, values, data.armLabels.slice(0, 2));
          for (const arm of armsData) {
            const arr = (byArm[arm.idx] ?? []).slice(0, 120);
            g.fillStyle = arm.soft;
            g.textAlign = 'center';
            for (let j = 0; j < arr.length; j += 1) {
              const dx = ((j * 37) % 23) - 11;
              g.beginPath();
              g.arc(arm.cx + dx, yToPix(arr[j]!), 2, 0, Math.PI * 2);
              g.fill();
            }
          }
        }
      }
      // mean ± 95% CI whiskers
      for (const arm of armsData) {
        const se = arm.sd / Math.sqrt(arm.n);
        const yMean = yToPix(arm.mean);
        const yLo = yToPix(arm.mean - 1.959964 * se);
        const yHi = yToPix(arm.mean + 1.959964 * se);
        g.strokeStyle = arm.color;
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(arm.cx - 20, yMean);
        g.lineTo(arm.cx + 20, yMean);
        g.stroke();
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(arm.cx, yLo);
        g.lineTo(arm.cx, yHi);
        g.moveTo(arm.cx - 8, yHi);
        g.lineTo(arm.cx + 8, yHi);
        g.moveTo(arm.cx - 8, yLo);
        g.lineTo(arm.cx + 8, yLo);
        g.stroke();
        g.lineWidth = 1;
        g.fillStyle = C_DIM;
        g.font = this.font(10);
        g.textAlign = 'center';
        g.fillText(arm.label, arm.cx, plot.y1 + 16);
      }
      g.textAlign = 'left';
      g.fillStyle = C_DIM;
      g.font = this.font(11);
      g.fillText(zh ? '散点（每臂最多 120）与均值 ± 95% CI' : 'points (up to 120 per arm) and mean +/- 95% CI', plot.x0 + 4, plot.y0 - 4);
      const sig = w.p < s.alpha;
      const lines = zh
        ? [
            `${a.labels[0]}: n=${w.n1}, mean=${fmtN(w.mean1, 4)}, sd=${fmtN(w.sd1, 4)}`,
            `${a.labels[1]}: n=${w.n2}, mean=${fmtN(w.mean2, 4)}, sd=${fmtN(w.sd2, 4)}`,
            `均值差 = ${fmtN(w.diff, 4)}`,
            `95% CI = ${fmtN(w.ciLo, 4)} ~ ${fmtN(w.ciHi, 4)}`,
            `t = ${fmtN(w.t, 5)}, df = ${fmtN(w.df, 4)}（Welch）`,
            `p = ${fmtP(w.p)}${sig ? (zh ? '  ← 显著' : '  (significant)') : ''}`,
            `Cohen's d = ${fmtN(w.cohensD, 4)}`,
          ]
        : [
            `${a.labels[0]}: n=${w.n1}, mean=${fmtN(w.mean1, 4)}, sd=${fmtN(w.sd1, 4)}`,
            `${a.labels[1]}: n=${w.n2}, mean=${fmtN(w.mean2, 4)}, sd=${fmtN(w.sd2, 4)}`,
            `mean difference = ${fmtN(w.diff, 4)}`,
            `95% CI = ${fmtN(w.ciLo, 4)} to ${fmtN(w.ciHi, 4)}`,
            `t = ${fmtN(w.t, 5)}, df = ${fmtN(w.df, 4)} (Welch)`,
            `p = ${fmtP(w.p)}${sig ? '  (significant)' : ''}`,
            `Cohen's d = ${fmtN(w.cohensD, 4)}`,
          ];
      this.textPanel(g, canvas, lines, sig);
    }
    this.footer(g, canvas, zh ? `共 ${a.n1 + a.n2} 例；α=${fmtN(s.alpha, 3)}。` : `${a.n1 + a.n2} subjects; alpha=${fmtN(s.alpha, 3)}.`);
  }

  private textPanel(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, lines: string[], sig: boolean): void {
    const x = Math.min(canvas.width - 300, Math.max(250, canvas.width * 0.66));
    let y = 62;
    g.font = this.font(11);
    g.textAlign = 'left';
    for (const line of lines) {
      const isP = line.startsWith('p ') || line.startsWith('p =');
      g.fillStyle = isP && sig ? C_GREEN : C_DIM;
      g.fillText(line, x, y);
      y += 18;
    }
  }

  // ---- mode 4: interim boundaries ---------------------------------------------

  private drawInterim(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const zh = this.zh;
    const s = this.state;
    const b = this.boundaries();
    const k = s.looks;
    const times = equalInformationFractions(k);
    const showObf = s.compare !== 'pocock';
    const showPocock = s.compare !== 'obf';
    this.title(g, canvas, `${zh ? MODE_TITLES.interim.zh : MODE_TITLES.interim.en} — k=${k}, α=${fmtN(s.alpha, 3)}（${zh ? '双侧消耗函数' : 'two-sided alpha spending'}）`);
    const b1 = Math.max(showObf ? b.obf[0] ?? 3 : 0, showPocock ? b.pocock[0] ?? 3 : 0);
    const yMax = b1 + 0.8;
    const plot: Panel = { x0: 64, y0: 46, x1: canvas.width - 30, y1: canvas.height - 58 };
    const xToPix = (t: number) => plot.x0 + t * (plot.x1 - plot.x0);
    const yToPix = (z: number) => plot.y1 - (z / yMax) * (plot.y1 - plot.y0);
    // axes + grid
    g.strokeStyle = C_AXIS;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(plot.x0, plot.y0);
    g.lineTo(plot.x0, plot.y1);
    g.lineTo(plot.x1, plot.y1);
    g.stroke();
    g.font = this.font(10);
    g.textAlign = 'right';
    const stepZ = yMax > 6 ? 2 : 1;
    for (let z = 0; z <= yMax + 1e-9; z += stepZ) {
      const y = yToPix(z);
      g.strokeStyle = C_GRID;
      g.beginPath();
      g.moveTo(plot.x0, y);
      g.lineTo(plot.x1, y);
      g.stroke();
      g.fillStyle = C_DIM;
      g.fillText(z.toFixed(0), plot.x0 - 6, y + 3);
    }
    g.textAlign = 'center';
    for (let j = 1; j <= k; j += 1) {
      const x = xToPix(j / k);
      g.strokeStyle = C_GRID;
      g.beginPath();
      g.moveTo(x, plot.y0);
      g.lineTo(x, plot.y1);
      g.stroke();
      g.fillStyle = C_DIM;
      g.fillText(`${Math.round((j / k) * 100)}%`, x, plot.y1 + 14);
    }
    g.fillStyle = C_DIM;
    g.font = this.font(11);
    g.fillText(zh ? '信息分数' : 'information fraction', (plot.x0 + plot.x1) / 2, plot.y1 + 30);
    g.save();
    g.translate(16, (plot.y0 + plot.y1) / 2);
    g.rotate(-Math.PI / 2);
    g.fillText('z', 0, 0);
    g.restore();
    // boundary curves
    const drawFamily = (arr: number[], color: string, dash: number[], label: string) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.setLineDash(dash);
      g.beginPath();
      for (let j = 0; j < k; j += 1) {
        const x = xToPix(times[j]!);
        const y = yToPix(arr[j] ?? 0);
        if (j === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.setLineDash([]);
      g.lineWidth = 1;
      g.fillStyle = color;
      for (let j = 0; j < k; j += 1) {
        const x = xToPix(times[j]!);
        const y = yToPix(arr[j] ?? 0);
        g.beginPath();
        g.arc(x, y, 3, 0, Math.PI * 2);
        g.fill();
      }
      g.font = this.font(11, true);
      g.textAlign = 'left';
      g.fillText(label, xToPix(times[0]!) + 10, yToPix(arr[0] ?? 0) - 8);
      g.font = this.font(10);
      g.textAlign = 'center';
      for (let j = 0; j < k; j += 1) {
        const x = xToPix(times[j]!);
        const y = yToPix(arr[j] ?? 0);
        const below = y + 14 > plot.y1;
        g.fillText(fmtN(arr[j] ?? 0, 3), x, below ? y - 10 : y + 13);
      }
    };
    if (showObf) drawFamily(b.obf, C_BLUE, [], "O'Brien-Fleming");
    if (showPocock) drawFamily(b.pocock, C_AMBER, [6, 4], 'Pocock');
    // current look marker + decision
    const look = Math.min(s.currentLook, k);
    const family: 'obf' | 'pocock' = s.compare === 'pocock' ? 'pocock' : 'obf';
    const bound = (family === 'obf' ? b.obf[look - 1] : b.pocock[look - 1]) ?? 0;
    const stop = Math.abs(s.currentZ) >= bound;
    const tCur = look / k;
    g.strokeStyle = stop ? C_RED : C_PURPLE;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(xToPix(tCur), plot.y0);
    g.lineTo(xToPix(tCur), plot.y1);
    g.stroke();
    g.setLineDash([]);
    g.fillStyle = stop ? C_RED : C_PURPLE;
    g.beginPath();
    g.arc(xToPix(tCur), yToPix(Math.min(Math.abs(s.currentZ), yMax)), 4.5, 0, Math.PI * 2);
    g.fill();
    g.font = this.font(12, true);
    g.textAlign = 'left';
    const famLabel = family === 'obf' ? "OBF" : 'Pocock';
    const conclusion = stop
      ? zh
        ? `第 ${look}/${k} 次期中：|z|=${fmtN(Math.abs(s.currentZ), 3)} ≥ ${famLabel} 边界 ${fmtN(bound, 3)} → 停止并拒绝 H0`
        : `Look ${look}/${k}: |z|=${fmtN(Math.abs(s.currentZ), 3)} >= ${famLabel} boundary ${fmtN(bound, 3)} -> stop, reject H0`
      : zh
        ? `第 ${look}/${k} 次期中：|z|=${fmtN(Math.abs(s.currentZ), 3)} < ${famLabel} 边界 ${fmtN(bound, 3)} → 继续试验`
        : `Look ${look}/${k}: |z|=${fmtN(Math.abs(s.currentZ), 3)} < ${famLabel} boundary ${fmtN(bound, 3)} -> continue`;
    g.fillStyle = stop ? C_RED : C_GREEN;
    g.fillText(conclusion, plot.x0 + 6, plot.y0 + 18);
    const list = (arr: number[]) => arr.map((v) => fmtN(v, 3)).join(' / ');
    this.footer(g, canvas, (showObf ? `OBF: ${list(b.obf)}` : '') + (showObf && showPocock ? '   ' : '') + (showPocock ? `Pocock: ${list(b.pocock)}` : ''));
  }

  // ---- mode 5: AE signals ------------------------------------------------------

  private drawAe(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, rows: AeSignalRow[]): void {
    const zh = this.zh;
    this.title(g, canvas, `${zh ? MODE_TITLES.ae.zh : MODE_TITLES.ae.en} — PRR ≥ 2 ${zh ? '且' : 'and'} χ² ≥ 4`);
    const sorted = [...rows].sort((x, y) => (y.signal ? 1 : 0) - (x.signal ? 1 : 0) || y.prr - x.prr);
    const tableRight = Math.max(420, Math.min(canvas.width * 0.6, canvas.width - 280));
    const rowH = 17;
    const tableTop = 46;
    const colsDef = zh
      ? [
          { x: 24, w: 90, label: '处理组' },
          { x: 116, w: 120, label: '事件' },
          { x: 238, w: 90, label: '例数/n' },
          { x: 330, w: 64, label: '率' },
          { x: 396, w: 56, label: 'PRR' },
          { x: 454, w: 56, label: 'χ²' },
          { x: 512, w: 54, label: '信号' },
        ]
      : [
          { x: 24, w: 90, label: 'treatment' },
          { x: 116, w: 120, label: 'event' },
          { x: 238, w: 90, label: 'cases/n' },
          { x: 330, w: 64, label: 'rate' },
          { x: 396, w: 56, label: 'PRR' },
          { x: 454, w: 56, label: 'chi2' },
          { x: 512, w: 54, label: 'flag' },
        ];
    const last = colsDef[colsDef.length - 1]!;
    const scale = Math.min(1, (tableRight - 24) / (last.x + last.w - 24));
    const cols = colsDef.map((c) => ({ ...c, x: 24 + (c.x - 24) * scale }));
    g.font = this.font(11, true);
    g.fillStyle = C_DIM;
    g.textAlign = 'left';
    for (const c of cols) g.fillText(c.label, c.x, tableTop);
    g.strokeStyle = C_GRID;
    g.beginPath();
    g.moveTo(24, tableTop + 6);
    g.lineTo(cols[cols.length - 1]!.x + cols[cols.length - 1]!.w, tableTop + 6);
    g.stroke();
    const maxRows = Math.max(2, Math.floor((canvas.height - tableTop - 34) / rowH));
    const shown = sorted.slice(0, maxRows);
    g.font = this.font(11);
    for (let i = 0; i < shown.length; i += 1) {
      const r = shown[i]!;
      const y = tableTop + 22 + i * rowH;
      const color = r.signal ? C_RED : C_TEXT;
      g.textAlign = 'left';
      g.fillStyle = color;
      g.fillText(r.treatment, cols[0]!.x, y);
      g.fillText(r.event, cols[1]!.x, y);
      g.fillStyle = C_DIM;
      g.fillText(`${r.cases}/${r.n}`, cols[2]!.x, y);
      g.fillText(`${(r.rate * 100).toFixed(1)}%`, cols[3]!.x, y);
      g.fillStyle = color;
      g.fillText(Number.isFinite(r.prr) ? fmtN(r.prr, 3) : 'Inf', cols[4]!.x, y);
      g.fillText(fmtN(r.chi2, 3), cols[5]!.x, y);
      g.fillStyle = r.signal ? C_RED : C_GRID;
      g.fillText(r.signal ? (zh ? '警告' : 'WARN') : '—', cols[6]!.x, y);
    }
    // right panel: PRR bar chart with threshold at 2
    const barTop = tableTop + 10;
    const barBottom = canvas.height - 40;
    const barX = tableRight + 24;
    const barW = canvas.width - barX - 24;
    if (barW > 60) {
      const chart = sorted.slice(0, Math.max(2, Math.floor((barBottom - barTop) / 18)));
      const finiteMax = Math.max(...chart.map((r) => (Number.isFinite(r.prr) ? r.prr : 0)), 2.5);
      const maxPrr = Math.min(8, finiteMax);
      const xToPix = (v: number) => barX + (v / maxPrr) * barW;
      g.strokeStyle = C_AXIS;
      g.beginPath();
      g.moveTo(barX, barTop);
      g.lineTo(barX, barBottom);
      g.stroke();
      g.fillStyle = C_DIM;
      g.font = this.font(10);
      g.textAlign = 'left';
      g.fillText('PRR', barX, barTop - 2);
      const xTh = xToPix(2);
      g.strokeStyle = C_AMBER;
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(xTh, barTop);
      g.lineTo(xTh, barBottom);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = C_AMBER;
      g.textAlign = 'center';
      g.fillText('2', xTh, barBottom + 12);
      const rowH2 = (barBottom - barTop) / Math.max(chart.length, 1);
      for (let i = 0; i < chart.length; i += 1) {
        const r = chart[i]!;
        const y = barTop + i * rowH2 + rowH2 * 0.2;
        const h = rowH2 * 0.6;
        const w = (Math.min(Number.isFinite(r.prr) ? r.prr : maxPrr, maxPrr) / maxPrr) * barW;
        g.fillStyle = r.signal ? C_RED : 'rgba(120,170,220,0.75)';
        g.fillRect(barX, y, Math.max(w, 1), h);
      }
      g.textAlign = 'left';
      g.fillStyle = C_DIM;
      g.fillText(zh ? `阈值 PRR ≥ 2（需同时 χ² ≥ 4），前 ${chart.length} 行` : `threshold PRR >= 2 (with chi2 >= 4), top ${chart.length} rows`, barX, barBottom + 24);
    }
    const signals = rows.filter((r) => r.signal);
    const maxPrrAll = rows.reduce((m, r) => (Number.isFinite(r.prr) && r.prr > m ? r.prr : m), 0);
    const firstSignal = signals[0];
    this.footer(
      g,
      canvas,
      zh
        ? `${rows.length} 行 · 信号 ${signals.length} 个 · 最大 PRR ${fmtN(maxPrrAll, 3)}${firstSignal ? `（${firstSignal.treatment} / ${firstSignal.event} 等）` : ''}`
        : `${rows.length} rows · ${signals.length} signal(s) · max PRR ${fmtN(maxPrrAll, 3)}${firstSignal ? ` (${firstSignal.treatment} / ${firstSignal.event} ...)` : ''}`,
    );
  }
}
