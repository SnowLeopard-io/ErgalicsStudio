// ==========================================================================
// fx.misty — layered misty-peaks plugin: state, ephemeris glue, the shared
// SkyLoop and the science panel.
//
// The GPU renderer lives in shader.ts. The scene is static unless the day
// cycle or auto-orbit runs, so the loop parks itself while idle; the science
// strip reports solar geometry, the ridge range distances and visibility.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi, Scene3DHandle } from '@/types/plugin';
import { emit } from '@/core/events';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import {
  airmassKastenYoung,
  gmst,
  hazeToExtinction,
  julianDay,
  koschmiederVisibility,
  SkyLoop,
  sunDiskTint,
  sunPosition,
  twilightClass,
  type TwilightClass,
} from '@/core/raytrace';
import { createMistyQuadMesh, type MistyMaterial } from './shader';
import { mistyManifest } from './manifest';

// Layer geometry shared with the shader (keep in sync with LAYER_NEAR/GROW).
const LAYER_NEAR = 2500;
const LAYER_GROW = 1.85;
const LAYER_COUNT = 6;

/** Distance (m) of each ridge layer from the viewer. */
export function layerDistances(): number[] {
  const out: number[] = [];
  let d = LAYER_NEAR;
  for (let i = 0; i < LAYER_COUNT; i++) {
    out.push(d);
    d *= LAYER_GROW;
  }
  return out;
}

interface State {
  hourUTC: number;
  latitude: number;
  longitude: number;
  ridgeScale: number;
  ridgeHeight: number;
  mistDensity: number;
  mistHeight: number;
  haze: number;
  exposure: number;
  colorTemp: number; // white balance: 0 cool .. 0.5 neutral .. 1 warm
  saturation: number; // 0 grey .. 1 neutral .. 1.6 vivid
  autoDay: boolean;
  autoOrbit: boolean;
}

const DEFAULTS: State = {
  hourUTC: 22.4,
  latitude: 29.5,
  longitude: 110.4,
  ridgeScale: 1,
  ridgeHeight: 900,
  mistDensity: 0.55,
  mistHeight: 220,
  haze: 0.35,
  exposure: 1.15,
  colorTemp: 0.5,
  saturation: 1,
  autoDay: false,
  autoOrbit: false,
};

const EPOCH_UTC = Date.UTC(2026, 5, 21);
const HOURS_PER_SECOND = 1 / 8;
const SUN_BASE = 8;

interface PresetPayload {
  hourUTC?: number;
  latitude?: number;
  longitude?: number;
  ridgeScale?: number;
  ridgeHeight?: number;
  mistDensity?: number;
  mistHeight?: number;
  haze?: number;
  exposure?: number;
  colorTemp?: number;
  saturation?: number;
  autoDay?: boolean;
  autoOrbit?: boolean;
}

export class MistyPlugin implements Plugin {
  readonly manifest = mistyManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private zh = false;
  private state: State = { ...DEFAULTS };
  private mesh: import('three').Mesh | null = null;
  private material: MistyMaterial | null = null;
  private loop: SkyLoop | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.publishScience();
    });
  }

  async destroy() {
    this.teardown3d();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
    this.three = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
    this.buildScene();
  }

  async deactivate() {
    this.teardown3d();
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
      notify(this.api, 'warning', 'Only .json scenery presets are supported.', '仅支持 .json 山景预设。');
      return;
    }
    try {
      const text = await this.api.readText(file);
      this.applyPreset(JSON.parse(text) as PresetPayload, file.name);
    } catch (err) {
      notify(this.api, 'error', 'Failed to parse the preset JSON.', '预设 JSON 解析失败。');
      this.api.log('error', `[fx.misty] loadData: ${String(err)}`);
    }
  }

  private applyPreset(p: PresetPayload, name: string) {
    const s = this.state;
    if (typeof p.hourUTC === 'number') s.hourUTC = ((p.hourUTC % 24) + 24) % 24;
    if (typeof p.latitude === 'number') s.latitude = Math.min(Math.max(p.latitude, -89), 89);
    if (typeof p.longitude === 'number') s.longitude = Math.min(Math.max(p.longitude, -180), 180);
    if (typeof p.ridgeScale === 'number') s.ridgeScale = Math.min(Math.max(p.ridgeScale, 0.3), 3);
    if (typeof p.ridgeHeight === 'number') s.ridgeHeight = Math.min(Math.max(p.ridgeHeight, 200), 2500);
    if (typeof p.mistDensity === 'number') s.mistDensity = Math.min(Math.max(p.mistDensity, 0), 1.5);
    if (typeof p.mistHeight === 'number') s.mistHeight = Math.min(Math.max(p.mistHeight, 20), 900);
    if (typeof p.haze === 'number') s.haze = Math.min(Math.max(p.haze, 0), 1);
    if (typeof p.exposure === 'number') s.exposure = Math.min(Math.max(p.exposure, 0.3), 3);
    if (typeof p.colorTemp === 'number') s.colorTemp = Math.min(Math.max(p.colorTemp, 0), 1);
    if (typeof p.saturation === 'number') s.saturation = Math.min(Math.max(p.saturation, 0), 1.6);
    if (typeof p.autoDay === 'boolean') s.autoDay = p.autoDay;
    if (typeof p.autoOrbit === 'boolean') s.autoOrbit = p.autoOrbit;
    this.syncUniforms();
    this.publishScience();
    this.refreshParams();
    this.loop?.renderFrame();
    notify(this.api, 'success', `Preset loaded: ${name}`, `预设已加载：${name}`);
  }

  getParams(): ParamDefinition[] {
    return [
      { key: 'hourUTC', label: 'UTC hour', labelI18n: { 'zh-CN': 'UTC 时刻 (h)', 'en-US': 'UTC hour (h)' }, type: 'range', min: 0, max: 24, step: 0.05, value: this.state.hourUTC },
      { key: 'latitude', label: 'Latitude (°)', labelI18n: { 'zh-CN': '纬度 (°)', 'en-US': 'Latitude (°)' }, type: 'range', min: -89, max: 89, step: 0.5, value: this.state.latitude },
      { key: 'longitude', label: 'Longitude (°)', labelI18n: { 'zh-CN': '经度 (°)', 'en-US': 'Longitude (°)' }, type: 'range', min: -180, max: 180, step: 0.5, value: this.state.longitude },
      { key: 'ridgeScale', label: 'Ridge scale', labelI18n: { 'zh-CN': '山脊尺度', 'en-US': 'Ridge scale' }, type: 'range', min: 0.3, max: 3, step: 0.05, value: this.state.ridgeScale },
      { key: 'ridgeHeight', label: 'Ridge height (m)', labelI18n: { 'zh-CN': '山脊高度 (m)', 'en-US': 'Ridge height (m)' }, type: 'range', min: 200, max: 2500, step: 25, value: this.state.ridgeHeight },
      { key: 'mistDensity', label: 'Mist density', labelI18n: { 'zh-CN': '云雾浓度', 'en-US': 'Mist density' }, type: 'range', min: 0, max: 1.5, step: 0.05, value: this.state.mistDensity },
      { key: 'mistHeight', label: 'Mist height (m)', labelI18n: { 'zh-CN': '云雾高度 (m)', 'en-US': 'Mist height (m)' }, type: 'range', min: 20, max: 900, step: 10, value: this.state.mistHeight },
      { key: 'haze', label: 'Aerial haze', labelI18n: { 'zh-CN': '大气透视', 'en-US': 'Aerial haze' }, type: 'range', min: 0, max: 1, step: 0.02, value: this.state.haze },
      { key: 'exposure', label: 'Exposure', labelI18n: { 'zh-CN': '曝光', 'en-US': 'Exposure' }, type: 'range', min: 0.3, max: 3, step: 0.05, value: this.state.exposure },
      { key: 'colorTemp', label: 'Colour temperature', labelI18n: { 'zh-CN': '色温（冷 ↔ 暖）', 'en-US': 'Colour temperature (cool ↔ warm)' }, type: 'range', min: 0, max: 1, step: 0.02, value: this.state.colorTemp },
      { key: 'saturation', label: 'Saturation', labelI18n: { 'zh-CN': '色彩浓度', 'en-US': 'Saturation' }, type: 'range', min: 0, max: 1.6, step: 0.02, value: this.state.saturation },
      { key: 'autoDay', label: 'Day cycle', labelI18n: { 'zh-CN': '昼夜循环', 'en-US': 'Day cycle' }, type: 'toggle', value: this.state.autoDay },
      { key: 'autoOrbit', label: 'Auto orbit', labelI18n: { 'zh-CN': '自动环绕', 'en-US': 'Auto orbit' }, type: 'toggle', value: this.state.autoOrbit },
      actionButton('resetView', 'Reset view', '复位视角'),
      actionButton('resetParams', 'Reset parameters', '恢复默认参数'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const s = this.state;
    let changed = false;
    const num = (k: keyof State): boolean => {
      const v = params[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        (s[k] as number) = v as number;
        return true;
      }
      return false;
    };
    if (
      num('hourUTC') || num('latitude') || num('longitude') || num('ridgeScale') || num('ridgeHeight') ||
      num('mistDensity') || num('mistHeight') || num('haze') || num('exposure') ||
      num('colorTemp') || num('saturation')
    ) {
      changed = true;
    }
    if (typeof params.autoDay === 'boolean') { s.autoDay = params.autoDay; changed = true; }
    if (typeof params.autoOrbit === 'boolean') { s.autoOrbit = params.autoOrbit; changed = true; }
    if (actionFired(params, 'resetView')) { this.fitCamera(); return; }
    if (actionFired(params, 'resetParams')) {
      this.state = { ...DEFAULTS };
      this.syncUniforms();
      this.publishScience();
      this.fitCamera();
      this.refreshParams();
      return;
    }
    if (changed) {
      this.syncUniforms();
      this.publishScience();
      if (!this.loop || !this.isAnimating()) this.loop?.renderFrame();
    }
  }

  // ---- ephemeris + uniforms ---------------------------------------------------

  /** Converts local (alt, az) radians into the world direction (x=east, y=up, north=−z). */
  private altAzToWorld(alt: number, az: number): [number, number, number] {
    const ca = Math.cos(alt);
    return [ca * Math.sin(az), Math.sin(alt), -ca * Math.cos(az)];
  }

  private syncUniforms() {
    if (!this.material) return;
    this.loop?.applyResolution();
    this.applyLighting();
  }

  private applyLighting() {
    const m = this.material;
    if (!m) return;
    const s = this.state;
    const date = new Date(EPOCH_UTC + s.hourUTC * 3600000);
    const sun = sunPosition(date, s.latitude, s.longitude);
    const [sx, sy, sz] = this.altAzToWorld(sun.alt, sun.az);
    m.uniforms.uSunDir.value.set(sx, sy, sz).normalize();
    const tint = sunDiskTint(sun.alt);
    m.uniforms.uSunColor.value.set(tint.rgb[0], tint.rgb[1], tint.rgb[2]);
    const beam = Math.min(Math.max((Math.sin(sun.alt) + 0.06) / 0.1, 0), 1);
    m.uniforms.uSunIntensity.value = SUN_BASE * tint.dim * beam;
    m.uniforms.uAtmoHaze.value = s.haze;
    m.uniforms.uRidgeScale.value = s.ridgeScale;
    m.uniforms.uRidgeHeight.value = s.ridgeHeight;
    m.uniforms.uAerialExt.value = hazeToExtinction(s.haze);
    m.uniforms.uMistDensity.value = s.mistDensity;
    m.uniforms.uMistHeight.value = s.mistHeight;
    m.uniforms.uExposure.value = s.exposure;
    m.uniforms.uColorTemp.value = s.colorTemp;
    m.uniforms.uSaturation.value = s.saturation;
  }

  // ---- 3D scene -----------------------------------------------------------------

  private isAnimating(): boolean {
    return this.state.autoDay || this.state.autoOrbit;
  }

  private buildScene() {
    const three = this.three;
    if (!three) {
      this.draw2dFallback();
      return;
    }
    if (!this.mesh) {
      const { mesh, material } = createMistyQuadMesh();
      this.mesh = mesh;
      this.material = material;
      three.scene.add(mesh);
      this.loop = new SkyLoop({
        three,
        material,
        isAnimating: () => this.isAnimating(),
        onFrame: (dt) => {
          if (dt > 0 && this.state.autoDay) {
            this.state.hourUTC = (this.state.hourUTC + dt * HOURS_PER_SECOND) % 24;
            this.applyLighting();
          }
        },
        qualityScale: () => 0.8,
      });
      this.loop.mount();
      this.fitCamera();
    }
    this.syncUniforms();
    this.publishScience();
    three.setVisible(true);
    this.loop?.renderFrame();
    this.loop?.start();
  }

  private fitCamera() {
    const three = this.three;
    if (!three) return;
    const cam = three.camera;
    cam.position.set(0, 320, 5200);
    cam.near = 1;
    cam.far = 2e5;
    cam.updateProjectionMatrix();
    three.controls.target.set(0, 520, 0);
    three.controls.update?.();
  }

  private teardown3d() {
    this.loop?.unmount();
    this.loop = null;
    const three = this.three;
    if (three && this.mesh) three.scene.remove(this.mesh);
    this.mesh?.geometry.dispose();
    this.material?.dispose();
    this.mesh = null;
    this.material = null;
  }

  // ---- science outputs ------------------------------------------------------------

  private publishScience() {
    const s = this.state;
    const date = new Date(EPOCH_UTC + s.hourUTC * 3600000);
    const jd = julianDay(date);
    const sun = sunPosition(date, s.latitude, s.longitude);
    const sunAltDeg = (sun.alt * 180) / Math.PI;
    const am = airmassKastenYoung(sunAltDeg);
    const tw = twilightClass(sunAltDeg);
    const twZh: Record<TwilightClass, string> = {
      day: '白昼', civil: '民用晨昏蒙影', nautical: '航海晨昏蒙影', astronomical: '天文晨昏蒙影', night: '夜',
    };
    const twEn: Record<TwilightClass, string> = {
      day: 'Day', civil: 'Civil twilight', nautical: 'Nautical twilight', astronomical: 'Astronomical twilight', night: 'Night',
    };
    const dist = layerDistances();
    const ranges = `2.5–${((dist[LAYER_COUNT - 1] ?? 0) / 1000).toFixed(0)} km`;
    const visKm = koschmiederVisibility(hazeToExtinction(s.haze)) / 1000;
    const lstH = (((gmst(jd) + (s.longitude * Math.PI) / 180) * 12) / Math.PI + 24) % 24;
    const metrics: ScienceMetric[] = [
      { key: 'sun_alt', label: 'Solar altitude', value: sunAltDeg.toFixed(2), unit: '°', severity: 'info', hint: this.zh ? '太阳地平高度（Meeus 低精度历表，±1′）。' : 'Solar altitude (Meeus low-precision, ±1′).' },
      { key: 'sun_az', label: 'Solar azimuth', value: ((sun.az * 180) / Math.PI).toFixed(2), unit: '°', severity: 'info', hint: this.zh ? '太阳方位角（北起东向），决定山体的受光面。' : 'Solar azimuth (from north, eastward); sets which flank is lit.' },
      { key: 'airmass', label: 'Air mass', value: am === null ? '—' : am.toFixed(3), unit: '', severity: 'info', hint: this.zh ? 'Kasten–Young (1989) 相对大气质量；太阳在地平线下时无定义。' : 'Kasten–Young (1989) relative air mass; undefined below the horizon.' },
      { key: 'twilight', label: 'Twilight', value: this.zh ? twZh[tw] : twEn[tw], unit: '', severity: 'info', hint: this.zh ? '按太阳高度划分：0°／−6°／−12°／−18°。' : 'Solar-altitude bands: 0° / −6° / −12° / −18°.' },
      { key: 'ranges', label: 'Ridge ranges', value: ranges, unit: '', severity: 'info', hint: this.zh ? '6 层剪影层由近及远的距离（2500 m × 1.85）。' : 'Near-to-far distances of the 6 silhouette layers (2500 m × 1.85).' },
      { key: 'mist', label: 'Mist band', value: s.mistHeight.toFixed(0), unit: 'm', severity: 'info', hint: this.zh ? '高斯雾带中心高度，半宽 = 0.65 × 雾高 + 120 m。' : 'Gaussian mist-band centre altitude; half-width = 0.65 × mist height + 120 m.' },
      { key: 'visibility', label: 'Visibility', value: visKm.toFixed(1), unit: 'km', severity: 'info', hint: this.zh ? 'Koschmieder 能见度 V = 3.912 / β；远山在此距离附近消隐。' : 'Koschmieder visibility V = 3.912 / β; far ranges vanish near this range.' },
      { key: 'lst', label: 'LST', value: lstH.toFixed(3), unit: 'h', severity: 'info', hint: this.zh ? '当地恒星时（GMST + 经度）。' : 'Local sidereal time (GMST + longitude).' },
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
    canvas.width = canvas.clientWidth || 800;
    canvas.height = canvas.clientHeight || 500;
    g.fillStyle = '#0b1016';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.textAlign = 'center';
    g.font = `14px ${this.zh ? '"Microsoft YaHei"' : 'Consolas'}, monospace`;
    g.fillText(
      this.zh ? 'fx.misty 需要 WebGL 画布（当前容器未提供）' : 'fx.misty requires a WebGL canvas (not available here)',
      canvas.width / 2,
      canvas.height / 2,
    );
  }
}

export default function createMistyPlugin(): Plugin {
  return new MistyPlugin();
}
