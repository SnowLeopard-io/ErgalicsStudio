// ==========================================================================
// Example plugin: Double Pendulum (chaotic mechanics)
//
// Classical double pendulum integrated with RK4 at a fixed timestep.
// Two pendula run side by side: the primary and a "ghost" whose initial
// angle differs by one thousandth of a degree — the ghost's trajectory
// diverges exponentially, a direct visualization of sensitive dependence
// on initial conditions (the chaos signature of this system).
//
// Pure CPU (the state is four numbers — there is nothing for a GPU to do).
// ==========================================================================

import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
} from '@/types/plugin';

export const pendulumManifest: PluginManifest = {
  id: 'example.pendulum',
  name: 'Double Pendulum',
  nameI18n: { 'zh-CN': '双摆（混沌）', 'en-US': 'Double Pendulum' },
  version: '1.0.0',
  author: 'Ergalics',
  description: 'Chaotic double pendulum with an initial-condition twin.',
  descriptionI18n: {
    'zh-CN': 'RK4 积分的经典双摆：主摆与初始角仅差 0.001° 的“幽灵摆”并行演化，直观展示混沌对初值的敏感依赖。',
    'en-US': 'Classic double pendulum integrated with RK4: a ghost pendulum offset by 0.001° diverges exponentially — chaos made visible.',
  },
  license: 'MIT',
  entry: 'example.pendulum',
  category: 'scientific',
  icon: '⚧',
  formats: [
    {
      extension: '.json',
      mimeTypes: ['application/json'],
      description: 'Initial conditions: { th1, th2, w1?, w2? } (degrees, deg/s)',
    },
  ],
};

// ---- Physics (exported for tests) ------------------------------------------

export interface PendulumParams {
  m1: number;
  m2: number;
  l1: number;
  l2: number;
  g: number;
}

export type PendulumState = [th1: number, w1: number, th2: number, w2: number];

/**
 * Time derivatives of the double-pendulum state (θ̈ from the standard
 * Lagrangian equations of motion).
 */
export function pendulumDeriv(s: PendulumState, p: PendulumParams): PendulumState {
  const [th1, w1, th2, w2] = s;
  const { m1, m2, l1, l2, g } = p;
  const d = th1 - th2;
  const den = 2 * m1 + m2 - m2 * Math.cos(2 * d);
  const a1 =
    (-g * (2 * m1 + m2) * Math.sin(th1) -
      m2 * g * Math.sin(th1 - 2 * th2) -
      2 * Math.sin(d) * m2 * (w2 * w2 * l2 + w1 * w1 * l1 * Math.cos(d))) /
    (l1 * den);
  const a2 =
    (2 *
      Math.sin(d) *
      (w1 * w1 * l1 * (m1 + m2) + g * (m1 + m2) * Math.cos(th1) + w2 * w2 * l2 * m2 * Math.cos(d))) /
    (l2 * den);
  return [w1, a1, w2, a2];
}

/** One RK4 step of the double pendulum with the given dt. */
export function pendulumStepRK4(s: PendulumState, p: PendulumParams, dt: number): PendulumState {
  const add = (a: PendulumState, b: PendulumState, f: number): PendulumState => [
    a[0] + b[0] * f,
    a[1] + b[1] * f,
    a[2] + b[2] * f,
    a[3] + b[3] * f,
  ];
  const k1 = pendulumDeriv(s, p);
  const k2 = pendulumDeriv(add(s, k1, dt / 2), p);
  const k3 = pendulumDeriv(add(s, k2, dt / 2), p);
  const k4 = pendulumDeriv(add(s, k3, dt), p);
  return [
    s[0] + ((k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) * dt) / 6,
    s[1] + ((k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) * dt) / 6,
    s[2] + ((k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]) * dt) / 6,
    s[3] + ((k1[3] + 2 * k2[3] + 2 * k3[3] + k4[3]) * dt) / 6,
  ];
}

/** Total mechanical energy (KE + PE, y measured from the pivot). */
export function pendulumEnergy(s: PendulumState, p: PendulumParams): number {
  const [th1, w1, th2, w2] = s;
  const { m1, m2, l1, l2, g } = p;
  const y1 = -l1 * Math.cos(th1);
  const y2 = y1 - l2 * Math.cos(th2);
  const vx1 = l1 * w1 * Math.cos(th1);
  const vy1 = l1 * w1 * Math.sin(th1);
  const vx2 = vx1 + l2 * w2 * Math.cos(th2);
  const vy2 = vy1 + l2 * w2 * Math.sin(th2);
  const ke = 0.5 * m1 * (vx1 * vx1 + vy1 * vy1) + 0.5 * m2 * (vx2 * vx2 + vy2 * vy2);
  const pe = m1 * g * y1 + m2 * g * y2;
  return ke + pe;
}

// ---- Plugin ------------------------------------------------------------------

const TRAIL_LEN = 500;

interface Twin {
  state: PendulumState;
  trail: number[][]; // [x, y] of bob 2, most recent last
}

interface State {
  m1: number;
  m2: number;
  l1: number;
  l2: number;
  g: number;
  speed: number;
  showTrail: boolean;
  showGhost: boolean;
  running: boolean;
  /** True once initial conditions have been loaded — the plugin never
   * fabricates a default state; without data it stays empty. */
  hasData: boolean;
}

const GHOST_OFFSET = 1e-3; // radians ≈ 0.057°

export interface PendulumIC {
  th1: number;
  w1: number;
  th2: number;
  w2: number;
}

/**
 * Parse initial conditions: `{ th1, th2, w1?, w2? }` with angles in degrees
 * and angular velocities in degrees per second (both default 0). Returns
 * radians internally, or `null` for anything invalid.
 */
export function parsePendulumIC(parsed: unknown): PendulumIC | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const th1 = Number(obj.th1);
  const th2 = Number(obj.th2);
  const w1 = obj.w1 === undefined ? 0 : Number(obj.w1);
  const w2 = obj.w2 === undefined ? 0 : Number(obj.w2);
  if (![th1, th2, w1, w2].every(Number.isFinite)) return null;
  const deg = Math.PI / 180;
  return { th1: th1 * deg, th2: th2 * deg, w1: w1 * deg, w2: w2 * deg };
}

export class DoublePendulumPlugin implements Plugin {
  readonly manifest = pendulumManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private state: State = {
    m1: 2,
    m2: 1,
    l1: 1,
    l2: 1,
    g: 9.81,
    speed: 1,
    showTrail: true,
    showGhost: true,
    running: false,
    hasData: false,
  };
  private main!: Twin;
  private ghost!: Twin;
  private initialIC: PendulumIC | null = null;
  private rafId = 0;
  private lastFrame = 0;
  private acc = 0;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.stop();
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {
    this.stop();
  }

  async render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  updateParams(params: Record<string, unknown>) {
    // Mass / length / gravity changes apply live; Reset replays the loaded
    // initial conditions with the new parameters.
    for (const key of ['m1', 'm2', 'l1', 'l2', 'g'] as const) {
      if (typeof params[key] === 'number' && params[key] !== this.state[key]) {
        const [lo, hi] = key === 'g' ? [1, 30] : key === 'm1' || key === 'm2' ? [0.5, 5] : [0.5, 2];
        const clamped = Math.max(lo, Math.min(hi, params[key] as number));
        if (clamped !== this.state[key]) {
          this.state[key] = clamped;
          if (this.state.hasData) this.replayLoaded();
        }
      }
    }
    if (typeof params.speed === 'number') this.state.speed = Math.max(0.1, Math.min(5, params.speed));
    if (typeof params.showTrail === 'boolean') this.state.showTrail = params.showTrail;
    if (typeof params.showGhost === 'boolean') {
      this.state.showGhost = params.showGhost;
      this.draw();
    }
    if (typeof params.start === 'boolean') {
      if (params.start) this.start();
      else this.stop();
    }
    const reset = params.reset as { action?: string } | undefined;
    if (reset?.action === 'reset') {
      // Reset replays the loaded initial conditions; it never fabricates a
      // default state when no data has been loaded.
      if (!this.state.hasData) {
        this.api.notify(
          'warning',
          this.api.locale === 'zh-CN'
            ? '尚未加载初始条件 — 拖入 JSON 文件或打开「示例数据」'
            : 'No initial conditions loaded — drop a JSON file or open sample data',
        );
        return;
      }
      this.replayLoaded();
      this.draw();
    }
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'm1', label: 'Mass 1', labelI18n: { 'zh-CN': '质量 1', 'en-US': 'Mass 1' }, type: 'range', min: 0.5, max: 5, step: 0.1, value: this.state.m1 },
      { key: 'm2', label: 'Mass 2', labelI18n: { 'zh-CN': '质量 2', 'en-US': 'Mass 2' }, type: 'range', min: 0.5, max: 5, step: 0.1, value: this.state.m2 },
      { key: 'l1', label: 'Length 1', labelI18n: { 'zh-CN': '摆长 1', 'en-US': 'Length 1' }, type: 'range', min: 0.5, max: 2, step: 0.05, value: this.state.l1 },
      { key: 'l2', label: 'Length 2', labelI18n: { 'zh-CN': '摆长 2', 'en-US': 'Length 2' }, type: 'range', min: 0.5, max: 2, step: 0.05, value: this.state.l2 },
      { key: 'g', label: 'Gravity', labelI18n: { 'zh-CN': '重力加速度', 'en-US': 'Gravity' }, type: 'range', min: 1, max: 30, step: 0.1, value: this.state.g },
      { key: 'speed', label: 'Speed', labelI18n: { 'zh-CN': '速度倍率', 'en-US': 'Speed' }, type: 'range', min: 0.1, max: 5, step: 0.1, value: this.state.speed },
      { key: 'showTrail', label: 'Trail', labelI18n: { 'zh-CN': '轨迹', 'en-US': 'Trail' }, type: 'checkbox', value: this.state.showTrail },
      { key: 'showGhost', label: 'Chaos Ghost', labelI18n: { 'zh-CN': '混沌幽灵摆', 'en-US': 'Chaos Ghost' }, type: 'checkbox', value: this.state.showGhost },
      {
        key: 'start',
        label: 'Run',
        type: 'toggle',
        value: this.state.running,
        offLabelI18n: { 'zh-CN': '▶ 开始摆动', 'en-US': '▶ Start' },
        onLabelI18n: { 'zh-CN': '■ 停止', 'en-US': '■ Stop' },
      },
      {
        key: 'reset',
        label: 'Reset',
        labelI18n: { 'zh-CN': '重置', 'en-US': 'Reset' },
        type: 'button',
        variant: 'default',
        action: 'reset',
      },
    ];
  }

  private physics(): PendulumParams {
    return { m1: this.state.m1, m2: this.state.m2, l1: this.state.l1, l2: this.state.l2, g: this.state.g };
  }

  /**
   * Load initial conditions: `{ th1, th2, w1?, w2? }` (angles in degrees,
   * angular velocities in deg/s). The ghost twin is seeded with th1 offset
   * by GHOST_OFFSET to expose sensitive dependence on initial conditions.
   */
  async loadData(file: File) {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '无法解析初始条件文件（JSON）' : 'Could not parse IC file (JSON)');
      return;
    }
    const ic = parsePendulumIC(parsed);
    if (!ic) {
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '需要 JSON 对象：{ "th1": 角度, "th2": 角度, "w1"?, "w2"? }'
          : 'Expected a JSON object: { "th1": deg, "th2": deg, "w1"?, "w2"? }',
      );
      return;
    }
    this.initialIC = ic;
    this.state.hasData = true;
    this.replayLoaded();
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  /** Apply the loaded initial conditions: fresh pendula, cleared trails. */
  private replayLoaded() {
    const ic = this.initialIC;
    if (!ic) return;
    this.main = {
      state: [ic.th1, ic.w1, ic.th2, ic.w2],
      trail: [],
    };
    this.ghost = {
      state: [ic.th1 + GHOST_OFFSET, ic.w1, ic.th2, ic.w2],
      trail: [],
    };
  }

  private start() {
    if (this.state.running) return;
    if (!this.state.hasData) {
      // Data-driven: without loaded initial conditions there is nothing to
      // swing — never fabricate a default state.
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '请先加载初始条件 — 拖入 JSON 文件或打开「示例数据」'
          : 'Load initial conditions first — drop a JSON file or open sample data',
      );
      return;
    }
    this.state.running = true;
    this.api.setStatus('computing');
    this.lastFrame = performance.now();
    this.acc = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stop() {
    this.state.running = false;
    cancelAnimationFrame(this.rafId);
    this.api.setStatus('ready');
  }

  private tick = (now: number) => {
    if (!this.state.running) return;
    // Clamp the wall-clock delta so a stalled tab cannot teleport the arms.
    const dtReal = Math.min((now - this.lastFrame) / 1000, 0.1) * this.state.speed;
    this.lastFrame = now;
    this.acc += dtReal;
    const dt = 1 / 240;
    const p = this.physics();
    let steps = 0;
    while (this.acc >= dt && steps < 240) {
      this.main.state = pendulumStepRK4(this.main.state, p, dt);
      if (this.state.showGhost) this.ghost.state = pendulumStepRK4(this.ghost.state, p, dt);
      this.acc -= dt;
      steps += 1;
    }
    this.pushTrail(this.main);
    if (this.state.showGhost) this.pushTrail(this.ghost);
    this.draw();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private pushTrail(t: Twin) {
    const p = this.physics();
    const [x, y] = bob2(t.state, p);
    t.trail.push([x, y]);
    if (t.trail.length > TRAIL_LEN) t.trail.shift();
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 400;
    canvas.height = canvas.clientHeight || 300;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (!this.state.hasData || !this.main) {
      // Empty state: no initial conditions loaded — never render a
      // fabricated pendulum.
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = `12px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'center';
      const msg =
        this.api.locale === 'zh-CN'
          ? '未加载数据 — 拖入 JSON 初始条件或打开「示例数据」'
          : 'No data — drop a JSON initial-condition file or load sample data';
      g.fillText(msg, canvas.width / 2, canvas.height / 2);
      return;
    }

    const p = this.physics();
    const w = canvas.width;
    const h = canvas.height;
    const pivotX = w / 2;
    const pivotY = h * 0.3;
    const scale = Math.min(w / (2.3 * (p.l1 + p.l2)), h / (1.8 * (p.l1 + p.l2)));

    // Trails (fading).
    if (this.state.showTrail) {
      drawTrail(g, this.ghost.trail, pivotX, pivotY, scale, 'rgba(255, 120, 120, ', this.state.showGhost ? 0.5 : 0);
      drawTrail(g, this.main.trail, pivotX, pivotY, scale, 'rgba(45, 212, 191, ', 1);
    }

    // Ghost pendulum (drawn under the main one).
    if (this.state.showGhost) {
      drawArms(g, this.ghost.state, p, pivotX, pivotY, scale, 'rgba(255, 110, 110, 0.55)', 'rgba(255, 110, 110, 0.35)');
    }
    drawArms(g, this.main.state, p, pivotX, pivotY, scale, '#2dd4bf', '#e2e8f0');

    // Pivot.
    g.fillStyle = '#8b98ab';
    g.beginPath();
    g.arc(pivotX, pivotY, 3, 0, Math.PI * 2);
    g.fill();

    // HUD: divergence of the twin, in degrees.
    const div = Math.abs(((this.main.state[0] - this.ghost.state[0]) * 180) / Math.PI);
    g.fillStyle = 'rgba(150, 165, 185, 0.9)';
    g.font = `11px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    const label =
      this.api.locale === 'zh-CN'
        ? `幽灵摆偏差: ${div < 0.01 ? div.toExponential(2) : div.toFixed(2)}°`
        : `Ghost divergence: ${div < 0.01 ? div.toExponential(2) : div.toFixed(2)}°`;
    g.fillText(label, 12, 20);
  }
}

/** Position of the second bob in world units (pivot at origin, y down). */
function bob2(s: PendulumState, p: PendulumParams): [number, number] {
  const x1 = p.l1 * Math.sin(s[0]);
  const y1 = p.l1 * Math.cos(s[0]);
  return [x1 + p.l2 * Math.sin(s[2]), y1 + p.l2 * Math.cos(s[2])];
}

function drawTrail(
  g: CanvasRenderingContext2D,
  trail: number[][],
  pivotX: number,
  pivotY: number,
  scale: number,
  colorPrefix: string,
  alphaScale: number,
) {
  if (alphaScale <= 0 || trail.length < 2) return;
  for (let i = 1; i < trail.length; i += 1) {
    const a = trail[i - 1]!;
    const b = trail[i]!;
    const alpha = (i / trail.length) * 0.7 * alphaScale;
    g.strokeStyle = `${colorPrefix}${alpha.toFixed(3)})`;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(pivotX + a[0]! * scale, pivotY + a[1]! * scale);
    g.lineTo(pivotX + b[0]! * scale, pivotY + b[1]! * scale);
    g.stroke();
  }
}

function drawArms(
  g: CanvasRenderingContext2D,
  s: PendulumState,
  p: PendulumParams,
  pivotX: number,
  pivotY: number,
  scale: number,
  armColor: string,
  bobColor: string,
) {
  const x1 = pivotX + p.l1 * Math.sin(s[0]) * scale;
  const y1 = pivotY + p.l1 * Math.cos(s[0]) * scale;
  const x2 = x1 + p.l2 * Math.sin(s[2]) * scale;
  const y2 = y1 + p.l2 * Math.cos(s[2]) * scale;

  g.strokeStyle = armColor;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(pivotX, pivotY);
  g.lineTo(x1, y1);
  g.lineTo(x2, y2);
  g.stroke();

  g.fillStyle = bobColor;
  g.beginPath();
  g.arc(x1, y1, Math.max(3, Math.sqrt(p.m1) * 5), 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(x2, y2, Math.max(3, Math.sqrt(p.m2) * 5), 0, Math.PI * 2);
  g.fill();
}

export default function createPendulumPlugin(): Plugin {
  return new DoublePendulumPlugin();
}
