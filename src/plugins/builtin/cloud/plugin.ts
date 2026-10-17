// ==========================================================================
// Volumetric cloud plugin — plugin implementation.
//
// Hosts the fullscreen volumetric raymarcher inside the shared Three.js scene
// (Scene3DHandle). Ephemeris (sun/moon alt-az, GMST sidereal rotation) is
// computed in TS via `@/core/raytrace/astro` and uploaded per frame; the GLSL
// cloud renderer lives in `shader.ts`. Loads JSON presets via loadData.
// ==========================================================================

import type {
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  Scene3DHandle,
} from '@/types/plugin';
import {
  gmst,
  julianDay,
  moonPhaseIllumination,
  moonPosition,
  sunPosition,
} from '@/core/raytrace/astro';
import { emit } from '@/core/events';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import type { Mesh as ThreeMesh, PerspectiveCamera } from 'three';
import { cloudManifest } from './manifest';
import { createCloudQuad, type CloudMaterial } from './shader';

/** Fixed analysis date (2026 summer solstice) — hourUTC sweeps the diurnal cycle. */
const EPOCH_UTC = Date.UTC(2026, 5, 21, 0, 0, 0);

interface State {
  coverage: number; // 0..1 cloud coverage
  density: number; // extinction multiplier 0.2..2.5
  windSpeed: number; // m/s
  windDirDeg: number; // meteorological from-north direction
  cloudBase: number; // m
  cloudThickness: number; // m (top = base + thickness)
  hourUTC: number; // 0..24
  latitude: number; // deg north
  longitude: number; // deg east
  quality: 'low' | 'medium' | 'high' | 'ultra';
  running: boolean; // animate wind advection
  autoDay: boolean; // advance the diurnal cycle automatically
  autoOrbit: boolean; // slow camera orbit
}

const DEFAULTS: State = {
  coverage: 0.55,
  density: 1,
  windSpeed: 6,
  windDirDeg: 225,
  cloudBase: 650,
  cloudThickness: 800,
  hourUTC: 14,
  latitude: 39.9, // Beijing
  longitude: 116.4,
  quality: 'medium',
  running: true,
  autoDay: true,
  autoOrbit: true,
};

// March steps per quality tier. Raymarching is expensive: on integrated GPUs
// the whole frame budget is a few ms, so tiers pair fewer steps with a lower
// internal resolution (SCALE_BY_QUALITY) that is restored on upscale.
const STEPS_BY_QUALITY: Record<State['quality'], number> = { low: 40, medium: 64, high: 96, ultra: 144 };
const SCALE_BY_QUALITY: Record<State['quality'], number> = { low: 0.4, medium: 0.55, high: 0.75, ultra: 1 };

/** Day-cycle speed for autoDay: one simulated hour per 8 real seconds. */
const HOURS_PER_SECOND = 1 / 8;

interface PresetPayload {
  coverage?: number;
  density?: number;
  windSpeed?: number;
  windDirDeg?: number;
  cloudBaseM?: number;
  cloudThicknessM?: number;
  hourUTC?: number;
  latitude?: number;
  longitude?: number;
  autoDay?: boolean;
  autoOrbit?: boolean;
}

export class CloudPlugin implements Plugin {
  readonly manifest = cloudManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private mesh: ThreeMesh | null = null;
  private material: CloudMaterial | null = null;
  private rafId = 0;
  private lastT = 0;
  private simTime = 0;
  private state: State = { ...DEFAULTS };
  private zh = false;
  // Adaptive resolution: the raymarcher is GPU-bound, so the plugin renders at
  // a reduced pixel ratio and shrinks it further while the measured FPS sags.
  // The host renderer's original ratio is restored on deactivate/destroy.
  private savedPixelRatio: number | null = null;
  private dynScale = 1;
  private fpsEma = 0;

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
      this.api.log('error', `[fx.cloud] loadData: ${String(err)}`);
    }
  }

  private applyPreset(p: PresetPayload, name: string) {
    const s = this.state;
    if (typeof p.coverage === 'number') s.coverage = clamp(p.coverage, 0, 1);
    if (typeof p.density === 'number') s.density = clamp(p.density, 0.2, 2.5);
    if (typeof p.windSpeed === 'number') s.windSpeed = clamp(p.windSpeed, 0, 40);
    if (typeof p.windDirDeg === 'number') s.windDirDeg = ((p.windDirDeg % 360) + 360) % 360;
    if (typeof p.cloudBaseM === 'number') s.cloudBase = clamp(p.cloudBaseM, 200, 4000);
    if (typeof p.cloudThicknessM === 'number') s.cloudThickness = clamp(p.cloudThicknessM, 200, 3000);
    if (typeof p.hourUTC === 'number') s.hourUTC = ((p.hourUTC % 24) + 24) % 24;
    if (typeof p.latitude === 'number') s.latitude = clamp(p.latitude, -85, 85);
    if (typeof p.longitude === 'number') s.longitude = clamp(p.longitude, -180, 180);
    if (typeof p.autoDay === 'boolean') s.autoDay = p.autoDay;
    if (typeof p.autoOrbit === 'boolean') s.autoOrbit = p.autoOrbit;
    this.syncUniforms();
    this.publishScience();
    this.refreshParams();
    notify(this.api, 'success', `Preset loaded: ${name}`, `预设已加载：${name}`);
  }

  getParams(): ParamDefinition[] {
    const zh = this.zh;
    return [
      {
        key: 'coverage',
        label: 'Cloud coverage',
        labelI18n: { 'zh-CN': '云量', 'en-US': 'Cloud coverage' },
        type: 'range',
        min: 0,
        max: 1,
        step: 0.02,
        value: this.state.coverage,
      },
      {
        key: 'density',
        label: 'Cloud density',
        labelI18n: { 'zh-CN': '云体密度', 'en-US': 'Cloud density' },
        type: 'range',
        min: 0.2,
        max: 2.5,
        step: 0.05,
        value: this.state.density,
      },
      {
        key: 'cloudBase',
        label: 'Cloud base (m)',
        labelI18n: { 'zh-CN': '云底高度 (m)', 'en-US': 'Cloud base (m)' },
        type: 'range',
        min: 200,
        max: 4000,
        step: 25,
        value: this.state.cloudBase,
      },
      {
        key: 'cloudThickness',
        label: 'Cloud thickness (m)',
        labelI18n: { 'zh-CN': '云层厚度 (m)', 'en-US': 'Cloud thickness (m)' },
        type: 'range',
        min: 200,
        max: 3000,
        step: 25,
        value: this.state.cloudThickness,
      },
      {
        key: 'windSpeed',
        label: 'Wind speed (m/s)',
        labelI18n: { 'zh-CN': '风速 (m/s)', 'en-US': 'Wind speed (m/s)' },
        type: 'range',
        min: 0,
        max: 40,
        step: 0.5,
        value: this.state.windSpeed,
      },
      {
        key: 'windDirDeg',
        label: 'Wind direction (° from N)',
        labelI18n: { 'zh-CN': '风向（°，北起）', 'en-US': 'Wind direction (° from N)' },
        type: 'range',
        min: 0,
        max: 360,
        step: 5,
        value: this.state.windDirDeg,
      },
      {
        key: 'hourUTC',
        label: 'Time of day (UTC h)',
        labelI18n: { 'zh-CN': '时刻（UTC 小时）', 'en-US': 'Time of day (UTC h)' },
        type: 'range',
        min: 0,
        max: 24,
        step: 0.05,
        value: this.state.hourUTC,
      },
      {
        key: 'latitude',
        label: 'Latitude (°)',
        labelI18n: { 'zh-CN': '纬度 (°)', 'en-US': 'Latitude (°)' },
        type: 'range',
        min: -85,
        max: 85,
        step: 0.5,
        value: this.state.latitude,
      },
      {
        key: 'longitude',
        label: 'Longitude (°)',
        labelI18n: { 'zh-CN': '经度 (°)', 'en-US': 'Longitude (°)' },
        type: 'range',
        min: -180,
        max: 180,
        step: 0.5,
        value: this.state.longitude,
      },
      {
        key: 'quality',
        label: 'March quality (steps)',
        labelI18n: { 'zh-CN': '步进质量（步数）', 'en-US': 'March quality (steps)' },
        type: 'select',
        options: [
          { value: 'low', label: zh ? '低 · 40 步' : 'Low · 40' },
          { value: 'medium', label: zh ? '中 · 64 步' : 'Medium · 64' },
          { value: 'high', label: zh ? '高 · 96 步' : 'High · 96' },
          { value: 'ultra', label: zh ? '极高 · 144 步' : 'Ultra · 144' },
        ],
        value: this.state.quality,
      },
      {
        key: 'running',
        label: 'Animate wind',
        labelI18n: { 'zh-CN': '风场平流', 'en-US': 'Animate wind' },
        type: 'toggle',
        value: this.state.running,
        offLabel: zh ? '暂停' : 'Pause',
        onLabel: zh ? '平流中' : 'Running',
      },
      {
        key: 'autoDay',
        label: 'Auto day cycle',
        labelI18n: { 'zh-CN': '自动昼夜', 'en-US': 'Auto day cycle' },
        type: 'toggle',
        value: this.state.autoDay,
        offLabel: zh ? '固定时刻' : 'Fixed time',
        onLabel: zh ? '昼夜流转' : 'Cycling',
      },
      {
        key: 'autoOrbit',
        label: 'Auto camera orbit',
        labelI18n: { 'zh-CN': '自动环绕镜头', 'en-US': 'Auto camera orbit' },
        type: 'toggle',
        value: this.state.autoOrbit,
        offLabel: zh ? '固定' : 'Fixed',
        onLabel: zh ? '环绕中' : 'Orbiting',
      },
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
    if (num('coverage') || num('density') || num('windSpeed') || num('windDirDeg') || num('cloudBase') ||
        num('cloudThickness') || num('hourUTC') || num('latitude') || num('longitude')) changed = true;
    if (params.quality === 'low' || params.quality === 'medium' || params.quality === 'high' || params.quality === 'ultra') {
      if (params.quality !== s.quality) { s.quality = params.quality; changed = true; }
    }
    if (typeof params.running === 'boolean') { s.running = params.running; changed = true; }
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
      if (!this.isAnimating()) this.three?.render(); // idle: show the change immediately
    }
  }

  // ---- ephemeris + uniforms ---------------------------------------------------

  /** Converts local (alt, az) radians into the world direction (x=east, y=up, z=north=−z). */
  private altAzToWorld(alt: number, az: number): [number, number, number] {
    const ca = Math.cos(alt);
    return [ca * Math.sin(az), Math.sin(alt), -ca * Math.cos(az)];
  }

  private syncUniforms() {
    const m = this.material;
    if (!m) return;
    this.applyResolution();
    const s = this.state;
    m.uniforms.uCoverage.value = s.coverage;
    m.uniforms.uDensity.value = s.density;
    m.uniforms.uCloudBase.value = s.cloudBase;
    m.uniforms.uCloudTop.value = s.cloudBase + s.cloudThickness;
    m.uniforms.uSteps.value = STEPS_BY_QUALITY[s.quality];
    // Meteorological wind direction: degrees FROM north; the advection vector
    // points where the wind blows (from + 180°). World: north = −z, east = +x.
    const toward = ((s.windDirDeg + 180) % 360) * (Math.PI / 180);
    m.uniforms.uWind.value.set(Math.sin(toward) * s.windSpeed, -Math.cos(toward) * s.windSpeed);
    this.applyEphemeris();
  }

  /** Computes sun/moon positions + sidereal rotation for the current state. */
  private applyEphemeris() {
    const m = this.material;
    if (!m) return;
    const s = this.state;
    const date = new Date(EPOCH_UTC + s.hourUTC * 3600000);
    const jd = julianDay(date);
    const lon = s.longitude;
    const sun = sunPosition(date, s.latitude, lon);
    const moon = moonPosition(date, s.latitude, lon);
    const [sx, sy, sz] = this.altAzToWorld(sun.alt, sun.az);
    const [mx, my, mz] = this.altAzToWorld(moon.alt, moon.az);
    m.uniforms.uSunDir.value.set(sx, sy, sz).normalize();
    m.uniforms.uMoonDir.value.set(mx, my, mz).normalize();
    const sunAltDeg = (sun.alt * 180) / Math.PI;
    // Night factor: 0 when the sun is above +2°, 1 below −14° (civil→nautical).
    const night = clamp01((2 - sunAltDeg) / 16);
    m.uniforms.uNight.value = night;
    // Sunlight tint: warm when low (Rayleigh extinction), white when high.
    const warmth = clamp01(1 - Math.max(sunAltDeg, -5) / 30);
    m.uniforms.uSunColor.value.setRGB(1, 1 - 0.45 * warmth, 1 - 0.72 * warmth);
    // Moonlight: brightness ∝ illuminated fraction × altitude factor.
    const illum = moonPhaseIllumination(jd);
    const moonUp = clamp01(my * 4 + 0.15);
    m.uniforms.uMoonColor.value.setRGB(0.62, 0.68, 0.85).multiplyScalar(0.25 + 0.75 * illum * moonUp);
  }

  // ---- scene wiring -------------------------------------------------------------

  /** Applies the quality-tier × adaptive resolution to the host renderer. */
  private applyResolution() {
    const three = this.three;
    if (!three) return;
    if (this.savedPixelRatio === null) this.savedPixelRatio = three.renderer.getPixelRatio();
    const base = Math.min(window.devicePixelRatio || 1, 2);
    const target = Math.min(1, base * SCALE_BY_QUALITY[this.state.quality] * this.dynScale);
    three.renderer.setPixelRatio(Math.max(target, 0.25));
    // setPixelRatio alone is inert — three.js only consumes it inside setSize,
    // so the drawing buffer must be re-asserted here (updateStyle=false keeps
    // the host's 100 % CSS sizing untouched).
    const el = three.renderer.domElement;
    three.renderer.setSize(el.clientWidth || 640, el.clientHeight || 480, false);
  }

  /** True while any animation (wind / day cycle / orbit) keeps frames coming. */
  private isAnimating(): boolean {
    const s = this.state;
    return s.running || s.autoDay || s.autoOrbit;
  }

  private onControlsChange = () => {
    // Camera interaction restarts the loop when the idle gate stopped it.
    this.startTick();
  };

  private buildScene() {
    const three = this.three;
    if (!three) {
      this.draw2dFallback();
      return;
    }
    if (!this.mesh) {
      const { mesh, material } = createCloudQuad();
      this.mesh = mesh;
      this.material = material;
      three.scene.add(mesh);
      three.controls.addEventListener('change', this.onControlsChange);
      this.fitCamera();
    }
    this.syncUniforms();
    this.publishScience();
    three.setVisible(true);
    three.render();
    this.startTick();
  }

  private fitCamera() {
    const three = this.three;
    if (!three) return;
    const cam: PerspectiveCamera = three.camera;
    cam.position.set(0, 40, 1500);
    cam.near = 1;
    cam.far = 6e4;
    cam.updateProjectionMatrix();
    three.controls.target.set(0, 900, 0);
    three.controls.update?.();
    three.render();
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
    const rawDt = this.lastT ? (t - this.lastT) / 1000 : 0;
    const dt = Math.min(rawDt, 0.1);
    this.lastT = t;
    const s = this.state;
    // Adaptive resolution: track FPS (EMA) and shrink/grow the internal render
    // resolution within the quality tier so weak GPUs stay interactive. The
    // measurement is skipped for suspicious gaps (tab switches, first frame).
    if (rawDt > 0 && rawDt < 0.5) {
      const fps = 1 / rawDt;
      this.fpsEma = this.fpsEma ? this.fpsEma * 0.9 + fps * 0.1 : fps;
      if (this.fpsEma < 24 && this.dynScale > 0.35) {
        this.dynScale = Math.max(0.35, this.dynScale * 0.85);
        this.applyResolution();
        this.fpsEma = 0; // re-measure at the new scale
      } else if (this.fpsEma > 55 && this.dynScale < 1) {
        this.dynScale = Math.min(1, this.dynScale * 1.12);
        this.applyResolution();
        this.fpsEma = 0;
      }
    }
    if (s.running) this.simTime += dt;
    if (s.autoDay && dt > 0) {
      s.hourUTC = (s.hourUTC + dt * HOURS_PER_SECOND) % 24;
      this.applyEphemeris();
    }
    if (s.autoOrbit && dt > 0) {
      const cam = three.camera;
      const rad = Math.hypot(cam.position.x, cam.position.z);
      if (rad > 1e-4) {
        const ang = Math.atan2(cam.position.z, cam.position.x) + 0.04 * dt;
        cam.position.x = rad * Math.cos(ang);
        cam.position.z = rad * Math.sin(ang);
      }
    }
    mat.uniforms.uTime.value = this.simTime;
    three.controls.update?.();
    three.camera.updateMatrixWorld();
    mat.uniforms.uCamWorld.value.copy(three.camera.matrixWorld);
    mat.uniforms.uProjInv.value.copy(three.camera.projectionMatrixInverse);
    three.render();
    // Idle gate: with every animation off, stop the loop — the controls
    // 'change' listener restarts it on the next camera interaction. The
    // !this.rafId guard is load-bearing: controls.update() above fires
    // 'change' mid-tick while rafId is 0, which scheduled an extra callback
    // chain; combined with the schedule below the chain count doubled per
    // frame and froze the page (the "renders one frame, then dies" bug).
    if (this.isAnimating() && !this.rafId) this.rafId = requestAnimationFrame(this.tick);
  };

  private clear3d() {
    const three = this.three;
    if (three) {
      three.controls.removeEventListener('change', this.onControlsChange);
      if (this.savedPixelRatio !== null) {
        three.renderer.setPixelRatio(this.savedPixelRatio); // hand back a clean renderer
        this.savedPixelRatio = null;
      }
    }
    if (three && this.mesh) {
      three.scene.remove(this.mesh);
    }
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
    const lstRad = gmst(jd) + (s.longitude * Math.PI) / 180;
    const lstH = ((lstRad * 12) / Math.PI + 24) % 24;
    const toDeg = (r: number) => (r * 180) / Math.PI;
    // Effective extinction σ = 0.006 × density (1/m), matching the shader's
    // main march & lightMarch (both use d·0.006·uDensity). Representative
    // vertical optical depth τ = σ × thickness × 0.55 (mid-slab coverage).
    const sigma = 0.006 * s.density; // extinction coefficient (1/m) used by the shader
    const tau = sigma * s.cloudThickness * 0.55; // representative mid-slab optical depth
    const windRad = ((s.windDirDeg + 180) * Math.PI) / 180; // toward-direction
    const u = s.windSpeed * Math.sin(windRad); // eastward component
    const v = s.windSpeed * Math.cos(windRad); // northward component (+ toward north)
    const metrics: ScienceMetric[] = [
      { key: 'sun_alt', label: 'Solar altitude', value: toDeg(sun.alt).toFixed(2), unit: '°', severity: 'info', hint: this.zh ? '太阳地平高度（Meeus 低精度历表，±1′）。' : 'Solar altitude (Meeus low-precision, ±1′).' },
      { key: 'sun_az', label: 'Solar azimuth', value: toDeg(sun.az).toFixed(2), unit: '°', severity: 'info', hint: this.zh ? '太阳方位角（北起东向）。' : 'Solar azimuth (from north, eastward).' },
      { key: 'moon_alt', label: 'Lunar altitude', value: toDeg(moon.alt).toFixed(2), unit: '°', severity: 'info', hint: this.zh ? '月球地平高度（主项历表，±0.3°）。' : 'Lunar altitude (main-terms ephemeris, ±0.3°).' },
      { key: 'moon_illum', label: 'Moon illumination', value: (moonPhaseIllumination(jd) * 100).toFixed(1), unit: '%', severity: 'info', hint: this.zh ? '月球被照亮比例（相位角余弦）。' : 'Illuminated lunar disk fraction.' },
      { key: 'lst', label: 'LST', value: lstH.toFixed(3), unit: 'h', severity: 'info', hint: this.zh ? '当地恒星时（GMST + 经度）。' : 'Local sidereal time (GMST + longitude).' },
      { key: 'tau', label: 'Cloud τ', value: tau.toFixed(2), unit: '', severity: 'info', hint: this.zh ? '云层代表性垂直光学深度 σ·Δz。' : 'Representative vertical optical depth σ·Δz.' },
      { key: 'wind_uv', label: 'Wind (u, v)', value: `${u.toFixed(1)}, ${v.toFixed(1)}`, unit: 'm/s', severity: 'info', hint: this.zh ? '风矢量东向/北向分量（气象风向 +180° 为吹向）。' : 'Eastward/northward wind components (from-direction +180°).' },
      { key: 'g_hg', label: 'g (HG)', value: '0.60', unit: '', severity: 'info', hint: this.zh ? 'Henyey–Greenstein 相函数不对称因子（水云典型值）。' : 'Henyey–Greenstein asymmetry factor (typical water cloud).' },
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
    // Host convention: reallocate per draw (dpr hook lives in the setters).
    canvas.width = canvas.clientWidth || 800;
    canvas.height = canvas.clientHeight || 500;
    g.fillStyle = '#0a1018';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = 'rgba(150, 165, 185, 0.85)';
    g.textAlign = 'center';
    g.font = `14px ${this.zh ? '"Microsoft YaHei"' : 'Consolas'}, monospace`;
    g.fillText(
      this.zh ? 'WebGL 3D 容器不可用，无法渲染体积云。' : 'WebGL 3D container unavailable — volumetric clouds disabled.',
      canvas.width / 2,
      canvas.height / 2,
    );
  }
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}
function clamp01(x: number): number {
  return clamp(x, 0, 1);
}

export default function createCloudPlugin(): Plugin {
  return new CloudPlugin();
}
