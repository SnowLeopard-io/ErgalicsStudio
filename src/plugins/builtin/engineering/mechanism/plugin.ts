// ==========================================================================
// eng-mechanism — mechanism kinematics studio (live workbench)
//
// Four modes driven by a `mode` select (mode-dependent params are gated with
// visibleWhen):
//   1. Four-bar: animated linkage (play/pause toggle + crank-angle scrub),
//      coupler-curve trace, Grashof class, transmission-angle chart,
//      rocker swing range; position analysis is the exact circle
//      intersection of the kernel.
//   2. Velocity: Kennedy instant centers, velocity arrows at A/B/P, a
//      relative-velocity polygon inset and the |vP|(theta2) chart; the
//      analytic coupler-point velocity is cross-checked against central
//      differences of the position (published as a science metric).
//   3. Cam: rotating disk cam with translating roller follower — actual
//      profile, pitch curve, base circle, motion diagram s(theta) and
//      pressure-angle chart; max pressure angle + undercut warning are
//      published. Segment timing is an editable text param.
//   4. Gear trains: schematic pitch circles with tooth counts for
//      simple/compound fixed-axis trains and the 2K-H planetary; overall
//      ratio / member speeds are published (Willis equation, two inputs).
// "Analyze" publishes the science outputs; benchmarks run the kernel
// validation battery; CSV export and Figure Studio handoff follow the
// shared builtin conventions. compute() is headless for Block/Flow: an
// optional DataTable / CSV / JSON input with link lengths yields a batch
// Grashof table, otherwise the current mode's data table is returned.
// ==========================================================================

import type { ComputeResult, ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas, exportRowsCsv, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { createDataTable, type DataTable } from '@/types/datatable';
import { engMechanismManifest } from './manifest';
import { mechanismFigurePanels } from './figure';
import {
  type Branch,
  type CamLaw,
  type CamParams,
  type CamResult,
  type CamSample,
  type FourBarLinks,
  type FourBarSweep,
  type GrashofClass,
  MECH_DEG,
  MECH_TAU,
  type TrainResult,
  type WillisResult,
  camState,
  couplerVelocityNumeric,
  designCam,
  gearTrain,
  grashofClass,
  motionLaw as motionSample,
  parseBatchInput,
  parseCamTiming,
  parseGearStages,
  solveFourBar,
  sweepFourBar,
  velocityView,
  willisSolve,
} from './kernel';

type Mode = 'fourbar' | 'velocity' | 'cam' | 'gear';
type TrainKind = 'simple' | 'compound' | 'planetary';
type DrivePair = 'sun-ring' | 'sun-carrier' | 'ring-carrier';

const GRASHOF_ZH: Record<GrashofClass, string> = {
  'crank-rocker': '曲柄摇杆',
  'double-crank': '双曲柄',
  'double-rocker': '双摇杆',
  'change-point': '变更点（平行四边形）',
  'no-crank': '无曲柄（三摇杆）',
};
const GRASHOF_EN: Record<GrashofClass, string> = {
  'crank-rocker': 'crank-rocker',
  'double-crank': 'double-crank',
  'double-rocker': 'double-rocker',
  'change-point': 'change-point',
  'no-crank': 'no crank (triple rocker)',
};

/** Default four-bar: Grashof crank-rocker (s+l = 5 < p+q = 6.5). */
const DEFAULT_LINKS: FourBarLinks = { a: 1, b: 3.5, c: 3, d: 4 };
/** Cam angular speed of the animation (deg/s at speed = 1). */
const CAM_ANIM_DEG_S = 60;

interface State {
  mode: Mode;
  a: number;
  b: number;
  c: number;
  d: number;
  branch: Branch;
  cpP: number;
  cpQ: number;
  /** Crank speed (rad/s, signed). */
  w2: number;
  /** Current crank angle (deg) — animation / scrub. */
  thetaDeg: number;
  running: boolean;
  speed: number;
  r0: number;
  rollerR: number;
  stroke: number;
  timingText: string;
  offset: number;
  lawRise: CamLaw;
  lawReturn: CamLaw;
  camThetaDeg: number;
  trainKind: TrainKind;
  stagesText: string;
  zs: number;
  zp: number;
  drivePair: DrivePair;
  wIn1: number;
  wIn2: number;
}

const DEFAULT_STATE: State = {
  mode: 'fourbar',
  ...DEFAULT_LINKS,
  branch: 'open',
  cpP: 2,
  cpQ: 1,
  w2: 2,
  thetaDeg: 0,
  running: false,
  speed: 1,
  r0: 40,
  rollerR: 8,
  stroke: 20,
  timingText: '120,60,120',
  offset: 0,
  lawRise: 'cycloid',
  lawReturn: 'cycloid',
  camThetaDeg: 0,
  trainKind: 'compound',
  stagesText: '20/60, 30/90',
  zs: 20,
  zp: 30,
  drivePair: 'sun-ring',
  wIn1: 10,
  wIn2: 0,
};

// ---- canvas helpers --------------------------------------------------------

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const COLOR_INK = 'rgba(214,224,236,0.95)';
const COLOR_MUTED = 'rgba(150,165,185,0.9)';
const COLOR_GRID = 'rgba(255,255,255,0.06)';
const COLOR_FRAME = 'rgba(120,140,165,0.55)';
const COLOR_BLUE = 'rgba(111,148,184,0.95)'; // #6f94b8
const COLOR_SAGE = 'rgba(138,168,127,0.95)'; // #8aa87f
const COLOR_TAN = 'rgba(179,146,94,0.95)'; // #b3925e
const COLOR_ROSE = 'rgba(184,115,111,0.95)'; // #b8736f
const COLOR_PURPLE = 'rgba(154,134,168,0.95)'; // #9a86a8

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

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
  g.strokeStyle = COLOR_FRAME;
  g.lineWidth = 1;
  g.strokeRect(r.x, r.y, r.w, r.h);
  g.fillStyle = COLOR_INK;
  g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(title, r.x + 6, r.y + 14);
  g.font = '10px Consolas, monospace';
  if (showX) {
    g.fillStyle = COLOR_MUTED;
    g.textAlign = 'right';
    g.fillText(xLabel, r.x + r.w, r.y + r.h + 13);
  }
  g.save();
  g.translate(r.x - 8, r.y + r.h / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.fillStyle = COLOR_MUTED;
  g.fillText(yLabel, 0, 0);
  g.restore();
}

interface ChartSeries {
  xs: number[];
  ys: number[];
  color: string;
  dash?: number[];
  width?: number;
}

interface ChartMarker {
  x: number;
  y: number;
  color: string;
  label?: string;
}

/** Generic x/y line chart with grid, ticks, optional markers and h-lines. */
function drawChart(
  g: CanvasRenderingContext2D,
  r: Rect,
  title: string,
  xLabel: string,
  yLabel: string,
  series: ChartSeries[],
  markers: ChartMarker[] = [],
  hLines: Array<{ y: number; color: string; label?: string }> = [],
  zh = false,
): void {
  let xLo = Infinity;
  let xHi = -Infinity;
  let yLo = Infinity;
  let yHi = -Infinity;
  for (const s of series) {
    for (let i = 0; i < s.xs.length && i < s.ys.length; i += 1) {
      const x = s.xs[i]!;
      const y = s.ys[i]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < xLo) xLo = x;
      if (x > xHi) xHi = x;
      if (y < yLo) yLo = y;
      if (y > yHi) yHi = y;
    }
  }
  for (const m of markers) {
    if (Number.isFinite(m.x) && Number.isFinite(m.y)) {
      xLo = Math.min(xLo, m.x);
      xHi = Math.max(xHi, m.x);
      yLo = Math.min(yLo, m.y);
      yHi = Math.max(yHi, m.y);
    }
  }
  if (!Number.isFinite(xLo) || !Number.isFinite(yLo)) {
    drawFrame(g, r, title, xLabel, yLabel, true, zh);
    return;
  }
  if (xHi - xLo < 1e-12) xHi = xLo + 1;
  if (yHi - yLo < 1e-12) {
    yHi = yLo + Math.max(1e-6, Math.abs(yLo) * 0.1);
  }
  const padY = (yHi - yLo) * 0.1;
  yLo -= padY;
  yHi += padY;
  const mapX = (x: number): number => r.x + ((x - xLo) / (xHi - xLo)) * r.w;
  const mapY = (y: number): number => r.y + r.h - ((y - yLo) / (yHi - yLo)) * r.h;

  drawFrame(g, r, title, xLabel, yLabel, true, zh);

  g.strokeStyle = COLOR_GRID;
  g.lineWidth = 1;
  g.font = '10px Consolas, monospace';
  g.textAlign = 'center';
  g.fillStyle = COLOR_MUTED;
  for (const t of linTicks(xLo, xHi, 6)) {
    const x = mapX(t);
    g.beginPath();
    g.moveTo(x, r.y);
    g.lineTo(x, r.y + r.h);
    g.stroke();
    g.fillText(fmtTick(t), x, r.y + r.h + 13);
  }
  g.textAlign = 'right';
  for (const t of linTicks(yLo, yHi, 4)) {
    const y = mapY(t);
    g.beginPath();
    g.moveTo(r.x, y);
    g.lineTo(r.x + r.w, y);
    g.stroke();
    g.fillText(fmtTick(t), r.x - 4, y + 3);
  }

  g.save();
  g.beginPath();
  g.rect(r.x, r.y, r.w, r.h);
  g.clip();
  for (const hl of hLines) {
    if (!Number.isFinite(hl.y) || hl.y < yLo || hl.y > yHi) continue;
    g.strokeStyle = hl.color;
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(r.x, mapY(hl.y));
    g.lineTo(r.x + r.w, mapY(hl.y));
    g.stroke();
    g.setLineDash([]);
  }
  for (const s of series) {
    g.strokeStyle = s.color;
    g.lineWidth = s.width ?? 1.6;
    if (s.dash) g.setLineDash(s.dash);
    g.beginPath();
    let pen = false;
    for (let i = 0; i < s.xs.length && i < s.ys.length; i += 1) {
      const x = s.xs[i]!;
      const y = s.ys[i]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        pen = false;
        continue;
      }
      const sx = mapX(x);
      const sy = mapY(y);
      if (!pen) {
        g.moveTo(sx, sy);
        pen = true;
      } else {
        g.lineTo(sx, sy);
      }
    }
    g.stroke();
    g.setLineDash([]);
  }
  for (const m of markers) {
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y)) continue;
    g.fillStyle = m.color;
    g.beginPath();
    g.arc(mapX(m.x), mapY(m.y), 3.5, 0, MECH_TAU);
    g.fill();
    if (m.label) {
      g.font = '10px Consolas, monospace';
      g.textAlign = 'center';
      g.fillStyle = COLOR_INK;
      g.fillText(m.label, mapX(m.x), mapY(m.y) - 8);
    }
  }
  g.restore();
}

/** Arrow helper (world or screen space callers compute both endpoints). */
function drawArrow(g: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width = 1.5): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 2) return;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.min(8, len * 0.35);
  g.beginPath();
  g.moveTo(x2, y2);
  g.lineTo(x2 - head * ux + head * 0.45 * uy, y2 - head * uy - head * 0.45 * ux);
  g.lineTo(x2 - head * ux - head * 0.45 * uy, y2 - head * uy + head * 0.45 * ux);
  g.closePath();
  g.fillStyle = color;
  g.fill();
}

// ---- plugin ----------------------------------------------------------------

export class EngMechanismPlugin implements Plugin {
  readonly manifest = engMechanismManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = { ...DEFAULT_STATE };

  // Cached analysis results for the current parameters (rebuilt lazily).
  private sweep: FourBarSweep | null = null;
  private cam: CamResult | null = null;
  private train: TrainResult | null = null;
  private planet: WillisResult | null = null;
  /** Max relative deviation |vP analytic − vP numeric| / |vP numeric|. */
  private velErr = Number.NaN;
  private links: FourBarLinks = { ...DEFAULT_LINKS };
  private errorMsg: string | null = null;
  private dirty = true;

  // Animation loop.
  private rafId = 0;
  private lastFrame = 0;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    this.stopAnim();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stopAnim();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- parameters ----------------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    const zh = this.zh;
    const modeIn = (...modes: Mode[]) => ({ key: 'mode', in: modes });
    // The gear sub-select drives its children's visibility; when the mode is
    // not 'gear' the controller itself is hidden and its reported value is
    // coerced to a sentinel matching no child rule, so stale gear children
    // never leak into other modes.
    const trainKindValue = s.mode === 'gear' ? s.trainKind : 'none';
    const trainIn = (...kinds: string[]) => ({ key: 'trainKind', in: kinds });
    const range = (
      key: keyof State,
      en: string,
      cn: string,
      min: number,
      max: number,
      step: number,
      visible?: ParamDefinition['visibleWhen'],
      hintEn?: string,
      hintZh?: string,
    ): ParamDefinition => ({
      key,
      label: en,
      labelI18n: { 'zh-CN': cn, 'en-US': en },
      type: 'range',
      min,
      max,
      step,
      value: s[key] as number,
      visibleWhen: visible,
      hint: hintEn ? (zh ? hintZh ?? hintEn : hintEn) : undefined,
    });
    const pairHintEn =
      s.drivePair === 'sun-ring'
        ? 'speed 1 = sun, speed 2 = ring'
        : s.drivePair === 'sun-carrier'
          ? 'speed 1 = sun, speed 2 = carrier'
          : 'speed 1 = ring, speed 2 = carrier';
    const pairHintZh =
      s.drivePair === 'sun-ring'
        ? '转速 1 = 太阳轮，转速 2 = 齿圈'
        : s.drivePair === 'sun-carrier'
          ? '转速 1 = 太阳轮，转速 2 = 行星架'
          : '转速 1 = 齿圈，转速 2 = 行星架';
    return [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '模式', 'en-US': 'Mode' },
        type: 'select',
        options: [
          { value: 'fourbar', label: 'Four-bar linkage', labelI18n: { 'zh-CN': '四杆机构', 'en-US': 'Four-bar linkage' } },
          { value: 'velocity', label: 'Velocity / acceleration', labelI18n: { 'zh-CN': '速度·加速度分析', 'en-US': 'Velocity / acceleration' } },
          { value: 'cam', label: 'Cam profile', labelI18n: { 'zh-CN': '凸轮轮廓', 'en-US': 'Cam profile' } },
          { value: 'gear', label: 'Gear trains', labelI18n: { 'zh-CN': '轮系', 'en-US': 'Gear trains' } },
        ],
        value: s.mode,
      },
      // --- four-bar / velocity shared params ---
      range('a', 'Crank a', '曲柄长 a', 0.2, 4, 0.05, modeIn('fourbar', 'velocity')),
      range('b', 'Coupler b', '连杆长 b', 0.5, 6, 0.05, modeIn('fourbar', 'velocity')),
      range('c', 'Rocker c', '摇杆长 c', 0.5, 6, 0.05, modeIn('fourbar', 'velocity')),
      range('d', 'Ground d', '机架长 d', 0.5, 6, 0.05, modeIn('fourbar', 'velocity')),
      {
        key: 'branch',
        label: 'Assembly branch',
        labelI18n: { 'zh-CN': '装配分支', 'en-US': 'Assembly branch' },
        type: 'select',
        options: [
          { value: 'open', label: 'Open', labelI18n: { 'zh-CN': '开式', 'en-US': 'Open' } },
          { value: 'crossed', label: 'Crossed', labelI18n: { 'zh-CN': '交叉', 'en-US': 'Crossed' } },
        ],
        value: s.branch,
        visibleWhen: modeIn('fourbar', 'velocity'),
      },
      range('cpP', 'Coupler point p', '连杆点 p', 0, 6, 0.05, modeIn('fourbar', 'velocity'), 'distance from A along the coupler', '沿连杆自 A 的距离'),
      range('cpQ', 'Coupler offset q', '连杆点偏距 q', -2, 2, 0.05, modeIn('fourbar', 'velocity'), 'perpendicular offset from the coupler axis', '垂直于连杆轴线的偏距'),
      range('w2', 'Crank speed ω2 (rad/s)', '曲柄转速 ω2 (rad/s)', -10, 10, 0.1, modeIn('fourbar', 'velocity')),
      range('thetaDeg', 'Crank angle θ2 (deg)', '曲柄角 θ2 (deg)', 0, 360, 1, modeIn('fourbar', 'velocity')),
      {
        key: 'run',
        label: 'Animate',
        type: 'toggle',
        value: s.running,
        visibleWhen: modeIn('fourbar', 'velocity', 'cam'),
        offLabelI18n: { 'zh-CN': '播放', 'en-US': 'Play' },
        onLabelI18n: { 'zh-CN': '暂停', 'en-US': 'Pause' },
      },
      range('speed', 'Animation speed', '动画倍速', 0.1, 5, 0.1, modeIn('fourbar', 'velocity', 'cam')),
      // --- cam params ---
      range('r0', 'Base circle r0', '基圆半径 r0', 10, 100, 1, modeIn('cam')),
      range('rollerR', 'Roller radius', '滚子半径', 2, 30, 0.5, modeIn('cam')),
      range('stroke', 'Stroke h', '行程 h', 5, 60, 1, modeIn('cam')),
      {
        key: 'timingText',
        label: 'Timing rise,dwell,return (deg)',
        labelI18n: { 'zh-CN': '升-停-回角 (deg)', 'en-US': 'Timing rise,dwell,return (deg)' },
        type: 'text',
        value: s.timingText,
        placeholder: '120,60,120',
        visibleWhen: modeIn('cam'),
        hint: zh ? '推程角,远休止角,回程角；余下为近休止' : 'rise, dwell, return angles; trailing dwell = remainder',
      },
      range('offset', 'Follower offset e', '偏距 e', -30, 30, 1, modeIn('cam'), '|e| < r0, translating roller follower', '直动滚子从动件，|e| < r0'),
      {
        key: 'lawRise',
        label: 'Rise law',
        labelI18n: { 'zh-CN': '推程运动规律', 'en-US': 'Rise law' },
        type: 'select',
        options: this.lawOptions(),
        value: s.lawRise,
        visibleWhen: modeIn('cam'),
      },
      {
        key: 'lawReturn',
        label: 'Return law',
        labelI18n: { 'zh-CN': '回程运动规律', 'en-US': 'Return law' },
        type: 'select',
        options: this.lawOptions(),
        value: s.lawReturn,
        visibleWhen: modeIn('cam'),
      },
      // --- gear params ---
      {
        key: 'trainKind',
        label: 'Train type',
        labelI18n: { 'zh-CN': '轮系类型', 'en-US': 'Train type' },
        type: 'select',
        options: [
          { value: 'simple', label: 'Simple (one stage)', labelI18n: { 'zh-CN': '简单轮系（单级）', 'en-US': 'Simple (one stage)' } },
          { value: 'compound', label: 'Compound (stages in series)', labelI18n: { 'zh-CN': '复合轮系（多级串联）', 'en-US': 'Compound (stages in series)' } },
          { value: 'planetary', label: 'Planetary (2K-H, Willis)', labelI18n: { 'zh-CN': '行星轮系（2K-H，Willis）', 'en-US': 'Planetary (2K-H, Willis)' } },
        ],
        value: trainKindValue,
        visibleWhen: modeIn('gear'),
      },
      {
        key: 'stagesText',
        label: 'Stages za/zb',
        labelI18n: { 'zh-CN': '各级齿数 za/zb', 'en-US': 'Stages za/zb' },
        type: 'text',
        value: s.stagesText,
        placeholder: '20/60, 30/90',
        visibleWhen: trainIn('simple', 'compound'),
        hint: zh ? '每级 驱动/从动 齿数；前缀 i: 为内啮合' : 'driver/driven teeth per stage; prefix i: = internal mesh',
      },
      range('zs', 'Sun teeth zs', '太阳轮齿数 zs', 10, 60, 1, trainIn('planetary')),
      range('zp', 'Planet teeth zp', '行星轮齿数 zp', 10, 60, 1, trainIn('planetary'), 'ring derived: zr = zs + 2·zp', '齿圈齿数由装配条件导出：zr = zs + 2·zp'),
      {
        key: 'drivePair',
        label: 'Driven members',
        labelI18n: { 'zh-CN': '主动构件', 'en-US': 'Driven members' },
        type: 'select',
        options: [
          { value: 'sun-ring', label: 'Sun + ring', labelI18n: { 'zh-CN': '太阳轮 + 齿圈', 'en-US': 'Sun + ring' } },
          { value: 'sun-carrier', label: 'Sun + carrier', labelI18n: { 'zh-CN': '太阳轮 + 行星架', 'en-US': 'Sun + carrier' } },
          { value: 'ring-carrier', label: 'Ring + carrier', labelI18n: { 'zh-CN': '齿圈 + 行星架', 'en-US': 'Ring + carrier' } },
        ],
        value: s.drivePair,
        visibleWhen: trainIn('planetary'),
        hint: zh ? '差动工况：两个主动件，第三构件由 Willis 方程解出' : 'differential drive: two inputs, the third member follows from the Willis equation',
      },
      range('wIn1', 'Input speed 1 (rad/s)', '输入转速 1 (rad/s)', -100, 100, 1, trainIn('planetary'), pairHintEn, pairHintZh),
      range('wIn2', 'Input speed 2 (rad/s)', '输入转速 2 (rad/s)', -100, 100, 1, trainIn('planetary'), pairHintEn, pairHintZh),
      // --- actions ---
      actionButton('analyze', 'Analyze', '分析', 'primary'),
      actionButton('benchmarks', 'Run benchmarks', '运行基准'),
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  private lawOptions(): Array<{ value: string; label: string; labelI18n: Record<string, string> }> {
    return [
      { value: 'shm', label: 'SHM (cosine acc.)', labelI18n: { 'zh-CN': '简谐（余弦加速度）', 'en-US': 'SHM (cosine acc.)' } },
      { value: 'cycloid', label: 'Cycloidal', labelI18n: { 'zh-CN': '摆线', 'en-US': 'Cycloidal' } },
      { value: 'poly345', label: '3-4-5 polynomial', labelI18n: { 'zh-CN': '3-4-5 多项式', 'en-US': '3-4-5 polynomial' } },
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    let changed = false;
    let modeChanged = false;

    if (typeof params.mode === 'string' && ['fourbar', 'velocity', 'cam', 'gear'].includes(params.mode)) {
      modeChanged = params.mode !== s.mode;
      if (modeChanged) {
        s.mode = params.mode as Mode;
        this.stopAnim();
        changed = true;
      }
    }
    const num = (key: 'a' | 'b' | 'c' | 'd' | 'cpP' | 'cpQ' | 'w2' | 'thetaDeg' | 'speed' | 'r0' | 'rollerR' | 'stroke' | 'offset' | 'zs' | 'zp' | 'wIn1' | 'wIn2', lo: number, hi: number): void => {
      const v = params[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      const cl = clamp(v, lo, hi);
      if (s[key] !== cl) {
        s[key] = cl;
        changed = true;
      }
    };
    num('a', 0.2, 4);
    num('b', 0.5, 6);
    num('c', 0.5, 6);
    num('d', 0.5, 6);
    num('cpP', 0, 6);
    num('cpQ', -2, 2);
    num('w2', -10, 10);
    num('thetaDeg', 0, 360);
    num('speed', 0.1, 5);
    num('r0', 10, 100);
    num('rollerR', 2, 30);
    num('stroke', 5, 60);
    num('offset', -30, 30);
    num('zs', 10, 60);
    num('zp', 10, 60);
    num('wIn1', -100, 100);
    num('wIn2', -100, 100);
    if (typeof params.branch === 'string' && ['open', 'crossed'].includes(params.branch) && params.branch !== s.branch) {
      s.branch = params.branch as Branch;
      changed = true;
    }
    if (typeof params.timingText === 'string' && params.timingText !== s.timingText) {
      s.timingText = params.timingText;
      changed = true;
    }
    for (const key of ['lawRise', 'lawReturn'] as const) {
      const v = params[key];
      if (typeof v === 'string' && ['shm', 'cycloid', 'poly345'].includes(v) && v !== s[key]) {
        s[key] = v as CamLaw;
        changed = true;
      }
    }
    if (typeof params.trainKind === 'string' && ['simple', 'compound', 'planetary'].includes(params.trainKind) && params.trainKind !== s.trainKind) {
      s.trainKind = params.trainKind as TrainKind;
      changed = true;
    }
    if (typeof params.stagesText === 'string' && params.stagesText !== s.stagesText) {
      s.stagesText = params.stagesText;
      changed = true;
    }
    if (typeof params.drivePair === 'string' && ['sun-ring', 'sun-carrier', 'ring-carrier'].includes(params.drivePair) && params.drivePair !== s.drivePair) {
      s.drivePair = params.drivePair as DrivePair;
      changed = true;
    }
    if (typeof params.run === 'boolean') {
      if (params.run && !s.running) this.startAnim();
      else if (!params.run && s.running) this.stopAnim();
    }

    if (actionFired(params, 'analyze')) {
      this.recompute(true);
      this.runAnalysis();
      return;
    }
    if (actionFired(params, 'benchmarks')) {
      this.runBenchmarks();
      return;
    }
    if (actionFired(params, 'exportCsv')) {
      this.exportCsv();
      return;
    }
    if (actionFired(params, 'sendToFigure')) {
      void this.sendToFigure();
      return;
    }
    if (changed || modeChanged) {
      this.dirty = true;
      if (!s.running) {
        this.recompute(false);
        this.draw();
      }
    }
  }

  // ---- animation -------------------------------------------------------------

  private startAnim() {
    if (this.state.running) return;
    this.state.running = true;
    this.lastFrame = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopAnim() {
    this.state.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private tick = (now: number): void => {
    if (!this.state.running) return;
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    const s = this.state;
    if (s.mode === 'cam') {
      s.camThetaDeg = (s.camThetaDeg + dt * s.speed * CAM_ANIM_DEG_S) % 360;
    } else {
      // Advance the crank at ω2 rad/s scaled by the animation speed.
      s.thetaDeg = ((s.thetaDeg + dt * s.speed * s.w2 / MECH_DEG) % 360 + 360) % 360;
    }
    this.draw();
    this.rafId = requestAnimationFrame(this.tick);
  };

  // ---- analysis --------------------------------------------------------------

  private camParams(): CamParams {
    const s = this.state;
    return {
      r0: s.r0,
      rollerR: s.rollerR,
      stroke: s.stroke,
      timing: parseCamTiming(s.timingText),
      offset: s.offset,
      lawRise: s.lawRise,
      lawReturn: s.lawReturn,
    };
  }

  /** Rebuild the cached results for the current mode (cheap, deterministic). */
  private recompute(publish: boolean): void {
    const s = this.state;
    this.errorMsg = null;
    try {
      if (s.mode === 'fourbar' || s.mode === 'velocity') {
        this.links = { a: s.a, b: s.b, c: s.c, d: s.d };
        grashofClass(this.links); // validates positivity
        this.sweep = sweepFourBar(this.links, s.branch, { p: s.cpP, q: s.cpQ }, s.w2, 360);
        this.velErr = this.velocityValidationError();
      } else if (s.mode === 'cam') {
        this.cam = designCam(this.camParams(), 720);
      } else {
        if (s.trainKind === 'planetary') {
          let wSun: number | null = null;
          let wRing: number | null = null;
          let wCarrier: number | null = null;
          if (s.drivePair === 'sun-ring') {
            wSun = s.wIn1;
            wRing = s.wIn2;
          } else if (s.drivePair === 'sun-carrier') {
            wSun = s.wIn1;
            wCarrier = s.wIn2;
          } else {
            wRing = s.wIn1;
            wCarrier = s.wIn2;
          }
          this.planet = willisSolve({ zs: s.zs, zp: s.zp, wSun, wRing, wCarrier });
          this.train = null;
        } else {
          this.train = gearTrain(parseGearStages(s.stagesText));
          this.planet = null;
        }
      }
    } catch (e) {
      this.sweep = null;
      this.cam = null;
      this.train = null;
      this.planet = null;
      this.errorMsg = e instanceof Error ? e.message : String(e);
      if (publish) clearScienceOutputs(this.manifest.id);
    }
    this.dirty = false;
  }

  /** Max relative deviation of the analytic coupler-point velocity vs central differences. */
  private velocityValidationError(): number {
    const s = this.state;
    const l = this.links;
    const cp = { p: s.cpP, q: s.cpQ };
    let maxErr = 0;
    for (let i = 0; i < 24; i += 1) {
      const t2 = (i / 24) * MECH_TAU;
      const pose = solveFourBar(l, t2, s.branch);
      if (!Number.isFinite(pose.theta3)) continue;
      const w3 = ((l.a * s.w2) / l.b) * (Math.sin(pose.theta4 - t2) / Math.sin(pose.theta3 - pose.theta4));
      if (!Number.isFinite(w3) || Math.abs(Math.sin(pose.theta3 - pose.theta4)) < 1e-9) continue;
      const px = pose.A[0] + s.cpP * Math.cos(pose.theta3) - s.cpQ * Math.sin(pose.theta3);
      const py = pose.A[1] + s.cpP * Math.sin(pose.theta3) + s.cpQ * Math.cos(pose.theta3);
      const ax = -l.a * s.w2 * Math.sin(t2) - w3 * (py - pose.A[1]);
      const ay = l.a * s.w2 * Math.cos(t2) + w3 * (px - pose.A[0]);
      const n = couplerVelocityNumeric(l, t2, s.w2, s.branch, cp);
      const den = Math.max(Math.hypot(n[0], n[1]), 1e-12);
      maxErr = Math.max(maxErr, Math.hypot(ax - n[0], ay - n[1]) / den);
    }
    return maxErr;
  }

  private runAnalysis(): void {
    if (this.dirty) this.recompute(false);
    if (this.errorMsg) {
      notify(this.api, 'error', `Analysis failed: ${this.errorMsg}`, `分析失败：${this.errorMsg}`);
      this.draw();
      return;
    }
    this.publishOutputs();
    notify(this.api, 'success', 'Analysis published to science outputs', '分析结果已发布到科学输出');
    this.draw();
  }

  private grashofLabel(cls: GrashofClass): string {
    return this.zh ? GRASHOF_ZH[cls] : GRASHOF_EN[cls];
  }

  private publishOutputs(): void {
    const s = this.state;
    const zh = this.zh;
    const metrics: ScienceMetric[] = [];
    if (s.mode === 'fourbar' || s.mode === 'velocity') {
      const sw = this.sweep;
      if (!sw) return;
      metrics.push({
        key: 'grashof',
        label: zh ? 'Grashof 类型' : 'Grashof class',
        value: this.grashofLabel(sw.grashof),
        severity: sw.grashof === 'no-crank' ? 'warn' : 'info',
        hint: zh ? 's+l 与 p+q 比较，按最短杆位置分类' : 's+l vs p+q, classified by the position of the shortest link',
      });
      metrics.push({
        key: 'mu-min',
        label: zh ? '最小传动角 μmin' : 'Min transmission angle',
        value: fmtMetric(sw.minTransmissionDeg),
        unit: '°',
        severity: sw.minTransmissionDeg >= 40 || sw.minTransmissionDeg <= 0 ? (sw.minTransmissionDeg < 20 ? 'warn' : 'info') : 'info',
        hint: zh ? '建议 μmin ≥ 40°（传力性能）' : 'recommended μmin ≥ 40 deg (force transmission)',
      });
      metrics.push({
        key: 'mu-max',
        label: zh ? '最大传动角 μmax' : 'Max transmission angle',
        value: fmtMetric(sw.maxTransmissionDeg),
        unit: '°',
      });
      metrics.push({
        key: 'swing',
        label: zh ? '摇杆摆角范围' : 'Rocker swing range',
        value: fmtMetric(sw.rockerSwingDeg),
        unit: '°',
        severity: sw.grashof === 'crank-rocker' ? 'ok' : 'info',
        hint: zh ? '整周曲柄驱动下摇杆往复摆角（去卷绕）' : 'rocker excursion over a full crank revolution (unwrapped)',
      });
      metrics.push({
        key: 'closure',
        label: zh ? '闭环位置残差' : 'Closure residual',
        value: fmtMetric(sw.maxResidual),
        severity: sw.maxResidual < 1e-9 ? 'ok' : 'error',
        hint: zh ? '整周扫描最大闭环误差，基准 < 1e-9' : 'max loop-closure error over the sweep, benchmark < 1e-9',
      });
      if (s.mode === 'velocity') {
        metrics.push({
          key: 'vP-max',
          label: zh ? '连杆点最大速度 |vP|max' : 'Max coupler-point speed',
          value: fmtMetric(sw.maxVp),
          hint: zh ? 'ω2 = ' + fmtMetric(s.w2) + ' rad/s' : 'at ω2 = ' + fmtMetric(s.w2) + ' rad/s',
        });
        metrics.push({
          key: 'w4-max',
          label: zh ? '摇杆最大角速度 |ω4|max' : 'Max rocker speed |ω4|',
          value: fmtMetric(sw.maxW4),
          unit: 'rad/s',
        });
        metrics.push({
          key: 'vel-check',
          label: zh ? '速度 vs 数值微分偏差' : 'Velocity vs numeric diff',
          value: fmtMetric(this.velErr),
          severity: this.velErr < 1e-4 ? 'ok' : 'error',
          hint: zh ? '解析 vP 与位置中心差分的最大相对偏差（基准 < 1e-4）' : 'max relative deviation of analytic vP vs central differences of the position (benchmark < 1e-4)',
        });
      }
    } else if (s.mode === 'cam') {
      const cam = this.cam;
      if (!cam) return;
      metrics.push({
        key: 'pressure-rise',
        label: zh ? '最大压力角（推程）' : 'Max pressure angle (rise)',
        value: fmtMetric(cam.maxPressureRiseDeg),
        unit: '°',
        severity: cam.maxPressureRiseDeg <= 30 ? 'ok' : 'warn',
        hint: zh ? '推荐 α ≤ 30°；tan α = |ds/dθ − e|/(s + √(r0² − e²))' : 'recommended α ≤ 30 deg; tan α = |ds/dθ − e|/(s + √(r0² − e²))',
      });
      metrics.push({
        key: 'pressure-return',
        label: zh ? '最大压力角（回程）' : 'Max pressure angle (return)',
        value: fmtMetric(cam.maxPressureReturnDeg),
        unit: '°',
        severity: cam.maxPressureReturnDeg <= 35 ? 'ok' : 'warn',
      });
      metrics.push({
        key: 'undercut',
        label: zh ? '根切' : 'Undercut',
        value: cam.undercut ? (zh ? '是 — 减小滚子或加大基圆' : 'yes — smaller roller / larger base circle') : zh ? '否' : 'no',
        severity: cam.undercut ? 'error' : 'ok',
        hint: zh
          ? `凸段理论廓线最小曲率半径 ${fmtMetric(cam.minConvexCurvatureR)} vs 滚子半径 ${fmtMetric(this.state.rollerR)}`
          : `min CONVEX pitch-curve radius ${fmtMetric(cam.minConvexCurvatureR)} vs roller radius ${fmtMetric(this.state.rollerR)}`,
      });
      metrics.push({
        key: 'follower-v',
        label: zh ? '从动件最大速度' : 'Max follower speed',
        value: fmtMetric(cam.vMax),
        hint: zh ? 'ds/dθ 峰值（rad/s 下按 θ 折算）' : 'peak ds/dθ (per rad of cam angle)',
      });
      metrics.push({
        key: 'follower-a',
        label: zh ? '从动件最大加速度' : 'Max follower acceleration',
        value: fmtMetric(cam.aMax),
      });
    } else {
      if (this.planet) {
        const p = this.planet;
        metrics.push({ key: 'zr', label: zh ? '齿圈齿数 zr' : 'Ring teeth zr', value: String(p.zr), hint: 'zr = zs + 2·zp' });
        metrics.push({
          key: 'w-sun',
          label: zh ? '太阳轮角速度 ωs' : 'Sun speed ωs',
          value: fmtMetric(p.wSun),
          unit: 'rad/s',
        });
        metrics.push({ key: 'w-ring', label: zh ? '齿圈角速度 ωr' : 'Ring speed ωr', value: fmtMetric(p.wRing), unit: 'rad/s' });
        metrics.push({ key: 'w-carrier', label: zh ? '行星架角速度 ωH' : 'Carrier speed ωH', value: fmtMetric(p.wCarrier), unit: 'rad/s' });
        metrics.push({
          key: 'willis-residual',
          label: zh ? 'Willis 方程残差' : 'Willis residual',
          value: fmtMetric(Math.abs(p.residual)),
          severity: Math.abs(p.residual) < 1e-9 ? 'ok' : 'error',
          hint: 'ωs + ρ·ωr − (1+ρ)·ωH = 0, ρ = zr/zs',
        });
      } else if (this.train) {
        const t = this.train;
        metrics.push({
          key: 'ratio',
          label: zh ? '总传动比 i = ω出/ω入' : 'Overall ratio ωout/ωin',
          value: fmtMetric(t.ratio),
          severity: 'info',
          hint: zh ? '各级传动比之积（外啮合变号）' : 'product of stage ratios (external meshes flip the sign)',
        });
        metrics.push({ key: 'reduction', label: zh ? '减速倍数 |i|⁻¹' : 'Reduction |i|⁻¹', value: fmtMetric(t.reduction) });
        metrics.push({
          key: 'direction',
          label: zh ? '输出转向' : 'Output direction',
          value: t.reversed ? (zh ? '反向' : 'reversed') : zh ? '同向' : 'same',
          severity: 'info',
        });
      }
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- benchmarks ------------------------------------------------------------

  /** Kernel validation battery, published to the science outputs. */
  private runBenchmarks(): void {
    const zh = this.zh;
    const metrics: ScienceMetric[] = [];
    try {
      // 1) Four-bar closure residual over full revolutions (both branches).
      const sets: FourBarLinks[] = [
        { a: 1, b: 3.5, c: 3, d: 4 },
        { a: 1, b: 4, c: 3, d: 4 },
        { a: 3, b: 4, c: 4, d: 1 },
      ];
      let maxRes = 0;
      for (const l of sets) {
        for (const branch of ['open', 'crossed'] as Branch[]) {
          const sw = sweepFourBar(l, branch, { p: l.b / 2, q: 0 }, 1, 180);
          maxRes = Math.max(maxRes, sw.maxResidual);
        }
      }
      metrics.push({
        key: 'bench-closure',
        label: zh ? '基准：四杆闭环残差' : 'Benchmark: four-bar closure',
        value: fmtMetric(maxRes),
        severity: maxRes < 1e-9 ? 'ok' : 'error',
        hint: zh ? '三个 Grashof 链 × 双分支整周扫描，基准 < 1e-9' : 'three Grashof chains x both branches, full revolutions, benchmark < 1e-9',
      });

      // 2) Coupler-point velocity vs central differences of the position.
      {
        const l: FourBarLinks = { a: 1, b: 3.5, c: 3, d: 4 };
        const cp = { p: 2, q: 1 };
        const w2 = 2;
        let maxErr = 0;
        for (let i = 0; i < 24; i += 1) {
          const t2 = (i / 24) * MECH_TAU;
          const pose = solveFourBar(l, t2, 'open');
          const w3 = ((l.a * w2) / l.b) * (Math.sin(pose.theta4 - t2) / Math.sin(pose.theta3 - pose.theta4));
          const px = pose.A[0] + cp.p * Math.cos(pose.theta3) - cp.q * Math.sin(pose.theta3);
          const py = pose.A[1] + cp.p * Math.sin(pose.theta3) + cp.q * Math.cos(pose.theta3);
          const vx = -l.a * w2 * Math.sin(t2) - w3 * (py - pose.A[1]);
          const vy = l.a * w2 * Math.cos(t2) + w3 * (px - pose.A[0]);
          const n = couplerVelocityNumeric(l, t2, w2, 'open', cp);
          maxErr = Math.max(maxErr, Math.hypot(vx - n[0], vy - n[1]) / Math.max(Math.hypot(n[0], n[1]), 1e-12));
        }
        metrics.push({
          key: 'bench-vp',
          label: zh ? '基准：vP vs 数值微分' : 'Benchmark: vP vs numeric diff',
          value: fmtMetric(maxErr),
          severity: maxErr < 1e-4 ? 'ok' : 'error',
          hint: zh ? '解析速度与位置中心差分的最大相对偏差，基准 < 1e-4' : 'max relative deviation vs central differences, benchmark < 1e-4',
        });
      }

      // 3) Cam motion laws: SHM continuous cosine acceleration; cycloidal /
      //    3-4-5 exactly zero end acceleration.
      {
        const SHM_A0 = Math.PI * Math.PI / 2;
        let shmDev = 0;
        for (let i = 0; i <= 200; i += 1) {
          const tau = i / 200;
          const m = motionSample('shm', tau);
          shmDev = Math.max(shmDev, Math.abs(m.a - SHM_A0 * Math.cos(Math.PI * tau)));
        }
        const cyc = motionSample('cycloid', 0);
        const cyc1 = motionSample('cycloid', 1);
        const p345 = motionSample('poly345', 0);
        const p3451 = motionSample('poly345', 1);
        const endAcc = Math.max(Math.abs(cyc.a), Math.abs(cyc1.a), Math.abs(p345.a), Math.abs(p3451.a));
        const ok = shmDev < 1e-9 && endAcc < 1e-9;
        metrics.push({
          key: 'bench-laws',
          label: zh ? '基准：凸轮运动规律' : 'Benchmark: cam motion laws',
          value: `${fmtMetric(Math.max(shmDev, endAcc))}`,
          severity: ok ? 'ok' : 'error',
          hint: zh
            ? 'SHM 加速度=连续余弦（最大偏差）；摆线/3-4-5 端点加速度=0（最大值）'
            : 'SHM acceleration = continuous cosine (max dev); cycloidal / 3-4-5 end acceleration = 0 (max)',
        });
      }

      // 4) Cam pressure angle: pointwise formula + monotone in base radius.
      {
        const mk = (r0: number): CamParams => ({
          r0,
          rollerR: 8,
          stroke: 20,
          timing: parseCamTiming('120,60,120'),
          offset: 0,
          lawRise: 'cycloid',
          lawReturn: 'cycloid',
        });
        const cam = designCam(mk(40), 720);
        const theta = (60 * MECH_DEG);
        const st = camState(mk(40), theta);
        const expected = Math.atan2(Math.abs(st.ds), st.s + 40) / MECH_DEG;
        const sample = cam.samples.find((smp) => Math.abs(smp.theta - theta) < 1e-9);
        const pointErr = sample ? Math.abs(sample.pressureDeg - expected) : Number.POSITIVE_INFINITY;
        const bigger = designCam(mk(60), 720);
        const ok = pointErr < 1e-9 && bigger.maxPressureRiseDeg < cam.maxPressureRiseDeg && cam.maxPressureRiseDeg > 0;
        metrics.push({
          key: 'bench-pressure',
          label: zh ? '基准：凸轮压力角' : 'Benchmark: cam pressure angle',
          value: fmtMetric(pointErr),
          severity: ok ? 'ok' : 'error',
          hint: zh
            ? '中程逐点公式校核 + 基圆加大 → 最大压力角单调减小'
            : 'pointwise formula check at mid-rise + larger base circle strictly lowers the max pressure angle',
        });
      }

      // 5) Willis planetary: ring fixed, sun input → i = 1 + zr/zs (closed form).
      {
        const r = willisSolve({ zs: 20, zp: 30, wSun: 10, wRing: 0, wCarrier: null });
        const i = r.wSun / r.wCarrier;
        const analytic = 1 + r.zr / r.zs; // = 1 + 80/20 = 5
        const err = Math.abs(i - analytic) / analytic;
        // Two-input differential case: (10 + 4·(−2))/5 = 0.4.
        const diff = willisSolve({ zs: 20, zp: 30, wSun: 10, wRing: -2, wCarrier: null });
        const diffErr = Math.abs(diff.wCarrier - 0.4);
        const ok = err < 1e-12 && diffErr < 1e-9 && Math.abs(r.residual) < 1e-9;
        metrics.push({
          key: 'bench-willis',
          label: zh ? '基准：Willis 行星轮系' : 'Benchmark: Willis planetary',
          value: `${fmtMetric(err)}`,
          severity: ok ? 'ok' : 'error',
          hint: zh
            ? '齿圈固定 i = 1 + zr/zs = 5（zs=20, zp=30）；双输入差动 ωH = (ωs+ρ·ωr)/(1+ρ) 闭式核对'
            : 'ring fixed i = 1 + zr/zs = 5 (zs=20, zp=30); two-input differential ωH = (ωs+ρ·ωr)/(1+ρ) closed form',
        });
      }

      // 6) Compound train: overall ratio = product of stage ratios.
      {
        const stages = parseGearStages('20/60, 30/90');
        const t = gearTrain(stages);
        const product = stages.reduce((acc, st) => acc * (-st.za / st.zb), 1);
        const err = Math.abs(t.ratio - product);
        const ok = err < 1e-12 && Math.abs(t.ratio - 1 / 9) < 1e-12 && !t.reversed;
        metrics.push({
          key: 'bench-compound',
          label: zh ? '基准：复合轮系传动比' : 'Benchmark: compound train ratio',
          value: fmtMetric(err),
          severity: ok ? 'ok' : 'error',
          hint: zh
            ? '20/60 × 30/90 → i = 1/9（两级外啮合同向），恰为各级之积'
            : '20/60 x 30/90 → i = 1/9 (two external meshes, same direction), exactly the stage product',
        });
      }
      setScienceOutputs(this.manifest.id, metrics);
      notify(this.api, 'success', 'Benchmarks published to science outputs', '基准结果已发布到科学输出');
    } catch (e) {
      notify(this.api, 'error', `Benchmark failed: ${String(e)}`, `基准运行失败：${String(e)}`);
    }
    this.draw();
  }

  // ---- headless compute (Block/Flow) ------------------------------------------

  async compute(input: unknown): Promise<ComputeResult> {
    try {
      const hasInput =
        input !== undefined &&
        input !== null &&
        !(typeof input === 'string' && input.trim() === '') &&
        !(typeof input === 'object' && !Array.isArray(input) && Object.keys(input as object).length === 0);
      const table = hasInput ? this.batchTable(input) : this.modeTable();
      const bytes = table.columns.length * table.length * 8;
      return { ok: true, output: table, metrics: { bytes } };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** Batch four-bar analysis from DataTable / CSV / JSON input. */
  private batchTable(input: unknown): DataTable {
    const rows = parseBatchInput(input);
    const n = rows.length;
    const colA = new Float64Array(n);
    const colB = new Float64Array(n);
    const colC = new Float64Array(n);
    const colD = new Float64Array(n);
    const colType: string[] = [];
    const colCrank: string[] = [];
    const colSwing = new Float64Array(n);
    const colMuMin = new Float64Array(n);
    const colMuMax = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const r = rows[i]!;
      colA[i] = r.a;
      colB[i] = r.b;
      colC[i] = r.c;
      colD[i] = r.d;
      colType.push(r.grashof);
      colCrank.push(r.crankRotates ? 'yes' : 'no');
      colSwing[i] = r.rockerSwingDeg;
      colMuMin[i] = r.minTransmissionDeg;
      colMuMax[i] = r.maxTransmissionDeg;
    }
    return createDataTable('eng-mechanism-batch', [
      { name: 'a', type: 'f64', data: colA, unit: 'm' },
      { name: 'b', type: 'f64', data: colB, unit: 'm' },
      { name: 'c', type: 'f64', data: colC, unit: 'm' },
      { name: 'd', type: 'f64', data: colD, unit: 'm' },
      { name: 'grashof', type: 'string', data: colType },
      { name: 'crank_rotates', type: 'string', data: colCrank },
      { name: 'rocker_swing_deg', type: 'f64', data: colSwing, unit: 'deg' },
      { name: 'mu_min_deg', type: 'f64', data: colMuMin, unit: 'deg' },
      { name: 'mu_max_deg', type: 'f64', data: colMuMax, unit: 'deg' },
    ], { tags: ['mechanism', 'fourbar'], provenance: 'eng-mechanism batch four-bar analysis' });
  }

  /** Current mode's result table (deterministic built-in sample). */
  private modeTable(): DataTable {
    const s = this.state;
    if (s.mode === 'cam') {
      const cam = this.cam ?? designCam(this.camParams(), 720);
      const n = cam.samples.length;
      const th = new Float64Array(n);
      const sv = new Float64Array(n);
      const ds = new Float64Array(n);
      const dds = new Float64Array(n);
      const pa = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        const smp = cam.samples[i]!;
        th[i] = smp.thetaDeg;
        sv[i] = smp.s;
        ds[i] = smp.ds;
        dds[i] = smp.dds;
        pa[i] = smp.pressureDeg;
      }
      return createDataTable('eng-mechanism-cam', [
        { name: 'theta_deg', type: 'f64', data: th, unit: 'deg' },
        { name: 's', type: 'f64', data: sv, unit: 'm' },
        { name: 'ds_dtheta', type: 'f64', data: ds, unit: 'm/rad' },
        { name: 'dds_dtheta2', type: 'f64', data: dds, unit: 'm/rad^2' },
        { name: 'pressure_deg', type: 'f64', data: pa, unit: 'deg' },
      ], { tags: ['mechanism', 'cam'], provenance: 'eng-mechanism cam synthesis' });
    }
    if (s.mode === 'gear') {
      if (this.planet) {
        const p = this.planet;
        const item: string[] = ['sun', 'ring', 'carrier'];
        const teeth = new Float64Array([p.zs, p.zr, Number.NaN]);
        const omega = new Float64Array([p.wSun, p.wRing, p.wCarrier]);
        return createDataTable('eng-mechanism-planetary', [
          { name: 'member', type: 'string', data: item },
          { name: 'teeth', type: 'f64', data: teeth },
          { name: 'omega_rad_s', type: 'f64', data: omega, unit: 'rad/s' },
        ], { tags: ['mechanism', 'gear', 'planetary'], provenance: 'eng-mechanism Willis solve' });
      }
      const t = this.train ?? gearTrain(parseGearStages(s.stagesText));
      const n = t.stages.length + 1;
      const item: string[] = [];
      const za = new Float64Array(n);
      const zb = new Float64Array(n);
      const ratio = new Float64Array(n);
      for (let i = 0; i < t.stages.length; i += 1) {
        const st = t.stages[i]!;
        item.push(`stage ${i + 1}`);
        za[i] = st.za;
        zb[i] = st.zb;
        ratio[i] = st.ratio;
      }
      item.push('overall');
      ratio[n - 1] = t.ratio;
      return createDataTable('eng-mechanism-train', [
        { name: 'stage', type: 'string', data: item },
        { name: 'za', type: 'f64', data: za },
        { name: 'zb', type: 'f64', data: zb },
        { name: 'ratio', type: 'f64', data: ratio },
      ], { tags: ['mechanism', 'gear'], provenance: 'eng-mechanism fixed-axis train' });
    }
    // fourbar / velocity: per-angle kinematic table.
    const sw = this.sweep ?? sweepFourBar(this.links, s.branch, { p: s.cpP, q: s.cpQ }, s.w2, 360);
    const n = sw.theta2Deg.length;
    const th = new Float64Array(n);
    const t3 = new Float64Array(n);
    const t4 = new Float64Array(n);
    const px = new Float64Array(n);
    const py = new Float64Array(n);
    const vp = new Float64Array(n);
    const mu = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      th[i] = sw.theta2Deg[i]!;
      t3[i] = sw.theta3Deg[i]!;
      t4[i] = sw.theta4Deg[i]!;
      px[i] = sw.couplerX[i]!;
      py[i] = sw.couplerY[i]!;
      vp[i] = sw.vPmag[i]!;
      mu[i] = sw.muDeg[i]!;
    }
    return createDataTable('eng-mechanism-fourbar', [
      { name: 'theta2_deg', type: 'f64', data: th, unit: 'deg' },
      { name: 'theta3_deg', type: 'f64', data: t3, unit: 'deg' },
      { name: 'theta4_deg', type: 'f64', data: t4, unit: 'deg' },
      { name: 'coupler_x', type: 'f64', data: px, unit: 'm' },
      { name: 'coupler_y', type: 'f64', data: py, unit: 'm' },
      { name: 'vP_mag', type: 'f64', data: vp, unit: 'm/s' },
      { name: 'mu_deg', type: 'f64', data: mu, unit: 'deg' },
    ], { tags: ['mechanism', 'fourbar'], provenance: 'eng-mechanism four-bar sweep' });
  }

  // ---- export ----------------------------------------------------------------

  private exportCsv(): void {
    if (this.dirty) this.recompute(false);
    if (this.errorMsg) {
      notify(this.api, 'warning', `Nothing to export: ${this.errorMsg}`, `无可导出数据：${this.errorMsg}`);
      return;
    }
    const table = this.modeTable();
    const header = table.columnNames();
    const rows: Array<Array<string | number>> = [];
    for (let i = 0; i < table.length; i += 1) {
      const row: Array<string | number> = [];
      for (const name of header) {
        const col = table.getColumn(name);
        const v = col ? (col as ArrayLike<string | number>)[i] : '';
        row.push(typeof v === 'number' ? Number(v.toPrecision(8)) : String(v ?? ''));
      }
      rows.push(row);
    }
    exportRowsCsv(this.api, `mechanism-${this.state.mode}`, header, rows);
  }

  private async sendToFigure(): Promise<void> {
    if (this.dirty) this.recompute(false);
    if (this.errorMsg || (this.state.mode !== 'gear' && !this.sweep && !this.cam)) {
      notify(this.api, 'warning', 'Nothing to send — run the analysis first.', '暂无可发送内容 — 请先运行分析。');
      return;
    }
    const titles: Record<Mode, Bilingual> = {
      fourbar: { zh: '四杆机构运动学分析', en: 'Four-bar kinematics analysis' },
      velocity: { zh: '四杆机构速度分析', en: 'Four-bar velocity analysis' },
      cam: { zh: '凸轮轮廓综合', en: 'Cam profile synthesis' },
      gear: { zh: '轮系分析', en: 'Gear train analysis' },
    };
    let caption: Bilingual;
    if ((this.state.mode === 'fourbar' || this.state.mode === 'velocity') && this.sweep) {
      const sw = this.sweep;
      caption = {
        zh: `Grashof：${GRASHOF_ZH[sw.grashof]}，μmin = ${fmtMetric(sw.minTransmissionDeg)}°，摇杆摆角 = ${fmtMetric(sw.rockerSwingDeg)}°，闭环残差 ${fmtMetric(sw.maxResidual)}。`,
        en: `Grashof: ${GRASHOF_EN[sw.grashof]}, min transmission angle = ${fmtMetric(sw.minTransmissionDeg)} deg, rocker swing = ${fmtMetric(sw.rockerSwingDeg)} deg, closure residual ${fmtMetric(sw.maxResidual)}.`,
      };
    } else if (this.state.mode === 'cam' && this.cam) {
      const cam = this.cam;
      caption = {
        zh: `最大压力角（推程）= ${fmtMetric(cam.maxPressureRiseDeg)}°，${cam.undercut ? '存在根切风险' : '无根切'}，凸段最小曲率半径 ${fmtMetric(cam.minConvexCurvatureR)}。`,
        en: `Max pressure angle (rise) = ${fmtMetric(cam.maxPressureRiseDeg)} deg, ${cam.undercut ? 'undercut risk' : 'no undercut'}, min convex curvature radius ${fmtMetric(cam.minConvexCurvatureR)}.`,
      };
    } else {
      caption = { zh: '轮系传动比分析。', en: 'Gear-train ratio analysis.' };
    }
    await pushPanelsToFigure(
      this.api,
      titles[this.state.mode],
      caption,
      mechanismFigurePanels({ mode: this.state.mode, sweep: this.sweep, cam: this.cam }),
    );
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

    if (this.dirty && !this.state.running) this.recompute(false);

    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    if (this.errorMsg) {
      g.fillStyle = 'rgba(255,140,140,0.95)';
      g.font = this.fnt(13);
      g.textAlign = 'center';
      g.fillText(
        this.zh ? `参数无效：${this.errorMsg}` : `Invalid parameters: ${this.errorMsg}`,
        canvas.width / 2,
        canvas.height / 2,
      );
      return;
    }
    const hasData =
      this.state.mode === 'gear' ? !!(this.train || this.planet) : !!(this.sweep || this.cam);
    if (!hasData) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'Mechanism Kinematics',
        titleZh: '机构运动学',
        hint: 'Adjust the parameters and press "Analyze".',
        hintZh: '调整参数后点击「分析」。',
      });
      return;
    }

    const w = canvas.width;
    const h = canvas.height;
    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = COLOR_INK;
    g.font = this.fnt(13);
    const titles: Record<Mode, [string, string]> = {
      fourbar: ['机构运动学 · 四杆机构', 'Mechanism kinematics · four-bar linkage'],
      velocity: ['机构运动学 · 速度分析（瞬心 + 速度多边形）', 'Mechanism kinematics · velocity analysis (instant centers + polygon)'],
      cam: ['机构运动学 · 盘形凸轮轮廓综合', 'Mechanism kinematics · disk-cam profile synthesis'],
      gear: ['机构运动学 · 轮系', 'Mechanism kinematics · gear trains'],
    };
    g.fillText(zh ? titles[this.state.mode][0] : titles[this.state.mode][1], w / 2, 18);

    const padL = 16;
    const padR = 16;
    const padT = 28;
    const padB = 46;
    const fullW = w - padL - padR;
    const fullH = h - padT - padB;
    const gap = 10;
    if (this.state.mode === 'gear') {
      const sceneW = Math.min(fullW * 0.62, fullH * 1.4);
      this.drawGearScene(g, { x: padL, y: padT, w: sceneW, h: fullH });
      this.drawGearSummary(g, { x: padL + sceneW + gap, y: padT, w: fullW - sceneW - gap, h: fullH });
    } else {
      const sceneW = Math.min(fullW * 0.52, fullH * 1.05);
      const sceneR: Rect = { x: padL, y: padT, w: sceneW, h: fullH };
      const chartX = padL + sceneW + gap;
      const chartW = fullW - sceneW - gap;
      if (this.state.mode === 'cam') {
        this.drawCamScene(g, sceneR);
        const ch = (fullH - gap) / 2;
        const cam = this.cam!;
        const thetas = cam.samples.map((smp) => smp.thetaDeg);
        drawChart(
          g,
          { x: chartX, y: padT, w: chartW, h: ch },
          zh ? '从动件位移 s(θ)' : 'Follower displacement s(θ)',
          zh ? '凸轮转角 (deg)' : 'cam angle (deg)',
          's',
          [{ xs: thetas, ys: cam.samples.map((smp) => smp.s), color: COLOR_BLUE }],
          [{ x: this.state.camThetaDeg, y: camState(this.camParams(), (this.state.camThetaDeg * MECH_DEG)).s, color: COLOR_ROSE }],
          [],
          zh,
        );
        const cp = this.camParams();
        const stCur = camState(cp, this.state.camThetaDeg * MECH_DEG);
        const s0 = Math.sqrt(cp.r0 * cp.r0 - cp.offset * cp.offset);
        drawChart(
          g,
          { x: chartX, y: padT + ch + gap, w: chartW, h: ch },
          zh ? '压力角 α(θ)' : 'Pressure angle α(θ)',
          zh ? '凸轮转角 (deg)' : 'cam angle (deg)',
          'α (deg)',
          [{ xs: thetas, ys: cam.samples.map((smp) => smp.pressureDeg), color: COLOR_ROSE }],
          [{ x: this.state.camThetaDeg, y: (Math.atan2(Math.abs(stCur.ds - cp.offset), stCur.s + s0) / MECH_DEG), color: COLOR_ROSE }],
          [{ y: 30, color: 'rgba(179,146,94,0.7)' }],
          zh,
        );
      } else {
        const sw = this.sweep!;
        const view = this.velocityViewSafe();
        this.drawMechanismScene(g, sceneR, sw, view, this.state.mode === 'velocity');
        const ch = (fullH - gap) / 2;
        drawChart(
          g,
          { x: chartX, y: padT, w: chartW, h: ch },
          zh ? '传动角 μ(θ2)' : 'Transmission angle μ(θ2)',
          zh ? '曲柄角 θ2 (deg)' : 'crank angle θ2 (deg)',
          'μ (deg)',
          [{ xs: sw.theta2Deg, ys: sw.muDeg, color: COLOR_BLUE }],
          [{ x: this.state.thetaDeg, y: this.muAtCurrent(), color: COLOR_ROSE }],
          [{ y: 40, color: 'rgba(179,146,94,0.7)' }],
          zh,
        );
        drawChart(
          g,
          { x: chartX, y: padT + ch + gap, w: chartW, h: ch },
          this.state.mode === 'velocity' ? (zh ? '连杆点速度 |vP|(θ2)' : 'Coupler-point speed |vP|(θ2)') : zh ? '摇杆角速度 ω4(θ2)' : 'Rocker speed ω4(θ2)',
          zh ? '曲柄角 θ2 (deg)' : 'crank angle θ2 (deg)',
          this.state.mode === 'velocity' ? '|vP|' : 'ω4 (rad/s)',
          [
            this.state.mode === 'velocity'
              ? { xs: sw.theta2Deg, ys: sw.vPmag, color: COLOR_SAGE }
              : { xs: sw.theta2Deg, ys: sw.w4, color: COLOR_SAGE },
          ],
          [],
          [],
          zh,
        );
      }
    }
    this.drawFooter(g, h);
  }

  /** Velocity view at the current crank angle (null when unassemblable/singular). */
  private velocityViewSafe() {
    const s = this.state;
    try {
      return velocityView(this.links, s.thetaDeg * MECH_DEG, s.w2, s.branch, { p: s.cpP, q: s.cpQ });
    } catch {
      return null;
    }
  }

  private muAtCurrent(): number {
    const sw = this.sweep;
    if (!sw) return Number.NaN;
    const idx = Math.round(((this.state.thetaDeg % 360) + 360) % 360);
    return sw.muDeg[Math.min(idx, sw.muDeg.length - 1)] ?? Number.NaN;
  }

  /** Fit world points into a rect with margin; y flipped for screen. */
  private fitWorld(pts: Array<[number, number]>, r: Rect, margin = 0.12): { px: (x: number) => number; py: (y: number) => number; scale: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    if (!Number.isFinite(minX)) {
      minX = -1;
      maxX = 1;
      minY = -1;
      maxY = 1;
    }
    if (maxX - minX < 1e-9) {
      maxX += 0.5;
      minX -= 0.5;
    }
    if (maxY - minY < 1e-9) {
      maxY += 0.5;
      minY -= 0.5;
    }
    const mx = (maxX - minX) * margin;
    const my = (maxY - minY) * margin;
    const scale = Math.min(r.w / (maxX - minX + 2 * mx), r.h / (maxY - minY + 2 * my));
    const ox = r.x + (r.w - (maxX - minX) * scale) / 2;
    const oy = r.y + (r.h + (maxY - minY) * scale) / 2;
    return {
      px: (x: number) => ox + (x - minX) * scale,
      py: (y: number) => oy - (y - minY) * scale,
      scale,
    };
  }

  private drawGroundPivot(g: CanvasRenderingContext2D, x: number, y: number): void {
    g.fillStyle = 'rgba(120,140,165,0.9)';
    g.strokeStyle = 'rgba(120,140,165,0.9)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x - 6, y + 8);
    g.lineTo(x + 6, y + 8);
    g.lineTo(x, y);
    g.closePath();
    g.fill();
    for (let k = -1; k <= 1; k += 1) {
      g.beginPath();
      g.moveTo(x + k * 5 - 3, y + 12);
      g.lineTo(x + k * 5 + 3, y + 8);
      g.stroke();
    }
  }

  private drawJoint(g: CanvasRenderingContext2D, x: number, y: number): void {
    g.fillStyle = '#0a0e13';
    g.strokeStyle = COLOR_INK;
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(x, y, 3.2, 0, MECH_TAU);
    g.fill();
    g.stroke();
  }

  private drawMechanismScene(g: CanvasRenderingContext2D, r: Rect, sw: FourBarSweep, view: ReturnType<EngMechanismPlugin['velocityViewSafe']>, showVelocity: boolean): void {
    const zh = this.zh;
    const world: Array<[number, number]> = [[0, 0], [this.links.d, 0]];
    for (let i = 0; i < sw.couplerX.length; i += 1) {
      if (Number.isFinite(sw.couplerX[i]!) && Number.isFinite(sw.couplerY[i]!)) {
        world.push([sw.couplerX[i]!, sw.couplerY[i]!]);
      }
    }
    if (view) {
      world.push([view.pose.A[0], view.pose.A[1]], [view.pose.B[0], view.pose.B[1]], view.P);
    }
    const m = this.fitWorld(world, r, 0.14);
    const px = m.px;
    const py = m.py;

    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();

    // Full coupler-curve trace (dashed, muted).
    g.strokeStyle = 'rgba(111,148,184,0.5)';
    g.setLineDash([5, 4]);
    g.lineWidth = 1.2;
    g.beginPath();
    let pen = false;
    for (let i = 0; i < sw.couplerX.length; i += 1) {
      const x = sw.couplerX[i]!;
      const y = sw.couplerY[i]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        pen = false;
        continue;
      }
      if (!pen) {
        g.moveTo(px(x), py(y));
        pen = true;
      } else {
        g.lineTo(px(x), py(y));
      }
    }
    g.stroke();
    g.setLineDash([]);

    // Ground line + hatched pivots.
    g.strokeStyle = 'rgba(150,165,185,0.6)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(px(0) - 10, py(0));
    g.lineTo(px(this.links.d) + 10, py(0));
    g.stroke();
    this.drawGroundPivot(g, px(0), py(0));
    this.drawGroundPivot(g, px(this.links.d), py(0));

    if (view) {
      const A = view.pose.A;
      const B = view.pose.B;
      // Links: crank, coupler, rocker.
      g.lineCap = 'round';
      g.strokeStyle = COLOR_BLUE;
      g.lineWidth = 4.5;
      g.beginPath();
      g.moveTo(px(0), py(0));
      g.lineTo(px(A[0]), py(A[1]));
      g.stroke();
      g.strokeStyle = COLOR_SAGE;
      g.beginPath();
      g.moveTo(px(A[0]), py(A[1]));
      g.lineTo(px(B[0]), py(B[1]));
      g.stroke();
      g.strokeStyle = COLOR_TAN;
      g.beginPath();
      g.moveTo(px(this.links.d), py(0));
      g.lineTo(px(B[0]), py(B[1]));
      g.stroke();
      // Coupler triangle A-P-B (light).
      g.strokeStyle = 'rgba(138,168,127,0.45)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(px(A[0]), py(A[1]));
      g.lineTo(px(view.P[0]), py(view.P[1]));
      g.lineTo(px(B[0]), py(B[1]));
      g.stroke();
      // Kennedy instant center I13.
      if (view.i13 && Number.isFinite(view.i13[0])) {
        const ix = px(view.i13[0]);
        const iy = py(view.i13[1]);
        if (ix > r.x && ix < r.x + r.w && iy > r.y && iy < r.y + r.h) {
          g.strokeStyle = COLOR_PURPLE;
          g.lineWidth = 1.4;
          g.beginPath();
          g.moveTo(ix - 6, iy - 6);
          g.lineTo(ix + 6, iy + 6);
          g.moveTo(ix - 6, iy + 6);
          g.lineTo(ix + 6, iy - 6);
          g.stroke();
          g.fillStyle = COLOR_PURPLE;
          g.font = '10px Consolas, monospace';
          g.textAlign = 'left';
          g.fillText('I13', ix + 8, iy - 6);
        }
      }
      // Joints.
      this.drawJoint(g, px(A[0]), py(A[1]));
      this.drawJoint(g, px(B[0]), py(B[1]));
      this.drawJoint(g, px(0), py(0));
      this.drawJoint(g, px(this.links.d), py(0));
      // Coupler point P.
      g.fillStyle = COLOR_ROSE;
      g.beginPath();
      g.arc(px(view.P[0]), py(view.P[1]), 3.5, 0, MECH_TAU);
      g.fill();
      g.font = '10px Consolas, monospace';
      g.textAlign = 'left';
      g.fillStyle = COLOR_ROSE;
      g.fillText('P', px(view.P[0]) + 6, py(view.P[1]) - 5);

      if (showVelocity) {
        // Velocity arrows at A, B, P scaled to the scene.
        const maxV = Math.max(Math.hypot(view.vA[0], view.vA[1]), Math.hypot(view.vB[0], view.vB[1]), Math.hypot(view.vP[0], view.vP[1]), 1e-9);
        const vs = (Math.min(r.w, r.h) * 0.32) / maxV;
        drawArrow(g, px(A[0]), py(A[1]), px(A[0]) + view.vA[0] * vs, py(A[1]) - view.vA[1] * vs, 'rgba(111,148,184,0.9)');
        drawArrow(g, px(B[0]), py(B[1]), px(B[0]) + view.vB[0] * vs, py(B[1]) - view.vB[1] * vs, 'rgba(179,146,94,0.9)');
        drawArrow(g, px(view.P[0]), py(view.P[1]), px(view.P[0]) + view.vP[0] * vs, py(view.P[1]) - view.vP[1] * vs, 'rgba(184,115,111,0.95)');
        // Relative-velocity polygon inset (top-right).
        this.drawPolygonInset(g, { x: r.x + r.w - 118, y: r.y + 8, w: 110, h: 96 }, view);
      }
      // Link labels.
      g.font = '10px Consolas, monospace';
      g.fillStyle = COLOR_MUTED;
      g.textAlign = 'center';
      g.fillText('O2', px(0) - 10, py(0) + 14);
      g.fillText('O4', px(this.links.d) + 12, py(0) + 14);
      g.fillText('A', px(A[0]) + 8, py(A[1]) - 6);
      g.fillText('B', px(B[0]) + 8, py(B[1]) - 6);
    }

    // Scene caption.
    g.fillStyle = COLOR_MUTED;
    g.font = this.fnt(11);
    g.textAlign = 'left';
    const thetaTxt = `θ2 = ${fmtTick(this.state.thetaDeg)}°`;
    g.fillText(thetaTxt, r.x + 6, r.y + r.h - 6);
    if (showVelocity && view) {
      g.fillText(zh ? `|vP| = ${fmtMetric(Math.hypot(view.vP[0], view.vP[1]))}` : `|vP| = ${fmtMetric(Math.hypot(view.vP[0], view.vP[1]))}`, r.x + 80, r.y + r.h - 6);
    }
    g.restore();
  }

  /** Relative-velocity polygon inset: p→a (vA), a→b (vBA), p→b (vB), a→c (vCA), p→c (vP). */
  private drawPolygonInset(g: CanvasRenderingContext2D, r: Rect, view: NonNullable<ReturnType<EngMechanismPlugin['velocityViewSafe']>>): void {
    const zh = this.zh;
    g.fillStyle = 'rgba(10,14,19,0.82)';
    g.fillRect(r.x, r.y, r.w, r.h);
    g.strokeStyle = COLOR_FRAME;
    g.lineWidth = 1;
    g.strokeRect(r.x, r.y, r.w, r.h);
    g.fillStyle = COLOR_MUTED;
    g.font = '9px Consolas, monospace';
    g.textAlign = 'left';
    g.fillText(zh ? '速度多边形' : 'velocity polygon', r.x + 4, r.y + 11);
    const pole: [number, number] = [r.x + r.w * 0.35, r.y + r.h * 0.72];
    const vecs = view.polygon.map((seg) => [seg.dx, seg.dy] as [number, number]);
    let maxLen = 0;
    for (const v of vecs) maxLen = Math.max(maxLen, Math.hypot(v[0], v[1]));
    const k = maxLen > 0 ? (Math.min(r.w, r.h) * 0.6) / maxLen : 0;
    const ax = pole[0] + view.polygon[0]!.dx * k;
    const ay = pole[1] - view.polygon[0]!.dy * k;
    const bx = pole[0] + (view.polygon[0]!.dx + view.polygon[1]!.dx) * k;
    const by = pole[1] - (view.polygon[0]!.dy + view.polygon[1]!.dy) * k;
    const cx = pole[0] + view.polygon[4]!.dx * k;
    const cy = pole[1] - view.polygon[4]!.dy * k;
    g.strokeStyle = COLOR_BLUE;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(pole[0], pole[1]);
    g.lineTo(ax, ay);
    g.stroke();
    g.strokeStyle = COLOR_TAN;
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx, by);
    g.stroke();
    g.strokeStyle = 'rgba(179,146,94,0.6)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(pole[0], pole[1]);
    g.lineTo(bx, by);
    g.stroke();
    g.strokeStyle = COLOR_ROSE;
    g.setLineDash([]);
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(cx, cy);
    g.stroke();
    g.strokeStyle = 'rgba(184,115,111,0.6)';
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(pole[0], pole[1]);
    g.lineTo(cx, cy);
    g.stroke();
    g.setLineDash([]);
    for (const [x, y, label] of [
      [ax, ay, 'a'],
      [bx, by, 'b'],
      [cx, cy, 'c'],
    ] as Array<[number, number, string]>) {
      g.fillStyle = COLOR_INK;
      g.beginPath();
      g.arc(x, y, 2, 0, MECH_TAU);
      g.fill();
      g.fillText(label, x + 4, y - 3);
    }
    g.fillStyle = COLOR_MUTED;
    g.fillText('p', pole[0] - 8, pole[1] + 4);
  }

  private drawCamScene(g: CanvasRenderingContext2D, r: Rect): void {
    const cam = this.cam;
    if (!cam) return;
    const s = this.state;
    const theta = s.camThetaDeg * MECH_DEG;
    const st = camState(this.camParams(), theta);
    const e = s.offset;
    const s0 = Math.sqrt(s.r0 * s.r0 - e * e);
    const rho = st.s + s0;
    // Rotate the cam body so the current pitch point sits at the top (+y).
    const phi = Math.atan2(rho * Math.sin(theta) + e * Math.cos(theta), rho * Math.cos(theta) - e * Math.sin(theta));
    const delta = Math.PI / 2 - phi;
    const cd = Math.cos(delta);
    const sd = Math.sin(delta);
    const world: Array<[number, number]> = [];
    for (const smp of cam.samples) {
      world.push([smp.actualX, smp.actualY]);
      world.push([smp.pitchX, smp.pitchY]);
    }
    world.push([-(s.r0 + s.stroke + 2 * s.rollerR), 0], [s.r0 + s.stroke + 2 * s.rollerR, 0]);
    const m = this.fitWorld(world, r, 0.12);
    const cx = (r.x + r.w) / 2 - ((0 + m.px(0)) - (r.x + r.w / 2));
    // Center the cam on the horizontal middle of the scene rect.
    const originX = r.x + r.w / 2;
    const originY = r.y + r.h * 0.62;
    const tx = (x: number, y: number): [number, number] => [originX + (x * cd - y * sd) * m.scale, originY - (x * sd + y * cd) * m.scale];

    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();

    // Base circle (dotted).
    g.strokeStyle = 'rgba(150,165,185,0.4)';
    g.setLineDash([2, 4]);
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= 90; i += 1) {
      const a = (i / 90) * MECH_TAU;
      const [sx, sy] = tx(s.r0 * Math.cos(a), s.r0 * Math.sin(a));
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.stroke();
    g.setLineDash([]);

    // Pitch curve (dashed) and actual profile (solid).
    const drawLoop = (getX: (smp: CamSample) => number, getY: (smp: CamSample) => number, color: string, dash: number[], width: number): void => {
      g.strokeStyle = color;
      g.lineWidth = width;
      if (dash.length) g.setLineDash(dash);
      g.beginPath();
      for (let i = 0; i < cam.samples.length; i += 1) {
        const smp = cam.samples[i]!;
        const [sx, sy] = tx(getX(smp), getY(smp));
        if (i === 0) g.moveTo(sx, sy);
        else g.lineTo(sx, sy);
      }
      g.closePath();
      g.stroke();
      g.setLineDash([]);
    };
    drawLoop((smp) => smp.pitchX, (smp) => smp.pitchY, 'rgba(111,148,184,0.55)', [5, 4], 1.1);
    drawLoop((smp) => smp.actualX, (smp) => smp.actualY, COLOR_INK, [], 1.8);

    // Cam center + rotation mark.
    this.drawJoint(g, originX, originY);
    drawArrow(g, originX + 14, originY - 4, originX + 26, originY - 10, COLOR_MUTED, 1.2);

    // Follower: roller at the top of the pitch radius, stem and guide.
    const rollerX = originX;
    const rollerY = originY - rho * m.scale;
    g.strokeStyle = COLOR_MUTED;
    g.lineWidth = 1;
    // Guide (two vertical lines) — the follower translates along +y.
    const guideHalf = s.rollerR * m.scale * 0.8;
    const guideTop = r.y + 8;
    g.beginPath();
    g.moveTo(rollerX - guideHalf, guideTop);
    g.lineTo(rollerX - guideHalf, rollerY - s.rollerR * m.scale - 4);
    g.moveTo(rollerX + guideHalf, guideTop);
    g.lineTo(rollerX + guideHalf, rollerY - s.rollerR * m.scale - 4);
    g.stroke();
    // Stem from roller up to the guide top.
    g.strokeStyle = COLOR_SAGE;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(rollerX, rollerY);
    g.lineTo(rollerX, guideTop);
    g.stroke();
    // Roller circle.
    g.fillStyle = 'rgba(10,14,19,0.9)';
    g.strokeStyle = COLOR_ROSE;
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(rollerX, rollerY, s.rollerR * m.scale, 0, MECH_TAU);
    g.fill();
    g.stroke();

    // Pressure-angle normal at the contact (tilted α from the follower axis).
    if (Math.abs(e) > 0) {
      const alpha = Math.atan2(Math.abs(st.ds - e), st.s + s0);
      const sign = st.ds - e >= 0 ? 1 : -1;
      const nx = Math.sin(alpha) * sign;
      const ny = Math.cos(alpha);
      g.strokeStyle = 'rgba(154,134,168,0.85)';
      g.setLineDash([4, 3]);
      g.lineWidth = 1.2;
      g.beginPath();
      g.moveTo(rollerX, rollerY);
      g.lineTo(rollerX + nx * 30, rollerY + ny * 30);
      g.moveTo(rollerX, rollerY);
      g.lineTo(rollerX - nx * 30, rollerY + ny * 30);
      g.stroke();
      g.setLineDash([]);
    }

    // Caption.
    g.fillStyle = COLOR_MUTED;
    g.font = this.fnt(11);
    g.textAlign = 'left';
    g.fillText(
      `θ = ${fmtTick(s.camThetaDeg)}°  s = ${fmtMetric(st.s)}  α = ${fmtMetric((Math.atan2(Math.abs(st.ds - e), st.s + s0) * 180) / Math.PI)}°`,
      r.x + 6,
      r.y + r.h - 6,
    );
    g.textAlign = 'right';
    g.fillText(this.zh ? '实线：实际廓线 · 虚线：理论廓线' : 'solid: actual · dashed: pitch', r.x + r.w - 6, r.y + r.h - 6);
    g.restore();
    // cx unused marker (keeps lint calm without changing behavior).
    void cx;
  }

  private drawGearScene(g: CanvasRenderingContext2D, r: Rect): void {
    const zh = this.zh;
    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();
    if (this.planet) {
      this.drawPlanetary(g, r);
    } else if (this.train) {
      // Fixed-axis train: stages left to right, pitch radii proportional to z.
      const stages = this.train.stages;
      const mModule = 1; // unit module; radii = z/2
      let totalW = 0;
      for (const st of stages) totalW += (st.za + st.zb) * mModule;
      totalW *= 0.5;
      const scale = Math.min((r.w - 40) / totalW, (r.h - 60) / (2 * 1.2 * Math.max(...stages.map((st) => Math.max(st.za, st.zb))) * 0.5));
      const cy = r.y + r.h / 2;
      let x = r.x + 20;
      const radii: number[] = [];
      const centers: Array<[number, number]> = [];
      let first = true;
      for (const st of stages) {
        const ra = (st.za * mModule * scale) / 2;
        const rb = (st.zb * mModule * scale) / 2;
        if (first) {
          x += ra;
          centers.push([x, cy]);
          radii.push(ra);
          first = false;
          x += ra + rb;
          centers.push([x, cy]);
          radii.push(rb);
        } else {
          // Driven gear of the previous stage is rigidly connected to the
          // driver of this stage (compound shaft): reuse that center when the
          // tooth counts match, otherwise place a coaxial circle.
          const prev = radii[radii.length - 1]!;
          if (Math.abs(prev - ra) < 1e-9) {
            radii[radii.length - 1] = ra;
          } else {
            centers.push([centers[centers.length - 1]![0], cy]);
            radii.push(ra);
          }
          x = centers[centers.length - 1]![0] + ra + rb;
          centers.push([x, cy]);
          radii.push(rb);
        }
      }
      // Draw pitch circles + shafts + labels.
      g.font = '10px Consolas, monospace';
      for (let i = 0; i < centers.length; i += 1) {
        const [cx0, cy0] = centers[i]!;
        const rad = radii[i]!;
        g.strokeStyle = i % 2 === 0 ? COLOR_BLUE : COLOR_TAN;
        g.lineWidth = 1.8;
        g.beginPath();
        g.arc(cx0, cy0, rad, 0, MECH_TAU);
        g.stroke();
        g.strokeStyle = 'rgba(150,165,185,0.35)';
        g.setLineDash([3, 3]);
        g.beginPath();
        g.arc(cx0, cy0, rad * 0.94, 0, MECH_TAU);
        g.stroke();
        g.setLineDash([]);
        this.drawJoint(g, cx0, cy0);
        g.fillStyle = COLOR_MUTED;
        g.textAlign = 'center';
        const zLabel = `z=${Math.round((rad * 2) / (mModule * scale))}`;
        g.fillText(zLabel, cx0, cy0 - rad - 6);
      }
      // Compound shafts (thicker line between consecutive coaxial centers).
      g.strokeStyle = COLOR_SAGE;
      g.lineWidth = 2.2;
      for (let i = 1; i < centers.length; i += 1) {
        if (Math.abs(centers[i]![0] - centers[i - 1]![0]) < 1e-6) {
          g.beginPath();
          g.moveTo(centers[i - 1]![0], centers[i - 1]![1] - 8);
          g.lineTo(centers[i]![0], centers[i]![1] + 8);
          g.stroke();
        }
      }
      g.fillStyle = COLOR_MUTED;
      g.textAlign = 'left';
      g.fillText(zh ? '节圆半径 ∝ 齿数（示意）' : 'pitch radii proportional to teeth (schematic)', r.x + 6, r.y + r.h - 6);
    }
    g.restore();
  }

  private drawPlanetary(g: CanvasRenderingContext2D, r: Rect): void {
    const p = this.planet!;
    const zh = this.zh;
    // Pitch radii: sun zs/2, planet zp/2, ring zr/2 (unit module).
    const maxR = p.zr / 2;
    const scale = Math.min((r.w - 30) / (2 * maxR), (r.h - 50) / (2 * maxR));
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2 + 6;
    const rSun = (p.zs / 2) * scale;
    const rPlanet = (p.zp / 2) * scale;
    const rRing = (p.zr / 2) * scale;
    // Ring (two concentric circles).
    g.strokeStyle = COLOR_TAN;
    g.lineWidth = 1.8;
    g.beginPath();
    g.arc(cx, cy, rRing, 0, MECH_TAU);
    g.stroke();
    g.beginPath();
    g.arc(cx, cy, rRing + 4, 0, MECH_TAU);
    g.stroke();
    // Carrier lines to 3 planets at 120 deg.
    g.strokeStyle = COLOR_SAGE;
    g.lineWidth = 1.6;
    for (let k = 0; k < 3; k += 1) {
      const a = (k / 3) * MECH_TAU;
      const pxp = cx + (rSun + rPlanet) * Math.cos(a);
      const pyp = cy - (rSun + rPlanet) * Math.sin(a);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(pxp, pyp);
      g.stroke();
      g.strokeStyle = COLOR_BLUE;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(pxp, pyp, rPlanet, 0, MECH_TAU);
      g.stroke();
      g.strokeStyle = COLOR_SAGE;
    }
    // Sun.
    g.strokeStyle = COLOR_BLUE;
    g.lineWidth = 1.8;
    g.beginPath();
    g.arc(cx, cy, rSun, 0, MECH_TAU);
    g.stroke();
    this.drawJoint(g, cx, cy);
    // Labels.
    g.font = '10px Consolas, monospace';
    g.fillStyle = COLOR_BLUE;
    g.textAlign = 'center';
    g.fillText(`zs=${p.zs}  ω=${fmtMetric(p.wSun)}`, cx, cy + 14);
    g.fillStyle = COLOR_TAN;
    g.fillText(`zr=${p.zr}  ω=${fmtMetric(p.wRing)}`, cx, cy + rRing + 16);
    g.fillStyle = COLOR_SAGE;
    g.fillText(`zp=${p.zp}`, cx + (rSun + rPlanet) * Math.cos(Math.PI / 6), cy - (rSun + rPlanet) * Math.sin(Math.PI / 6) - 8);
    g.fillStyle = COLOR_MUTED;
    g.fillText(zh ? `行星架 ωH=${fmtMetric(p.wCarrier)}` : `carrier ωH=${fmtMetric(p.wCarrier)}`, cx, r.y + 14);
  }

  private drawGearSummary(g: CanvasRenderingContext2D, r: Rect): void {
    const zh = this.zh;
    g.fillStyle = COLOR_MUTED;
    g.font = this.fnt(11);
    g.textAlign = 'left';
    let y = r.y + 16;
    const line = (txt: string, color = COLOR_INK): void => {
      g.fillStyle = color;
      g.fillText(txt, r.x + 4, y);
      y += 17;
    };
    if (this.planet) {
      const p = this.planet;
      line(zh ? 'Willis 方程：ωs + ρ·ωr − (1+ρ)·ωH = 0' : 'Willis: ωs + ρ·ωr − (1+ρ)·ωH = 0');
      line(`ρ = zr/zs = ${fmtMetric(p.rho)}  (zr = ${p.zr})`);
      line(`ωs = ${fmtMetric(p.wSun)} rad/s`, COLOR_BLUE);
      line(`ωr = ${fmtMetric(p.wRing)} rad/s`, COLOR_TAN);
      line(`ωH = ${fmtMetric(p.wCarrier)} rad/s`, COLOR_SAGE);
      line(zh ? `Willis 残差 = ${fmtMetric(Math.abs(p.residual))}` : `Willis residual = ${fmtMetric(Math.abs(p.residual))}`, COLOR_MUTED);
    } else if (this.train) {
      const t = this.train;
      line(zh ? 'i = Π(±za/zb)（外啮合取负）' : 'i = Π(±za/zb) (external mesh negative)');
      for (let i = 0; i < t.stages.length; i += 1) {
        const st = t.stages[i]!;
        line(`stage ${i + 1}: ${st.za}/${st.zb} → ${fmtMetric(st.ratio)}`);
      }
      line(zh ? `总传动比 i = ${fmtMetric(t.ratio)}` : `overall ratio i = ${fmtMetric(t.ratio)}`, COLOR_BLUE);
      line(zh ? `减速倍数 = ${fmtMetric(t.reduction)}` : `reduction = ${fmtMetric(t.reduction)}`);
      line(t.reversed ? (zh ? '输出反向' : 'output reversed') : zh ? '输出同向' : 'output same direction', COLOR_MUTED);
    }
  }

  private drawFooter(g: CanvasRenderingContext2D, h: number): void {
    const s = this.state;
    const zh = this.zh;
    g.textAlign = 'left';
    g.font = this.fnt(11);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    let text = '';
    if ((s.mode === 'fourbar' || s.mode === 'velocity') && this.sweep) {
      const sw = this.sweep;
      text = zh
        ? `Grashof: ${GRASHOF_ZH[sw.grashof]} · μmin = ${fmtMetric(sw.minTransmissionDeg)}° · μmax = ${fmtMetric(sw.maxTransmissionDeg)}° · 摆角 = ${fmtMetric(sw.rockerSwingDeg)}° · 残差 = ${fmtMetric(sw.maxResidual)}`
        : `Grashof: ${GRASHOF_EN[sw.grashof]} · mu_min = ${fmtMetric(sw.minTransmissionDeg)} deg · mu_max = ${fmtMetric(sw.maxTransmissionDeg)} deg · swing = ${fmtMetric(sw.rockerSwingDeg)} deg · residual = ${fmtMetric(sw.maxResidual)}`;
      if (s.mode === 'velocity') {
        text += zh ? ` · vP 数值校验 = ${fmtMetric(this.velErr)}` : ` · vP numeric check = ${fmtMetric(this.velErr)}`;
      }
    } else if (s.mode === 'cam' && this.cam) {
      const cam = this.cam;
      text = zh
        ? `αmax(推程) = ${fmtMetric(cam.maxPressureRiseDeg)}° · αmax(回程) = ${fmtMetric(cam.maxPressureReturnDeg)}° · ${cam.undercut ? '根切：是' : '根切：否'} · ρmin(凸) = ${fmtMetric(cam.minConvexCurvatureR)}`
        : `alpha_max(rise) = ${fmtMetric(cam.maxPressureRiseDeg)} deg · alpha_max(return) = ${fmtMetric(cam.maxPressureReturnDeg)} deg · undercut: ${cam.undercut ? 'YES' : 'no'} · rho_min(convex) = ${fmtMetric(cam.minConvexCurvatureR)}`;
    } else if (s.mode === 'gear') {
      if (this.planet) {
        const p = this.planet;
        text = `i(sun/carrier, ring fixed) = 1 + zr/zs = ${fmtMetric(1 + p.zr / p.zs)} · ωs = ${fmtMetric(p.wSun)} · ωr = ${fmtMetric(p.wRing)} · ωH = ${fmtMetric(p.wCarrier)} rad/s`;
      } else if (this.train) {
        const t = this.train;
        text = zh
          ? `i = ${fmtMetric(t.ratio)} · 减速 = ${fmtMetric(t.reduction)} · ${t.reversed ? '反向' : '同向'}`
          : `i = ${fmtMetric(t.ratio)} · reduction = ${fmtMetric(t.reduction)} · ${t.reversed ? 'reversed' : 'same direction'}`;
      }
    }
    g.fillText(text, 16, h - 12);
  }
}

/** Factory required by the plugin loader (`mod.default()`). */
export default function createEngMechanismPlugin(): Plugin {
  return new EngMechanismPlugin();
}
