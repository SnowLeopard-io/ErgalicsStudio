// ==========================================================================
// Example plugin: Structural Mechanics (结构力学 · 桁架承重与垮塌)
//
// A demonstration-only pin-jointed truss lab. The scene is authored — seeded
// below, or loaded from a JSON example — and there is no in-canvas editing.
// Press ▶ 运行 and the weights resting on the structure push its joints down;
// members act as axial springs and each one tracks its axial force against the
// material's strength. Brittle materials (wood, concrete) fail the instant they
// are overloaded; ductile ones (steel, aluminium) yield for a moment before
// snapping. Break enough members and the frame collapses onto the floor.
//
// Convention: ▶ 运行 starts the experiment; changing gravity, damping or the
// load mass re-arms it — the scene snaps back to its initial configuration and
// pauses, so every run starts from the same clean state and needs a fresh
// press of ▶ 运行.
//
// Size independence: the layout is normalized (0..1) but the load is a fixed
// force, so the *pixel* force in a member scales with span/depth ≈ W/H. Both
// the stiffness and the strength are therefore multiplied by `sizeFactor()`,
// which normalizes on a 1.6:1 canvas. Without it the same truss is fine in a
// square viewport and snaps apart in a wide one.
//
// Pure CPU. Springs are integrated with semi-implicit Euler sub-stepped at a
// fixed 1/240 s so the stiffest member in the scene stays stable.
// ==========================================================================

import { emit } from '@/core/events';
import { actionButton, exportCanvasPng, exportRowsCsv, notify } from './shared/enhance';
import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
} from '@/types/plugin';

export { structureManifest } from './structureManifest';
import { structureManifest } from './structureManifest';

// ---- Materials -----------------------------------------------------------

type MaterialId = 'steel' | 'aluminum' | 'wood' | 'concrete' | 'rope';

interface Material {
  id: MaterialId;
  /** Axial stiffness scale (force per pixel of extension). */
  E: number;
  /** Force at which the member fails. */
  strength: number;
  /** Fails the instant it is overloaded instead of yielding first. */
  brittle: boolean;
  /** Cannot push — slack under compression. */
  tensionOnly: boolean;
  color: string;
  width: number;
}

const MATERIALS: Record<MaterialId, Material> = {
  steel: {
    id: 'steel',
    E: 900,
    strength: 3000,
    brittle: false,
    tensionOnly: false,
    color: '#9fb3c8',
    width: 5,
  },
  aluminum: {
    id: 'aluminum',
    E: 550,
    strength: 1900,
    brittle: false,
    tensionOnly: false,
    color: '#d3dceb',
    width: 5,
  },
  wood: {
    id: 'wood',
    E: 300,
    strength: 1150,
    brittle: true,
    tensionOnly: false,
    color: '#c08552',
    width: 6,
  },
  concrete: {
    id: 'concrete',
    E: 650,
    strength: 950,
    brittle: true,
    tensionOnly: false,
    color: '#a8a29e',
    width: 7,
  },
  rope: {
    id: 'rope',
    E: 220,
    strength: 1700,
    brittle: false,
    tensionOnly: true,
    color: '#eab308',
    width: 3,
  },
};

function material(id: unknown): Material {
  const key = (typeof id === 'string' ? id : 'steel') as MaterialId;
  return MATERIALS[key] ?? MATERIALS.steel;
}

// ---- Model ---------------------------------------------------------------

interface Joint {
  x: number;
  y: number;
  vx: number;
  vy: number;
  m: number;
  fixed: boolean;
}

interface Member {
  a: number;
  b: number;
  /** Free (rest) length — differs from the geometric length when pre-tensioned. */
  L0: number;
  /** Stiffness multiplier over the material's E. */
  kMul: number;
  mat: MaterialId;
  /** Last computed axial force (+ tension, − compression). */
  force: number;
  /** Seconds spent above the yield limit; ductile members snap after a while. */
  overload: number;
  broken: boolean;
}

interface Weight {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  m: number;
}

interface State {
  gravity: number;
  damping: number;
  /** Mass of a weight spawned by the 释放重物 button / applied to every weight. */
  weightMass: number;
  showForces: boolean;
  running: boolean;
  /**
   * True once a structure config has been loaded. The plugin never fabricates
   * a default truss — without data it stages an empty canvas and refuses to
   * run, so the scene always comes from the user's file or a sample.
   */
  hasData: boolean;
}

const FLOOR_PAD = 26;
const ZETA = 0.12; // axial damping ratio
const SUB_DT = 1 / 240;
/** Joint self-mass; the deck nodes are the only structural mass. */
const JOINT_MASS = 0.5;
/** Canvas aspect the material constants are tuned against. */
const REF_ASPECT = 1.6;

export class StructurePlugin implements Plugin {
  readonly manifest = structureManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private state: State = {
    gravity: 320,
    damping: 1.8,
    weightMass: 2,
    showForces: true,
    running: false,
    hasData: false,
  };
  private joints: Joint[] = [];
  private members: Member[] = [];
  private weights: Weight[] = [];
  /**
   * The *authored* configuration the sim re-arms to: joints, members and loads
   * exactly as seeded or loaded, never as deformed by a run. Captured only when
   * the scene is (re)defined — see `snapshotInitial()`. A load-mass change
   * updates the masses stored here; nothing else may mutate it.
   */
  private initial: { joints: Joint[]; members: Member[]; weights: Weight[] } = {
    joints: [],
    members: [],
    weights: [],
  };
  /**
   * Loads dropped at runtime with 增加重物, remembered at their authored
   * placement. They belong to the *live* scene only, never to `initial`: a
   * parameter change re-arms with them still standing, while 重置 clears them
   * and returns to the pristine authored scene.
   */
  private extraWeights: Array<{ x: number; y: number; m: number }> = [];
  private rafId = 0;
  private lastFrame = 0;
  private acc = 0;
  private lastW = 0;
  private lastH = 0;
  private failed = false;

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.stop();
    this.canvas = null;
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.canvas = context.container.canvas2d ?? null;
    // Data-driven: the plugin never fabricates a truss of its own. Opening it
    // stages an empty bench with a "load data" hint — the scene appears only
    // once a config has been dropped in or opened from 示例数据. Opening
    // *paused* is a separate convention: even with data staged, the run starts
    // only from ▶ 运行.
    this.report();
    this.draw();
  }

  async deactivate() {
    this.stop();
  }

  async render(container: ContainerCapabilities) {
    this.ctx = container;
    this.canvas = container.canvas2d ?? null;
    this.report();
    // render() is re-invoked on every viewport pan/zoom, so it must never
    // start a paused sim — it only keeps an already-live loop alive across a
    // container remount. It must equally never fabricate a scene.
    this.draw();
    if (this.state.running) this.start();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- Scene setup -------------------------------------------------------

  /**
   * Commit the authored scene as the configuration the sim re-arms to. Call it
   * only when the scene is *defined* (load) — never after a run has deformed
   * it, and never after 增加重物, or the baseline would absorb the runtime loads
   * and 重置 could no longer clear them.
   */
  private snapshotInitial() {
    this.initial = {
      joints: this.joints.map((j) => ({ ...j, vx: 0, vy: 0 })),
      members: this.members.map((m) => ({ ...m, force: 0, overload: 0, broken: false })),
      weights: this.weights.map((w) => ({ ...w, vx: 0, vy: 0 })),
    };
  }

  /**
   * Re-arm the experiment: restore the authored configuration, drop the run
   * loop and leave the scene paused so the user starts a clean run with ▶ 运行.
   * `keepExtras` decides what happens to loads added at runtime — a parameter
   * change re-arms with the deck still loaded, while 重置 clears them and
   * returns to the pristine authored scene.
   */
  private rearm(keepExtras: boolean) {
    const snap = this.initial;
    this.joints = snap.joints.map((j) => ({ ...j }));
    this.members = snap.members.map((m) => ({ ...m }));
    this.weights = snap.weights.map((w) => ({ ...w }));
    if (keepExtras) {
      for (const e of this.extraWeights) this.weights.push(this.makeWeight(e.x, e.y, e.m));
    } else {
      this.extraWeights = [];
    }
    this.settleWeights();
    this.failed = false;
    this.stop();
    this.report();
    this.refreshParams();
    this.draw();
  }

  private makeWeight(x: number, y: number, m: number): Weight {
    return { x, y, vx: 0, vy: 0, r: 8 + 3 * Math.sqrt(m), m };
  }

  /**
   * Rest every weight on the member directly beneath it instead of letting it
   * fall. A dropped load lands with a few hundred px/s of speed; the penalty
   * contact would either tunnel straight through the deck or shock the truss
   * into a long ring that spikes the axial forces. Loading the structure
   * statically is both stable and what a bridge demo actually shows.
   */
  private settleWeights() {
    for (const w of this.weights) {
      let restY = Number.POSITIVE_INFINITY;
      for (const mem of this.members) {
        if (mem.broken) continue;
        const A = this.joints[mem.a];
        const B = this.joints[mem.b];
        if (!A || !B) continue;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const L2 = dx * dx + dy * dy;
        if (L2 < 1e-9) continue;
        let t = ((w.x - A.x) * dx + (w.y - A.y) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const py = A.y + dy * t;
        // Only members below the weight can carry it.
        if (py <= w.y) continue;
        const rr = w.r + MATERIALS[mem.mat].width * 0.5;
        restY = Math.min(restY, py - rr - 1);
      }
      if (Number.isFinite(restY)) w.y = restY;
      w.vx = 0;
      w.vy = 0;
    }
  }

  /** Axial stiffness of a member, normalized for the current canvas. */
  private stiffness(mem: Member, s: number): number {
    return MATERIALS[mem.mat].E * mem.kMul * s;
  }

  /** Failure load of a member, normalized for the current canvas. */
  private capacity(mem: Member, s: number): number {
    return MATERIALS[mem.mat].strength * s;
  }

  /**
   * Canvas normalization. The pixel force carried by a member is proportional
   * to span/depth, i.e. to the canvas aspect ratio, while the load (mass ×
   * gravity) is a fixed number. Scaling stiffness and strength by the same
   * factor makes the lab behave identically in a square and an ultrawide
   * viewport.
   */
  private sizeFactor(): number {
    const aspect = this.w() / Math.max(1, this.h());
    return clamp(aspect / REF_ASPECT, 0.5, 3);
  }

  // ---- Parameter plumbing ------------------------------------------------

  updateParams(params: Record<string, unknown>) {
    const s = this.state;

    // ▶ 运行 / ❚❚ 暂停 is the one control that never invalidates the scene — it
    // only starts or stops the integrator, and can be toggled any number of
    // times.
    if (typeof params.run === 'boolean') {
      if (params.run) this.start();
      else this.stop();
      return;
    }

    const act = (key: string) => (params[key] as { action?: string } | undefined)?.action;
    // Buttons also accept a plain `{ key: true }` call. Exports never touch
    // the running state — they neither re-arm nor pause the experiment.
    const fired = (key: string) => params[key] === true || act(key) === key;

    if (fired('exportPng')) {
      exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'structure');
      return;
    }
    if (fired('exportCsv')) {
      this.exportMembersCsv();
      return;
    }

    // 重置 — back to the pristine authored scene: the frame re-forms and any
    // weights added at runtime are cleared, then the lab waits for ▶ 运行.
    if (act('reset') === 'reset') {
      if (!s.hasData) {
        this.warnNoData();
        return;
      }
      this.rearm(false);
      return;
    }

    // 增加重物 — rest another weight on the deck at the emptiest panel and
    // carry on running, so the extra sag (or the collapse) is immediate.
    if (act('drop') === 'drop') {
      if (!s.hasData) {
        this.warnNoData();
        return;
      }
      const spots = [0.35, 0.65, 0.5, 0.2, 0.8];
      let bestX = this.w() * 0.5;
      let bestGap = -1;
      for (const u of spots) {
        const x = u * this.w();
        let gap = Number.POSITIVE_INFINITY;
        for (const w of this.weights) gap = Math.min(gap, Math.abs(w.x - x));
        if (!Number.isFinite(gap)) gap = Number.MAX_VALUE;
        if (gap > bestGap) {
          bestGap = gap;
          bestX = x;
        }
      }
      const wt = this.makeWeight(bestX, this.h() * 0.5, s.weightMass);
      this.weights.push(wt);
      // Remember the load so a later parameter change re-arms with it, but do
      // *not* fold it into `initial`: 重置 must still be able to clear it.
      this.extraWeights.push({ x: wt.x, y: wt.y, m: wt.m });
      this.settleWeights();
      this.report();
      this.start();
      this.draw();
      return;
    }

    // ---- Parameters -------------------------------------------------------
    // Any change below re-arms the lab: the scene snaps back to its initial
    // configuration and stays paused until ▶ 运行 is pressed again.
    let rearm = false;
    if (typeof params.gravity === 'number') {
      s.gravity = clamp(params.gravity, 0, 1600);
      rearm = true;
    }
    if (typeof params.damping === 'number') {
      s.damping = clamp(params.damping, 0, 4);
      rearm = true;
    }
    if (typeof params.weightMass === 'number') {
      const m = clamp(params.weightMass, 0.2, 10);
      s.weightMass = m;
      // The load-mass slider rescales every weight, authored and added alike.
      // Update the authored baseline (and the remembered extras) so both the
      // re-arm below and a later 重置 pick up the new mass; rearm() re-seats
      // the larger spheres on the deck.
      for (const wt of this.initial.weights) {
        wt.m = m;
        wt.r = 8 + 3 * Math.sqrt(m);
      }
      for (const e of this.extraWeights) e.m = m;
      rearm = true;
    }
    if (typeof params.showForces === 'boolean') s.showForces = params.showForces;

    if (rearm) {
      // A parameter change re-arms with the runtime loads still standing.
      this.rearm(true);
      return;
    }
    this.draw();
  }

  getParams(): ParamDefinition[] {
    const s = this.state;
    const zh = this.api?.locale === 'zh-CN';
    return [
      {
        key: 'run',
        label: 'Run',
        type: 'toggle',
        value: s.running,
        offLabelI18n: { 'zh-CN': '▶ 运行', 'en-US': '▶ Run' },
        onLabelI18n: { 'zh-CN': '❚❚ 暂停', 'en-US': '❚❚ Pause' },
        hint: zh
          ? '调整重力 / 阻尼 / 负载质量后会自动归位并暂停，需再次点击「运行」开始'
          : 'Changing gravity, damping or the load mass re-arms and pauses the run — press ▶ again',
      },
      {
        key: 'drop',
        label: 'Add a weight',
        labelI18n: { 'zh-CN': '增加重物', 'en-US': 'Add a weight' },
        type: 'button',
        variant: 'primary',
        action: 'drop',
        hint: zh
          ? '在桥面空位静置一个重物，结构随即下沉；继续加即可压垮'
          : 'Rest another weight on the deck — the truss sags at once; keep adding to break it',
      },
      {
        key: 'gravity',
        label: 'Gravity',
        labelI18n: { 'zh-CN': '重力加速度', 'en-US': 'Gravity' },
        type: 'range',
        min: 0,
        max: 1600,
        step: 20,
        value: s.gravity,
        hint: zh ? '默认 320 能承住；调到 1000 以上即可看到垮塌' : 'Holds at 320 — push past ~1000 to break it',
      },
      {
        key: 'damping',
        label: 'Damping',
        labelI18n: { 'zh-CN': '阻尼', 'en-US': 'Damping' },
        type: 'range',
        min: 0,
        max: 4,
        step: 0.1,
        value: s.damping,
      },
      {
        key: 'weightMass',
        label: 'Load mass',
        labelI18n: { 'zh-CN': '负载质量（所有重物）', 'en-US': 'Load mass (all weights)' },
        type: 'range',
        min: 0.2,
        max: 10,
        step: 0.2,
        value: s.weightMass,
      },
      {
        key: 'showForces',
        label: 'Show axial forces',
        labelI18n: { 'zh-CN': '显示轴力 / 应力', 'en-US': 'Show axial forces' },
        type: 'checkbox',
        value: s.showForces,
      },
      {
        key: 'reset',
        label: 'Reset',
        labelI18n: { 'zh-CN': '重置', 'en-US': 'Reset' },
        type: 'button',
        action: 'reset',
        hint: zh
          ? '清空后加的重物，结构恢复为初始 / 加载时的构型，并暂停'
          : 'Clears the weights added at runtime and restores the initial (or loaded) configuration, paused',
      },
      actionButton('exportPng', 'Snapshot PNG', '快照 PNG'),
      actionButton('exportCsv', 'Export Members CSV', '导出构件 CSV'),
    ];
  }

  /** Export the member table (id, end joints, current length, axial force).
   *  Broken members are included so the CSV reflects the live structure. */
  private exportMembersCsv() {
    if (!this.state.hasData || this.members.length === 0) {
      notify(this.api, 'warning', 'No structure to export yet.', '暂无可导出的结构数据。');
      return;
    }
    const rows: number[][] = this.members.map((m, i) => {
      const A = this.joints[m.a];
      const B = this.joints[m.b];
      const length = A && B ? Math.hypot(B.x - A.x, B.y - A.y) : m.L0;
      return [i + 1, m.a, m.b, length, m.force];
    });
    exportRowsCsv(this.api, 'structure-members', ['id', 'nodeA', 'nodeB', 'length', 'force'], rows);
  }

  private refreshParams() {
    emit('host:params:changed', { pluginId: this.manifest.id });
  }

  // ---- Data loading ------------------------------------------------------

  async loadData(file: File) {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      this.api.notify('warning', this.zh() ? '无法解析 JSON 文件' : 'Could not parse JSON file');
      return;
    }
    const obj = parsed as Record<string, unknown>;
    const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : null;
    const rawMembers = Array.isArray(obj.members) ? obj.members : null;
    if (!rawNodes || !rawMembers) {
      this.api.notify(
        'warning',
        this.zh() ? '需要 nodes 与 members 数组' : 'Expected "nodes" and "members" arrays',
      );
      return;
    }
    const w = this.w();
    const h = this.h();
    const joints: Joint[] = [];
    for (const item of rawNodes) {
      const o = item as Record<string, unknown>;
      const x = Number(o.x);
      const y = Number(o.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        joints.push({ x: 0, y: 0, vx: 0, vy: 0, m: JOINT_MASS, fixed: false });
        continue;
      }
      joints.push({
        x: x * w,
        y: y * h,
        vx: 0,
        vy: 0,
        m: Number(o.m) > 0 ? Number(o.m) : JOINT_MASS,
        fixed: o.fixed === true,
      });
    }
    const members: Member[] = [];
    for (const item of rawMembers) {
      const o = item as Record<string, unknown>;
      const a = Number(o.a);
      const b = Number(o.b);
      if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
      const A = joints[a];
      const B = joints[b];
      if (!A || !B || a === b) continue;
      const mt = material(o.material);
      const kMul = Number.isFinite(Number(o.k)) ? clamp(Number(o.k), 0.2, 2) : 1;
      const L0 = Number.isFinite(Number(o.L0))
        ? Number(o.L0) * w
        : Math.hypot(B.x - A.x, B.y - A.y);
      members.push({
        a,
        b,
        L0,
        kMul,
        mat: mt.id,
        force: 0,
        overload: 0,
        broken: false,
      });
    }
    if (members.length === 0) return;
    const weights: Weight[] = [];
    if (Array.isArray(obj.weights)) {
      for (const item of obj.weights) {
        const o = item as Record<string, unknown>;
        const x = Number(o.x);
        const y = Number(o.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        const m = Number.isFinite(Number(o.m)) ? clamp(Number(o.m), 0.2, 10) : this.state.weightMass;
        weights.push(this.makeWeight(x * w, y * h, m));
      }
    }
    // Loading halts a run in progress: the new structure is staged paused and
    // waits for an explicit ▶ 运行, so the user sees the authored shape before
    // it deforms.
    if (this.state.running) this.stop();
    this.joints = joints;
    this.members = members;
    this.weights = weights;
    this.settleWeights();
    this.failed = false;
    if (Number.isFinite(Number(obj.gravity))) this.state.gravity = clamp(Number(obj.gravity), 0, 1600);
    if (Number.isFinite(Number(obj.damping))) this.state.damping = clamp(Number(obj.damping), 0, 4);
    this.state.hasData = true;
    this.extraWeights = [];
    this.snapshotInitial();
    this.report();
    this.refreshParams();
    this.draw();
  }

  // ---- Simulation --------------------------------------------------------

  private start() {
    if (!this.state.hasData || this.joints.length === 0) {
      // Data-driven: without a loaded structure there is nothing to simulate.
      this.warnNoData();
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
    const real = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.acc += real;
    let steps = 0;
    while (this.acc >= SUB_DT && steps < 16) {
      this.step(SUB_DT);
      this.acc -= SUB_DT;
      steps += 1;
    }
    if (steps === 16) this.acc = 0;
    this.draw();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private step(dt: number) {
    const n = this.joints.length;
    if (n === 0) return;
    const s = this.sizeFactor();
    const fx = new Array<number>(n).fill(0);
    const fy = new Array<number>(n).fill(0);
    const meff = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i += 1) meff[i] = this.joints[i]!.m;

    // A resting weight shares its inertia with the joints it bears on. Without
    // this the frame carries a heavy load through mass-less joints, which is
    // numerically stiff and rings apart the moment the load is raised.
    for (const w of this.weights) {
      for (const mem of this.members) {
        if (mem.broken) continue;
        const A = this.joints[mem.a];
        const B = this.joints[mem.b];
        if (!A || !B) continue;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const L2 = dx * dx + dy * dy;
        if (L2 < 1e-9) continue;
        let t = ((w.x - A.x) * dx + (w.y - A.y) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = A.x + dx * t;
        const py = A.y + dy * t;
        const rr = w.r + MATERIALS[mem.mat].width * 0.5;
        if ((w.x - px) ** 2 + (w.y - py) ** 2 >= rr * rr) continue;
        if (!A.fixed) meff[mem.a]! += (1 - t) * w.m;
        if (!B.fixed) meff[mem.b]! += t * w.m;
      }
    }

    // Self weight.
    for (let i = 0; i < n; i += 1) fy[i]! += this.state.gravity * this.joints[i]!.m;

    // Axial springs (with a light damping term so the truss settles).
    for (const mem of this.members) {
      if (mem.broken) continue;
      const A = this.joints[mem.a];
      const B = this.joints[mem.b];
      if (!A || !B) continue;
      let dx = B.x - A.x;
      let dy = B.y - A.y;
      let L = Math.hypot(dx, dy);
      if (L < 1e-6) {
        dx = 1e-6;
        dy = 0;
        L = 1e-6;
      }
      const nx = dx / L;
      const ny = dy / L;
      const mt = MATERIALS[mem.mat];
      const k = this.stiffness(mem, s);
      let f = k * (L - mem.L0);
      if (mt.tensionOnly && f <= 0) {
        f = 0;
      } else {
        const c = 2 * ZETA * Math.sqrt(k * Math.max(0.05, Math.min(meff[mem.a]!, meff[mem.b]!)));
        f += c * ((B.vx - A.vx) * nx + (B.vy - A.vy) * ny);
      }
      mem.force = f;
      const gx = f * nx;
      const gy = f * ny;
      fx[mem.a]! += gx;
      fy[mem.a]! += gy;
      fx[mem.b]! -= gx;
      fy[mem.b]! -= gy;
    }

    // Weights: gravity plus a contact spring against every member.
    for (const w of this.weights) {
      w.vy += this.state.gravity * dt;
      for (const mem of this.members) {
        if (mem.broken) continue;
        const A = this.joints[mem.a];
        const B = this.joints[mem.b];
        if (!A || !B) continue;
        const dx = B.x - A.x;
        const dy = B.y - A.y;
        const L2 = dx * dx + dy * dy;
        if (L2 < 1e-9) continue;
        let t = ((w.x - A.x) * dx + (w.y - A.y) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = A.x + dx * t;
        const py = A.y + dy * t;
        let ddx = w.x - px;
        let ddy = w.y - py;
        let d = Math.hypot(ddx, ddy);
        const rr = w.r + MATERIALS[mem.mat].width * 0.5;
        if (d >= rr) continue;
        if (d < 1e-6) {
          ddx = 0;
          ddy = -1;
          d = 1e-6;
        }
        const nx = ddx / d;
        const ny = ddy / d;
        const vpx = (1 - t) * A.vx + t * B.vx;
        const vpy = (1 - t) * A.vy + t * B.vy;
        const rvx = w.vx - vpx;
        const rvy = w.vy - vpy;
        const kc = 900 * w.m;
        // Cap the contact damping at what an explicit step can absorb on the
        // *lightest* joint the reaction can land on (~JOINT_MASS). Sizing it
        // from the weight instead makes c·dt/m exceed the stability limit for
        // a heavy load, and the contact then injects energy instead of
        // settling — the truss rings itself apart instead of collapsing.
        const mMin = Math.max(0.05, Math.min(A.m, B.m, w.m));
        const cc = Math.min(2 * 0.7 * Math.sqrt(kc * w.m), (1.6 * mMin) / dt);
        let Fn = kc * (rr - d) - cc * (rvx * nx + rvy * ny);
        if (Fn < 0) Fn = 0;
        const tx = -ny;
        const ty = nx;
        const vt = rvx * tx + rvy * ty;
        const Ft = clamp(-0.7 * Fn * Math.tanh(vt * 0.08), -0.75 * Fn, 0.75 * Fn);
        const Fx = Fn * nx + Ft * tx;
        const Fy = Fn * ny + Ft * ty;
        w.vx += (Fx / w.m) * dt;
        w.vy += (Fy / w.m) * dt;
        // Reaction splits between the two endpoints.
        fx[mem.a]! -= (1 - t) * Fx;
        fy[mem.a]! -= (1 - t) * Fy;
        fx[mem.b]! -= t * Fx;
        fy[mem.b]! -= t * Fy;
      }
    }

    // Integrate joints.
    for (let i = 0; i < n; i += 1) {
      const j = this.joints[i]!;
      if (j.fixed) {
        j.vx = 0;
        j.vy = 0;
        continue;
      }
      const m = Math.max(0.05, meff[i]!);
      j.vx += (fx[i]! / m) * dt;
      j.vy += (fy[i]! / m) * dt;
      const damp = Math.exp(-this.state.damping * dt);
      j.vx *= damp;
      j.vy *= damp;
      j.x += j.vx * dt;
      j.y += j.vy * dt;
      const floor = this.h() - FLOOR_PAD;
      if (j.y > floor) {
        // Inelastic stop: bouncing off the floor pumps energy back into a
        // stiff spring and the truss explodes numerically.
        j.y = floor;
        if (j.vy > 0) j.vy = 0;
        j.vx *= 0.7;
      }
      if (j.x < 4) {
        j.x = 4;
        j.vx = Math.abs(j.vx) * 0.2;
      } else if (j.x > this.w() - 4) {
        j.x = this.w() - 4;
        j.vx = -Math.abs(j.vx) * 0.2;
      }
      if (j.y < 4) {
        j.y = 4;
        j.vy = Math.abs(j.vy) * 0.2;
      }
    }

    // Integrate weights.
    for (const w of this.weights) {
      const damp = Math.exp(-this.state.damping * dt);
      w.vx *= damp;
      w.vy *= damp;
      w.x += w.vx * dt;
      w.y += w.vy * dt;
      const floor = this.h() - FLOOR_PAD - w.r;
      if (w.y > floor) {
        w.y = floor;
        if (w.vy > 0) w.vy = 0;
        w.vx *= 0.85;
      }
      if (w.x < w.r) {
        w.x = w.r;
        w.vx = Math.abs(w.vx) * 0.3;
      } else if (w.x > this.w() - w.r) {
        w.x = this.w() - w.r;
        w.vx = -Math.abs(w.vx) * 0.3;
      }
    }

    this.separateWeights();

    // Failure bookkeeping. The strength is canvas-normalized, so a member's
    // utilization is the same in any viewport.
    let broke = false;
    for (const mem of this.members) {
      if (mem.broken) continue;
      const mt = MATERIALS[mem.mat];
      const ratio = Math.abs(mem.force) / this.capacity(mem, s);
      if (ratio > 1) {
        if (mt.brittle) {
          mem.broken = true;
          broke = true;
        } else {
          mem.overload += dt;
          if (mem.overload > 0.4) {
            mem.broken = true;
            broke = true;
          }
        }
      } else {
        mem.overload = Math.max(0, mem.overload - dt * 2);
      }
    }
    if (broke && !this.failed) {
      this.failed = true;
      this.api.notify(
        'warning',
        this.zh() ? '结构失效：有杆件断裂' : 'Structural failure: a member snapped',
      );
    }
  }

  /** Light positional separation so stacked weights do not interpenetrate. */
  private separateWeights() {
    const list = this.weights;
    for (let i = 0; i < list.length; i += 1) {
      const a = list[i]!;
      for (let j = i + 1; j < list.length; j += 1) {
        const b = list[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const rr = a.r + b.r;
        let d = Math.hypot(dx, dy);
        if (d >= rr) continue;
        if (d < 1e-6) {
          dx = 0.01;
          dy = 0;
          d = 0.01;
        }
        const nx = dx / d;
        const ny = dy / d;
        const pen = (rr - d) * 0.5;
        const ma = a.m;
        const mb = b.m;
        const total = ma + mb;
        a.x -= nx * pen * ((2 * mb) / total);
        a.y -= ny * pen * ((2 * mb) / total);
        b.x += nx * pen * ((2 * ma) / total);
        b.y += ny * pen * ((2 * ma) / total);
        const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rel < 0) {
          const imp = (rel * 1.1) / (1 / ma + 1 / mb);
          a.vx += (imp / ma) * nx;
          a.vy += (imp / ma) * ny;
          b.vx -= (imp / mb) * nx;
          b.vy -= (imp / mb) * ny;
        }
      }
    }
  }

  // ---- Rendering ---------------------------------------------------------

  private w(): number {
    return this.canvas?.clientWidth || 640;
  }

  private h(): number {
    return this.canvas?.clientHeight || 400;
  }

  private zh(): boolean {
    return this.api?.locale === 'zh-CN';
  }

  /** The one "there is nothing to simulate yet" message, shared by every entry. */
  private warnNoData() {
    this.api.notify(
      'warning',
      this.zh()
        ? '尚未加载结构数据 — 拖入 JSON 结构文件或打开「示例数据」'
        : 'No structure loaded — drop a JSON structure file or open sample data',
    );
  }

  private report() {
    this.api.reportDataScale(this.joints.length + this.members.length + this.weights.length);
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 400;
    if (this.lastW > 0 && (w !== this.lastW || h !== this.lastH)) {
      const sx = w / this.lastW;
      const sy = h / this.lastH;
      for (const j of this.joints) {
        j.x *= sx;
        j.y *= sy;
        j.vx *= sx;
        j.vy *= sy;
      }
      for (const wt of this.weights) {
        wt.x *= sx;
        wt.y *= sy;
      }
    }
    this.lastW = w;
    this.lastH = h;
    canvas.width = w;
    canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) return;
    const s = this.sizeFactor();

    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, w, h);

    if (!this.state.hasData) {
      // Empty state: no structure loaded — never render a fabricated truss.
      g.fillStyle = 'rgba(150, 165, 185, 0.85)';
      g.font = `${this.zh() ? '12px "Microsoft YaHei"' : '12px Consolas'}, monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(
        this.zh()
          ? '未加载数据 — 拖入 JSON 结构文件或打开「示例数据」'
          : 'No data — drop a JSON structure file or open sample data',
        w / 2,
        h / 2,
      );
      return;
    }

    // Floor.
    const floor = h - FLOOR_PAD;
    g.strokeStyle = 'rgba(148,163,184,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, floor);
    g.lineTo(w, floor);
    g.stroke();
    g.strokeStyle = 'rgba(148,163,184,0.22)';
    g.lineWidth = 1;
    for (let x = -floor; x < w; x += 14) {
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + FLOOR_PAD, floor);
      g.stroke();
    }

    // Members.
    for (const mem of this.members) {
      if (mem.broken) continue;
      const A = this.joints[mem.a];
      const B = this.joints[mem.b];
      if (!A || !B) continue;
      const mt = MATERIALS[mem.mat];
      const ratio = Math.min(1, Math.abs(mem.force) / this.capacity(mem, s));
      g.strokeStyle = mix(mt.color, '#ef4444', ratio * 0.85);
      g.lineWidth = mt.width + ratio * 2;
      g.lineCap = 'round';
      if (mem.force < 0 && mt.tensionOnly) g.setLineDash([4, 5]);
      g.beginPath();
      g.moveTo(A.x, A.y);
      g.lineTo(B.x, B.y);
      g.stroke();
      g.setLineDash([]);

      if (this.state.showForces && ratio > 0.02) {
        const mx = (A.x + B.x) / 2;
        const my = (A.y + B.y) / 2;
        let ux = B.x - A.x;
        let uy = B.y - A.y;
        const ul = Math.hypot(ux, uy) || 1;
        ux /= ul;
        uy /= ul;
        const len = 10 + 26 * ratio;
        const dir = mem.force >= 0 ? 1 : -1; // tension (+) pulls along +axis
        g.strokeStyle = mem.force >= 0 ? '#f97316' : '#38bdf8';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(mx, my);
        g.lineTo(mx + ux * len * dir, my + uy * len * dir);
        g.stroke();
        g.fillStyle = 'rgba(226,232,240,0.85)';
        g.font = '10px Consolas, monospace';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(`${Math.round(Math.abs(mem.force) / s)}`, mx, my - 9);
      }
    }

    // Weights.
    for (const wt of this.weights) {
      const grad = g.createRadialGradient(wt.x - wt.r * 0.3, wt.y - wt.r * 0.3, wt.r * 0.2, wt.x, wt.y, wt.r);
      grad.addColorStop(0, '#fde68a');
      grad.addColorStop(1, '#b45309');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(wt.x, wt.y, wt.r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(15,23,42,0.7)';
      g.lineWidth = 1.5;
      g.stroke();
      g.fillStyle = '#1f2937';
      g.font = `bold ${Math.max(8, Math.round(wt.r * 0.9))}px Consolas, monospace`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(Math.round(wt.m * 10) / 10), wt.x, wt.y);
    }

    // Joints.
    for (const j of this.joints) {
      if (j.fixed) {
        g.fillStyle = '#22d3ee';
        g.beginPath();
        g.moveTo(j.x, j.y);
        g.lineTo(j.x - 9, j.y + 15);
        g.lineTo(j.x + 9, j.y + 15);
        g.closePath();
        g.fill();
        g.strokeStyle = 'rgba(34,211,238,0.5)';
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(j.x - 13, j.y + 15);
        g.lineTo(j.x + 13, j.y + 15);
        g.stroke();
      }
      g.fillStyle = '#e2e8f0';
      g.beginPath();
      g.arc(j.x, j.y, 5, 0, Math.PI * 2);
      g.fill();
    }

    // HUD.
    g.fillStyle = 'rgba(150,165,185,0.9)';
    g.font = `${this.zh() ? '12px "Microsoft YaHei"' : '12px Consolas'}, monospace`;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(
      this.zh()
        ? '点击「▶ 运行」开始模拟；调整参数会自动归位并暂停'
        : 'Press ▶ Run to start; changing a parameter re-arms and pauses',
      12,
      20,
    );
    const broken = this.members.filter((m) => m.broken).length;
    let peak = 0;
    for (const mem of this.members) {
      if (mem.broken) continue;
      peak = Math.max(peak, Math.abs(mem.force) / this.capacity(mem, s));
    }
    const info = this.zh()
      ? `节点 ${this.joints.length} · 杆件 ${this.members.length - broken}/${this.members.length} · 断裂 ${broken} · 重物 ${this.weights.length} · 最大利用率 ${Math.round(peak * 100)}%`
      : `joints ${this.joints.length} · members ${this.members.length - broken}/${this.members.length} · broken ${broken} · weights ${this.weights.length} · peak ${Math.round(peak * 100)}%`;
    g.fillText(info, 12, 38);
    if (this.state.showForces) {
      g.fillStyle = 'rgba(150,165,185,0.9)';
      g.fillText(
        this.zh() ? '轴力箭头：橙 = 受拉，蓝 = 受压' : 'Axial force: orange = tension, cyan = compression',
        12,
        56,
      );
    }
  }
}

// ---- Small helpers -------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Linear interpolation between two #rrggbb colors. */
function mix(a: string, b: string, t: number): string {
  const pa = hex(a);
  const pb = hex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

function hex(c: string): [number, number, number] {
  const s = c.replace('#', '');
  const v = parseInt(s.length === 3 ? s.replace(/(.)/g, '$1$1') : s, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export default function createStructurePlugin(): Plugin {
  return new StructurePlugin();
}
