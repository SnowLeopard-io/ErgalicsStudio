// ==========================================================================
// eng-heat — heat transfer laboratory
//
// Live workbench with five modes (conduction / convection / radiation /
// exchanger / network). Parameter edits recompute immediately and redraw the
// canvas; "Simulate" additionally announces the headline numbers, and
// "Benchmarks" runs the embedded deterministic validation suite and publishes
// it to the science strip. Views: composite-wall profile, SOR isotherms,
// FTCS transients, Nu(Re) / h(ΔT) correlation curves, Planck spectra,
// ε-NTU families and a resistance-network schematic. CSV/JSON row tables
// (wall or exchanger parameters) can be pushed through compute() in both
// Block (array/rows object) and Flow (text) form. No emoji, muted academic
// palette throughout.
// ==========================================================================

import type { ComputeResult, ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import {
  clearScienceOutputs,
  fmtMetric,
  setScienceOutputs,
  type ScienceMetric,
  type ScienceSeverity,
} from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { engHeatManifest } from './manifest';
import { heatxFigurePanels, type HeatXFigureInput, type HeatXLinePanel } from './figure';
import {
  FTCS_LIMIT,
  STEFAN_BOLTZMANN,
  WIEN_UM_K,
  blackbodyEmittance,
  combinedSurfaceExchange,
  crossValidateMethods,
  enclosureExchange,
  epsilonNtuMethod,
  exchangerEffectiveness,
  ftcsCourant,
  ftcsRun,
  mixedRole,
  nusseltDittusBoelter,
  nusseltForced,
  nusseltNatural,
  nusseltGnielinski,
  planckCurve,
  planckSpectral,
  rayleighNumber,
  separationOfVariablesRect,
  slabTransientSeries,
  solveNetwork,
  solveWall,
  viewFactor,
  wienPeakWavelength,
  type SorResult,
  type TransientResult,
  type WallResult,
  type EpsNtuResult,
  type NetworkResult,
} from './kernel';

export { engHeatManifest } from './manifest';

type Mode = 'conduction' | 'convection' | 'radiation' | 'exchanger' | 'network';

interface State {
  mode: Mode;
  // conduction
  conductionView: 'wall' | 'contour' | 'transient';
  nLayers: 1 | 2 | 3;
  l1: number; k1: number; l2: number; k2: number; l3: number; k3: number;
  tHot: number; tCold: number; hHot: number; hCold: number; area: number;
  // 2-D steady contour
  domW: number; domH: number; sorN: number;
  tLeft: number; tRight: number; tBottom: number;
  topBc: 'fixed' | 'conv'; tTop: number; hTop: number; tInfTop: number;
  // transient
  tranDim: '1d' | '2d';
  tranAlphaU: number; // α in 1e-6 m²/s
  tranL: number; tranN: number; tranDt: number; tranSteps: number;
  tranTHot: number; tranTCold: number; tranTInit: number;
  // convection
  convKind: 'forced' | 'natural';
  correlation: 'dittus-boelter' | 'gnielinski';
  heating: boolean;
  re: number; pr: number; kFluid: number; dTube: number;
  natGeom: 'vertical-plate' | 'horizontal-cylinder';
  natPr: number; natNuU: number; natAlphaU: number; natL: number; natDt: number; natK: number; natTFilm: number;
  // radiation
  radView: 'blackbody' | 'enclosure' | 'combined';
  tBody: number;
  vfGeom: 'parallel-plates' | 'coaxial-disks';
  eps1: number; eps2: number; t1: number; t2: number;
  vfArea1: number; vfArea2: number;
  rDisk1: number; rDisk2: number; sepDisk: number;
  cTsurf: number; cTfluid: number; cTsur: number; cHconv: number; cEps: number; cArea: number;
  // exchanger
  exArrangement: 'counter' | 'parallel' | 'shell-tube' | 'crossflow';
  exThIn: number; exTcIn: number; exCh: number; exCc: number; exUa: number;
  exTubePasses: 2 | 4 | 6;
  exMixed: 'hot' | 'cold';
  // network
  tNetHot: number; tNetCold: number;
  rA: number; rB: number; rC: number; rD: number; rE: number;
}

/** Muted, low-saturation academic palette (no emoji anywhere in the UI). */
const PALETTE = {
  axis: 'rgba(120,140,165,0.55)',
  grid: 'rgba(255,255,255,0.06)',
  text: 'rgba(210,220,235,0.95)',
  dim: 'rgba(160,175,195,0.9)',
  faint: 'rgba(150,165,185,0.65)',
  s1: 'rgba(109,180,255,0.95)', // muted blue
  s2: 'rgba(93,208,168,0.95)', // muted teal
  s3: 'rgba(180,140,255,0.85)', // muted violet
  s4: 'rgba(232,185,106,0.95)', // muted sand
  s5: 'rgba(217,138,138,0.9)', // muted rose
  hot: 'rgba(214,120,95,0.9)',
  cold: 'rgba(96,150,205,0.9)',
};

interface Rect { x: number; y: number; w: number; h: number }

function linTicks(lo: number, hi: number, target: number): number[] {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [lo];
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  const start = Math.ceil(lo / step - 1e-9) * step;
  for (let v = start; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e4 || a < 1e-3)) return v.toExponential(1);
  return String(Number(v.toPrecision(3)));
}

function drawFrame(g: CanvasRenderingContext2D, r: Rect, title: string, xLabel: string, yLabel: string, zh: boolean): void {
  g.strokeStyle = PALETTE.axis;
  g.lineWidth = 1;
  g.strokeRect(r.x, r.y, r.w, r.h);
  g.fillStyle = PALETTE.text;
  g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(title, r.x + 6, r.y + 14);
  g.font = '10px Consolas, monospace';
  g.fillStyle = PALETTE.dim;
  g.textAlign = 'right';
  g.fillText(xLabel, r.x + r.w, r.y + r.h + 13);
  g.save();
  g.translate(r.x - 8, r.y + r.h / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.fillText(yLabel, 0, 0);
  g.restore();
}

/** Muted cool→warm field colormap (academic, low saturation). */
function fieldColor(v: number): [number, number, number] {
  const t = Math.min(1, Math.max(0, v));
  const stops: Array<[number, number, number, number]> = [
    [0.0, 38, 52, 76],
    [0.25, 62, 96, 128],
    [0.5, 150, 165, 172],
    [0.75, 196, 156, 116],
    [1.0, 226, 200, 164],
  ];
  for (let i = 1; i < stops.length; i += 1) {
    if (t <= stops[i]![0]) {
      const a = stops[i - 1]!;
      const b = stops[i]!;
      const f = (t - a[0]) / (b[0] - a[0]);
      return [
        Math.round(a[1] + f * (b[1] - a[1])),
        Math.round(a[2] + f * (b[2] - a[2])),
        Math.round(a[3] + f * (b[3] - a[3])),
      ];
    }
  }
  return [226, 200, 164];
}

export class EngHeatPlugin implements Plugin {
  readonly manifest = engHeatManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    mode: 'conduction',
    conductionView: 'wall',
    nLayers: 3,
    l1: 0.02, k1: 45, l2: 0.1, k2: 0.04, l3: 0.15, k3: 1.4,
    tHot: 300, tCold: 25, hHot: 60, hCold: 15, area: 1,
    domW: 1, domH: 1, sorN: 41,
    tLeft: 0, tRight: 0, tBottom: 0,
    topBc: 'fixed', tTop: 100, hTop: 25, tInfTop: 100,
    tranDim: '1d',
    tranAlphaU: 12, // 1.2e-5 m²/s ≈ steel
    tranL: 0.1, tranN: 41, tranDt: 0.02, tranSteps: 1500,
    tranTHot: 100, tranTCold: 100, tranTInit: 20,
    convKind: 'forced',
    correlation: 'gnielinski',
    heating: true,
    re: 12000, pr: 5.8, kFluid: 0.61, dTube: 0.025,
    natGeom: 'vertical-plate',
    natPr: 0.71, natNuU: 1.6, natAlphaU: 2.25, natL: 0.3, natDt: 20, natK: 0.026, natTFilm: 300,
    radView: 'blackbody',
    tBody: 1500,
    vfGeom: 'parallel-plates',
    eps1: 0.8, eps2: 0.5, t1: 800, t2: 300,
    vfArea1: 2, vfArea2: 2,
    rDisk1: 0.2, rDisk2: 0.2, sepDisk: 0.2,
    cTsurf: 350, cTfluid: 300, cTsur: 290, cHconv: 10, cEps: 0.85, cArea: 1,
    exArrangement: 'counter',
    exThIn: 150, exTcIn: 30, exCh: 600, exCc: 400, exUa: 450,
    exTubePasses: 2,
    exMixed: 'hot',
    tNetHot: 100, tNetCold: 20,
    rA: 0.5, rB: 1.2, rC: 0.8, rD: 0.4, rE: 3,
  };
  private errorMsg: string | null = null;
  // per-mode cached results
  private wall: WallResult | null = null;
  private sor: SorResult | null = null;
  private tran: TransientResult | null = null;
  private forced: { nu: number; h: number; re: number; pr: number } | null = null;
  private nat: { ra: number; nu: number; h: number } | null = null;
  private bb: { tK: number; eb: number; lambdaMax: number } | null = null;
  private enc: ReturnType<typeof enclosureExchange> | null = null;
  private comb: ReturnType<typeof combinedSurfaceExchange> | null = null;
  private exg: { eps: EpsNtuResult; cross: ReturnType<typeof crossValidateMethods> | null; fNote: string } | null = null;
  private net: NetworkResult | null = null;

  // ---- lifecycle -----------------------------------------------------------

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
    this.draw();
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- parameter definitions -------------------------------------------------

  private sel(key: string, en: string, zh: string, value: string, options: Array<{ value: string; en: string; zh: string }>, visibleWhen?: { key: string; in: string[] }): ParamDefinition {
    return {
      key,
      label: en,
      labelI18n: { 'zh-CN': zh, 'en-US': en },
      type: 'select',
      options: options.map((o) => ({ value: o.value, label: this.zh ? o.zh : o.en, labelI18n: { 'zh-CN': o.zh, 'en-US': o.en } })),
      value,
      ...(visibleWhen ? { visibleWhen } : {}),
    };
  }

  private rng(key: string, en: string, zh: string, min: number, max: number, step: number, value: number, visibleWhen?: { key: string; in: string[] }): ParamDefinition {
    return {
      key,
      label: en,
      labelI18n: { 'zh-CN': zh, 'en-US': en },
      type: 'range',
      min,
      max,
      step,
      value,
      ...(visibleWhen ? { visibleWhen } : {}),
    };
  }

  getParams(): ParamDefinition[] {
    const s = this.state;
    const COND: Mode[] = ['conduction'];
    const CONV: Mode[] = ['convection'];
    const RAD: Mode[] = ['radiation'];
    const EX: Mode[] = ['exchanger'];
    const NET: Mode[] = ['network'];
    return [
      this.sel('mode', 'Mode', '模式', s.mode, [
        { value: 'conduction', en: 'Conduction', zh: '导热' },
        { value: 'convection', en: 'Convection', zh: '对流' },
        { value: 'radiation', en: 'Radiation', zh: '辐射' },
        { value: 'exchanger', en: 'Heat exchanger', zh: '换热器' },
        { value: 'network', en: 'Resistance network', zh: '热阻网络' },
      ]),

      // ---- conduction ----
      this.sel('conductionView', 'Conduction view', '导热视图', s.conductionView, [
        { value: 'wall', en: 'Composite wall (1-D steady)', zh: '复合平壁（一维稳态）' },
        { value: 'contour', en: '2-D steady isotherms (SOR)', zh: '二维稳态等温线（SOR）' },
        { value: 'transient', en: 'Transient (FTCS)', zh: '瞬态（FTCS）' },
      ], { key: 'mode', in: COND }),
      this.sel('nLayers', 'Wall layers', '壁层数', String(s.nLayers), [
        { value: '1', en: '1 layer', zh: '单层' },
        { value: '2', en: '2 layers', zh: '两层' },
        { value: '3', en: '3 layers', zh: '三层' },
      ], { key: 'conductionView', in: ['wall'] }),
      this.rng('l1', 'Layer 1 L (m)', '第 1 层厚度 L (m)', 0.005, 0.5, 0.005, s.l1, { key: 'conductionView', in: ['wall'] }),
      this.rng('k1', 'Layer 1 k (W/m·K)', '第 1 层导热率 k', 0.02, 60, 0.02, s.k1, { key: 'conductionView', in: ['wall'] }),
      this.rng('l2', 'Layer 2 L (m)', '第 2 层厚度 L (m)', 0.005, 0.5, 0.005, s.l2, { key: 'conductionView', in: ['wall'] }),
      this.rng('k2', 'Layer 2 k (W/m·K)', '第 2 层导热率 k', 0.02, 60, 0.02, s.k2, { key: 'conductionView', in: ['wall'] }),
      this.rng('l3', 'Layer 3 L (m)', '第 3 层厚度 L (m)', 0.005, 0.5, 0.005, s.l3, { key: 'conductionView', in: ['wall'] }),
      this.rng('k3', 'Layer 3 k (W/m·K)', '第 3 层导热率 k', 0.02, 60, 0.02, s.k3, { key: 'conductionView', in: ['wall'] }),
      this.rng('tHot', 'T_hot (fluid, °C)', '热侧流体温度 T_hot (°C)', -20, 400, 1, s.tHot, { key: 'conductionView', in: ['wall'] }),
      this.rng('tCold', 'T_cold (fluid, °C)', '冷侧流体温度 T_cold (°C)', -20, 200, 1, s.tCold, { key: 'conductionView', in: ['wall'] }),
      this.rng('hHot', 'h_hot (W/m²·K)', '热侧对流系数 h_hot', 2, 500, 1, s.hHot, { key: 'conductionView', in: ['wall'] }),
      this.rng('hCold', 'h_cold (W/m²·K)', '冷侧对流系数 h_cold', 2, 500, 1, s.hCold, { key: 'conductionView', in: ['wall'] }),
      this.rng('area', 'Area A (m²)', '面积 A (m²)', 0.1, 20, 0.1, s.area, { key: 'conductionView', in: ['wall'] }),
      this.rng('domW', 'Domain W (m)', '计算域宽 W (m)', 0.2, 4, 0.1, s.domW, { key: 'conductionView', in: ['contour'] }),
      this.rng('domH', 'Domain H (m)', '计算域高 H (m)', 0.2, 4, 0.1, s.domH, { key: 'conductionView', in: ['contour'] }),
      this.rng('sorN', 'Grid n / axis', '每轴网格数 n', 21, 81, 4, s.sorN, { key: 'conductionView', in: ['contour'] }),
      this.rng('tLeft', 'T_left (°C)', '左边界温度 T_left', -20, 200, 1, s.tLeft, { key: 'conductionView', in: ['contour'] }),
      this.rng('tRight', 'T_right (°C)', '右边界温度 T_right', -20, 200, 1, s.tRight, { key: 'conductionView', in: ['contour'] }),
      this.rng('tBottom', 'T_bottom (°C)', '下边界温度 T_bottom', -20, 200, 1, s.tBottom, { key: 'conductionView', in: ['contour'] }),
      this.sel('topBc', 'Top boundary', '上边界类型', s.topBc, [
        { value: 'fixed', en: 'Isothermal', zh: '恒温' },
        { value: 'conv', en: 'Convection', zh: '对流' },
      ], { key: 'conductionView', in: ['contour'] }),
      this.rng('tTop', 'T_top (°C)', '上边界温度 T_top', -20, 200, 1, s.tTop, { key: 'conductionView', in: ['contour'] }),
      this.rng('hTop', 'h_top (W/m²·K)', '上边界 h_top', 2, 200, 1, s.hTop, { key: 'topBc', in: ['conv'] }),
      this.rng('tInfTop', 'T_inf,top (°C)', '上边界流体温度 T_inf', -20, 200, 1, s.tInfTop, { key: 'topBc', in: ['conv'] }),
      this.sel('tranDim', 'Transient dimension', '瞬态维度', s.tranDim, [
        { value: '1d', en: '1-D slab', zh: '一维平板' },
        { value: '2d', en: '2-D square', zh: '二维方形域' },
      ], { key: 'conductionView', in: ['transient'] }),
      this.rng('tranAlphaU', 'α (×1e-6 m²/s)', '热扩散率 α (×1e-6 m²/s)', 1, 200, 1, s.tranAlphaU, { key: 'conductionView', in: ['transient'] }),
      this.rng('tranL', 'Domain L (m)', '计算域边长 L (m)', 0.02, 0.5, 0.01, s.tranL, { key: 'conductionView', in: ['transient'] }),
      this.rng('tranN', 'Grid n / axis', '每轴网格数 n', 21, 101, 4, s.tranN, { key: 'conductionView', in: ['transient'] }),
      this.rng('tranDt', 'dt (s)', '时间步长 dt (s)', 0.001, 0.2, 0.001, s.tranDt, { key: 'conductionView', in: ['transient'] }),
      this.rng('tranSteps', 'Steps', '步数 steps', 50, 30000, 50, s.tranSteps, { key: 'conductionView', in: ['transient'] }),
      this.rng('tranTHot', 'T_hot BC (°C)', '热边界温度 T_hot', -20, 400, 1, s.tranTHot, { key: 'conductionView', in: ['transient'] }),
      this.rng('tranTCold', 'T_cold BC (°C)', '冷边界温度 T_cold', -20, 400, 1, s.tranTCold, { key: 'conductionView', in: ['transient'] }),
      this.rng('tranTInit', 'T_initial (°C)', '初始温度 T_initial', -20, 400, 1, s.tranTInit, { key: 'conductionView', in: ['transient'] }),

      // ---- convection ----
      this.sel('convKind', 'Convection family', '对流类型', s.convKind, [
        { value: 'forced', en: 'Forced (internal turbulent)', zh: '强制对流（管内湍流）' },
        { value: 'natural', en: 'Natural (Churchill–Chu)', zh: '自然对流（Churchill–Chu）' },
      ], { key: 'mode', in: CONV }),
      this.sel('correlation', 'Correlation', '关联式', s.correlation, [
        { value: 'dittus-boelter', en: 'Dittus–Boelter', zh: 'Dittus–Boelter' },
        { value: 'gnielinski', en: 'Gnielinski', zh: 'Gnielinski' },
      ], { key: 'convKind', in: ['forced'] }),
      {
        key: 'heating', label: 'Fluid heated (n = 0.4)', labelI18n: { 'zh-CN': '流体被加热（n = 0.4）', 'en-US': 'Fluid heated (n = 0.4)' },
        type: 'checkbox', value: s.heating, visibleWhen: { key: 'convKind', in: ['forced'] },
      },
      this.rng('re', 'Re', '雷诺数 Re', 3000, 100000, 500, s.re, { key: 'convKind', in: ['forced'] }),
      this.rng('pr', 'Pr', '普朗特数 Pr', 0.5, 13, 0.1, s.pr, { key: 'convKind', in: ['forced'] }),
      this.rng('kFluid', 'k (W/m·K)', '流体导热率 k', 0.02, 0.7, 0.01, s.kFluid, { key: 'convKind', in: ['forced'] }),
      this.rng('dTube', 'D (m)', '管内径 D (m)', 0.005, 0.1, 0.005, s.dTube, { key: 'convKind', in: ['forced'] }),
      this.sel('natGeom', 'Geometry', '几何', s.natGeom, [
        { value: 'vertical-plate', en: 'Vertical plate', zh: '竖壁' },
        { value: 'horizontal-cylinder', en: 'Horizontal cylinder', zh: '水平圆筒' },
      ], { key: 'convKind', in: ['natural'] }),
      this.rng('natPr', 'Pr', '普朗特数 Pr', 0.7, 7, 0.01, s.natPr, { key: 'convKind', in: ['natural'] }),
      this.rng('natNuU', 'ν (×1e-5 m²/s)', '运动黏度 ν (×1e-5 m²/s)', 1, 2.5, 0.05, s.natNuU, { key: 'convKind', in: ['natural'] }),
      this.rng('natAlphaU', 'α (×1e-5 m²/s)', '热扩散率 α (×1e-5 m²/s)', 1, 2.5, 0.05, s.natAlphaU, { key: 'convKind', in: ['natural'] }),
      this.rng('natTFilm', 'T_film (K)', '膜温 T_film (K)', 250, 450, 5, s.natTFilm, { key: 'convKind', in: ['natural'] }),
      this.rng('natL', 'L (m)', '特征长度 L (m)', 0.05, 1, 0.01, s.natL, { key: 'convKind', in: ['natural'] }),
      this.rng('natDt', 'ΔT = |Ts − T∞| (K)', '温差 ΔT = |Ts − T∞| (K)', 1, 100, 1, s.natDt, { key: 'convKind', in: ['natural'] }),
      this.rng('natK', 'k (W/m·K)', '流体导热率 k', 0.02, 0.7, 0.01, s.natK, { key: 'convKind', in: ['natural'] }),

      // ---- radiation ----
      this.sel('radView', 'Radiation view', '辐射视图', s.radView, [
        { value: 'blackbody', en: 'Blackbody spectra', zh: '黑体光谱' },
        { value: 'enclosure', en: 'Gray two-surface enclosure', zh: '灰体两表面封闭腔' },
        { value: 'combined', en: 'Convection + radiation', zh: '对流 + 辐射复合' },
      ], { key: 'mode', in: RAD }),
      this.rng('tBody', 'T (K)', '黑体温度 T (K)', 200, 6000, 10, s.tBody, { key: 'radView', in: ['blackbody'] }),
      this.sel('vfGeom', 'Geometry', '几何', s.vfGeom, [
        { value: 'parallel-plates', en: 'Large parallel plates', zh: '大平板' },
        { value: 'coaxial-disks', en: 'Coaxial parallel disks', zh: '同轴平行圆盘' },
      ], { key: 'radView', in: ['enclosure'] }),
      this.rng('eps1', 'ε₁', '发射率 ε₁', 0.05, 1, 0.01, s.eps1, { key: 'radView', in: ['enclosure'] }),
      this.rng('eps2', 'ε₂', '发射率 ε₂', 0.05, 1, 0.01, s.eps2, { key: 'radView', in: ['enclosure'] }),
      this.rng('t1', 'T₁ (K)', '温度 T₁ (K)', 100, 1500, 5, s.t1, { key: 'radView', in: ['enclosure'] }),
      this.rng('t2', 'T₂ (K)', '温度 T₂ (K)', 100, 1500, 5, s.t2, { key: 'radView', in: ['enclosure'] }),
      this.rng('vfArea1', 'A₁ (m²)', '面积 A₁ (m²)', 0.5, 50, 0.5, s.vfArea1, { key: 'vfGeom', in: ['parallel-plates'] }),
      this.rng('vfArea2', 'A₂ (m²)', '面积 A₂ (m²)', 0.5, 50, 0.5, s.vfArea2, { key: 'vfGeom', in: ['parallel-plates'] }),
      this.rng('rDisk1', 'r₁ (m)', '半径 r₁ (m)', 0.02, 1, 0.01, s.rDisk1, { key: 'vfGeom', in: ['coaxial-disks'] }),
      this.rng('rDisk2', 'r₂ (m)', '半径 r₂ (m)', 0.02, 1, 0.01, s.rDisk2, { key: 'vfGeom', in: ['coaxial-disks'] }),
      this.rng('sepDisk', 'Separation L (m)', '间距 L (m)', 0.02, 1, 0.01, s.sepDisk, { key: 'vfGeom', in: ['coaxial-disks'] }),
      this.rng('cTsurf', 'T_surface (K)', '表面温度 T_s (K)', 280, 600, 5, s.cTsurf, { key: 'radView', in: ['combined'] }),
      this.rng('cTfluid', 'T_fluid (K)', '流体温度 T_fluid (K)', 250, 600, 5, s.cTfluid, { key: 'radView', in: ['combined'] }),
      this.rng('cTsur', 'T_surroundings (K)', '环境温度 T_sur (K)', 250, 600, 5, s.cTsur, { key: 'radView', in: ['combined'] }),
      this.rng('cHconv', 'h_conv (W/m²·K)', '对流系数 h_conv', 1, 200, 1, s.cHconv, { key: 'radView', in: ['combined'] }),
      this.rng('cEps', 'ε', '发射率 ε', 0.05, 1, 0.01, s.cEps, { key: 'radView', in: ['combined'] }),
      this.rng('cArea', 'A (m²)', '面积 A (m²)', 0.1, 20, 0.1, s.cArea, { key: 'radView', in: ['combined'] }),

      // ---- exchanger ----
      this.sel('exArrangement', 'Arrangement', '流动布置', s.exArrangement, [
        { value: 'counter', en: 'Counter-flow', zh: '逆流' },
        { value: 'parallel', en: 'Parallel-flow', zh: '顺流' },
        { value: 'shell-tube', en: '1 shell pass, n tube passes', zh: '1 壳程 n 管程' },
        { value: 'crossflow', en: 'Cross-flow (one side mixed)', zh: '叉流（单侧混合）' },
      ], { key: 'mode', in: EX }),
      this.rng('exThIn', 'T_h,in (°C)', '热流体进口温度 T_h,in', 40, 400, 5, s.exThIn, { key: 'mode', in: EX }),
      this.rng('exTcIn', 'T_c,in (°C)', '冷流体进口温度 T_c,in', 5, 100, 1, s.exTcIn, { key: 'mode', in: EX }),
      this.rng('exCh', 'C_h (W/K)', '热流体热容流率 C_h', 50, 5000, 50, s.exCh, { key: 'mode', in: EX }),
      this.rng('exCc', 'C_c (W/K)', '冷流体热容流率 C_c', 50, 5000, 50, s.exCc, { key: 'mode', in: EX }),
      this.rng('exUa', 'U·A (W/K)', '总传热系数·面积 U·A', 50, 5000, 50, s.exUa, { key: 'mode', in: EX }),
      this.sel('exTubePasses', 'Tube passes', '管程数', String(s.exTubePasses), [
        { value: '2', en: '2', zh: '2' },
        { value: '4', en: '4', zh: '4' },
        { value: '6', en: '6', zh: '6' },
      ], { key: 'exArrangement', in: ['shell-tube'] }),
      this.sel('exMixed', 'Mixed stream', '混合侧', s.exMixed, [
        { value: 'hot', en: 'Hot stream mixed', zh: '热流体混合' },
        { value: 'cold', en: 'Cold stream mixed', zh: '冷流体混合' },
      ], { key: 'exArrangement', in: ['crossflow'] }),

      // ---- network ----
      this.rng('tNetHot', 'T_hot node (°C)', '热节点温度 T_hot', 20, 300, 1, s.tNetHot, { key: 'mode', in: NET }),
      this.rng('tNetCold', 'T_cold node (°C)', '冷节点温度 T_cold', -20, 200, 1, s.tNetCold, { key: 'mode', in: NET }),
      this.rng('rA', 'R₁: hot film (K/W)', '热阻 R₁：热侧膜 (K/W)', 0.02, 3, 0.02, s.rA, { key: 'mode', in: NET }),
      this.rng('rB', 'R₂: layer a (K/W)', '热阻 R₂：壁层 a (K/W)', 0.02, 3, 0.02, s.rB, { key: 'mode', in: NET }),
      this.rng('rC', 'R₃: layer b (K/W)', '热阻 R₃：壁层 b (K/W)', 0.02, 3, 0.02, s.rC, { key: 'mode', in: NET }),
      this.rng('rD', 'R₄: cold film (K/W)', '热阻 R₄：冷侧膜 (K/W)', 0.02, 3, 0.02, s.rD, { key: 'mode', in: NET }),
      this.rng('rE', 'R₅: stud bypass 1→3 (K/W)', '热阻 R₅：肋/螺柱旁路 1→3 (K/W)', 0.1, 10, 0.1, s.rE, { key: 'mode', in: NET }),

      actionButton('simulate', 'Simulate', '仿真', 'primary'),
      actionButton('benchmarks', 'Run validation benchmarks', '运行验证基准'),
      actionButton('demoCsv', 'Run built-in demo table', '运行内置示例表'),
      actionButton('exportCsv', 'Export results CSV', '导出结果 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    const num = (k: keyof State, lo: number, hi: number): void => {
      const v = params[k as string];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      const c = Math.min(hi, Math.max(lo, v));
      if (this.state[k] !== c) {
        (this.state[k] as number) = c;
        changed = true;
      }
    };
    const pick = <T extends string>(k: keyof State, allowed: readonly T[]): void => {
      const v = params[k as string];
      if (typeof v !== 'string' || !allowed.includes(v as T)) return;
      if (this.state[k] !== (v as unknown)) {
        (this.state[k] as unknown) = v as T;
        changed = true;
      }
    };
    const bool = (k: keyof State): void => {
      const v = params[k as string];
      if (typeof v !== 'boolean' || this.state[k] === v) return;
      (this.state[k] as unknown) = v;
      changed = true;
    };

    pick('mode', ['conduction', 'convection', 'radiation', 'exchanger', 'network'] as const);
    pick('conductionView', ['wall', 'contour', 'transient'] as const);
    if (typeof params.nLayers === 'string') {
      const n = Number(params.nLayers) as 1 | 2 | 3;
      if (this.state.nLayers !== n) {
        this.state.nLayers = n;
        changed = true;
      }
    }
    num('l1', 0.005, 0.5); num('k1', 0.02, 60);
    num('l2', 0.005, 0.5); num('k2', 0.02, 60);
    num('l3', 0.005, 0.5); num('k3', 0.02, 60);
    num('tHot', -20, 400); num('tCold', -20, 200);
    num('hHot', 2, 500); num('hCold', 2, 500); num('area', 0.1, 20);
    num('domW', 0.2, 4); num('domH', 0.2, 4);
    num('sorN', 21, 81);
    num('tLeft', -20, 200); num('tRight', -20, 200); num('tBottom', -20, 200);
    pick('topBc', ['fixed', 'conv'] as const);
    num('tTop', -20, 200); num('hTop', 2, 200); num('tInfTop', -20, 200);
    pick('tranDim', ['1d', '2d'] as const);
    num('tranAlphaU', 1, 200); num('tranL', 0.02, 0.5); num('tranN', 21, 101);
    num('tranDt', 0.001, 0.2); num('tranSteps', 50, 30000);
    num('tranTHot', -20, 400); num('tranTCold', -20, 400); num('tranTInit', -20, 400);
    pick('convKind', ['forced', 'natural'] as const);
    pick('correlation', ['dittus-boelter', 'gnielinski'] as const);
    bool('heating');
    num('re', 3000, 100000); num('pr', 0.5, 13); num('kFluid', 0.02, 0.7); num('dTube', 0.005, 0.1);
    pick('natGeom', ['vertical-plate', 'horizontal-cylinder'] as const);
    num('natPr', 0.7, 7); num('natNuU', 1, 2.5); num('natAlphaU', 1, 2.5);
    num('natTFilm', 250, 450); num('natL', 0.05, 1); num('natDt', 1, 100); num('natK', 0.02, 0.7);
    pick('radView', ['blackbody', 'enclosure', 'combined'] as const);
    num('tBody', 200, 6000);
    pick('vfGeom', ['parallel-plates', 'coaxial-disks'] as const);
    num('eps1', 0.05, 1); num('eps2', 0.05, 1); num('t1', 100, 1500); num('t2', 100, 1500);
    num('vfArea1', 0.5, 50); num('vfArea2', 0.5, 50);
    num('rDisk1', 0.02, 1); num('rDisk2', 0.02, 1); num('sepDisk', 0.02, 1);
    num('cTsurf', 280, 600); num('cTfluid', 250, 600); num('cTsur', 250, 600);
    num('cHconv', 1, 200); num('cEps', 0.05, 1); num('cArea', 0.1, 20);
    pick('exArrangement', ['counter', 'parallel', 'shell-tube', 'crossflow'] as const);
    num('exThIn', 40, 400); num('exTcIn', 5, 100); num('exCh', 50, 5000); num('exCc', 50, 5000); num('exUa', 50, 5000);
    if (typeof params.exTubePasses === 'string') {
      const p2 = Number(params.exTubePasses) as 2 | 4 | 6;
      if ((p2 === 2 || p2 === 4 || p2 === 6) && this.state.exTubePasses !== p2) {
        this.state.exTubePasses = p2;
        changed = true;
      }
    }
    pick('exMixed', ['hot', 'cold'] as const);
    num('tNetHot', 20, 300); num('tNetCold', -20, 200);
    num('rA', 0.02, 3); num('rB', 0.02, 3); num('rC', 0.02, 3); num('rD', 0.02, 3); num('rE', 0.1, 10);

    if (changed) {
      this.recompute();
      this.draw();
    }
    if (actionFired(params, 'simulate')) this.runSimulation();
    if (actionFired(params, 'benchmarks')) this.runBenchmarks();
    if (actionFired(params, 'demoCsv')) this.runDemoTable();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- recompute ------------------------------------------------------------

  private wallLayers(): Array<{ L: number; k: number }> {
    const s = this.state;
    const layers = [{ L: s.l1, k: s.k1 }];
    if (s.nLayers >= 2) layers.push({ L: s.l2, k: s.k2 });
    if (s.nLayers >= 3) layers.push({ L: s.l3, k: s.k3 });
    return layers;
  }

  private recompute() {
    this.errorMsg = null;
    const s = this.state;
    try {
      let scale = 0;
      if (s.mode === 'conduction') {
        if (s.conductionView === 'wall') {
          this.wall = solveWall({
            layers: this.wallLayers(),
            area: s.area,
            tHot: s.tHot,
            tCold: s.tCold,
            hHot: s.hHot,
            hCold: s.hCold,
          });
          scale = this.wallLayers().length;
        } else if (s.conductionView === 'contour') {
          this.sor = sorSolve2d({
            width: s.domW,
            height: s.domH,
            nx: Math.round(s.sorN),
            ny: Math.round(s.sorN),
            k: 1,
            left: { type: 'fixed', t: s.tLeft },
            right: { type: 'fixed', t: s.tRight },
            bottom: { type: 'fixed', t: s.tBottom },
            top: s.topBc === 'fixed' ? { type: 'fixed', t: s.tTop } : { type: 'conv', h: s.hTop, tInf: s.tInfTop },
            tolerance: 1e-8,
          });
          scale = this.sor.nx * this.sor.ny;
        } else {
          this.tran = ftcsRun({
            dim: s.tranDim,
            alpha: s.tranAlphaU * 1e-6,
            length: s.tranL,
            height: s.tranL,
            n: Math.round(s.tranN),
            dt: s.tranDt,
            tHot: s.tranTHot,
            tCold: s.tranTCold,
            tInitial: s.tranTInit,
            steps: Math.round(s.tranSteps),
          });
          scale = this.tran.nx * this.tran.ny * Math.min(Math.round(s.tranSteps), 4096);
        }
      } else if (s.mode === 'convection') {
        if (s.convKind === 'forced') {
          const r = nusseltForced({
            correlation: s.correlation,
            re: s.re,
            pr: s.pr,
            heating: s.heating,
            k: s.kFluid,
            d: s.dTube,
          });
          this.forced = { nu: r.nu, h: r.h, re: s.re, pr: s.pr };
          scale = 240; // sweep resolution of the plotted Nu(Re) curve
        } else {
          this.nat = nusseltNatural({
            geometry: s.natGeom,
            pr: s.natPr,
            nu: s.natNuU * 1e-5,
            alpha: s.natAlphaU * 1e-5,
            beta: 1 / s.natTFilm,
            length: s.natL,
            dT: s.natDt,
            k: s.natK,
          });
          scale = 240;
        }
      } else if (s.mode === 'radiation') {
        if (s.radView === 'blackbody') {
          this.bb = { tK: s.tBody, eb: blackbodyEmittance(s.tBody), lambdaMax: wienPeakWavelength(s.tBody) };
          scale = 240;
        } else if (s.radView === 'enclosure') {
          this.enc = enclosureExchange({
            geometry: s.vfGeom,
            t1: s.t1,
            t2: s.t2,
            eps1: s.eps1,
            eps2: s.eps2,
            area1: s.vfArea1,
            area2: s.vfArea2,
            r1: s.rDisk1,
            r2: s.rDisk2,
            separation: s.sepDisk,
          });
          scale = 1;
        } else {
          this.comb = combinedSurfaceExchange({
            tSurf: s.cTsurf,
            tFluid: s.cTfluid,
            tSurroundings: s.cTsur,
            hConv: s.cHconv,
            eps: s.cEps,
            area: s.cArea,
          });
          scale = 1;
        }
      } else if (s.mode === 'exchanger') {
        const spec = {
          arrangement: s.exArrangement,
          thIn: s.exThIn,
          tcIn: s.exTcIn,
          ch: s.exCh,
          cc: s.exCc,
          ua: s.exUa,
          tubePasses: s.exTubePasses,
          crossflowMixed: s.exMixed,
        };
        const eps = epsilonNtuMethod(spec);
        let cross: ReturnType<typeof crossValidateMethods> | null = null;
        let fNote = '';
        if (s.exArrangement === 'counter' || s.exArrangement === 'parallel') {
          cross = crossValidateMethods(spec);
        } else {
          // No F-free LMTD reference: benchmark against the counter-flow bound.
          const epsCounter = exchangerEffectiveness({ ...spec, arrangement: 'counter' }, eps.ntu, eps.cr);
          const ratio = epsCounter > 0 ? eps.epsilon / epsCounter : Number.NaN;
          fNote =
            s.exArrangement === 'shell-tube'
              ? this.zh
                ? `1 壳程 ${s.exTubePasses} 管程闭式解；ε/ε_逆流 = ${fmtMetric(ratio)}`
                : `1 shell pass / ${s.exTubePasses} tube passes; ε/ε_counter = ${fmtMetric(ratio)}`
              : this.zh
                ? `叉流单侧混合（${mixedRole(spec) === 'min' ? 'Cmin 混合' : 'Cmax 混合'}）；ε/ε_逆流 = ${fmtMetric(ratio)}`
                : `cross-flow one side mixed (${mixedRole(spec) === 'min' ? 'Cmin mixed' : 'Cmax mixed'}); ε/ε_counter = ${fmtMetric(ratio)}`;
        }
        this.exg = { eps, cross, fNote };
        scale = 1;
      } else {
        this.net = solveNetwork({
          nNodes: 5,
          fixed: { 0: s.tNetHot, 4: s.tNetCold },
          edges: [
            { from: 0, to: 1, r: s.rA, label: 'R1' },
            { from: 1, to: 2, r: s.rB, label: 'R2' },
            { from: 2, to: 3, r: s.rC, label: 'R3' },
            { from: 3, to: 4, r: s.rD, label: 'R4' },
            { from: 1, to: 3, r: s.rE, label: 'R5' },
          ],
        });
        scale = 5;
      }
      this.api?.reportDataScale(scale);
      this.publishOutputs();
    } catch (e) {
      this.errorMsg = e instanceof Error ? e.message : String(e);
      this.wall = null;
      this.sor = null;
      this.tran = null;
      this.forced = null;
      this.nat = null;
      this.bb = null;
      this.enc = null;
      this.comb = null;
      this.exg = null;
      this.net = null;
      clearScienceOutputs(this.manifest.id);
    }
  }

  // ---- science outputs --------------------------------------------------------

  private publishOutputs() {
    const zh = this.zh;
    const s = this.state;
    const metrics: ScienceMetric[] = [];
    if (s.mode === 'conduction') {
      if (this.wall) {
        const w = this.wall;
        metrics.push(
          { key: 'q', label: zh ? '热流量 q' : 'Heat flow q', value: fmtMetric(w.q), unit: 'W', severity: 'ok', hint: zh ? '串联热阻链解析解 q = ΔT/R_total' : 'series-resistance closed form q = ΔT/R_total' },
          { key: 'r-total', label: zh ? '总热阻 R_total' : 'Total resistance R_total', value: fmtMetric(w.rTotal), unit: 'K/W', severity: 'info', hint: zh ? '1/(h₁A) + Σ L/(kA) + 1/(h₂A)' : '1/(h1·A) + Σ L/(kA) + 1/(h2·A)' },
          { key: 'q-flux', label: zh ? '热流密度 q″' : 'Heat flux q″', value: fmtMetric(w.qFlux), unit: 'W/m²', severity: 'info' },
          { key: 't-surf-hot', label: zh ? '热侧壁面温度' : 'Hot surface T', value: fmtMetric(w.nodeTemps[0] ?? Number.NaN), unit: '°C', severity: 'info' },
          { key: 't-surf-cold', label: zh ? '冷侧壁面温度' : 'Cold surface T', value: fmtMetric(w.nodeTemps[w.nodeTemps.length - 1] ?? Number.NaN), unit: '°C', severity: 'info' },
        );
      } else if (this.sor) {
        const sor = this.sor;
        const relImb = sor.qImbalance / Math.max(1e-12, Math.abs(sor.qIn) + Math.abs(sor.qOut));
        metrics.push(
          { key: 'sor-iter', label: zh ? 'SOR 迭代次数' : 'SOR iterations', value: String(sor.iterations), severity: sor.converged ? 'ok' : 'warn', hint: zh ? `ω = ${fmtMetric(sor.omega)}（最优 2/(1+sin(π/N))）` : `ω = ${fmtMetric(sor.omega)} (optimal 2/(1+sin(π/N)))` },
          { key: 'sor-residual', label: zh ? '收敛残差 max|ΔT|' : 'Residual max|ΔT|', value: fmtMetric(sor.residual), unit: 'K', severity: sor.converged ? 'ok' : 'warn' },
          { key: 'sor-qin', label: zh ? '边界热流 q_in' : 'Boundary q_in', value: fmtMetric(sor.qIn), unit: 'W/m', severity: 'info' },
          { key: 'sor-imbalance', label: zh ? '能量平衡残差' : 'Energy imbalance', value: fmtMetric(relImb * 100), unit: '%', severity: relImb < 1e-3 ? 'ok' : 'warn', hint: zh ? '|q_in + q_out| / (|q_in|+|q_out|)' : '|q_in + q_out| / (|q_in|+|q_out|)' },
        );
      } else if (this.tran) {
        const tr = this.tran;
        const r = tr.courant;
        metrics.push(
          { key: 'courant', label: 'r = Σ α·Δt/Δx²', value: fmtMetric(r), severity: r <= FTCS_LIMIT + 1e-12 ? 'ok' : 'error', hint: zh ? `FTCS von Neumann 稳定性上限 ${FTCS_LIMIT}` : `FTCS von Neumann ceiling ${FTCS_LIMIT}` },
          { key: 'fourier', label: zh ? '傅里叶数 Fo' : 'Fourier number Fo', value: fmtMetric(tr.fourier), severity: 'info' },
          { key: 'time', label: 't', value: fmtMetric(tr.time), unit: 's', severity: 'info' },
        );
      }
    } else if (s.mode === 'convection') {
      if (this.forced) {
        const f = this.forced;
        const corr = s.correlation === 'dittus-boelter' ? 'Dittus–Boelter' : 'Gnielinski';
        metrics.push(
          { key: 're', label: 'Re', value: fmtMetric(f.re), severity: 'info', hint: zh ? '管内湍流适用 Re ≳ 3000（Gnielinski）/ Re ≳ 1e4（D–B）' : 'turbulent duct: Re ≳ 3000 (Gnielinski) / ≳ 1e4 (D–B)' },
          { key: 'pr', label: 'Pr', value: fmtMetric(f.pr), severity: 'info' },
          { key: 'nu', label: `Nu (${corr})`, value: fmtMetric(f.nu), severity: 'ok' },
          { key: 'h', label: zh ? '对流系数 h' : 'Coefficient h', value: fmtMetric(f.h), unit: 'W/(m²·K)', severity: 'ok', hint: 'h = Nu·k/D' },
        );
      } else if (this.nat) {
        const n = this.nat;
        metrics.push(
          { key: 'ra', label: 'Ra', value: fmtMetric(n.ra), severity: 'info', hint: 'Ra = g·β·ΔT·L³/(ν·α)' },
          { key: 'nu', label: 'Nu (Churchill–Chu)', value: fmtMetric(n.nu), severity: 'ok' },
          { key: 'h', label: zh ? '对流系数 h' : 'Coefficient h', value: fmtMetric(n.h), unit: 'W/(m²·K)', severity: n.h > 0.5 && n.h < 50 ? 'ok' : 'warn', hint: zh ? '空气自然对流 h 通常在 1–15 W/(m²·K) 量级' : 'natural convection in air: h typically 1–15 W/(m²·K)' },
        );
      }
    } else if (s.mode === 'radiation') {
      if (this.bb) {
        const b = this.bb;
        metrics.push(
          { key: 'eb', label: zh ? '黑体总辐射力 E_b = σT⁴' : 'Blackbody emissive power σT⁴', value: fmtMetric(b.eb), unit: 'W/m²', severity: 'ok', hint: `σ = ${STEFAN_BOLTZMANN.toExponential(6)} W/(m²·K⁴)` },
          { key: 'lambda-max', label: zh ? 'Wien 峰值波长 λmax' : 'Wien peak λmax', value: fmtMetric(b.lambdaMax), unit: 'µm', severity: 'ok', hint: `λmax·T = ${WIEN_UM_K.toFixed(2)} µm·K` },
        );
      } else if (this.enc) {
        const e = this.enc;
        metrics.push(
          { key: 'f12', label: 'F₁₂', value: fmtMetric(e.f12), severity: 'ok', hint: s.vfGeom === 'parallel-plates' ? (zh ? '大平板 F₁₂ = 1（解析）' : 'large plates: F12 = 1 (analytic)') : zh ? '同轴圆盘 Incropora 表 13.1 解析式' : 'coaxial disks, Incropera Table 13.1' },
          { key: 'r-surf1', label: zh ? '表面热阻 R₁' : 'Surface resistance R₁', value: fmtMetric(e.rSurf1), unit: '1/W', severity: 'info', hint: '(1−ε₁)/(ε₁·A₁)' },
          { key: 'r-space', label: zh ? '空间热阻 R₁₂' : 'Space resistance R₁₂', value: fmtMetric(e.rSpace), unit: '1/W', severity: 'info', hint: '1/(A₁·F₁₂)' },
          { key: 'q-rad', label: zh ? '净辐射换热 q₁₂' : 'Net exchange q₁₂', value: fmtMetric(e.q), unit: 'W', severity: 'ok', hint: zh ? '灰体网络 q = σ(T₁⁴−T₂⁴)/ΣR' : 'gray network q = σ(T₁⁴−T₂⁴)/ΣR' },
        );
      } else if (this.comb) {
        const c = this.comb;
        metrics.push(
          { key: 'q-conv', label: zh ? '对流散热 q_conv' : 'Convection q_conv', value: fmtMetric(c.qConv), unit: 'W', severity: 'info' },
          { key: 'q-rad', label: zh ? '辐射散热 q_rad' : 'Radiation q_rad', value: fmtMetric(c.qRad), unit: 'W', severity: 'info' },
          { key: 'q-total', label: zh ? '复合总散热' : 'Total q_total', value: fmtMetric(c.qTotal), unit: 'W', severity: 'ok' },
          { key: 'h-rad', label: zh ? '线性化辐射系数 h_rad' : 'Linearized h_rad', value: fmtMetric(c.hRad), unit: 'W/(m²·K)', severity: 'info', hint: 'ε·σ·(Ts²+Tsur²)(Ts+Tsur)' },
          { key: 'h-total', label: zh ? '复合系数 h_total' : 'Combined h_total', value: fmtMetric(c.hTotal), unit: 'W/(m²·K)', severity: 'ok' },
        );
      }
    } else if (s.mode === 'exchanger') {
      if (this.exg) {
        const { eps, cross } = this.exg;
        if (cross) {
          metrics.push(
            { key: 'q', label: zh ? '传热量 q' : 'Heat duty q', value: fmtMetric(eps.q), unit: 'W', severity: 'ok', hint: 'q = ε·Cmin·(T_h,i − T_c,i)' },
            { key: 'epsilon', label: zh ? '效能 ε' : 'Effectiveness ε', value: fmtMetric(eps.epsilon), severity: 'ok' },
            { key: 'ntu', label: 'NTU', value: fmtMetric(eps.ntu), severity: 'info', hint: 'NTU = U·A/C_min' },
            { key: 'cr', label: 'C_r = Cmin/Cmax', value: fmtMetric(eps.cr), severity: 'info' },
            { key: 'dt-lm', label: 'ΔT_lm (LMTD)', value: fmtMetric(cross.dTlm), unit: 'K', severity: 'info' },
            { key: 'rel-diff', label: zh ? 'LMTD ↔ ε-NTU 互验偏差' : 'LMTD ↔ ε-NTU discrepancy', value: fmtMetric(cross.relDiff * 100), unit: '%', severity: cross.relDiff < 1e-3 ? 'ok' : 'warn', hint: zh ? '两种方法对顺/逆流数学等价，残差应为纯舍入' : 'the methods are mathematically equivalent for counter/parallel flow' },
          );
        } else {
          metrics.push(
            { key: 'q', label: zh ? '传热量 q' : 'Heat duty q', value: fmtMetric(eps.q), unit: 'W', severity: 'ok' },
            { key: 'epsilon', label: zh ? '效能 ε' : 'Effectiveness ε', value: fmtMetric(eps.epsilon), severity: 'ok', hint: this.exg.fNote },
            { key: 'ntu', label: 'NTU', value: fmtMetric(eps.ntu), severity: 'info' },
            { key: 'cr', label: 'C_r', value: fmtMetric(eps.cr), severity: 'info' },
          );
        }
        metrics.push(
          { key: 'th-out', label: 'T_h,out', value: fmtMetric(eps.thOut), unit: '°C', severity: 'info' },
          { key: 'tc-out', label: 'T_c,out', value: fmtMetric(eps.tcOut), unit: '°C', severity: 'info' },
        );
      }
    } else if (this.net) {
      const n = this.net;
      metrics.push(
        { key: 'q-total', label: zh ? '总热流 q_total' : 'Total heat flow', value: fmtMetric(n.qTotal), unit: 'W', severity: 'ok', hint: zh ? '热固定节点净流出' : 'net outflow of the hot fixed node' },
        { key: 'r-eq', label: zh ? '等效热阻 R_eq' : 'Equivalent R_eq', value: fmtMetric(n.rEquivalent), unit: 'K/W', severity: 'ok' },
        { key: 'kirchhoff', label: zh ? 'Kirchhoff 残差 max|Σq|' : 'Kirchhoff residual max|Σq|', value: fmtMetric(n.kirchhoffMax), unit: 'W', severity: n.kirchhoffMax < 1e-9 ? 'ok' : 'warn', hint: zh ? '自由节点电流定律校核' : 'current-law check at the free nodes' },
      );
      n.t.forEach((t, i) => {
        metrics.push({
          key: `t-node-${i}`,
          label: zh ? `节点 ${i} 温度` : `Node ${i} temperature`,
          value: fmtMetric(t),
          unit: '°C',
          severity: 'info',
          hint: Object.prototype.hasOwnProperty.call(this.state && { 0: 1 }, i) && (i === 0 || i === 4) ? (zh ? '固定温度节点' : 'fixed-temperature node') : zh ? '自由节点' : 'free node',
        });
      });
    }
    if (metrics.length > 0) setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- simulate / benchmarks --------------------------------------------------

  private runSimulation() {
    this.recompute();
    if (this.errorMsg) {
      notify(
        this.api,
        'error',
        `Computation failed: ${this.errorMsg}`,
        `计算失败：${this.errorMsg}`,
      );
      this.draw();
      return;
    }
    const zh = this.zh;
    const s = this.state;
    let msg = '';
    if (s.mode === 'conduction' && this.wall) {
      msg = zh
        ? `q = ${fmtMetric(this.wall.q)} W · R_total = ${fmtMetric(this.wall.rTotal)} K/W`
        : `q = ${fmtMetric(this.wall.q)} W · R_total = ${fmtMetric(this.wall.rTotal)} K/W`;
    } else if (s.mode === 'conduction' && this.sor) {
      msg = zh
        ? `SOR 收敛 ${this.sor.iterations} 次迭代 · q_in = ${fmtMetric(this.sor.qIn)} W/m`
        : `SOR converged in ${this.sor.iterations} iterations · q_in = ${fmtMetric(this.sor.qIn)} W/m`;
    } else if (s.mode === 'conduction' && this.tran) {
      msg = zh
        ? `r = ${fmtMetric(this.tran.courant)}（上限 ${FTCS_LIMIT}）· Fo = ${fmtMetric(this.tran.fourier)}`
        : `r = ${fmtMetric(this.tran.courant)} (ceiling ${FTCS_LIMIT}) · Fo = ${fmtMetric(this.tran.fourier)}`;
    } else if (s.mode === 'convection' && this.forced) {
      msg = `Nu = ${fmtMetric(this.forced.nu)} · h = ${fmtMetric(this.forced.h)} W/(m²·K)`;
    } else if (s.mode === 'convection' && this.nat) {
      msg = zh
        ? `Ra = ${fmtMetric(this.nat.ra)} · Nu = ${fmtMetric(this.nat.nu)} · h = ${fmtMetric(this.nat.h)} W/(m²·K)`
        : `Ra = ${fmtMetric(this.nat.ra)} · Nu = ${fmtMetric(this.nat.nu)} · h = ${fmtMetric(this.nat.h)} W/(m²·K)`;
    } else if (s.mode === 'radiation' && this.bb) {
      msg = `σT⁴ = ${fmtMetric(this.bb.eb)} W/m² · λmax = ${fmtMetric(this.bb.lambdaMax)} µm`;
    } else if (s.mode === 'radiation' && this.enc) {
      msg = `F₁₂ = ${fmtMetric(this.enc.f12)} · q₁₂ = ${fmtMetric(this.enc.q)} W`;
    } else if (s.mode === 'radiation' && this.comb) {
      msg = zh
        ? `q_total = ${fmtMetric(this.comb.qTotal)} W（对流 ${fmtMetric(this.comb.qConv)} · 辐射 ${fmtMetric(this.comb.qRad)}）`
        : `q_total = ${fmtMetric(this.comb.qTotal)} W (convection ${fmtMetric(this.comb.qConv)} · radiation ${fmtMetric(this.comb.qRad)})`;
    } else if (s.mode === 'exchanger' && this.exg) {
      msg = zh
        ? `q = ${fmtMetric(this.exg.eps.q)} W · ε = ${fmtMetric(this.exg.eps.epsilon)} · NTU = ${fmtMetric(this.exg.eps.ntu)}`
        : `q = ${fmtMetric(this.exg.eps.q)} W · ε = ${fmtMetric(this.exg.eps.epsilon)} · NTU = ${fmtMetric(this.exg.eps.ntu)}`;
      if (this.exg.cross) msg += zh ? ` · 双法偏差 ${fmtMetric(this.exg.cross.relDiff * 100)}%` : ` · cross-check ${fmtMetric(this.exg.cross.relDiff * 100)}%`;
    } else if (s.mode === 'network' && this.net) {
      msg = zh
        ? `q_total = ${fmtMetric(this.net.qTotal)} W · R_eq = ${fmtMetric(this.net.rEquivalent)} K/W · Kirchhoff 残差 ${fmtMetric(this.net.kirchhoffMax)} W`
        : `q_total = ${fmtMetric(this.net.qTotal)} W · R_eq = ${fmtMetric(this.net.rEquivalent)} K/W · Kirchhoff residual ${fmtMetric(this.net.kirchhoffMax)} W`;
    }
    notify(this.api, 'success', msg, msg);
    this.draw();
  }

  /** Embedded deterministic validation suite (mirrors tests/eng-heat.test.ts). */
  runBenchmarks() {
    const zh = this.zh;
    interface Bench { key: string; label: string; relErr: number | null; gate: number; detail: string }
    const benches: Bench[] = [];
    const push = (key: string, label: string, relErr: number | null, gate: number, detail: string): void => {
      benches.push({ key, label, relErr, gate, detail });
    };

    // 1. Composite wall vs the series-resistance closed form.
    const w1 = solveWall({ layers: [{ L: 0.1, k: 0.1 }], area: 1, tHot: 100, tCold: 0, hHot: 10, hCold: 10 });
    const q1ref = 100 / 1.2;
    push('wall', zh ? '复合壁热流（单层）' : 'Composite wall q (single layer)', Math.abs(w1.q - q1ref) / q1ref, 1e-9, `q = ${fmtMetric(w1.q)} W, reference ${fmtMetric(q1ref)} W`);
    const w2 = solveWall({ layers: [{ L: 0.1, k: 0.1 }, { L: 0.2, k: 0.5 }, { L: 0.05, k: 2 }], area: 2, tHot: 250, tCold: 20, hHot: 25, hCold: 40 });
    const r2ref = 1 / (25 * 2) + 0.1 / (0.1 * 2) + 0.2 / (0.5 * 2) + 0.05 / (2 * 2) + 1 / (40 * 2);
    const q2ref = (250 - 20) / r2ref;
    push('wall-multi', zh ? '复合壁热流（三层）' : 'Composite wall q (3 layers)', Math.abs(w2.q - q2ref) / q2ref, 1e-9, `q = ${fmtMetric(w2.q)} W, reference ${fmtMetric(q2ref)} W`);

    // 2. SOR vs separation of variables on the unit square.
    const sor = sorSolve2d({
      width: 1, height: 1, nx: 41, ny: 41, k: 1,
      left: { type: 'fixed', t: 0 }, right: { type: 'fixed', t: 0 }, bottom: { type: 'fixed', t: 0 },
      top: { type: 'fixed', t: 0, profile: (u) => Math.sin(Math.PI * u) },
      tolerance: 1e-9, maxIter: 30000,
    });
    let sorWorst = 0;
    for (let iy = 1; iy < sor.ny - 1; iy += 1) {
      for (let ix = 1; ix < sor.nx - 1; ix += 1) {
        const exact = separationOfVariablesRect(1, 1, ix / (sor.nx - 1), iy / (sor.ny - 1));
        if (Math.abs(exact) < 0.05) continue;
        sorWorst = Math.max(sorWorst, Math.abs(sor.T[iy * sor.nx + ix]! - exact) / Math.abs(exact));
      }
    }
    push('sor', zh ? 'SOR 场 vs 分离变量级数' : 'SOR field vs separation of variables', sorWorst, 0.005, `${sor.iterations} iterations, ω = ${fmtMetric(sor.omega)}`);

    // 3. FTCS stability gate + transient accuracy.
    let gate1d = false;
    try {
      ftcsRun({ dim: '1d', alpha: 1, length: 1, n: 101, dt: 5.1e-4, tHot: 0, tCold: 0, tInitial: 1, steps: 5 });
    } catch {
      gate1d = true;
    }
    let gate2d = false;
    try {
      ftcsRun({ dim: '2d', alpha: 1, length: 1, height: 1, n: 41, dt: 1.9e-4, tHot: 0, tCold: 0, tInitial: 1, steps: 5 });
    } catch {
      gate2d = true;
    }
    push('ftcs-gate-1d', zh ? 'FTCS 一维越界检测 (r>1/2)' : 'FTCS 1-D gate (r > 1/2)', gate1d ? 0 : 1, 0.5, gate1d ? (zh ? '正确抛出稳定性异常' : 'correctly rejected') : zh ? '未检测到越界' : 'violation NOT detected');
    push('ftcs-gate-2d', zh ? 'FTCS 二维越界检测 (Σr>1/2)' : 'FTCS 2-D gate (Σr > 1/2)', gate2d ? 0 : 1, 0.5, gate2d ? (zh ? '正确抛出稳定性异常' : 'correctly rejected') : zh ? '未检测到越界' : 'violation NOT detected');
    const ft = ftcsRun({ dim: '1d', alpha: 1, length: 1, n: 101, dt: 4e-4, tHot: 0, tCold: 0, tInitial: 1, steps: 1250 });
    let ftWorst = 0;
    for (let i = 1; i < ft.nx - 1; i += 1) {
      const exact = slabTransientSeries(i / (ft.nx - 1), 1, 1, ft.time, 1, 0);
      const theta = Math.abs(ft.T[i]!);
      if (theta < 0.05) continue;
      ftWorst = Math.max(ftWorst, Math.abs(ft.T[i]! - exact) / theta);
    }
    push('ftcs-transient', zh ? 'FTCS 瞬态 vs 傅里叶级数' : 'FTCS transient vs Fourier series', ftWorst, 0.01, `Fo = ${fmtMetric(ft.fourier)}, r = ${fmtMetric(ft.courant)}`);

    // 4. Forced-convection correlations.
    const dbRef = 0.023 * Math.pow(1e4, 0.8) * Math.pow(5, 0.4);
    const db = nusseltDittusBoelter(1e4, 5, true);
    push('dittus-boelter', 'Dittus–Boelter Nu', Math.abs(db - dbRef) / dbRef, 1e-9, `Nu = ${fmtMetric(db)} @ Re=1e4, Pr=5`);
    const fRef = Math.pow(0.79 * Math.log(1e4) - 1.64, -2);
    const gnRef = ((fRef / 8) * (1e4 - 1000) * 5) / (1 + 12.7 * Math.sqrt(fRef / 8) * (Math.pow(5, 2 / 3) - 1));
    const gn = nusseltGnielinski(1e4, 5);
    push('gnielinski', 'Gnielinski Nu', Math.abs(gn - gnRef) / gnRef, 1e-9, `Nu = ${fmtMetric(gn)} @ Re=1e4, Pr=5`);
    push('forced-mutual', zh ? 'D–B ↔ Gnielinski 互检' : 'D–B ↔ Gnielinski cross-check', Math.abs(gn - db) / db, 0.01, zh ? '两关联式在 Re=1e4、Pr=5 处应在 1% 内一致' : 'the correlations must agree within 1% at Re=1e4, Pr=5');

    // 5. Natural convection plausibility + Rayleigh closed form.
    const natIn = { geometry: 'vertical-plate' as const, pr: 0.7, nu: 1.6e-5, alpha: 2.25e-5, beta: 1 / 300, length: 0.3, dT: 20, k: 0.026 };
    const nat = nusseltNatural(natIn);
    const raRef = (9.80665 * (1 / 300) * 20 * Math.pow(0.3, 3)) / (1.6e-5 * 2.25e-5);
    push('rayleigh', 'Rayleigh number', Math.abs(nat.ra - raRef) / raRef, 1e-9, `Ra = ${fmtMetric(nat.ra)}`);
    const hOk = nat.h > 2 && nat.h < 15;
    push('churchill-chu', zh ? 'Churchill–Chu 竖壁 h 区间' : 'Churchill–Chu plate h range', hOk ? 0 : 1, 0.5, `h = ${fmtMetric(nat.h)} W/(m²·K)` + (zh ? '（空气合理区间 2–15）' : ' (air band 2–15)'));

    // 6. Blackbody + Wien + Planck integral.
    const eb = blackbodyEmittance(300);
    const ebRef = STEFAN_BOLTZMANN * Math.pow(300, 4);
    push('stefan-boltzmann', 'σ·T⁴', Math.abs(eb - ebRef) / ebRef, 1e-12, `E_b(300 K) = ${fmtMetric(eb)} W/m²`);
    const wien = wienPeakWavelength(5800) * 5800;
    push('wien', zh ? 'Wien 位移 λmax·T' : 'Wien λmax·T', Math.abs(wien - WIEN_UM_K) / WIEN_UM_K, 1e-12, `${fmtMetric(wien)} µm·K`);
    // Simpson integral of the Planck curve vs σT⁴.
    const tK = 300;
    const nSimp = 4000;
    const lamLo = 0.2;
    const lamHi = 300;
    const hStep = (lamHi - lamLo) / nSimp;
    let simp = planckSpectral(lamLo, tK) + planckSpectral(lamHi, tK);
    for (let i = 1; i < nSimp; i += 1) {
      simp += planckSpectral(lamLo + i * hStep, tK) * (i % 2 === 1 ? 4 : 2);
    }
    const integral = (simp * hStep) / 3;
    push('planck-integral', zh ? '普朗克谱积分 vs σT⁴' : 'Planck integral vs σT⁴', Math.abs(integral - ebRef) / ebRef, 0.005, `∫E_λdλ = ${fmtMetric(integral)} W/m² over [0.2, 300] µm`);

    // 7. View factors.
    const fPlates = viewFactor({ geometry: 'parallel-plates' });
    push('f-plates', zh ? '平行板 F₁₂ = 1' : 'Parallel plates F12 = 1', Math.abs(fPlates - 1), 1e-12, `F₁₂ = ${fmtMetric(fPlates)}`);
    const fDisk = viewFactor({ geometry: 'coaxial-disks', r1: 0.2, r2: 0.2, separation: 0.2 });
    const fDiskRef = (3 - Math.sqrt(5)) / 2;
    push('f-disks', zh ? '同轴圆盘 F₁₂（R=1）' : 'Coaxial disks F12 (R=1)', Math.abs(fDisk - fDiskRef) / fDiskRef, 1e-9, `F₁₂ = ${fmtMetric(fDisk)}, reference ${fmtMetric(fDiskRef)}`);
    const f12 = viewFactor({ geometry: 'coaxial-disks', r1: 0.1, r2: 0.3, separation: 0.2 });
    const f21 = viewFactor({ geometry: 'coaxial-disks', r1: 0.3, r2: 0.1, separation: 0.2 });
    const recLhs = Math.PI * 0.1 * 0.1 * f12;
    const recRhs = Math.PI * 0.3 * 0.3 * f21;
    push('f-reciprocity', zh ? '视角系数互换性 A₁F₁₂ = A₂F₂₁' : 'View-factor reciprocity A1F12 = A2F21', Math.abs(recLhs - recRhs) / recLhs, 1e-9, `A₁F₁₂ = ${fmtMetric(recLhs)} m², A₂F₂₁ = ${fmtMetric(recRhs)} m²`);
    const enc = enclosureExchange({ geometry: 'parallel-plates', t1: 800, t2: 300, eps1: 0.8, eps2: 0.5, area1: 2, area2: 2 });
    const encRef = (STEFAN_BOLTZMANN * (Math.pow(800, 4) - Math.pow(300, 4))) / (1 / 0.8 + 1 / 0.5 - 1) / 2;
    // Note: two infinite plates per unit area → divide the network result by A = 2.
    push('enclosure', zh ? '封闭腔 vs 无限平板闭式' : 'Enclosure vs infinite-plate closed form', Math.abs(enc.q - encRef) / Math.abs(encRef), 1e-9, `q = ${fmtMetric(enc.q)} W, reference ${fmtMetric(encRef)} W`);

    // 8. LMTD ↔ ε-NTU cross-validation.
    let crossWorst = 0;
    for (const arrangement of ['counter', 'parallel'] as const) {
      for (const cr of [0.25, 0.5, 0.75, 1]) {
        for (const ntu of [0.5, 1, 2, 4]) {
          const cmin = 400;
          const cmax = cmin / cr;
          const [ch, cc] = arrangement === 'counter' && cr === 1 ? [cmin, cmax] : cmin === 400 ? [cmin, cmax] : [cmax, cmin];
          const cv = crossValidateMethods({ arrangement, thIn: 150, tcIn: 30, ch, cc, ua: ntu * cmin });
          crossWorst = Math.max(crossWorst, cv.relDiff);
        }
      }
      // Phase-change limit Cr → 0.
      const cv0 = crossValidateMethods({ arrangement, thIn: 150, tcIn: 30, ch: 400, cc: 4e8, ua: 800 });
      crossWorst = Math.max(crossWorst, cv0.relDiff);
    }
    push('lmtd-eps-ntu', zh ? 'LMTD ↔ ε-NTU 互验' : 'LMTD ↔ ε-NTU cross-validation', crossWorst, 0.001, zh ? '顺/逆流两法数学等价，残差纯舍入' : 'mathematically equivalent for counter/parallel flow');

    // 9. Resistance network vs analytic + Kirchhoff.
    const net = solveNetwork({
      nNodes: 5,
      fixed: { 0: 100, 4: 0 },
      edges: [
        { from: 0, to: 1, r: 1 },
        { from: 1, to: 2, r: 2 },
        { from: 2, to: 3, r: 2 },
        { from: 3, to: 4, r: 4 },
        { from: 1, to: 3, r: 3 },
      ],
    });
    const qRef = 700 / 47;
    const tRef = [100, 4000 / 47, 3400 / 47, 2800 / 47, 0];
    let netWorst = 0;
    for (let i = 0; i < 5; i += 1) netWorst = Math.max(netWorst, Math.abs(net.t[i]! - tRef[i]!));
    const netRel = netWorst / Math.max(1, Math.abs(qRef) * 1);
    push('network', zh ? '热阻网络 vs 解析 + Kirchhoff' : 'Network vs analytic + Kirchhoff', Math.max(netRel, net.kirchhoffMax / Math.abs(qRef)), 1e-9, `q = ${fmtMetric(net.qTotal)} W (ref ${fmtMetric(qRef)}), max|Σq| = ${fmtMetric(net.kirchhoffMax)} W`);

    const metrics: ScienceMetric[] = benches.map((b) => {
      const value = b.relErr === null ? '—' : fmtMetric(b.relErr * 100, 3);
      const pass = b.relErr === null ? false : b.gate === 0.5 ? b.relErr < 0.5 : b.relErr < b.gate;
      const severity: ScienceSeverity = pass ? 'ok' : 'warn';
      const gateTxt = b.gate === 0.5 ? (zh ? '要求：通过/失败' : 'gate: pass/fail') : `${zh ? '门槛' : 'gate'} ${b.gate >= 0.01 ? `${b.gate * 100}%` : b.gate.toExponential(0)}`;
      return { key: `bench-${b.key}`, label: b.label, value, unit: b.gate === 0.5 ? undefined : '%', severity, hint: `${b.detail} · ${gateTxt}` };
    });
    const failed = metrics.filter((m) => m.severity !== 'ok').length;
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed === 0 ? 'success' : 'warning',
      `Benchmarks: ${benches.length - failed}/${benches.length} passed.`,
      `基准验证：${benches.length - failed}/${benches.length} 项通过。`,
    );
    this.draw();
  }

  // __PART3__

}

export default function createEngHeatPlugin(): Plugin {
  return new EngHeatPlugin();
}
