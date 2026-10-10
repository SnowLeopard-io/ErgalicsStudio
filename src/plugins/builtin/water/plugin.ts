// ==========================================================================
// Water-waves plugin — plugin implementation.
//
// Ripples mode steps the linear wave equation on the GPU (ping-pong FDTD,
// mirror of `physics.ts::waveStepFdtd`) with click-to-drop interaction,
// rain, and double-source interference; shading includes fresnel sky,
// sun specular and curvature-based caustics on the pool floor.
// Ocean mode renders the Gerstner spectrum built by the tested TS kernel
// (`physics.ts::buildSpectrum`, deep-water dispersion ω² = g·k, PM sea
// scaling) with analytic normals and Jacobian foam.
// ==========================================================================

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
import {
  Mesh,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
  type WebGLRenderTarget,
} from 'three';
import { waterManifest } from './manifest';
import * as phys from './physics';
import {
  createWaterSim,
  FLOOR_FRAGMENT,
  FLOOR_VERTEX,
  SURFACE_FRAGMENT,
  SURFACE_VERTEX,
  type WaterSim,
} from './shaders';

// Typed material views so uniform access is compile-checked (ShaderMaterial's
// uniforms index signature would otherwise make every access possibly-undefined).
interface SurfaceMaterial extends ShaderMaterial {
  uniforms: {
    uHeight: { value: WebGLRenderTarget };
    uTexel: { value: Vector2 };
    uMode: { value: number };
    uHScale: { value: number };
    uTime: { value: number };
    uCamPos: { value: Vector3 };
    uSunDir: { value: Vector3 };
    uFoam: { value: number };
    uWavesA: { value: Vector4[] };
    uWavesB: { value: Vector4[] };
    uWaveCount: { value: number };
  };
}

interface FloorMaterial extends ShaderMaterial {
  uniforms: {
    uHeight: { value: WebGLRenderTarget };
    uTexel: { value: Vector2 };
    uDepth: { value: number };
    uCaustics: { value: number };
  };
}

interface State {
  mode: 'ripples' | 'ocean';
  gridN: 128 | 256 | 512;
  cfl: number;
  damping: number;
  absorb: boolean;
  depth: number; // pool depth, m
  hScale: number; // vertical exaggeration
  rain: boolean;
  rainRate: number; // drops per second
  sources: boolean;
  srcLambda: number; // source wavelength, grid cells
  srcSep: number; // source separation, grid cells
  windMs: number;
  choppy: number;
  foam: number;
  sunAzimuth: number; // rad
  seed: number;
}

const POOL = 16; // pool size, metres
const OCEAN_SPAN = 2000; // ocean mesh span, metres
const WAVE_COUNT = 26;
const DEFAULTS: State = {
  mode: 'ripples',
  gridN: 256,
  cfl: 0.5,
  damping: 0.9985,
  absorb: true,
  depth: 0.8,
  hScale: 3,
  rain: false,
  rainRate: 5,
  sources: false,
  srcLambda: 8,
  srcSep: 16,
  windMs: 8,
  choppy: 1,
  foam: 0.35,
  sunAzimuth: 2.3,
  seed: 42,
};

interface PresetPayload {
  mode?: 'ripples' | 'ocean';
  gridN?: number;
  cfl?: number;
  damping?: number;
  absorb?: boolean;
  depth?: number;
  hScale?: number;
  rain?: boolean;
  rainRate?: number;
  sources?: boolean;
  srcLambda?: number;
  srcSep?: number;
  windMs?: number;
  choppy?: number;
  foam?: number;
  sunAzimuth?: number;
  seed?: number;
  initialDrops?: Array<{ xUv: number; yUv: number; radiusUv: number; amp: number }>;
}

export class WaterPlugin implements Plugin {
  readonly manifest = waterManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private sim: WaterSim | null = null;
  private surfaceMat: SurfaceMaterial | null = null;
  private floorMat: FloorMaterial | null = null;
  private rippleMesh: Mesh | null = null;
  private oceanMesh: Mesh | null = null;
  private floorMesh: Mesh | null = null;
  private rafId = 0;
  private lastT = 0;
  private simAcc = 0;
  private oceanTime = 0;
  private pendingDrops: Array<{ x: number; y: number; radius: number; amp: number }> = [];
  private rainRnd: (() => number) | null = null;
  private state: State = { ...DEFAULTS };
  private zh = false;
  private onPointerDown = (e: PointerEvent) => this.pointerDown(e);
  private onPointerUp = (e: PointerEvent) => this.pointerUp(e);
  private downPos: { x: number; y: number } | null = null;
  private raycaster = new Raycaster();

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.publishScience();
    });
  }

  async destroy() {
    this.stopTick();
    this.detachPointer();
    clearScienceOutputs(this.manifest.id);
    this.clear3d();
    this.three?.setVisible(false);
    this.ctx = null;
    this.three = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
    this.buildScene();
  }

  async deactivate() {
    this.stopTick();
    this.detachPointer();
    this.clear3d();
    this.three?.setVisible(false);
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    if (container.three) this.three = container.three;
    this.buildScene();
  }

  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
    this.buildScene();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    if (!file.name.toLowerCase().endsWith('.json')) {
      notify(this.api, 'warning', 'Only .json presets are supported.', '仅支持 .json 预设文件。');
      return;
    }
    try {
      const text = await this.api.readText(file);
      this.applyPreset(JSON.parse(text) as PresetPayload, file.name);
    } catch (err) {
      notify(this.api, 'error', 'Failed to parse the preset JSON.', '预设 JSON 解析失败。');
      this.api.log('error', `[fx.water] loadData: ${String(err)}`);
    }
  }

  private applyPreset(p: PresetPayload, name: string) {
    const s = this.state;
    if (p.mode === 'ripples' || p.mode === 'ocean') s.mode = p.mode;
    if (p.gridN === 128 || p.gridN === 256 || p.gridN === 512) s.gridN = p.gridN;
    if (typeof p.cfl === 'number') s.cfl = Math.min(Math.max(p.cfl, 0.1), phys.CFL_MAX_2D - 0.01);
    if (typeof p.damping === 'number') s.damping = Math.min(Math.max(p.damping, 0.95), 1);
    if (typeof p.absorb === 'boolean') s.absorb = p.absorb;
    if (typeof p.depth === 'number') s.depth = Math.min(Math.max(p.depth, 0.2), 2);
    if (typeof p.hScale === 'number') s.hScale = Math.min(Math.max(p.hScale, 1), 8);
    if (typeof p.rain === 'boolean') s.rain = p.rain;
    if (typeof p.rainRate === 'number') s.rainRate = p.rainRate;
    if (typeof p.sources === 'boolean') s.sources = p.sources;
    if (typeof p.srcLambda === 'number') s.srcLambda = p.srcLambda;
    if (typeof p.srcSep === 'number') s.srcSep = p.srcSep;
    if (typeof p.windMs === 'number') s.windMs = Math.min(Math.max(p.windMs, 2), 24);
    if (typeof p.choppy === 'number') s.choppy = Math.min(Math.max(p.choppy, 0), 1.2);
    if (typeof p.foam === 'number') s.foam = p.foam;
    if (typeof p.sunAzimuth === 'number') s.sunAzimuth = p.sunAzimuth;
    if (typeof p.seed === 'number') s.seed = p.seed;
    this.syncScene(true);
    this.rebuildOceanSpectrum();
    if (s.mode === 'ripples') {
      this.sim?.resize(s.gridN);
      this.sim?.setSources(this.sourcesList());
      if (p.initialDrops) {
        for (const d of p.initialDrops) {
          this.pendingDrops.push({ x: d.xUv, y: d.yUv, radius: d.radiusUv, amp: d.amp });
        }
      }
    } else {
      this.sim?.reset();
    }
    this.publishScience();
    this.refreshParams();
    notify(this.api, 'success', `Preset loaded: ${name}`, `预设已加载：${name}`);
  }

  getParams(): ParamDefinition[] {
    const zh = this.zh;
    const s = this.state;
    const ripples = s.mode === 'ripples';
    const params: ParamDefinition[] = [
      {
        key: 'mode',
        label: 'Mode',
        labelI18n: { 'zh-CN': '模式', 'en-US': 'Mode' },
        type: 'select',
        options: [
          { value: 'ripples', label: zh ? '涟漪池 · 波动方程' : 'Ripple pool · wave equation' },
          { value: 'ocean', label: zh ? '深水海面 · Gerstner' : 'Deep ocean · Gerstner' },
        ],
        value: s.mode,
      },
    ];
    if (ripples) {
      params.push(
        {
          key: 'gridN',
          label: 'Solver grid',
          labelI18n: { 'zh-CN': '求解网格', 'en-US': 'Solver grid' },
          type: 'select',
          options: [
            { value: '128', label: '128²' },
            { value: '256', label: '256²' },
            { value: '512', label: '512²' },
          ],
          value: String(s.gridN),
        },
        {
          key: 'depth',
          label: 'Pool depth (m)',
          labelI18n: { 'zh-CN': '水池深度 (m)', 'en-US': 'Pool depth (m)' },
          type: 'range',
          min: 0.2,
          max: 2,
          step: 0.05,
          value: s.depth,
        },
        {
          key: 'cfl',
          label: 'CFL number (≤ 0.707)',
          labelI18n: { 'zh-CN': 'CFL 数（≤ 0.707）', 'en-US': 'CFL number (≤ 0.707)' },
          type: 'range',
          min: 0.1,
          max: 0.68,
          step: 0.01,
          value: s.cfl,
        },
        {
          key: 'damping',
          label: 'Damping',
          labelI18n: { 'zh-CN': '阻尼', 'en-US': 'Damping' },
          type: 'range',
          min: 0.99,
          max: 1,
          step: 0.0005,
          value: s.damping,
        },
        { key: 'absorb', label: 'Absorbing boundary', labelI18n: { 'zh-CN': '吸收边界（海绵层）', 'en-US': 'Absorbing boundary (sponge)' }, type: 'checkbox', value: s.absorb },
        { key: 'rain', label: 'Rain drops', labelI18n: { 'zh-CN': '雨滴', 'en-US': 'Rain drops' }, type: 'checkbox', value: s.rain },
        {
          key: 'rainRate',
          label: 'Rain intensity (drops/s)',
          labelI18n: { 'zh-CN': '雨强（滴/秒）', 'en-US': 'Rain intensity (drops/s)' },
          type: 'range',
          min: 1,
          max: 20,
          step: 0.5,
          value: s.rainRate,
        },
        { key: 'sources', label: 'Continuous sources ×2', labelI18n: { 'zh-CN': '连续波源 ×2（干涉）', 'en-US': 'Continuous sources ×2 (interference)' }, type: 'checkbox', value: s.sources },
        {
          key: 'srcLambda',
          label: 'Source wavelength (cells)',
          labelI18n: { 'zh-CN': '源波长（格点）', 'en-US': 'Source wavelength (cells)' },
          type: 'range',
          min: 5,
          max: 40,
          step: 0.5,
          value: s.srcLambda,
        },
        {
          key: 'srcSep',
          label: 'Source separation (cells)',
          labelI18n: { 'zh-CN': '波源间距（格点）', 'en-US': 'Source separation (cells)' },
          type: 'range',
          min: 4,
          max: 60,
          step: 1,
          value: s.srcSep,
        },
        {
          key: 'hScale',
          label: 'Vertical exaggeration',
          labelI18n: { 'zh-CN': '垂直夸张系数', 'en-US': 'Vertical exaggeration' },
          type: 'range',
          min: 1,
          max: 8,
          step: 0.5,
          value: s.hScale,
        },
        actionButton('clearWater', 'Clear surface', '清空水面'),
        actionButton('drop', 'Drop (centre)', '滴落一滴（中心）'),
      );
    } else {
      params.push(
        {
          key: 'windMs',
          label: 'Wind speed (m/s)',
          labelI18n: { 'zh-CN': '风速 (m/s)', 'en-US': 'Wind speed (m/s)' },
          type: 'range',
          min: 2,
          max: 24,
          step: 0.5,
          value: s.windMs,
        },
        {
          key: 'choppy',
          label: 'Choppiness Q',
          labelI18n: { 'zh-CN': '卷曲度 Q', 'en-US': 'Choppiness Q' },
          type: 'range',
          min: 0,
          max: 1.2,
          step: 0.05,
          value: s.choppy,
        },
        {
          key: 'foam',
          label: 'Foam threshold (Jacobian)',
          labelI18n: { 'zh-CN': '白沫阈值（雅可比）', 'en-US': 'Foam threshold (Jacobian)' },
          type: 'range',
          min: 0,
          max: 0.9,
          step: 0.05,
          value: s.foam,
        },
        {
          key: 'sunAzimuth',
          label: 'Sun azimuth (rad)',
          labelI18n: { 'zh-CN': '太阳方位角 (rad)', 'en-US': 'Sun azimuth (rad)' },
          type: 'range',
          min: 0,
          max: 6.28,
          step: 0.05,
          value: s.sunAzimuth,
        },
        {
          key: 'seed',
          label: 'Spectrum seed',
          labelI18n: { 'zh-CN': '频谱种子', 'en-US': 'Spectrum seed' },
          type: 'number',
          min: 0,
          max: 9999,
          step: 1,
          value: s.seed,
        },
      );
    }
    params.push(actionButton('resetView', 'Reset view', '复位视角'), actionButton('resetParams', 'Reset parameters', '恢复默认参数'));
    return params;
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    let structural = false; // needs mesh/spectrum rebuild
    if (params.mode === 'ripples' || params.mode === 'ocean') {
      if (params.mode !== s.mode) {
        s.mode = params.mode;
        structural = true;
      }
    }
    if (params.gridN === '128' || params.gridN === '256' || params.gridN === '512') {
      const n = Number(params.gridN) as State['gridN'];
      if (n !== s.gridN) { s.gridN = n; structural = true; }
    }
    if (typeof params.depth === 'number') { s.depth = params.depth; structural = true; } // floor height + science
    if (typeof params.cfl === 'number') s.cfl = params.cfl;
    if (typeof params.damping === 'number') s.damping = params.damping;
    if (typeof params.absorb === 'boolean') s.absorb = params.absorb;
    if (typeof params.hScale === 'number') s.hScale = params.hScale;
    if (typeof params.rain === 'boolean') s.rain = params.rain;
    if (typeof params.rainRate === 'number') s.rainRate = params.rainRate;
    if (typeof params.sources === 'boolean') s.sources = params.sources;
    if (typeof params.srcLambda === 'number') s.srcLambda = params.srcLambda;
    if (typeof params.srcSep === 'number') s.srcSep = params.srcSep;
    if (typeof params.windMs === 'number' && params.windMs !== s.windMs) { s.windMs = params.windMs; structural = true; }
    if (typeof params.choppy === 'number' && params.choppy !== s.choppy) { s.choppy = params.choppy; structural = true; }
    if (typeof params.foam === 'number') s.foam = params.foam;
    if (typeof params.sunAzimuth === 'number') s.sunAzimuth = params.sunAzimuth;
    if (typeof params.seed === 'number' && params.seed !== s.seed) { s.seed = params.seed; structural = true; }

    if (actionFired(params, 'clearWater')) { this.sim?.reset(); return; }
    if (actionFired(params, 'drop')) { this.addDrop(0.5, 0.5, 2.5 / s.gridN, 0.35); return; }
    if (actionFired(params, 'resetView')) { this.fitCamera(); return; }
    if (actionFired(params, 'resetParams')) {
      this.state = { ...DEFAULTS };
      structural = true;
      this.refreshParams();
    }
    this.syncScene(structural);
    if (structural && s.mode === 'ocean') this.rebuildOceanSpectrum();
    if (structural) this.fitCamera();
    this.publishScience();
  }

  // ---- scene ----------------------------------------------------------------

  private buildScene() {
    const three = this.three;
    if (!three) {
      this.draw2dFallback();
      return;
    }
    if (!this.sim) {
      this.sim = createWaterSim(three.renderer, this.state.gridN);
      this.buildMaterials();
      this.buildMeshes();
      this.attachPointer();
      this.syncScene(true);
      this.rebuildOceanSpectrum();
      this.fitCamera();
    }
    this.publishScience();
    three.setVisible(true);
    three.render();
    this.startTick();
  }

  private buildMaterials() {
    const three = this.three;
    if (!three || !this.sim) return;
    this.surfaceMat = new ShaderMaterial({
      vertexShader: SURFACE_VERTEX,
      fragmentShader: SURFACE_FRAGMENT,
      uniforms: {
        uHeight: { value: this.sim.texture() as WebGLRenderTarget },
        uTexel: { value: new Vector2(1 / this.state.gridN, 1 / this.state.gridN) },
        uMode: { value: this.state.mode === 'ocean' ? 1 : 0 },
        uHScale: { value: this.state.hScale },
        uTime: { value: 0 },
        uCamPos: { value: new Vector3() },
        uSunDir: { value: new Vector3() },
        uFoam: { value: this.state.foam },
        uWavesA: { value: Array.from({ length: WAVE_COUNT }, () => new Vector4()) },
        uWavesB: { value: Array.from({ length: WAVE_COUNT }, () => new Vector4()) },
        uWaveCount: { value: 0 },
      },
    }) as SurfaceMaterial;
    this.floorMat = new ShaderMaterial({
      vertexShader: FLOOR_VERTEX,
      fragmentShader: FLOOR_FRAGMENT,
      uniforms: {
        uHeight: { value: this.sim.texture() as WebGLRenderTarget },
        uTexel: { value: new Vector2(1 / this.state.gridN, 1 / this.state.gridN) },
        uDepth: { value: this.state.depth },
        uCaustics: { value: 1 },
      },
    }) as FloorMaterial;
  }

  private buildMeshes() {
    const three = this.three;
    if (!three || !this.surfaceMat || !this.floorMat) return;
    const rippleGeo = new PlaneGeometry(POOL, POOL, this.state.gridN - 1, this.state.gridN - 1);
    rippleGeo.rotateX(-Math.PI / 2);
    this.rippleMesh = new Mesh(rippleGeo, this.surfaceMat);

    const oceanGeo = new PlaneGeometry(OCEAN_SPAN, OCEAN_SPAN, 256, 256);
    oceanGeo.rotateX(-Math.PI / 2);
    this.oceanMesh = new Mesh(oceanGeo, this.surfaceMat);

    const floorGeo = new PlaneGeometry(POOL, POOL);
    floorGeo.rotateX(-Math.PI / 2);
    this.floorMesh = new Mesh(floorGeo, this.floorMat);

    three.scene.add(this.rippleMesh);
    three.scene.add(this.oceanMesh);
    three.scene.add(this.floorMesh);
  }

  /** Push current state into uniforms/visibility; `rebuild` re-creates meshes. */
  private syncScene(rebuild: boolean) {
    const three = this.three;
    const s = this.state;
    if (!three) return;
    if (rebuild && this.sim) {
      if (this.sim.size !== s.gridN) this.sim.resize(s.gridN);
      // Re-create the ripple mesh so vertices match the texel grid.
      if (this.rippleMesh) {
        three.scene.remove(this.rippleMesh);
        this.rippleMesh.geometry.dispose();
      }
      const rippleGeo = new PlaneGeometry(POOL, POOL, s.gridN - 1, s.gridN - 1);
      rippleGeo.rotateX(-Math.PI / 2);
      if (this.surfaceMat) {
        this.rippleMesh = new Mesh(rippleGeo, this.surfaceMat);
        three.scene.add(this.rippleMesh);
      } else {
        rippleGeo.dispose();
      }
    }
    if (!this.surfaceMat || !this.floorMat || !this.rippleMesh || !this.oceanMesh || !this.floorMesh) return;
    const ripples = s.mode === 'ripples';
    this.surfaceMat.uniforms.uMode.value = ripples ? 0 : 1;
    this.surfaceMat.uniforms.uHScale.value = s.hScale;
    this.surfaceMat.uniforms.uFoam.value = s.foam;
    this.surfaceMat.uniforms.uTexel.value.set(1 / s.gridN, 1 / s.gridN);
    if (this.sim) this.surfaceMat.uniforms.uHeight.value = this.sim.texture();
    this.floorMat.uniforms.uDepth.value = s.depth;
    if (this.sim) this.floorMat.uniforms.uHeight.value = this.sim.texture();
    this.floorMat.uniforms.uTexel.value.set(1 / s.gridN, 1 / s.gridN);
    this.floorMesh.position.y = -s.depth;
    this.rippleMesh.visible = ripples;
    this.floorMesh.visible = ripples;
    this.oceanMesh.visible = !ripples;
    if (this.sim) this.sim.setAbsorb(s.absorb);
    if (this.sim) this.sim.setDamping(s.damping);
    if (this.sim && ripples) this.sim.setSources(this.sourcesList());
  }

  /** Gerstner spectrum → shader uniform arrays (same values as the TS kernel). */
  private rebuildOceanSpectrum() {
    const mat = this.surfaceMat;
    if (!mat) return;
    const s = this.state;
    const waves = phys.buildSpectrum(s.windMs, WAVE_COUNT, s.seed, s.choppy);
    const a = mat.uniforms.uWavesA.value as Vector4[];
    const b = mat.uniforms.uWavesB.value as Vector4[];
    for (let i = 0; i < WAVE_COUNT; i++) {
      const w = waves[i] ?? waves[waves.length - 1]!;
      a[i]!.set(w.k, w.omega, w.amplitude, w.q);
      b[i]!.set(w.dirX, w.dirZ, w.phase, 0);
    }
    mat.uniforms.uWaveCount.value = waves.length;
  }

  private sourcesList(): Array<{ x: number; y: number; omega: number; amp: number }> {
    const s = this.state;
    if (!s.sources) return [];
    // ω from the target wavelength via the discrete stencil dispersion.
    const omega = phys.fdtdOmega((2 * Math.PI) / s.srcLambda, s.cfl);
    const half = s.srcSep / 2 / s.gridN;
    return [
      { x: 0.5 - half, y: 0.5, omega, amp: 0.12 },
      { x: 0.5 + half, y: 0.5, omega, amp: 0.12 },
    ];
  }

  private fitCamera() {
    const three = this.three;
    if (!three) return;
    const cam: PerspectiveCamera = three.camera;
    if (this.state.mode === 'ocean') {
      cam.position.set(0, 42, 170);
      three.controls.target.set(0, 0, -60);
    } else {
      cam.position.set(0, 9, 11);
      three.controls.target.set(0, 0, 0);
    }
    cam.near = 0.1;
    cam.far = 6000;
    cam.updateProjectionMatrix();
    three.controls.update?.();
    three.render();
  }

  // ---- interaction ----------------------------------------------------------

  private attachPointer() {
    const el = this.three?.renderer.domElement;
    if (!el) return;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('pointerup', this.onPointerUp);
  }

  private detachPointer() {
    const el = this.three?.renderer.domElement;
    if (!el) return;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointerup', this.onPointerUp);
  }

  private pointerDown(e: PointerEvent) {
    this.downPos = { x: e.clientX, y: e.clientY };
  }

  private pointerUp(e: PointerEvent) {
    const down = this.downPos;
    this.downPos = null;
    const three = this.three;
    if (!down || !three || this.state.mode !== 'ripples') return;
    // Click (not orbit drag) → drop a gaussian impulse at the surface point.
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved > 6) return;
    const rect = three.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, three.camera);
    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-6) return;
    const t = -ray.origin.y / ray.direction.y;
    if (t <= 0) return;
    const hit = ray.origin.clone().addScaledVector(ray.direction, t);
    const uv = new Vector2(hit.x / POOL + 0.5, 0.5 - hit.z / POOL);
    if (uv.x < 0.02 || uv.x > 0.98 || uv.y < 0.02 || uv.y > 0.98) return;
    this.addDrop(uv.x, uv.y, 2.5 / this.state.gridN, 0.35);
  }

  private addDrop(xUv: number, yUv: number, radiusUv: number, amp: number) {
    if (this.pendingDrops.length >= 8) this.pendingDrops.shift();
    this.pendingDrops.push({ x: xUv, y: yUv, radius: radiusUv, amp });
  }

  // ---- render loop ------------------------------------------------------------

  private startTick() {
    if (this.rafId) return;
    this.lastT = 0;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopTick() {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.lastT = 0;
  }

  private tick = (t: number) => {
    this.rafId = 0;
    const three = this.three;
    if (!three || !this.sim || !this.surfaceMat || !this.floorMat) return;
    const frameDt = this.lastT ? Math.min((t - this.lastT) / 1000, 0.05) : 0;
    this.lastT = t;
    const s = this.state;

    if (s.mode === 'ripples') {
      // Fixed-dt stepping: real seconds → sim steps at c·dt/dx = CFL.
      const dx = POOL / s.gridN;
      const c = phys.shallowWaterSpeed(s.depth);
      const dtSim = (s.cfl * dx) / c;
      this.simAcc += frameDt;
      let n = Math.floor(this.simAcc / dtSim);
      this.simAcc = Math.min(this.simAcc - n * dtSim, dtSim * 2);
      n = Math.min(n, 8);
      if (s.rain && this.rainRnd === null) this.rainRnd = phys.mulberry32(s.seed ^ 0x9e3779b9);
      if (s.rain && this.rainRnd) {
        const expected = s.rainRate * frameDt;
        let count = Math.floor(expected);
        if (this.rainRnd() < expected - count) count++;
        for (let i = 0; i < count && i < 8; i++) {
          this.addDrop(0.08 + this.rainRnd() * 0.84, 0.08 + this.rainRnd() * 0.84, 2 / s.gridN, 0.18 + this.rainRnd() * 0.2);
        }
      }
      for (let i = 0; i < Math.max(n, 1); i++) {
        this.sim.step(i === 0 ? this.pendingDrops : []);
      }
      this.pendingDrops = [];
      this.surfaceMat.uniforms.uHeight.value = this.sim.texture();
      this.floorMat.uniforms.uHeight.value = this.sim.texture();
      this.floorMat.uniforms.uTexel.value.set(1 / s.gridN, 1 / s.gridN);
      this.surfaceMat.uniforms.uTexel.value.set(1 / s.gridN, 1 / s.gridN);
    } else {
      this.oceanTime += frameDt;
    }

    this.surfaceMat.uniforms.uTime.value = s.mode === 'ocean' ? this.oceanTime : 0;
    (this.surfaceMat.uniforms.uCamPos.value as Vector3).copy(three.camera.position);
    const az = s.sunAzimuth;
    (this.surfaceMat.uniforms.uSunDir.value as Vector3).set(Math.cos(az), 0.58, Math.sin(az)).normalize();

    three.controls.update?.();
    three.render();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private clear3d() {
    const three = this.three;
    this.sim?.dispose();
    this.sim = null;
    if (three) {
      for (const m of [this.rippleMesh, this.oceanMesh, this.floorMesh]) {
        if (m) three.scene.remove(m);
      }
    }
    for (const m of [this.rippleMesh, this.oceanMesh, this.floorMesh]) m?.geometry.dispose();
    this.rippleMesh = null;
    this.oceanMesh = null;
    this.floorMesh = null;
    this.surfaceMat?.dispose();
    this.floorMat?.dispose();
    this.surfaceMat = null;
    this.floorMat = null;
  }

  // ---- science outputs --------------------------------------------------------

  private publishScience() {
    const s = this.state;
    const metrics: ScienceMetric[] = [];
    if (s.mode === 'ripples') {
      const dx = POOL / s.gridN;
      const c = phys.shallowWaterSpeed(s.depth);
      const dtMs = ((s.cfl * dx) / c) * 1000;
      metrics.push(
        { key: 'grid', label: 'Grid', value: `${s.gridN}²`, unit: 'cells', severity: 'info' },
        { key: 'c', label: 'c = √(g·h)', value: fmtMetric(c), unit: 'm/s', severity: 'info', hint: this.zh ? '浅水波速：c = √(g·h)，水深 h。' : 'Shallow-water speed c = √(g·h).' },
        { key: 'cfl', label: 'CFL', value: s.cfl.toFixed(2), unit: `/ ${phys.CFL_MAX_2D.toFixed(3)}`, severity: s.cfl <= phys.CFL_MAX_2D ? 'ok' : 'error', hint: this.zh ? '显式格式稳定性条件 c·dt/dx ≤ 1/√2（2D）。' : 'Explicit-scheme stability: c·dt/dx ≤ 1/√2 in 2-D.' },
        { key: 'dt', label: 'Δt', value: fmtMetric(dtMs), unit: 'ms', severity: 'info' },
      );
      if (s.sources) {
        const lambdaM = s.srcLambda * dx;
        const sepM = s.srcSep * dx;
        const sinTheta1 = Math.min(lambdaM / (2 * sepM), 1);
        metrics.push(
          { key: 'lambda', label: 'λ_src', value: fmtMetric(lambdaM), unit: 'm', severity: 'info', hint: this.zh ? '由离散色散关系 ω=2asin(A·sin(kΔx/2))/Δt 反解。' : 'Inverted from the discrete dispersion ω = 2·asin(A·sin(kΔx/2))/Δt.' },
          { key: 'nodal', label: 'θ₁ nodal', value: `${((Math.asin(sinTheta1) * 180) / Math.PI).toFixed(1)}`, unit: '°', severity: 'info', hint: this.zh ? '双源干涉第一条节线角：sinθ₁ = λ/(2d)。' : 'First nodal line of the two-source pattern: sinθ₁ = λ/(2d).' },
        );
      }
    } else {
      const sea = phys.piersonMoskowitzPeak(s.windMs);
      const waves = phys.buildSpectrum(s.windMs, WAVE_COUNT, s.seed, s.choppy);
      const steep = Math.max(...waves.map(phys.gerstnerSteepness));
      metrics.push(
        { key: 'hs', label: 'H_s', value: fmtMetric(sea.hs), unit: 'm', severity: 'info', hint: this.zh ? 'Pierson–Moskowitz 充分成长海况有效波高 H_s ≈ 0.21·U²/g。' : 'Pierson–Moskowitz significant wave height H_s ≈ 0.21·U²/g.' },
        { key: 'lp', label: 'λ_p', value: fmtMetric(sea.lambdaP), unit: 'm', severity: 'info' },
        { key: 'tp', label: 'T_p', value: fmtMetric(sea.periodP), unit: 's', severity: 'info' },
        { key: 'cp', label: 'c_p', value: fmtMetric(sea.cpP), unit: 'm/s', severity: 'info', hint: this.zh ? '深水相速度 c_p = g/ω_p；群速度为其一半。' : 'Deep-water phase speed c_p = g/ω_p; group velocity is one half.' },
        { key: 'cg', label: 'c_g', value: fmtMetric(sea.cgP), unit: 'm/s', severity: 'info' },
        { key: 'steep', label: 'max k·A·q', value: steep.toFixed(3), unit: '', severity: steep <= 1 ? 'ok' : 'warn', hint: this.zh ? 'Gerstner 陡度约束 k·A·q ≤ 1（波峰不自交）。' : 'Gerstner steepness bound k·A·q ≤ 1 (no self-intersecting crests).' },
      );
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  private refreshParams() {
    emit('host:params:changed', { pluginId: this.manifest.id });
  }

  private draw2dFallback() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    canvas.width = Math.min(canvas.width || 480, 480);
    canvas.height = canvas.height || 300;
    g.fillStyle = '#05070c';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.textAlign = 'center';
    g.font = `14px ${this.zh ? '"Microsoft YaHei"' : 'Consolas'}, monospace`;
    g.fillText(
      this.zh ? 'WebGL 3D 容器不可用，无法渲染水波流体。' : 'WebGL 3D container unavailable — fluid rendering disabled.',
      canvas.width / 2,
      canvas.height / 2,
    );
  }
}

export default function createWaterPlugin(): Plugin {
  return new WaterPlugin();
}
