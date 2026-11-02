// ==========================================================================
// eng-heat — heat transfer analysis workbench
//
// Five modes driven by a `mode` select (all mode-dependent params use
// visibleWhen):
//   conduction — 2-D FD temperature field as a canvas heatmap with marching
//                squares isotherms + colorbar; steady max/min T, convergence
//                residual, iterations and the stability gate in the footer;
//   convection — h vs characteristic-length curve with the operating point;
//   radiation  — Planck spectral curve with the Wien peak marker;
//   exchanger  — hot/cold axial temperature profiles;
//   resistance — resistance ladder with node temperatures.
// "Simulate" publishes the scientific outputs of the active mode. compute()
// is headless for Block/Flow: CSV/JSON parameter rows in, analyzed table +
// metrics out. Academic low-saturation palette, no emoji, bilingual labels.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, ComputeResult } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportCanvasPng,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import {
  clearScienceOutputs,
  fmtMetric,
  setScienceOutputs,
  type ScienceMetric,
} from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { engHeatManifest } from './manifest';
import { heatFigurePanels, type HeatFigurePayload } from './figure';
import {
  FLUID_PRESETS,
  type ConductionParams,
  type ConductionResult,
  type ConvGeometry,
  type ConvectionResult,
  type EdgeKind,
  type EdgeSpec,
  type ExArrangement,
  type ExchangerResult,
  type FluidProps,
  type HeatRowMode,
  type ProfilePoint,
  type RadiationResult,
  type ResistanceResult,
  type SpectralPoint,
  exchangerProfiles,
  marchingSquares,
  parseHeatInput,
  parseLayerSpec,
  planckSweep,
  solveConduction,
  solveConvection,
  solveExchanger,
  solveRadiation,
  solveResistance,
  wienPeakWavelength,
} from './kernel';

export { engHeatManifest } from './manifest';

type Mode = 'conduction' | 'convection' | 'radiation' | 'exchanger' | 'resistance';
const MODES: Mode[] = ['conduction', 'convection', 'radiation', 'exchanger', 'resistance'];
const EDGE_KINDS: EdgeKind[] = ['dirichlet', 'insulated', 'convection'];
const CONV_GEOMS: ConvGeometry[] = ['plate', 'tube', 'vplate'];
const FLUIDS = ['air', 'water', 'oil'] as const;
const EX_ARRANGEMENTS: ExArrangement[] = ['counter', 'parallel', 'cross'];

interface State {
  mode: Mode;
  // conduction
  scheme: 'explicit' | 'adi';
  runMode: 'steady' | 'transient';
  plateW: number;
  plateH: number;
  nx: number;
  ny: number;
  alpha: number;
  kCond: number;
  edgeL: EdgeKind;
  edgeR: EdgeKind;
  edgeT: EdgeKind;
  edgeB: EdgeKind;
  tL: number;
  tR: number;
  tT: number;
  tB: number;
  hConv: number;
  tInf: number;
  hsOn: boolean;
  hsX: number;
  hsY: number;
  hsR: number;
  hsQ: number;
  tEnd: number;
  dt: number;
  // convection
  convGeom: ConvGeometry;
  fluidPreset: 'air' | 'water' | 'oil';
  u: number;
  len: number;
  tSurf: number;
  tInfC: number;
  // radiation
  radT1: number;
  radT2: number;
  eps1: number;
  eps2: number;
  radGeom: 'disks' | 'rects' | 'none';
  r1: number;
  r2: number;
  gap: number;
  rectA: number;
  rectB: number;
  rectC: number;
  specT: number;
  // exchanger
  exArr: ExArrangement;
  thIn: number;
  thOut: number;
  tcIn: number;
  tcOut: number;
  ch: number;
  cc: number;
  ua: number;
  // resistance
  resA: number;
  resDT: number;
  hOut: number;
  hIn: number;
  layerSpec: string;
  parK: number;
  parF: number;
}

const DEFAULT_STATE: State = {
  mode: 'conduction',
  scheme: 'adi',
  runMode: 'steady',
  plateW: 0.2,
  plateH: 0.2,
  nx: 64,
  ny: 64,
  alpha: 1.3e-5,
  kCond: 50,
  edgeL: 'dirichlet',
  edgeR: 'dirichlet',
  edgeT: 'insulated',
  edgeB: 'insulated',
  tL: 373,
  tR: 293,
  tT: 300,
  tB: 300,
  hConv: 10,
  tInf: 300,
  hsOn: false,
  hsX: 0.5,
  hsY: 0.5,
  hsR: 0.12,
  hsQ: 2e5,
  tEnd: 20,
  dt: 0,
  convGeom: 'vplate',
  fluidPreset: 'air',
  u: 1.5,
  len: 0.3,
  tSurf: 320,
  tInfC: 300,
  radT1: 800,
  radT2: 300,
  eps1: 0.8,
  eps2: 0.9,
  radGeom: 'disks',
  r1: 0.1,
  r2: 0.1,
  gap: 0.1,
  rectA: 0.5,
  rectB: 0.5,
  rectC: 0.2,
  specT: 5778,
  exArr: 'counter',
  thIn: 380,
  thOut: 344.4,
  tcIn: 300,
  tcOut: 335.6,
  ch: 1000,
  cc: 1000,
  ua: 800,
  resA: 1,
  resDT: 40,
  hOut: 10,
  hIn: 0,
  layerSpec: '0.02:1.5,0.1:0.04,0.012:0.16',
  parK: 0,
  parF: 0.2,
};

/** Analysis products for the active mode (null until recomputed). */
interface Products {
  cond: ConductionResult | null;
  condParams: ConductionParams | null;
  conv: ConvectionResult | null;
  convSweep: Array<{ L: number; h: number }> | null;
  /** Reference sweep at a fixed u_ref = 1 m/s, drawn as a dashed ghost curve
   *  so the effect of the velocity slider stays visible despite y auto-scaling. */
  convRefSweep: Array<{ L: number; h: number }> | null;
  rad: RadiationResult | null;
  spectrum: SpectralPoint[] | null;
  ex: ExchangerResult | null;
  profiles: ProfilePoint[] | null;
  res: ResistanceResult | null;
  error: string | null;
}

interface Rect { x: number; y: number; w: number; h: number }

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Low-saturation thermal ramp: deep blue -> teal -> sage -> sand -> brick. */
const HEAT_STOPS: Array<[number, number, number]> = [
  [38, 58, 84],
  [64, 118, 138],
  [128, 158, 140],
  [206, 178, 122],
  [186, 104, 82],
];

function heatColor(t: number): string {
  const s = clamp(t, 0, 1) * (HEAT_STOPS.length - 1);
  const i = Math.min(HEAT_STOPS.length - 2, Math.floor(s));
  const f = s - i;
  const a = HEAT_STOPS[i]!;
  const b = HEAT_STOPS[i + 1]!;
  return `rgb(${Math.round(a[0] + f * (b[0] - a[0]))},${Math.round(a[1] + f * (b[1] - a[1]))},${Math.round(a[2] + f * (b[2] - a[2]))})`;
}

/** Tick values for a linear axis (nice 1/2/5 steps). */
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

/** Axes frame with in-frame title, x label (below right) and rotated y label. */
function drawFrame(g: CanvasRenderingContext2D, r: Rect, title: string, xLabel: string, yLabel: string, showX: boolean, zh: boolean): void {
  g.strokeStyle = 'rgba(120,140,165,0.55)';
  g.lineWidth = 1;
  g.strokeRect(r.x, r.y, r.w, r.h);
  g.fillStyle = 'rgba(230,238,248,0.95)';
  g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(title, r.x + 6, r.y + 14);
  g.font = '10px Consolas, monospace';
  if (showX) {
    g.fillStyle = 'rgba(160,175,195,0.9)';
    g.textAlign = 'right';
    g.fillText(xLabel, r.x + r.w, r.y + r.h + 13);
  }
  g.save();
  g.translate(r.x - 8, r.y + r.h / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.fillStyle = 'rgba(160,175,195,0.9)';
  g.fillText(yLabel, 0, 0);
  g.restore();
}

export class EngHeatPlugin implements Plugin {
  readonly manifest = engHeatManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = { ...DEFAULT_STATE };
  private products: Products = {
    cond: null, condParams: null, conv: null, convSweep: null, convRefSweep: null,
    rad: null, spectrum: null, ex: null, profiles: null, res: null, error: null,
  };
  /** Cached offscreen heatmap (rebuilt only when the grid size changes). */
  private heatCv: HTMLCanvasElement | null = null;
  private heatNx = 0;
  private heatNy = 0;

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
    this.heatCv = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  // ---- parameters ----------------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    const zh = this.zh;
    const modeIn = (...ms: Mode[]) => ({ key: 'mode', in: ms }) as ParamDefinition['visibleWhen'];
    const rng = (key: keyof State & string, en: string, cn: string, min: number, max: number, step: number, vis: ParamDefinition['visibleWhen'], hintEn?: string, hintZh?: string): ParamDefinition => ({
      key, label: en, labelI18n: { 'zh-CN': cn, 'en-US': en },
      type: 'range', min, max, step, value: s[key] as number,
      hint: hintEn ? (zh ? hintZh ?? hintEn : hintEn) : undefined,
      visibleWhen: vis,
    });
    const cond = (...ms: Mode[]): ParamDefinition['visibleWhen'] => modeIn(...ms);
    const sel = (key: keyof State & string, en: string, cn: string, options: Array<{ value: string; en: string; cn: string }>, vis?: ParamDefinition['visibleWhen']): ParamDefinition => ({
      key, label: en, labelI18n: { 'zh-CN': cn, 'en-US': en },
      type: 'select',
      options: options.map((o) => ({ value: o.value, label: zh ? o.cn : o.en, labelI18n: { 'zh-CN': o.cn, 'en-US': o.en } })),
      value: s[key] as string,
      visibleWhen: vis,
    });

    return [
      sel('mode', 'Mode', '模式', [
        { value: 'conduction', en: '2-D conduction', cn: '二维导热' },
        { value: 'convection', en: 'Convection correlations', cn: '对流换热关联式' },
        { value: 'radiation', en: 'Radiation', cn: '辐射换热' },
        { value: 'exchanger', en: 'Heat exchanger', cn: '换热器' },
        { value: 'resistance', en: 'Thermal resistance wall', cn: '热阻网络壁' },
      ]),
      // ---- conduction ----
      sel('scheme', 'FD scheme', '差分格式', [
        { value: 'adi', en: 'ADI (Peaceman-Rachford)', cn: 'ADI（交替方向隐式）' },
        { value: 'explicit', en: 'Explicit FTCS', cn: '显式 FTCS' },
      ], cond('conduction')),
      sel('runMode', 'Run', '运行方式', [
        { value: 'steady', en: 'Steady state', cn: '稳态' },
        { value: 'transient', en: 'Transient to t_end', cn: '瞬态至 t_end' },
      ], cond('conduction')),
      rng('plateW', 'Plate W (m)', '板宽 W (m)', 0.02, 2, 0.01, cond('conduction')),
      rng('plateH', 'Plate H (m)', '板高 H (m)', 0.02, 2, 0.01, cond('conduction')),
      rng('nx', 'Nodes nx', '节点数 nx', 8, 128, 1, cond('conduction')),
      rng('ny', 'Nodes ny', '节点数 ny', 8, 128, 1, cond('conduction')),
      rng('alpha', 'alpha (m2/s)', '热扩散率 alpha (m²/s)', 1e-7, 1e-3, 1e-7, cond('conduction'), 'k/(rho c)', 'k/(ρc)'),
      rng('kCond', 'k (W/mK)', '导热系数 k (W/m·K)', 0.05, 400, 0.05, cond('conduction')),
      sel('edgeL', 'Left edge', '左边界', [
        { value: 'dirichlet', en: 'Dirichlet T', cn: '定温 Dirichlet' },
        { value: 'insulated', en: 'Insulated', cn: '绝热' },
        { value: 'convection', en: 'Convection h', cn: '对流 h' },
      ], cond('conduction')),
      sel('edgeR', 'Right edge', '右边界', [
        { value: 'dirichlet', en: 'Dirichlet T', cn: '定温 Dirichlet' },
        { value: 'insulated', en: 'Insulated', cn: '绝热' },
        { value: 'convection', en: 'Convection h', cn: '对流 h' },
      ], cond('conduction')),
      sel('edgeT', 'Top edge', '上边界', [
        { value: 'dirichlet', en: 'Dirichlet T', cn: '定温 Dirichlet' },
        { value: 'insulated', en: 'Insulated', cn: '绝热' },
        { value: 'convection', en: 'Convection h', cn: '对流 h' },
      ], cond('conduction')),
      sel('edgeB', 'Bottom edge', '下边界', [
        { value: 'dirichlet', en: 'Dirichlet T', cn: '定温 Dirichlet' },
        { value: 'insulated', en: 'Insulated', cn: '绝热' },
        { value: 'convection', en: 'Convection h', cn: '对流 h' },
      ], cond('conduction')),
      {
        key: 'tL', label: 'T_left (K)', labelI18n: { 'zh-CN': '左边界温度 (K)', 'en-US': 'T_left (K)' },
        type: 'range', min: 1, max: 2000, step: 1, value: s.tL,
        visibleWhen: { all: [{ key: 'mode', in: ['conduction'] }, { key: 'edgeL', in: ['dirichlet'] }] },
      },
      {
        key: 'tR', label: 'T_right (K)', labelI18n: { 'zh-CN': '右边界温度 (K)', 'en-US': 'T_right (K)' },
        type: 'range', min: 1, max: 2000, step: 1, value: s.tR,
        visibleWhen: { all: [{ key: 'mode', in: ['conduction'] }, { key: 'edgeR', in: ['dirichlet'] }] },
      },
      {
        key: 'tT', label: 'T_top (K)', labelI18n: { 'zh-CN': '上边界温度 (K)', 'en-US': 'T_top (K)' },
        type: 'range', min: 1, max: 2000, step: 1, value: s.tT,
        visibleWhen: { all: [{ key: 'mode', in: ['conduction'] }, { key: 'edgeT', in: ['dirichlet'] }] },
      },
      {
        key: 'tB', label: 'T_bottom (K)', labelI18n: { 'zh-CN': '下边界温度 (K)', 'en-US': 'T_bottom (K)' },
        type: 'range', min: 1, max: 2000, step: 1, value: s.tB,
        visibleWhen: { all: [{ key: 'mode', in: ['conduction'] }, { key: 'edgeB', in: ['dirichlet'] }] },
      },
      {
        key: 'hConv', label: 'h_film (W/m2K)', labelI18n: { 'zh-CN': '对流膜系数 h (W/m²·K)', 'en-US': 'Film h (W/m2K)' },
        type: 'range', min: 1, max: 1000, step: 1, value: s.hConv,
        visibleWhen: {
          all: [
            { key: 'mode', in: ['conduction'] },
            [{ key: 'edgeL', in: ['convection'] }, { key: 'edgeR', in: ['convection'] },
             { key: 'edgeT', in: ['convection'] }, { key: 'edgeB', in: ['convection'] }],
          ],
        },
      },
      {
        key: 'tInf', label: 'T_ambient (K)', labelI18n: { 'zh-CN': '环境温度 (K)', 'en-US': 'Ambient T (K)' },
        type: 'range', min: 1, max: 2000, step: 1, value: s.tInf,
        visibleWhen: {
          all: [
            { key: 'mode', in: ['conduction'] },
            [{ key: 'edgeL', in: ['convection'] }, { key: 'edgeR', in: ['convection'] },
             { key: 'edgeT', in: ['convection'] }, { key: 'edgeB', in: ['convection'] }],
          ],
        },
      },
      {
        key: 'hsOn', label: 'Hot-spot source', labelI18n: { 'zh-CN': '热点源', 'en-US': 'Hot-spot source' },
        type: 'checkbox', value: s.hsOn, visibleWhen: cond('conduction'),
      },
      rng('hsX', 'Spot x (0-1)', '热点 x (0-1)', 0, 1, 0.01, cond('conduction')),
      rng('hsY', 'Spot y (0-1)', '热点 y (0-1)', 0, 1, 0.01, cond('conduction')),
      rng('hsR', 'Spot radius (0-0.5)', '热点半径 (0-0.5)', 0.01, 0.5, 0.01, cond('conduction')),
      rng('hsQ', 'q_source (W/m3)', '体积热源 q (W/m³)', 0, 5e6, 1e3, cond('conduction')),
      rng('tEnd', 't_end (s)', '终止时间 t_end (s)', 0.1, 600, 0.1, cond('conduction')),
      rng('dt', 'dt (s, 0=auto)', '时间步长 dt（0=自动）', 0, 5, 0.001, cond('conduction'), '0 = stability-limited', '0 = 按稳定性上限'),
      // ---- convection ----
      sel('convGeom', 'Geometry', '几何', [
        { value: 'plate', en: 'Forced flat plate', cn: '外掠平板（受迫）' },
        { value: 'tube', en: 'Forced internal tube', cn: '管内受迫' },
        { value: 'vplate', en: 'Natural vertical plate', cn: '竖壁自然对流' },
      ], cond('convection')),
      sel('fluidPreset', 'Fluid (~300 K)', '流体（约 300 K 物性）', [
        { value: 'air', en: 'Air', cn: '空气' },
        { value: 'water', en: 'Water', cn: '水' },
        { value: 'oil', en: 'Engine oil', cn: '机油' },
      ], cond('convection')),
      rng('u', 'Velocity u (m/s)', '流速 u (m/s)', 0.05, 50, 0.05, cond('convection')),
      rng('len', 'Char. length L/D (m)', '特征长度 L/D (m)', 0.005, 2, 0.005, cond('convection')),
      rng('tSurf', 'T_surface (K)', '表面温度 (K)', 1, 1500, 1, cond('convection')),
      rng('tInfC', 'T_fluid (K)', '流体温度 (K)', 1, 1500, 1, cond('convection')),
      // ---- radiation ----
      rng('radT1', 'T1 (K)', '表面 1 温度 T1 (K)', 1, 3000, 1, cond('radiation')),
      rng('radT2', 'T2 (K)', '表面 2 温度 T2 (K)', 1, 3000, 1, cond('radiation')),
      rng('eps1', 'Emissivity eps1', '发射率 eps1', 0.01, 1, 0.01, cond('radiation')),
      rng('eps2', 'Emissivity eps2', '发射率 eps2', 0.01, 1, 0.01, cond('radiation')),
      sel('radGeom', 'View-factor geometry', '角系数几何', [
        { value: 'disks', en: 'Coaxial disks', cn: '同轴圆盘' },
        { value: 'rects', en: 'Aligned rectangles', cn: '对齐矩形' },
        { value: 'none', en: 'F12 = 1 (large plates)', cn: 'F12 = 1（大平板）' },
      ], cond('radiation')),
      rng('r1', 'Disk r1 (m)', '圆盘半径 r1 (m)', 0.005, 2, 0.005, cond('radiation')),
      rng('r2', 'Disk r2 (m)', '圆盘半径 r2 (m)', 0.005, 2, 0.005, cond('radiation')),
      rng('gap', 'Separation L (m)', '间距 L (m)', 0.005, 2, 0.005, cond('radiation')),
      rng('rectA', 'Plate a (m)', '板边长 a (m)', 0.01, 5, 0.01, cond('radiation')),
      rng('rectB', 'Plate b (m)', '板边长 b (m)', 0.01, 5, 0.01, cond('radiation')),
      rng('rectC', 'Separation c (m)', '间距 c (m)', 0.005, 5, 0.005, cond('radiation')),
      rng('specT', 'Spectrum T (K)', '光谱温度 (K)', 100, 6000, 10, cond('radiation'), 'Planck curve temperature', '普朗克曲线温度'),
      // ---- exchanger ----
      sel('exArr', 'Arrangement', '流动布置', [
        { value: 'counter', en: 'Counterflow', cn: '逆流' },
        { value: 'parallel', en: 'Parallel flow', cn: '顺流' },
        { value: 'cross', en: 'Cross (both unmixed)', cn: '错流（均不混合）' },
      ], cond('exchanger')),
      rng('thIn', 'T_h,in (K)', '热流进口温度 (K)', 200, 1000, 1, cond('exchanger')),
      rng('tcIn', 'T_c,in (K)', '冷流进口温度 (K)', 200, 900, 1, cond('exchanger')),
      rng('ch', 'C_h (W/K)', '热流热容流率 C_h (W/K)', 10, 10000, 10, cond('exchanger')),
      rng('cc', 'C_c (W/K)', '冷流热容流率 C_c (W/K)', 10, 10000, 10, cond('exchanger')),
      rng('ua', 'UA (W/K)', '总传热系数 UA (W/K)', 10, 10000, 10, cond('exchanger')),
      rng('thOut', 'Declared T_h,out (K)', '名义热流出口温度 (K)', 200, 1000, 0.1, cond('exchanger'), 'for the energy-balance check', '用于能量平衡校核'),
      rng('tcOut', 'Declared T_c,out (K)', '名义冷流出口温度 (K)', 200, 1000, 0.1, cond('exchanger'), 'for the energy-balance check', '用于能量平衡校核'),
      // ---- resistance ----
      rng('resA', 'Area A (m2)', '面积 A (m²)', 0.01, 100, 0.01, cond('resistance')),
      rng('resDT', 'T_hot - T_cold (K)', '总温差 (K)', 1, 500, 1, cond('resistance')),
      rng('hOut', 'h_out (0=off)', '外侧 h（0=关）', 0, 200, 1, cond('resistance')),
      rng('hIn', 'h_in (0=off)', '内侧 h（0=关）', 0, 200, 1, cond('resistance')),
      {
        key: 'layerSpec', label: 'Layers t:k[,..]', labelI18n: { 'zh-CN': '层序列 厚:k[,..]', 'en-US': 'Layers t:k[,..]' },
        type: 'text', value: s.layerSpec,
        hint: zh ? '热侧在前，如 0.02:1.5,0.1:0.04' : 'hot side first, e.g. 0.02:1.5,0.1:0.04',
        visibleWhen: cond('resistance'),
      },
      rng('parK', 'Parallel k (0=off)', '并联层 k（0=关）', 0, 400, 1, cond('resistance'), 'framed-wall stud path', '框架墙肋路径'),
      rng('parF', 'Parallel fraction f', '并联面积占比 f', 0, 0.9, 0.01, cond('resistance')),
      actionButton('simulate', 'Simulate', '仿真', 'primary'),
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
      actionButton('exportPng', 'Export PNG', '导出 PNG'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    let changed = false;
    const num = (k: keyof State & string, lo: number, hi: number): void => {
      const v = params[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      const c = clamp(v, lo, hi);
      if (s[k] !== c) {
        (s as unknown as Record<string, number>)[k] = c;
        changed = true;
      }
    };
    const opt = <K extends keyof State>(k: K, allowed: readonly string[]): void => {
      const v = params[k as string];
      if (typeof v === 'string' && allowed.includes(v) && s[k] !== v) {
        (s as unknown as Record<string, string>)[k as string] = v;
        changed = true;
      }
    };
    const bool = (k: keyof State & string): void => {
      const v = params[k];
      if (typeof v === 'boolean' && s[k] !== v) {
        (s as unknown as Record<string, boolean>)[k] = v;
        changed = true;
      }
    };
    opt('mode', MODES);
    // conduction
    opt('scheme', ['explicit', 'adi']);
    opt('runMode', ['steady', 'transient']);
    num('plateW', 0.02, 2); num('plateH', 0.02, 2);
    num('nx', 8, 128); num('ny', 8, 128);
    num('alpha', 1e-7, 1e-3); num('kCond', 0.05, 400);
    opt('edgeL', EDGE_KINDS); opt('edgeR', EDGE_KINDS);
    opt('edgeT', EDGE_KINDS); opt('edgeB', EDGE_KINDS);
    num('tL', 1, 2000); num('tR', 1, 2000); num('tT', 1, 2000); num('tB', 1, 2000);
    num('hConv', 1, 1000); num('tInf', 1, 2000);
    bool('hsOn');
    num('hsX', 0, 1); num('hsY', 0, 1); num('hsR', 0.01, 0.5); num('hsQ', 0, 5e6);
    num('tEnd', 0.1, 600); num('dt', 0, 5);
    // convection
    opt('convGeom', CONV_GEOMS); opt('fluidPreset', FLUIDS);
    num('u', 0.05, 50); num('len', 0.005, 2); num('tSurf', 1, 1500); num('tInfC', 1, 1500);
    // radiation
    num('radT1', 1, 3000); num('radT2', 1, 3000);
    num('eps1', 0.01, 1); num('eps2', 0.01, 1);
    opt('radGeom', ['disks', 'rects', 'none']);
    num('r1', 0.005, 2); num('r2', 0.005, 2); num('gap', 0.005, 2);
    num('rectA', 0.01, 5); num('rectB', 0.01, 5); num('rectC', 0.005, 5);
    num('specT', 100, 6000);
    // exchanger
    opt('exArr', EX_ARRANGEMENTS);
    num('thIn', 200, 1000); num('tcIn', 200, 900);
    num('ch', 10, 10000); num('cc', 10, 10000); num('ua', 10, 10000);
    num('thOut', 200, 1000); num('tcOut', 200, 1000);
    // resistance
    num('resA', 0.01, 100); num('resDT', 1, 500);
    num('hOut', 0, 200); num('hIn', 0, 200);
    num('parK', 0, 400); num('parF', 0, 0.9);
    if (typeof params.layerSpec === 'string' && params.layerSpec !== s.layerSpec) {
      s.layerSpec = params.layerSpec.slice(0, 200);
      changed = true;
    }
    if (changed) {
      this.recompute();
      this.draw();
    }
    if (actionFired(params, 'simulate')) this.runSimulation();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'exportPng')) exportCanvasPng(this.api, this.ctx?.canvas2d, 'eng-heat-view');
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- compute (Block / Flow entry) -----------------------------------------

  async compute(input: unknown): Promise<ComputeResult> {
    try {
      const mode = this.state.mode;
      if (mode === 'conduction') {
        this.recompute();
        const r = this.products.cond;
        if (!r) return { ok: false, error: this.products.error ?? 'conduction solve failed' };
        const out = {
          columns: ['nx', 'ny', 'time_s', 'iterations', 'residual_K', 'maxT_K', 'minT_K', 'meanT_K', 'scheme', 'rx_plus_ry'],
          rows: [[r.nx, r.ny, Number(r.time.toFixed(4)), r.iterations, Number(r.residual.toPrecision(6)), Number(r.maxT.toPrecision(8)), Number(r.minT.toPrecision(8)), Number(r.meanT.toPrecision(8)), this.state.scheme, Number((r.rx + r.ry).toFixed(4))]],
          metrics: { maxT: r.maxT, minT: r.minT, meanT: r.meanT, residual: r.residual, converged: r.converged },
        };
        return { ok: true, output: out };
      }
      const rowMode = mode as HeatRowMode;
      const rows = parseHeatInput(rowMode, input);
      const columns = this.rowColumns(rowMode);
      return {
        ok: true,
        output: { columns, rows, metrics: { mode: rowMode, count: rows.length } },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  private rowColumns(mode: HeatRowMode): string[] {
    if (mode === 'convection') return ['re', 'pr', 'ra', 'nu', 'h', 'len', 'regime'];
    if (mode === 'radiation') return ['q', 'f12', 'a1', 'a2', 'lambdaMaxUm'];
    if (mode === 'exchanger') return ['q', 'eps', 'ntu', 'cr', 'lmtd', 'qLmtd', 'lmtdDeviation', 'thOut', 'tcOut'];
    return ['rTotal', 'q', 'qFlux', 'rCore'];
  }

  // ---- recompute -------------------------------------------------------------

  private buildConductionParams(): ConductionParams {
    const s = this.state;
    const e = (kind: EdgeKind, value: number): EdgeSpec => ({ kind, value });
    return {
      W: s.plateW, H: s.plateH, nx: Math.round(s.nx), ny: Math.round(s.ny),
      alpha: s.alpha, k: s.kCond,
      edges: {
        left: e(s.edgeL, s.tL), right: e(s.edgeR, s.tR),
        top: e(s.edgeT, s.tT), bottom: e(s.edgeB, s.tB),
      },
      hConv: s.hConv, tInf: s.tInf,
      source: { enabled: s.hsOn, cx: s.hsX, cy: s.hsY, r: s.hsR, q: s.hsQ },
      scheme: s.scheme, runMode: s.runMode, tEnd: s.tEnd, dt: s.dt,
    };
  }

  private recompute() {
    const s = this.state;
    const p = this.products;
    p.error = null;
    try {
      if (s.mode === 'conduction') {
        const cp = this.buildConductionParams();
        p.condParams = cp;
        p.cond = solveConduction(cp);
      } else if (s.mode === 'convection') {
        const fluid = FLUID_PRESETS[s.fluidPreset] as FluidProps;
        p.conv = solveConvection({ geom: s.convGeom, fluid, u: s.u, L: s.len, tSurf: s.tSurf, tInf: s.tInfC });
        // h vs characteristic length sweep (same conditions, L varied).
        const sweep: Array<{ L: number; h: number }> = [];
        for (let i = 0; i < 72; i += 1) {
          const L = 0.005 * Math.pow(300, i / 71); // 5 mm .. 1.5 m, log-spaced
          const r = solveConvection({ geom: s.convGeom, fluid, u: s.u, L, tSurf: s.tSurf, tInf: s.tInfC });
          sweep.push({ L, h: r.h });
        }
        p.convSweep = sweep;
        // Reference sweep at fixed u_ref = 1 m/s (same fluid/geometry) for a
        // stable visual baseline: with y auto-scaling the active curve alone
        // looks unchanged when u varies (h scales roughly uniformly).
        const refSweep: Array<{ L: number; h: number }> = [];
        for (let i = 0; i < 72; i += 1) {
          const L = 0.005 * Math.pow(300, i / 71);
          const r = solveConvection({ geom: s.convGeom, fluid, u: 1, L, tSurf: s.tSurf, tInf: s.tInfC });
          refSweep.push({ L, h: r.h });
        }
        p.convRefSweep = refSweep;
      } else if (s.mode === 'radiation') {
        p.rad = solveRadiation({
          t1: s.radT1, t2: s.radT2, eps1: s.eps1, eps2: s.eps2,
          geom: s.radGeom, r1: s.r1, r2: s.r2, gap: s.gap,
          rectA: s.rectA, rectB: s.rectB, rectC: s.rectC,
        });
        p.spectrum = planckSweep(s.specT, 0.05e-6, 100e-6, 240);
      } else if (s.mode === 'exchanger') {
        p.ex = solveExchanger({ thIn: s.thIn, tcIn: s.tcIn, ch: s.ch, cc: s.cc, ua: s.ua, arrangement: s.exArr });
        p.profiles = exchangerProfiles(p.ex, 80);
      } else {
        p.res = solveResistance({
          area: s.resA, dT: s.resDT, hOut: s.hOut, hIn: s.hIn,
          layers: parseLayerSpec(s.layerSpec), parallelK: s.parK, parallelFrac: s.parF,
        });
      }
    } catch (e) {
      p.cond = null; p.condParams = null; p.conv = null; p.convSweep = null; p.convRefSweep = null;
      p.rad = null; p.spectrum = null; p.ex = null; p.profiles = null; p.res = null;
      p.error = e instanceof Error ? e.message : String(e);
    }
  }

  /** Simulate button: recompute, publish scientific outputs, announce. */
  private runSimulation() {
    this.recompute();
    if (this.products.error) {
      notify(this.api, 'error', `Analysis failed: ${this.products.error}`, `分析失败：${this.products.error}`);
      this.draw();
      return;
    }
    this.publishOutputs();
    const s = this.state;
    const zh = this.zh;
    let summary = '';
    if (s.mode === 'conduction' && this.products.cond) {
      const r = this.products.cond;
      summary = zh
        ? `T_max ${fmtMetric(r.maxT)} K · T_min ${fmtMetric(r.minT)} K · 残差 ${fmtMetric(r.residual)} K`
        : `T_max ${fmtMetric(r.maxT)} K · T_min ${fmtMetric(r.minT)} K · residual ${fmtMetric(r.residual)} K`;
    } else if (s.mode === 'convection' && this.products.conv) {
      summary = `h = ${fmtMetric(this.products.conv.h)} W/(m2 K) · ${this.products.conv.regime}`;
    } else if (s.mode === 'radiation' && this.products.rad) {
      summary = `Q_rad = ${fmtMetric(this.products.rad.qRad)} W · F12 = ${fmtMetric(this.products.rad.f12, 3)}`;
    } else if (s.mode === 'exchanger' && this.products.ex) {
      const ex = this.products.ex;
      summary = `eps = ${fmtMetric(ex.eps, 3)} · NTU = ${fmtMetric(ex.ntu, 3)} · Q = ${fmtMetric(ex.q)} W`;
    } else if (s.mode === 'resistance' && this.products.res) {
      summary = `R_total = ${fmtMetric(this.products.res.rTotal)} K/W · q = ${fmtMetric(this.products.res.q)} W`;
    }
    notify(this.api, 'success', summary, summary);
    this.draw();
  }

  /** Publish the mode's numerical conclusions to the science-output bus. */
  private publishOutputs() {
    const s = this.state;
    const zh = this.zh;
    const p = this.products;
    const metrics: ScienceMetric[] = [];
    if (s.mode === 'conduction' && p.cond && p.condParams) {
      const r = p.cond;
      metrics.push({
        key: 'tmax', label: zh ? '最高温度 T_max' : 'Max temperature T_max',
        value: fmtMetric(r.maxT), unit: 'K',
        severity: 'info',
      });
      metrics.push({
        key: 'tmin', label: zh ? '最低温度 T_min' : 'Min temperature T_min',
        value: fmtMetric(r.minT), unit: 'K', severity: 'info',
      });
      metrics.push({
        key: 'residual', label: zh ? '收敛残差' : 'Convergence residual',
        value: fmtMetric(r.residual, 3), unit: 'K',
        severity: r.converged && r.residual < 1e-2 ? 'ok' : 'warn',
        hint: zh ? `稳态 = 相邻时间层最大变化；迭代 ${r.iterations} 次` : `steady = max change between time levels; ${r.iterations} iterations`,
      });
      metrics.push({
        key: 'courant', label: zh ? '稳定性 r = rx+ry' : 'Stability r = rx+ry',
        value: fmtMetric(r.rx + r.ry, 3),
        severity: s.scheme === 'explicit' && r.rx + r.ry <= 0.5 ? 'ok' : s.scheme === 'explicit' ? 'warn' : 'info',
        hint: zh ? '显式格式要求 r <= 0.5（二维 von Neumann）；ADI 无条件稳定' : 'explicit requires r <= 0.5 (2-D von Neumann); ADI is unconditionally stable',
      });
    } else if (s.mode === 'convection' && p.conv) {
      const r = p.conv;
      metrics.push({
        key: 'h', label: zh ? '对流换热系数 h' : 'Convective coefficient h',
        value: fmtMetric(r.h), unit: 'W/(m2 K)',
        severity: r.h > 0 ? 'ok' : 'warn',
        hint: `Nu = ${fmtMetric(r.nu, 3)} · ${r.correlation}`,
      });
      metrics.push({
        key: 'regime', label: zh ? '流态判别' : 'Regime',
        value: r.regime, severity: 'info',
      });
      metrics.push({
        key: 're', label: zh ? '雷诺数 Re' : 'Reynolds Re',
        value: fmtMetric(r.re), severity: 'info',
      });
      if (r.ra > 0) {
        metrics.push({
          key: 'ra', label: zh ? '瑞利数 Ra' : 'Rayleigh Ra',
          value: fmtMetric(r.ra), severity: 'info',
          hint: zh ? 'Pr = ' + fmtMetric(r.pr, 3) : `Pr = ${fmtMetric(r.pr, 3)}`,
        });
      } else {
        metrics.push({
          key: 'pr', label: zh ? '普朗特数 Pr' : 'Prandtl Pr',
          value: fmtMetric(r.pr, 3), severity: 'info',
        });
      }
    } else if (s.mode === 'radiation' && p.rad) {
      const r = p.rad;
      metrics.push({
        key: 'qrad', label: zh ? '净辐射换热量 Q_rad' : 'Net radiation Q_rad',
        value: fmtMetric(r.qRad), unit: 'W',
        severity: 'ok',
        hint: zh ? '灰体两表面网络：σ(T1⁴−T2⁴)/[(1−ε1)/(A1ε1)+1/(A1F12)+(1−ε2)/(A2ε2)]' : 'gray two-surface network: sigma(T1^4-T2^4)/[(1-e1)/(A1 e1)+1/(A1 F12)+(1-e2)/(A2 e2)]',
      });
      metrics.push({
        key: 'f12', label: zh ? '角系数 F12' : 'View factor F12',
        value: fmtMetric(r.f12, 4), severity: r.f12 > 0 && r.f12 <= 1 ? 'ok' : 'warn',
      });
      metrics.push({
        key: 'eb1', label: zh ? '黑体辐射力 E_b(T1)' : 'Blackbody emission E_b(T1)',
        value: fmtMetric(r.eb1), unit: 'W/m2', severity: 'info',
      });
      metrics.push({
        key: 'lambdamax', label: zh ? '维恩峰值波长' : 'Wien peak wavelength',
        value: fmtMetric(r.lambdaMax * 1e6, 3), unit: 'um',
        severity: 'info', hint: zh ? 'λ_max·T = 2897.77 um·K' : 'lambda_max * T = 2897.77 um K',
      });
    } else if (s.mode === 'exchanger' && p.ex) {
      const r = p.ex;
      metrics.push({
        key: 'eps', label: zh ? '效能 ε' : 'Effectiveness eps',
        value: fmtMetric(r.eps, 4), severity: 'ok',
        hint: zh ? 'ε = Q/(C_min·(T_h,in − T_c,in))' : 'eps = Q / (C_min * (T_h,in - T_c,in))',
      });
      metrics.push({
        key: 'ntu', label: zh ? '传热单元数 NTU' : 'Number of transfer units NTU',
        value: fmtMetric(r.ntu, 4), severity: 'info',
      });
      metrics.push({
        key: 'cr', label: zh ? '热容流率比 Cr' : 'Capacity ratio Cr',
        value: fmtMetric(r.cr, 4), severity: 'info',
      });
      metrics.push({
        key: 'q', label: zh ? '换热量 Q' : 'Heat transfer rate Q',
        value: fmtMetric(r.q), unit: 'W', severity: 'ok',
      });
      if (Number.isFinite(r.lmtd)) {
        metrics.push({
          key: 'lmtd', label: zh ? '对数平均温差 LMTD' : 'LMTD',
          value: fmtMetric(r.lmtd, 3), unit: 'K', severity: 'info',
        });
        metrics.push({
          key: 'lmtd-dev', label: zh ? 'LMTD ↔ ε-NTU 偏差' : 'LMTD vs eps-NTU deviation',
          value: `${fmtMetric(r.lmtdDeviation * 100, 3)}%`,
          severity: r.lmtdDeviation < 1e-3 ? 'ok' : 'warn',
          hint: zh ? '|Q − UA·ΔT_lm|/Q，两法互验' : '|Q - UA*LMTD|/Q, mutual cross-validation',
        });
      } else {
        metrics.push({
          key: 'lmtd', label: 'LMTD', value: zh ? '错流不适用' : 'n/a for cross flow', severity: 'info',
        });
      }
      const s2 = this.state;
      if (s2.thOut > 0 && s2.tcOut > 0) {
        const qh = r.ch * (r.thIn - s2.thOut);
        const qc = r.cc * (s2.tcOut - r.tcIn);
        const dev = Math.abs(qh - qc) / Math.max(Math.abs(r.q), 1e-9);
        metrics.push({
          key: 'energy-dev', label: zh ? '名义出口能量偏差' : 'Declared-outlet energy deviation',
          value: `${fmtMetric(dev * 100, 2)}%`,
          severity: dev < 0.05 ? 'ok' : 'warn',
          hint: zh ? '|C_h·ΔT_h − C_c·ΔT_c|/Q（使用名义出口温度）' : '|C_h*dT_h - C_c*dT_c| / Q (declared outlets)',
        });
      }
    } else if (s.mode === 'resistance' && p.res) {
      const r = p.res;
      metrics.push({
        key: 'rtotal', label: zh ? '总热阻 R_total' : 'Total resistance R_total',
        value: fmtMetric(r.rTotal), unit: 'K/W',
        severity: 'ok',
        hint: zh ? '串联膜阻 + 层阻（并联路径已合并）' : 'series films + layers (parallel path combined)',
      });
      metrics.push({
        key: 'q', label: zh ? '热流量 q' : 'Heat flow q',
        value: fmtMetric(r.q), unit: 'W', severity: 'ok',
        hint: `q = dT / R_total = ${fmtMetric(this.state.resDT)} / ${fmtMetric(r.rTotal)}`,
      });
      metrics.push({
        key: 'qflux', label: zh ? '热流密度 q"' : 'Heat flux q"',
        value: fmtMetric(r.qFlux), unit: 'W/m2', severity: 'info',
      });
      if (Number.isFinite(r.rParallel)) {
        metrics.push({
          key: 'rpar', label: zh ? '并联支路热阻' : 'Parallel branch resistance',
          value: fmtMetric(r.rParallel), unit: 'K/W', severity: 'info',
        });
      }
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- export ---------------------------------------------------------------

  private exportCsv() {
    const p = this.products;
    const s = this.state;
    if (s.mode === 'conduction' && p.cond && p.condParams) {
      const r = p.cond;
      const stride = Math.max(1, Math.ceil(r.nx / 120));
      const rows: Array<Array<number | string>> = [];
      const jMid = Math.floor(r.ny / 2);
      for (let i = 0; i < r.nx; i += stride) {
        rows.push([
          Number(((i / (r.nx - 1)) * p.condParams.W).toPrecision(6)),
          Number(r.T[jMid * r.nx + i]!.toPrecision(8)),
        ]);
      }
      exportRowsCsv(this.api, 'heat-conduction-centerline', ['x_m', 'T_K'], rows);
    } else if (s.mode === 'convection' && p.convSweep) {
      const rows: Array<Array<number | string>> = p.convSweep.map((pt) => [
        Number(pt.L.toPrecision(6)), Number(pt.h.toPrecision(8)),
      ]);
      exportRowsCsv(this.api, 'heat-convection-h-vs-L', ['L_m', 'h_W_m2K'], rows);
    } else if (s.mode === 'radiation' && p.spectrum) {
      const rows: Array<Array<number | string>> = p.spectrum.map((pt) => [
        Number((pt.lambda * 1e6).toPrecision(8)), Number((pt.e * 1e-6).toPrecision(8)),
      ]);
      exportRowsCsv(this.api, 'heat-radiation-planck', ['lambda_um', 'E_kW_m2_um'], rows);
    } else if (s.mode === 'exchanger' && p.profiles) {
      const rows: Array<Array<number | string>> = p.profiles.map((pt) => [
        Number(pt.x.toPrecision(6)), Number(pt.th.toPrecision(8)), Number(pt.tc.toPrecision(8)),
      ]);
      exportRowsCsv(this.api, 'heat-exchanger-profiles', ['x_frac', 'T_hot_K', 'T_cold_K'], rows);
    } else if (s.mode === 'resistance' && p.res) {
      const r = p.res;
      const chain = [r.rOut, ...r.rLayers, r.rIn];
      const rows: Array<Array<number | string>> = [];
      let cum = 0;
      for (let k = 0; k < r.nodeTs.length; k += 1) {
        rows.push([Number(cum.toPrecision(8)), Number(r.nodeTs[k]!.toPrecision(8))]);
        if (k < chain.length) cum += chain[k]!;
      }
      exportRowsCsv(this.api, 'heat-resistance-ladder', ['R_cum_K_W', 'T_K'], rows);
    } else {
      notify(this.api, 'warning', 'Run a simulation first.', '请先运行仿真。');
    }
  }

  private async sendToFigure(): Promise<void> {
    const p = this.products;
    const s = this.state;
    if (p.error) {
      notify(this.api, 'warning', 'Fix invalid parameters first.', '请先修正无效参数。');
      return;
    }
    let payload: HeatFigurePayload | null = null;
    let title: Bilingual = { zh: '传热分析', en: 'Heat Transfer Analysis' };
    let caption: Bilingual = { zh: '', en: '' };
    if (s.mode === 'conduction' && p.cond && p.condParams) {
      payload = { mode: 'conduction', result: p.cond, W: p.condParams.W, H: p.condParams.H };
      title = { zh: '二维导热温度场', en: '2-D Conduction Field' };
      caption = {
        zh: `稳态/瞬态温度场：T_max = ${fmtMetric(p.cond.maxT)} K，T_min = ${fmtMetric(p.cond.minT)} K，残差 ${fmtMetric(p.cond.residual)} K（${s.scheme.toUpperCase()}）。`,
        en: `Temperature field: T_max = ${fmtMetric(p.cond.maxT)} K, T_min = ${fmtMetric(p.cond.minT)} K, residual ${fmtMetric(p.cond.residual)} K (${s.scheme.toUpperCase()}).`,
      };
    } else if (s.mode === 'convection' && p.conv && p.convSweep) {
      payload = { mode: 'convection', sweep: p.convSweep, current: p.conv };
      title = { zh: '对流换热关联式', en: 'Convection Correlation' };
      caption = {
        zh: `h = ${fmtMetric(p.conv.h)} W/(m²·K)，流态：${p.conv.regime}（${p.conv.correlation}）。`,
        en: `h = ${fmtMetric(p.conv.h)} W/(m2 K), regime: ${p.conv.regime} (${p.conv.correlation}).`,
      };
    } else if (s.mode === 'radiation' && p.rad && p.spectrum) {
      payload = { mode: 'radiation', spectrum: p.spectrum, lambdaMaxUm: wienPeakWavelength(s.specT) * 1e6, specT: s.specT };
      title = { zh: '辐射换热', en: 'Radiation Exchange' };
      caption = {
        zh: `Q_rad = ${fmtMetric(p.rad.qRad)} W，F12 = ${fmtMetric(p.rad.f12, 4)}，λ_max = ${fmtMetric(p.rad.lambdaMax * 1e6, 2)} um。`,
        en: `Q_rad = ${fmtMetric(p.rad.qRad)} W, F12 = ${fmtMetric(p.rad.f12, 4)}, lambda_max = ${fmtMetric(p.rad.lambdaMax * 1e6, 2)} um.`,
      };
    } else if (s.mode === 'exchanger' && p.ex && p.profiles) {
      payload = { mode: 'exchanger', profiles: p.profiles, result: p.ex };
      title = { zh: '换热器温度剖面', en: 'Exchanger Temperature Profiles' };
      caption = {
        zh: `ε = ${fmtMetric(p.ex.eps, 4)}，NTU = ${fmtMetric(p.ex.ntu, 3)}，LMTD = ${Number.isFinite(p.ex.lmtd) ? fmtMetric(p.ex.lmtd, 2) + ' K' : '—'}，Q = ${fmtMetric(p.ex.q)} W。`,
        en: `eps = ${fmtMetric(p.ex.eps, 4)}, NTU = ${fmtMetric(p.ex.ntu, 3)}, LMTD = ${Number.isFinite(p.ex.lmtd) ? fmtMetric(p.ex.lmtd, 2) + ' K' : 'n/a'}, Q = ${fmtMetric(p.ex.q)} W.`,
      };
    } else if (s.mode === 'resistance' && p.res) {
      payload = { mode: 'resistance', result: p.res };
      title = { zh: '热阻网络壁', en: 'Thermal Resistance Wall' };
      caption = {
        zh: `R_total = ${fmtMetric(p.res.rTotal)} K/W，q = ${fmtMetric(p.res.q)} W（q" = ${fmtMetric(p.res.qFlux)} W/m²）。`,
        en: `R_total = ${fmtMetric(p.res.rTotal)} K/W, q = ${fmtMetric(p.res.q)} W (q" = ${fmtMetric(p.res.qFlux)} W/m2).`,
      };
    }
    if (!payload) {
      notify(this.api, 'warning', 'Run a simulation first.', '请先运行仿真。');
      return;
    }
    await pushPanelsToFigure(this.api, title, caption, heatFigurePanels(payload));
  }

  // ---- drawing ---------------------------------------------------------------

  private fnt(px: number): string {
    return `${px}px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;
    const w = canvas.width;
    const h = canvas.height;
    const s = this.state;
    const titles: Record<Mode, [string, string]> = {
      conduction: ['二维导热 · 温度场与等温线', '2-D conduction · field & isotherms'],
      convection: ['对流换热 · h 随特征长度', 'Convection · h vs characteristic length'],
      radiation: ['辐射换热 · 普朗克光谱与维恩峰', 'Radiation · Planck spectrum & Wien peak'],
      exchanger: ['换热器 · 轴向温度剖面', 'Heat exchanger · axial temperature profiles'],
      resistance: ['热阻网络壁 · 节点温度梯', 'Resistance wall · node temperature ladder'],
    };
    const [tZh, tEn] = titles[s.mode];
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = this.fnt(13);
    g.fillText(zh ? tZh : tEn, w / 2, 18);

    if (this.products.error) {
      g.fillStyle = 'rgba(255,140,140,0.95)';
      g.font = this.fnt(12);
      g.textAlign = 'center';
      g.fillText(`${zh ? '参数无效：' : 'Invalid parameters: '}${this.products.error}`, w / 2, h / 2);
      return;
    }
    if (!this.products.cond && !this.products.conv && !this.products.rad && !this.products.ex && !this.products.res) {
      this.recompute();
    }
    if (s.mode === 'conduction') this.drawConduction(g, w, h);
    else if (s.mode === 'convection') this.drawConvection(g, w, h);
    else if (s.mode === 'radiation') this.drawRadiation(g, w, h);
    else if (s.mode === 'exchanger') this.drawExchanger(g, w, h);
    else this.drawResistance(g, w, h);
  }

  /** Heatmap + isotherms + colorbar for the 2-D conduction field. */
  private drawConduction(g: CanvasRenderingContext2D, w: number, h: number): void {
    const r = this.products.cond;
    const cp = this.products.condParams;
    if (!r || !cp) return;
    const zh = this.zh;
    const left = 56;
    const top = 34;
    const barW = 16;
    const plotW = Math.min(w - left - barW - 96, 560);
    const plotH = h - top - 64;
    // Keep the plate aspect ratio.
    const aspect = cp.W / cp.H;
    let pw = plotW;
    let ph = pw / aspect;
    if (ph > plotH) { ph = plotH; pw = ph * aspect; }
    const px = left;
    const py = top;
    const mapX = (i: number): number => px + (i / (r.nx - 1)) * pw;
    const mapY = (j: number): number => py + ph - (j / (r.ny - 1)) * ph;

    // Cached offscreen heatmap (rebuilt only when the grid changes).
    if (!this.heatCv || this.heatNx !== r.nx || this.heatNy !== r.ny) {
      const cv = document.createElement('canvas');
      cv.width = r.nx;
      cv.height = r.ny;
      this.heatCv = cv;
      this.heatNx = r.nx;
      this.heatNy = r.ny;
    }
    const off = this.heatCv.getContext('2d');
    if (off) {
      const img = off.createImageData(r.nx, r.ny);
      const span = r.maxT - r.minT || 1;
      for (let j = 0; j < r.ny; j += 1) {
        for (let i = 0; i < r.nx; i += 1) {
          const t = (r.T[j * r.nx + i]! - r.minT) / span;
          const s2 = clamp(t, 0, 1) * (HEAT_STOPS.length - 1);
          const k = Math.min(HEAT_STOPS.length - 2, Math.floor(s2));
          const f = s2 - k;
          const a = HEAT_STOPS[k]!;
          const b = HEAT_STOPS[k + 1]!;
          const row = r.ny - 1 - j; // flip so j = 0 is at the bottom
          const o = (row * r.nx + i) * 4;
          img.data[o] = Math.round(a[0] + f * (b[0] - a[0]));
          img.data[o + 1] = Math.round(a[1] + f * (b[1] - a[1]));
          img.data[o + 2] = Math.round(a[2] + f * (b[2] - a[2]));
          img.data[o + 3] = 255;
        }
      }
      off.putImageData(img, 0, 0);
    }
    g.imageSmoothingEnabled = true;
    g.drawImage(this.heatCv!, px, py, pw, ph);
    g.strokeStyle = 'rgba(200,210,225,0.6)';
    g.lineWidth = 1;
    g.strokeRect(px, py, pw, ph);

    // Isotherms (marching squares), ~9 levels between min and max.
    const span = r.maxT - r.minT;
    if (span > 1e-9) {
      g.strokeStyle = 'rgba(235,242,250,0.55)';
      g.lineWidth = 1;
      for (let k = 1; k <= 9; k += 1) {
        const level = r.minT + (span * k) / 10;
        const segs = marchingSquares(r.T, r.nx, r.ny, level);
        g.beginPath();
        for (const [x1, y1, x2, y2] of segs) {
          g.moveTo(mapX(x1), mapY(y1));
          g.lineTo(mapX(x2), mapY(y2));
        }
        g.stroke();
      }
    }

    // Colorbar.
    const barX = px + pw + 18;
    const barH = ph;
    for (let k = 0; k < 64; k += 1) {
      const t = 1 - k / 63;
      g.fillStyle = heatColor(t);
      g.fillRect(barX, py + (k / 64) * barH, barW, barH / 64 + 1);
    }
    g.strokeStyle = 'rgba(200,210,225,0.5)';
    g.strokeRect(barX, py, barW, barH);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.font = '10px Consolas, monospace';
    g.textAlign = 'left';
    g.fillText(fmtTick(r.maxT), barX + barW + 4, py + 8);
    g.fillText(fmtTick(r.minT), barX + barW + 4, py + barH);

    // Axis labels.
    g.fillStyle = 'rgba(160,175,195,0.9)';
    g.textAlign = 'left';
    g.fillText('0', px, py + ph + 14);
    g.textAlign = 'right';
    g.fillText(`${fmtTick(cp.W)} m`, px + pw, py + ph + 14);
    g.save();
    g.translate(px - 8, py + ph);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'left';
    g.fillText(`0 -> ${fmtTick(cp.H)} m`, 0, 0);
    g.restore();

    // Footer.
    g.textAlign = 'left';
    g.font = this.fnt(11);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const scheme = cp.scheme === 'adi' ? 'ADI' : 'FTCS';
    const mode = cp.runMode === 'steady' ? (zh ? '稳态' : 'steady') : (zh ? `瞬态 t = ${fmtMetric(r.time)} s` : `transient t = ${fmtMetric(r.time)} s`);
    g.fillText(
      `${zh ? '格式' : 'scheme'} ${scheme} · ${mode} · r = ${fmtMetric(r.rx + r.ry, 3)}`,
      16, h - 26,
    );
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText(
      `T_max = ${fmtMetric(r.maxT)} K · T_min = ${fmtMetric(r.minT)} K · ${zh ? '残差' : 'residual'} = ${fmtMetric(r.residual, 3)} K · ${zh ? '迭代' : 'iters'} = ${r.iterations}`,
      16, h - 10,
    );
  }

  /** h vs characteristic length curve with the operating point. */
  private drawConvection(g: CanvasRenderingContext2D, w: number, h: number): void {
    const cur = this.products.conv;
    const sweep = this.products.convSweep;
    if (!cur || !sweep || sweep.length < 2) return;
    const zh = this.zh;
    const r: Rect = { x: 56, y: 34, w: w - 76, h: h - 96 };
    const logLo = Math.log10(sweep[0]!.L);
    const logHi = Math.log10(sweep[sweep.length - 1]!.L);
    let hLo = Infinity;
    let hHi = -Infinity;
    for (const pt of sweep) {
      if (pt.h < hLo) hLo = pt.h;
      if (pt.h > hHi) hHi = pt.h;
    }
    // Include the fixed-u reference curve in the y-range so moving the live
    // curve relative to the ghost baseline is visible despite auto-scaling.
    const ref = this.products.convRefSweep;
    if (ref) {
      for (const pt of ref) {
        if (pt.h < hLo) hLo = pt.h;
        if (pt.h > hHi) hHi = pt.h;
      }
    }
    hLo = Math.max(0, hLo - (hHi - hLo) * 0.08);
    hHi += (hHi - hLo) * 0.08 + 1e-9;
    const mapX = (L: number): number => r.x + ((Math.log10(L) - logLo) / (logHi - logLo)) * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - hLo) / (hHi - hLo)) * r.h;

    drawFrame(g, r, zh ? 'h 随特征长度变化（对数横轴）' : 'h vs characteristic length (log x)', 'L / m (log)', 'h / W·m⁻²·K⁻¹', true, zh);
    // Decade grid.
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    g.font = '10px Consolas, monospace';
    g.textAlign = 'center';
    for (let k = Math.ceil(logLo * 2) / 2; k <= logHi; k += 0.5) {
      const x = mapX(Math.pow(10, k));
      g.beginPath();
      g.moveTo(x, r.y);
      g.lineTo(x, r.y + r.h);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.textAlign = 'right';
    for (const v of linTicks(hLo, hHi, 5)) {
      const y = mapY(v);
      g.beginPath();
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
      g.stroke();
      g.fillStyle = 'rgba(160,175,195,0.85)';
      g.fillText(fmtTick(v), r.x - 4, y + 3);
    }

    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    // Ghost baseline at fixed u_ref = 1 m/s (dashed grey).
    if (ref && ref.length >= 2) {
      g.strokeStyle = 'rgba(150,160,175,0.55)';
      g.lineWidth = 1.5;
      g.setLineDash([5, 4]);
      g.beginPath();
      for (let i = 0; i < ref.length; i += 1) {
        const x = mapX(ref[i]!.L);
        const y = mapY(clamp(ref[i]!.h, hLo, hHi));
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.setLineDash([]);
    }
    g.strokeStyle = 'rgba(110,168,216,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < sweep.length; i += 1) {
      const x = mapX(sweep[i]!.L);
      const y = mapY(clamp(sweep[i]!.h, hLo, hHi));
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    // Operating point.
    const ox = mapX(cur.length);
    const oy = mapY(clamp(cur.h, hLo, hHi));
    g.fillStyle = 'rgba(216,180,106,0.95)';
    g.beginPath();
    g.arc(ox, oy, 4, 0, Math.PI * 2);
    g.fill();
    g.restore();

    g.textAlign = 'left';
    g.font = this.fnt(11);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const isNat = cur.re === 0;
    const g1 = isNat ? `Ra = ${fmtMetric(cur.ra)}` : `Re = ${fmtMetric(cur.re)}`;
    g.fillText(`${g1} · Nu = ${fmtMetric(cur.nu, 3)} · Pr = ${fmtMetric(cur.pr, 3)} · ${cur.regime}`, 16, h - 26);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const refNote = ref ? ` · ${zh ? '虚线: u=1 m/s 基准' : 'dashed: u = 1 m/s reference'}` : '';
    g.fillText(`h = ${fmtMetric(cur.h)} W/(m2 K) · u = ${fmtMetric(this.state.u)} m/s${refNote} · ${cur.correlation}`, 16, h - 10);
  }

  /** Planck spectral curve with the Wien peak marker. */
  private drawRadiation(g: CanvasRenderingContext2D, w: number, h: number): void {
    const spec = this.products.spectrum;
    const rad = this.products.rad;
    if (!spec || spec.length < 2 || !rad) return;
    const zh = this.zh;
    const r: Rect = { x: 56, y: 34, w: w - 76, h: h - 96 };
    const logLo = Math.log10(spec[0]!.lambda * 1e6);
    const logHi = Math.log10(spec[spec.length - 1]!.lambda * 1e6);
    let eLo = Infinity;
    let eHi = -Infinity;
    let peak = spec[0]!;
    for (const pt of spec) {
      if (pt.e < eLo) eLo = pt.e;
      if (pt.e > eHi) eHi = pt.e;
      if (pt.e > peak.e) peak = pt;
    }
    eLo = 0;
    eHi *= 1.08;
    const mapX = (lambdaUm: number): number => r.x + ((Math.log10(lambdaUm) - logLo) / (logHi - logLo)) * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - eLo) / (eHi - eLo)) * r.h;

    drawFrame(g, r, zh ? `普朗克谱 E_b,λ（T = ${this.state.specT} K）` : `Planck spectrum E_b,l (T = ${this.state.specT} K)`, 'λ / um (log)', 'E / kW·m⁻²·um⁻¹', true, zh);
    // Log decades.
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    g.font = '10px Consolas, monospace';
    g.textAlign = 'center';
    for (let k = Math.ceil(logLo); k <= Math.floor(logHi); k += 1) {
      const x = mapX(Math.pow(10, k));
      g.beginPath();
      g.moveTo(x, r.y);
      g.lineTo(x, r.y + r.h);
      g.stroke();
      g.fillStyle = 'rgba(160,175,195,0.85)';
      g.fillText(fmtTick(Math.pow(10, k)), x, r.y + r.h + 13);
    }

    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    // Wien peak marker.
    const lamUm = peak.lambda * 1e6;
    g.strokeStyle = 'rgba(216,180,106,0.8)';
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(mapX(lamUm), r.y);
    g.lineTo(mapX(lamUm), r.y + r.h);
    g.stroke();
    g.setLineDash([]);
    // Curve.
    g.strokeStyle = 'rgba(201,138,122,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < spec.length; i += 1) {
      const x = mapX(spec[i]!.lambda * 1e6);
      const y = mapY(spec[i]!.e);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.fillStyle = 'rgba(216,180,106,0.95)';
    g.beginPath();
    g.arc(mapX(lamUm), mapY(peak.e), 3.5, 0, Math.PI * 2);
    g.fill();
    g.font = '10px Consolas, monospace';
    g.textAlign = 'center';
    g.fillText(`λ_max = ${fmtMetric(lamUm, 2)} um`, mapX(lamUm), mapY(peak.e) - 8);
    g.restore();

    g.textAlign = 'left';
    g.font = this.fnt(11);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(`E_b(T1) = ${fmtMetric(rad.eb1)} W/m2 · E_b(T2) = ${fmtMetric(rad.eb2)} W/m2 · F12 = ${fmtMetric(rad.f12, 4)}`, 16, h - 26);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.fillText(`Q_rad = ${fmtMetric(rad.qRad)} W · σ = 5.670374419e-8 W/(m2 K4)`, 16, h - 10);
  }

  /** Hot/cold axial temperature profiles. */
  private drawExchanger(g: CanvasRenderingContext2D, w: number, h: number): void {
    const prof = this.products.profiles;
    const ex = this.products.ex;
    if (!prof || prof.length < 2 || !ex) return;
    const zh = this.zh;
    const r: Rect = { x: 56, y: 34, w: w - 76, h: h - 96 };
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of prof) {
      lo = Math.min(lo, p.th, p.tc);
      hi = Math.max(hi, p.th, p.tc);
    }
    const pad = (hi - lo) * 0.1 || 1;
    lo -= pad;
    hi += pad;
    const mapX = (x: number): number => r.x + x * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - lo) / (hi - lo)) * r.h;

    drawFrame(g, r, zh ? `${ex.arrangement === 'counter' ? '逆流' : ex.arrangement === 'parallel' ? '顺流' : '错流'}温度剖面` : `${ex.arrangement} flow temperature profiles`, 'x / L', 'T / K', true, zh);
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    g.font = '10px Consolas, monospace';
    for (const v of linTicks(lo, hi, 5)) {
      const y = mapY(v);
      g.beginPath();
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
      g.stroke();
      g.fillStyle = 'rgba(160,175,195,0.85)';
      g.textAlign = 'right';
      g.fillText(fmtTick(v), r.x - 4, y + 3);
    }

    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    const line = (pick: (p: ProfilePoint) => number, color: string, dash: number[]): void => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.setLineDash(dash);
      g.beginPath();
      for (let i = 0; i < prof.length; i += 1) {
        const x = mapX(prof[i]!.x);
        const y = mapY(pick(prof[i]!));
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.setLineDash([]);
    };
    line((p) => p.th, 'rgba(201,138,122,0.95)', []);
    line((p) => p.tc, 'rgba(110,168,216,0.95)', []);
    g.restore();

    // Legend.
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    let lx = r.x + r.w - 110;
    let ly = r.y + 16;
    g.strokeStyle = 'rgba(201,138,122,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(lx, ly - 3);
    g.lineTo(lx + 16, ly - 3);
    g.stroke();
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.textAlign = 'left';
    g.fillText(zh ? '热流 T_h' : 'hot T_h', lx + 21, ly);
    ly += 14;
    g.strokeStyle = 'rgba(110,168,216,0.95)';
    g.beginPath();
    g.moveTo(lx, ly - 3);
    g.lineTo(lx + 16, ly - 3);
    g.stroke();
    g.fillText(zh ? '冷流 T_c' : 'cold T_c', lx + 21, ly);

    g.textAlign = 'left';
    g.font = this.fnt(11);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const lmtdStr = Number.isFinite(ex.lmtd) ? `ΔT_lm = ${fmtMetric(ex.lmtd, 2)} K` : (zh ? 'LMTD 不适用（错流）' : 'LMTD n/a (cross)');
    g.fillText(`ε = ${fmtMetric(ex.eps, 4)} · NTU = ${fmtMetric(ex.ntu, 3)} · Cr = ${fmtMetric(ex.cr, 3)} · ${lmtdStr}`, 16, h - 26);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const devStr = Number.isFinite(ex.lmtdDeviation) ? ` · ${zh ? '两法偏差' : 'method dev'} ${(ex.lmtdDeviation * 100).toFixed(4)}%` : '';
    g.fillText(`Q = ${fmtMetric(ex.q)} W · T_h,out = ${fmtMetric(ex.thOut, 4)} K · T_c,out = ${fmtMetric(ex.tcOut, 4)} K${devStr}`, 16, h - 10);
  }

  /** Resistance ladder: layer bars sized by R with node temperatures. */
  private drawResistance(g: CanvasRenderingContext2D, w: number, h: number): void {
    const r = this.products.res;
    if (!r) return;
    const zh = this.zh;
    const names: string[] = [];
    if (r.rOut > 0) names.push(zh ? '外侧膜' : 'outer film');
    const layers = parseLayerSpec(this.state.layerSpec);
    layers.forEach((_, i) => names.push(zh ? `层 ${i + 1}` : `layer ${i + 1}`));
    if (r.rIn > 0) names.push(zh ? '内侧膜' : 'inner film');

    const left = 70;
    const right = w - 70;
    const barY = h * 0.42;
    const barH = 44;
    const chain = [r.rOut, ...r.rLayers, r.rIn];
    const chainNames = [r.rOut > 0 ? names[0]! : '', ...r.rLayers.map((_, i) => names[(r.rOut > 0 ? 1 : 0) + i]!), r.rIn > 0 ? names[names.length - 1]! : ''];
    const totalR = chain.reduce((a2, b2) => a2 + b2, 0);
    // Minimum pixel width so thin-film segments stay visible.
    const widthFor = (rv: number): number => Math.max(6, (rv / totalR) * (right - left));

    // Films: hatched segments; layers: solid bars.
    let x = left;
    for (let k = 0; k < chain.length; k += 1) {
      const seg = chain[k]!;
      const segW = widthFor(seg);
      const isFilm = k === 0 ? r.rOut > 0 : k === chain.length - 1 ? r.rIn > 0 : false;
      if (isFilm) {
        g.fillStyle = 'rgba(150,160,175,0.25)';
        g.fillRect(x, barY, segW, barH);
        g.strokeStyle = 'rgba(150,160,175,0.8)';
        g.lineWidth = 1;
        g.strokeRect(x, barY, segW, barH);
        for (let hx = x + 4; hx < x + segW - 2; hx += 7) {
          g.beginPath();
          g.moveTo(hx, barY + barH);
          g.lineTo(hx + 6, barY);
          g.stroke();
        }
      } else {
        g.fillStyle = 'rgba(110,168,216,0.35)';
        g.fillRect(x, barY, segW, barH);
        g.strokeStyle = 'rgba(110,168,216,0.9)';
        g.lineWidth = 1.5;
        g.strokeRect(x, barY, segW, barH);
      }
      // R label below.
      g.fillStyle = 'rgba(160,175,195,0.9)';
      g.font = '9px Consolas, monospace';
      g.textAlign = 'center';
      g.fillText(seg.toExponential(1), x + segW / 2, barY + barH + 14);
      if (chainNames[k]) {
        g.fillStyle = 'rgba(200,210,225,0.8)';
        g.fillText(chainNames[k]!, x + segW / 2, barY + barH + 27);
      }
      x += segW;
    }

    // Node temperatures above the interfaces.
    g.font = '10px Consolas, monospace';
    let nodeX = left;
    for (let k = 0; k < r.nodeTs.length; k += 1) {
      if (k > 0 && k - 1 < chain.length) nodeX += widthFor(chain[k - 1]!);
      const tv = r.nodeTs[k]!;
      g.fillStyle = 'rgba(216,180,106,0.95)';
      g.beginPath();
      g.arc(nodeX, barY - 16, 3, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(200,210,225,0.95)';
      g.textAlign = 'center';
      g.fillText(fmtTick(tv), nodeX, barY - 26);
    }

    g.textAlign = 'left';
    g.font = this.fnt(11);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const par = Number.isFinite(r.rParallel) ? ` · ${zh ? '并联支路' : 'parallel'} R = ${fmtMetric(r.rParallel)} K/W` : '';
    g.fillText(`R_total = ${fmtMetric(r.rTotal)} K/W · q = ${fmtMetric(r.q)} W · q" = ${fmtMetric(r.qFlux)} W/m2${par}`, 16, h - 10);
  }
}

export default function createEngHeatPlugin(): Plugin {
  return new EngHeatPlugin();
}
