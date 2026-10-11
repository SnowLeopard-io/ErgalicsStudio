// ==========================================================================
// math-fourier — Fourier series approximation laboratory
//
// Draws the preset waveform together with its N-term Fourier partial sum
// (plain or Fejér-averaged) and the pointwise error curve on a log scale.
// Coefficients come from jump-split Simpson quadrature (see kernel.ts); the
// science strip reports the relative L2 error, the Gibbs overshoot ratio
// against 2·Si(π)/π ≈ 1.17898 and the Parseval residual. One click exports
// the coefficient table (with analytic references) to Figure Studio via CSV.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { mathFourierManifest } from './manifest';
import {
  analyticCoeff,
  computeFourierCoeffs,
  evalFourierSum,
  GIBBS_RATIO,
  gibbsOvershootRatio,
  parsevalResidual,
  relativeL2Error,
  runFourierBenchmarks,
  WAVEFORMS,
  type FourierCoeffs,
  type SumMode,
  type WaveformId,
} from './kernel';

export { mathFourierManifest } from './manifest';

interface State {
  wave: WaveformId;
  n: number;
  mode: SumMode;
  L: number;
}

export class MathFourierPlugin implements Plugin {
  readonly manifest = mathFourierManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    wave: 'square',
    n: 64,
    mode: 'partial',
    L: Math.PI,
  };

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
    const waveOptions = (Object.keys(WAVEFORMS) as WaveformId[]).map((id) => ({
      value: id,
      label: this.zh ? WAVEFORMS[id].labelZh : WAVEFORMS[id].labelEn,
      labelI18n: { 'zh-CN': WAVEFORMS[id].labelZh, 'en-US': WAVEFORMS[id].labelEn },
    }));
    return [
      {
        key: 'wave',
        label: 'Waveform',
        labelI18n: { 'zh-CN': '预设函数', 'en-US': 'Waveform' },
        type: 'select',
        options: waveOptions,
        value: this.state.wave,
      },
      {
        key: 'n',
        label: 'Harmonics N',
        labelI18n: { 'zh-CN': '谐波数 N', 'en-US': 'Harmonics N' },
        type: 'range',
        min: 1,
        max: 128,
        step: 1,
        value: this.state.n,
      },
      {
        key: 'mode',
        label: 'Sum mode',
        labelI18n: { 'zh-CN': '求和模式', 'en-US': 'Sum mode' },
        type: 'select',
        options: [
          {
            value: 'partial',
            label: this.zh ? '普通部分和' : 'Plain partial sum',
            labelI18n: { 'zh-CN': '普通部分和', 'en-US': 'Plain partial sum' },
          },
          {
            value: 'fejer',
            label: this.zh ? 'Fejér 平均（无过冲）' : 'Fejér mean (no overshoot)',
            labelI18n: { 'zh-CN': 'Fejér 平均（无过冲）', 'en-US': 'Fejér mean (no overshoot)' },
          },
        ],
        value: this.state.mode,
      },
      {
        key: 'L',
        label: 'Half interval L',
        labelI18n: { 'zh-CN': '半区间 L', 'en-US': 'Half interval L' },
        type: 'number',
        min: 0.5,
        max: 10,
        step: 0.1,
        value: this.state.L,
        hint: this.zh ? '级数展开区间为 [−L, L]' : 'series expands on [−L, L]',
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准', 'primary'),
      actionButton('exportCsv', 'Export coefficients CSV', '导出系数 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, cb: (v: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (cb(params[k] as number)) this.draw();
      }
    };
    num('n', (v) => {
      const n = Math.round(Math.min(128, Math.max(1, v)));
      if (n === this.state.n) return false;
      this.state.n = n;
      return true;
    });
    num('L', (v) => {
      const L = Math.min(10, Math.max(0.5, v));
      if (L === this.state.L) return false;
      this.state.L = L;
      return true;
    });
    if (typeof params.wave === 'string' && params.wave in WAVEFORMS && params.wave !== this.state.wave) {
      this.state.wave = params.wave as WaveformId;
      this.draw();
    }
    if (params.mode === 'partial' || params.mode === 'fejer') {
      if (params.mode !== this.state.mode) {
        this.state.mode = params.mode;
        this.draw();
      }
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
  }

  // ---- actions ---------------------------------------------------------------

  /** Run the embedded validation suite and publish one metric per benchmark. */
  private runBenchmark() {
    const bench = runFourierBenchmarks();
    const failed = bench.filter((b) => !b.passed);
    const metrics: ScienceMetric[] = bench.map((b) => ({
      key: `bench-${b.id}`,
      label: this.zh ? b.labelZh : b.labelEn,
      value: fmtMetric(b.relErr),
      severity: b.passed ? 'ok' : 'error',
      hint: `${this.zh ? b.detailZh : b.detailEn} · ${this.zh ? '基准：' : 'benchmark: '}${
        b.id === 'gibbs-ratio' ? '2·Si(π)/π ≈ 1.17898 (Bôcher 1906)' : 'analytic reference'
      }`,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      failed.length === 0 ? 'success' : 'warning',
      failed.length === 0
        ? `All ${bench.length} Fourier benchmarks passed (N=64).`
        : `${failed.length}/${bench.length} benchmarks failed: ${failed.map((b) => b.id).join(', ')}`,
      failed.length === 0
        ? `全部 ${bench.length} 项傅里叶基准通过（N=64）。`
        : `${failed.length}/${bench.length} 项基准未通过：${failed.map((b) => b.id).join('、')}`,
    );
  }

  /** Coefficient table with analytic references and per-coefficient errors. */
  private exportCsv() {
    const c = this.coeffs();
    const wave = this.state.wave;
    const rows: Array<Array<number | string>> = [];
    rows.push([0, Number((c.a0 / 2).toFixed(8)), '', '', '', '']);
    for (let n = 1; n <= c.N; n += 1) {
      const ref = analyticCoeff(wave, n);
      const ea = ref && ref.a !== 0 ? Math.abs(c.a[n - 1]! - ref.a) / Math.abs(ref.a) : '';
      const eb = ref && ref.b !== 0 ? Math.abs(c.b[n - 1]! - ref.b) / Math.abs(ref.b) : '';
      rows.push([
        n,
        Number(c.a[n - 1]!.toFixed(8)),
        Number(c.b[n - 1]!.toFixed(8)),
        ref ? Number(ref.a.toPrecision(8)) : '',
        ref ? Number(ref.b.toPrecision(8)) : '',
        ea === '' ? '' : Number((ea as number).toExponential(3)),
        eb === '' ? '' : Number((eb as number).toExponential(3)),
      ]);
    }
    exportRowsCsv(
      this.api,
      'fourier-coefficients',
      ['n', 'a_n', 'b_n', 'a_n_analytic', 'b_n_analytic', 'rel_err_a', 'rel_err_b'],
      rows,
    );
  }

  // ---- numerics + science outputs ---------------------------------------------

  private coeffs(): FourierCoeffs {
    return computeFourierCoeffs(WAVEFORMS[this.state.wave], this.state.L, this.state.n);
  }

  private publishScience(c: FourierCoeffs) {
    const wave = WAVEFORMS[this.state.wave];
    const l2 = relativeL2Error(wave, c, this.state.mode);
    const resid = parsevalResidual(wave, c);
    const metrics: ScienceMetric[] = [
      {
        key: 'l2-rel-err',
        label: 'L2 rel err',
        value: fmtMetric(l2 * 100),
        unit: '%',
        severity: l2 < 0.15 ? 'ok' : l2 < 0.5 ? 'info' : 'warn',
        hint: this.zh
          ? `‖S_N − f‖₂/‖f‖₂（${this.state.mode === 'fejer' ? 'Fejér' : '普通'}部分和，N=${c.N}，中点采样）`
          : `‖S_N − f‖₂/‖f‖₂ (${this.state.mode === 'fejer' ? 'Fejér' : 'plain'} sum, N=${c.N}, midpoint rule)`,
      },
      {
        key: 'parseval-residual',
        label: 'Parseval residual',
        value: fmtMetric(resid * 100),
        unit: '%',
        severity: resid < 0.01 ? 'ok' : 'warn',
        hint: this.zh
          ? '|Σ系数² − (1/L)∫f²|/∫f²；截断尾项能量（Parseval 等式）'
          : '|Σcoef² − (1/L)∫f²|/∫f²; truncated tail energy (Parseval identity)',
      },
    ];
    const ratio = gibbsOvershootRatio(c, wave);
    if (ratio !== null) {
      const gErr = Math.abs(ratio - GIBBS_RATIO) / GIBBS_RATIO;
      metrics.push({
        key: 'gibbs-ratio',
        label: 'Gibbs ratio',
        value: fmtMetric(ratio, 6),
        severity: gErr < 0.02 ? 'ok' : 'warn',
        hint: this.zh
          ? `过冲比例对照理论值 2·Si(π)/π ≈ 1.17898（Bôcher 1906，≈8.95% 过冲）`
          : `overshoot ratio vs theory 2·Si(π)/π ≈ 1.17898 (Bôcher 1906, ≈8.95% overshoot)`,
      });
      metrics.push({
        key: 'gibbs-theory-err',
        label: 'Gibbs theory err',
        value: fmtMetric(gErr * 100),
        unit: '%',
        severity: gErr < 0.02 ? 'ok' : 'warn',
        hint: this.zh ? '|实测 − 1.17898|/1.17898（统一相对误差口径）' : '|measured − 1.17898|/1.17898 (unified metric)',
      });
    }
    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- drawing ------------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;

    const wave = WAVEFORMS[this.state.wave];
    const c = this.coeffs();
    this.publishScience(c);

    // ---- top plot: waveform + partial sum ------------------------------------
    const padL = 54;
    const padR = 18;
    const topH = Math.round((canvas.height - 46) * 0.62);
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = 30;
    const y1 = y0 + Math.max(topH, 60);
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    // Symmetric y range from both curves.
    let yMax = 0.5;
    const M = 480;
    for (let i = 0; i <= M; i += 1) {
      const x = -c.L + (2 * c.L * i) / M;
      yMax = Math.max(yMax, Math.abs(wave.fn((Math.PI * x) / c.L)));
      yMax = Math.max(yMax, Math.abs(evalFourierSum(c, x, this.state.mode)));
    }
    yMax *= 1.12;
    const px = (x: number) => x0 + ((x + c.L) / (2 * c.L)) * plotW;
    const py = (v: number) => y1 - ((v + yMax) / (2 * yMax)) * plotH;

    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.fillText(
      zh
        ? `傅里叶级数逼近  ${wave.labelZh}  N=${c.N}${this.state.mode === 'fejer' ? '（Fejér）' : ''}`
        : `Fourier series approximation  ${wave.labelEn}  N=${c.N}${this.state.mode === 'fejer' ? ' (Fejér)' : ''}`,
      canvas.width / 2,
      18,
    );
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);
    // zero lines
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.moveTo(x0, py(0));
    g.lineTo(x1, py(0));
    g.moveTo(px(0), y0);
    g.lineTo(px(0), y1);
    g.stroke();

    // waveform (dashed white)
    g.setLineDash([5, 4]);
    g.strokeStyle = 'rgba(235,240,247,0.9)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i <= M; i += 1) {
      const x = -c.L + (2 * c.L * i) / M;
      const v = wave.fn((Math.PI * x) / c.L);
      if (i === 0) g.moveTo(px(x), py(v));
      else g.lineTo(px(x), py(v));
    }
    g.stroke();
    g.setLineDash([]);

    // partial sum (accent)
    g.strokeStyle = 'rgba(120,200,255,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    const M2 = 900;
    for (let i = 0; i <= M2; i += 1) {
      const x = -c.L + (2 * c.L * i) / M2;
      const v = evalFourierSum(c, x, this.state.mode);
      if (i === 0) g.moveTo(px(x), py(v));
      else g.lineTo(px(x), py(v));
    }
    g.stroke();

    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(235,240,247,0.9)';
    g.fillText(zh ? '原函数' : 'f(x)', x0 + 6, y0 + 14);
    g.fillStyle = 'rgba(120,200,255,0.95)';
    g.fillText(this.state.mode === 'fejer' ? 'σ_N (Fejér)' : 'S_N', x0 + 52, y0 + 14);

    // ---- bottom plot: pointwise error on a log scale --------------------------
    const e0 = y1 + 14;
    const e1 = canvas.height - 40;
    const eH = Math.max(e1 - e0, 20);
    const LOG_MIN = -12;
    const LOG_MAX = 1;
    const pyE = (v: number) => {
      const lg = Math.log10(Math.max(v, 1e-12));
      return e1 - ((lg - LOG_MIN) / (LOG_MAX - LOG_MIN)) * eH;
    };
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, e0, plotW, eH);
    g.textAlign = 'right';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = `10px Consolas, monospace`;
    for (let lg = LOG_MIN; lg <= LOG_MAX; lg += 2) {
      const yy = pyE(Math.pow(10, lg));
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, yy);
      g.lineTo(x1, yy);
      g.stroke();
      g.fillText(`1e${lg}`, x0 - 6, yy + 3);
    }
    g.strokeStyle = 'rgba(250,205,120,0.9)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i <= M2; i += 1) {
      const x = -c.L + (2 * c.L * i) / M2;
      const err = Math.abs(evalFourierSum(c, x, this.state.mode) - wave.fn((Math.PI * x) / c.L));
      if (i === 0) g.moveTo(px(x), pyE(err));
      else g.lineTo(px(x), pyE(err));
    }
    g.stroke();
    g.textAlign = 'left';
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '|S_N − f|（对数）' : '|S_N − f| (log)', x0 + 6, e0 + 12);

    // ---- footer ------------------------------------------------------------------
    const l2 = relativeL2Error(wave, c, this.state.mode);
    const ratio = gibbsOvershootRatio(c, wave);
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const gibbsTxt =
      ratio === null
        ? zh
          ? '光滑函数，无 Gibbs 过冲'
          : 'smooth waveform, no Gibbs overshoot'
        : zh
          ? `Gibbs 过冲比例=${ratio.toFixed(4)}（理论 2·Si(π)/π≈1.17898）`
          : `Gibbs ratio=${ratio.toFixed(4)} (theory 2·Si(π)/π≈1.17898)`;
    g.fillText(
      `N=${c.N}  L=${c.L.toFixed(2)}  ${zh ? 'L2 相对误差' : 'L2 rel err'}=${(l2 * 100).toFixed(2)}%  ${gibbsTxt}`,
      54,
      canvas.height - 14,
    );
  }
}

export default function createMathFourierPlugin(): Plugin {
  return new MathFourierPlugin();
}
