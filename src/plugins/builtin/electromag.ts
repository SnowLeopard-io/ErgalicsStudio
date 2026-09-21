// ==========================================================================
// Example plugin: Electromagnetism (电磁场 · 电荷与磁场)
//
// Interactive 2-D field lab. Drag charges anywhere on the canvas and release
// them to let them move under the Coulomb force from every other charge plus
// the Lorentz force of a uniform magnetic field (set independently of the
// charges). Positive charges are red, negative blue; mass scales with |q|.
//
// Pure CPU — a handful of point charges integrated with sub-stepped
// semi-implicit Euler and light air damping.
// ==========================================================================

import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
} from '@/types/plugin';
import { emit } from '@/core/events';
import { actionButton, exportCanvasPng, notify } from './shared/enhance';

export { electromagManifest } from './electromagManifest';
import { electromagManifest } from './electromagManifest';

interface Charge {
  x: number;
  y: number;
  vx: number;
  vy: number;
  q: number; // signed charge (arbitrary units)
}

interface State {
  B: number; // uniform magnetic field along z (signed: + = out of screen)
  damping: number; // air resistance per step
  speed: number; // sim speed multiplier
  newSign: number; // sign of charge created on click
  showTrails: boolean;
  showField: boolean; // draw B-field direction arrows
  running: boolean;
}

const K = 4.0e6; // Coulomb constant (tuned for pixel-scale visualization)
const MIN_R = 18; // softening radius to avoid singular forces
const MAX_V = 2400; // velocity clamp: keeps close encounters from exploding
const TRAIL = 90;

export class ElectromagPlugin implements Plugin {
  readonly manifest = electromagManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private state: State = {
    // A non-zero default so the B-field arrows are visible the moment the lab
    // opens — with B = 0 drawField() short-circuits and the scene looked like
    // the field "hadn't loaded" until the slider was touched.
    B: 1.5,
    damping: 0.02,
    speed: 1,
    newSign: 1,
    showTrails: true,
    showField: true,
    // The lab opens paused: place the charges, then press ▶ 运行. Any parameter
    // change re-arms the run from the initial configuration.
    running: false,
  };
  private charges: Charge[] = [];
  /** Configuration the lab re-arms to on a parameter change. */
  private initial: Charge[] = [];
  private trails: number[][][] = []; // parallel to charges
  private rafId = 0;
  private lastFrame = 0;
  private acc = 0;
  private dragIndex = -1;
  private dragLast: { x: number; y: number; t: number } | null = null;
  /**
   * Smoothed pointer velocity during a drag. Sampled between consecutive
   * move events — reading it only at pointerup was always zero, because the
   * final move event and pointerup share the same position.
   */
  private dragVelX: number | null = null;
  private dragVelY: number | null = null;
  /** Pointer-gesture bookkeeping: does this gesture redefine the setup? */
  private dragNew = false;
  private dragStart = { x: 0, y: 0 };
  private bound = false;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.stop();
    if (this.canvas && this.bound) {
      this.canvas.removeEventListener('pointerdown', this.onDown);
      this.canvas.removeEventListener('pointermove', this.onMove);
      this.canvas.removeEventListener('pointerup', this.onUp);
      this.canvas.removeEventListener('pointerleave', this.onUp);
      this.bound = false;
    }
    this.canvas = null;
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.canvas = context.container.canvas2d ?? null;
    this.bindCanvas();
    // Data-driven: the lab never fabricates an "atom" of its own. Opening it
    // stages an empty bench — charges arrive from a dropped config, from
    // 示例数据, or from the user clicking them in. It opens *paused* on top of
    // that: even a loaded scene runs only from ▶ 运行.
    this.draw();
  }

  async deactivate() {
    this.stop();
  }

  async render(container: ContainerCapabilities) {
    this.ctx = container;
    this.canvas = container.canvas2d ?? null;
    this.bindCanvas();
    // render() is also re-invoked on every viewport pan/zoom, so it must never
    // start a paused sim — only keep an already-live loop alive. It must
    // equally never fabricate a scene.
    this.draw();
    if (this.state.running) this.start();
  }

  /** Commit the live charges as the configuration the sim re-arms to. */
  private snapshotInitial() {
    // Release velocities are preserved: a "throw" is an initial condition the
    // user wants the next ▶ 运行 to replay.
    this.initial = this.charges.map((c) => ({ ...c }));
  }

  /**
   * Re-arm the experiment: restore the initial charges, clear the trails, drop
   * the run loop and leave the scene paused so the user starts a clean run
   * with ▶ 运行. Used after any parameter change.
   */
  private resetToInitial() {
    this.charges = this.initial.map((c) => ({ ...c }));
    this.trails = this.charges.map(() => []);
    this.dragIndex = -1;
    this.dragLast = null;
    this.dragVelX = null;
    this.dragVelY = null;
    this.stop();
    this.draw();
  }

  private refreshParams() {
    emit('host:params:changed', { pluginId: this.manifest.id });
  }

  private bindCanvas() {
    const canvas = this.canvas;
    if (!canvas || this.bound) return;
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onUp);
    canvas.addEventListener('pointerleave', this.onUp);
    this.bound = true;
  }

  private toLocal(e: PointerEvent): { x: number; y: number } {
    const canvas = this.canvas!;
    const r = canvas.getBoundingClientRect();
    const sx = canvas.width / Math.max(1, r.width);
    const sy = canvas.height / Math.max(1, r.height);
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
  }

  private onDown = (e: PointerEvent) => {
    const { x, y } = this.toLocal(e);
    let hit = -1;
    for (let i = 0; i < this.charges.length; i += 1) {
      const c = this.charges[i]!;
      const rad = this.radius(c.q);
      if ((c.x - x) ** 2 + (c.y - y) ** 2 <= rad * rad) {
        hit = i;
        break;
      }
    }
    const created = hit < 0;
    if (created) {
      // Empty space → create a new charge of the chosen sign and grab it.
      const c: Charge = { x, y, vx: 0, vy: 0, q: this.state.newSign };
      this.charges.push(c);
      this.trails.push([]);
      hit = this.charges.length - 1;
    }
    this.dragIndex = hit;
    this.dragNew = created;
    this.dragLast = { x, y, t: performance.now() };
    this.dragVelX = null;
    this.dragVelY = null;
    const c = this.charges[hit]!;
    c.vx = 0;
    c.vy = 0;
    this.dragStart = { x: c.x, y: c.y };
    // Arranging charges pauses the run — press ▶ 运行 to launch the scene.
    this.stop();
    this.canvas?.setPointerCapture?.(e.pointerId);
  };

  private onMove = (e: PointerEvent) => {
    if (this.dragIndex < 0) return;
    const { x, y } = this.toLocal(e);
    const c = this.charges[this.dragIndex]!;
    // Estimate instantaneous velocity from the previous move sample and fold
    // it into an EMA, so a fast flick still registers even though pointerup
    // lands on the same coordinates as the last move event.
    const now = performance.now();
    const last = this.dragLast;
    if (last) {
      const dt = Math.max(1, now - last.t) / 1000;
      const ivx = (x - last.x) / dt;
      const ivy = (y - last.y) / dt;
      this.dragVelX = this.dragVelX === null ? ivx : this.dragVelX * 0.45 + ivx * 0.55;
      this.dragVelY = this.dragVelY === null ? ivy : this.dragVelY * 0.45 + ivy * 0.55;
    }
    c.x = x;
    c.y = y;
    this.dragLast = { x, y, t: now };
    this.draw();
  };

  private onUp = (e: PointerEvent) => {
    if (this.dragIndex < 0) return;
    const c = this.charges[this.dragIndex]!;
    // Release velocity from the smoothed drag motion (a "throw").
    if (this.dragVelX !== null && this.dragVelY !== null) {
      c.vx = Math.max(-600, Math.min(600, this.dragVelX * 0.35));
      c.vy = Math.max(-600, Math.min(600, this.dragVelY * 0.35));
    }
    const moved =
      this.dragNew || Math.hypot(c.x - this.dragStart.x, c.y - this.dragStart.y) > 4;
    this.dragIndex = -1;
    this.dragLast = null;
    this.dragVelX = null;
    this.dragVelY = null;
    this.dragNew = false;
    // A real edit redefines the initial configuration the run starts from; a
    // bare click (pause / pick) leaves it untouched.
    if (moved) this.snapshotInitial();
    this.canvas?.releasePointerCapture?.(e.pointerId);
    this.draw();
  };

  updateParams(params: Record<string, unknown>) {
    const s = this.state;

    // ▶ 运行 / ❚❚ 暂停 never invalidates the scene — it only starts or stops
    // the integrator, and can be toggled any number of times.
    if (typeof params.run === 'boolean') {
      if (params.run) this.start();
      else this.stop();
      return;
    }

    const clear = params.clear as { action?: string } | undefined;
    if (clear?.action === 'clear') {
      this.charges = [];
      this.trails = [];
      this.snapshotInitial();
      this.resetToInitial();
      return;
    }

    // Buttons accept both the host's `{ key: { action } }` emission and a
    // plain `{ key: true }` call.
    const fired = (key: string): boolean => {
      const v = params[key];
      return v === true || (typeof v === 'object' && v !== null && (v as { action?: string }).action === key);
    };
    if (fired('exportPng')) {
      // Snapshot only — never starts or stops the simulation.
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'electromag');
      return;
    }
    if (fired('resetCharges')) {
      // Distinct from the danger "clear": restore the loaded / arranged
      // initial charge layout instead of emptying the bench.
      if (this.initial.length === 0) {
        notify(this.api, 'warning', 'No initial charge layout to restore.', '尚无初始电荷布局可恢复。');
        return;
      }
      this.resetToInitial();
      return;
    }

    // ---- Plain parameters -------------------------------------------------
    // Changing the physics re-arms the lab: the charges snap back to their
    // initial configuration and stay paused until ▶ 运行 is pressed again.
    // Display-only toggles just repaint, and `newSign` only affects charges
    // created later, so neither throws away the current run.
    let rearm = false;
    if (typeof params.B === 'number') {
      s.B = params.B;
      rearm = true;
    }
    if (typeof params.damping === 'number') {
      s.damping = Math.max(0, Math.min(0.5, params.damping));
      rearm = true;
    }
    if (typeof params.speed === 'number') {
      s.speed = Math.max(0.1, Math.min(3, params.speed));
      rearm = true;
    }
    // The select control hands back a string ("1" / "-1"), not a number.
    const sign = Number(params.newSign);
    if (params.newSign !== undefined && (sign === 1 || sign === -1)) s.newSign = sign;
    if (typeof params.showTrails === 'boolean') s.showTrails = params.showTrails;
    if (typeof params.showField === 'boolean') s.showField = params.showField;

    if (rearm) {
      this.resetToInitial();
      return;
    }
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'B',
        label: 'Magnetic field B',
        labelI18n: { 'zh-CN': '磁场 B（垂直屏幕）', 'en-US': 'Magnetic field B' },
        type: 'range',
        min: -4,
        max: 4,
        step: 0.1,
        value: this.state.B,
      },
      {
        key: 'newSign',
        label: 'New charge',
        labelI18n: { 'zh-CN': '新电荷符号', 'en-US': 'New charge' },
        type: 'select',
        options: [
          { value: '1', label: '+ positive', labelI18n: { 'zh-CN': '正电荷 (+)', 'en-US': '+ positive' } },
          { value: '-1', label: '− negative', labelI18n: { 'zh-CN': '负电荷 (−)', 'en-US': '− negative' } },
        ],
        value: String(this.state.newSign),
      },
      {
        key: 'damping',
        label: 'Air damping',
        labelI18n: { 'zh-CN': '空气阻尼', 'en-US': 'Air damping' },
        type: 'range',
        min: 0,
        max: 0.5,
        step: 0.01,
        value: this.state.damping,
      },
      {
        key: 'speed',
        label: 'Speed',
        labelI18n: { 'zh-CN': '速度倍率', 'en-US': 'Speed' },
        type: 'range',
        min: 0.1,
        max: 3,
        step: 0.1,
        value: this.state.speed,
      },
      {
        key: 'showField',
        label: 'B-field arrows',
        labelI18n: { 'zh-CN': '磁场方向箭头', 'en-US': 'B-field arrows' },
        type: 'checkbox',
        value: this.state.showField,
      },
      {
        key: 'showTrails',
        label: 'Trails',
        labelI18n: { 'zh-CN': '运动轨迹', 'en-US': 'Trails' },
        type: 'checkbox',
        value: this.state.showTrails,
      },
      {
        key: 'run',
        label: 'Run',
        type: 'toggle',
        value: this.state.running,
        offLabelI18n: { 'zh-CN': '▶ 运行', 'en-US': '▶ Run' },
        onLabelI18n: { 'zh-CN': '❚❚ 暂停', 'en-US': '❚❚ Pause' },
        hint:
          this.api?.locale === 'zh-CN'
            ? '调整磁场 / 阻尼 / 速度后会自动归位并暂停，需再次点击「运行」开始'
            : 'Changing B, damping or speed re-arms and pauses the run — press ▶ again',
      },
      {
        key: 'clear',
        label: 'Clear all',
        labelI18n: { 'zh-CN': '清空电荷', 'en-US': 'Clear all' },
        type: 'button',
        variant: 'danger',
        action: 'clear',
      },
      actionButton('resetCharges', 'Reset Charges', '重置电荷'),
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
    ];
  }

  async loadData(file: File) {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '无法解析 JSON 文件' : 'Could not parse JSON file');
      return;
    }
    const obj = parsed as Record<string, unknown>;
    const list = obj.charges;
    if (!Array.isArray(list) || list.length === 0) {
      this.api.notify('warning', this.api.locale === 'zh-CN' ? '需要 charges 数组' : 'Expected a "charges" array');
      return;
    }
    const canvas = this.ctx?.canvas2d;
    const w = canvas?.clientWidth || 600;
    const h = canvas?.clientHeight || 400;
    const loaded: Charge[] = [];
    for (const item of list) {
      const o = item as Record<string, unknown>;
      const nx = Number(o.x);
      const ny = Number(o.y);
      const q = Number(o.q);
      if (![nx, ny, q].every(Number.isFinite)) continue;
      loaded.push({
        x: nx * w,
        y: ny * h,
        vx: Number(o.vx) || 0,
        vy: Number(o.vy) || 0,
        q,
      });
    }
    if (loaded.length === 0) return;
    this.charges = loaded;
    this.trails = loaded.map(() => []);
    if (typeof obj.B === 'number') this.state.B = obj.B;
    if (typeof obj.damping === 'number') this.state.damping = Math.max(0, Math.min(0.5, obj.damping));
    this.snapshotInitial();
    // A loaded scene arrives paused — press ▶ 运行 to start the experiment.
    this.stop();
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  private radius(q: number): number {
    return 7 + Math.min(16, Math.abs(q) * 6);
  }

  private start() {
    if (this.charges.length === 0) {
      // Data-driven: the lab never fabricates charges, so there is nothing to
      // simulate until a config is loaded or charges are placed by hand.
      this.api.notify(
        'warning',
        this.api.locale === 'zh-CN'
          ? '尚未放置电荷 — 拖入 JSON 配置、打开「示例数据」，或在画布上点击放置'
          : 'No charges yet — drop a JSON config, open sample data, or click the canvas to place one',
      );
      return;
    }
    // Guard on the *loop*, not on `running`: gating on `running` made the very
    // first ▶ 运行 after a pause a no-op (stop() had just cleared the flag), so
    // the sim could never be resumed.
    if (this.rafId !== 0) {
      this.state.running = true;
      return;
    }
    this.state.running = true;
    this.lastFrame = performance.now();
    this.acc = 0;
    this.api.setStatus('computing');
    this.rafId = requestAnimationFrame(this.tick);
    this.refreshParams();
  }

  private stop() {
    const was = this.state.running;
    this.state.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.api.setStatus('ready');
    if (was) this.refreshParams();
  }

  private tick = (now: number) => {
    if (!this.state.running) {
      this.rafId = 0;
      return;
    }
    const dtReal = Math.min((now - this.lastFrame) / 1000, 0.05) * this.state.speed;
    this.lastFrame = now;
    this.acc += dtReal;
    const dt = 1 / 240;
    let steps = 0;
    while (this.acc >= dt && steps < 240) {
      this.step(dt);
      this.acc -= dt;
      steps += 1;
    }
    this.draw();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private step(dt: number) {
    const n = this.charges.length;
    const fx = new Array(n).fill(0);
    const fy = new Array(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      const a = this.charges[i]!;
      for (let j = 0; j < n; j += 1) {
        if (i === j) continue;
        const b = this.charges[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let r2 = dx * dx + dy * dy;
        if (r2 < MIN_R * MIN_R) {
          // softened: push apart slightly to avoid singular attraction
          const r = Math.sqrt(r2) || 0.001;
          dx /= r;
          dy /= r;
          r2 = MIN_R * MIN_R;
        }
        const r = Math.sqrt(r2);
        const inv = 1 / (r2 * r);
        const fmag = K * a.q * b.q * inv;
        fx[i]! += fmag * dx;
        fy[i]! += fmag * dy;
      }
      // Lorentz force: F = q * v × B, with B along z (out of screen).
      fx[i]! += a.q * a.vy * this.state.B;
      fy[i]! += -a.q * a.vx * this.state.B;
      // Air damping.
      fx[i]! -= this.state.damping * a.vx;
      fy[i]! -= this.state.damping * a.vy;
    }
    for (let i = 0; i < n; i += 1) {
      if (i === this.dragIndex) continue; // held charge does not integrate
      const c = this.charges[i]!;
      const m = Math.max(0.3, Math.abs(c.q));
      c.vx += (fx[i]! / m) * dt;
      c.vy += (fy[i]! / m) * dt;
      // Cap speed: a close encounter with the (large) Coulomb constant can
      // otherwise fling two charges at a velocity the explicit integrator
      // cannot resolve, producing an energy blow-up.
      const sp = Math.hypot(c.vx, c.vy);
      if (sp > MAX_V) {
        const k = MAX_V / sp;
        c.vx *= k;
        c.vy *= k;
      }
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      // Soft walls.
      const rad = this.radius(c.q);
      const w = this.canvas?.width || 600;
      const h = this.canvas?.height || 400;
      if (c.x < rad) {
        c.x = rad;
        c.vx = Math.abs(c.vx) * 0.6;
      } else if (c.x > w - rad) {
        c.x = w - rad;
        c.vx = -Math.abs(c.vx) * 0.6;
      }
      if (c.y < rad) {
        c.y = rad;
        c.vy = Math.abs(c.vy) * 0.6;
      } else if (c.y > h - rad) {
        c.y = h - rad;
        c.vy = -Math.abs(c.vy) * 0.6;
      }
      if (this.state.showTrails) {
        const tr = this.trails[i]!;
        tr.push([c.x, c.y]);
        if (tr.length > TRAIL) tr.shift();
      }
    }
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const w = (canvas.width = canvas.clientWidth || 600);
    const h = (canvas.height = canvas.clientHeight || 400);
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, w, h);

    if (this.state.showField && Math.abs(this.state.B) > 0.001) {
      this.drawField(g, w, h);
    }

    if (this.charges.length === 0) {
      // Empty state: no charges loaded or placed — never render a fabricated
      // scene. The B-field arrows stay up so the lab still reads as live.
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = `${this.api.locale === 'zh-CN' ? '12px "Microsoft YaHei"' : '12px Consolas'}, monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(
        this.api.locale === 'zh-CN'
          ? '未加载数据 — 拖入 JSON 电荷配置或打开「示例数据」（也可在画布上点击放置电荷）'
          : 'No data — drop a JSON charge config or open sample data (or click the canvas to place a charge)',
        w / 2,
        h / 2,
      );
      return;
    }

    for (let i = 0; i < this.charges.length; i += 1) {
      const c = this.charges[i]!;
      const rad = this.radius(c.q);
      if (this.state.showTrails) {
        const tr = this.trails[i]!;
        for (let k = 1; k < tr.length; k += 1) {
          const a = tr[k - 1]!;
          const b = tr[k]!;
          g.strokeStyle = c.q >= 0 ? `rgba(248,113,113,${0.5 * (k / tr.length)})` : `rgba(96,165,250,${0.5 * (k / tr.length)})`;
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(a[0]!, a[1]!);
          g.lineTo(b[0]!, b[1]!);
          g.stroke();
        }
      }
      // Glow.
      const grad = g.createRadialGradient(c.x, c.y, rad * 0.2, c.x, c.y, rad * 1.8);
      grad.addColorStop(0, c.q >= 0 ? 'rgba(248,113,113,0.9)' : 'rgba(96,165,250,0.9)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(c.x, c.y, rad * 1.8, 0, Math.PI * 2);
      g.fill();
      // Core.
      g.fillStyle = c.q >= 0 ? '#f87171' : '#60a5fa';
      g.beginPath();
      g.arc(c.x, c.y, rad, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.font = 'bold 12px Consolas, monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(c.q >= 0 ? '+' : '−', c.x, c.y);
    }

    g.fillStyle = 'rgba(150,165,185,0.85)';
    g.font = `11px ${this.api.locale === 'zh-CN' ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    const hint =
      this.api.locale === 'zh-CN'
        ? '在空白处点击/拖动可创建并拖拽电荷；红色为 +，蓝色为 −'
        : 'Click/drag empty space to create & drag charges; red = +, blue = −';
    g.fillText(hint, 12, 18);
  }

  private drawField(g: CanvasRenderingContext2D, w: number, h: number) {
    const out = this.state.B > 0;
    g.strokeStyle = 'rgba(250,204,21,0.38)';
    g.fillStyle = 'rgba(250,204,21,0.38)';
    g.lineWidth = 1.2;
    const gap = 56;
    for (let y = gap; y < h; y += gap) {
      for (let x = gap; x < w; x += gap) {
        g.beginPath();
        g.arc(x, y, 4, 0, Math.PI * 2);
        g.stroke();
        // dot: filled when out of screen, ring when into screen
        if (out) {
          g.fillStyle = 'rgba(250,204,21,0.65)';
          g.beginPath();
          g.arc(x, y, 1.6, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(250,204,21,0.38)';
        }
      }
    }
  }
}

export default function createElectromagPlugin(): Plugin {
  return new ElectromagPlugin();
}
