// ==========================================================================
// fx.sky — daylight sky plugin: analytic single-scattering atmosphere.
//
// The GPU integrator lives in shader.ts; this file owns state, ephemeris
// glue (`@/core/raytrace/astro`), the shared SkyLoop (adaptive resolution +
// the single-chain scheduling invariant) and the science panel. The loop
// parks itself when neither the day cycle nor auto-orbit runs — the scene is
// static, so no frames are burned while idle.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import type { Scene3DHandle } from '@/types/plugin';
import { emit } from '@/core/events';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import {
  airmassKastenYoung,
  gmst,
  julianDay,
  moonPhaseIllumination,
  moonPosition,
  SkyLoop,
  sunPosition,
  twilightClass,
  type TwilightClass,
} from '@/core/raytrace';
import { createSkyQuadMesh, type SkyMaterial } from './shader';
import { skyManifest } from './manifest';

// These helpers now live in the shared core so the sky, ocean and misty-peak
// renderers all agree on air mass and twilight banding; re-exported here to
// keep the plugin's published surface unchanged.
export { airmassKastenYoung, twilightClass };
export type { TwilightClass };

interface State {
  hourUTC: number;
  latitude: number;
  longitude: number;
  turbidity: number;
  sunIntensity: number;
  exposure: number;
  autoDay: boolean;
  autoOrbit: boolean;
}

const DEFAULTS: State = {
  hourUTC: 4.25,
  latitude: 39.9,
  longitude: 116.4,
  turbidity: 3,
  sunIntensity: 20,
  exposure: 1.2,
  autoDay: false,
  autoOrbit: false,
};

const EPOCH_UTC = Date.UTC(2026, 5, 21);
const HOURS_PER_SECOND = 1 / 8; // day cycle: full day in 3.2 min

interface PresetPayload {
  hourUTC?: number;
  latitude?: number;
  longitude?: number;
  turbidity?: number;
  sunIntensity?: number;
  exposure?: number;
  autoDay?: boolean;
  autoOrbit?: boolean;
}

export class SkyPlugin implements Plugin {
  readonly manifest = skyManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private zh = false;
  private state: State = { ...DEFAULTS };
  private mesh: import('three').Mesh | null = null;
  private material: SkyMaterial | null = null;
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
      notify(this.api, 'warning', 'Only .json scene presets are supported.', '仅支持 .json 场景预设。');
      return;
    }
    try {
      const text = await this.api.readText(file);
      this.applyPreset(JSON.parse(text) as PresetPayload, file.name);
    } catch (err) {
      notify(this.api, 'error', 'Failed to parse the preset JSON.', '预设 JSON 解析失败。');
      this.api.log('error', `[fx.sky] loadData: ${String(err)}`);
    }
  }

  private applyPreset(p: PresetPayload, name: string) {
    const s = this.state;
    if (typeof p.hourUTC === 'number') s.hourUTC = ((p.hourUTC % 24) + 24) % 24;
    if (typeof p.latitude === 'number') s.latitude = Math.min(Math.max(p.latitude, -89), 89);
    if (typeof p.longitude === 'number') s.longitude = Math.min(Math.max(p.longitude, -180), 180);
    if (typeof p.turbidity === 'number') s.turbidity = Math.min(Math.max(p.turbidity, 1), 10);
    if (typeof p.sunIntensity === 'number') s.sunIntensity = Math.min(Math.max(p.sunIntensity, 2), 40);
    if (typeof p.exposure === 'number') s.exposure = Math.min(Math.max(p.exposure, 0.3), 3);
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
      { key: 'turbidity', label: 'Turbidity', labelI18n: { 'zh-CN': '大气浑浊度', 'en-US': 'Turbidity' }, type: 'range', min: 1, max: 10, step: 0.1, value: this.state.turbidity },
      { key: 'sunIntensity', label: 'Sun intensity', labelI18n: { 'zh-CN': '太阳辐射强度', 'en-US': 'Sun intensity' }, type: 'range', min: 2, max: 40, step: 0.5, value: this.state.sunIntensity },
      { key: 'exposure', label: 'Exposure', labelI18n: { 'zh-CN': '曝光', 'en-US': 'Exposure' }, type: 'range', min: 0.3, max: 3, step: 0.05, value: this.state.exposure },
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
    if (num('hourUTC') || num('latitude') || num('longitude') || num('turbidity') || num('sunIntensity') || num('exposure')) changed = true;
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
    const m = this.material;
    if (!m) return;
    this.loop?.applyResolution();
    this.applyEphemeris();
  }

  private applyEphemeris() {
    const m = this.material;
    if (!m) return;
    const s = this.state;
    const date = new Date(EPOCH_UTC + s.hourUTC * 3600000);
    const jd = julianDay(date);
    const sun = sunPosition(date, s.latitude, s.longitude);
    const moon = moonPosition(date, s.latitude, s.longitude);
    const [sx, sy, sz] = this.altAzToWorld(sun.alt, sun.az);
    const [mx, my, mz] = this.altAzToWorld(moon.alt, moon.az);
    m.uniforms.uSunDir.value.set(sx, sy, sz).normalize();
    m.uniforms.uMoonDir.value.set(mx, my, mz).normalize();
    const sunAltDeg = (sun.alt * 180) / Math.PI;
    const illum = moonPhaseIllumination(jd);
    const moonUp = Math.min(Math.max(my * 4 + 0.15, 0), 1);
    m.uniforms.uMoonBright.value = illum * moonUp * Math.min(Math.max(sunAltDeg < -6 ? 1 : 0.15, 0), 1);
    m.uniforms.uTurbidity.value = s.turbidity;
    m.uniforms.uSunIntensity.value = s.sunIntensity;
    m.uniforms.uExposure.value = s.exposure;
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
      const { mesh, material } = createSkyQuadMesh();
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
            this.applyEphemeris();
          }
        },
        qualityScale: () => 0.9,
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
    cam.position.set(0, 40, 320);
    cam.near = 0.1;
    cam.far = 5e4;
    cam.updateProjectionMatrix();
    three.controls.target.set(0, 130, 0);
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
    const moon = moonPosition(date, s.latitude, s.longitude);
    const sunAltDeg = (sun.alt * 180) / Math.PI;
    const am = airmassKastenYoung(sunAltDeg);
    const tw = twilightClass(sunAltDeg);
    const twZh: Record<TwilightClass, string> = {
      day: '白昼', civil: '民用晨昏蒙影', nautical: '航海晨昏蒙影', astronomical: '天文晨昏蒙影', night: '夜',
    };
    const twEn: Record<TwilightClass, string> = {
      day: 'Day', civil: 'Civil twilight', nautical: 'Nautical twilight', astronomical: 'Astronomical twilight', night: 'Night',
    };
    const lstH = (((gmst(jd) + (s.longitude * Math.PI) / 180) * 12) / Math.PI + 24) % 24;
    const metrics: ScienceMetric[] = [
      { key: 'sun_alt', label: 'Solar altitude', value: sunAltDeg.toFixed(2), unit: '°', severity: 'info', hint: this.zh ? '太阳地平高度（Meeus 低精度历表，±1′）。' : 'Solar altitude (Meeus low-precision, ±1′).' },
      { key: 'sun_az', label: 'Solar azimuth', value: ((sun.az * 180) / Math.PI).toFixed(2), unit: '°', severity: 'info', hint: this.zh ? '太阳方位角（北起东向）。' : 'Solar azimuth (from north, eastward).' },
      { key: 'airmass', label: 'Air mass', value: am === null ? '—' : am.toFixed(3), unit: '', severity: 'info', hint: this.zh ? 'Kasten–Young (1989) 相对大气质量；太阳在地平线下时无定义。' : 'Kasten–Young (1989) relative air mass; undefined below the horizon.' },
      { key: 'twilight', label: 'Twilight', value: this.zh ? twZh[tw] : twEn[tw], unit: '', severity: 'info', hint: this.zh ? '按太阳高度划分：0°／−6°／−12°／−18°。' : 'Solar-altitude bands: 0° / −6° / −12° / −18°.' },
      { key: 'moon_alt', label: 'Lunar altitude', value: ((moon.alt * 180) / Math.PI).toFixed(2), unit: '°', severity: 'info', hint: this.zh ? '月球地平高度（主项历表，±0.3°）。' : 'Lunar altitude (main-terms ephemeris, ±0.3°).' },
      { key: 'moon_illum', label: 'Moon illumination', value: (moonPhaseIllumination(jd) * 100).toFixed(1), unit: '%', severity: 'info', hint: this.zh ? '月球被照亮比例（相位角余弦）。' : 'Illuminated lunar disk fraction.' },
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
    g.fillStyle = '#0a1018';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.textAlign = 'center';
    g.font = `14px ${this.zh ? '"Microsoft YaHei"' : 'Consolas'}, monospace`;
    g.fillText(
      this.zh ? 'fx.sky 需要 WebGL 画布（当前容器未提供）' : 'fx.sky requires a WebGL canvas (not available here)',
      canvas.width / 2,
      canvas.height / 2,
    );
  }
}

export default function createSkyPlugin(): Plugin {
  return new SkyPlugin();
}
