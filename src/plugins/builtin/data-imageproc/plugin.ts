// ==========================================================================
// data-imageproc — image-processing laboratory
//
// Left/right canvas comparison of the built-in program-generated test image
// (gradient + disc + stripes + seeded gaussian noise) against its processed
// counterpart: Gaussian blur / unsharp sharpen / Sobel edges / histogram
// equalisation / log-magnitude FFT spectrum. Publishes PSNR, spectral energy
// concentration and processing time to the science-output bus, and exposes
// the embedded numerics benchmark (FFT vs DFT, convolution theorem,
// equalisation flattening, PSNR⇔MSE identity) as a one-click action.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import { actionButton, actionFired, drawEmptyCanvas, exportCanvasPng, notify } from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { dataImageprocManifest } from './manifest';
import { imageprocFigurePanels } from './figure';
import {
  gaussianBlur,
  histogramEqualize,
  imageMse,
  imagePsnr,
  makeTestImage,
  runImageProcBenchmark,
  sharpen,
  sobelMagnitude,
  spectralEnergyConcentration,
  fftSpectrumImage,
  type GrayImage,
} from './kernel';

export { dataImageprocManifest } from './manifest';

type FilterKind = 'blur' | 'sharpen' | 'edge' | 'equalize' | 'spectrum';

const FILTERS: Array<{ value: FilterKind; labelEn: string; labelZh: string }> = [
  { value: 'blur', labelEn: 'Gaussian blur', labelZh: '高斯模糊' },
  { value: 'sharpen', labelEn: 'Unsharp sharpen', labelZh: '锐化（unsharp）' },
  { value: 'edge', labelEn: 'Sobel edges', labelZh: 'Sobel 边缘' },
  { value: 'equalize', labelEn: 'Histogram equalise', labelZh: '直方图均衡' },
  { value: 'spectrum', labelEn: 'FFT spectrum', labelZh: 'FFT 频谱' },
];

interface State {
  filter: FilterKind;
  strength: number;
  seed: number;
}

export class DataImageprocPlugin implements Plugin {
  readonly manifest = dataImageprocManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = { filter: 'blur', strength: 2, seed: 20261011 };
  private baseImage: GrayImage = makeTestImage(256, 256, 20261011);
  private lastMetrics: { psnr: number | null; energy: number; elapsedMs: number } | null = null;

  async init(api: PluginApi) {
    this.api = api;
    this.zh = api.locale === 'zh-CN';
    api.onLocaleChange((l) => {
      this.zh = l === 'zh-CN';
      this.draw();
    });
  }

  async destroy() {
    clearScienceOutputs(this.manifest.id);
    this.ctx = null;
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'filter',
        label: 'Processing',
        labelI18n: { 'zh-CN': '处理方式', 'en-US': 'Processing' },
        type: 'select',
        options: FILTERS.map((f) => ({
          value: f.value,
          label: this.zh ? f.labelZh : f.labelEn,
          labelI18n: { 'zh-CN': f.labelZh, 'en-US': f.labelEn },
        })),
        value: this.state.filter,
      },
      {
        key: 'strength',
        label: 'Strength',
        labelI18n: { 'zh-CN': '强度', 'en-US': 'Strength' },
        type: 'range',
        min: 0.5,
        max: 6,
        step: 0.1,
        value: this.state.strength,
        hint:
          this.zh
            ? '模糊 σ / 锐化增益；边缘与均衡视图不使用'
            : 'blur σ / sharpen gain; unused by edge & equalise views',
      },
      actionButton('benchmark', 'Run numerics benchmark', '运行数值基准验证', 'primary'),
      actionButton('regenerate', 'New test image', '重新生成测试图'),
      actionButton('exportPng', 'Export view PNG', '导出画面 PNG'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, cb: (n: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (cb(params[k] as number)) this.draw();
      }
    };
    num('strength', (n) => {
      if (n === this.state.strength) return false;
      this.state.strength = Math.min(6, Math.max(0.5, n));
      return true;
    });
    if (typeof params.filter === 'string' && FILTERS.some((f) => f.value === params.filter)) {
      if (params.filter !== this.state.filter) {
        this.state.filter = params.filter as FilterKind;
        this.draw();
      }
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'regenerate')) this.regenerate();
    if (actionFired(params, 'exportPng')) exportCanvasPng(this.api, this.ctx?.canvas2d ?? null, 'imageproc-view');
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    // No upload formats declared: the plugin always works on the built-in
    // program-generated subject so every metric stays reproducible.
    void file;
    notify(
      this.api,
      'info',
      'This plugin processes the built-in generated test image; use "New test image" for a fresh seeded subject.',
      '本插件处理内置程序生成的测试图；用「重新生成测试图」可获得新的固定种子图像。',
    );
  }

  /** Rebuild the deterministic subject from a fresh seed. */
  private regenerate() {
    this.state.seed = (this.state.seed * 1664525 + 1013904223) >>> 0;
    this.baseImage = makeTestImage(256, 256, this.state.seed);
    this.lastMetrics = null;
    clearScienceOutputs(this.manifest.id);
    notify(
      this.api,
      'success',
      `Test image regenerated (seed=${this.state.seed}).`,
      `测试图已重新生成（种子=${this.state.seed}）。`,
    );
    this.draw();
  }

  private applyFilter(img: GrayImage, filter: FilterKind, strength: number): GrayImage {
    switch (filter) {
      case 'blur':
        return gaussianBlur(img, strength);
      case 'sharpen':
        return sharpen(img, strength);
      case 'edge':
        return sobelMagnitude(img);
      case 'equalize':
        return histogramEqualize(img);
      case 'spectrum':
        return fftSpectrumImage(img);
    }
  }

  /** Compute + publish the science outputs for the current view. */
  private publishMetrics(processed: GrayImage) {
    const isSpectrum = this.state.filter === 'spectrum';
    const t0 = performance.now();
    const energy = spectralEnergyConcentration(processed);
    const elapsedMs = performance.now() - t0 + this.lastProcessMs;
    const psnr = isSpectrum ? null : imagePsnr(this.baseImage, processed);
    this.lastMetrics = { psnr, energy, elapsedMs };
    const metrics: ScienceMetric[] = [];
    if (psnr != null && Number.isFinite(psnr)) {
      metrics.push({
        key: 'psnr',
        label: 'PSNR',
        value: fmtMetric(psnr),
        unit: 'dB',
        severity: psnr >= 30 ? 'ok' : psnr >= 20 ? 'info' : 'warn',
        hint:
          this.zh
            ? '处理后图相对原图 PSNR=10·log10(255²/MSE)；越高越接近原图'
            : 'processed vs original, PSNR=10·log10(255²/MSE); higher = closer to original',
      });
      metrics.push({
        key: 'mse',
        label: 'MSE',
        value: fmtMetric(imageMse(this.baseImage, processed)),
        unit: '8bit²',
        severity: 'info',
      });
    }
    metrics.push({
      key: 'energy',
      label: 'Spectral energy (r/4)',
      value: fmtMetric(energy * 100),
      unit: '%',
      severity: 'info',
      hint:
        this.zh
          ? '中心 1/4 半径内频谱能量占比（低频集中度）'
          : 'fraction of spectral energy inside the central quarter radius (low-frequency concentration)',
    });
    metrics.push({
      key: 'elapsed',
      label: 'Process time',
      value: fmtMetric(this.lastProcessMs),
      unit: 'ms',
      severity: 'info',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  private lastProcessMs = 0;

  /** Embedded numerics benchmark → science outputs. */
  private runBenchmark() {
    const bench = runImageProcBenchmark();
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-fft',
        label: 'FFT vs DFT err',
        value: fmtMetric(bench.fftVsDftErr),
        severity: bench.fftVsDftErr < 1e-9 ? 'ok' : 'warn',
        hint:
          this.zh
            ? `基准①：32×32 种子实矩阵，FFT 与朴素 O(N⁴) DFT 逐复数最大差（阈 1e-9）；往返误差 ${fmtMetric(bench.fftRoundTripErr)}`
            : `benchmark ①: 32×32 seeded real matrix, max complex |FFT − naive O(N⁴) DFT| (tol 1e-9); round-trip err ${fmtMetric(bench.fftRoundTripErr)}`,
      },
      {
        key: 'bench-conv',
        label: 'Conv theorem err',
        value: fmtMetric(bench.convTheoremErr),
        severity: bench.convTheoremErr < 1e-6 ? 'ok' : 'warn',
        hint:
          this.zh
            ? '基准②：24×24 图 × 5×5 高斯核，空间卷积与频域乘积逆变换最大差（阈 1e-6）'
            : 'benchmark ②: 24×24 image with 5×5 Gaussian kernel, max |spatial conv − spectral product⁻¹| (tol 1e-6)',
      },
      {
        key: 'bench-eq',
        label: 'Equalise var ×',
        value: fmtMetric(bench.eqVarRatio),
        severity: bench.eqVarAfter < bench.eqVarBefore ? 'ok' : 'warn',
        hint:
          this.zh
            ? `基准③：偏斜图均衡前后 16 级灰度区间频率方差之比 ${fmtMetric(bench.eqVarBefore)} → ${fmtMetric(bench.eqVarAfter)}（应下降）`
            : `benchmark ③: 16-bin grey-range frequency variance before → after equalisation ${fmtMetric(bench.eqVarBefore)} → ${fmtMetric(bench.eqVarAfter)} (must decrease)`,
      },
      {
        key: 'bench-psnr',
        label: 'PSNR identity err',
        value: fmtMetric(bench.psnrIdentityErr),
        severity: bench.psnrIdentityErr < 1e-9 ? 'ok' : 'warn',
        hint:
          this.zh
            ? `基准④：|PSNR − 10·log10(255²/MSE)|（应为 0）；MSE 实测 ${fmtMetric(bench.mseMeasured)} vs 期望 ${fmtMetric(bench.mseExpected)}`
            : `benchmark ④: |PSNR − 10·log10(255²/MSE)| (must be 0); MSE measured ${fmtMetric(bench.mseMeasured)} vs expected ${fmtMetric(bench.mseExpected)}`,
      },
      {
        key: 'bench-time',
        label: 'Bench time',
        value: fmtMetric(bench.elapsedMs),
        unit: 'ms',
        severity: 'info',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      bench.passed ? 'success' : 'warning',
      bench.passed
        ? `Numerics benchmark passed in ${bench.elapsedMs} ms (FFT<1e-9, conv<1e-6, PSNR identity=0).`
        : 'Numerics benchmark FAILED — see science outputs.',
      bench.passed
        ? `数值基准全部通过（${bench.elapsedMs} ms，FFT<1e-9、卷积定理<1e-6、PSNR 恒等式误差 0）。`
        : '数值基准未通过——详见科研输出面板。',
    );
  }

  /** Stream the processed-image histogram + tone metrics into Figure Studio. */
  private async sendToFigure(): Promise<void> {
    // Recompute from the same seeded subject — pure kernel calls, no caching.
    const processed = this.applyFilter(this.baseImage, this.state.filter, this.state.strength);
    const psnr = this.state.filter === 'spectrum' ? null : imagePsnr(this.baseImage, processed);
    const energy = spectralEnergyConcentration(processed);
    const fLabel = FILTERS.find((f) => f.value === this.state.filter);
    const filterName = this.zh ? (fLabel?.labelZh ?? '') : (fLabel?.labelEn ?? '');
    const psnrTxt =
      psnr != null && Number.isFinite(psnr) ? `PSNR=${psnr.toFixed(2)} dB` : this.zh ? 'PSNR=—（频谱视图无意义）' : 'PSNR=— (undefined for the spectrum view)';
    const caption: Bilingual = {
      zh: `图像处理（${filterName}，强度 ${this.state.strength.toFixed(1)}）：${psnrTxt}，中心 r/4 频谱能量占比 ${(energy * 100).toFixed(1)}%。`,
      en: `Image processing (${filterName}, strength ${this.state.strength.toFixed(1)}): ${psnrTxt}, spectral energy inside r/4 ${(energy * 100).toFixed(1)}%.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '图像处理分析', en: 'Image Processing Analysis' },
      caption,
      imageprocFigurePanels({ base: this.baseImage, processed }),
    );
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    const zh = this.zh;

    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    if (canvas.width < 80 || canvas.height < 80) {
      drawEmptyCanvas(this.api, canvas, {
        title: 'Image Processing',
        titleZh: '图像处理',
        hint: 'Canvas too small.',
        hintZh: '画布过小。',
      });
      return;
    }

    // Process.
    const t0 = performance.now();
    const processed = this.applyFilter(this.baseImage, this.state.filter, this.state.strength);
    this.lastProcessMs = performance.now() - t0;
    this.publishMetrics(processed);

    // Two panels: original | processed, each fitted into its half.
    const halfW = canvas.width / 2;
    const padT = 44;
    const padB = 52;
    const availH = canvas.height - padT - padB;
    const drawScaled = (img: GrayImage, x0: number, w: number) => {
      const off = document.createElement('canvas');
      off.width = img.width;
      off.height = img.height;
      const octx = off.getContext('2d');
      if (!octx) return;
      const id = octx.createImageData(img.width, img.height);
      const px = id.data;
      for (let i = 0; i < img.data.length; i += 1) {
        const v = Math.min(255, Math.max(0, Math.round(img.data[i]!)));
        px[i * 4] = v;
        px[i * 4 + 1] = v;
        px[i * 4 + 2] = v;
        px[i * 4 + 3] = 255;
      }
      octx.putImageData(id, 0, 0);
      const s = Math.min(w / img.width, availH / img.height);
      const dw = img.width * s;
      const dh = img.height * s;
      g.imageSmoothingEnabled = false;
      g.drawImage(off, x0 + (w - dw) / 2, padT + (availH - dh) / 2, dw, dh);
    };

    drawScaled(this.baseImage, 4, halfW - 8);
    drawScaled(processed, halfW + 4, halfW - 8);

    // Header labels.
    g.textAlign = 'center';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.fillText(zh ? '图像处理  原图 | 处理结果' : 'Image processing  original | processed', canvas.width / 2, 20);
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    g.fillText(zh ? '原图（内置测试图）' : 'original (built-in test image)', halfW / 2, padT - 8);
    const fLabel = FILTERS.find((f) => f.value === this.state.filter);
    g.fillStyle = 'rgba(140,200,250,0.95)';
    g.fillText(zh ? `处理结果：${fLabel?.labelZh ?? ''}` : `processed: ${fLabel?.labelEn ?? ''}`, halfW * 1.5, padT - 8);

    // Footer.
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const psnrTxt =
      this.lastMetrics?.psnr != null && Number.isFinite(this.lastMetrics.psnr)
        ? `PSNR=${this.lastMetrics.psnr.toFixed(2)} dB  MSE=${imageMse(this.baseImage, processed).toFixed(3)}`
        : 'PSNR=—（频谱视图无意义）';
    const l1 = zh
      ? `${fLabel?.labelZh ?? ''}  强度=${this.state.strength.toFixed(1)}  ·  ${psnrTxt}`
      : `${fLabel?.labelEn ?? ''}  strength=${this.state.strength.toFixed(1)}  ·  ${psnrTxt}`;
    g.fillText(l1, 16, canvas.height - 30);
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = zh
      ? `处理耗时 ${this.lastProcessMs.toFixed(1)} ms  ·  中心 r/4 频谱能量占比 ${(100 * (this.lastMetrics?.energy ?? 0)).toFixed(1)}%  ·  「运行数值基准验证」一键核对 FFT/卷积/均衡/PSNR`
      : `process time ${this.lastProcessMs.toFixed(1)} ms  ·  spectral energy in r/4 ${(100 * (this.lastMetrics?.energy ?? 0)).toFixed(1)}%  ·  "Run numerics benchmark" verifies FFT/conv/equalise/PSNR`;
    g.fillText(l2, 16, canvas.height - 14);
  }
}

export default function createDataImageprocPlugin(): Plugin {
  return new DataImageprocPlugin();
}
