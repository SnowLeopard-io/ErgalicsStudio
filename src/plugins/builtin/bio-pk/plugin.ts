// ==========================================================================
// bio-pk — pharmacokinetic compartment analysis (canvas workbench)
//
// Draws the central concentration–time profile from RK4 integration with the
// analytic closed form overlaid as a dashed reference, a therapeutic-window
// band (MEC/MSC) and optional semilog-y axis. "Run benchmark" publishes the
// numeric-vs-analytic validation errors and the AUC mass-conservation check
// to the scientific-output strip; every summary (Cmax/Tmax/t½/AUC) is also
// published there and exportable as CSV.
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
import { bioPkManifest } from './manifest';
import { pkFigurePanels } from './figure';
import {
  DEFAULT_PK_PARAMS,
  computePkMetrics,
  macroRates,
  oneCompIvConc,
  oneCompOralConc,
  runPkBenchmarks,
  simulatePk,
  twoCompIvAmount,
  twoCompOralAmount,
  type PkModel,
  type PkParams,
  type PkRoute,
} from './kernel';

export { bioPkManifest } from './manifest';

interface State {
  model: PkModel;
  route: PkRoute;
  dose: number;
  volume: number;
  ke: number;
  ka: number;
  k12: number;
  k21: number;
  tMax: number;
  mec: number;
  msc: number;
  logScale: boolean;
}

const MODEL_OPTIONS: Array<{ value: PkModel; en: string; zh: string }> = [
  { value: 'one-compartment', en: 'One-compartment', zh: '一室模型' },
  { value: 'two-compartment', en: 'Two-compartment', zh: '二室模型' },
];

const ROUTE_OPTIONS: Array<{ value: PkRoute; en: string; zh: string }> = [
  { value: 'iv-bolus', en: 'IV bolus', zh: '静脉推注' },
  { value: 'oral', en: 'Oral (1st-order)', zh: '口服（一级吸收）' },
];

export class BioPkPlugin implements Plugin {
  readonly manifest = bioPkManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    model: DEFAULT_PK_PARAMS.model,
    route: DEFAULT_PK_PARAMS.route,
    dose: DEFAULT_PK_PARAMS.dose,
    volume: DEFAULT_PK_PARAMS.volume,
    ke: DEFAULT_PK_PARAMS.ke,
    ka: DEFAULT_PK_PARAMS.ka,
    k12: DEFAULT_PK_PARAMS.k12,
    k21: DEFAULT_PK_PARAMS.k21,
    tMax: 24,
    mec: 10,
    msc: 20,
    logScale: false,
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

  private params(): PkParams {
    return {
      model: this.state.model,
      route: this.state.route,
      dose: this.state.dose,
      volume: this.state.volume,
      ke: this.state.ke,
      ka: this.state.ka,
      k12: this.state.k12,
      k21: this.state.k21,
    };
  }

  getParams(): ParamDefinition[] {
    return [
      {
        key: 'model',
        label: 'Model',
        labelI18n: { 'zh-CN': '室模型', 'en-US': 'Model' },
        type: 'select',
        options: MODEL_OPTIONS.map((m) => ({
          value: m.value,
          label: this.zh ? m.zh : m.en,
          labelI18n: { 'zh-CN': m.zh, 'en-US': m.en },
        })),
        value: this.state.model,
      },
      {
        key: 'route',
        label: 'Route',
        labelI18n: { 'zh-CN': '给药途径', 'en-US': 'Route' },
        type: 'select',
        options: ROUTE_OPTIONS.map((m) => ({
          value: m.value,
          label: this.zh ? m.zh : m.en,
          labelI18n: { 'zh-CN': m.zh, 'en-US': m.en },
        })),
        value: this.state.route,
      },
      {
        key: 'dose',
        label: 'D',
        labelI18n: { 'zh-CN': '剂量 D (mg)', 'en-US': 'Dose D (mg)' },
        type: 'range',
        min: 25,
        max: 1000,
        step: 25,
        value: this.state.dose,
      },
      {
        key: 'volume',
        label: 'Vd',
        labelI18n: { 'zh-CN': '表观分布容积 Vd (L)', 'en-US': 'Volume Vd (L)' },
        type: 'range',
        min: 5,
        max: 100,
        step: 1,
        value: this.state.volume,
        hint: this.zh ? '文献量级：茶碱 ≈ 0.5 L/kg' : 'literature scale: theophylline ≈ 0.5 L/kg',
      },
      {
        key: 'ke',
        label: 'ke',
        labelI18n: { 'zh-CN': '消除速率 ke (1/h)', 'en-US': 'Elimination ke (1/h)' },
        type: 'range',
        min: 0.02,
        max: 1,
        step: 0.01,
        value: this.state.ke,
      },
      {
        key: 'ka',
        label: 'ka',
        labelI18n: { 'zh-CN': '吸收速率 ka (1/h)', 'en-US': 'Absorption ka (1/h)' },
        type: 'range',
        min: 0.05,
        max: 4,
        step: 0.05,
        value: this.state.ka,
        hint: this.zh ? '仅口服途径使用' : 'oral route only',
      },
      {
        key: 'k12',
        label: 'k12',
        labelI18n: { 'zh-CN': '外周转运 k12 (1/h)', 'en-US': 'Transfer k12 (1/h)' },
        type: 'range',
        min: 0,
        max: 2,
        step: 0.05,
        value: this.state.k12,
        hint: this.zh ? '仅二室模型使用' : 'two-compartment only',
      },
      {
        key: 'k21',
        label: 'k21',
        labelI18n: { 'zh-CN': '返回转运 k21 (1/h)', 'en-US': 'Return k21 (1/h)' },
        type: 'range',
        min: 0,
        max: 2,
        step: 0.05,
        value: this.state.k21,
      },
      {
        key: 'tMax',
        label: 't range',
        labelI18n: { 'zh-CN': '仿真时长 (h)', 'en-US': 'Simulated span (h)' },
        type: 'range',
        min: 6,
        max: 72,
        step: 2,
        value: this.state.tMax,
      },
      {
        key: 'mec',
        label: 'MEC',
        labelI18n: { 'zh-CN': '最低有效浓度 MEC', 'en-US': 'MEC (min. effective conc.)' },
        type: 'range',
        min: 0,
        max: 30,
        step: 1,
        value: this.state.mec,
      },
      {
        key: 'msc',
        label: 'MSC',
        labelI18n: { 'zh-CN': '最低中毒浓度 MSC', 'en-US': 'MSC (max. safe conc.)' },
        type: 'range',
        min: 0,
        max: 40,
        step: 1,
        value: this.state.msc,
      },
      {
        key: 'logScale',
        label: 'Semilog y',
        labelI18n: { 'zh-CN': '半对数坐标', 'en-US': 'Semilog y-axis' },
        type: 'checkbox',
        value: this.state.logScale,
      },
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export profile CSV', '导出药时曲线 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, min: number, apply: (n: number) => void): void => {
      const v = params[k];
      if (typeof v === 'number' && Number.isFinite(v)) {
        const next = Math.max(min, v);
        if (next !== this.state[k as keyof State]) {
          apply(next);
          this.draw();
        }
      }
    };
    num('dose', 1, (n) => {
      this.state.dose = n;
    });
    num('volume', 0.5, (n) => {
      this.state.volume = n;
    });
    num('ke', 0.005, (n) => {
      this.state.ke = n;
    });
    num('ka', 0.01, (n) => {
      this.state.ka = n;
    });
    num('k12', 0, (n) => {
      this.state.k12 = n;
    });
    num('k21', 0, (n) => {
      this.state.k21 = n;
    });
    num('tMax', 2, (n) => {
      this.state.tMax = n;
    });
    num('mec', 0, (n) => {
      this.state.mec = n;
    });
    num('msc', 0, (n) => {
      this.state.msc = n;
    });
    if (typeof params.model === 'string' && MODEL_OPTIONS.some((m) => m.value === params.model)) {
      if (params.model !== this.state.model) {
        this.state.model = params.model as PkModel;
        this.draw();
      }
    }
    if (typeof params.route === 'string' && ROUTE_OPTIONS.some((m) => m.value === params.route)) {
      if (params.route !== this.state.route) {
        this.state.route = params.route as PkRoute;
        this.draw();
      }
    }
    if (typeof params.logScale === 'boolean' && params.logScale !== this.state.logScale) {
      this.state.logScale = params.logScale;
      this.draw();
    }
    if (actionFired(params, 'benchmark')) this.runBenchmark();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    // Sampling files are accepted for provenance but the model curve is
    // parameter-driven; sampled profiles are not overlay-matched here.
    const low = file.name.toLowerCase();
    if (!low.endsWith('.csv') && !low.endsWith('.tsv')) {
      notify(this.api, 'warning', 'bio-pk accepts time,concentration CSV/TSV.', 'bio-pk 仅接受 time,concentration 的 CSV/TSV。');
      return;
    }
    const text = await file.text();
    const rows = text
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.startsWith('#')).length;
    notify(
      this.api,
      'info',
      `Read ${rows} sampled rows — the model curve is parameter-driven; adjust the sliders to match your data.`,
      `读取 ${rows} 行采样数据——模型曲线由参数驱动，请调节滑块以拟合你的数据。`,
    );
  }

  private runBenchmark() {
    const bench = runPkBenchmarks();
    const worst = bench.cases.reduce((acc, c) => Math.max(acc, c.relErr), 0);
    const aucCase = bench.cases.find((c) => c.key === 'auc');
    const m = computePkMetricsSafe(this.params(), this.state.tMax, this.state.tMax / 1200);
    const tHalfTxt = Number.isFinite(m.halfLife) ? fmtMetric(m.halfLife) : '—';
    const metrics: ScienceMetric[] = bench.cases.map((c) => ({
      key: `pk-bench-${c.key}`,
      label: `Bench · ${c.key}`,
      value: fmtMetric(c.relErr * 100),
      unit: '%',
      severity: c.relErr < c.tolerance ? 'ok' : 'error',
      hint: `${c.label} — tol ${(c.tolerance * 100).toFixed(2)}%`,
    }));
    metrics.push(
      {
        key: 'cmax',
        label: 'Cmax',
        value: fmtMetric(m.cmax),
        unit: 'mg/L',
        severity: 'info',
        hint: this.zh ? '数值解峰值浓度' : 'peak of the numeric profile',
      },
      {
        key: 'tmax',
        label: 'Tmax',
        value: fmtMetric(m.tmax),
        unit: 'h',
        severity: 'info',
      },
      {
        key: 'half-life',
        label: 't½',
        value: tHalfTxt,
        unit: 'h',
        severity: 'info',
        hint:
          this.zh
            ? this.state.model === 'two-compartment'
              ? 'β 相消除半衰期 ln2/β'
              : 'ln2/λz'
            : this.state.model === 'two-compartment'
              ? 'β-phase elimination half-life ln2/β'
              : 'ln2/λz',
      },
      {
        key: 'auc-err',
        label: 'AUC err',
        value: fmtMetric(m.aucRelErr * 100),
        unit: '%',
        severity: (aucCase?.relErr ?? 1) < (aucCase?.tolerance ?? 0.01) ? 'ok' : 'warn',
        hint: this.zh
          ? '梯形积分+尾部修正 vs 解析 AUC=D/(ke·Vd)'
          : 'trapezoid + tail vs analytic AUC = D/(ke·Vd)',
      },
    );
    setScienceOutputs(this.manifest.id, metrics);
    notify(
      this.api,
      bench.allPassed ? 'success' : 'warning',
      bench.allPassed
        ? `All PK benchmarks passed (worst rel. err ${(worst * 100).toFixed(4)}%).`
        : `PK benchmark failed — worst rel. err ${(worst * 100).toFixed(4)}%.`,
      bench.allPassed
        ? `全部 PK 基准通过（最大相对误差 ${(worst * 100).toFixed(4)}%）。`
        : `PK 基准未通过——最大相对误差 ${(worst * 100).toFixed(4)}%。`,
    );
  }

  private exportCsv() {
    const p = this.params();
    const dt = this.state.tMax / 600;
    const s = simulatePk(p, this.state.tMax, dt);
    const rows: Array<Array<number | string>> = s.times.map((t, i) => [
      Number(t.toFixed(4)),
      Number(s.concentration[i]!.toFixed(6)),
      Number(s.peripheral[i]!.toFixed(6)),
      Number(s.gut[i]!.toFixed(6)),
    ]);
    exportRowsCsv(this.api, 'bio-pk-profile', ['time_h', 'C_mg_per_L', 'A2_peripheral_mg', 'A_gi_mg'], rows);
  }

  private async sendToFigure(): Promise<void> {
    const m = computePkMetricsSafe(this.params(), this.state.tMax, this.state.tMax / 1200);
    if (!Number.isFinite(m.cmax) || m.cmax <= 0) {
      notify(this.api, 'warning', 'No simulation yet — adjust parameters first.', '尚无仿真结果——请先设置参数。');
      return;
    }
    const tHalf = Number.isFinite(m.halfLife) ? m.halfLife.toFixed(2) : '—';
    const caption: Bilingual = {
      zh: `药代动力学：Cmax=${m.cmax.toFixed(2)} mg/L（Tmax=${m.tmax.toFixed(2)} h），t½=${tHalf} h，AUC=${m.aucAnalytic.toFixed(2)} mg·h/L（数值相对误差 ${(m.aucRelErr * 100).toFixed(3)}%）。`,
      en: `Pharmacokinetics: Cmax=${m.cmax.toFixed(2)} mg/L (Tmax=${m.tmax.toFixed(2)} h), t½=${tHalf} h, AUC=${m.aucAnalytic.toFixed(2)} mg·h/L (numeric rel. err ${(m.aucRelErr * 100).toFixed(3)}%).`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '药代动力学房室模型', en: 'Pharmacokinetic Compartment Model' },
      caption,
      pkFigurePanels({ params: this.params(), tMax: this.state.tMax, logScale: this.state.logScale }),
    );
  }

  // ---- drawing -------------------------------------------------------------

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);

    const p = this.params();
    const dt = this.state.tMax / 900;
    const series = simulatePk(p, this.state.tMax, dt);
    const refAt = this.analyticRef(p);

    const padL = 56;
    const padR = 18;
    const padT = 46;
    const padB = 44;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    const cmax = Math.max(...series.concentration, this.state.msc, 1e-6);
    const useLog = this.state.logScale;
    const yLo = useLog ? Math.max(cmax * 1e-4, 1e-4) : 0;
    const yHi = cmax * 1.15;
    const px = (t: number) => x0 + (plotW * t) / this.state.tMax;
    const py = (c: number): number => {
      const v = Math.max(Math.min(c, yHi), yLo);
      if (useLog) {
        const f = (Math.log10(v) - Math.log10(yLo)) / (Math.log10(yHi) - Math.log10(yLo));
        return y1 - plotH * f;
      }
      return y1 - (plotH * v) / yHi;
    };

    const zh = this.zh;
    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    const title = zh
      ? `药时曲线  ${this.state.model === 'two-compartment' ? '二室' : '一室'} · ${this.state.route === 'oral' ? '口服' : '静脉推注'}  D=${this.state.dose} mg  Vd=${this.state.volume} L`
      : `Concentration–time  ${this.state.model === 'two-compartment' ? 'two-compartment' : 'one-compartment'} · ${this.state.route === 'oral' ? 'oral' : 'IV bolus'}  D=${this.state.dose} mg  Vd=${this.state.volume} L`;
    g.fillText(title, canvas.width / 2, 20);

    // therapeutic window band
    if (this.state.msc > this.state.mec && this.state.msc > 0) {
      const bandTop = py(this.state.msc);
      const bandBottom = py(this.state.mec);
      g.fillStyle = 'rgba(110, 220, 160, 0.12)';
      g.fillRect(x0, Math.min(bandTop, y1), plotW, Math.abs(bandBottom - bandTop));
      g.strokeStyle = 'rgba(110, 220, 160, 0.45)';
      g.setLineDash([4, 4]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x0, bandTop);
      g.lineTo(x1, bandTop);
      g.moveTo(x0, bandBottom);
      g.lineTo(x1, bandBottom);
      g.stroke();
      g.setLineDash([]);
      g.textAlign = 'left';
      g.fillStyle = 'rgba(120, 225, 170, 0.85)';
      g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.fillText(`MSC ${this.state.msc}`, x0 + 4, Math.max(bandTop - 3, y0 + 8));
      g.fillText(`MEC ${this.state.mec}`, x0 + 4, Math.min(bandBottom + 10, y1 - 3));
    }

    // frame + ticks
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 1;
    g.strokeRect(x0, y0, plotW, plotH);
    g.textAlign = 'right';
    g.font = `10px Consolas, monospace`;
    for (let i = 0; i <= 4; i += 1) {
      const c = yLo + ((yHi - yLo) * i) / 4;
      const sy = py(c);
      g.strokeStyle = 'rgba(255,255,255,0.05)';
      g.beginPath();
      g.moveTo(x0, sy);
      g.lineTo(x1, sy);
      g.stroke();
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(c >= 1 ? c.toFixed(1) : c.toExponential(0), x0 - 6, sy + 3);
    }
    g.textAlign = 'center';
    for (let i = 0; i <= 6; i += 1) {
      const t = (this.state.tMax * i) / 6;
      g.fillStyle = 'rgba(170,182,200,0.9)';
      g.fillText(t.toFixed(0), px(t), y1 + 14);
    }

    // analytic reference (dashed) — visual verification of the RK4 numerics
    if (refAt) {
      g.strokeStyle = 'rgba(240, 170, 110, 0.9)';
      g.setLineDash([5, 4]);
      g.lineWidth = 1.5;
      g.beginPath();
      let started = false;
      for (let i = 0; i <= 300; i += 1) {
        const t = (this.state.tMax * i) / 300;
        const c = refAt(t);
        if (!Number.isFinite(c)) {
          started = false;
          continue;
        }
        if (!started) {
          g.moveTo(px(t), py(c));
          started = true;
        } else g.lineTo(px(t), py(c));
      }
      g.stroke();
      g.setLineDash([]);
    }

    // numeric RK4 curve
    g.strokeStyle = 'rgba(120, 200, 250, 0.95)';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < series.times.length; i += 1) {
      const sx = px(series.times[i]!);
      const sy = py(series.concentration[i]!);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.stroke();

    // legend
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    let ly = y0 + 4;
    g.fillStyle = 'rgba(120, 200, 250, 0.95)';
    g.fillRect(x1 - 158, ly, 14, 3);
    g.fillStyle = 'rgba(200, 214, 232, 0.95)';
    g.fillText(zh ? 'RK4 数值解' : 'RK4 numeric', x1 - 140, ly + 6);
    ly += 14;
    if (refAt) {
      g.strokeStyle = 'rgba(240, 170, 110, 0.9)';
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(x1 - 158, ly + 1);
      g.lineTo(x1 - 144, ly + 1);
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = 'rgba(200, 214, 232, 0.95)';
      g.fillText(zh ? '解析解（对照）' : 'analytic reference', x1 - 140, ly + 6);
      ly += 14;
    }
    g.fillStyle = 'rgba(120, 225, 170, 0.8)';
    g.fillText(zh ? '治疗窗 MEC–MSC' : 'therapeutic window', x1 - 140, ly + 6);

    // footer metrics
    const m = computePkMetricsSafe(p, this.state.tMax, this.state.tMax / 1200);
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const tHalfTxt = Number.isFinite(m.halfLife) ? m.halfLife.toFixed(2) : '—';
    g.fillText(
      zh
        ? `Cmax=${m.cmax.toFixed(2)} mg/L  Tmax=${m.tmax.toFixed(2)} h  t½=${tHalfTxt} h  AUC(数值)=${m.aucNumeric.toFixed(2)}  AUC(解析)=${m.aucAnalytic.toFixed(2)} mg·h/L  相对误差=${(m.aucRelErr * 100).toFixed(3)}%`
        : `Cmax=${m.cmax.toFixed(2)} mg/L  Tmax=${m.tmax.toFixed(2)} h  t½=${tHalfTxt} h  AUC(num)=${m.aucNumeric.toFixed(2)}  AUC(analytic)=${m.aucAnalytic.toFixed(2)} mg·h/L  rel.err=${(m.aucRelErr * 100).toFixed(3)}%`,
      54,
      canvas.height - 14,
    );
  }

  /** Closed-form reference for the current model/route, or null when degenerate. */
  private analyticRef(p: PkParams): ((t: number) => number) | null {
    if (p.model === 'one-compartment' && p.route === 'iv-bolus') {
      return (t) => oneCompIvConc(t, p.dose, p.volume, p.ke);
    }
    if (p.model === 'one-compartment' && p.route === 'oral') {
      return (t) => oneCompOralConc(t, p.dose, p.volume, p.ke, p.ka);
    }
    const { alpha, beta } = macroRates(p.ke, p.k12, p.k21);
    if (Math.abs(alpha - beta) < 1e-12) return null;
    if (p.route === 'iv-bolus') {
      return (t) => twoCompIvAmount(t, p.dose, p.ke, p.k12, p.k21) / p.volume;
    }
    return (t) => twoCompOralAmount(t, p.dose, p.ke, p.k12, p.k21, p.ka) / p.volume;
  }
}

/** Thin wrapper so the draw path never throws on degenerate parameters. */
function computePkMetricsSafe(p: PkParams, tMax: number, dt: number) {
  try {
    return computePkMetrics(p, tMax, dt);
  } catch {
    return { cmax: NaN, tmax: NaN, halfLife: NaN, aucNumeric: NaN, aucAnalytic: NaN, aucRelErr: NaN };
  }
}

export default function createBioPkPlugin(): Plugin {
  return new BioPkPlugin();
}
