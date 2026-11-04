// ==========================================================================
// fx.ocean — open-sea swell plugin: state, the Pierson–Moskowitz sea-state
// kernel, ephemeris glue, the shared SkyLoop and the science panel.
//
// The GPU renderer lives in shader.ts; everything physical is decided here:
// the wind field is turned into a discretised wave spectrum (pure functions
// below, unit-tested), the real sun drives the beam tint / altitude and the
// science strip reports sea-state numbers (Hs, Tp, steepness, Beaufort).
// ==========================================================================

import { Vector2 } from 'three';
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
import { createOceanQuadMesh, WAVE_COUNT, type OceanMaterial } from './shader';
import { oceanManifest } from './manifest';

// ---- Pierson–Moskowitz sea-state kernel (pure, unit-tested) ----------------

const G_ACC = 9.81;
const TAU = Math.PI * 2;
const ALPHA_PM = 0.0081; // Phillips constant for a fully developed sea

/** Peak (spectral) frequency fp = 0.13 g / U10 (Hz). */
export function peakFrequency(u10: number): number {
  return (0.13 * G_ACC) / Math.max(u10, 0.1);
}

/** Pierson–Moskowitz spectral density S(f) (m²·s) for wind speed U10 (m/s). */
export function piersonMoskowitz(f: number, u10: number): number {
  if (f <= 0 || u10 <= 0) return 0;
  const fp = peakFrequency(u10);
  const a = (ALPHA_PM * G_ACC * G_ACC) / Math.pow(TAU, 4);
  return (a / Math.pow(f, 5)) * Math.exp(-1.25 * Math.pow(fp / f, 4));
}

/** Analytic variance m0 = ∫S df = α g² / (5 (2π)⁴ fp⁴) (m²). */
export function pmVariance(u10: number): number {
  const fp = peakFrequency(u10);
  return (ALPHA_PM * G_ACC * G_ACC) / (5 * Math.pow(TAU, 4) * Math.pow(fp, 4));
}

/** Significant wave height Hs = 4√m0 (m). */
export function significantWaveHeight(u10: number): number {
  return 4 * Math.sqrt(pmVariance(u10));
}

export interface WaveComponents {
  amp: number[];
  freq: number[];
  dirX: number[];
  dirZ: number[];
  phase: number[];
}

/** cos² single-lobe fan half-extent (rad) — ~±72°. */
const DIR_FAN = 1.257;

/** Deterministic per-train phase in [0, 2π) from an integer hash. */
function phaseAt(seed: number, i: number): number {
  const x = Math.sin(seed * 12.9898 + i * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * TAU;
}

/**
 * Discretises the PM spectrum into WAVE_COUNT log-spaced trains over
 * [fp/2.5, 2.5 fp], with cos² directional spreading, normalised so that
 * Σ aᵢ²/2 = m0 (the discrete variance matches the analytic one).
 */
export function waveComponents(u10: number, windDirRad: number, seed: number): WaveComponents {
  const n = WAVE_COUNT;
  const fp = peakFrequency(u10);
  const m0 = pmVariance(u10);
  const f0 = fp / 2.5;
  const r = Math.pow(6.25, 1 / (n - 1)); // geometric ratio across [fp/2.5, 2.5 fp] (r⁴ = 2.5 lands a train on fp)
  const dfLog = Math.log(r);
  const freq: number[] = [];
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    const f = f0 * Math.pow(r, i);
    freq.push(f);
    raw.push(piersonMoskowitz(f, u10) * f * dfLog);
  }
  const sum = raw.reduce((acc, v) => acc + v, 0) || 1;
  const amp: number[] = [];
  const dirX: number[] = [];
  const dirZ: number[] = [];
  const phase: number[] = [];
  for (let i = 0; i < n; i++) {
    const w = (raw[i] ?? 0) / sum;
    amp.push(Math.sqrt(Math.max(2 * m0 * w, 0)));
    const th = ((i - (n - 1) / 2) / ((n - 1) / 2)) * DIR_FAN;
    dirX.push(Math.sin(windDirRad + th));
    dirZ.push(-Math.cos(windDirRad + th));
    phase.push(phaseAt(seed, i));
  }
  return { amp, freq, dirX, dirZ, phase };
}

/** Discrete spectral peak period Tp = 1 / f(peak train) (s). */
export function peakPeriod(c: WaveComponents): number {
  let best = -1;
  let bi = 0;
  for (let i = 0; i < c.amp.length; i++) {
    const a = c.amp[i] ?? 0;
    if (a > best) {
      best = a;
      bi = i;
    }
  }
  return 1 / (c.freq[bi] ?? 1);
}

/** Deep-water wavelength from a period, L = g T² / 2π (m). */
export function deepWaterWavelength(periodS: number): number {
  return (G_ACC * periodS * periodS) / TAU;
}

/** Beaufort force from a 10 m wind (WMO lower bounds, m/s). */
const BEAUFORT_MIN = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
export function beaufort(u10: number): number {
  let bf = 0;
  for (const t of BEAUFORT_MIN) if (u10 >= t) bf++;
  return bf;
}

// ---- plugin -----------------------------------------------------------------

interface State {
  hourUTC: number;
  latitude: number;
  longitude: number;
  windSpeed: number; // U10 in m/s
  windDirDeg: number; // wave propagation azimuth (from north, eastward)
  waveScale: number;
  choppiness: number;
  waveDetail: number;
  glitter: number;
  haze: number;
  exposure: number;
  colorTemp: number; // white balance: 0 cool .. 0.5 neutral .. 1 warm
  saturation: number; // 0 grey .. 1 neutral .. 1.6 vivid
  waveMotion: boolean;
  autoDay: boolean;
  autoOrbit: boolean;
}

const DEFAULTS: State = {
  hourUTC: 13.2,
  latitude: 36.0,
  longitude: -122.0,
  windSpeed: 11,
  windDirDeg: 300,
  waveScale: 1,
  choppiness: 0.6,
  waveDetail: 0.4,
  glitter: 1,
  haze: 0.25,
  exposure: 1.1,
  colorTemp: 0.5,
  saturation: 1,
  waveMotion: true,
  autoDay: false,
  autoOrbit: false,
};

const EPOCH_UTC = Date.UTC(2026, 5, 21);
const HOURS_PER_SECOND = 1 / 8; // day cycle: full day in 3.2 min
const SUN_BASE = 8;

interface PresetPayload {
  hourUTC?: number;
  latitude?: number;
  longitude?: number;
  windSpeed?: number;
  windDirDeg?: number;
  waveScale?: number;
  choppiness?: number;
  waveDetail?: number;
  glitter?: number;
  haze?: number;
  exposure?: number;
  colorTemp?: number;
  saturation?: number;
  waveMotion?: boolean;
  autoDay?: boolean;
  autoOrbit?: boolean;
}

export class OceanPlugin implements Plugin {
  readonly manifest = oceanManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private zh = false;
  private state: State = { ...DEFAULTS };
  private mesh: import('three').Mesh | null = null;
  private material: OceanMaterial | null = null;
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
      notify(this.api, 'warning', 'Only .json sea-state presets are supported.', '仅支持 .json 海况预设。');
      return;
    }
    try {
      const text = await this.api.readText(file);
      this.applyPreset(JSON.parse(text) as PresetPayload, file.name);
    } catch (err) {
      notify(this.api, 'error', 'Failed to parse the preset JSON.', '预设 JSON 解析失败。');
      this.api.log('error', `[fx.ocean] loadData: ${String(err)}`);
    }
  }

  private applyPreset(p: PresetPayload, name: string) {
    const s = this.state;
    if (typeof p.hourUTC === 'number') s.hourUTC = ((p.hourUTC % 24) + 24) % 24;
    if (typeof p.latitude === 'number') s.latitude = Math.min(Math.max(p.latitude, -89), 89);
    if (typeof p.longitude === 'number') s.longitude = Math.min(Math.max(p.longitude, -180), 180);
    if (typeof p.windSpeed === 'number') s.windSpeed = Math.min(Math.max(p.windSpeed, 0.5), 32);
    if (typeof p.windDirDeg === 'number') s.windDirDeg = ((p.windDirDeg % 360) + 360) % 360;
    if (typeof p.waveScale === 'number') s.waveScale = Math.min(Math.max(p.waveScale, 0.2), 3);
    if (typeof p.choppiness === 'number') s.choppiness = Math.min(Math.max(p.choppiness, 0), 1.1);
    if (typeof p.waveDetail === 'number') s.waveDetail = Math.min(Math.max(p.waveDetail, 0), 1);
    if (typeof p.glitter === 'number') s.glitter = Math.min(Math.max(p.glitter, 0), 3);
    if (typeof p.haze === 'number') s.haze = Math.min(Math.max(p.haze, 0), 1);
    if (typeof p.exposure === 'number') s.exposure = Math.min(Math.max(p.exposure, 0.3), 3);
    if (typeof p.colorTemp === 'number') s.colorTemp = Math.min(Math.max(p.colorTemp, 0), 1);
    if (typeof p.saturation === 'number') s.saturation = Math.min(Math.max(p.saturation, 0), 1.6);
    if (typeof p.waveMotion === 'boolean') s.waveMotion = p.waveMotion;
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
      { key: 'windSpeed', label: 'Wind U10 (m/s)', labelI18n: { 'zh-CN': '10 m 风速 (m/s)', 'en-US': 'Wind U10 (m/s)' }, type: 'range', min: 0.5, max: 32, step: 0.5, value: this.state.windSpeed },
      { key: 'windDirDeg', label: 'Wave heading (°)', labelI18n: { 'zh-CN': '波向 (°)', 'en-US': 'Wave heading (°)' }, type: 'range', min: 0, max: 360, step: 5, value: this.state.windDirDeg },
      { key: 'waveScale', label: 'Swell scale', labelI18n: { 'zh-CN': '浪高夸张系数', 'en-US': 'Swell scale' }, type: 'range', min: 0.2, max: 3, step: 0.05, value: this.state.waveScale },
      { key: 'choppiness', label: 'Choppiness', labelI18n: { 'zh-CN': '波峰陡度', 'en-US': 'Choppiness' }, type: 'range', min: 0, max: 1.1, step: 0.05, value: this.state.choppiness },
      { key: 'waveDetail', label: 'Capillary detail', labelI18n: { 'zh-CN': '细波纹理', 'en-US': 'Capillary detail' }, type: 'range', min: 0, max: 1, step: 0.05, value: this.state.waveDetail },
      { key: 'glitter', label: 'Sun glitter', labelI18n: { 'zh-CN': '太阳 glitter', 'en-US': 'Sun glitter' }, type: 'range', min: 0, max: 3, step: 0.05, value: this.state.glitter },
      { key: 'haze', label: 'Marine haze', labelI18n: { 'zh-CN': '海雾', 'en-US': 'Marine haze' }, type: 'range', min: 0, max: 1, step: 0.02, value: this.state.haze },
      { key: 'exposure', label: 'Exposure', labelI18n: { 'zh-CN': '曝光', 'en-US': 'Exposure' }, type: 'range', min: 0.3, max: 3, step: 0.05, value: this.state.exposure },
      { key: 'colorTemp', label: 'Colour temperature', labelI18n: { 'zh-CN': '色温（冷 ↔ 暖）', 'en-US': 'Colour temperature (cool ↔ warm)' }, type: 'range', min: 0, max: 1, step: 0.02, value: this.state.colorTemp },
      { key: 'saturation', label: 'Saturation', labelI18n: { 'zh-CN': '色彩浓度', 'en-US': 'Saturation' }, type: 'range', min: 0, max: 1.6, step: 0.02, value: this.state.saturation },
      { key: 'waveMotion', label: 'Wave motion', labelI18n: { 'zh-CN': '波面运动', 'en-US': 'Wave motion' }, type: 'toggle', value: this.state.waveMotion },
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
      num('hourUTC') || num('latitude') || num('longitude') || num('windSpeed') || num('windDirDeg') ||
      num('waveScale') || num('choppiness') || num('waveDetail') || num('glitter') || num('haze') || num('exposure') ||
      num('colorTemp') || num('saturation')
    ) {
      changed = true;
    }
    if (typeof params.waveMotion === 'boolean') { s.waveMotion = params.waveMotion; changed = true; }
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
    this.rebuildWaves();
    this.applyEphemeris();
  }

  /** Wind field → discrete wave trains on the GPU uniforms. */
  private rebuildWaves() {
    const m = this.material;
    if (!m) return;
    const s = this.state;
    const dirRad = (s.windDirDeg * Math.PI) / 180;
    const comp = waveComponents(s.windSpeed, dirRad, s.windSpeed * 1.7 + 3.1);
    m.uniforms.uWaveAmp.value = comp.amp;
    m.uniforms.uWaveFreq.value = comp.freq;
    m.uniforms.uWavePhase.value = comp.phase;
    m.uniforms.uWaveDir.value = comp.dirX.map((x, i) => new Vector2(x, comp.dirZ[i] ?? 0));
  }

  private applyEphemeris() {
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
    m.uniforms.uChoppiness.value = s.choppiness;
    m.uniforms.uWaveScale.value = s.waveScale;
    m.uniforms.uDetail.value = s.waveDetail;
    m.uniforms.uGlitter.value = s.glitter;
    m.uniforms.uFogDensity.value = hazeToExtinction(s.haze);
    m.uniforms.uExposure.value = s.exposure;
    m.uniforms.uColorTemp.value = s.colorTemp;
    m.uniforms.uSaturation.value = s.saturation;
  }

  // ---- 3D scene -----------------------------------------------------------------

  private isAnimating(): boolean {
    return this.state.waveMotion || this.state.autoDay || this.state.autoOrbit;
  }

  private buildScene() {
    const three = this.three;
    if (!three) {
      this.draw2dFallback();
      return;
    }
    if (!this.mesh) {
      const { mesh, material } = createOceanQuadMesh();
      this.mesh = mesh;
      this.material = material;
      three.scene.add(mesh);
      this.loop = new SkyLoop({
        three,
        material,
        isAnimating: () => this.isAnimating(),
        onFrame: (dt) => {
          if (dt <= 0) return;
          const s = this.state;
          if (s.waveMotion && this.material) {
            this.material.uniforms.uTime.value += dt;
          }
          if (s.autoDay) {
            s.hourUTC = (s.hourUTC + dt * HOURS_PER_SECOND) % 24;
            this.applyEphemeris();
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
    // Low eye just above the water, aimed down the sun's azimuth so the disk
    // and its glitter path sit in the middle of the frame — the classic
    // open-sea sunrise/sunset shot with the horizon across the centre.
    const date = new Date(EPOCH_UTC + this.state.hourUTC * 3600000);
    const sun = sunPosition(date, this.state.latitude, this.state.longitude);
    const [hx, , hz] = this.altAzToWorld(0, sun.az);
    const cam = three.camera;
    cam.position.set(-hx * 300, 16, -hz * 300);
    cam.near = 0.5;
    cam.far = 3e5;
    cam.updateProjectionMatrix();
    three.controls.target.set(0, 10, 0);
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
    const comp = waveComponents(s.windSpeed, (s.windDirDeg * Math.PI) / 180, 0);
    const hs = significantWaveHeight(s.windSpeed);
    const tp = peakPeriod(comp);
    const lp = deepWaterWavelength(tp);
    const steepness = hs / lp;
    const bf = beaufort(s.windSpeed);
    const visKm = koschmiederVisibility(hazeToExtinction(s.haze)) / 1000;
    const lstH = (((gmst(jd) + (s.longitude * Math.PI) / 180) * 12) / Math.PI + 24) % 24;
    const metrics: ScienceMetric[] = [
      { key: 'sun_alt', label: 'Solar altitude', value: sunAltDeg.toFixed(2), unit: '°', severity: 'info', hint: this.zh ? '太阳地平高度（Meeus 低精度历表，±1′）。' : 'Solar altitude (Meeus low-precision, ±1′).' },
      { key: 'sun_az', label: 'Solar azimuth', value: ((sun.az * 180) / Math.PI).toFixed(2), unit: '°', severity: 'info', hint: this.zh ? '太阳方位角（北起东向）；与波向的夹角决定太阳光路的方位。' : 'Solar azimuth (from north, eastward); its angle to the wave heading sets the sun-path bearing.' },
      { key: 'airmass', label: 'Air mass', value: am === null ? '—' : am.toFixed(3), unit: '', severity: 'info', hint: this.zh ? 'Kasten–Young (1989) 相对大气质量；太阳在地平线下时无定义。' : 'Kasten–Young (1989) relative air mass; undefined below the horizon.' },
      { key: 'twilight', label: 'Twilight', value: this.zh ? twZh[tw] : twEn[tw], unit: '', severity: 'info', hint: this.zh ? '按太阳高度划分：0°／−6°／−12°／−18°。' : 'Solar-altitude bands: 0° / −6° / −12° / −18°.' },
      { key: 'wind', label: 'Wind U10', value: s.windSpeed.toFixed(1), unit: 'm/s', severity: 'info', hint: this.zh ? '10 m 高度风速，驱动 Pierson–Moskowitz 谱。' : '10 m wind speed driving the Pierson–Moskowitz spectrum.' },
      { key: 'beaufort', label: 'Beaufort force', value: `${bf}`, unit: '', severity: bf >= 7 ? 'warn' : 'info', hint: this.zh ? 'WMO 蒲福风级（按风速下限判定）。' : 'WMO Beaufort force (from the lower wind-speed bounds).' },
      { key: 'hs', label: 'Significant wave height Hs', value: hs.toFixed(2), unit: 'm', severity: 'info', hint: this.zh ? 'Hs = 4√m0，m0 为 PM 谱解析方差（充分发展海况 0.0246 U10²）。' : 'Hs = 4√m0 with m0 the analytic PM variance (fully-developed sea: 0.0246 U10²).' },
      { key: 'tp', label: 'Peak period Tp', value: tp.toFixed(2), unit: 's', severity: 'info', hint: this.zh ? '离散谱峰对应周期；解析 Tp = 1/fp，fp = 0.13 g/U10。' : 'Discrete spectral peak period; analytic Tp = 1/fp with fp = 0.13 g/U10.' },
      { key: 'wavelength', label: 'Peak wavelength Lp', value: lp.toFixed(1), unit: 'm', severity: 'info', hint: this.zh ? '深水波长 L = g T² / 2π。' : 'Deep-water wavelength L = g T² / 2π.' },
      { key: 'steepness', label: 'Wave steepness Hs/Lp', value: steepness.toFixed(4), unit: '', severity: steepness > 0.1 ? 'warn' : 'info', hint: this.zh ? '深水破碎判据约为 Hs/Lp ≈ 1/7 (0.14)。' : 'Deep-water breaking criterion is about Hs/Lp ≈ 1/7 (0.14).' },
      { key: 'visibility', label: 'Visibility', value: visKm.toFixed(1), unit: 'km', severity: 'info', hint: this.zh ? 'Koschmieder 能见度 V = 3.912 / β，β 取自海雾滑块。' : 'Koschmieder visibility V = 3.912 / β, β taken from the haze slider.' },
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
      this.zh ? 'fx.ocean 需要 WebGL 画布（当前容器未提供）' : 'fx.ocean requires a WebGL canvas (not available here)',
      canvas.width / 2,
      canvas.height / 2,
    );
  }
}

export default function createOceanPlugin(): Plugin {
  return new OceanPlugin();
}
