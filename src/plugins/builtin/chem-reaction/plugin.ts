// ==========================================================================
// chem-reaction — true reaction-molecular-dynamics 3-D plugin
//
// The side bar sets the *reaction conditions* (temperature and a catalyst
// switch); pressing ▶ 运行 hands the scene to the embedded NumPy reaction-MD
// engine, which integrates a real trajectory under a Langevin thermostat: a
// reactant bond fractures when thermal fluctuations cross its Arrhenius
// barrier (rate grows with T), radical atoms drift apart, and product bonds
// snap together when the pair recombines. The 3-D canvas then replays that
// engine trajectory — atom positions come straight from the physics frames and
// each bond's visibility follows the engine's real fracture / recombination
// events. Nothing is pre-authored or interpolated.
//
// The scene code lives in `dynamics3d.ts`, loads lazily, and replays the run
// that the Python worker returned (positions + events).
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, Scene3DHandle } from '@/types/plugin';
import { emit } from '@/core/events';
import type { Group as ThreeGroup } from 'three';
import { actionButton, actionFired, exportSnapshotPng, exportCanvasPng } from '../shared/enhance';
import { REACTIONS, findReaction, type ReactionDef } from './catalog';
import { pushAllFigures } from './figures';
import { buildPhysicsPayload, DEFAULT_FRAMES, DEFAULT_STEPS, type BuiltPayload } from './reactmd/payload';
import { ReactMDClient } from './reactmd/client';
import type { PhysicsPayload, SimulationResult } from './reactmd/types';
import {
  buildDynamicsScene,
  buildStaticScene,
  fitDynamicsCamera,
  type DynamicsScene,
} from './dynamics3d';

export { chemReactionManifest } from './manifest';
import { chemReactionManifest } from './manifest';

/** Catalyst lowers every break-bond activation barrier by this factor (Eₐ,eff = Eₐ · f). */
const CATALYST_FACTOR = 0.5;

// temperature control range (K)
const TEMP_MIN = 300;
const TEMP_MAX = 1600;
const TEMP_STEP = 25;
const TEMP_DEFAULT = 900;

/** How many physics frames the replay steps per animation tick (~2× speed). */
const REPLAY_STEP = 2;

const SUB = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

interface State {
  reaction: string;
  temperature: number;
  catalyst: boolean;
}

export class ChemReactionPlugin implements Plugin {
  readonly manifest = chemReactionManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private state: State = {
    reaction: 'cuo-h2',
    temperature: TEMP_DEFAULT,
    catalyst: false,
  };

  private client = new ReactMDClient();
  private built: BuiltPayload | null = null;

  private group: ThreeGroup | null = null; // current static OR dynamics scene
  private dyn: DynamicsScene | null = null;
  private computing = false;
  private playing = false;
  private rafId = 0;
  private frameIdx = 0;
  private zh = false;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    this.client.onLog = (text) => this.api.log('debug', `[reactmd] ${text.trim()}`);
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.rebuildNow();
    });
  }

  async destroy() {
    this.stopReplay();
    this.clearScene();
    this.client.dispose();
    this.three?.setVisible(false);
    this.three = null;
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
    this.draw();
  }

  async deactivate() {
    this.stopReplay();
    this.clearScene();
    this.three?.setVisible(false);
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    if (container.three) this.three = container.three;
    this.draw();
  }

  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    if (!file.name.toLowerCase().endsWith('.json')) {
      this.api.notify('warning', this.zh ? '反应插件接受 JSON 场景文件。' : 'Reaction plugin accepts JSON scene files.');
      return;
    }
    try {
      const text = await this.api.readText(file);
      const json = JSON.parse(text) as { reaction?: string };
      if (typeof json.reaction === 'string' && findReaction(json.reaction)) {
        this.state.reaction = json.reaction;
        this.api.notify('info', this.zh ? `已加载反应：${this.state.reaction}` : `Loaded reaction: ${this.state.reaction}`);
      } else {
        this.api.notify('warning', this.zh ? '场景中的 reaction id 未知。' : 'Scene references an unknown reaction id.');
      }
    } catch (err) {
      this.api.notify('error', this.zh ? '无法解析反应场景文件。' : 'Failed to parse reaction scene file.');
      this.api.log('error', `[chem-reaction] loadData: ${String(err)}`);
    }
    this.rebuildNow();
  }

  getParams(): ParamDefinition[] {
    const zh = this.zh;
    return [
      {
        key: 'reaction',
        label: 'Reaction',
        labelI18n: { 'zh-CN': '选择反应', 'en-US': 'Reaction' },
        type: 'select',
        options: REACTIONS.map((r) => ({ value: r.id, label: zh ? r.nameZh : r.nameEn })),
        value: this.state.reaction,
      },
      {
        key: 'temperature',
        label: 'Temperature',
        labelI18n: { 'zh-CN': '温度', 'en-US': 'Temperature' },
        type: 'range',
        min: TEMP_MIN,
        max: TEMP_MAX,
        step: TEMP_STEP,
        value: this.state.temperature,
        hint: this.zh ? '越高→分子热振动越强→断键越快' : 'Higher → stronger thermal vibration → faster bond breaking',
      },
      {
        key: 'catalyst',
        label: 'Catalyst',
        labelI18n: { 'zh-CN': '催化剂', 'en-US': 'Catalyst' },
        type: 'checkbox',
        value: this.state.catalyst,
        hint: this.zh ? '降低反应活化能 Eₐ' : 'Lowers the activation energy Eₐ',
      },
      actionButton('run', 'Run', '运行', 'primary'),
      actionButton('fitView', 'Fit view', '复位视角'),
      actionButton('reset', 'Reset', '复位'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
      actionButton('exportPng', 'Snapshot PNG', '导出 PNG'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changes = false;
    if (typeof params.reaction === 'string' && findReaction(params.reaction)) {
      if (params.reaction !== this.state.reaction) {
        this.state.reaction = params.reaction;
        changes = true;
      }
    }
    if (typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
      const t = Math.min(TEMP_MAX, Math.max(TEMP_MIN, Math.round(params.temperature)));
      if (t !== this.state.temperature) {
        this.state.temperature = t;
        changes = true;
      }
    }
    if (params.catalyst === true || params.catalyst === false) {
      if (params.catalyst !== this.state.catalyst) {
        this.state.catalyst = params.catalyst;
        changes = true;
      }
    }
    if (actionFired(params, 'run')) {
      this.run();
      return;
    }
    if (actionFired(params, 'fitView')) this.fitView();
    if (actionFired(params, 'exportPng')) this.exportPng();
    if (actionFired(params, 'reset')) this.resetScene();
    if (actionFired(params, 'reloadPlugin')) this.reloadPlugin();
    if (actionFired(params, 'sendToFigure')) this.sendToFigure();
    if (changes) this.rebuildNow();
  }

  private refreshParams() {
    emit('host:params:changed', { pluginId: this.manifest.id });
  }

  // ---- static / replay scene management -----------------------------------

  private builtPayload(): BuiltPayload {
    if (this.built && this.built.payload && this.state.reaction === this.built.reaction) return this.built;
    const def = findReaction(this.state.reaction);
    if (!def) throw new Error(`unknown reaction: ${this.state.reaction}`);
    this.built = buildPhysicsPayload(def);
    this.built.reaction = def.id;
    return this.built;
  }

  private conditionPayload(): PhysicsPayload {
    const { payload } = this.builtPayload();
    if (!this.state.catalyst) return payload;
    // Catalyst lowers every break-bond barrier; form/keep bonds unaffected.
    return {
      ...payload,
      bonds: payload.bonds.map((b) => (b.kind === 'break' ? { ...b, ea: b.ea * CATALYST_FACTOR } : b)),
    };
  }

  /** (Re)build the static scene for the current conditions and wait for the
   *  user to press ▶ 运行 — computation is never started on open. */
  private rebuildNow() {
    if (!this.three) return this.draw2dInfo();
    this.stopReplay();
    this.computing = false;
    this.api?.setStatus('ready');
    try {
      const { payload } = this.builtPayload();
      this.clearScene();
      const stat = buildStaticScene(payload);
      this.group = stat.group;
      this.three.scene.add(stat.group);
      fitDynamicsCamera(this.three.camera, this.three.controls, payload);
      this.three.setVisible(true);
      this.three.render();
    } catch (err) {
      this.three.setVisible(false);
      this.api.log('error', `[chem-reaction] rebuild: ${String(err)}`);
      return;
    }
    this.refreshParams();
  }

  private showDynamics(payload: PhysicsPayload, result: SimulationResult) {
    const three = this.three;
    if (!three) return;
    this.clearScene();
    const dyn = buildDynamicsScene(payload, result);
    this.dyn = dyn;
    this.group = dyn.group;
    three.scene.add(dyn.group);
    fitDynamicsCamera(three.camera, three.controls, payload);
    three.setVisible(true);
    three.render();
    this.startReplay();
    this.api.notify('success', this.zh ? '引擎积分完成，正在回放真实轨迹。' : 'Engine integration done — replaying the real trajectory.');
    this.refreshParams();
  }

  // ---- engine run ----------------------------------------------------------

  private run() {
    if (this.computing) return;
    if (!this.three) {
      this.run2dClip();
      return;
    }
    this.stopReplay();
    this.computing = true;
    this.api.setStatus('computing');
    this.api.notify('info', this.zh ? '反应分子动力学引擎计算中…' : 'Reaction-MD engine integrating…');
    this.refreshParams();

    let payload: PhysicsPayload;
    try {
      payload = this.conditionPayload();
    } catch (err) {
      this.computing = false;
      this.api.setStatus('error');
      this.api.notify('error', String(err));
      this.refreshParams();
      return;
    }

    this.client
      .run(payload, {
        temperature: this.state.temperature,
        steps: DEFAULT_STEPS,
        frames: DEFAULT_FRAMES,
        seed: 20260922,
      })
      .then((result) => {
        if (!result.ok) throw new Error('engine returned ok=false');
        this.computing = false;
        this.api.setStatus('ready');
        this.showDynamics(payload, result);
      })
      .catch((err) => {
        this.computing = false;
        this.api.setStatus('error');
        this.api.notify('error', this.zh ? `引擎计算失败：${errMsg(err)}` : `Engine failed: ${errMsg(err)}`);
        this.api.log('error', `[chem-reaction] run: ${errMsg(err)}`);
        this.refreshParams();
      });
  }

  /** 2-D fallback: run the engine and label the canvas with the summary. */
  private run2dClip() {
    this.computing = true;
    this.api.setStatus('computing');
    this.client
      .run(this.conditionPayload(), {
        temperature: this.state.temperature,
        steps: DEFAULT_STEPS,
        frames: DEFAULT_FRAMES,
        seed: 20260922,
      })
      .then((result) => {
        this.computing = false;
        this.api.setStatus('ready');
        this.draw2dInfo(result);
      })
      .catch(() => {
        this.computing = false;
        this.api.setStatus('error');
        this.draw2dInfo();
      });
  }

  // ---- replay loop ---------------------------------------------------------

  private startReplay() {
    if (!this.dyn || !this.three) return;
    this.frameIdx = 0;
    this.dyn.update(0);
    this.three.render();
    this.playing = true;
    this.cancelRaf();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopReplay() {
    this.playing = false;
    this.cancelRaf();
  }

  private cancelRaf() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
  }

  private tick = () => {
    this.rafId = 0;
    if (!this.playing || !this.dyn || !this.three) return;
    this.frameIdx += REPLAY_STEP;
    if (this.frameIdx >= this.dyn.frameCount - 1) {
      this.frameIdx = this.dyn.frameCount - 1;
      this.dyn.update(this.frameIdx);
      this.three.render();
      this.playing = false;
      this.api.setStatus('ready');
      return;
    }
    this.dyn.update(this.frameIdx);
    this.three.render();
    this.rafId = requestAnimationFrame(this.tick);
  };

  // ---- view / export -------------------------------------------------------

  private fitView() {
    if (!this.three) return;
    try {
      fitDynamicsCamera(this.three.camera, this.three.controls, this.builtPayload().payload);
    } catch {
      /* ignore */
    }
    this.three.render();
  }

  private exportPng() {
    if (this.three) exportSnapshotPng(this.api, this.three.snapshot(), 'chem-reaction');
    else exportCanvasPng(this.api, this.ctx?.canvas2d, 'chem-reaction');
  }

  /** Push analysis figures (ΔG(T), Arrhenius, van't Hoff, α–pH, Ksp, atom map)
   *  for the current reaction into Figure Studio. */
  private sendToFigure() {
    const def = findReaction(this.state.reaction);
    if (!def) {
      this.api.notify('warning', this.zh ? '没有可分析的反应。' : 'No reaction to analyse.');
      return;
    }
    const labels = pushAllFigures(def, this.builtPayload().payload);
    if (!labels.length) {
      this.api.notify('warning', this.zh ? '当前反应暂无可生成的图表。' : 'No figures are computable for this reaction.');
      return;
    }
    this.api.notify(
      'success',
      this.zh
        ? `已发送到 Figure Studio：${labels.join('、')}`
        : `Sent to Figure Studio: ${labels.join(', ')}`,
    );
  }

  /** Restore the current reaction to its pristine initial scene (stop any replay). */
  private resetScene() {
    this.rebuildNow();
  }

  /** Reset the whole plugin to its default reaction/conditions. */
  private reloadPlugin() {
    this.stopReplay();
    this.computing = false;
    this.state.reaction = 'cuo-h2';
    this.state.temperature = TEMP_DEFAULT;
    this.state.catalyst = false;
    this.refreshParams();
    this.rebuildNow();
    this.api.notify('success', this.zh ? '插件已重置为默认反应。' : 'Plugin reset to the default reaction.');
  }

  // ---- rendering -----------------------------------------------------------

  private draw() {
    if (this.three) {
      this.rebuildNow();
      return;
    }
    this.draw2dInfo();
  }

  private draw2dInfo(result?: SimulationResult) {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const def = findReaction(this.state.reaction);
    const g = canvas.getContext('2d');
    if (!g) return;
    canvas.width = Math.min(canvas.width || 520, 520);
    canvas.height = canvas.height || 320;
    g.fillStyle = '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (!def) {
      g.fillStyle = '#94a3b8';
      g.textAlign = 'center';
      g.font = '14px "Microsoft YaHei", sans-serif';
      g.fillText(this.zh ? '请选择或加载一个反应场景' : 'Select or load a reaction scene', canvas.width / 2, canvas.height / 2);
      return;
    }
    g.fillStyle = '#e7edf5';
    g.font = '600 20px "Microsoft YaHei", monospace';
    g.textAlign = 'center';
    g.fillText(equationOf(def), canvas.width / 2, 60);
    g.fillStyle = '#7dd3fc';
    g.font = '14px "Microsoft YaHei", sans-serif';
    const cat = this.state.catalyst ? ' · 催化剂 on' : '';
    g.fillText(`分类 ${def.classification} · T ${this.state.temperature} K${cat}`, canvas.width / 2, 100);
    g.fillStyle = '#94a3b8';
    g.font = '13px "Microsoft YaHei", sans-serif';
    if (result) {
      const breaks = (result.break_events ?? []).length;
      const forms = result.form_events?.length ?? 0;
      g.fillText(`引擎积分 ${Math.round(this.client.durationMs ?? 0)} ms · 断键 ${breaks} · 成键 ${forms}`, canvas.width / 2, 140);
    } else {
      g.fillText(this.zh ? '3D 容器不可用：按 Run 用引擎积分后显示摘要。' : '3D unavailable — press Run to integrate with the engine.', canvas.width / 2, 140);
    }
    g.fillStyle = this.computing ? '#fbbf24' : 'rgba(150,165,185,0.7)';
    g.font = '12px "Microsoft YaHei", sans-serif';
    g.fillText(
      this.computing ? (this.zh ? '引擎计算中…' : 'Engine integrating…') : (this.zh ? '' : ''),
      canvas.width / 2,
      canvas.height - 18,
    );
  }

  private clearScene() {
    const three = this.three;
    const g = this.group;
    if (g) {
      three?.scene.remove(g);
      for (const geo of (g.userData.sharedGeometries ?? []) as Disposable[]) geo.dispose?.();
      g.traverse((obj) => {
        const m = obj as { geometry?: Disposable; material?: Disposable };
        if (m.geometry) m.geometry.dispose?.();
        if (m.material) m.material.dispose?.();
        const sp = obj as { userData?: { dispose?: () => void }; material?: { map?: { dispose?: () => void } } };
        if (sp.userData?.dispose) sp.userData.dispose();
        if (sp.material?.map) sp.material.map.dispose?.();
      });
    }
    this.group = null;
    this.dyn = null;
  }
}

interface Disposable {
  dispose?: () => void;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Rasterise a formula with subscript digits, e.g. "H2" → "H₂". */
export function renderFormula(formula: string): string {
  return formula.replace(/\d+/g, (d) => [...d].map((c) => SUB[Number(c)] ?? c).join(''));
}

/** Render a reaction as "CuO + H₂ → Cu + H₂O" with proper subscripts. */
export function equationOf(def: ReactionDef): string {
  const side = (ss: Array<{ formula: string; stoich: number }>) =>
    ss.map((s) => `${s.stoich > 1 ? s.stoich : ''}${renderFormula(s.formula)}`).join(' + ');
  return `${side(def.reactants)} → ${side(def.products)}`;
}

export default function createChemReactionPlugin(): Plugin {
  return new ChemReactionPlugin();
}