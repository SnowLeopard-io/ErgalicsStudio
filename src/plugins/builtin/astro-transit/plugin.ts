// ==========================================================================
// astro-transit — exoplanet transit light-curve fitting workbench
//
// Draws the raw light curve with the fitted trapezoid model overlaid plus a
// phase-folded panel with binned means. A simplified-BLS detector finds the
// period blind; Levenberg-Marquardt refines (P, T0, δ, T14, T23, baseline)
// with analytic Jacobians and covariance 1σ errors. Scientific outputs: the
// ephemeris P±σ, T0±σ, the depth δ±σ and the uniform-disc radius ratio √δ.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  drawEmptyCanvas,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import { clearScienceOutputs, fmtMetric, setScienceOutputs, type ScienceMetric } from '@/core/research/scienceOutput';
import { astroTransitManifest } from './manifest';
import {
  TRANSIT_BENCHMARK,
  binFolded,
  detectPeriod,
  fitTransit,
  ingressDuration,
  parseTransitData,
  phaseFold,
  runTransitBenchmark,
  synthesizeTransitData,
  trapezoidFlux,
  type PeriodDetection,
  type TransitFitResult,
  type TransitPoint,
} from './kernel';

export { astroTransitManifest } from './manifest';

interface State {
  pMin: number;
  pMax: number;
  gridSteps: number;
  autoFit: boolean;
  deltaMax: number;
  t14Max: number;
  showFolded: boolean;
}

export class AstroTransitPlugin implements Plugin {
  readonly manifest = astroTransitManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private data: TransitPoint[] | null = null;
  private detection: PeriodDetection | null = null;
  private fit: TransitFitResult | null = null;

  private state: State = {
    pMin: 0.5,
    pMax: 20,
    gridSteps: 1000,
    autoFit: true,
    deltaMax: 0.2,
    t14Max: 0.5,
    showFolded: true,
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
    const s = this.state;
    return [
      {
        key: 'pMin',
        label: 'Period min (d)',
        labelI18n: { 'zh-CN': '周期下限 (d)', 'en-US': 'Period min (d)' },
        type: 'range',
        min: 0.2,
        max: 20,
        step: 0.1,
        value: s.pMin,
      },
      {
        key: 'pMax',
        label: 'Period max (d)',
        labelI18n: { 'zh-CN': '周期上限 (d)', 'en-US': 'Period max (d)' },
        type: 'range',
        min: 1,
        max: 50,
        step: 0.5,
        value: s.pMax,
      },
      {
        key: 'gridSteps',
        label: 'Grid steps',
        labelI18n: { 'zh-CN': '周期网格步数', 'en-US': 'Grid steps' },
        type: 'range',
        min: 200,
        max: 3000,
        step: 100,
        value: s.gridSteps,
        hint: this.zh ? '简化 BLS 粗搜网格密度（随后两级细化）' : 'coarse BLS grid density (two refinement passes follow)',
      },
      {
        key: 'autoFit',
        label: 'Auto LM fit',
        labelI18n: { 'zh-CN': '检测后自动 LM 拟合', 'en-US': 'Auto LM fit after detection' },
        type: 'checkbox',
        value: s.autoFit,
      },
      {
        key: 'deltaMax',
        label: 'δ upper bound',
        labelI18n: { 'zh-CN': '深度 δ 上界', 'en-US': 'Depth δ upper bound' },
        type: 'range',
        min: 0.02,
        max: 0.5,
        step: 0.01,
        value: s.deltaMax,
      },
      {
        key: 't14Max',
        label: 'T14 upper bound (d)',
        labelI18n: { 'zh-CN': 'T14 上界 (d)', 'en-US': 'T14 upper bound (d)' },
        type: 'range',
        min: 0.05,
        max: 2,
        step: 0.05,
        value: s.t14Max,
      },
      {
        key: 'showFolded',
        label: 'Phase-folded view',
        labelI18n: { 'zh-CN': '显示相位折叠图', 'en-US': 'Phase-folded view' },
        type: 'checkbox',
        value: s.showFolded,
      },
      actionButton('detect', 'Detect & Fit', '检测周期并拟合', 'primary'),
      actionButton('demo', 'Demo · synthetic curve', '演示 · 合成光变'),
      actionButton('benchmark', 'Run transit benchmark', '运行凌星基准验证'),
      actionButton('exportCsv', 'Export light curve CSV', '导出光变 CSV'),
      actionButton('exportResiduals', 'Export residual CSV', '导出残差 CSV'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: 'pMin' | 'pMax' | 'gridSteps' | 'deltaMax' | 't14Max', cb: (n: number) => void): void => {
      const v = params[k];
      if (typeof v === 'number' && Number.isFinite(v) && v !== this.state[k]) {
        this.state[k] = v;
        cb(v);
        this.draw();
      }
    };
    num('pMin', (n) => {
      this.state.pMin = Math.max(0.2, n);
      if (this.state.pMin >= this.state.pMax) this.state.pMax = this.state.pMin + 0.5;
    });
    num('pMax', (n) => {
      this.state.pMax = Math.max(this.state.pMin + 0.5, n);
    });
    num('gridSteps', () => {
      this.state.gridSteps = Math.round(Math.min(3000, Math.max(200, params.gridSteps as number)));
    });
    num('deltaMax', () => {
      this.state.deltaMax = Math.min(0.5, Math.max(0.02, params.deltaMax as number));
    });
    num('t14Max', () => {
      this.state.t14Max = Math.min(2, Math.max(0.05, params.t14Max as number));
    });
    if (typeof params.autoFit === 'boolean' && params.autoFit !== this.state.autoFit) {
      this.state.autoFit = params.autoFit;
      this.draw();
    }
    if (typeof params.showFolded === 'boolean' && params.showFolded !== this.state.showFolded) {
      this.state.showFolded = params.showFolded;
      this.draw();
    }
    if (actionFired(params, 'detect')) this.detectAndFit();
    if (actionFired(params, 'demo')) this.loadDemo();
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'exportResiduals')) this.exportResiduals();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.csv') && !low.endsWith('.tsv') && !low.endsWith('.txt')) {
      notify(this.api, 'warning', 'Transit plugin accepts time,flux[,err] CSV/TSV/TXT.', '凌星插件接受 time,flux[,err] 的 CSV/TSV/TXT。');
      return;
    }
    const text = await file.text();
    const pts = parseTransitData(text);
    if (pts.length < 20) {
      notify(this.api, 'warning', 'Need ≥20 time,flux rows.', '至少需要 20 行 time,flux 数据。');
      return;
    }
    this.data = pts;
    this.detection = null;
    this.fit = null;
    clearScienceOutputs(this.manifest.id);
    notify(
      this.api,
      'success',
      `Loaded ${pts.length} points — press "Detect & Fit".`,
      `已加载 ${pts.length} 个数据点——请点击「检测周期并拟合」。`,
    );
    this.draw();
  }

  /** Full pipeline: blind period detection, optional LM refinement, publish. */
  private detectAndFit() {
    if (!this.data || this.data.length < 20) {
      notify(this.api, 'warning', 'Load a light curve first (CSV/TSV/TXT) or run the demo.', '请先载入光变数据（CSV/TSV/TXT）或运行演示。');
      return;
    }
    const det = detectPeriod(this.data, { pMin: this.state.pMin, pMax: this.state.pMax, steps: this.state.gridSteps });
    if (!det) {
      clearScienceOutputs(this.manifest.id);
      this.detection = null;
      this.fit = null;
      notify(this.api, 'warning', 'No significant transit-like period found.', '未找到显著的凌星周期。');
      this.draw();
      return;
    }
    this.detection = det;
    this.fit = null;
    if (this.state.autoFit) {
      this.fit = fitTransit(
        this.data,
        {
          P: det.period,
          T0: det.epoch,
          delta: Math.max(det.depth, 1e-6),
          T14: Math.max(1.4 * det.width, 1e-3),
          T23: Math.max(0.6 * det.width, 0),
          baseline: 1,
        },
        { bounds: { deltaMax: this.state.deltaMax, t14Max: this.state.t14Max } },
      );
    }
    this.publishFit();
    const msg = this.fit
      ? this.zh
        ? `P=${fmtMetric(this.fit.params.P)} d，δ=${fmtMetric(this.fit.params.delta)}（R²=${fmtMetric(this.fit.r2)}）`
        : `P=${fmtMetric(this.fit.params.P)} d, δ=${fmtMetric(this.fit.params.delta)} (R²=${fmtMetric(this.fit.r2)})`
      : this.zh
        ? `检测周期 P=${fmtMetric(det.period)} d（未拟合）`
        : `detected period P=${fmtMetric(det.period)} d (not fitted)`;
    notify(this.api, 'success', msg, msg);
    this.draw();
  }

  private loadDemo() {
    this.data = synthesizeTransitData(
      {
        P: 4.2,
        T0: 1.1,
        delta: 0.012,
        T14: 0.16,
        T23: 0.07,
        baseline: 1,
      },
      { n: 360, tMin: 0, tMax: 4 * 4.2, noise: 0.0012, seed: 20260928 },
    );
    this.detection = null;
    this.fit = null;
    clearScienceOutputs(this.manifest.id);
    this.detectAndFit();
  }

  /** Publish the fit's scientific outputs: ephemeris, depth, radius ratio. */
  private publishFit() {
    const fit = this.fit;
    const det = this.detection;
    if (!det) return;
    const provenance = this.zh
      ? this.data && this.fit
        ? '数据来源：用户数据集（LM 拟合 + 协方差 1σ）'
        : '数据来源：用户数据集（仅箱型检测）'
      : this.data && this.fit
        ? 'source: user dataset (LM fit + covariance 1σ)'
        : 'source: user dataset (box detection only)';
    const metrics: ScienceMetric[] = [];
    if (fit) {
      const p = fit.params;
      const radiusRatio = Math.sqrt(Math.max(p.delta, 0));
      const radiusSigma = fit.sigma.delta > 0 ? fit.sigma.delta / (2 * radiusRatio || 1) : NaN;
      metrics.push(
        {
          key: 'period',
          label: 'P',
          value: `${fmtMetric(p.P)} ± ${fmtMetric(fit.sigma.P)}`,
          unit: 'd',
          severity: fit.converged ? 'ok' : 'warn',
          hint: `${provenance} · ${this.zh ? `迭代 ${fit.iterations} 次，χ²/dof=${fmtMetric(fit.chi2 / Math.max(1, fit.dof))}` : `${fit.iterations} LM iterations, χ²/dof=${fmtMetric(fit.chi2 / Math.max(1, fit.dof))}`}`,
        },
        {
          key: 'epoch',
          label: 'T0',
          value: `${fmtMetric(p.T0)} ± ${fmtMetric(fit.sigma.T0)}`,
          unit: 'd',
          severity: 'info',
          hint: provenance,
        },
        {
          key: 'depth',
          label: 'δ',
          value: `${fmtMetric(p.delta)} ± ${fmtMetric(fit.sigma.delta)}`,
          severity: 'info',
          hint: this.zh ? '凌星深度（基线流量归一化的分数）' : 'transit depth as a fraction of the baseline flux',
        },
        {
          key: 'radius-ratio',
          label: 'Rp/Rs = √δ',
          value: `${fmtMetric(radiusRatio)} ± ${fmtMetric(radiusSigma)}`,
          severity: 'info',
          hint: this.zh ? '均匀圆盘近似：δ = (Rp/Rs)²' : 'uniform-disc approximation: δ = (Rp/Rs)²',
        },
        {
          key: 't14',
          label: 'T14 / T23',
          value: `${fmtMetric(p.T14)} / ${fmtMetric(p.T23)}`,
          unit: 'd',
          severity: 'info',
          hint: this.zh
            ? `入/出射时长 τ=${fmtMetric(ingressDuration(p))} d（梯形恒等式 T23=T14−2τ）`
            : `ingress/egress duration τ=${fmtMetric(ingressDuration(p))} d (trapezoid identity T23=T14−2τ)`,
        },
        { key: 'r2', label: 'R²', value: fmtMetric(fit.r2), severity: fit.r2 >= 0.8 ? 'ok' : 'warn', hint: provenance },
      );
    } else {
      metrics.push(
        {
          key: 'period',
          label: 'P (box)',
          value: fmtMetric(det.period),
          unit: 'd',
          severity: 'warn',
          hint: this.zh ? '仅箱型检测；开启「自动 LM 拟合」以获得 1σ 误差' : 'box detection only; enable "Auto LM fit" for 1σ errors',
        },
        {
          key: 'depth',
          label: 'δ (box)',
          value: fmtMetric(det.depth),
          severity: 'info',
          hint: provenance,
        },
      );
    }
    metrics.push({
      key: 'detection-score',
      label: 'BLS score',
      value: fmtMetric(det.score),
      severity: 'info',
      hint: this.zh ? '箱型深度显著度（σ 单位）' : 'box depth significance in σ units',
    });
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runBenchmark() {
    const bench = runTransitBenchmark();
    if (!bench) {
      notify(this.api, 'warning', 'Benchmark detection failed.', '基准场景检测失败。');
      return;
    }
    const metrics: ScienceMetric[] = [
      {
        key: 'bench-p-err',
        label: 'P recover err',
        value: `${fmtMetric(bench.relErrP * 100)}%`,
        unit: '%',
        severity: bench.relErrP < TRANSIT_BENCHMARK.maxRelErrP ? 'ok' : 'warn',
        hint: this.zh
          ? `基准：真值 P=${bench.trueP} d（固定种子合成梯形光变，盲测回收），阈值 <${TRANSIT_BENCHMARK.maxRelErrP * 100}%`
          : `benchmark: truth P=${bench.trueP} d (seeded synthetic trapezoid, blind recovery), threshold <${TRANSIT_BENCHMARK.maxRelErrP * 100}%`,
      },
      {
        key: 'bench-delta-err',
        label: 'δ recover err',
        value: `${fmtMetric(bench.relErrDelta * 100)}%`,
        unit: '%',
        severity: bench.relErrDelta < TRANSIT_BENCHMARK.maxRelErrDelta ? 'ok' : 'warn',
        hint: this.zh
          ? `基准：真值 δ=${bench.trueDelta}（噪声=深度 1%），阈值 <${TRANSIT_BENCHMARK.maxRelErrDelta * 100}%`
          : `benchmark: truth δ=${bench.trueDelta} (noise = 1% of depth), threshold <${TRANSIT_BENCHMARK.maxRelErrDelta * 100}%`,
      },
      {
        key: 'bench-t0-err',
        label: 'T0 abs err',
        value: fmtMetric(bench.absErrT0),
        unit: 'd',
        severity: 'info',
        hint: this.zh ? `拟合 T0=${fmtMetric(bench.fitT0)} d，真值 ${bench.trueT0} d` : `fitted T0=${fmtMetric(bench.fitT0)} d, truth ${bench.trueT0} d`,
      },
      {
        key: 'bench-identity',
        label: 'T23=T14−2τ',
        value: fmtMetric(bench.selfConsistency),
        severity: bench.selfConsistency < 1e-9 ? 'ok' : 'warn',
        hint: this.zh ? '梯形模型解析自洽（阈值 <1e-9）' : 'trapezoid analytic self-consistency (threshold <1e-9)',
      },
      {
        key: 'bench-r2',
        label: 'R² (bench)',
        value: fmtMetric(bench.r2),
        severity: 'info',
        hint: this.zh ? `基准拟合 RMSE=${fmtMetric(bench.rmse)}，BLS 显著度 ${fmtMetric(bench.detectionScore)}σ` : `benchmark RMSE=${fmtMetric(bench.rmse)}, BLS score ${fmtMetric(bench.detectionScore)}σ`,
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      bench.passed ? 'success' : 'warning',
      `Benchmark: P err ${(bench.relErrP * 100).toFixed(3)}%, δ err ${(bench.relErrDelta * 100).toFixed(2)}%${bench.passed ? ' — PASS' : ' — CHECK'}`,
      `基准验证：P 误差 ${(bench.relErrP * 100).toFixed(3)}%，δ 误差 ${(bench.relErrDelta * 100).toFixed(2)}%${bench.passed ? ' —— 通过' : ' —— 请检查'}`,
    );
  }

  private exportCsv() {
    if (!this.data) {
      notify(this.api, 'warning', 'No light curve loaded yet.', '尚未载入光变数据。');
      return;
    }
    const rows: Array<Array<number | string>> = this.data.map((d, i) => {
      const model = this.fit ? trapezoidFlux(d.t, this.fit.params) : '';
      return [Number(d.t.toFixed(6)), Number(d.f.toFixed(6)), d.err ?? '', model === '' ? '' : Number((model as number).toFixed(6)), i];
    });
    exportRowsCsv(this.api, 'transit-lightcurve', ['time', 'flux', 'err', 'model', 'index'], rows);
  }

  private exportResiduals() {
    if (!this.data || !this.fit) {
      notify(this.api, 'warning', 'Run a fit first.', '请先运行一次拟合。');
      return;
    }
    const rows: Array<Array<number | string>> = this.data.map((d) => {
      const model = trapezoidFlux(d.t, this.fit!.params);
      return [Number(d.t.toFixed(6)), Number(d.f.toFixed(6)), Number(model.toFixed(6)), Number((d.f - model).toFixed(6))];
    });
    exportRowsCsv(this.api, 'transit-fit-residuals', ['time', 'flux_observed', 'flux_model', 'residual'], rows);
  }

  // ---- drawing ---------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    if (!this.data || this.data.length < 2) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: 'No light curve loaded',
        titleZh: '尚未载入光变数据',
        hint: 'Load a time,flux[,err] dataset (CSV/TSV/TXT) or press "Demo · synthetic curve".',
        hintZh: '载入 time,flux[,err] 数据（CSV/TSV/TXT），或点击「演示 · 合成光变」。',
      });
      return;
    }
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;
    const bottomSplit = this.state.showFolded ? 0.58 : 1.0;
    const topPanel = { x0: 56, x1: canvas.width - 16, y0: 34, y1: Math.max(120, canvas.height * bottomSplit - 30) };
    this.drawLightCurve(g, canvas, topPanel, zh);
    if (this.state.showFolded) {
      const botPanel = { x0: 56, x1: canvas.width - 16, y0: topPanel.y1 + 26, y1: canvas.height - 48 };
      this.drawFolded(g, canvas, botPanel, zh);
    }
    this.drawFooter(g, canvas, zh);
  }

  private drawLightCurve(
    g: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    panel: { x0: number; x1: number; y0: number; y1: number },
    zh: boolean,
  ) {
    const data = this.data!;
    const ts = data.map((d) => d.t);
    const fs = data.map((d) => d.f);
    let tMin = Math.min(...ts);
    let tMax = Math.max(...ts);
    if (!(tMax > tMin)) tMax = tMin + 1;
    let fMin = Math.min(...fs);
    let fMax = Math.max(...fs);
    const pad = (fMax - fMin) * 0.08 || 0.01;
    fMin -= pad;
    fMax += pad;
    const px = (t: number) => panel.x0 + ((panel.x1 - panel.x0) * (t - tMin)) / (tMax - tMin);
    const py = (f: number) => panel.y1 - ((panel.y1 - panel.y0) * (f - fMin)) / (fMax - fMin);

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(zh ? '凌星光变 · 原始数据与梯形模型' : 'Transit light curve · data + trapezoid model', canvas.width / 2, 20);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(panel.x0, panel.y0, panel.x1 - panel.x0, panel.y1 - panel.y0);

    // horizontal gridlines + flux ticks
    g.font = '10px Consolas, monospace';
    for (let i = 0; i <= 4; i += 1) {
      const fv = fMin + ((fMax - fMin) * i) / 4;
      const sy = py(fv);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(panel.x0, sy);
      g.lineTo(panel.x1, sy);
      g.stroke();
      g.textAlign = 'right';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(fv.toFixed(fMax - fMin < 0.05 ? 4 : 2), panel.x0 - 5, sy + 3);
    }
    for (let i = 0; i <= 5; i += 1) {
      const tv = tMin + ((tMax - tMin) * i) / 5;
      g.textAlign = 'center';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(tv.toFixed(1), px(tv), panel.y1 + 12);
    }

    // data points
    g.fillStyle = 'rgba(120,200,255,0.75)';
    for (const d of data) {
      g.beginPath();
      g.arc(px(d.t), py(d.f), 1.6, 0, Math.PI * 2);
      g.fill();
    }

    // fitted model overlay
    if (this.fit) {
      g.strokeStyle = 'rgba(255,150,110,0.95)';
      g.lineWidth = 1.4;
      g.beginPath();
      const steps = 900;
      for (let i = 0; i <= steps; i += 1) {
        const t = tMin + ((tMax - tMin) * i) / steps;
        const f = trapezoidFlux(t, this.fit.params);
        if (i === 0) g.moveTo(px(t), py(f));
        else g.lineTo(px(t), py(f));
      }
      g.stroke();
      g.lineWidth = 1;
    } else if (this.detection) {
      // detected box only: draw vertical markers at detection epoch and period spacing
      g.strokeStyle = 'rgba(255,220,120,0.6)';
      const P = this.detection.period;
      for (let k = Math.floor(tMin / P) - 1; k * P + this.detection.epoch <= tMax + P; k += 1) {
        const tc = this.detection.epoch + k * P;
        if (tc < tMin || tc > tMax) continue;
        g.beginPath();
        g.moveTo(px(tc), panel.y0);
        g.lineTo(px(tc), panel.y1);
        g.stroke();
      }
    }

    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText('flux', panel.x0 - 8, panel.y0 - 6);
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText(zh ? '时间 (d)' : 'time (d)', panel.x1 - 52, panel.y1 + 24);
  }

  private drawFolded(
    g: CanvasRenderingContext2D,
    _canvas: HTMLCanvasElement,
    panel: { x0: number; x1: number; y0: number; y1: number },
    zh: boolean,
  ) {
    const P = this.fit?.params.P ?? this.detection?.period;
    const T0 = this.fit?.params.T0 ?? this.detection?.epoch;
    if (!P || !T0) return;
    const folded = phaseFold(this.data!, P, T0);
    const fluxes = folded.map((p) => p.f);
    let fMin = Math.min(...fluxes);
    let fMax = Math.max(...fluxes);
    const pad = (fMax - fMin) * 0.1 || 0.01;
    fMin -= pad;
    fMax += pad;
    const px = (phase: number) => panel.x0 + ((panel.x1 - panel.x0) * (phase + 0.5)) / 1;
    const py = (f: number) => panel.y1 - ((panel.y1 - panel.y0) * (f - fMin)) / (fMax - fMin);

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillText(
      zh ? `相位折叠（P=${fmtMetric(P)} d）` : `Phase-folded (P=${fmtMetric(P)} d)`,
      (panel.x0 + panel.x1) / 2,
      panel.y0 - 8,
    );
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(panel.x0, panel.y0, panel.x1 - panel.x0, panel.y1 - panel.y0);

    // phase ticks
    g.font = '10px Consolas, monospace';
    for (const ph of [-0.5, -0.25, 0, 0.25, 0.5]) {
      g.textAlign = 'center';
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(ph.toFixed(2), px(ph), panel.y1 + 12);
      if (ph !== -0.5 && ph !== 0.5) {
        g.strokeStyle = 'rgba(255,255,255,0.05)';
        g.beginPath();
        g.moveTo(px(ph), panel.y0);
        g.lineTo(px(ph), panel.y1);
        g.stroke();
      }
    }

    // points
    g.fillStyle = 'rgba(120,200,255,0.7)';
    for (const p of folded) {
      g.beginPath();
      g.arc(px(p.phase), py(p.f), 1.6, 0, Math.PI * 2);
      g.fill();
    }

    // binned means
    const bins = binFolded(folded, 30).filter((b) => b.n > 0);
    g.fillStyle = 'rgba(255,235,150,0.95)';
    for (const b of bins) {
      g.beginPath();
      g.arc(px(b.phase), py(b.mean), 2.6, 0, Math.PI * 2);
      g.fill();
    }

    // model over phase
    if (this.fit) {
      g.strokeStyle = 'rgba(255,150,110,0.95)';
      g.lineWidth = 1.4;
      g.beginPath();
      for (let i = 0; i <= 300; i += 1) {
        const phase = -0.5 + i / 300;
        // sample the model at a fixed reference epoch (periodicity makes any epoch equivalent)
        const f = trapezoidFlux(T0 + phase * P, this.fit.params);
        if (i === 0) g.moveTo(px(phase), py(f));
        else g.lineTo(px(phase), py(f));
      }
      g.stroke();
      g.lineWidth = 1;
    }
    g.textAlign = 'right';
    g.fillStyle = 'rgba(200,214,232,0.95)';
    g.fillText('flux', panel.x0 - 8, panel.y0 - 4);
  }

  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const fit = this.fit;
    const det = this.detection;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = fit
      ? `${zh ? '拟合' : 'Fit'}: P=${fmtMetric(fit.params.P)}±${fmtMetric(fit.sigma.P)} d  T0=${fmtMetric(fit.params.T0)}±${fmtMetric(fit.sigma.T0)} d  δ=${fmtMetric(fit.params.delta)}±${fmtMetric(fit.sigma.delta)}  Rp/Rs=${fmtMetric(Math.sqrt(fit.params.delta))}`
      : det
        ? `${zh ? '检测' : 'Detected'}: P=${fmtMetric(det.period)} d  δ(box)=${fmtMetric(det.depth)}  score=${fmtMetric(det.score)}σ`
        : zh
          ? '点击「检测周期并拟合」开始分析'
          : 'Press "Detect & Fit" to analyse';
    g.fillText(l1, 54, canvas.height - 28);
    if (fit) {
      g.fillStyle = 'rgba(200,210,225,0.95)';
      const l2 = `${zh ? '时长' : 'Durations'}: T14=${fmtMetric(fit.params.T14)} d  T23=${fmtMetric(fit.params.T23)} d  τ=${fmtMetric(ingressDuration(fit.params))} d  ·  R²=${fmtMetric(fit.r2)}  RMSE=${fmtMetric(fit.rmse)}  χ²/dof=${fmtMetric(fit.chi2 / Math.max(1, fit.dof))}`;
      g.fillText(l2, 54, canvas.height - 12);
    }
  }
}

export default function createAstroTransitPlugin(): Plugin {
  return new AstroTransitPlugin();
}
