// ==========================================================================
// Astronomy pipeline plugin — implementation.
//
// Single-plugin research pipeline on the 2-D canvas: SIMULATE (synthetic
// CCD frames) → CALIBRATE (bias/dark/flat + cosmic rays) → DETECT + PHOTOMETRY
// (aperture fluxes, SNR, magnitudes). Reads real FITS files via loadData
// (`src/core/astro/fits.ts`); raw example data is never modified — every
// stage writes to new buffers.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { parseFits, writeFits, type FitsImage } from '@/core/astro/fits';
import { emit } from '@/core/events';
import { actionButton, actionFired, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import {
  calibrate,
  estimateBackground,
  flatZeroLevel,
  mulberry32,
  randomStarField,
  runPhotometry,
  simulateFrame,
  type BackgroundStats,
  type Detection,
  type SimFrame,
} from './kernel';
import { astroManifest } from './manifest';

type Stage = 'empty' | 'raw' | 'calibrated' | 'photometered';

interface State {
  mode: 'simulate' | 'file';
  frameSize: '256' | '384' | '512';
  nStars: number;
  fwhm: number;
  skyBrightness: number; // sky electrons
  exposureS: number;
  darkRate: number; // e⁻/s
  readNoise: number; // e⁻
  gain: number; // e⁻/ADU
  biasLevel: number; // ADU
  vignetting: number;
  cosmicRayRate: number; // hits / frame
  seed: number;
  thresholdSigma: number;
  apertureScale: number; // aperture radius = scale × FWHM
  zeropoint: number;
  display: 'raw' | 'calibrated';
  stage: Stage;
}

const DEFAULTS: State = {
  mode: 'simulate',
  frameSize: '384',
  nStars: 60,
  fwhm: 3.2,
  skyBrightness: 180,
  exposureS: 60,
  darkRate: 0.02,
  readNoise: 5,
  gain: 1.5,
  biasLevel: 512,
  vignetting: 0.22,
  cosmicRayRate: 12,
  seed: 20260321,
  thresholdSigma: 5,
  apertureScale: 2,
  zeropoint: 25,
  display: 'calibrated',
  stage: 'empty',
};

interface PresetPayload {
  mode?: 'simulate' | 'file';
  frameSize?: number;
  nStars?: number;
  fwhmPx?: number;
  skyElectrons?: number;
  exposureS?: number;
  darkRateEps?: number;
  readNoiseE?: number;
  gainEPerAdu?: number;
  biasAdu?: number;
  vignetting?: number;
  cosmicRaysPerFrame?: number;
  seed?: number;
  thresholdSigma?: number;
  apertureFwhmScale?: number;
  zeropoint?: number;
  /** Convenience for examples: run the full pipeline right after loading. */
  autoRun?: boolean;
}

interface PhotometryRow extends Detection {
  id: number;
}

export class AstroPipelinePlugin implements Plugin {
  readonly manifest = astroManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = { ...DEFAULTS };
  private sim: SimFrame | null = null;
  private fits: FitsImage | null = null;
  private calibrated: Float64Array | null = null;
  private crClipped = 0;
  private bkg: BackgroundStats | null = null;
  private detections: PhotometryRow[] = [];
  private fileName = '';

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.publishScience();
      this.renderView();
    });
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.renderView();
  }

  async deactivate() {
    this.ctx = null;
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.renderView();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- data I/O ------------------------------------------------------------------

  async loadData(file: File) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.fits') || name.endsWith('.fit')) {
      try {
        const buf = await file.arrayBuffer();
        this.fits = parseFits(buf);
        this.sim = null;
        this.calibrated = this.fits.pixels.slice();
        this.bkg = estimateBackground(this.fits.pixels);
        this.detections = [];
        this.crClipped = 0;
        this.state.mode = 'file';
        this.state.display = 'calibrated';
        this.state.stage = 'calibrated';
        this.fileName = file.name;
        this.state.frameSize = String(Math.max(this.fits.width, this.fits.height)) as State['frameSize'];
        this.publishScience();
        this.refreshParams();
        this.renderView();
        notify(
          this.api,
          'success',
          `FITS loaded: ${file.name} (${this.fits.width}×${this.fits.height}, BITPIX ${this.fits.bitpix})`,
          `FITS 已加载：${file.name}（${this.fits.width}×${this.fits.height}，BITPIX ${this.fits.bitpix}）`,
        );
      } catch (err) {
        notify(this.api, 'error', `FITS parse failed: ${String(err)}`, `FITS 解析失败：${String(err)}`);
        this.api.log('error', `[astro.pipeline] loadData: ${String(err)}`);
      }
      return;
    }
    if (name.endsWith('.json')) {
      try {
        const text = await this.api.readText(file);
        this.applyPreset(JSON.parse(text) as PresetPayload, file.name);
      } catch {
        notify(this.api, 'error', 'Failed to parse the preset JSON.', '预设 JSON 解析失败。');
      }
      return;
    }
    notify(this.api, 'warning', 'Only .fits/.fit images or .json presets are supported.', '仅支持 .fits/.fit 图像或 .json 预设。');
  }

  private applyPreset(p: PresetPayload, name: string) {
    const s = this.state;
    if (p.mode === 'simulate' || p.mode === 'file') s.mode = p.mode;
    if (typeof p.frameSize === 'number') s.frameSize = String(Math.min(Math.max(p.frameSize, 128), 512)) as State['frameSize'];
    if (typeof p.nStars === 'number') s.nStars = Math.max(0, Math.round(p.nStars));
    if (typeof p.fwhmPx === 'number') s.fwhm = Math.min(Math.max(p.fwhmPx, 1.2), 12);
    if (typeof p.skyElectrons === 'number') s.skyBrightness = Math.max(p.skyElectrons, 0);
    if (typeof p.exposureS === 'number') s.exposureS = Math.max(p.exposureS, 0);
    if (typeof p.darkRateEps === 'number') s.darkRate = Math.max(p.darkRateEps, 0);
    if (typeof p.readNoiseE === 'number') s.readNoise = Math.max(p.readNoiseE, 0);
    if (typeof p.gainEPerAdu === 'number') s.gain = Math.max(p.gainEPerAdu, 0.1);
    if (typeof p.biasAdu === 'number') s.biasLevel = Math.max(p.biasAdu, 0);
    if (typeof p.vignetting === 'number') s.vignetting = Math.min(Math.max(p.vignetting, 0), 0.5);
    if (typeof p.cosmicRaysPerFrame === 'number') s.cosmicRayRate = Math.max(0, Math.round(p.cosmicRaysPerFrame));
    if (typeof p.seed === 'number') s.seed = Math.round(p.seed);
    if (typeof p.thresholdSigma === 'number') s.thresholdSigma = Math.min(Math.max(p.thresholdSigma, 2), 12);
    if (typeof p.apertureFwhmScale === 'number') s.apertureScale = Math.min(Math.max(p.apertureFwhmScale, 1), 4);
    if (typeof p.zeropoint === 'number') s.zeropoint = p.zeropoint;
    if (p.autoRun) this.runFullPipeline(true);
    else {
      this.publishScience();
      this.refreshParams();
    }
    notify(this.api, 'success', `Preset loaded: ${name}`, `预设已加载：${name}`);
  }

  // ---- pipeline actions -------------------------------------------------------------

  private simulate(): SimFrame {
    const s = this.state;
    const size = Number(s.frameSize);
    const rng = mulberry32(s.seed ^ 0x9e3779b9);
    const stars = randomStarField(rng, size, size, s.nStars, [400, 90000]);
    return simulateFrame({
      width: size,
      height: size,
      fwhm: s.fwhm,
      beta: 2.5,
      stars,
      skyE: s.skyBrightness,
      biasAdu: s.biasLevel,
      darkE: s.darkRate * s.exposureS,
      readNoiseE: s.readNoise,
      gainEPerAdu: s.gain,
      vignetting: s.vignetting,
      cosmicRays: s.cosmicRayRate,
      seed: s.seed,
    });
  }

  /** SIMULATE → CALIBRATE → DETECT+PHOTOMETRY, one click. */
  private runFullPipeline(silent = false) {
    const s = this.state;
    if (s.mode === 'file' && this.fits) {
      // File mode: re-run detection/photometry on the imported pixels.
      this.calibrated = this.fits.pixels.slice();
      this.crClipped = 0;
      this.bkg = estimateBackground(this.calibrated);
      this.photometer();
    } else {
      this.sim = this.simulate();
      this.fileName = `sim_seed${this.state.seed}_${this.state.frameSize}px`;
      const result = calibrate(this.sim, { cosmicRaySigma: 6 });
      this.calibrated = result.pixels;
      this.crClipped = result.clipped;
      this.bkg = estimateBackground(result.pixels);
      this.photometer();
    }
    this.state.stage = 'photometered';
    this.state.display = 'calibrated';
    this.publishScience();
    this.refreshParams();
    this.renderView();
    if (!silent) {
      notify(
        this.api,
        'success',
        `Pipeline done: ${this.detections.length} sources (CR clipped: ${this.crClipped})`,
        `管线完成：检测到 ${this.detections.length} 个源（剔除宇宙线 ${this.crClipped} 个像素）`,
      );
    }
  }

  private calibrateAction() {
    const s = this.state;
    if (s.mode === 'file' && this.fits) {
      this.calibrated = this.fits.pixels.slice();
      this.crClipped = 0;
      this.bkg = estimateBackground(this.calibrated);
    } else {
      if (!this.sim) this.sim = this.simulate();
      const result = calibrate(this.sim, { cosmicRaySigma: 6 });
      this.calibrated = result.pixels;
      this.crClipped = result.clipped;
      this.bkg = estimateBackground(result.pixels);
    }
    this.state.stage = 'calibrated';
    this.state.display = 'calibrated';
    this.publishScience();
    this.renderView();
  }

  private photometer() {
    if (!this.calibrated || !this.bkg) return;
    const s = this.state;
    const rows = runPhotometry(
      this.calibrated,
      this.frameW(),
      this.frameH(),
      this.bkg,
      { thresholdSigma: s.thresholdSigma, minSeparation: Math.max(4, s.fwhm * 1.6) },
      {
        apertureR: s.fwhm * s.apertureScale,
        annulusIn: s.fwhm * s.apertureScale * 1.8,
        annulusOut: s.fwhm * s.apertureScale * 2.6,
        zeropoint: s.zeropoint,
      },
      s.gain,
      s.readNoise,
    );
    this.detections = rows.slice(0, 400).map((r, i) => ({ ...r, id: i + 1 }));
    this.state.stage = 'photometered';
  }

  private frameW(): number {
    return this.fits && this.state.mode === 'file' ? this.fits.width : this.sim?.width ?? Number(this.state.frameSize);
  }
  private frameH(): number {
    return this.fits && this.state.mode === 'file' ? this.fits.height : this.sim?.height ?? Number(this.state.frameSize);
  }

  /** Export the current calibrated frame as FITS (BITPIX=-64). */
  private exportFits() {
    if (!this.calibrated) {
      notify(this.api, 'warning', 'Nothing to export — run the pipeline first.', '暂无可导出数据 — 请先运行管线。');
      return;
    }
    const bytes = writeFits(this.calibrated, this.frameW(), this.frameH(), [
      ['OBJECT', this.fileName || 'astro.pipeline', 'source frame'],
      ['EXPTIME', Number(this.state.exposureS), 'seconds'],
      ['GAIN', Number(this.state.gain), 'e-/ADU'],
      ['RDNOISE', Number(this.state.readNoise), 'e-'],
      ['FILTER', 'V', 'photometric band (demo)'],
      ['CREATOR', 'Ergalics astro.pipeline', 'pipeline version 1.0.0'],
    ]);
    const blob = new Blob([bytes as BlobPart], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(this.fileName || 'frame').replace(/[^\w.-]+/g, '_')}_proc.fits`;
    a.click();
    // Defer revoking: a synchronous revoke can cancel the pending download.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    notify(this.api, 'success', 'Calibrated FITS exported.', '已导出校准后的 FITS 文件。');
  }

  // ---- params -----------------------------------------------------------------------

  getParams(): ParamDefinition[] {
    const zh = this.zh;
    const s = this.state;
    const r = (key: keyof State, label: string, labelZh: string, min: number, max: number, step: number): ParamDefinition => ({
      key,
      label,
      labelI18n: { 'zh-CN': labelZh, 'en-US': label },
      type: 'range',
      min,
      max,
      step,
      value: s[key] as number,
    });
    return [
      {
        key: 'mode',
        label: 'Data source',
        labelI18n: { 'zh-CN': '数据来源', 'en-US': 'Data source' },
        type: 'select',
        options: [
          { value: 'simulate', label: zh ? '内置仿真帧' : 'Built-in simulation' },
          { value: 'file', label: zh ? '导入 FITS 文件' : 'Imported FITS file' },
        ],
        value: s.mode,
      },
      {
        key: 'frameSize',
        label: 'Frame size (px)',
        labelI18n: { 'zh-CN': '画幅 (px)', 'en-US': 'Frame size (px)' },
        type: 'select',
        options: [
          { value: '256', label: '256 × 256' },
          { value: '384', label: '384 × 384' },
          { value: '512', label: '512 × 512' },
        ],
        value: s.frameSize,
      },
      r('nStars', 'Star count', '恒星数量', 0, 300, 1),
      r('fwhm', 'PSF FWHM (px)', '星象 FWHM (px)', 1.2, 10, 0.1),
      r('skyBrightness', 'Sky level (e⁻)', '天光背景 (e⁻)', 0, 2000, 5),
      r('exposureS', 'Exposure (s)', '曝光时间 (s)', 0, 600, 1),
      r('darkRate', 'Dark current (e⁻/s)', '暗流 (e⁻/s)', 0, 0.5, 0.005),
      r('readNoise', 'Read noise (e⁻)', '读出噪声 (e⁻)', 0.5, 20, 0.5),
      r('gain', 'Gain (e⁻/ADU)', '增益 (e⁻/ADU)', 0.2, 5, 0.05),
      r('biasLevel', 'Bias level (ADU)', '偏置电平 (ADU)', 0, 2000, 1),
      r('vignetting', 'Vignetting', '渐晕强度', 0, 0.5, 0.01),
      r('cosmicRayRate', 'Cosmic rays / frame', '宇宙线数 / 帧', 0, 100, 1),
      r('seed', 'Random seed', '随机种子', 1, 999999, 1),
      r('thresholdSigma', 'Detection threshold (σ)', '检测阈值 (σ)', 2, 12, 0.5),
      r('apertureScale', 'Aperture radius (×FWHM)', '孔径半径 (×FWHM)', 1, 4, 0.1),
      r('zeropoint', 'Photometric ZP (mag)', '测光零点 (mag)', 15, 30, 0.1),
      {
        key: 'display',
        label: 'Display frame',
        labelI18n: { 'zh-CN': '显示帧', 'en-US': 'Display frame' },
        type: 'select',
        options: [
          { value: 'raw', label: zh ? '原始帧' : 'Raw frame' },
          { value: 'calibrated', label: zh ? '校准帧' : 'Calibrated frame' },
        ],
        value: s.display,
      },
      actionButton('runPipeline', 'Run full pipeline', '一键运行全流程'),
      actionButton('resimulate', 'Re-simulate', '重新仿真'),
      actionButton('calibrateNow', 'Calibrate only', '仅校准'),
      actionButton('rephotometry', 'Re-run photometry', '重新测光'),
      actionButton('exportFits', 'Export FITS', '导出 FITS'),
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
    for (const key of ['nStars', 'fwhm', 'skyBrightness', 'exposureS', 'darkRate', 'readNoise', 'gain', 'biasLevel', 'vignetting', 'cosmicRayRate', 'seed', 'thresholdSigma', 'apertureScale', 'zeropoint'] as Array<keyof State>) {
      if (num(key)) changed = true;
    }
    if (params.mode === 'simulate' || params.mode === 'file') { s.mode = params.mode; changed = true; }
    if (params.frameSize === '256' || params.frameSize === '384' || params.frameSize === '512') {
      if (params.frameSize !== s.frameSize) { s.frameSize = params.frameSize; changed = true; }
    }
    if (params.display === 'raw' || params.display === 'calibrated') { s.display = params.display; changed = true; }

    if (actionFired(params, 'runPipeline')) { this.runFullPipeline(); return; }
    if (actionFired(params, 'resimulate')) {
      this.sim = this.simulate();
      this.fileName = `sim_seed${s.seed}_${s.frameSize}px`;
      const res = calibrate(this.sim, { cosmicRaySigma: 6 });
      this.calibrated = res.pixels;
      this.crClipped = res.clipped;
      this.bkg = estimateBackground(res.pixels);
      this.state.stage = 'calibrated';
      this.publishScience();
      this.renderView();
      return;
    }
    if (actionFired(params, 'calibrateNow')) { this.calibrateAction(); return; }
    if (actionFired(params, 'rephotometry')) {
      this.photometer();
      this.publishScience();
      this.renderView();
      return;
    }
    if (actionFired(params, 'exportFits')) { this.exportFits(); return; }
    if (actionFired(params, 'resetParams')) {
      this.state = { ...DEFAULTS };
      this.publishScience();
      this.refreshParams();
      this.renderView();
      return;
    }
    if (changed) {
      this.publishScience();
      this.renderView();
    }
  }

  // ---- canvas rendering ---------------------------------------------------------------

  private renderView() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    // Reallocation per draw is the host convention: the hooked width/height
    // setters enlarge the bitmap by the display dpr and reset the transform.
    // Without it the default 300×150 buffer gets CSS-stretched (giant text).
    canvas.width = canvas.clientWidth || 800;
    canvas.height = canvas.clientHeight || 560;
    const source =
      this.state.display === 'raw' ? (this.state.mode === 'file' ? this.fits?.pixels : this.sim?.raw) : this.calibrated;
    const w = this.frameW();
    const h = this.frameH();
    // Letterbox the frame into the canvas.
    const cw = canvas.width || 640;
    const ch = canvas.height || 480;
    g.fillStyle = '#07090d';
    g.fillRect(0, 0, cw, ch);
    if (!source || !w || !h) {
      g.fillStyle = 'rgba(150,165,185,0.8)';
      g.textAlign = 'center';
      g.font = `14px ${this.zh ? '"Microsoft YaHei"' : 'Consolas'}, monospace`;
      g.fillText(
        this.zh ? '点击「一键运行全流程」生成仿真帧并完成校准、检测与测光' : 'Click "Run full pipeline" to simulate, calibrate, detect and measure',
        cw / 2,
        ch / 2,
      );
      return;
    }
    const scale = Math.min(cw / w, ch / h) * 0.94;
    const dw = w * scale;
    const dh = h * scale;
    const ox = (cw - dw) / 2;
    const oy = (ch - dh) / 2;

    // Percentile stretch (0.1% .. 99.7% of the working frame) → heatmap.
    const img = this.renderToImageData(source, w, h);
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    off.getContext('2d')?.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = false;
    g.drawImage(off, ox, oy, dw, dh);
    g.imageSmoothingEnabled = true;

    // Overlays: frame border + detection apertures.
    g.strokeStyle = 'rgba(120,140,170,0.4)';
    g.lineWidth = 1;
    g.strokeRect(ox, oy, dw, dh);
    const apR = this.state.fwhm * this.state.apertureScale * scale;
    const annOut = this.state.fwhm * this.state.apertureScale * 2.6 * scale;
    g.font = '10px Consolas, monospace';
    for (const d of this.detections) {
      const x = ox + (d.x + 0.5) * scale;
      const y = oy + (d.y + 0.5) * scale;
      g.strokeStyle = 'rgba(80,220,160,0.9)';
      g.beginPath();
      g.arc(x, y, apR, 0, Math.PI * 2);
      g.stroke();
      g.strokeStyle = 'rgba(120,180,255,0.35)';
      g.beginPath();
      g.arc(x, y, annOut, 0, Math.PI * 2);
      g.stroke();
      if (this.detections.length <= 30) {
        g.fillStyle = 'rgba(140,255,200,0.95)';
        g.fillText(`#${d.id}`, x + apR + 2, y - apR);
      }
    }
    // Caption strip.
    g.fillStyle = 'rgba(140,160,190,0.9)';
    g.font = `12px ${this.zh ? '"Microsoft YaHei"' : 'Consolas'}, monospace`;
    const label =
      this.state.display === 'raw'
        ? this.zh
          ? `原始帧 ${w}×${h}${this.state.mode === 'file' ? ' · FITS 导入' : ' · 仿真'}`
          : `RAW ${w}×${h}${this.state.mode === 'file' ? ' · FITS import' : ' · simulated'}`
        : this.zh
          ? `校准帧 ${w}×${h} · 背景 ${this.bkg?.medianAdu.toFixed(1) ?? '—'} ADU · σ ${this.bkg?.sigmaAdu.toFixed(2) ?? '—'}`
          : `CALIBRATED ${w}×${h} · bkg ${this.bkg?.medianAdu.toFixed(1) ?? '—'} ADU · σ ${this.bkg?.sigmaAdu.toFixed(2) ?? '—'}`;
    g.fillText(label, ox, oy + dh + 18);
  }

  /** Percentile-stretched heat colormap of the working frame. */
  private renderToImageData(pixels: Float64Array, w: number, h: number): ImageData {
    const sampled: number[] = [];
    const stride = Math.max(1, Math.floor(Math.sqrt(pixels.length / 20000)));
    for (let i = 0; i < pixels.length; i += stride) sampled.push(pixels[i] ?? 0);
    sampled.sort((a, b) => a - b);
    const lo = sampled[Math.floor(sampled.length * 0.001)] ?? 0;
    const hi = sampled[Math.floor(sampled.length * 0.997)] ?? 1;
    const range = Math.max(hi - lo, 1e-9);
    const img = new ImageData(w, h);
    const data = img.data;
    for (let i = 0; i < w * h; i++) {
      const t = Math.min(Math.max(((pixels[i] ?? 0) - lo) / range, 0), 1);
      // Perceptual heat ramp: dark blue → orange → white.
      data[i * 4] = Math.round(255 * Math.min(1, t * 2.4));
      data[i * 4 + 1] = Math.round(255 * Math.min(1, Math.max(0, t - 0.35) * 1.8));
      data[i * 4 + 2] = Math.round(255 * Math.min(1, Math.max(0, 0.35 - t) * 1.6));
      data[i * 4 + 3] = 255;
    }
    return img;
  }

  // ---- science outputs -------------------------------------------------------------------

  private publishScience() {
    const s = this.state;
    const metrics: ScienceMetric[] = [];
    const zh = this.zh;
    if (this.bkg) {
      metrics.push({
        key: 'bkg',
        label: 'Background',
        value: this.bkg.medianAdu.toFixed(2),
        unit: 'ADU',
        severity: 'info',
        hint: zh ? '2.5σ 三轮 σ-裁剪背景中值。' : '2.5σ 3-pass sigma-clipped background median.',
      });
      metrics.push({
        key: 'sigma',
        label: 'Bkg σ',
        value: this.bkg.sigmaAdu.toFixed(3),
        unit: 'ADU',
        severity: 'info',
        hint: zh ? 'MAD × 1.4826 的稳健标准差。' : 'Robust σ from MAD × 1.4826.',
      });
    }
    metrics.push({
      key: 'cr',
      label: 'CR pixels',
      value: String(this.crClipped),
      unit: '',
      severity: 'info',
      hint: zh ? '6σ Laplacian 宇宙线剔除像素数。' : 'Cosmic-ray pixels rejected at 6σ (Laplacian).',
    });
    metrics.push({
      key: 'nsrc',
      label: 'Sources',
      value: String(this.detections.length),
      unit: '',
      severity: 'info',
      hint: zh ? `${s.thresholdSigma}σ 阈值以上、经非极大值抑制的恒星检测数。` : `Detections above ${s.thresholdSigma}σ after non-maximum suppression.`,
    });
    if (this.detections.length > 0) {
      const best = this.detections[0];
      if (best) {
        metrics.push({
          key: 'best_snr',
          label: 'Peak SNR',
          value: best.snr.toFixed(1),
          unit: '',
          severity: 'info',
          hint: zh ? '最亮源的信噪比：F/√(F + n(sky + RN²))。' : 'Brightest source SNR via F/√(F + n(sky + RN²)).',
        });
        metrics.push({
          key: 'best_mag',
          label: 'm (brightest)',
          value: Number.isFinite(best.mag) ? best.mag.toFixed(3) : '—',
          unit: 'mag',
          severity: 'info',
          hint: zh ? `最亮源仪器星等（ZP = ${s.zeropoint}）。` : `Brightest instrumental magnitude (ZP = ${s.zeropoint}).`,
        });
        // End-to-end flux-recovery check on simulated frames.
        if (this.sim && this.state.mode === 'simulate') {
          const matched = this.matchInjected();
          if (matched) {
            metrics.push({
              key: 'recovery',
              label: 'Flux recovery',
              value: `${(matched.recovered * 100).toFixed(1)} %`,
              unit: '',
              severity: Math.abs(matched.recovered - 1) < 0.05 ? 'ok' : 'warn',
              hint: zh
                ? `最亮注入源 (${Math.round(matched.injected)} e⁻) 的孔径测光回收比例（中值平场归一化基准，容差 5%）。`
                : `Aperture recovery of the brightest injected star (${Math.round(matched.injected)} e⁻) in median-flat units, 5% tolerance.`,
            });
          }
        }
      }
    }
    if (this.fits) {
      metrics.push({
        key: 'fits',
        label: 'FITS',
        value: `${this.fits.width}×${this.fits.height}`,
        unit: `BITPIX ${this.fits.bitpix}`,
        severity: 'info',
        hint: zh ? `文件 ${this.fileName}；WCS ${this.fits.wcs ? 'TAN' : '无'}。` : `File ${this.fileName}; WCS ${this.fits.wcs ? 'TAN' : 'none'}.`,
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  /** Matches the brightest detection to the brightest injected star (simulation only). */
  private matchInjected(): { recovered: number; injected: number } | null {
    if (!this.sim || this.detections.length === 0) return null;
    const injected = [...this.sim.stars].sort((a, b) => b.fluxE - a.fluxE)[0];
    if (!injected) return null;
    const det = this.detections.find(
      (d) => (d.x - injected.x) ** 2 + (d.y - injected.y) ** 2 < 9,
    );
    if (!det) return null;
    // Fluxes are in median-flat units after calibration; reference accordingly.
    const reference = injected.fluxE * flatZeroLevel(this.sim);
    return { recovered: (det.flux * this.state.gain) / reference, injected: injected.fluxE };
  }

  private refreshParams() {
    emit('host:params:changed', { pluginId: this.manifest.id });
  }
}

export default function createAstroPipelinePlugin(): Plugin {
  return new AstroPipelinePlugin();
}
