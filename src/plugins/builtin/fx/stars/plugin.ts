// ==========================================================================
// fx.stars — night-sky star renderer: plugin implementation.
//
// Owns state, the sidereal clock (GMST → uCelestial rotation), the real
// galactic-pole/center directions (RA/Dec → horizontal → world), the Bortle
// light-pollution model, a Poisson meteor scheduler and the science panel.
// Rendering + the single-chain RAF loop come from the shared SkyLoop.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import type { Scene3DHandle } from '@/types/plugin';
import { emit } from '@/core/events';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import {
  celestialRotationMatrix,
  equatorialToHorizontal,
  gmst,
  julianDay,
  moonPhaseIllumination,
  moonPosition,
  SkyLoop,
} from '@/core/raytrace';
import { createStarsQuadMesh, type StarsMaterial } from './shader';
import { starsManifest } from './manifest';

/** mulberry32 PRNG — deterministic per seed (same stream convention as the astro kernels). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Galactic frame constants (J2000): north galactic pole and galactic center,
// expressed as equatorial RA/Dec in radians.
const GAL_POLE = { ra: (192.85948 * Math.PI) / 180, dec: (27.12825 * Math.PI) / 180 };
const GAL_CENTER = { ra: (266.405 * Math.PI) / 180, dec: (-29.00781 * Math.PI) / 180 };

/** Typical natural-night sky brightness (mag/arcsec²) per Bortle class 1..9. */
export const BORTLE_SKY_BRIGHTNESS = [21.95, 21.7, 21.5, 21.2, 20.7, 20.2, 19.4, 18.8, 18.2];
/** Typical naked-eye limiting magnitude at the zenith per Bortle class 1..9. */
export const BORTLE_LIMITING_MAG = [7.8, 7.3, 7.0, 6.6, 6.3, 5.9, 5.5, 5.0, 4.5];

export function bortleSkyBrightness(b: number): number {
  const i = Math.min(Math.max(Math.round(b), 1), 9) - 1;
  return BORTLE_SKY_BRIGHTNESS[i] ?? 21.5;
}

export function bortleLimitingMag(b: number): number {
  const i = Math.min(Math.max(Math.round(b), 1), 9) - 1;
  return BORTLE_LIMITING_MAG[i] ?? 6.5;
}

/** Integral naked-eye star count above magnitude m (whole sky). */
export function visibleStarCount(limMag: number): number {
  return 9096 * Math.exp((limMag - 6.5) / 1.35);
}

interface State {
  hourUTC: number;
  latitude: number;
  longitude: number;
  starDensity: number;
  bortle: number;
  seeing: number;
  mwBrightness: number;
  meteorRate: number; // per minute
  exposure: number;
  autoRotate: boolean; // sidereal time-lapse
  autoOrbit: boolean;
}

const DEFAULTS: State = {
  hourUTC: 17.5,
  latitude: 19.8,
  longitude: -155.5,
  starDensity: 1,
  bortle: 2,
  seeing: 0.4,
  mwBrightness: 1,
  meteorRate: 1,
  exposure: 1.3,
  autoRotate: false,
  autoOrbit: false,
};

const EPOCH_UTC = Date.UTC(2026, 5, 21);
const HOURS_PER_SECOND = 1 / 8; // time-lapse: full sidereal day in 3.2 min

interface PresetPayload {
  hourUTC?: number;
  latitude?: number;
  longitude?: number;
  starDensity?: number;
  bortle?: number;
  seeing?: number;
  mwBrightness?: number;
  meteorRate?: number;
  exposure?: number;
  autoRotate?: boolean;
  autoOrbit?: boolean;
}

interface Meteor {
  a: [number, number, number];
  b: [number, number, number];
  t: number; // 0..1 head progress (>1 = finished)
  durationS: number;
}

export class StarsPlugin implements Plugin {
  readonly manifest = starsManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private zh = false;
  private state: State = { ...DEFAULTS };
  private mesh: import('three').Mesh | null = null;
  private material: StarsMaterial | null = null;
  private loop: SkyLoop | null = null;
  private simTime = 0;
  private nextMeteorAt = 6;
  private meteor: Meteor | null = null;
  private meteorRng = mulberry32(20260321);

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
      this.api.log('error', `[fx.stars] loadData: ${String(err)}`);
    }
  }

  private applyPreset(p: PresetPayload, name: string) {
    const s = this.state;
    if (typeof p.hourUTC === 'number') s.hourUTC = ((p.hourUTC % 24) + 24) % 24;
    if (typeof p.latitude === 'number') s.latitude = Math.min(Math.max(p.latitude, -89), 89);
    if (typeof p.longitude === 'number') s.longitude = Math.min(Math.max(p.longitude, -180), 180);
    if (typeof p.starDensity === 'number') s.starDensity = Math.min(Math.max(p.starDensity, 0), 2);
    if (typeof p.bortle === 'number') s.bortle = Math.min(Math.max(Math.round(p.bortle), 1), 9);
    if (typeof p.seeing === 'number') s.seeing = Math.min(Math.max(p.seeing, 0), 1);
    if (typeof p.mwBrightness === 'number') s.mwBrightness = Math.min(Math.max(p.mwBrightness, 0), 2);
    if (typeof p.meteorRate === 'number') s.meteorRate = Math.min(Math.max(p.meteorRate, 0), 30);
    if (typeof p.exposure === 'number') s.exposure = Math.min(Math.max(p.exposure, 0.5), 3);
    if (typeof p.autoRotate === 'boolean') s.autoRotate = p.autoRotate;
    if (typeof p.autoOrbit === 'boolean') s.autoOrbit = p.autoOrbit;
    this.simTime = 0;
    this.nextMeteorAt = 6;
    this.meteor = null;
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
      { key: 'starDensity', label: 'Star density', labelI18n: { 'zh-CN': '星空密度', 'en-US': 'Star density' }, type: 'range', min: 0, max: 2, step: 0.05, value: this.state.starDensity },
      { key: 'bortle', label: 'Bortle class', labelI18n: { 'zh-CN': 'Bortle 光污染等级', 'en-US': 'Bortle class' }, type: 'range', min: 1, max: 9, step: 1, value: this.state.bortle },
      { key: 'seeing', label: 'Seeing (twinkle)', labelI18n: { 'zh-CN': '视宁度（闪烁）', 'en-US': 'Seeing (twinkle)' }, type: 'range', min: 0, max: 1, step: 0.05, value: this.state.seeing },
      { key: 'mwBrightness', label: 'Milky Way', labelI18n: { 'zh-CN': '银河亮度', 'en-US': 'Milky Way brightness' }, type: 'range', min: 0, max: 2, step: 0.05, value: this.state.mwBrightness },
      { key: 'meteorRate', label: 'Meteors / min', labelI18n: { 'zh-CN': '流星 (颗/分钟)', 'en-US': 'Meteors / min' }, type: 'range', min: 0, max: 30, step: 1, value: this.state.meteorRate },
      { key: 'exposure', label: 'Exposure', labelI18n: { 'zh-CN': '曝光', 'en-US': 'Exposure' }, type: 'range', min: 0.5, max: 3, step: 0.05, value: this.state.exposure },
      { key: 'autoRotate', label: 'Sidereal time-lapse', labelI18n: { 'zh-CN': '恒星时流（斗转星移）', 'en-US': 'Sidereal time-lapse' }, type: 'toggle', value: this.state.autoRotate },
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
    if (num('hourUTC') || num('latitude') || num('longitude') || num('starDensity') || num('bortle') ||
        num('seeing') || num('mwBrightness') || num('meteorRate') || num('exposure')) changed = true;
    if (typeof params.autoRotate === 'boolean') { s.autoRotate = params.autoRotate; changed = true; }
    if (typeof params.autoOrbit === 'boolean') { s.autoOrbit = params.autoOrbit; changed = true; }
    if (actionFired(params, 'resetView')) { this.fitCamera(); return; }
    if (actionFired(params, 'resetParams')) {
      this.state = { ...DEFAULTS };
      this.simTime = 0;
      this.meteor = null;
      this.syncUniforms();
      this.publishScience();
      this.fitCamera();
      this.refreshParams();
      return;
    }
    if (changed) {
      this.syncUniforms();
      this.publishScience();
      if (!this.isAnimating()) this.loop?.renderFrame();
    }
  }

  // ---- ephemeris + uniforms ---------------------------------------------------

  /** Converts local (alt, az) radians into the world direction (x=east, y=up, north=−z). */
  private altAzToWorld(alt: number, az: number): [number, number, number] {
    const ca = Math.cos(alt);
    return [ca * Math.sin(az), Math.sin(alt), -ca * Math.cos(az)];
  }

  private isAnimating(): boolean {
    const s = this.state;
    return s.autoRotate || s.autoOrbit || s.meteorRate > 0;
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
    const latRad = (s.latitude * Math.PI) / 180;
    const lst = gmst(jd) + (s.longitude * Math.PI) / 180;
    // Sidereal rotation of the whole celestial sphere (斗转星移).
    m.uniforms.uCelestial.value.fromArray(celestialRotationMatrix(lst, latRad));
    // Real galactic frame: RA/Dec → horizontal → world.
    const gp = equatorialToHorizontal(GAL_POLE.ra, GAL_POLE.dec, lst, latRad);
    const gc = equatorialToHorizontal(GAL_CENTER.ra, GAL_CENTER.dec, lst, latRad);
    const [gx, gy, gz] = this.altAzToWorld(gp.alt, gp.az);
    const [cx, cy, cz] = this.altAzToWorld(gc.alt, gc.az);
    m.uniforms.uGalacticPole.value.set(gx, gy, gz).normalize();
    m.uniforms.uGalacticCenter.value.set(cx, cy, cz).normalize();
    // Moon: phase-scaled wash and glow.
    const moon = moonPosition(date, s.latitude, s.longitude);
    const [mx, my, mz] = this.altAzToWorld(moon.alt, moon.az);
    const illum = moonPhaseIllumination(jd);
    const moonAltDeg = (moon.alt * 180) / Math.PI;
    const moonUp = Math.min(Math.max(moonAltDeg / 25, 0), 1);
    m.uniforms.uMoonDir.value.set(mx, my, mz).normalize();
    m.uniforms.uMoonBright.value = illum * moonUp;
    m.uniforms.uStars.value = s.starDensity;
    m.uniforms.uBortle.value = s.bortle;
    m.uniforms.uSeeing.value = s.seeing;
    m.uniforms.uMwBright.value = s.mwBrightness;
    m.uniforms.uExposure.value = s.exposure;
    m.uniforms.uTime.value = this.simTime;
  }

  // ---- meteor scheduler (Poisson, deterministic per session) -------------------

  private spawnMeteor() {
    const rng = this.meteorRng;
    // Random radiant above 20° altitude.
    const phi = rng() * Math.PI * 2;
    const y = 0.2 + rng() * 0.7;
    const r = Math.sqrt(Math.max(1 - y * y, 1e-6));
    const a: [number, number, number] = [r * Math.cos(phi), y, r * Math.sin(phi)];
    // Random great-circle travel of 9–16°.
    const theta = (9 + rng() * 7) * (Math.PI / 180);
    // Perpendicular rotation axis from another random direction.
    const rp = rng() * Math.PI * 2;
    const n: [number, number, number] = [Math.cos(rp), 0.3 * Math.sin(rp * 3.1), Math.sin(rp)];
    const nl = Math.hypot(n[0], n[1], n[2]) || 1;
    const ax: [number, number, number] = [n[0] / nl, n[1] / nl, n[2] / nl];
    const dot = a[0] * ax[0] + a[1] * ax[1] + a[2] * ax[2];
    const cx: [number, number, number] = [
      ax[1] * a[2] - ax[2] * a[1],
      ax[2] * a[0] - ax[0] * a[2],
      ax[0] * a[1] - ax[1] * a[0],
    ];
    const c = Math.cos(theta);
    const s2 = Math.sin(theta);
    let b: [number, number, number] = [
      a[0] * c + cx[0] * s2 + ax[0] * dot * (1 - c),
      a[1] * c + cx[1] * s2 + ax[1] * dot * (1 - c),
      a[2] * c + cx[2] * s2 + ax[2] * dot * (1 - c),
    ];
    if (b[1] < 0.05) b = a; // fell below the horizon — keep a static radiant
    this.meteor = { a, b, t: 0, durationS: 0.5 + rng() * 0.6 };
    // Exponential inter-arrival times → Poisson process.
    this.nextMeteorAt = this.simTime - Math.log(1 - rng()) * (60 / Math.max(this.state.meteorRate, 0.01));
  }

  private updateMeteors(dt: number) {
    const m = this.material;
    if (!m) return;
    if (this.state.meteorRate > 0 && this.simTime >= this.nextMeteorAt) this.spawnMeteor();
    const met = this.meteor;
    if (met && met.t <= 1) {
      met.t += dt / met.durationS;
      m.uniforms.uMeteorA.value.set(...met.a);
      m.uniforms.uMeteorB.value.set(...met.b);
      m.uniforms.uMeteorT.value = met.t;
      m.uniforms.uMeteorFade.value = met.t <= 1 ? Math.sin(Math.PI * met.t) : 0;
    } else {
      m.uniforms.uMeteorFade.value = 0;
    }
  }

  // ---- 3D scene -----------------------------------------------------------------

  private buildScene() {
    const three = this.three;
    if (!three) {
      this.draw2dFallback();
      return;
    }
    if (!this.mesh) {
      const { mesh, material } = createStarsQuadMesh();
      this.mesh = mesh;
      this.material = material;
      three.scene.add(mesh);
      this.loop = new SkyLoop({
        three,
        material,
        isAnimating: () => this.isAnimating(),
        onFrame: (dt) => {
          if (dt > 0) {
            this.simTime += dt;
            if (this.state.autoRotate) {
              this.state.hourUTC = (this.state.hourUTC + dt * HOURS_PER_SECOND) % 24;
              this.applyEphemeris();
            }
            this.updateMeteors(dt);
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
    cam.position.set(0, 60, 280);
    cam.near = 0.1;
    cam.far = 5e4;
    cam.updateProjectionMatrix();
    three.controls.target.set(0, 420, 0);
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
    const lstH = (((gmst(jd) + (s.longitude * Math.PI) / 180) * 12) / Math.PI + 24) % 24;
    const moon = moonPosition(date, s.latitude, s.longitude);
    const illum = moonPhaseIllumination(jd);
    const sky = bortleSkyBrightness(s.bortle);
    const limMag = bortleLimitingMag(s.bortle);
    const nStars = visibleStarCount(limMag);
    const moonAltDeg = (moon.alt * 180) / Math.PI;
    const metrics: ScienceMetric[] = [
      { key: 'lst', label: 'LST', value: lstH.toFixed(3), unit: 'h', severity: 'info', hint: this.zh ? '当地恒星时（GMST + 经度），驱动斗转星移。' : 'Local sidereal time (GMST + longitude) — rotates the sky.' },
      { key: 'bortle', label: 'Bortle class', value: String(Math.round(s.bortle)), unit: '', severity: 'info', hint: this.zh ? '1 = 原始暗夜，9 = 市中心（John E. Bortle, 2001）。' : '1 = pristine, 9 = inner city (John E. Bortle, 2001).' },
      { key: 'sky_brightness', label: 'Sky brightness', value: sky.toFixed(1), unit: 'mag/″²', severity: 'info', hint: this.zh ? '天顶自然夜天亮度参考值（Bortle 分级对应表）。' : 'Reference zenith sky brightness for the Bortle class.' },
      { key: 'limiting_mag', label: 'Limiting mag', value: limMag.toFixed(1), unit: 'mag', severity: 'info', hint: this.zh ? '该等级下肉眼极限星等（天顶）。' : 'Naked-eye limiting magnitude at the zenith.' },
      { key: 'visible_stars', label: 'Visible stars', value: Math.round(nStars).toLocaleString(), unit: '', severity: 'info', hint: this.zh ? '全天肉眼可见星数积分估计 N(m) ≈ 9096·e^((m−6.5)/1.35)。' : 'Whole-sky naked-eye count N(m) ≈ 9096·e^((m−6.5)/1.35).' },
      { key: 'moon_alt', label: 'Lunar altitude', value: moonAltDeg.toFixed(2), unit: '°', severity: 'info', hint: this.zh ? '月光会冲淡暗星与银河。' : 'Moonlight washes out faint stars and the Milky Way.' },
      { key: 'moon_illum', label: 'Moon illumination', value: (illum * 100).toFixed(1), unit: '%', severity: 'info', hint: this.zh ? '月球被照亮比例（相位角余弦）。' : 'Illuminated lunar disk fraction.' },
      { key: 'meteor_rate', label: 'Meteor rate', value: s.meteorRate.toFixed(0), unit: '/min', severity: 'info', hint: this.zh ? 'Poisson 过程：相邻流星间隔服从指数分布。' : 'Poisson process: exponential inter-arrival gaps.' },
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
      this.zh ? 'fx.stars 需要 WebGL 画布（当前容器未提供）' : 'fx.stars requires a WebGL canvas (not available here)',
      canvas.width / 2,
      canvas.height / 2,
    );
  }
}

export default function createStarsPlugin(): Plugin {
  return new StarsPlugin();
}
