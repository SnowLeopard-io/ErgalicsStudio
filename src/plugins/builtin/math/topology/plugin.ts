// ==========================================================================
// math-topology — topology visualizer (surfaces, homotopy, classification)
//
// Renders the selected embedded surface (torus / Möbius band / Klein bottle)
// into the host Three.js scene, overlays a fundamental-group demo loop that
// continuously retracts onto its core curve (rAF-driven homotopy stage) and a
// superellipse morph curve for the homeomorphism demo. The science strip
// reports the numerically verified Euler characteristic χ = V − E + F against
// the closed form χ = 2 − 2g for the genus selector.
//
// Lifecycle: meshes live inside an owned THREE.Group; deactivate/destroy cancel
// the animation frame, dispose geometry/material and remove the group from the
// scene. Without a WebGL container the plugin falls back to a 2-D wireframe
// preview on canvas2d so the viewport never goes black.
// ==========================================================================

import * as THREE from 'three';
import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  Scene3DHandle,
} from '@/types/plugin';
import { emit } from '@/core/events';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { topologyFigurePanels } from './figure';
import { mathTopologyManifest } from './manifest';
import {
  LOOP_PRESETS,
  MORPH_PRESETS,
  SURFACE_PRESETS,
  buildSurfaceMesh,
  loopLength,
  loopPoints,
  meshEulerCounts,
  morphCurvePoints,
  runTopologyBenchmarks,
  surfacePoint,
  verifyGenusChi,
  type EulerCounts,
  type LoopPreset,
  type MorphPreset,
  type SurfaceId,
  type SurfaceMesh,
  type SurfaceShape,
} from './kernel';

export { mathTopologyManifest } from './manifest';

interface State {
  surface: SurfaceId;
  /** Major radius R. */
  radius: number;
  /** Tube radius / band half-width / cross-cap scale. */
  width: number;
  /** Grid segments along u (v uses half of it). */
  segments: number;
  /** Genus selector for the χ = 2 − 2g verification. */
  genus: number;
  /** Selected loop preset id, or 'none'. */
  loop: string;
  /** Selected homeomorphism morph preset id, or 'none'. */
  morph: string;
  /** Homotopy stage t ∈ [0, 1] (loop retraction + morph progress). */
  deform: number;
  /** rAF ping-pong animation of the deformation stage. */
  animate: boolean;
}

/** Surface wireframe colours (shared with the 2-D fallback). */
const SURFACE_COLORS: Record<SurfaceId, string> = {
  torus: '#6db4ff',
  mobius: '#4be1c3',
  klein: '#ffb250',
};

/** Gradient stops of the demo loop line. */
const LOOP_COLORS = ['#6db4ff', '#4be1c3', '#ffb250'];
/** Homeomorphism morph curve colour. */
const MORPH_COLOR = '#f5a623';
/** Deformation loop colour on the 2-D fallback. */
const FALLBACK_LOOP_COLOR = '#ff7a7a';

/** Animation speed of the deformation stage (ping-pong 0 ↔ 1), per second. */
const DEFORM_SPEED = 0.35;
/** Loop/morph sample count (closed polyline, first point repeated last). */
const LINE_SAMPLES = 256;
/** Grid segment clamp for the 2-D fallback (keeps rAF redraws cheap). */
const FALLBACK_MAX_SEGMENTS = 48;

interface CachedMesh {
  mesh: SurfaceMesh;
  counts: EulerCounts;
}

interface ThreeGeometryLike {
  dispose?: () => void;
}

interface ThreeMaterialLike {
  dispose?: () => void;
}

function hexChannels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear blend of two '#rrggbb' colours. */
function mixHex(a: string, b: string, t: number): string {
  const ca = hexChannels(a);
  const cb = hexChannels(b);
  const x = Math.min(1, Math.max(0, t));
  const c = ca.map((v, i) => Math.round(v + ((cb[i] ?? 0) - v) * x));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** '#rrggbb' with an alpha channel, for the 2-D wireframe strokes. */
function hexAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexChannels(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export class MathTopologyPlugin implements Plugin {
  readonly manifest = mathTopologyManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private zh = false;
  private state: State = {
    surface: 'torus',
    radius: SURFACE_PRESETS[0]!.R,
    width: SURFACE_PRESETS[0]!.w,
    segments: 64,
    genus: 1,
    loop: 'torus-longitude',
    morph: 'circle-ellipse-square',
    deform: 0,
    animate: false,
  };

  // ---- owned 3-D objects ---------------------------------------------------
  private group: THREE.Group | null = null;
  private loopLine: THREE.Line | null = null;
  private morphLine: THREE.Line | null = null;
  private loopPreset: LoopPreset | null = null;
  private morphPreset: MorphPreset | null = null;
  private threeKey = '';
  private sceneHandle: Scene3DHandle | null = null;
  /** Surface identity the camera was last fitted to. */
  private fittedKey = '';

  // ---- animation -----------------------------------------------------------
  private rafId = 0;
  private lastFrame = 0;
  private lastScience = 0;
  private deformDir = 1;

  // ---- caches ---------------------------------------------------------------
  private meshCache = new Map<string, CachedMesh>();

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    this.stop();
    this.clear3d();
    this.three?.setVisible(false);
    clearScienceOutputs(this.manifest.id);
    this.meshCache.clear();
    this.ctx = null;
    this.three = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
    this.draw();
    if (this.state.animate) this.start();
  }

  async deactivate() {
    this.stop();
    this.clear3d();
    this.three?.setVisible(false);
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    if (container.three) this.three = container.three;
    this.draw();
  }

  /** Host entry for 3-D-capable plugins. */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.draw();
  }

  // ---- parameters -------------------------------------------------------------

  getParams(): ParamDefinition[] {
    const zh = this.zh;
    const preset = SURFACE_PRESETS.find((p) => p.id === this.state.surface);
    const loopOptions = [
      { value: 'none', label: zh ? '无' : 'None', labelI18n: { 'zh-CN': '无', 'en-US': 'None' } },
      ...LOOP_PRESETS.filter((p) => p.surface === this.state.surface).map((p) => ({
        value: p.id,
        label: zh ? p.labelZh : p.labelEn,
        labelI18n: { 'zh-CN': p.labelZh, 'en-US': p.labelEn },
      })),
    ];
    const morphOptions = [
      { value: 'none', label: zh ? '无' : 'None', labelI18n: { 'zh-CN': '无', 'en-US': 'None' } },
      ...MORPH_PRESETS.map((p) => ({
        value: p.id,
        label: zh ? p.labelZh : p.labelEn,
        labelI18n: { 'zh-CN': p.labelZh, 'en-US': p.labelEn },
      })),
    ];
    return [
      {
        key: 'surface',
        label: 'Surface',
        labelI18n: { 'zh-CN': '曲面', 'en-US': 'Surface' },
        type: 'select',
        options: SURFACE_PRESETS.map((p) => ({
          value: p.id,
          label: zh ? p.labelZh : p.labelEn,
          labelI18n: { 'zh-CN': p.labelZh, 'en-US': p.labelEn },
        })),
        value: this.state.surface,
      },
      {
        key: 'radius',
        label: 'Major radius R',
        labelI18n: { 'zh-CN': '主半径 R', 'en-US': 'Major radius R' },
        type: 'number',
        min: 0.6,
        max: 3,
        step: 0.1,
        value: this.state.radius,
        hint: zh
          ? `当前曲面默认值：${preset ? preset.R : this.state.radius}`
          : `default for this surface: ${preset ? preset.R : this.state.radius}`,
      },
      {
        key: 'width',
        label: 'Half-width w',
        labelI18n: { 'zh-CN': '半宽 w', 'en-US': 'Half-width w' },
        type: 'number',
        min: 0.1,
        max: 1,
        step: 0.05,
        value: this.state.width,
        hint: zh ? '管半径 / 带半宽 / 截面尺度' : 'tube radius / band half-width / cross-cap scale',
      },
      {
        key: 'segments',
        label: 'Grid segments (u)',
        labelI18n: { 'zh-CN': '网格段数（u 向）', 'en-US': 'Grid segments (u)' },
        type: 'range',
        min: 16,
        max: 160,
        step: 4,
        value: this.state.segments,
        hint: zh ? 'v 向取 u 向的一半；用于 V − E + F 数值计数' : 'v uses half of u; drives the V − E + F count',
      },
      {
        key: 'genus',
        label: 'Genus g',
        labelI18n: { 'zh-CN': '亏格 g', 'en-US': 'Genus g' },
        type: 'range',
        min: 0,
        max: 5,
        step: 1,
        value: this.state.genus,
        hint: zh ? '0 = 球面、1 = 环面、≥2 = 多环面；χ = 2 − 2g' : '0 = sphere, 1 = torus, ≥2 = multi-torus; χ = 2 − 2g',
      },
      {
        key: 'loop',
        label: 'Demo loop',
        labelI18n: { 'zh-CN': '演示环路', 'en-US': 'Demo loop' },
        type: 'select',
        options: loopOptions,
        value: this.state.loop,
        hint: zh ? '基本群中的彩色环路；形变阶段 t 控制收缩' : 'colored loop in the fundamental group; stage t drives the retraction',
      },
      {
        key: 'morph',
        label: 'Homeomorphism morph',
        labelI18n: { 'zh-CN': '同胚形变', 'en-US': 'Homeomorphism morph' },
        type: 'select',
        options: morphOptions,
        value: this.state.morph,
        hint: zh ? '超椭圆族连续形变（t 驱动）' : 'superellipse family, driven by stage t',
      },
      {
        key: 'deform',
        label: 'Deformation stage t',
        labelI18n: { 'zh-CN': '形变阶段 t', 'en-US': 'Deformation stage t' },
        type: 'range',
        min: 0,
        max: 1,
        step: 0.01,
        value: this.state.deform,
        hint: zh ? '同时驱动环路收缩与同胚形变' : 'drives both the loop retraction and the morph',
        visibleWhen: [
          { key: 'loop', notIn: ['none'] },
          { key: 'morph', notIn: ['none'] },
        ],
      },
      {
        key: 'animate',
        label: 'Animate stage',
        labelI18n: { 'zh-CN': '动画播放', 'en-US': 'Animate stage' },
        type: 'checkbox',
        value: this.state.animate,
        hint: zh ? 'rAF 驱动 t 在 0 ↔ 1 之间往返' : 'rAF ping-pong of t between 0 and 1',
        visibleWhen: [
          { key: 'loop', notIn: ['none'] },
          { key: 'morph', notIn: ['none'] },
        ],
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, cb: (v: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (cb(params[k] as number)) this.draw();
      }
    };
    num('radius', (v) => {
      const x = Math.min(3, Math.max(0.6, v));
      if (Math.abs(x - this.state.radius) < 1e-9) return false;
      this.state.radius = x;
      return true;
    });
    num('width', (v) => {
      const x = Math.min(1, Math.max(0.1, v));
      if (Math.abs(x - this.state.width) < 1e-9) return false;
      this.state.width = x;
      return true;
    });
    num('segments', (v) => {
      const x = Math.round(Math.min(160, Math.max(16, v)));
      if (x === this.state.segments) return false;
      this.state.segments = x;
      return true;
    });
    num('genus', (v) => {
      const x = Math.round(Math.min(5, Math.max(0, v)));
      if (x === this.state.genus) return false;
      this.state.genus = x;
      return true;
    });
    num('deform', (v) => {
      const x = Math.min(1, Math.max(0, v));
      if (Math.abs(x - this.state.deform) < 1e-9) return false;
      this.state.deform = x;
      this.deformDir = x >= 1 ? -1 : 1;
      return true;
    });
    if (typeof params.loop === 'string' && params.loop !== this.state.loop) {
      const ok = params.loop === 'none' || LOOP_PRESETS.some((p) => p.id === params.loop && p.surface === this.state.surface);
      if (ok) {
        this.state.loop = params.loop;
        this.draw();
      }
    }
    if (typeof params.morph === 'string' && params.morph !== this.state.morph) {
      const ok = params.morph === 'none' || MORPH_PRESETS.some((p) => p.id === params.morph);
      if (ok) {
        this.state.morph = params.morph;
        this.draw();
      }
    }
    if (typeof params.animate === 'boolean' && params.animate !== this.state.animate) {
      this.state.animate = params.animate;
      if (params.animate) this.start();
      else {
        this.stop();
        this.draw();
      }
    }
    // Surface switching comes last: it adopts the preset shape defaults after
    // the numeric params of the previous surface have been applied.
    if (typeof params.surface === 'string' && params.surface !== this.state.surface) {
      const id = params.surface;
      if (id === 'torus' || id === 'mobius' || id === 'klein') {
        const preset = SURFACE_PRESETS.find((p) => p.id === id);
        this.state.surface = id;
        if (preset) {
          this.state.radius = preset.R;
          this.state.width = preset.w;
        }
        // Keep the demo loop consistent with the newly embedded surface.
        const lp = LOOP_PRESETS.find((p) => p.id === this.state.loop);
        if (lp && lp.surface !== this.state.surface) this.state.loop = 'none';
        this.fittedKey = '';
        this.draw();
        emit('host:params:changed', { pluginId: this.manifest.id });
      }
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  // ---- actions ----------------------------------------------------------------

  /** Run the embedded validation suite and publish one metric per benchmark. */
  private runBenchmark() {
    const bench = runTopologyBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: this.zh ? b.detailZh : b.detailEn,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0
        ? `All ${bench.length} topology benchmarks passed.`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项拓扑基准通过。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  /** Build the classification + retraction panels and push them into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    const preset = SURFACE_PRESETS.find((p) => p.id === this.state.surface);
    const ver = verifyGenusChi(this.state.genus);
    const lp = this.currentLoop();
    const shape = this.shape();
    const caption: Bilingual = {
      zh: `曲面 ${preset ? preset.labelZh : this.state.surface}（R=${this.state.radius}，w=${this.state.width}，网格 ${this.state.segments}×${Math.max(3, this.state.segments >> 1)}）：亏格 g=${ver.g}，χ = 2 − 2g = ${ver.expectedChi}，实测 χ = ${ver.counts.chi}（V−E+F = ${ver.counts.vertices}−${ver.counts.edges}+${ver.counts.faces}）。${lp ? `环路「${lp.labelZh}」(p,q)=(${lp.spec.p}, ${lp.spec.q})，形变阶段 t=${this.state.deform.toFixed(2)}，长度=${fmtMetric(loopLength(this.state.surface, shape, lp.spec, this.state.deform))}。` : '未选择演示环路。'}`,
      en: `Surface ${preset ? preset.labelEn : this.state.surface} (R=${this.state.radius}, w=${this.state.width}, grid ${this.state.segments}×${Math.max(3, this.state.segments >> 1)}): genus g=${ver.g}, χ = 2 − 2g = ${ver.expectedChi}, measured χ = ${ver.counts.chi} (V−E+F = ${ver.counts.vertices}−${ver.counts.edges}+${ver.counts.faces}). ${lp ? `Loop "${lp.labelEn}" (p,q)=(${lp.spec.p}, ${lp.spec.q}), stage t=${this.state.deform.toFixed(2)}, length=${fmtMetric(loopLength(this.state.surface, shape, lp.spec, this.state.deform))}.` : 'No demo loop selected.'}`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '拓扑可视化', en: 'Topology Visualizer' },
      caption,
      topologyFigurePanels({
        genusMax: this.state.genus,
        surface: this.state.surface,
        shape,
        loop: lp ? lp.spec : null,
      }),
    );
  }

  // ---- numerics + science outputs ----------------------------------------------

  private shape(): SurfaceShape {
    return { R: this.state.radius, w: this.state.width };
  }

  private currentLoop(): LoopPreset | null {
    return LOOP_PRESETS.find((p) => p.id === this.state.loop && p.surface === this.state.surface) ?? null;
  }

  private currentMorph(): MorphPreset | null {
    return MORPH_PRESETS.find((p) => p.id === this.state.morph) ?? null;
  }

  /** Cached triangulation of the current surface (V − E + F counted once). */
  private meshFor(): CachedMesh {
    const segU = Math.max(3, Math.round(this.state.segments));
    const segV = Math.max(3, this.state.segments >> 1);
    const key = `${this.state.surface}|${this.state.radius.toFixed(4)}|${this.state.width.toFixed(4)}|${segU}|${segV}`;
    const hit = this.meshCache.get(key);
    if (hit) return hit;
    const mesh = buildSurfaceMesh(this.state.surface, {
      R: this.state.radius,
      w: this.state.width,
      segU,
      segV,
    });
    const entry: CachedMesh = { mesh, counts: meshEulerCounts(mesh) };
    if (this.meshCache.size > 24) {
      const oldest = this.meshCache.keys().next();
      if (!oldest.done) this.meshCache.delete(oldest.value);
    }
    this.meshCache.set(key, entry);
    return entry;
  }

  /** Publish the genus verification, the surface mesh counts and the loop state. */
  private publishScience() {
    const zh = this.zh;
    const ver = verifyGenusChi(this.state.genus);
    const { counts } = this.meshFor();
    const metrics: ScienceMetric[] = [
      {
        key: 'genus-chi',
        label: zh ? `亏格 g=${ver.g} 的 χ（数值）` : `χ at genus g=${ver.g} (measured)`,
        value: fmtMetric(ver.counts.chi),
        severity: ver.passed ? 'ok' : 'error',
        hint: zh
          ? `三角复形 V−E+F = ${ver.counts.vertices}−${ver.counts.edges}+${ver.counts.faces} = ${ver.counts.chi}，解析式 χ = 2 − 2g = ${ver.expectedChi}；相对误差 ${fmtMetric(ver.relErr)}。`
          : `triangulation V−E+F = ${ver.counts.vertices}−${ver.counts.edges}+${ver.counts.faces} = ${ver.counts.chi}, analytic χ = 2 − 2g = ${ver.expectedChi}; relative error ${fmtMetric(ver.relErr)}.`,
      },
      {
        key: 'surface-mesh',
        label: zh ? '当前曲面网格 V−E+F' : 'Current surface mesh V−E+F',
        value: `${counts.vertices}−${counts.edges}+${counts.faces} = ${counts.chi}`,
        severity: counts.chi === 0 ? 'ok' : 'warn',
        hint: zh
          ? `${SURFACE_PRESETS.find((p) => p.id === this.state.surface)?.labelZh ?? ''} 的缝合网格；三者 χ = 0（Möbius 带与 Klein 瓶均不可定向）。`
          : `seamed grid of the ${SURFACE_PRESETS.find((p) => p.id === this.state.surface)?.labelEn ?? ''}; χ = 0 (Möbius band and Klein bottle are both non-orientable).`,
      },
    ];
    const lp = this.currentLoop();
    if (lp) {
      const shape = this.shape();
      const len = loopLength(this.state.surface, shape, lp.spec, this.state.deform);
      const pts = loopPoints(this.state.surface, shape, lp.spec, this.state.deform, 8);
      const a = pts[0]!;
      const b = pts[pts.length - 1]!;
      const gap = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      metrics.push({
        key: 'loop-length',
        label: zh ? '环路长度（形变中）' : 'Loop length (deforming)',
        value: fmtMetric(len),
        severity: gap < 1e-6 ? 'ok' : 'warn',
        hint: zh
          ? `环路「${lp.labelZh}」绕数 (p, q) = (${lp.spec.p}, ${lp.spec.q})，形变阶段 t = ${this.state.deform.toFixed(2)}，闭合间隙 ${gap.toExponential(2)}。t → 1 收缩到核心曲线，同伦类不变。`
          : `loop "${lp.labelEn}" with winding (p, q) = (${lp.spec.p}, ${lp.spec.q}), stage t = ${this.state.deform.toFixed(2)}, closure gap ${gap.toExponential(2)}. As t → 1 it retracts onto its core curve, preserving the homotopy class.`,
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- animation -----------------------------------------------------------------

  private start() {
    if (this.rafId) return;
    this.lastFrame = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stop() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.lastFrame = 0;
  }

  private tick = () => {
    this.rafId = requestAnimationFrame(this.tick);
    const now = performance.now();
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 1 / 60;
    this.lastFrame = now;
    // Ping-pong the homotopy stage between 0 and 1.
    let t = this.state.deform + this.deformDir * DEFORM_SPEED * dt;
    if (t >= 1) {
      t = 1;
      this.deformDir = -1;
    } else if (t <= 0) {
      t = 0;
      this.deformDir = 1;
    }
    this.state.deform = t;
    if (this.three && this.group) {
      this.updateLineGeometry();
      this.three.render();
      if (now - this.lastScience > 500) {
        this.lastScience = now;
        this.publishScience();
      }
    } else {
      this.draw2d();
      if (now - this.lastScience > 500) {
        this.lastScience = now;
        this.publishScience();
      }
    }
  };

  // ---- drawing --------------------------------------------------------------------

  private draw() {
    this.publishScience();
    if (this.three) {
      this.draw3d();
      return;
    }
    this.draw2d();
  }

  private draw3d() {
    const three = this.three;
    if (!three) return;
    const st = this.state;
    const key = [st.surface, st.radius, st.width, st.segments, st.loop, st.morph].join('|');
    if (this.threeKey !== key || this.sceneHandle !== three) {
      // Captured before clear3d() resets sceneHandle.
      const containerChanged = this.sceneHandle !== three;
      this.clear3d();
      this.group = this.buildGroup();
      three.scene.add(this.group);
      // Refit only when the embedding itself (or the 3-D container) changed,
      // so display tweaks keep the user's orbit/zoom intact.
      const fitKey = `${st.surface}|${st.radius.toFixed(3)}|${st.width.toFixed(3)}`;
      if (this.fittedKey !== fitKey || containerChanged) {
        this.fitCamera(three);
        this.fittedKey = fitKey;
      }
      this.threeKey = key;
      this.sceneHandle = three;
    } else {
      this.updateLineGeometry();
    }
    three.setVisible(true);
    three.render();
  }

  /** Scene extent: torus outer radius plus the morph stage placed below it. */
  private extent(): number {
    return this.state.radius + 2 * this.state.width;
  }

  private buildGroup(): THREE.Group {
    const st = this.state;
    const group = new THREE.Group();
    group.name = 'math-topology';

    // ---- surface mesh --------------------------------------------------------
    const { mesh } = this.meshFor();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions, 3));
    geo.setIndex(mesh.indices.slice());
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: SURFACE_COLORS[st.surface],
      side: THREE.DoubleSide,
      flatShading: true,
      metalness: 0.08,
      roughness: 0.62,
    });
    const surfaceMesh = new THREE.Mesh(geo, mat);
    surfaceMesh.name = 'surface';
    group.add(surfaceMesh);
    // Subtle edge overlay so the triangulation behind V − E + F is visible.
    const wire = new THREE.LineSegments(
      new THREE.WireframeGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0x0a0e13, transparent: true, opacity: 0.14 }),
    );
    wire.name = 'wire';
    group.add(wire);

    // ---- demo loop (gradient-colored polyline) --------------------------------
    this.loopPreset = this.currentLoop();
    if (this.loopPreset) {
      const positions = new Float32Array((LINE_SAMPLES + 1) * 3);
      const colors = new Float32Array((LINE_SAMPLES + 1) * 3);
      for (let k = 0; k <= LINE_SAMPLES; k += 1) {
        const t = k / LINE_SAMPLES;
        const c = t < 0.5 ? mixHex(LOOP_COLORS[0]!, LOOP_COLORS[1]!, t * 2) : mixHex(LOOP_COLORS[1]!, LOOP_COLORS[2]!, (t - 0.5) * 2);
        const [r, g, b] = hexChannels(c);
        colors[k * 3] = r / 255;
        colors[k * 3 + 1] = g / 255;
        colors[k * 3 + 2] = b / 255;
      }
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      lineGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
      line.name = 'loop';
      this.loopLine = line;
      group.add(line);
    }

    // ---- homeomorphism morph curve (floating below the surface) ---------------
    this.morphPreset = this.currentMorph();
    if (this.morphPreset) {
      const positions = new Float32Array((LINE_SAMPLES + 1) * 3);
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      const line = new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({ color: MORPH_COLOR }),
      );
      line.name = 'morph';
      this.morphLine = line;
      group.add(line);
    }

    this.updateLineGeometry();
    return group;
  }

  /** Refresh loop/morph vertex positions for the current deformation stage. */
  private updateLineGeometry() {
    const st = this.state;
    const shape = this.shape();
    if (this.loopLine && this.loopPreset) {
      const pts = loopPoints(st.surface, shape, this.loopPreset.spec, st.deform, LINE_SAMPLES);
      const attr = this.loopLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let k = 0; k < pts.length && k <= LINE_SAMPLES; k += 1) {
        const p = pts[k]!;
        arr[k * 3] = p[0];
        arr[k * 3 + 1] = p[1];
        arr[k * 3 + 2] = p[2];
      }
      attr.needsUpdate = true;
      this.loopLine.geometry.computeBoundingSphere();
    }
    if (this.morphLine && this.morphPreset) {
      const extent = this.extent();
      const scale = 0.45 * extent;
      const yBase = -1.15 * extent;
      const pts = morphCurvePoints(this.morphPreset, st.deform, LINE_SAMPLES);
      const attr = this.morphLine.geometry.getAttribute('position') as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      for (let k = 0; k < pts.length && k <= LINE_SAMPLES; k += 1) {
        const p = pts[k]!;
        arr[k * 3] = p[0] * scale;
        arr[k * 3 + 1] = yBase;
        arr[k * 3 + 2] = p[1] * scale;
      }
      attr.needsUpdate = true;
      this.morphLine.geometry.computeBoundingSphere();
    }
  }

  private fitCamera(three: Scene3DHandle) {
    const r = this.extent() * 1.5;
    const { camera, controls } = three;
    controls.target.set(0, 0, 0);
    camera.position.set(r * 1.7, r * 1.25, r * 1.9);
    camera.near = Math.max(r / 200, 1e-4);
    camera.far = Math.max(r * 200, 200);
    camera.updateProjectionMatrix();
    controls.update?.();
  }

  /** Remove + dispose everything this plugin added to the host scene. */
  private clear3d() {
    const three = this.sceneHandle ?? this.three;
    const disposeMaterial = (m: unknown): void => {
      if (Array.isArray(m)) {
        for (const one of m) (one as ThreeMaterialLike).dispose?.();
        return;
      }
      (m as ThreeMaterialLike).dispose?.();
    };
    const g = this.group;
    if (g) {
      three?.scene.remove(g);
      g.traverse((obj) => {
        const mesh = obj as unknown as { geometry?: ThreeGeometryLike; material?: unknown };
        if (mesh.geometry) mesh.geometry.dispose?.();
        if (mesh.material) disposeMaterial(mesh.material);
      });
    }
    this.group = null;
    this.loopLine = null;
    this.morphLine = null;
    this.loopPreset = null;
    this.morphPreset = null;
    this.threeKey = '';
    this.sceneHandle = null;
  }

  // ---- 2-D fallback ---------------------------------------------------------------

  /**
   * WebGL container unavailable: paint an orthographic wireframe preview of
   * the surface with the demo loop and morph curve, plus bilingual title/footer
   * notes — the viewport must never render as a black rectangle.
   */
  private draw2d() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    const st = this.state;
    const zh = this.zh;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    // ---- orthographic projection (yaw + pitch) --------------------------------
    const yaw = (35 * Math.PI) / 180;
    const pitch = (18 * Math.PI) / 180;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const extent = this.extent();
    const scale = Math.min(canvas.width, canvas.height) / (extent * 3.1);
    const ox = canvas.width / 2;
    const oy = canvas.height / 2;
    const proj = (x: number, y: number, z: number): [number, number] => {
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y2 = y * cp - z1 * sp;
      return [ox + x1 * scale, oy - y2 * scale];
    };

    // ---- surface wireframe (segments clamped for cheap rAF redraws) -----------
    const segU = Math.min(FALLBACK_MAX_SEGMENTS, Math.max(8, Math.round(st.segments)));
    const segV = Math.max(4, segU >> 1);
    const color = SURFACE_COLORS[st.surface];
    g.lineWidth = 1;
    g.globalAlpha = 0.55;
    g.strokeStyle = hexAlpha(color, 0.85);
    const vLo = st.surface === 'mobius' ? -1 : 0;
    const vHi = st.surface === 'mobius' ? 1 : 2 * Math.PI;
    // Lines of constant v around the revolution (u = 0 … 2π inclusive, so the
    // seam closes geometrically under its own gluing rule).
    for (let j = 0; j <= segV; j += 1) {
      const v = vLo + ((vHi - vLo) * j) / segV;
      g.beginPath();
      for (let i = 0; i <= segU; i += 1) {
        const u = (2 * Math.PI * i) / segU;
        const p = surfacePoint(st.surface, u, v, this.shape());
        const [sx, sy2] = proj(p[0], p[1], p[2]);
        if (i === 0) g.moveTo(sx, sy2);
        else g.lineTo(sx, sy2);
      }
      g.stroke();
    }
    // Lines of constant u around the cross-section.
    for (let i = 0; i <= segU; i += 1) {
      const u = (2 * Math.PI * i) / segU;
      g.beginPath();
      for (let j = 0; j <= segV; j += 1) {
        const v = vLo + ((vHi - vLo) * j) / segV;
        const p = surfacePoint(st.surface, u, v, this.shape());
        const [sx, sy2] = proj(p[0], p[1], p[2]);
        if (j === 0) g.moveTo(sx, sy2);
        else g.lineTo(sx, sy2);
      }
      g.stroke();
    }
    g.globalAlpha = 1;

    // ---- demo loop -------------------------------------------------------------
    const lp = this.currentLoop();
    if (lp) {
      const pts = loopPoints(st.surface, this.shape(), lp.spec, st.deform, LINE_SAMPLES);
      g.lineWidth = 2.4;
      g.strokeStyle = FALLBACK_LOOP_COLOR;
      g.beginPath();
      pts.forEach((p, k) => {
        const [sx, sy2] = proj(p[0], p[1], p[2]);
        if (k === 0) g.moveTo(sx, sy2);
        else g.lineTo(sx, sy2);
      });
      g.stroke();
    }

    // ---- homeomorphism morph curve ----------------------------------------------
    const mp = this.currentMorph();
    if (mp) {
      const s = 0.45 * extent;
      const yBase = -1.15 * extent;
      const pts = morphCurvePoints(mp, st.deform, LINE_SAMPLES);
      g.lineWidth = 2;
      g.strokeStyle = MORPH_COLOR;
      g.beginPath();
      pts.forEach((p, k) => {
        const [sx, sy2] = proj(p[0] * s, yBase, p[1] * s);
        if (k === 0) g.moveTo(sx, sy2);
        else g.lineTo(sx, sy2);
      });
      g.stroke();
    }

    // ---- bilingual title + footer -------------------------------------------------
    const preset = SURFACE_PRESETS.find((p) => p.id === st.surface);
    const ver = verifyGenusChi(st.genus);
    g.textAlign = 'center';
    g.fillStyle = 'rgba(240,244,250,0.94)';
    g.font = `14px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      `拓扑可视化 Topology Visualizer — ${preset ? `${preset.labelZh} / ${preset.labelEn}` : st.surface}`,
      canvas.width / 2,
      20,
    );
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(
      `3D 容器不可用，已回退 2D 线框预览  |  3D container unavailable — 2D wireframe fallback`,
      canvas.width / 2,
      canvas.height / 2,
    );
    g.textAlign = 'left';
    g.fillText(
      `亏格 g=${st.genus}  χ = 2 − 2g = ${ver.expectedChi}（实测 ${ver.counts.chi}）  形变阶段 t=${st.deform.toFixed(2)}  网格 ${segU}×${segV}`,
      14,
      canvas.height - 30,
    );
    g.textAlign = 'right';
    g.fillText(
      `genus g=${st.genus}  χ = 2 − 2g = ${ver.expectedChi} (measured ${ver.counts.chi})  stage t=${st.deform.toFixed(2)}  grid ${segU}×${segV}`,
      canvas.width - 14,
      canvas.height - 14,
    );
    g.textAlign = 'left';
    g.fillText(
      `环路 loop=${lp ? (zh ? lp.labelZh : lp.labelEn) : '—'}   形变 morph=${mp ? (zh ? mp.labelZh : mp.labelEn) : '—'}`,
      14,
      canvas.height - 14,
    );
  }
}

export default function createMathTopologyPlugin(): Plugin {
  return new MathTopologyPlugin();
}
