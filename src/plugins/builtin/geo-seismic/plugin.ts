// ==========================================================================
// geo-seismic — Seismic Wave Propagation workbench
//
// Four linked views over one earth model:
//   wavefield   P/S cross-section animation (explicit FDTD, sponge boundary)
//   traveltime  spherical ray-theory curves + natural shadow zones
//   seismogram  synthetic P/S/surface record with picks
//   beachball   focal mechanism (double-couple radiation pattern)
//   magnitudes  Richter / moment / Mercalli / energy comparison
// Scientific outputs publish the P and S arrival times, shadow-zone edges,
// radiated energy and the focal-mechanism nodal planes.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { seismicManifest } from './manifest';
import { seismicFigurePanels } from './figure';
import {
  SEISMIC_WAVE_WGSL,
  beachballGrid,
  cachedTravelTimeCurve,
  clearTravelTimeCache,
  createWaveSim,
  detectShadowZones,
  energyJoules,
  inShadowZone,
  magnitudeScales,
  nodalPlanes,
  parseVelocityModel,
  pickPhase,
  runSeismicBenchmarks,
  setCustomVelocityModel,
  stepWaveSim,
  synthesizeSeismogram,
  travelTimeAtDelta,
  waveFieldMax,
  type Seismogram,
  type WaveSim,
} from './kernel';

export { seismicManifest } from './manifest';

type ViewMode = 'wavefield' | 'traveltime' | 'seismogram' | 'beachball' | 'magnitudes';

const VIEWS: Array<{ value: ViewMode; en: string; zh: string }> = [
  { value: 'wavefield', en: 'Wave-field cross-section', zh: '波场剖面动画' },
  { value: 'traveltime', en: 'Travel times & shadow zone', zh: '走时曲线与影区' },
  { value: 'seismogram', en: 'Seismogram & phases', zh: '地震图与震相' },
  { value: 'beachball', en: 'Focal mechanism beachball', zh: '震源机制沙滩球' },
  { value: 'magnitudes', en: 'Magnitude scales', zh: '震级标度对比' },
];

interface State {
  mode: ViewMode;
  magnitude: number;
  distanceDeg: number;
  depthKm: number;
  strike: number;
  dip: number;
  rake: number;
  playing: boolean;
  gpu: boolean;
}

export class SeismicPlugin implements Plugin {
  readonly manifest = seismicManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private sim: WaveSim | null = null;
  private seismogram: Seismogram | null = null;
  private raf: number | null = null;
  private lastFrame = 0;
  private dataName = '';
  private gpuCompiled = false;
  private state: State = {
    mode: 'wavefield',
    magnitude: 6.2,
    distanceDeg: 58,
    depthKm: 15,
    strike: 35,
    dip: 70,
    rake: -120,
    // Open paused: the wave field is a static first frame until the user
    // presses Play (or Advance one frame) so opening the lab costs no CPU/GPU.
    playing: false,
    gpu: false,
  };

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
    if (api.gpu?.available) {
      try {
        const kernel = api.gpu.compileKernel({
          label: 'geo-seismic-p-wave',
          wgsl: SEISMIC_WAVE_WGSL,
          entryPoint: 'main',
          workgroupSize: [8, 8, 1],
          bindings: [
            { binding: 0, bufferType: 'uniform' },
            { binding: 1, bufferType: 'read-only-storage' },
            { binding: 2, bufferType: 'read-only-storage' },
            { binding: 3, bufferType: 'read-only-storage' },
            { binding: 4, bufferType: 'storage' },
          ],
        });
        this.gpuCompiled = Boolean(kernel);
        this.state.gpu = this.gpuCompiled;
        if (!kernel) api.log('warn', 'WebGPU wave kernel failed to compile; using the CPU FDTD path.');
      } catch (err) {
        api.log('warn', 'WebGPU wave kernel unavailable', err);
      }
    }
  }

  async destroy() {
    this.stopLoop();
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (this.state.mode === 'wavefield' && this.state.playing) this.startLoop();
  }

  async deactivate() {
    this.stopLoop();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
    if (this.state.mode === 'wavefield' && this.state.playing) this.startLoop();
  }

  getParams(): ParamDefinition[] {
    const s = this.state;
    return [
      {
        key: 'mode',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: VIEWS.map((v) => ({ value: v.value, label: this.zh ? v.zh : v.en, labelI18n: { 'zh-CN': v.zh, 'en-US': v.en } })),
        value: s.mode,
      },
      {
        key: 'magnitude',
        label: 'Magnitude Mw',
        labelI18n: { 'zh-CN': '矩震级 Mw', 'en-US': 'Moment magnitude Mw' },
        type: 'range',
        min: 2,
        max: 9,
        step: 0.1,
        value: s.magnitude,
      },
      {
        key: 'distanceDeg',
        label: 'Epicentral distance (°)',
        labelI18n: { 'zh-CN': '震中距 (°)', 'en-US': 'Epicentral distance (°)' },
        type: 'range',
        min: 1,
        max: 180,
        step: 1,
        value: s.distanceDeg,
      },
      {
        key: 'depthKm',
        label: 'Hypocentre depth (km)',
        labelI18n: { 'zh-CN': '震源深度 (km)', 'en-US': 'Hypocentre depth (km)' },
        type: 'number',
        min: 1,
        max: 700,
        step: 1,
        value: s.depthKm,
      },
      {
        key: 'strike',
        label: 'Strike (°)',
        labelI18n: { 'zh-CN': '走向 (°)', 'en-US': 'Strike (°)' },
        type: 'range',
        min: 0,
        max: 360,
        step: 1,
        value: s.strike,
        visibleWhen: { key: 'mode', in: ['beachball'] },
      },
      {
        key: 'dip',
        label: 'Dip (°)',
        labelI18n: { 'zh-CN': '倾角 (°)', 'en-US': 'Dip (°)' },
        type: 'range',
        min: 1,
        max: 90,
        step: 1,
        value: s.dip,
        visibleWhen: { key: 'mode', in: ['beachball'] },
      },
      {
        key: 'rake',
        label: 'Rake (°)',
        labelI18n: { 'zh-CN': '滑动角 (°)', 'en-US': 'Rake (°)' },
        type: 'range',
        min: -180,
        max: 180,
        step: 5,
        value: s.rake,
        visibleWhen: { key: 'mode', in: ['beachball'] },
      },
      actionButton('play', 'Play / pause wave field', '播放 / 暂停波场'),
      actionButton('step', 'Advance one frame', '单步推进'),
      actionButton('resetField', 'Reset wave field', '重置波场'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export phase table CSV', '导出震相表 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio', 'primary'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let redraw = false;
    const num = (k: string, apply: (n: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (apply(params[k] as number)) redraw = true;
      }
    };
    if (typeof params.mode === 'string' && VIEWS.some((v) => v.value === params.mode)) {
      if (params.mode !== this.state.mode) {
        this.state.mode = params.mode as ViewMode;
        redraw = true;
        if (this.state.mode === 'wavefield' && this.state.playing) this.startLoop();
        else this.stopLoop();
      }
    }
    num('magnitude', (n) => {
      const v = Math.min(9, Math.max(2, n));
      if (v === this.state.magnitude) return false;
      this.state.magnitude = v;
      this.seismogram = null;
      return true;
    });
    num('distanceDeg', (n) => {
      const v = Math.min(180, Math.max(1, Math.round(n)));
      if (v === this.state.distanceDeg) return false;
      this.state.distanceDeg = v;
      this.seismogram = null;
      return true;
    });
    num('depthKm', (n) => {
      const v = Math.min(700, Math.max(1, n));
      if (v === this.state.depthKm) return false;
      this.state.depthKm = v;
      this.seismogram = null;
      return true;
    });
    num('strike', (n) => {
      const v = Math.min(360, Math.max(0, n));
      if (v === this.state.strike) return false;
      this.state.strike = v;
      return true;
    });
    num('dip', (n) => {
      const v = Math.min(90, Math.max(1, n));
      if (v === this.state.dip) return false;
      this.state.dip = v;
      return true;
    });
    num('rake', (n) => {
      const v = Math.min(180, Math.max(-180, n));
      if (v === this.state.rake) return false;
      this.state.rake = v;
      return true;
    });
    if (actionFired(params, 'play')) {
      this.state.playing = !this.state.playing;
      if (this.state.playing && this.state.mode === 'wavefield') this.startLoop();
      else this.stopLoop();
      redraw = true;
    }
    if (actionFired(params, 'step')) {
      this.ensureSim();
      if (this.sim) {
        for (let i = 0; i < 6; i += 1) stepWaveSim(this.sim);
      }
      redraw = true;
    }
    if (actionFired(params, 'resetField')) {
      this.sim = null;
      this.ensureSim();
      redraw = true;
    }
    if (actionFired(params, 'benchmark')) this.runBenchmarks();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
    if (redraw) this.draw();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const text = await file.text();
    const rows = parseVelocityModel(text);
    if (rows.length < 2) {
      notify(
        this.api,
        'warning',
        'Velocity model needs at least two rows: depth_km, vp_km_s, vs_km_s[, density].',
        '速度模型至少需要两行：depth_km, vp_km_s, vs_km_s[, density]。',
      );
      return;
    }
    setCustomVelocityModel(rows);
    clearTravelTimeCache();
    this.dataName = file.name;
    this.seismogram = null;
    this.sim = null;
    this.draw();
    notify(
      this.api,
      'success',
      `Loaded ${rows.length}-row velocity model → ray-theory curves recomputed.`,
      `已载入 ${rows.length} 行速度模型 → 已重算射线走时曲线。`,
    );
  }

  // ---- simulation loop ----------------------------------------------------

  private ensureSim(): void {
    if (!this.sim) {
      this.sim = createWaveSim({ nx: 180, ny: 120, dxKm: 4.5, sourceFreqHz: 2.2 });
      // Prime a few steps so opening the view shows a loaded (static) wave
      // field instead of an empty grid. Playback still requires Play.
      for (let i = 0; i < 24; i += 1) stepWaveSim(this.sim);
    }
  }

  private startLoop(): void {
    if (this.raf !== null || !this.ctx) return;
    this.ensureSim();
    this.lastFrame = 0;
    const tick = (ts: number) => {
      if (!this.ctx || this.state.mode !== 'wavefield' || !this.state.playing) {
        this.raf = null;
        return;
      }
      if (ts - this.lastFrame > 28) {
        this.lastFrame = ts;
        const sim = this.sim;
        if (sim) {
          for (let i = 0; i < 2; i += 1) stepWaveSim(sim);
        }
        this.draw();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop(): void {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  // ---- data / science outputs --------------------------------------------

  private currentSeismogram(): Seismogram {
    if (this.seismogram) return this.seismogram;
    this.seismogram = synthesizeSeismogram({
      distanceDeg: this.state.distanceDeg,
      magnitude: this.state.magnitude,
      depthKm: this.state.depthKm,
      seed: 20261027,
    });
    this.publishScience(this.seismogram);
    return this.seismogram;
  }

  private publishScience(sg: Seismogram): void {
    const p = sg.phases.find((x) => x.name === 'P');
    const s = sg.phases.find((x) => x.name === 'S');
    const pShadow = detectShadowZones('P')[0];
    const sShadow = detectShadowZones('S')[0];
    const scales = magnitudeScales(this.state.magnitude);
    const planes = nodalPlanes(this.state.strike, this.state.dip, this.state.rake);
    const metrics: ScienceMetric[] = [
      {
        key: 'p-arrival',
        label: this.zh ? 'P 波到时' : 'P arrival',
        value: p ? p.arrivalSec.toFixed(1) : '—',
        unit: 's',
        severity: p ? 'ok' : 'warn',
        hint: this.zh ? '球面射线理论首次到达' : 'first arrival from spherical ray theory',
      },
      {
        key: 's-arrival',
        label: this.zh ? 'S 波到时' : 'S arrival',
        value: s ? s.arrivalSec.toFixed(1) : '—',
        unit: 's',
        severity: s ? 'ok' : 'warn',
        hint: this.zh ? '外核 vS=0，超过约 103° 无直达 S 波' : 'no direct S beyond ~103° (vS = 0 in the outer core)',
      },
      {
        key: 's-p',
        label: 'S − P',
        value: p && s ? (s.arrivalSec - p.arrivalSec).toFixed(1) : '—',
        unit: 's',
        hint: this.zh ? '可用作震中距经验估计' : 'useful for an empirical distance estimate',
      },
      {
        key: 'p-shadow',
        label: this.zh ? 'P 影区' : 'P shadow',
        value: pShadow ? `${pShadow.fromDeg.toFixed(1)}–${pShadow.toDeg.toFixed(1)}` : '—',
        unit: '°',
        severity: inShadowZone(this.state.distanceDeg, 'P') ? 'warn' : 'info',
      },
      {
        key: 's-shadow',
        label: this.zh ? 'S 影区' : 'S shadow',
        value: sShadow ? `${sShadow.fromDeg.toFixed(1)}–${sShadow.toDeg.toFixed(1)}` : '—',
        unit: '°',
        severity: inShadowZone(this.state.distanceDeg, 'S') ? 'warn' : 'info',
      },
      {
        key: 'energy',
        label: this.zh ? '辐射能量' : 'Radiated energy',
        value: fmtMetric(energyJoules(this.state.magnitude), 4),
        unit: 'J',
      },
      {
        key: 'mmi',
        label: this.zh ? '10 km 烈度' : 'MMI @ 10 km',
        value: fmtMetric(scales.mmiAt10km, 3),
        unit: 'MMI',
      },
      {
        key: 'nodal',
        label: this.zh ? '节面走向' : 'Nodal strikes',
        value: `${planes[0]!.strike.toFixed(0)}° / ${planes[1]!.strike.toFixed(0)}°`,
        unit: '°',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmarks(): void {
    const results = runSeismicBenchmarks();
    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      `${passed}/${results.length} seismic benchmarks passed${failed.length ? `: ${failed.map((f) => f.id).join(', ')}` : ''}.`,
      `${passed}/${results.length} 项地震学基准通过${failed.length ? `：${failed.map((f) => f.id).join('、')}` : ''}。`,
    );
    for (const r of results) this.api.log(r.pass ? 'info' : 'warn', `benchmark ${r.id}: ${r.detail}`);
  }

  private exportCsv(): void {
    const sg = this.currentSeismogram();
    exportRowsCsv(
      this.api,
      'seismic-phases',
      ['phase', 'arrival_s', 'amplitude', 'frequency_hz'],
      sg.phases.map((p) => [p.name, p.arrivalSec.toFixed(3), p.amplitude.toExponential(4), p.frequency]),
    );
  }

  private async sendToFigure(): Promise<void> {
    const sg = this.currentSeismogram();
    const caption: Bilingual = {
      zh: `地震波传播：Mw ${this.state.magnitude.toFixed(1)}，震中距 ${this.state.distanceDeg}°，震源深度 ${this.state.depthKm} km；合成地震图含 P/S/面波震相。`,
      en: `Seismic wave propagation: Mw ${this.state.magnitude.toFixed(1)}, epicentral distance ${this.state.distanceDeg}°, hypocentre depth ${this.state.depthKm} km; synthetic record with P/S/surface phases.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '地震波传播分析', en: 'Seismic Wave Propagation Analysis' },
      caption,
      seismicFigurePanels({ seismogram: sg }),
    );
  }

  // ---- drawing ------------------------------------------------------------

  private draw(): void {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 820;
    canvas.height = canvas.clientHeight || 460;
    const g = canvas.getContext('2d');
    if (!g) return;
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;

    switch (this.state.mode) {
      case 'traveltime':
        this.drawTravelTimes(g, canvas, zh);
        break;
      case 'seismogram':
        this.drawSeismogram(g, canvas, zh);
        break;
      case 'beachball':
        this.drawBeachball(g, canvas, zh);
        break;
      case 'magnitudes':
        this.drawMagnitudes(g, canvas, zh);
        break;
      default:
        this.drawWavefield(g, canvas, zh);
    }
  }

  private drawHeader(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean): void {
    const view = VIEWS.find((v) => v.value === this.state.mode)!;
    g.textAlign = 'left';
    g.fillStyle = 'rgba(230,238,248,0.96)';
    g.font = `14px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? view.zh : view.en, 22, 26);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(150,168,190,0.9)';
    g.textAlign = 'right';
    const model = this.dataName ? (zh ? `模型：${this.dataName}` : `model: ${this.dataName}`) : zh ? '内置 PREM 类模型' : 'built-in PREM-like model';
    const gpu = this.gpuCompiled ? 'WebGPU kernel ready' : 'CPU FDTD';
    g.fillText(`${model} · ${gpu}`, canvas.width - 22, 26);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.moveTo(20, 38);
    g.lineTo(canvas.width - 20, 38);
    g.stroke();
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, lines: string[]): void {
    g.textAlign = 'left';
    g.font = `11px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const y0 = canvas.height - 14 - (lines.length - 1) * 15;
    lines.forEach((line, i) => {
      g.fillStyle = i === 0 ? 'rgba(205,216,230,0.95)' : 'rgba(155,170,190,0.9)';
      g.fillText(line, 24, y0 + i * 15);
    });
  }

  // ---- wave field ---------------------------------------------------------

  private drawWavefield(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean): void {
    this.drawHeader(g, canvas, zh);
    this.ensureSim();
    const sim = this.sim;
    if (!sim) return;
    const top = 54;
    const bottom = canvas.height - 76;
    const gap = 18;
    const panelW = (canvas.width - 60 - gap) / 2;
    const panelH = bottom - top;
    const pMax = Math.max(waveFieldMax(sim.pCur), 1e-7);
    const sMax = Math.max(waveFieldMax(sim.sCur), 1e-7);
    this.drawFieldPanel(g, sim.pCur, sim, 22, top, panelW, panelH, pMax, 'P', zh);
    this.drawFieldPanel(g, sim.sCur, sim, 22 + panelW + gap, top, panelW, panelH, sMax, 'S', zh);

    const pSpeed = sim.vp[Math.round(sim.ny * 0.2) * sim.nx + Math.round(sim.nx / 2)] ?? 6;
    const sSpeed = sim.vs[Math.round(sim.ny * 0.2) * sim.nx + Math.round(sim.nx / 2)] ?? 3.5;
    this.drawFooter(g, canvas, [
      zh
        ? `波场时间 ${sim.time.toFixed(2)} s · 步数 ${sim.steps} · 网格 ${sim.nx}×${sim.ny} · dx=${sim.dxKm} km${this.state.playing ? '' : ' · 已暂停（点播放继续）'}`
        : `wave-field time ${sim.time.toFixed(2)} s · ${sim.steps} steps · grid ${sim.nx}×${sim.ny} · dx=${sim.dxKm} km${this.state.playing ? '' : ' · paused (press Play)'}`,
      zh
        ? `近地表速度 vP=${pSpeed.toFixed(2)} km/s，vS=${sSpeed.toFixed(2)} km/s；CFL dt=${sim.dt.toFixed(4)} s。`
        : `near-surface vP=${pSpeed.toFixed(2)} km/s, vS=${sSpeed.toFixed(2)} km/s; CFL dt=${sim.dt.toFixed(4)} s.`,
      zh
        ? '红/蓝为膨胀/压缩极性（P）与横波振幅（S）；波前经过 100 km 与 220 km 界面时发生折射。'
        : 'Red/blue encode dilatation/compression (P) and shear amplitude (S); wavefronts refract at the 100 km and 220 km interfaces.',
    ]);
  }

  private drawFieldPanel(
    g: CanvasRenderingContext2D,
    field: Float32Array,
    sim: WaveSim,
    x0: number,
    y0: number,
    w: number,
    h: number,
    maxAbs: number,
    label: string,
    zh: boolean,
  ): void {
    const off = document.createElement('canvas');
    off.width = sim.nx;
    off.height = sim.ny;
    const og = off.getContext('2d');
    if (!og) return;
    const img = og.createImageData(sim.nx, sim.ny);
    for (let i = 0; i < field.length; i += 1) {
      const v = Math.max(-1, Math.min(1, field[i]! / maxAbs));
      const k = i * 4;
      if (v >= 0) {
        img.data[k] = Math.round(40 + 215 * v);
        img.data[k + 1] = Math.round(70 + 90 * (1 - v));
        img.data[k + 2] = Math.round(110 * (1 - v));
      } else {
        img.data[k] = Math.round(40 * (1 + v));
        img.data[k + 1] = Math.round(120 + 60 * (1 + v));
        img.data[k + 2] = Math.round(170 + 85 * (1 + v));
      }
      img.data[k + 3] = 255;
    }
    og.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(off, x0, y0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.strokeRect(x0, y0, w, h);

    // layer boundary markers (100 km / 220 km in the 700 km section)
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'left';
    for (const depth of [100, 220, 410]) {
      const yy = y0 + (depth / 700) * h;
      if (yy >= y0 && yy <= y0 + h) {
        g.strokeStyle = 'rgba(255,255,255,0.14)';
        g.setLineDash([4, 4]);
        g.beginPath();
        g.moveTo(x0, yy);
        g.lineTo(x0 + w, yy);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(210,220,235,0.75)';
        g.fillText(`${depth} km`, x0 + 6, yy - 3);
      }
    }
    // source star
    const sx = x0 + (sim.sourceX / Math.max(1, sim.nx - 1)) * w;
    const sy = y0 + (sim.sourceY / Math.max(1, sim.ny - 1)) * h;
    g.fillStyle = '#ffd166';
    g.beginPath();
    for (let k = 0; k < 10; k += 1) {
      const r = k % 2 === 0 ? 7 : 3;
      const a = (Math.PI / 5) * k - Math.PI / 2;
      const px = sx + r * Math.cos(a);
      const py = sy + r * Math.sin(a);
      if (k === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fill();

    g.fillStyle = 'rgba(10,14,19,0.72)';
    g.fillRect(x0 + 8, y0 + 8, 70, 20);
    g.fillStyle = 'rgba(240,246,255,0.95)';
    g.font = `bold 12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(`${label}-wave`, x0 + 14, y0 + 22);
  }

  // ---- travel times -------------------------------------------------------

  private drawTravelTimes(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean): void {
    this.drawHeader(g, canvas, zh);
    const x0 = 64;
    const x1 = canvas.width - 34;
    const y0 = 62;
    const y1 = canvas.height - 84;
    const plotW = Math.max(10, x1 - x0);
    const plotH = Math.max(10, y1 - y0);
    const pCurve = cachedTravelTimeCurve('P');
    const sCurve = cachedTravelTimeCurve('S');
    const yMax = Math.max(...pCurve.map((p) => p.timeSec), ...sCurve.map((p) => p.timeSec), 1) * 1.06;

    // shadow bands
    const pz = detectShadowZones('P');
    const sz = detectShadowZones('S');
    for (const z of pz) {
      g.fillStyle = 'rgba(255,120,120,0.12)';
      g.fillRect(x0 + (z.fromDeg / 180) * plotW, y0, ((z.toDeg - z.fromDeg) / 180) * plotW, plotH);
    }
    for (const z of sz) {
      g.fillStyle = 'rgba(255,190,90,0.09)';
      g.fillRect(x0 + (z.fromDeg / 180) * plotW, y0, ((z.toDeg - z.fromDeg) / 180) * plotW, plotH);
    }

    // axes
    g.strokeStyle = 'rgba(255,255,255,0.2)';
    g.strokeRect(x0, y0, plotW, plotH);
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(160,175,195,0.9)';
    g.textAlign = 'center';
    for (let d = 0; d <= 180; d += 30) {
      const x = x0 + (d / 180) * plotW;
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x, y1);
      g.stroke();
      g.fillText(`${d}°`, x, y1 + 15);
    }
    g.textAlign = 'right';
    for (let k = 0; k <= 4; k += 1) {
      const t = (yMax * k) / 4;
      const y = y1 - (t / yMax) * plotH;
      g.strokeStyle = 'rgba(255,255,255,0.07)';
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x1, y);
      g.stroke();
      g.fillText(`${t.toFixed(0)}`, x0 - 8, y + 3);
    }

    const plot = (curve: typeof pCurve, color: string) => {
      let started = false;
      g.strokeStyle = color;
      g.lineWidth = 1.8;
      g.beginPath();
      for (const b of curve) {
        if (b.deltaDeg > 180) continue;
        const x = x0 + (b.deltaDeg / 180) * plotW;
        const y = y1 - (b.timeSec / yMax) * plotH;
        if (!started) {
          g.moveTo(x, y);
          started = true;
        } else {
          g.lineTo(x, y);
        }
      }
      g.stroke();
    };
    plot(pCurve, '#7ad7ff');
    plot(sCurve, '#ffb454');

    // current-distance marker and predicted arrivals
    const dx = x0 + (this.state.distanceDeg / 180) * plotW;
    g.strokeStyle = 'rgba(255,209,102,0.75)';
    g.setLineDash([5, 4]);
    g.beginPath();
    g.moveTo(dx, y0);
    g.lineTo(dx, y1);
    g.stroke();
    g.setLineDash([]);
    const pT = travelTimeAtDelta(this.state.distanceDeg, 'P');
    const sT = travelTimeAtDelta(this.state.distanceDeg, 'S');
    const dot = (t: number, color: string) => {
      if (!Number.isFinite(t)) return;
      const y = y1 - (t / yMax) * plotH;
      g.fillStyle = color;
      g.beginPath();
      g.arc(dx, y, 4, 0, Math.PI * 2);
      g.fill();
    };
    dot(pT, '#7ad7ff');
    dot(sT, '#ffb454');

    g.textAlign = 'left';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = '#7ad7ff';
    g.fillText('P', x0 + 8, y0 + 16);
    g.fillStyle = '#ffb454';
    g.fillText('S', x0 + 30, y0 + 16);
    g.fillStyle = 'rgba(255,120,120,0.8)';
    g.fillText(zh ? 'P 影区' : 'P shadow', x0 + 56, y0 + 16);
    g.fillStyle = 'rgba(255,190,90,0.8)';
    g.fillText(zh ? 'S 影区' : 'S shadow', x0 + 118, y0 + 16);

    this.drawFooter(g, canvas, [
      zh
        ? `Δ=${this.state.distanceDeg}°，P 到时 ${Number.isFinite(pT) ? `${pT.toFixed(1)} s` : '无直达波'}，S 到时 ${Number.isFinite(sT) ? `${sT.toFixed(1)} s` : '无直达波'}。`
        : `Δ=${this.state.distanceDeg}°, P arrival ${Number.isFinite(pT) ? `${pT.toFixed(1)} s` : 'no direct ray'}, S arrival ${Number.isFinite(sT) ? `${sT.toFixed(1)} s` : 'no direct ray'}.`,
      zh
        ? `P 影区 ${pz.map((z) => `${z.fromDeg.toFixed(1)}–${z.toDeg.toFixed(1)}°`).join('、') || '未检出'}；S 影区 ${sz.map((z) => `${z.fromDeg.toFixed(1)}–${z.toDeg.toFixed(1)}°`).join('、') || '未检出'}。`
        : `P shadow ${pz.map((z) => `${z.fromDeg.toFixed(1)}–${z.toDeg.toFixed(1)}°`).join(', ') || 'none'}; S shadow ${sz.map((z) => `${z.fromDeg.toFixed(1)}–${z.toDeg.toFixed(1)}°`).join(', ') || 'none'}.`,
      zh
        ? '曲线来自 1 km 径向速度模型的球面射线积分；核幔速度跃变产生影区。'
        : 'Curves integrate spherical rays through the 1-km radial model; the core–mantle velocity jump creates the shadow.',
    ]);
  }

  // ---- seismogram ---------------------------------------------------------

  private drawSeismogram(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean): void {
    this.drawHeader(g, canvas, zh);
    const sg = this.currentSeismogram();
    const x0 = 62;
    const x1 = canvas.width - 30;
    const y0 = 70;
    const y1 = canvas.height - 80;
    const plotW = Math.max(10, x1 - x0);
    const plotH = Math.max(10, y1 - y0);
    const mid = (y0 + y1) / 2;
    const norm = Math.max(...sg.amplitude.map(Math.abs), 1e-9);

    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.strokeRect(x0, y0, plotW, plotH);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.moveTo(x0, mid);
    g.lineTo(x1, mid);
    g.stroke();

    // phase-coloured bands
    const colors: Record<string, string> = { P: 'rgba(122,215,255,0.14)', S: 'rgba(255,180,84,0.12)', Surface: 'rgba(199,146,234,0.10)' };
    for (const ph of sg.phases) {
      const xa = x0 + (ph.arrivalSec / sg.durationSec) * plotW;
      g.fillStyle = colors[ph.name] ?? 'rgba(255,255,255,0.05)';
      g.fillRect(xa - 14, y0, 28, plotH);
    }

    g.strokeStyle = '#8ee6b0';
    g.lineWidth = 1.1;
    g.beginPath();
    const n = sg.amplitude.length;
    for (let k = 0; k < n; k += 1) {
      const x = x0 + (sg.times[k]! / sg.durationSec) * plotW;
      const y = mid - (sg.amplitude[k]! / norm) * (plotH * 0.43);
      if (k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    // picks
    for (const ph of sg.phases) {
      const picked = pickPhase(sg, ph);
      const xp = x0 + (ph.arrivalSec / sg.durationSec) * plotW;
      const xpick = x0 + (picked / sg.durationSec) * plotW;
      const color = ph.name === 'P' ? '#7ad7ff' : ph.name === 'S' ? '#ffb454' : '#c792ea';
      g.strokeStyle = color;
      g.setLineDash([4, 3]);
      g.beginPath();
      g.moveTo(xp, y0);
      g.lineTo(xp, y1);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = color;
      g.beginPath();
      g.arc(xpick, y0 + 12 + (ph.name === 'P' ? 0 : ph.name === 'S' ? 16 : 32), 3.5, 0, Math.PI * 2);
      g.fill();
      g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'left';
      g.fillText(`${ph.name} ${ph.arrivalSec.toFixed(1)} s`, xp + 5, y0 + 12 + (ph.name === 'P' ? 0 : ph.name === 'S' ? 16 : 32));
    }

    g.fillStyle = 'rgba(160,175,195,0.9)';
    g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    for (let k = 0; k <= 5; k += 1) {
      const t = (sg.durationSec * k) / 5;
      g.fillText(`${t.toFixed(0)} s`, x0 + (k / 5) * plotW, y1 + 15);
    }

    const p = sg.phases.find((x) => x.name === 'P');
    const s = sg.phases.find((x) => x.name === 'S');
    this.drawFooter(g, canvas, [
      zh
        ? `Mw ${sg.magnitude.toFixed(1)}，Δ=${sg.distanceDeg.toFixed(0)}°，震源深度 ${this.state.depthKm} km；记录长度 ${sg.durationSec.toFixed(0)} s。`
        : `Mw ${sg.magnitude.toFixed(1)}, Δ=${sg.distanceDeg.toFixed(0)}°, depth ${this.state.depthKm} km; record length ${sg.durationSec.toFixed(0)} s.`,
      zh
        ? `P ${p ? `${p.arrivalSec.toFixed(1)} s` : '缺失'} · S ${s ? `${s.arrivalSec.toFixed(1)} s` : '缺失'} · S−P ${p && s ? `${(s.arrivalSec - p.arrivalSec).toFixed(1)} s` : '—'}（拾取点用圆点标出）。`
        : `P ${p ? `${p.arrivalSec.toFixed(1)} s` : 'absent'} · S ${s ? `${s.arrivalSec.toFixed(1)} s` : 'absent'} · S−P ${p && s ? `${(s.arrivalSec - p.arrivalSec).toFixed(1)} s` : '—'} (picked peaks marked).`,
      zh ? '合成记录：Ricker 子波叠加，非实测地震图；灰带为震相到达窗口。' : 'Synthetic record: superposed Ricker wavelets, not observed data; shaded bands mark phase windows.',
    ]);
  }

  // ---- beachball ----------------------------------------------------------

  private drawBeachball(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean): void {
    this.drawHeader(g, canvas, zh);
    const grid = beachballGrid(this.state.strike, this.state.dip, this.state.rake, 120);
    const size = Math.min(canvas.width * 0.52, canvas.height - 150);
    const cx = canvas.width * 0.34;
    const cy = 76 + size / 2;
    const radius = size / 2;
    const cell = size / grid.n;

    // background disk
    g.fillStyle = '#f3f6fb';
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.fill();

    for (let j = 0; j < grid.n; j += 1) {
      for (let i = 0; i < grid.n; i += 1) {
        const k = j * grid.n + i;
        if (grid.mask[k] !== 1) continue;
        if (grid.polarity[k]! > 0) {
          g.fillStyle = '#12171e';
          g.fillRect(cx - radius + i * cell, cy - radius + j * cell, cell + 0.5, cell + 0.5);
        }
      }
    }

    // nodal lines: sign changes between neighbouring cells
    g.strokeStyle = '#ffd166';
    g.lineWidth = 1.4;
    for (let j = 0; j < grid.n; j += 1) {
      for (let i = 0; i < grid.n; i += 1) {
        const k = j * grid.n + i;
        if (!grid.mask[k]) continue;
        const right = i + 1 < grid.n ? k + 1 : k;
        const down = j + 1 < grid.n ? k + grid.n : k;
        if (grid.mask[right] && grid.polarity[right] !== grid.polarity[k]) {
          const x = cx - radius + (i + 1) * cell;
          const y = cy - radius + (j + 0.5) * cell;
          g.beginPath();
          g.moveTo(x, y - cell * 0.5);
          g.lineTo(x, y + cell * 0.5);
          g.stroke();
        }
        if (grid.mask[down] && grid.polarity[down] !== grid.polarity[k]) {
          const x = cx - radius + (i + 0.5) * cell;
          const y = cy - radius + (j + 1) * cell;
          g.beginPath();
          g.moveTo(x - cell * 0.5, y);
          g.lineTo(x + cell * 0.5, y);
          g.stroke();
        }
      }
    }

    g.strokeStyle = 'rgba(230,238,248,0.9)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(cx, cy, radius, 0, Math.PI * 2);
    g.stroke();

    g.fillStyle = 'rgba(220,230,245,0.9)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText('N', cx, cy - radius - 8);
    g.fillText('S', cx, cy + radius + 16);
    g.textAlign = 'right';
    g.fillText('W', cx - radius - 8, cy + 4);
    g.textAlign = 'left';
    g.fillText('E', cx + radius + 8, cy + 4);

    g.textAlign = 'left';
    const px = canvas.width * 0.64;
    let py = 82;
    const lines: Array<[string, string]> = [
      [zh ? '走向 Strike' : 'Strike', `${this.state.strike.toFixed(0)}°`],
      [zh ? '倾角 Dip' : 'Dip', `${this.state.dip.toFixed(0)}°`],
      [zh ? '滑动角 Rake' : 'Rake', `${this.state.rake.toFixed(0)}°`],
      [zh ? '机制类型' : 'Mechanism', this.mechanismType(zh)],
      [zh ? 'P 轴方位' : 'P-axis azimuth', `${((this.state.strike + 45) % 360).toFixed(0)}°`],
      [zh ? 'T 轴方位' : 'T-axis azimuth', `${((this.state.strike + 135) % 360).toFixed(0)}°`],
    ];
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    for (const [k, v] of lines) {
      g.fillStyle = 'rgba(150,168,190,0.9)';
      g.fillText(k, px, py);
      g.fillStyle = 'rgba(235,242,252,0.96)';
      g.fillText(v, px + 132, py);
      py += 26;
    }
    g.fillStyle = 'rgba(140,158,180,0.85)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const notes = zh
      ? ['下半球等面积投影：黑色=压缩（P 波初动向上），白色=膨胀。', '黄色曲线为节面（P 波辐射为零的方向）。', '双击参数面板可切换纯走滑/正断/逆冲示例。']
      : ['Lower-hemisphere equal-area projection: black = compression, white = dilatation.', 'Yellow curves are nodal surfaces where P radiation vanishes.', 'Adjust strike/dip/rake to explore strike-slip, normal and thrust mechanisms.'];
    notes.forEach((line, i) => g.fillText(line, px, py + 14 + i * 17));

    this.drawFooter(g, canvas, [
      zh
        ? `双力偶震源：走向 ${this.state.strike.toFixed(0)}°，倾角 ${this.state.dip.toFixed(0)}°，滑动角 ${this.state.rake.toFixed(0)}°。`
        : `Double-couple source: strike ${this.state.strike.toFixed(0)}°, dip ${this.state.dip.toFixed(0)}°, rake ${this.state.rake.toFixed(0)}°.`,
      zh ? '沙滩球由矩张量的远场 P 波辐射花样逐点计算，不依赖经验四象限模板。' : 'The beachball evaluates the far-field P radiation pattern of the moment tensor point by point.',
    ]);
  }

  private mechanismType(zh: boolean): string {
    const rake = ((this.state.rake % 360) + 360) % 360;
    if (rake < 45 || rake >= 315 || (rake >= 135 && rake < 225)) return zh ? '走滑断层' : 'Strike-slip';
    if (rake >= 45 && rake < 135) return zh ? '逆冲断层' : 'Thrust / reverse';
    return zh ? '正断层' : 'Normal';
  }

  // ---- magnitudes ---------------------------------------------------------

  private drawMagnitudes(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean): void {
    this.drawHeader(g, canvas, zh);
    const scales = magnitudeScales(this.state.magnitude);
    const rows: Array<{ label: string; value: string; color: string; fraction: number; hint: string }> = [
      {
        label: zh ? '矩震级 Mw' : 'Moment magnitude Mw',
        value: scales.mw.toFixed(1),
        color: '#7ad7ff',
        fraction: scales.mw / 9,
        hint: zh ? '由地震矩 M₀ 定义' : 'from seismic moment M₀',
      },
      {
        label: zh ? '里氏震级 ML（近似）' : 'Local magnitude ML (approx.)',
        value: scales.ml.toFixed(1),
        color: '#8ee6b0',
        fraction: scales.ml / 9,
        hint: zh ? '约 6.5 以上发生饱和' : 'saturates above ~6.5',
      },
      {
        label: zh ? '能量当量 log₁₀E' : 'Energy log₁₀E',
        value: fmtMetric(Math.log10(scales.energyJ), 4),
        color: '#ffd166',
        fraction: Math.log10(scales.energyJ) / 20,
        hint: zh ? 'Gutenberg–Richter: logE = 4.8 + 1.5M' : 'Gutenberg–Richter: logE = 4.8 + 1.5M',
      },
      {
        label: zh ? 'TNT 当量' : 'TNT equivalent',
        value: `${fmtMetric(scales.tntTons, 3)} t`,
        color: '#ff9f43',
        fraction: Math.min(1, Math.log10(scales.tntTons + 1) / 9),
        hint: zh ? '1 t TNT = 4.184×10⁹ J' : '1 t TNT = 4.184×10⁹ J',
      },
      {
        label: zh ? '10 km 处烈度' : 'MMI at 10 km',
        value: `MMI ${scales.mmiAt10km.toFixed(1)}`,
        color: '#ff6b6b',
        fraction: scales.mmiAt10km / 12,
        hint: zh ? '由 PGA 经验关系换算' : 'from an empirical PGA relation',
      },
      {
        label: zh ? '100 km 处烈度' : 'MMI at 100 km',
        value: `MMI ${scales.mmiAt100km.toFixed(1)}`,
        color: '#c792ea',
        fraction: scales.mmiAt100km / 12,
        hint: zh ? '几何衰减后' : 'after geometrical attenuation',
      },
    ];
    g.textAlign = 'left';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const x0 = 30;
    const barW = canvas.width - 380;
    rows.forEach((row, i) => {
      const y = 76 + i * 56;
      g.fillStyle = 'rgba(190,202,220,0.92)';
      g.fillText(row.label, x0, y);
      g.fillStyle = 'rgba(130,148,170,0.82)';
      g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillText(row.hint, x0, y + 15);
      g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      const bx = x0 + 250;
      g.fillStyle = 'rgba(255,255,255,0.07)';
      g.fillRect(bx, y - 10, barW, 12);
      g.fillStyle = row.color;
      g.fillRect(bx, y - 10, Math.max(2, barW * Math.max(0, Math.min(1, row.fraction))), 12);
      g.fillStyle = 'rgba(235,242,252,0.96)';
      g.textAlign = 'right';
      g.fillText(row.value, canvas.width - 26, y);
      g.textAlign = 'left';
    });

    this.drawFooter(g, canvas, [
      zh ? '震级是能量的对数标度：Mw 每增加 1，辐射能量约增加 31.6 倍。' : 'Magnitude is logarithmic in energy: +1 in Mw is ≈31.6× more radiated energy.',
      zh ? 'M₀ 与 Mw 采用 Hanks–Kanamori 关系；烈度换算只用于教学量级估计。' : 'M₀↔Mw uses Hanks–Kanamori; the intensity conversion is for teaching-scale estimation only.',
    ]);
  }
}

export default function createSeismicPlugin(): Plugin {
  return new SeismicPlugin();
}
