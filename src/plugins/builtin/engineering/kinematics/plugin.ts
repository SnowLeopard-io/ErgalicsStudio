// ==========================================================================
// eng-kin — mechanism kinematics laboratory
//
// Live workbench with four modes:
//   fourbar — animated mechanism sketch with coupler curve, transmission
//             angle and the Kennedy instant center I13 (crank driven by the
//             frame clock: update(dt) advances theta1);
//   cam     — rotating disk cam with roller / flat-face follower, pitch and
//             actual profiles, live pressure angle;
//   gear    — fixed-axis / planetary train ratios with a pitch-circle sketch;
//   motion  — velocity and acceleration polygons (graphical method, datafied).
// Parameter edits recompute immediately; "Simulate" publishes the scientific
// outputs (Grashof type, peak pressure angle, ratios, contact ratio, stroke
// extremes, rocker swing). CSV input (r1,r2,r3,r4 rows) is analyzed by
// compute() for Block/Flow usage. Academic low-saturation palette, no emoji.
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
import { engKinematicsManifest } from './manifest';
import {
  type Branch,
  type CamLaw,
  type CamParams,
  type CamResult,
  type FollowerType,
  type FourBarLinks,
  type FourBarRow,
  type FourBarSweep,
  type GearStage,
  type PlanetMember,
  type PolygonData,
  accelerationPolygon,
  camMotion,
  designCam,
  fixedTrain,
  fourBarKinematics,
  gearPair,
  parseFourBarInput,
  planetary,
  solveFourBar,
  sweepFourBar,
  velocityPolygon,
} from './kernel';

export { engKinematicsManifest } from './manifest';

type Mode = 'fourbar' | 'cam' | 'gear' | 'motion';

interface State {
  mode: Mode;
  // Four-bar / motion (shared mechanism geometry).
  r1: number;
  r2: number;
  r3: number;
  r4: number;
  branch: Branch;
  couplerC: number; // fraction of r2
  couplerE: number;
  showCurve: boolean;
  omega1: number;
  // Cam.
  camR0: number;
  camRollerR: number;
  camH: number;
  camRiseB: number;
  camDwellB: number;
  camReturnB: number;
  camOffset: number;
  camLaw: CamLaw;
  camFollower: FollowerType;
  camSpeed: number;
  // Gear.
  gearType: 'fixed' | 'planetary';
  trainSpec: string;
  zs: number;
  zp: number;
  planetFixed: PlanetMember;
  planetInput: PlanetMember;
  wIn: number;
  playing: boolean;
}

/** Analysis products for the current mode (null until recomputed). */
interface Products {
  links: FourBarLinks | null;
  sweep: FourBarSweep | null;
  theta1: number;
  camAngle: number;
  cam: CamResult | null;
  camParams: CamParams | null;
  train: ReturnType<typeof fixedTrain> | null;
  planet: ReturnType<typeof planetary> | null;
  pair: ReturnType<typeof gearPair> | null;
  velPoly: PolygonData | null;
  accPoly: PolygonData | null;
  kinError: string | null;
}

const MODES: Mode[] = ['fourbar', 'cam', 'gear', 'motion'];
const CAM_LAWS: CamLaw[] = ['shm', 'cycloid', 'poly345', 'modtrap'];
const FOLLOWERS: FollowerType[] = ['roller', 'flat'];
const MEMBERS: PlanetMember[] = ['sun', 'ring', 'carrier'];

/** Parse "20:60,30:60" (driver:driven pairs; ":r*" suffix = internal mesh). */
function parseTrainSpec(spec: string): GearStage[] {
  const stages: GearStage[] = [];
  for (const raw of spec.split(',')) {
    const part = raw.trim();
    if (part.length === 0) continue;
    const internal = part.endsWith('*');
    const body = internal ? part.slice(0, -1) : part;
    const [a, b] = body.split(':');
    const za = Number(a);
    const zb = Number(b);
    if (!Number.isFinite(za) || !Number.isFinite(zb) || za <= 0 || zb <= 0) {
      throw new Error('train spec must be "za:zb[,za:zb...]" with positive integers');
    }
    stages.push({ za: Math.round(za), zb: Math.round(zb), internal });
  }
  if (stages.length === 0) throw new Error('train spec is empty');
  return stages;
}

export class EngKinematicsPlugin implements Plugin {
  readonly manifest = engKinematicsManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    mode: 'fourbar',
    r1: 1,
    r2: 4,
    r3: 4,
    r4: 3.5,
    branch: 'open',
    couplerC: 0.5,
    couplerE: 0,
    showCurve: true,
    omega1: 1.5,
    camR0: 40,
    camRollerR: 8,
    camH: 20,
    camRiseB: 120,
    camDwellB: 60,
    camReturnB: 120,
    camOffset: 0,
    camLaw: 'cycloid',
    camFollower: 'roller',
    camSpeed: 1,
    gearType: 'fixed',
    trainSpec: '20:60,30:60',
    zs: 20,
    zp: 30,
    planetFixed: 'ring',
    planetInput: 'sun',
    wIn: 10,
    playing: false,
  };
  private products: Products = {
    links: null, sweep: null, theta1: 0, camAngle: 0, cam: null, camParams: null,
    train: null, planet: null, pair: null, velPoly: null, accPoly: null, kinError: null,
  };
  private errorMsg: string | null = null;
  private lastTable: FourBarRow[] | null = null;
  // Frame clock (requestAnimationFrame; θ1 and the cam angle are frame-driven).
  private raf = 0;
  private lastTs = 0;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    this.stopLoop();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.recompute();
    this.draw();
    this.syncLoop();
  }

  async deactivate() {
    this.stopLoop();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.recompute();
    this.draw();
    this.syncLoop();
  }

  // ---- parameters ----------------------------------------------------------

  getParams(): ParamDefinition[] {
    const s = this.state;
    const mode = s.mode;
    const mech = mode === 'fourbar' || mode === 'motion';
    return [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '模式', 'en-US': 'Mode' },
        type: 'select',
        options: [
          { value: 'fourbar', label: 'Four-bar linkage', labelI18n: { 'zh-CN': '四杆机构', 'en-US': 'Four-bar linkage' } },
          { value: 'cam', label: 'Cam profile', labelI18n: { 'zh-CN': '凸轮廓线', 'en-US': 'Cam profile' } },
          { value: 'gear', label: 'Gear trains', labelI18n: { 'zh-CN': '轮系传动比', 'en-US': 'Gear trains' } },
          { value: 'motion', label: 'Motion polygons', labelI18n: { 'zh-CN': '速度/加速度多边形', 'en-US': 'Motion polygons' } },
        ],
        value: mode,
      },
      // ---- four-bar geometry (fourbar + motion) ----
      {
        key: 'r1', label: 'r1 crank', labelI18n: { 'zh-CN': 'r1 曲柄', 'en-US': 'r1 crank' },
        type: 'range', min: 0.2, max: 10, step: 0.1, value: s.r1,
        hint: this.zh ? '曲柄长（输入构件）' : 'crank length (input)',
        visibleWhen: { key: 'mode', in: ['fourbar', 'motion'] },
      },
      {
        key: 'r2', label: 'r2 coupler', labelI18n: { 'zh-CN': 'r2 连杆', 'en-US': 'r2 coupler' },
        type: 'range', min: 0.5, max: 12, step: 0.1, value: s.r2,
        visibleWhen: { key: 'mode', in: ['fourbar', 'motion'] },
      },
      {
        key: 'r3', label: 'r3 rocker', labelI18n: { 'zh-CN': 'r3 摇杆', 'en-US': 'r3 rocker' },
        type: 'range', min: 0.5, max: 12, step: 0.1, value: s.r3,
        visibleWhen: { key: 'mode', in: ['fourbar', 'motion'] },
      },
      {
        key: 'r4', label: 'r4 ground', labelI18n: { 'zh-CN': 'r4 机架', 'en-US': 'r4 ground' },
        type: 'range', min: 0.5, max: 12, step: 0.1, value: s.r4,
        visibleWhen: { key: 'mode', in: ['fourbar', 'motion'] },
      },
      {
        key: 'branch', label: 'Assembly branch', labelI18n: { 'zh-CN': '装配分支', 'en-US': 'Assembly branch' },
        type: 'select', value: s.branch,
        options: [
          { value: 'open', label: 'Open', labelI18n: { 'zh-CN': '开式', 'en-US': 'Open' } },
          { value: 'crossed', label: 'Crossed', labelI18n: { 'zh-CN': '交叉', 'en-US': 'Crossed' } },
        ],
        visibleWhen: { key: 'mode', in: ['fourbar', 'motion'] },
      },
      {
        key: 'couplerC', label: 'Coupler point c/r2', labelI18n: { 'zh-CN': '连杆点 c/r2', 'en-US': 'Coupler point c/r2' },
        type: 'range', min: 0, max: 1.2, step: 0.01, value: s.couplerC,
        visibleWhen: { key: 'mode', in: ['fourbar', 'motion'] },
      },
      {
        key: 'couplerE', label: 'Coupler offset e', labelI18n: { 'zh-CN': '连杆点偏距 e', 'en-US': 'Coupler offset e' },
        type: 'range', min: -2, max: 2, step: 0.05, value: s.couplerE,
        visibleWhen: { key: 'mode', in: ['fourbar', 'motion'] },
      },
      {
        key: 'showCurve', label: 'Coupler curve', labelI18n: { 'zh-CN': '连杆曲线', 'en-US': 'Coupler curve' },
        type: 'checkbox', value: s.showCurve,
        visibleWhen: { key: 'mode', in: ['fourbar'] },
      },
      {
        key: 'theta1', label: 'theta1 (deg)', labelI18n: { 'zh-CN': '曲柄角 theta1 (°)', 'en-US': 'Crank angle theta1 (deg)' },
        type: 'range', min: 0, max: 360, step: 1, value: (this.products.theta1 * 180) / Math.PI % 360,
        hint: this.zh ? '播放时由帧驱动推进' : 'frame-driven while playing',
        visibleWhen: { key: 'mode', in: ['fourbar', 'motion'] },
      },
      {
        key: 'omega1', label: 'w1 (rad/s)', labelI18n: { 'zh-CN': '曲柄转速 w1 (rad/s)', 'en-US': 'Crank speed w1 (rad/s)' },
        type: 'range', min: 0, max: 6, step: 0.1, value: s.omega1,
        visibleWhen: { key: 'mode', in: ['fourbar', 'motion'] },
      },
      // ---- cam ----
      {
        key: 'camR0', label: 'r0 prime circle', labelI18n: { 'zh-CN': '基圆半径 r0', 'en-US': 'Prime circle r0' },
        type: 'range', min: 10, max: 100, step: 1, value: s.camR0,
        hint: this.zh ? '滚子中心理论廓线基圆' : 'roller-center (pitch) base circle',
        visibleWhen: { key: 'mode', in: ['cam'] },
      },
      {
        key: 'camRollerR', label: 'Roller radius', labelI18n: { 'zh-CN': '滚子半径', 'en-US': 'Roller radius' },
        type: 'range', min: 2, max: 20, step: 0.5, value: s.camRollerR,
        visibleWhen: { key: 'mode', in: ['cam'] },
      },
      {
        key: 'camH', label: 'Stroke h', labelI18n: { 'zh-CN': '行程 h', 'en-US': 'Stroke h' },
        type: 'range', min: 2, max: 60, step: 1, value: s.camH,
        visibleWhen: { key: 'mode', in: ['cam'] },
      },
      {
        key: 'camRiseB', label: 'Rise angle (deg)', labelI18n: { 'zh-CN': '升程角 (°)', 'en-US': 'Rise angle (deg)' },
        type: 'range', min: 30, max: 180, step: 5, value: s.camRiseB,
        visibleWhen: { key: 'mode', in: ['cam'] },
      },
      {
        key: 'camDwellB', label: 'Dwell angle (deg)', labelI18n: { 'zh-CN': '远休止角 (°)', 'en-US': 'Dwell angle (deg)' },
        type: 'range', min: 0, max: 150, step: 5, value: s.camDwellB,
        visibleWhen: { key: 'mode', in: ['cam'] },
      },
      {
        key: 'camReturnB', label: 'Return angle (deg)', labelI18n: { 'zh-CN': '回程角 (°)', 'en-US': 'Return angle (deg)' },
        type: 'range', min: 30, max: 180, step: 5, value: s.camReturnB,
        visibleWhen: { key: 'mode', in: ['cam'] },
      },
      {
        key: 'camOffset', label: 'Guide offset e', labelI18n: { 'zh-CN': '导路偏距 e', 'en-US': 'Guide offset e' },
        type: 'range', min: -30, max: 30, step: 1, value: s.camOffset,
        visibleWhen: { key: 'mode', in: ['cam'] },
      },
      {
        key: 'camLaw', label: 'Motion law', labelI18n: { 'zh-CN': '运动规律', 'en-US': 'Motion law' },
        type: 'select', value: s.camLaw,
        options: [
          { value: 'cycloid', label: 'Cycloidal', labelI18n: { 'zh-CN': '摆线', 'en-US': 'Cycloidal' } },
          { value: 'shm', label: 'Simple harmonic', labelI18n: { 'zh-CN': '简谐', 'en-US': 'Simple harmonic' } },
          { value: 'poly345', label: '3-4-5 polynomial', labelI18n: { 'zh-CN': '3-4-5 多项式', 'en-US': '3-4-5 polynomial' } },
          { value: 'modtrap', label: 'Modified trapezoid', labelI18n: { 'zh-CN': '修正梯形', 'en-US': 'Modified trapezoid' } },
        ],
        visibleWhen: { key: 'mode', in: ['cam'] },
      },
      {
        key: 'camFollower', label: 'Follower', labelI18n: { 'zh-CN': '从动件', 'en-US': 'Follower' },
        type: 'select', value: s.camFollower,
        options: [
          { value: 'roller', label: 'Roller (offset)', labelI18n: { 'zh-CN': '滚子（可偏置）', 'en-US': 'Roller (offset)' } },
          { value: 'flat', label: 'Flat face', labelI18n: { 'zh-CN': '平底', 'en-US': 'Flat face' } },
        ],
        visibleWhen: { key: 'mode', in: ['cam'] },
      },
      {
        key: 'camSpeed', label: 'Cam speed (rad/s)', labelI18n: { 'zh-CN': '凸轮转速 (rad/s)', 'en-US': 'Cam speed (rad/s)' },
        type: 'range', min: 0, max: 6, step: 0.1, value: s.camSpeed,
        visibleWhen: { key: 'mode', in: ['cam'] },
      },
      // ---- gear ----
      {
        key: 'gearType', label: 'Train type', labelI18n: { 'zh-CN': '轮系类型', 'en-US': 'Train type' },
        type: 'select', value: s.gearType,
        options: [
          { value: 'fixed', label: 'Fixed-axis', labelI18n: { 'zh-CN': '定轴轮系', 'en-US': 'Fixed-axis' } },
          { value: 'planetary', label: 'Planetary 2K-H', labelI18n: { 'zh-CN': '行星轮系 2K-H', 'en-US': 'Planetary 2K-H' } },
        ],
        visibleWhen: { key: 'mode', in: ['gear'] },
      },
      {
        key: 'trainSpec', label: 'Stages za:zb[,..] (*=internal)', labelI18n: { 'zh-CN': '级串 za:zb[,..]（*=内啮合）', 'en-US': 'Stages za:zb[,..] (* = internal)' },
        type: 'text', value: s.trainSpec,
        hint: this.zh ? '如 20:60,30:60；惰轮自然计入方向' : 'e.g. 20:60,30:60; idlers cancel direction',
        visibleWhen: { key: 'mode', in: ['gear'] },
      },
      {
        key: 'zs', label: 'Sun teeth zs', labelI18n: { 'zh-CN': '太阳轮齿数 zs', 'en-US': 'Sun teeth zs' },
        type: 'range', min: 10, max: 60, step: 1, value: s.zs,
        visibleWhen: { key: 'mode', in: ['gear'] },
      },
      {
        key: 'zp', label: 'Planet teeth zp', labelI18n: { 'zh-CN': '行星轮齿数 zp', 'en-US': 'Planet teeth zp' },
        type: 'range', min: 10, max: 40, step: 1, value: s.zp,
        visibleWhen: { key: 'mode', in: ['gear'] },
      },
      {
        key: 'planetFixed', label: 'Fixed member', labelI18n: { 'zh-CN': '固定构件', 'en-US': 'Fixed member' },
        type: 'select', value: s.planetFixed,
        options: MEMBERS.map((m) => ({ value: m, label: m })),
        visibleWhen: { key: 'mode', in: ['gear'] },
      },
      {
        key: 'planetInput', label: 'Input member', labelI18n: { 'zh-CN': '输入构件', 'en-US': 'Input member' },
        type: 'select', value: s.planetInput,
        options: MEMBERS.map((m) => ({ value: m, label: m })),
        visibleWhen: { key: 'mode', in: ['gear'] },
      },
      {
        key: 'wIn', label: 'Input speed (rad/s)', labelI18n: { 'zh-CN': '输入转速 (rad/s)', 'en-US': 'Input speed (rad/s)' },
        type: 'range', min: -50, max: 50, step: 1, value: s.wIn,
        visibleWhen: { key: 'mode', in: ['gear'] },
      },
      // ---- shared ----
      {
        key: 'playing', label: 'Play', labelI18n: { 'zh-CN': '播放', 'en-US': 'Play' },
        type: 'toggle', value: s.playing,
        offLabel: 'Play', onLabel: 'Pause',
        offLabelI18n: { 'zh-CN': '播放', 'en-US': 'Play' },
        onLabelI18n: { 'zh-CN': '暂停', 'en-US': 'Pause' },
        visibleWhen: { key: 'mode', in: ['fourbar', 'cam', 'motion'] },
      },
      actionButton('simulate', 'Simulate', '仿真', 'primary'),
      actionButton('exportCsv', 'Export CSV', '导出 CSV'),
      actionButton('exportPng', 'Export PNG', '导出 PNG'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    let changed = false;
    const num = (k: keyof State, lo: number, hi: number): void => {
      const v = params[k as string];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      const c = Math.min(hi, Math.max(lo, v));
      if (s[k] !== c) {
        (s as unknown as Record<string, number>)[k as string] = c;
        changed = true;
      }
    };
    const opt = (k: keyof State, allowed: readonly string[]): void => {
      const v = params[k as string];
      if (typeof v === 'string' && allowed.includes(v) && s[k] !== v) {
        (s as unknown as Record<string, string>)[k as string] = v;
        changed = true;
      }
    };
    if (typeof params.theta1 === 'number' && Number.isFinite(params.theta1) && !s.playing) {
      const t = ((((params.theta1 * Math.PI) / 180) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (Math.abs(t - this.products.theta1) > 1e-9) {
        this.products.theta1 = t;
        changed = true;
      }
    }
    num('r1', 0.2, 10);
    num('r2', 0.5, 12);
    num('r3', 0.5, 12);
    num('r4', 0.5, 12);
    num('couplerC', 0, 1.2);
    num('couplerE', -2, 2);
    num('omega1', 0, 6);
    num('camR0', 10, 100);
    num('camRollerR', 2, 20);
    num('camH', 2, 60);
    num('camRiseB', 30, 180);
    num('camDwellB', 0, 150);
    num('camReturnB', 30, 180);
    num('camOffset', -30, 30);
    num('camSpeed', 0, 6);
    num('zs', 10, 60);
    num('zp', 10, 40);
    num('wIn', -50, 50);
    opt('mode', MODES);
    opt('branch', ['open', 'crossed']);
    opt('camLaw', CAM_LAWS);
    opt('camFollower', FOLLOWERS);
    opt('gearType', ['fixed', 'planetary']);
    opt('planetFixed', MEMBERS);
    opt('planetInput', MEMBERS);
    if (typeof params.showCurve === 'boolean' && params.showCurve !== s.showCurve) {
      s.showCurve = params.showCurve;
      changed = true;
    }
    if (typeof params.playing === 'boolean' && params.playing !== s.playing) {
      s.playing = params.playing;
      changed = true;
    }
    if (typeof params.trainSpec === 'string' && params.trainSpec !== s.trainSpec) {
      s.trainSpec = params.trainSpec.slice(0, 120);
      changed = true;
    }
    if (changed) {
      this.recompute();
      this.draw();
    }
    this.syncLoop();
    if (actionFired(params, 'simulate')) this.runSimulation();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d, 'eng-kin-view');
    }
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- frame clock (SimPlugin style) ---------------------------------------

  /** Start/stop the rAF loop to match `playing` and animation-capable modes. */
  private syncLoop(): void {
    const animatable = this.state.playing && this.state.mode !== 'gear';
    if (animatable && this.ctx) this.startLoop();
    else this.stopLoop();
  }

  private startLoop(): void {
    if (this.raf !== 0) return;
    this.lastTs = performance.now();
    const tick = (ts: number): void => {
      // Frame-rate protection: clamp dt so a stalled tab cannot jump the
      // mechanism, and skip entirely while the document is hidden.
      const dt = Math.min(0.05, Math.max(0, (ts - this.lastTs) / 1000));
      this.lastTs = ts;
      const hidden = typeof document !== 'undefined' && document.hidden === true;
      if (!hidden) {
        this.update(dt);
        this.draw();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.raf !== 0) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Advance one frame: theta1 (fourbar/motion) or the cam angle. */
  update(dt: number): void {
    const s = this.state;
    if (!s.playing || !(dt > 0)) return;
    const TAU = Math.PI * 2;
    if (s.mode === 'fourbar' || s.mode === 'motion') {
      this.products.theta1 = ((this.products.theta1 + s.omega1 * dt) % TAU + TAU) % TAU;
      this.stepKinematics();
    } else if (s.mode === 'cam') {
      this.products.camAngle = ((this.products.camAngle + s.camSpeed * dt) % TAU + TAU) % TAU;
    }
  }

  // ---- compute -------------------------------------------------------------

  /** Recompute the active mode's products from the current state. */
  private recompute(): void {
    const s = this.state;
    this.errorMsg = null;
    if (s.mode === 'fourbar' || s.mode === 'motion') {
      this.products.links = { r1: s.r1, r2: s.r2, r3: s.r3, r4: s.r4 };
      this.products.sweep = null;
      this.stepKinematics();
    } else if (s.mode === 'cam') {
      this.products.links = null;
      this.products.sweep = null;
      const p: CamParams = {
        r0: s.camR0, rollerR: s.camRollerR, h: s.camH,
        riseB: s.camRiseB, dwellB: s.camDwellB, returnB: s.camReturnB,
        offset: s.camOffset, lawRise: s.camLaw, lawReturn: s.camLaw,
        follower: s.camFollower,
      };
      try {
        this.products.cam = designCam(p);
        this.products.camParams = p;
        this.products.kinError = null;
      } catch (e) {
        this.products.cam = null;
        this.products.camParams = null;
        this.products.kinError = e instanceof Error ? e.message : String(e);
      }
    } else {
      this.products.links = null;
      this.products.sweep = null;
      this.products.cam = null;
      this.products.kinError = null;
      try {
        if (s.gearType === 'fixed') {
          const stages = parseTrainSpec(s.trainSpec);
          this.products.train = fixedTrain(stages);
          this.products.planet = null;
          const first = stages[0]!;
          this.products.pair = gearPair(first.za, first.zb);
        } else {
          if (s.planetFixed === s.planetInput) {
            throw new Error('fixed and input members must differ');
          }
          this.products.planet = planetary({
            zs: s.zs, zp: s.zp, fixed: s.planetFixed, input: s.planetInput, wIn: s.wIn,
          });
          this.products.train = null;
          this.products.pair = gearPair(s.zs, s.zp);
        }
      } catch (e) {
        this.products.train = null;
        this.products.planet = null;
        this.products.pair = null;
        this.products.kinError = e instanceof Error ? e.message : String(e);
      }
    }
  }

  /** Refresh the pose-level fourbar products (per frame / on edit). */
  private stepKinematics(): void {
    const l = this.products.links;
    if (!l) return;
    this.products.kinError = null;
    this.products.velPoly = null;
    this.products.accPoly = null;
    try {
      const cp = { c: this.state.couplerC * l.r2, e: this.state.couplerE };
      this.products.velPoly = velocityPolygon(l, this.products.theta1, Math.max(this.state.omega1, 1e-9), this.state.branch, cp);
      this.products.accPoly = accelerationPolygon(l, this.products.theta1, Math.max(this.state.omega1, 1e-9), this.state.branch, cp);
    } catch (e) {
      this.products.kinError = e instanceof Error ? e.message : String(e);
    }
  }

  /** Full sweep (cached per parameter set, not per frame). */
  private ensureSweep(): FourBarSweep | null {
    const l = this.products.links;
    if (!l) return null;
    if (!this.products.sweep) {
      try {
        this.products.sweep = sweepFourBar(l, this.state.branch, { c: this.state.couplerC * l.r2, e: this.state.couplerE }, 720);
      } catch {
        return null;
      }
    }
    return this.products.sweep;
  }

  /** Simulate button: recompute, publish scientific outputs, announce. */
  private runSimulation(): void {
    this.recompute();
    this.lastTable = null;
    if (this.errorMsg || this.products.kinError) {
      notify(this.api, 'error', `Analysis failed: ${this.products.kinError ?? this.errorMsg ?? 'invalid parameters'}`, `分析失败：${this.products.kinError ?? this.errorMsg ?? '参数无效'}`);
      this.draw();
      return;
    }
    this.publishOutputs();
    const s = this.state;
    const zh = this.zh;
    let summary = '';
    if (s.mode === 'fourbar' || s.mode === 'motion') {
      const sweep = this.ensureSweep();
      if (sweep) summary = `${sweep.type} · swing ${fmtMetric(sweep.rockerSwingDeg)} deg`;
    } else if (s.mode === 'cam' && this.products.cam) {
      const c = this.products.cam;
      summary = `alpha_max ${fmtMetric(c.maxPressureRiseDeg)} deg · undercut ${c.undercut ? 'yes' : 'no'}`;
    } else if (s.mode === 'gear') {
      if (this.products.train) summary = `i = ${fmtMetric(this.products.train.reduction)} (${this.products.train.reversed ? 'reversed' : 'same dir'})`;
      if (this.products.planet) summary = `i = ${fmtMetric(this.products.planet.i)}`;
    }
    notify(this.api, 'success', summary, summary);
    this.draw();
  }

  /** Publish the mode's numerical conclusions to the science-output bus. */
  private publishOutputs(): void {
    const s = this.state;
    const zh = this.zh;
    const metrics: ScienceMetric[] = [];
    if (s.mode === 'fourbar' || s.mode === 'motion') {
      const l = this.products.links;
      const sweep = this.ensureSweep();
      if (!l || !sweep) return;
      const typeZh: Record<string, string> = {
        'crank-rocker': '曲柄摇杆', 'double-crank': '双曲柄', 'double-rocker': '双摇杆',
        'change-point': '变点机构', 'no-crank': '无曲柄（三摇杆）',
      };
      metrics.push({
        key: 'grashof',
        label: zh ? 'Grashof 类型' : 'Grashof type',
        value: zh ? typeZh[sweep.type] ?? sweep.type : sweep.type,
        severity: sweep.assemblable ? 'ok' : 'warn',
        hint: zh ? 's+l 与 p+q 比较；最短构件位置决定类型' : 'from s+l vs p+q and the location of the shortest link',
      });
      metrics.push({
        key: 'swing',
        label: zh ? '摇杆摆角' : 'Rocker swing',
        value: fmtMetric(sweep.rockerSwingDeg),
        unit: 'deg',
        severity: 'info',
      });
      metrics.push({
        key: 'trans',
        label: zh ? '传动角范围' : 'Transmission angle',
        value: `${fmtMetric(sweep.minTransmissionDeg)} – ${fmtMetric(sweep.maxTransmissionDeg)}`,
        unit: 'deg',
        severity: sweep.minTransmissionDeg >= 40 ? 'ok' : 'warn',
        hint: zh ? '经验许用值 ≥ 40°' : 'rule of thumb: >= 40 deg',
      });
      try {
        const k = fourBarKinematics(l, this.products.theta1, Math.max(s.omega1, 1e-9), s.branch);
        metrics.push({
          key: 'residual',
          label: zh ? '闭环残差' : 'Closure residual',
          value: fmtMetric(k.pose.residual, 2),
          severity: k.pose.residual < 1e-9 ? 'ok' : 'warn',
          hint: zh ? '|A + r2·u(θ2) − (O4 + r3·u(θ3))|' : '|A + r2·u(θ2) − (O4 + r3·u(θ3))|',
        });
        if (k.i13) {
          metrics.push({
            key: 'i13',
            label: zh ? '瞬心 I13' : 'Instant center I13',
            value: `(${fmtMetric(k.i13[0], 3)}, ${fmtMetric(k.i13[1], 3)})`,
            severity: 'info',
            hint: zh ? '直线(O2,A) ∩ 直线(O4,B)' : 'line(O2,A) ∩ line(O4,B)',
          });
        }
      } catch {
        // Singular pose: residual metric omitted.
      }
    } else if (s.mode === 'cam' && this.products.cam) {
      const c = this.products.cam;
      metrics.push({
        key: 'alpha-rise',
        label: zh ? '升程最大压力角' : 'Max pressure angle (rise)',
        value: fmtMetric(c.maxPressureRiseDeg),
        unit: 'deg',
        severity: c.maxPressureRiseDeg <= 30 ? 'ok' : 'warn',
        hint: zh ? '推荐 ≤ 30°（升程）' : 'recommended <= 30 deg on rise',
      });
      metrics.push({
        key: 'alpha-return',
        label: zh ? '回程最大压力角' : 'Max pressure angle (return)',
        value: fmtMetric(c.maxPressureReturnDeg),
        unit: 'deg',
        severity: c.maxPressureReturnDeg <= 70 ? 'ok' : 'warn',
        hint: zh ? '推荐 ≤ 70°（回程）' : 'recommended <= 70 deg on return',
      });
      metrics.push({
        key: 'stroke',
        label: zh ? '行程极值' : 'Stroke extremes',
        value: `0 – ${fmtMetric(this.products.camParams?.h ?? Number.NaN)}`,
        severity: 'info',
      });
      if (this.products.camParams?.follower === 'roller') {
        metrics.push({
          key: 'curv',
          label: zh ? '最小曲率半径 / 根切' : 'Min curvature radius / undercut',
          value: `${fmtMetric(c.minCurvatureRadius)} · ${c.undercut ? (zh ? '有根切' : 'undercut') : zh ? '无根切' : 'clear'}`,
          severity: c.undercut ? 'error' : 'ok',
          hint: zh ? '曲率半径 < 滚子半径 → 实际廓线失真' : 'curvature radius < roller radius distorts the envelope',
        });
      } else {
        metrics.push({
          key: 'face',
          label: zh ? '平底所需长度' : 'Required face length',
          value: `±${fmtMetric(c.faceLength)}`,
          severity: 'info',
        });
      }
      metrics.push({
        key: 'vmax',
        label: zh ? '峰值速度 |ds/dθ|' : 'Peak |ds/dθ|',
        value: fmtMetric(c.vMax),
        severity: 'info',
      });
    } else if (s.mode === 'gear') {
      if (this.products.train) {
        const t = this.products.train;
        metrics.push({
          key: 'ratio',
          label: zh ? '总传动比 |i|' : 'Total ratio |i|',
          value: fmtMetric(t.reduction),
          severity: 'ok',
          hint: zh ? 'ω_in/ω_out，各级乘积' : 'product of the stage ratios',
        });
        metrics.push({
          key: 'dir',
          label: zh ? '输出方向' : 'Output direction',
          value: t.reversed ? (zh ? '反向' : 'reversed') : zh ? '同向' : 'same',
          severity: 'info',
        });
      }
      if (this.products.planet) {
        const p = this.products.planet;
        metrics.push({
          key: 'i',
          label: zh ? '行星轮系 i' : 'Planetary i',
          value: fmtMetric(p.i),
          severity: 'ok',
          hint: zh ? `Willis：ωs + ρωr − (1+ρ)ωH = 0，zr = ${p.zr}` : `Willis equation, zr = ${p.zr}`,
        });
        metrics.push({
          key: 'speeds',
          label: zh ? '构件转速 ωs/ωr/ωH' : 'Members ωs/ωr/ωH',
          value: `${fmtMetric(p.wSun)} / ${fmtMetric(p.wRing)} / ${fmtMetric(p.wCarrier)}`,
          unit: 'rad/s',
          severity: 'info',
        });
      }
      if (this.products.pair) {
        metrics.push({
          key: 'eps',
          label: zh ? '重合度 εα' : 'Contact ratio εα',
          value: fmtMetric(this.products.pair.contactRatio),
          severity: this.products.pair.contactRatio >= 1.2 ? 'ok' : 'warn',
          hint: zh ? '通常 1.2–2.2；≥ 1 才能连续传动' : 'typically 1.2–2.2; >= 1 for continuous drive',
        });
        metrics.push({
          key: 'alphaw',
          label: zh ? '啮合角 α′' : 'Working pressure angle',
          value: fmtMetric(this.products.pair.alphaWdeg),
          unit: 'deg',
          severity: 'info',
        });
      }
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- compute (Block / Flow entry) ----------------------------------------

  async compute(input: unknown): Promise<ComputeResult> {
    try {
      const rows = parseFourBarInput(input);
      this.lastTable = rows;
      const first = rows[0];
      if (rows.length === 1 && first) {
        // Single mechanism: switch the workbench to it.
        this.state.r1 = first.r1;
        this.state.r2 = first.r2;
        this.state.r3 = first.r3;
        this.state.r4 = first.r4;
        this.state.branch = first.branch;
        this.state.mode = 'fourbar';
        this.products.theta1 = 0;
        this.recompute();
        this.draw();
      }
      return {
        ok: true,
        output: {
          count: rows.length,
          rows: rows.map((r) => ({
            r1: r.r1, r2: r.r2, r3: r.r3, r4: r.r4,
            type: r.type,
            crankRotates: r.crankRotates,
            rockerSwingDeg: Number(r.rockerSwingDeg.toFixed(4)),
            minTransmissionDeg: Number(r.minTransmissionDeg.toFixed(4)),
            assemblable: r.assemblable,
          })),
        },
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ---- serialization (SimPlugin style) -------------------------------------

  serialize(): string {
    return JSON.stringify({ version: 1, plugin: this.manifest.id, state: this.state, theta1: this.products.theta1 });
  }

  deserialize(raw: string): boolean {
    try {
      const obj = JSON.parse(raw) as { state?: Partial<State>; theta1?: number };
      if (!obj.state || typeof obj.state !== 'object') return false;
      const st = obj.state;
      const numKeys: Array<keyof State> = [
        'r1', 'r2', 'r3', 'r4', 'couplerC', 'couplerE', 'omega1',
        'camR0', 'camRollerR', 'camH', 'camRiseB', 'camDwellB', 'camReturnB',
        'camOffset', 'camSpeed', 'zs', 'zp', 'wIn',
      ];
      for (const k of numKeys) {
        const v = st[k];
        if (typeof v === 'number' && Number.isFinite(v)) {
          (this.state as unknown as Record<string, number>)[k as string] = v;
        }
      }
      const strKeys: Array<[keyof State, readonly string[]]> = [
        ['mode', MODES], ['branch', ['open', 'crossed']], ['camLaw', CAM_LAWS],
        ['camFollower', FOLLOWERS], ['gearType', ['fixed', 'planetary']],
        ['planetFixed', MEMBERS], ['planetInput', MEMBERS],
      ];
      for (const [k, allowed] of strKeys) {
        const v = st[k];
        if (typeof v === 'string' && allowed.includes(v)) {
          (this.state as unknown as Record<string, string>)[k as string] = v;
        }
      }
      if (typeof st.showCurve === 'boolean') this.state.showCurve = st.showCurve;
      if (typeof st.playing === 'boolean') this.state.playing = st.playing;
      if (typeof st.trainSpec === 'string') this.state.trainSpec = st.trainSpec.slice(0, 120);
      if (typeof obj.theta1 === 'number' && Number.isFinite(obj.theta1)) {
        this.products.theta1 = ((obj.theta1 % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      }
      this.recompute();
      this.draw();
      this.syncLoop();
      return true;
    } catch {
      return false;
    }
  }

  // ---- export --------------------------------------------------------------

  private exportCsv(): void {
    const s = this.state;
    if (s.mode === 'fourbar' || s.mode === 'motion') {
      const sweep = this.ensureSweep();
      if (!sweep) {
        notify(this.api, 'warning', 'Run a simulation first.', '请先运行仿真。');
        return;
      }
      const stride = Math.max(1, Math.ceil(sweep.theta1.length / 1440));
      const rows: Array<Array<number | string>> = [];
      for (let i = 0; i < sweep.theta1.length; i += stride) {
        rows.push([
          Number((sweep.theta1[i]! * 180 / Math.PI).toPrecision(8)),
          Number.isFinite(sweep.theta2[i]!) ? Number((sweep.theta2[i]! * 180 / Math.PI).toPrecision(8)) : '—',
          Number.isFinite(sweep.theta3[i]!) ? Number((sweep.theta3[i]! * 180 / Math.PI).toPrecision(8)) : '—',
          Number.isFinite(sweep.couplerX[i]!) ? Number(sweep.couplerX[i]!.toPrecision(8)) : '—',
          Number.isFinite(sweep.couplerY[i]!) ? Number(sweep.couplerY[i]!.toPrecision(8)) : '—',
        ]);
      }
      exportRowsCsv(this.api, 'kin-fourbar-sweep', ['theta1_deg', 'theta2_deg', 'theta3_deg', 'coupler_x', 'coupler_y'], rows);
    } else if (s.mode === 'cam' && this.products.cam) {
      const rows: Array<Array<number | string>> = this.products.cam.samples.map((smp) => [
        Number((smp.theta * 180 / Math.PI).toPrecision(8)),
        Number(smp.s.toPrecision(8)),
        Number(smp.ds.toPrecision(8)),
        Number(smp.dds.toPrecision(8)),
        Number(smp.pressureDeg.toPrecision(6)),
        Number(smp.ax.toPrecision(8)),
        Number(smp.ay.toPrecision(8)),
      ]);
      exportRowsCsv(this.api, 'kin-cam-profile', ['theta_deg', 's', 'ds_dtheta', 'dds', 'pressure_deg', 'profile_x', 'profile_y'], rows);
    } else if (s.mode === 'gear') {
      const rows: Array<Array<number | string>> = [];
      if (this.products.train) {
        rows.push(['fixed-axis', `i = ${this.products.train.reduction.toFixed(6)}`, this.products.train.reversed ? 'reversed' : 'same-direction']);
        for (const st of this.products.train.stages) {
          rows.push([`${st.za} -> ${st.zb}${st.internal ? ' (internal)' : ''}`, `stage ratio = ${st.ratio.toFixed(6)}`, '']);
        }
      }
      if (this.products.planet) {
        const p = this.products.planet;
        rows.push(['planetary 2K-H', `zs=${p.zs} zp=${p.zp} zr=${p.zr}`, '']);
        rows.push(['omega_sun', p.wSun.toFixed(6), 'rad/s']);
        rows.push(['omega_ring', p.wRing.toFixed(6), 'rad/s']);
        rows.push(['omega_carrier', p.wCarrier.toFixed(6), 'rad/s']);
        rows.push(['i_in_out', p.i.toFixed(6), '']);
      }
      if (this.products.pair) {
        rows.push(['contact ratio eps_alpha', this.products.pair.contactRatio.toFixed(6), '']);
      }
      exportRowsCsv(this.api, 'kin-gear-train', ['item', 'value', 'note'], rows);
    } else {
      notify(this.api, 'warning', 'Nothing to export in this mode.', '当前模式无数据可导出。');
    }
  }

  // ---- drawing -------------------------------------------------------------

  private fnt(px: number): string {
    return `${px}px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  }

  /** Redraw the current mode onto the host canvas (public for frame drivers). */
  draw(): void {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width;
    const h = canvas.height;
    const mode = this.state.mode;
    const title = mode === 'fourbar' ? (this.zh ? '四杆机构 · 运动学' : 'Four-bar linkage · kinematics')
      : mode === 'cam' ? (this.zh ? '凸轮机构 · 廓线设计' : 'Disk cam · profile design')
        : mode === 'gear' ? (this.zh ? '轮系 · 传动比' : 'Gear trains · ratios')
          : (this.zh ? '速度 / 加速度多边形' : 'Velocity / acceleration polygons');
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = this.fnt(13);
    g.fillText(title, w / 2, 18);

    const err = this.errorMsg ?? this.products.kinError;
    if (mode === 'fourbar' || mode === 'motion') {
      const l = this.products.links;
      if (!l) return;
      if (mode === 'fourbar') this.drawFourbar(g, l);
      else this.drawMotion(g);
    } else if (mode === 'cam') {
      if (!this.products.cam || !this.products.camParams) {
        this.drawError(g, w, h, err ?? 'invalid cam parameters');
        return;
      }
      this.drawCam(g, this.products.cam, this.products.camParams);
    } else {
      if (!this.products.train && !this.products.planet) {
        this.drawError(g, w, h, err ?? 'invalid gear parameters');
        return;
      }
      this.drawGear(g);
    }
    if (mode === 'fourbar' || mode === 'motion') this.drawFooterFourbar(g, h);
    else if (mode === 'cam') this.drawFooterCam(g, h);
    else this.drawFooterGear(g, h);
  }

  private drawError(g: CanvasRenderingContext2D, w: number, h: number, msg: string): void {
    g.fillStyle = 'rgba(255,140,140,0.95)';
    g.font = this.fnt(12);
    g.textAlign = 'center';
    g.fillText(`${this.zh ? '参数无效：' : 'Invalid parameters: '}${msg}`, w / 2, h / 2);
  }

  /** Mechanism sketch: links, joints, coupler curve, I13, theta1 arc. */
  private drawFourbar(g: CanvasRenderingContext2D, l: FourBarLinks): void {
    const w = canvas_width(g);
    const h = canvas_height(g);
    const sweep = this.ensureSweep();
    const pose = solveFourBar(l, this.products.theta1, this.state.branch);
    if (!Number.isFinite(pose.theta2)) {
      this.drawError(g, w, h, this.zh ? '该位置无法装配（圆不相交）' : 'not assemblable at this angle');
      return;
    }
    // World bounds from the coupler path and joints.
    let xLo = Math.min(0, l.r4) - 1;
    let xHi = Math.max(l.r4, l.r4 + l.r1 + l.r2) + 1;
    let yLo = -(l.r1 + l.r2) - 1;
    let yHi = l.r1 + l.r2 + 1;
    if (sweep && this.state.showCurve) {
      for (let i = 0; i < sweep.couplerX.length; i += 1) {
        const x = sweep.couplerX[i]!;
        const y = sweep.couplerY[i]!;
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        xLo = Math.min(xLo, x);
        xHi = Math.max(xHi, x);
        yLo = Math.min(yLo, y);
        yHi = Math.max(yHi, y);
      }
    }
    const cx = (xLo + xHi) / 2;
    const cy = (yLo + yHi) / 2;
    const span = Math.max(xHi - xLo, yHi - yLo);
    const scale = (Math.min(w, h) * 0.78) / span;
    const mapX = (x: number): number => w / 2 + (x - cx) * scale;
    const mapY = (y: number): number => h / 2 - (y - cy) * scale;

    // Coupler curve (ghost).
    if (sweep && this.state.showCurve) {
      g.strokeStyle = 'rgba(166,148,203,0.55)';
      g.lineWidth = 1.2;
      g.setLineDash([5, 3]);
      g.beginPath();
      let pen = false;
      for (let i = 0; i < sweep.couplerX.length; i += 1) {
        const x = sweep.couplerX[i]!;
        const y = sweep.couplerY[i]!;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          pen = false;
          continue;
        }
        if (!pen) {
          g.moveTo(mapX(x), mapY(y));
          pen = true;
        } else g.lineTo(mapX(x), mapY(y));
      }
      g.stroke();
      g.setLineDash([]);
    }

    const cp = { c: this.state.couplerC * l.r2, e: this.state.couplerE };
    const [px0, py0] = [pose.A[0] + cp.c * Math.cos(pose.theta2) - cp.e * Math.sin(pose.theta2), pose.A[1] + cp.c * Math.sin(pose.theta2) + cp.e * Math.cos(pose.theta2)];

    // Ground link with hatching.
    g.strokeStyle = 'rgba(150,160,175,0.75)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(mapX(0), mapY(0));
    g.lineTo(mapX(l.r4), mapY(0));
    g.stroke();
    g.lineWidth = 1;
    for (let i = 0; i <= 6; i += 1) {
      const x = mapX((i / 6) * l.r4);
      const y = mapY(0);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x - 6, y + 8);
      g.stroke();
    }

    // Links.
    const line = (x1: number, y1: number, x2: number, y2: number, color: string, lw: number): void => {
      g.strokeStyle = color;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(mapX(x1), mapY(y1));
      g.lineTo(mapX(x2), mapY(y2));
      g.stroke();
    };
    line(pose.O2[0], pose.O2[1], pose.A[0], pose.A[1], 'rgba(110,168,216,0.95)', 4); // crank
    line(pose.A[0], pose.A[1], pose.B[0], pose.B[1], 'rgba(216,180,106,0.95)', 4); // coupler
    line(pose.B[0], pose.B[1], pose.O4[0], pose.O4[1], 'rgba(127,191,158,0.95)', 4); // rocker

    // Joints.
    const joint = (x: number, y: number, filled: boolean): void => {
      g.beginPath();
      g.arc(mapX(x), mapY(y), 4.5, 0, Math.PI * 2);
      g.fillStyle = filled ? 'rgba(220,228,240,0.95)' : '#0a0e13';
      g.fill();
      g.strokeStyle = 'rgba(220,228,240,0.95)';
      g.lineWidth = 1.5;
      g.stroke();
    };
    joint(pose.O2[0], pose.O2[1], false);
    joint(pose.O4[0], pose.O4[1], false);
    joint(pose.A[0], pose.A[1], true);
    joint(pose.B[0], pose.B[1], true);
    // Coupler point.
    g.fillStyle = 'rgba(190,140,200,0.95)';
    g.beginPath();
    g.arc(mapX(px0), mapY(py0), 3.5, 0, Math.PI * 2);
    g.fill();

    // Instant center I13.
    try {
      const k = fourBarKinematics(l, this.products.theta1, Math.max(this.state.omega1, 1e-9), this.state.branch);
      if (k.i13) {
        const ix = mapX(k.i13[0]);
        const iy = mapY(k.i13[1]);
        g.strokeStyle = 'rgba(255,209,102,0.9)';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(ix - 6, iy);
        g.lineTo(ix + 6, iy);
        g.moveTo(ix, iy - 6);
        g.lineTo(ix, iy + 6);
        g.stroke();
        g.fillStyle = 'rgba(255,209,102,0.95)';
        g.font = '10px Consolas, monospace';
        g.textAlign = 'left';
        g.fillText('I13', ix + 8, iy - 6);
      }
    } catch {
      // Singular pose — no IC drawn.
    }

    // Labels.
    g.font = '10px Consolas, monospace';
    g.fillStyle = 'rgba(200,210,225,0.95)';
    g.textAlign = 'center';
    g.fillText('O2', mapX(0), mapY(0) + 16);
    g.fillText('O4', mapX(l.r4), mapY(0) + 16);
    g.fillText('A', mapX(pose.A[0]) + 10, mapY(pose.A[1]) - 6);
    g.fillText('B', mapX(pose.B[0]) + 10, mapY(pose.B[1]) - 6);

    // theta1 arc arrow.
    g.strokeStyle = 'rgba(110,168,216,0.6)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(mapX(0), mapY(0), 18, -this.products.theta1, 0, false);
    g.stroke();
  }

  /** Velocity + acceleration polygon panels. */
  private drawMotion(g: CanvasRenderingContext2D): void {
    const w = canvas_width(g);
    const h = canvas_height(g);
    const gap = 24;
    const panelW = (w - 3 * gap) / 2;
    const top = 30;
    const panelH = h - top - 52;
    this.drawPolygon(g, this.products.velPoly, { x: gap, y: top, w: panelW, h: panelH }, this.zh ? '速度多边形' : 'Velocity polygon');
    this.drawPolygon(g, this.products.accPoly, { x: 2 * gap + panelW, y: top, w: panelW, h: panelH }, this.zh ? '加速度多边形' : 'Acceleration polygon');
  }

  private drawPolygon(g: CanvasRenderingContext2D, data: PolygonData | null, rect: Rect, title: string): void {
    g.strokeStyle = 'rgba(120,140,165,0.45)';
    g.lineWidth = 1;
    g.strokeRect(rect.x, rect.y, rect.w, rect.h);
    g.fillStyle = 'rgba(230,238,248,0.9)';
    g.font = this.fnt(11);
    g.textAlign = 'left';
    g.fillText(title, rect.x + 8, rect.y + 15);
    if (!data) {
      g.fillStyle = 'rgba(255,170,170,0.9)';
      g.font = this.fnt(11);
      g.textAlign = 'center';
      g.fillText(this.zh ? '奇异位形（变点）' : 'singular pose (change point)', rect.x + rect.w / 2, rect.y + rect.h / 2);
      return;
    }
    let m = 0;
    for (const n of data.nodes) m = Math.max(m, Math.abs(n.x), Math.abs(n.y));
    if (m <= 0) return;
    const scale = (Math.min(rect.w, rect.h) * 0.38) / m;
    const ox = rect.x + rect.w / 2;
    const oy = rect.y + rect.h / 2 + 6;
    const node = (id: string): { x: number; y: number } | null => {
      const n = data.nodes.find((v) => v.id === id);
      return n ? { x: ox + n.x * scale, y: oy - n.y * scale } : null;
    };
    // Segments.
    for (const seg of data.segments) {
      const a = node(seg.from);
      const b = node(seg.to);
      if (!a || !b) continue;
      const main = seg.from === 'p' && (seg.to === 'a' || seg.to === 'b' || seg.to === 'c');
      g.strokeStyle = main ? 'rgba(110,168,216,0.9)' : 'rgba(216,180,106,0.85)';
      g.lineWidth = main ? 2 : 1.4;
      if (seg.label === 'vB = w3·r3' || seg.label === 'aB') g.strokeStyle = 'rgba(127,191,158,0.9)';
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      // Arrowhead.
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      g.beginPath();
      g.moveTo(b.x, b.y);
      g.lineTo(b.x - 7 * Math.cos(ang - 0.4), b.y - 7 * Math.sin(ang - 0.4));
      g.lineTo(b.x - 7 * Math.cos(ang + 0.4), b.y - 7 * Math.sin(ang + 0.4));
      g.closePath();
      g.fillStyle = g.strokeStyle;
      g.fill();
    }
    // Node dots + labels.
    g.font = '10px Consolas, monospace';
    for (const n of data.nodes) {
      const p = node(n.id);
      if (!p) continue;
      g.fillStyle = n.id === 'p' ? 'rgba(170,182,200,0.9)' : 'rgba(230,238,248,0.95)';
      g.beginPath();
      g.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
      g.fill();
      g.fillText(n.id, p.x + 6, p.y - 5);
    }
  }

  /** Cam sketch: base circle, pitch + actual profiles, follower, alpha label. */
  private drawCam(g: CanvasRenderingContext2D, cam: CamResult, p: CamParams): void {
    const w = canvas_width(g);
    const h = canvas_height(g);
    const cx = w / 2;
    const cy = h * 0.56;
    const maxR = p.r0 + p.h + (p.follower === 'roller' ? p.rollerR : 0) + Math.abs(p.offset) + 6;
    const scale = (Math.min(w, h) * 0.4) / maxR;
    const rot = this.products.camAngle;
    const tx = (x: number, y: number): [number, number] => {
      const xr = x * Math.cos(rot) - y * Math.sin(rot);
      const yr = x * Math.sin(rot) + y * Math.cos(rot);
      return [cx + xr * scale, cy - yr * scale];
    };

    // Base (prime) circle, dashed.
    g.strokeStyle = 'rgba(150,160,175,0.5)';
    g.setLineDash([4, 4]);
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, p.r0 * scale, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);

    // Pitch curve (thin) and actual profile (thick).
    g.strokeStyle = 'rgba(166,148,203,0.7)';
    g.lineWidth = 1;
    g.beginPath();
    cam.samples.forEach((smp, i) => {
      const [sx, sy] = tx(smp.px, smp.py);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    });
    g.closePath();
    g.stroke();

    g.strokeStyle = 'rgba(110,168,216,0.95)';
    g.lineWidth = 2.2;
    g.beginPath();
    cam.samples.forEach((smp, i) => {
      const [sx, sy] = tx(smp.ax, smp.ay);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    });
    g.closePath();
    g.stroke();

    // Follower at the current angle.
    const m = camMotion(p, rot);
    const e = p.follower === 'roller' ? p.offset : 0;
    const s0 = Math.sqrt(p.r0 * p.r0 - e * e);
    const liftY = cy - (m.s + s0) * scale;
    const rollX = cx + e * scale;
    if (p.follower === 'roller') {
      // Guide.
      g.strokeStyle = 'rgba(150,160,175,0.7)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(rollX - 10, cy - (p.r0 + p.h + p.rollerR + 14) * scale);
      g.lineTo(rollX - 10, liftY);
      g.moveTo(rollX + 10, cy - (p.r0 + p.h + p.rollerR + 14) * scale);
      g.lineTo(rollX + 10, liftY);
      g.stroke();
      // Stem + roller.
      g.strokeStyle = 'rgba(216,180,106,0.95)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(rollX, liftY);
      g.lineTo(rollX, cy - (p.r0 + p.h + p.rollerR + 14) * scale);
      g.stroke();
      g.beginPath();
      g.arc(rollX, liftY, p.rollerR * scale, 0, Math.PI * 2);
      g.fillStyle = 'rgba(216,180,106,0.25)';
      g.fill();
      g.strokeStyle = 'rgba(216,180,106,0.95)';
      g.lineWidth = 1.8;
      g.stroke();
      if (m.ds !== 0 || p.offset !== 0) {
        const alpha = Math.atan2(Math.abs(m.ds - e), m.s + s0) * 180 / Math.PI;
        g.fillStyle = 'rgba(255,209,102,0.95)';
        g.font = '10px Consolas, monospace';
        g.textAlign = 'left';
        g.fillText(`alpha = ${alpha.toFixed(1)} deg`, rollX + 14, liftY - 4);
      }
    } else {
      // Flat face: horizontal line tangent to the (shifted) profile point.
      const faceY = cy - (p.r0 + m.s) * scale;
      g.strokeStyle = 'rgba(216,180,106,0.95)';
      g.lineWidth = 2.4;
      g.beginPath();
      g.moveTo(cx - cam.faceLength * scale - 12, faceY);
      g.lineTo(cx + cam.faceLength * scale + 12, faceY);
      g.stroke();
      g.strokeStyle = 'rgba(150,160,175,0.7)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(cx - 6, faceY);
      g.lineTo(cx - 6, cy - (p.r0 + p.h + 30) * scale);
      g.moveTo(cx + 6, faceY);
      g.lineTo(cx + 6, cy - (p.r0 + p.h + 30) * scale);
      g.stroke();
    }
    // Cam center mark.
    g.fillStyle = 'rgba(220,228,240,0.95)';
    g.beginPath();
    g.arc(cx, cy, 3, 0, Math.PI * 2);
    g.fill();
  }

  /** Gear sketch: pitch circles (fixed stages in a row / planetary cluster). */
  private drawGear(g: CanvasRenderingContext2D): void {
    const w = canvas_width(g);
    const h = canvas_height(g);
    if (this.products.train) {
      const stages = this.products.train.stages;
      // Common module scaled to fit the row of tangent pitch circles.
      let span = 0;
      for (const st of stages) span += st.za / 2 + st.zb / 2;
      span += 1.2 * (stages.length - 1);
      const moduleM = (w * 0.85) / Math.max(span, 1);
      const maxR = Math.max(...stages.map((st) => Math.max(st.za, st.zb))) / 2 * moduleM;
      const scaleFit = Math.min(1, (h * 0.4) / Math.max(maxR, 1));
      const mEff = moduleM * scaleFit;
      const cy = h * 0.42;
      let x = w * 0.075;
      stages.forEach((st) => {
        const ra = (st.za / 2) * mEff;
        const rb = (st.zb / 2) * mEff;
        const xa = x + ra;
        const xb = xa + ra + rb;
        const circles: Array<{ px: number; r: number; dashed: boolean }> = [
          { px: xa, r: ra, dashed: false },
          { px: xb, r: rb, dashed: st.internal },
        ];
        for (const c of circles) {
          g.strokeStyle = c.dashed ? 'rgba(166,148,203,0.85)' : 'rgba(110,168,216,0.9)';
          g.lineWidth = 2;
          if (c.dashed) g.setLineDash([5, 4]);
          g.beginPath();
          g.arc(c.px, cy, c.r, 0, Math.PI * 2);
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = 'rgba(220,228,240,0.95)';
          g.beginPath();
          g.arc(c.px, cy, 2.5, 0, Math.PI * 2);
          g.fill();
        }
        g.font = '10px Consolas, monospace';
        g.fillStyle = 'rgba(200,210,225,0.95)';
        g.textAlign = 'center';
        g.fillText(`z=${st.za}`, xa, cy + ra + 14);
        g.fillText(`z=${st.zb}`, xb, cy + rb + 14);
        g.fillStyle = 'rgba(255,209,102,0.9)';
        g.fillText(`x${st.ratio.toFixed(3)}`, (xa + xb) / 2, cy - Math.max(ra, rb) - 8);
        x = xb + 1.2 * mEff;
      });
    } else if (this.products.planet) {
      const p = this.products.planet;
      const m = (Math.min(w, h) * 0.33) / ((p.zr) / 2);
      const cx = w / 2;
      const cy = h * 0.42;
      const rs = (p.zs / 2) * m;
      const rp = (p.zp / 2) * m;
      const rr = (p.zr / 2) * m;
      // Ring (internal, dashed).
      g.strokeStyle = 'rgba(166,148,203,0.85)';
      g.setLineDash([6, 4]);
      g.lineWidth = 2;
      g.beginPath();
      g.arc(cx, cy, rr, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
      // Carrier line.
      g.strokeStyle = 'rgba(150,160,175,0.8)';
      g.lineWidth = 1.4;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + rs + rp, cy);
      g.stroke();
      // Planet + sun.
      for (const [px, r] of [[cx + rs + rp, rp], [cx, rs]] as const) {
        g.strokeStyle = 'rgba(110,168,216,0.9)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(px, cy, r, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = 'rgba(220,228,240,0.95)';
        g.beginPath();
        g.arc(px, cy, 2.5, 0, Math.PI * 2);
        g.fill();
      }
      g.font = '10px Consolas, monospace';
      g.fillStyle = 'rgba(200,210,225,0.95)';
      g.textAlign = 'center';
      g.fillText(`zs=${p.zs}`, cx, cy + rs + 14);
      g.fillText(`zp=${p.zp}`, cx + rs + rp, cy + rp + 14);
      g.fillText(`zr=${p.zr}`, cx, cy - rr - 6);
    }
  }

  // ---- footers -------------------------------------------------------------

  private drawFooterFourbar(g: CanvasRenderingContext2D, h: number): void {
    const sweep = this.ensureSweep();
    g.textAlign = 'left';
    g.font = this.fnt(11);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    if (sweep) {
      const line = this.zh
        ? `Grashof: ${sweep.type} · 摇杆摆角 ${fmtMetric(sweep.rockerSwingDeg)}° · 传动角 ${fmtMetric(sweep.minTransmissionDeg)}°–${fmtMetric(sweep.maxTransmissionDeg)}°`
        : `Grashof: ${sweep.type} · rocker swing ${fmtMetric(sweep.rockerSwingDeg)} deg · transmission angle ${fmtMetric(sweep.minTransmissionDeg)}–${fmtMetric(sweep.maxTransmissionDeg)} deg`;
      g.fillText(line, 16, h - 24);
    }
    const pose = this.products.links ? solveFourBar(this.products.links, this.products.theta1, this.state.branch) : null;
    if (pose && Number.isFinite(pose.residual)) {
      g.fillStyle = 'rgba(200,210,225,0.9)';
      g.fillText(`theta1 = ${(((this.products.theta1 * 180) / Math.PI) % 360).toFixed(1)} deg · residual = ${pose.residual.toExponential(1)}`, 16, h - 8);
    }
  }

  private drawFooterCam(g: CanvasRenderingContext2D, h: number): void {
    const cam = this.products.cam;
    if (!cam) return;
    g.textAlign = 'left';
    g.font = this.fnt(11);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const zh = this.zh;
    const line = zh
      ? `升程压力角 ${fmtMetric(cam.maxPressureRiseDeg)}° · 回程 ${fmtMetric(cam.maxPressureReturnDeg)}° · 根切 ${cam.undercut ? '是' : '否'} · 末段休止 ${cam.dwell2}°`
      : `rise alpha ${fmtMetric(cam.maxPressureRiseDeg)} deg · return ${fmtMetric(cam.maxPressureReturnDeg)} deg · undercut ${cam.undercut ? 'yes' : 'no'} · trailing dwell ${cam.dwell2} deg`;
    g.fillText(line, 16, h - 24);
    const m = this.products.camParams ? camMotion(this.products.camParams, this.products.camAngle) : null;
    if (m) {
      g.fillStyle = 'rgba(200,210,225,0.9)';
      g.fillText(`${zh ? '当前行程' : 'current lift'} s = ${fmtMetric(m.s)} · |ds/dθ| = ${fmtMetric(Math.abs(m.ds))}`, 16, h - 8);
    }
  }

  private drawFooterGear(g: CanvasRenderingContext2D, h: number): void {
    g.textAlign = 'left';
    g.font = this.fnt(11);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    if (this.products.train) {
      const t = this.products.train;
      g.fillText(
        this.zh
          ? `总传动比 |i| = ${fmtMetric(t.reduction)} · 输出${t.reversed ? '反向' : '同向'}`
          : `total ratio |i| = ${fmtMetric(t.reduction)} · output ${t.reversed ? 'reversed' : 'same direction'}`,
        16, h - 24,
      );
    }
    if (this.products.planet) {
      const p = this.products.planet;
      g.fillText(
        `i = ${fmtMetric(p.i)} · ωs = ${fmtMetric(p.wSun)} · ωr = ${fmtMetric(p.wRing)} · ωH = ${fmtMetric(p.wCarrier)} rad/s`,
        16, h - 24,
      );
    }
    if (this.products.pair) {
      g.fillStyle = 'rgba(200,210,225,0.9)';
      g.fillText(
        `${this.zh ? '代表齿轮副' : 'representative pair'} z1=${this.products.pair.z1}, z2=${this.products.pair.z2} · εα = ${fmtMetric(this.products.pair.contactRatio)} · α' = ${fmtMetric(this.products.pair.alphaWdeg)} deg`,
        16, h - 8,
      );
    }
  }
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Canvas width of the context currently being drawn (draw() sizes it first). */
function canvas_width(g: CanvasRenderingContext2D): number {
  return g.canvas.width;
}

function canvas_height(g: CanvasRenderingContext2D): number {
  return g.canvas.height;
}

export default function createEngKinematicsPlugin(): Plugin {
  return new EngKinematicsPlugin();
}
