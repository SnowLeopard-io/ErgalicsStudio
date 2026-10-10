// ==========================================================================
// Black-hole plugin — plugin implementation.
//
// Hosts the fullscreen geodesic ray tracer inside the shared Three.js scene
// (Scene3DHandle). All physics live in `physics.ts` (pure TS, unit-tested);
// all rendering lives in `shader.ts` (GLSL). Loads JSON scene presets via
// loadData (wired to the top-bar 示例 dialog).
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
import type { Mesh as ThreeMesh, PerspectiveCamera } from 'three';
import { blackholeManifest } from './manifest';
import * as phys from './physics';
import { createBlackholeQuad, type BlackholeMaterial } from './shader';

interface State {
  massLog10: number; // log10(M / M☉)
  distLog10: number; // log10(D / pc), for the shadow-angle comparison
  diskOut: number; // outer disk radius in r_s
  tPeakLog: number; // log10(T_peak / K)
  bright: number;
  beaming: boolean;
  redshift: boolean;
  stars: number;
  turb: number;
  quality: 'low' | 'medium' | 'high' | 'ultra';
  running: boolean;
}

const DEFAULTS: State = {
  massLog10: 9.81, // M87* ≈ 6.5×10⁹ M☉
  distLog10: 7.23, // ≈ 16.8 Mpc
  diskOut: 16,
  tPeakLog: 3.81, // ≈ 6500 K — renders the classic orange-white disk
  bright: 1,
  beaming: true,
  redshift: true,
  stars: 1,
  turb: 0.55,
  quality: 'high',
  running: true,
};

const STEPS_BY_QUALITY: Record<State['quality'], number> = { low: 110, medium: 180, high: 280, ultra: 420 };

interface PresetPayload {
  massSolar?: number;
  distancePc?: number;
  diskOuterRs?: number;
  tPeakK?: number;
  brightness?: number;
  beaming?: boolean;
  redshift?: boolean;
  starDensity?: number;
  turbulence?: number;
  cameraDistanceRs?: number;
}

export class BlackholePlugin implements Plugin {
  readonly manifest = blackholeManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private mesh: ThreeMesh | null = null;
  private material: BlackholeMaterial | null = null;
  private rafId = 0;
  private lastT = 0;
  private simTime = 0;
  private state: State = { ...DEFAULTS };
  private zh = false;

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
      notify(this.api, 'warning', 'Only .json scene presets are supported.', '仅支持 .json 场景预设。');
      return;
    }
    try {
      const text = await this.api.readText(file);
      this.applyPreset(JSON.parse(text) as PresetPayload, file.name);
    } catch (err) {
      notify(this.api, 'error', 'Failed to parse the preset JSON.', '预设 JSON 解析失败。');
      this.api.log('error', `[fx.blackhole] loadData: ${String(err)}`);
    }
  }

  private applyPreset(p: PresetPayload, name: string) {
    const s = this.state;
    if (typeof p.massSolar === 'number' && p.massSolar > 0) s.massLog10 = Math.log10(p.massSolar);
    if (typeof p.distancePc === 'number' && p.distancePc > 0) s.distLog10 = Math.log10(p.distancePc);
    if (typeof p.diskOuterRs === 'number') s.diskOut = Math.min(Math.max(p.diskOuterRs, 6), 30);
    if (typeof p.tPeakK === 'number' && p.tPeakK > 0) s.tPeakLog = Math.log10(p.tPeakK);
    if (typeof p.brightness === 'number') s.bright = p.brightness;
    if (typeof p.beaming === 'boolean') s.beaming = p.beaming;
    if (typeof p.redshift === 'boolean') s.redshift = p.redshift;
    if (typeof p.starDensity === 'number') s.stars = p.starDensity;
    if (typeof p.turbulence === 'number') s.turb = p.turbulence;
    this.syncUniforms();
    this.publishScience();
    this.refreshParams();
    if (typeof p.cameraDistanceRs === 'number') this.fitCamera(p.cameraDistanceRs);
    notify(
      this.api,
      'success',
      `Preset loaded: ${name} (M = ${phys.schwarzschildRadiusKm(10 ** s.massLog10).toExponential(2)} km r_s)`,
      `预设已加载：${name}（r_s = ${phys.schwarzschildRadiusKm(10 ** s.massLog10).toExponential(2)} km）`,
    );
  }

  getParams(): ParamDefinition[] {
    const zh = this.zh;
    return [
      {
        key: 'massLog10',
        label: 'Mass log₁₀(M/M☉)',
        labelI18n: { 'zh-CN': '质量 log₁₀(M/M☉)', 'en-US': 'Mass log₁₀(M/M☉)' },
        type: 'range',
        min: 0,
        max: 10,
        step: 0.01,
        value: this.state.massLog10,
      },
      {
        key: 'distLog10',
        label: 'Distance log₁₀(D/pc)',
        labelI18n: { 'zh-CN': '距离 log₁₀(D/pc)', 'en-US': 'Distance log₁₀(D/pc)' },
        type: 'range',
        min: 0,
        max: 9,
        step: 0.01,
        value: this.state.distLog10,
      },
      {
        key: 'diskOut',
        label: 'Disk outer radius (r_s)',
        labelI18n: { 'zh-CN': '吸积盘外半径 (r_s)', 'en-US': 'Disk outer radius (r_s)' },
        type: 'range',
        min: 6,
        max: 30,
        step: 0.5,
        value: this.state.diskOut,
      },
      {
        key: 'tPeakLog',
        label: 'Disk temp log₁₀(T/K)',
        labelI18n: { 'zh-CN': '盘温度 log₁₀(T/K)', 'en-US': 'Disk temp log₁₀(T/K)' },
        type: 'range',
        min: 3.3,
        max: 5.5,
        step: 0.01,
        value: this.state.tPeakLog,
      },
      {
        key: 'bright',
        label: 'Brightness',
        labelI18n: { 'zh-CN': '亮度', 'en-US': 'Brightness' },
        type: 'range',
        min: 0.2,
        max: 3,
        step: 0.05,
        value: this.state.bright,
      },
      {
        key: 'stars',
        label: 'Star density',
        labelI18n: { 'zh-CN': '星空密度', 'en-US': 'Star density' },
        type: 'range',
        min: 0,
        max: 2,
        step: 0.05,
        value: this.state.stars,
      },
      {
        key: 'turb',
        label: 'Disk turbulence',
        labelI18n: { 'zh-CN': '盘面湍流', 'en-US': 'Disk turbulence' },
        type: 'range',
        min: 0,
        max: 1,
        step: 0.05,
        value: this.state.turb,
      },
      {
        key: 'quality',
        label: 'Ray quality (steps)',
        labelI18n: { 'zh-CN': '光线质量（积分步数）', 'en-US': 'Ray quality (steps)' },
        type: 'select',
        options: [
          { value: 'low', label: zh ? '低 · 110 步' : 'Low · 110' },
          { value: 'medium', label: zh ? '中 · 180 步' : 'Medium · 180' },
          { value: 'high', label: zh ? '高 · 280 步' : 'High · 280' },
          { value: 'ultra', label: zh ? '极高 · 420 步' : 'Ultra · 420' },
        ],
        value: this.state.quality,
      },
      { key: 'beaming', label: 'Doppler beaming', labelI18n: { 'zh-CN': '相对论多普勒集束', 'en-US': 'Doppler beaming' }, type: 'checkbox', value: this.state.beaming },
      { key: 'redshift', label: 'Gravitational redshift', labelI18n: { 'zh-CN': '引力红移', 'en-US': 'Gravitational redshift' }, type: 'checkbox', value: this.state.redshift },
      {
        key: 'running',
        label: 'Animate disk',
        labelI18n: { 'zh-CN': '盘面旋转', 'en-US': 'Animate disk' },
        type: 'toggle',
        value: this.state.running,
        offLabel: zh ? '暂停' : 'Pause',
        onLabel: zh ? '旋转中' : 'Running',
      },
      actionButton('resetView', 'Reset view', '复位视角'),
      actionButton('resetParams', 'Reset parameters', '恢复默认参数'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    let changed = false;
    if (typeof params.massLog10 === 'number') { s.massLog10 = params.massLog10; changed = true; }
    if (typeof params.distLog10 === 'number') { s.distLog10 = params.distLog10; changed = true; }
    if (typeof params.diskOut === 'number') { s.diskOut = params.diskOut; changed = true; }
    if (typeof params.tPeakLog === 'number') { s.tPeakLog = params.tPeakLog; changed = true; }
    if (typeof params.bright === 'number') { s.bright = params.bright; changed = true; }
    if (typeof params.stars === 'number') { s.stars = params.stars; changed = true; }
    if (typeof params.turb === 'number') { s.turb = params.turb; changed = true; }
    if (params.quality === 'low' || params.quality === 'medium' || params.quality === 'high' || params.quality === 'ultra') {
      if (params.quality !== s.quality) { s.quality = params.quality; changed = true; }
    }
    if (typeof params.beaming === 'boolean') { s.beaming = params.beaming; changed = true; }
    if (typeof params.redshift === 'boolean') { s.redshift = params.redshift; changed = true; }
    if (typeof params.running === 'boolean') { s.running = params.running; changed = true; }
    if (actionFired(params, 'resetView')) { this.fitCamera(16); return; }
    if (actionFired(params, 'resetParams')) {
      this.state = { ...DEFAULTS };
      this.syncUniforms();
      this.publishScience();
      this.fitCamera(16);
      this.refreshParams();
      return;
    }
    if (changed) {
      this.syncUniforms();
      this.publishScience();
    }
  }

  // ---- scene wiring ---------------------------------------------------------

  private buildScene() {
    const three = this.three;
    if (!three) {
      this.draw2dFallback();
      return;
    }
    if (!this.mesh) {
      const { mesh, material } = createBlackholeQuad();
      this.mesh = mesh;
      this.material = material;
      three.scene.add(mesh);
      this.fitCamera(16);
    }
    this.syncUniforms();
    this.publishScience();
    three.setVisible(true);
    three.render();
    this.startTick();
  }

  private fitCamera(distRs: number) {
    const three = this.three;
    if (!three) return;
    const cam: PerspectiveCamera = three.camera;
    cam.position.set(0, distRs * 0.28, distRs);
    cam.near = 0.01;
    cam.far = 1e5;
    cam.updateProjectionMatrix();
    three.controls.target.set(0, 0, 0);
    three.controls.update?.();
    three.render();
  }

  private syncUniforms() {
    const m = this.material;
    if (!m) return;
    const s = this.state;
    m.uniforms.uDiskIn.value = phys.ISCO_RS;
    m.uniforms.uDiskOut.value = s.diskOut;
    m.uniforms.uTpeak.value = 10 ** s.tPeakLog;
    m.uniforms.uBright.value = s.bright;
    m.uniforms.uBeaming.value = s.beaming ? 1 : 0;
    m.uniforms.uRedshift.value = s.redshift ? 1 : 0;
    m.uniforms.uStars.value = s.stars;
    m.uniforms.uTurb.value = s.turb;
    m.uniforms.uSteps.value = STEPS_BY_QUALITY[s.quality];
  }

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
    const mat = this.material;
    if (!three || !this.mesh || !mat) return;
    const dt = this.lastT ? Math.min((t - this.lastT) / 1000, 0.1) : 0;
    this.lastT = t;
    if (this.state.running) this.simTime += dt;
    mat.uniforms.uTime.value = this.simTime;
    mat.uniforms.uCamWorld.value.copy(three.camera.matrixWorld);
    mat.uniforms.uProjInv.value.copy(three.camera.projectionMatrixInverse);
    three.controls.update?.();
    three.render();
    this.rafId = requestAnimationFrame(this.tick);
  };

  private clear3d() {
    const three = this.three;
    if (three && this.mesh) {
      three.scene.remove(this.mesh);
    }
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.mesh = null;
    this.material = null;
  }

  // ---- science outputs --------------------------------------------------------

  private publishScience() {
    const s = this.state;
    const mass = 10 ** s.massLog10;
    const rs = phys.schwarzschildRadiusKm(mass);
    const dMeters = 10 ** s.distLog10 * 3.0857e16; // pc → m
    const shadowRad = phys.shadowAngularDiameterRad(mass, dMeters);
    const shadowUas = shadowRad * 206264.806 * 1e6; // rad → μas
    const gEdge =
      phys.dopplerFactor(phys.orbitalBeta(phys.ISCO_RS), 0.98) * (s.redshift ? phys.gravRedshift(phys.ISCO_RS) : 1);
    const metrics: ScienceMetric[] = [
      { key: 'rs', label: 'r_s', value: fmtMetric(rs), unit: 'km', severity: 'info', hint: this.zh ? '史瓦西半径 2GM/c²。' : 'Schwarzschild radius 2GM/c².' },
      { key: 'risco', label: 'r_ISCO', value: fmtMetric(phys.ISCO_RS * rs), unit: 'km', severity: 'info', hint: this.zh ? '最内稳定圆轨道 = 3 r_s（盘内缘）。' : 'Innermost stable circular orbit = 3 r_s (disk inner edge).' },
      { key: 'rph', label: 'r_ph', value: fmtMetric(phys.PHOTON_SPHERE_RS * rs), unit: 'km', severity: 'info', hint: this.zh ? '光子球 1.5 r_s，光子环由此产生。' : 'Photon sphere 1.5 r_s — source of the photon ring.' },
      { key: 'bc', label: 'b_crit', value: fmtMetric(phys.CRITICAL_B_RS * rs), unit: 'km', severity: 'info', hint: this.zh ? '临界瞄准距 3√3/2·r_s：阴影边界。' : 'Critical impact parameter 3√3/2·r_s: the shadow edge.' },
      { key: 'shadow', label: 'θ_shadow', value: fmtMetric(shadowUas), unit: 'μas', severity: 'info', hint: this.zh ? '静态观测者的阴影角直径（含 √(1−r_s/D) 修正）。' : 'Shadow angular diameter for a static observer (√(1−r_s/D) included).' },
      { key: 'beta_isco', label: 'β(ISCO)', value: phys.orbitalBeta(phys.ISCO_RS).toFixed(3), unit: 'c', severity: 'info', hint: this.zh ? 'ISCO 处圆轨道速度（局部静止观者测量）。' : 'Circular-orbit speed at the ISCO (local static frame).' },
      { key: 'tpeak', label: 'T_peak', value: fmtMetric(10 ** s.tPeakLog), unit: 'K', severity: 'info', hint: this.zh ? 'Shakura–Sunyaev 盘峰值温度（位于 49/36·r_in）。' : 'Shakura–Sunyaev peak temperature (at 49/36·r_in).' },
      { key: 'g_edge', label: 'g_max', value: gEdge.toFixed(2), unit: '×', severity: 'info', hint: this.zh ? '盘迎向观测者一侧的最大频移因子；I ∝ g⁴。' : 'Max shift factor on the approaching side; I ∝ g⁴.' },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private refreshParams() {
    emit('host:params:changed', { pluginId: this.manifest.id });
  }

  /** No WebGL container — paint an informational card on canvas2d. */
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
      this.zh ? 'WebGL 3D 容器不可用，无法渲染黑洞光线追踪。' : 'WebGL 3D container unavailable — ray tracing disabled.',
      canvas.width / 2,
      canvas.height / 2,
    );
  }
}

export default function createBlackholePlugin(): Plugin {
  return new BlackholePlugin();
}
