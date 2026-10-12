// ==========================================================================
// geo-carbondating — radiocarbon dating laboratory
//
// A 2-D scientific workbench: loads an atmospheric calibration curve
// (IntCal20 excerpt, cal BP / 14C age / sigma), converts the user's F14C ± σ
// (or uncalibrated BP ± σ) measurement into a likelihood profile over the
// calendar axis, and reports the χ²-minimum best fit with 1σ/2σ calibrated
// ranges. The canvas shows the calibration curve segment with the measurement
// band (left) and the normalised age probability distribution (right).
// Scientific outputs cover the uncalibrated age, the calibrated ranges and
// the best-fit point; the Libby law, the IntCal20 anchor round-trip and the
// interpolation sanity checks are one click away via the benchmark action.
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
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { carbonDatingManifest } from './manifest';
import { carbonFigurePanels } from './figure';
import {
  MEAN_LIFE_14C,
  benchmarkCurveAnchor,
  benchmarkInterpolation,
  benchmarkLibby,
  calibrateF14C,
  curveF14CAt,
  demoMeasurement,
  f14cFromRadiocarbonAge,
  libbyAgeFromF14C,
  parseCalibrationCurve,
  uncalibratedAge,
  type CalibrationPoint,
  type CalibrationResult,
  type InterpMode,
} from './kernel';

export { carbonDatingManifest } from './manifest';

type InputMode = 'f14c' | 'bp';
type DataSource = 'intcal20' | 'libby';

interface State {
  inputMode: InputMode;
  f14c: number;
  sigmaF: number;
  bp: number;
  sigmaBp: number;
  source: DataSource;
  interp: InterpMode;
}

const MODES: Array<{ value: InputMode; en: string; zh: string }> = [
  { value: 'f14c', en: 'F14C ± σ', zh: 'F14C ± σ' },
  { value: 'bp', en: 'Radiocarbon age BP ± σ', zh: '常规 14C 年龄 BP ± σ' },
];

export class CarbonDatingPlugin implements Plugin {
  readonly manifest = carbonDatingManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private curve: CalibrationPoint[] | null = null;
  private result: CalibrationResult | null = null;
  private lastUncal: { age: number; sigma: number } | null = null;
  private state: State = {
    inputMode: 'f14c',
    f14c: 0.6975,
    sigmaF: 0.0035,
    bp: 3600,
    sigmaBp: 40,
    source: 'intcal20',
    interp: 'linear',
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
        key: 'inputMode',
        label: 'Measurement input',
        labelI18n: { 'zh-CN': '测量输入形式', 'en-US': 'Measurement input' },
        type: 'select',
        options: MODES.map((m) => ({
          value: m.value,
          label: this.zh ? m.zh : m.en,
          labelI18n: { 'zh-CN': m.zh, 'en-US': m.en },
        })),
        value: s.inputMode,
      },
      {
        key: 'f14c',
        label: 'F14C',
        labelI18n: { 'zh-CN': 'F14C 测量值', 'en-US': 'F14C measurement' },
        type: 'number',
        min: 0.05,
        max: 1.5,
        step: 0.0005,
        value: s.f14c,
        hint: this.zh ? 'F14C = 1 对应 1950 年大气现代碳' : 'F14C = 1 is modern (1950 AD) carbon',
      },
      {
        key: 'sigmaF',
        label: 'σ(F14C)',
        labelI18n: { 'zh-CN': 'F14C 标准差 σ', 'en-US': 'F14C standard deviation σ' },
        type: 'range',
        min: 0.0005,
        max: 0.05,
        step: 0.0005,
        value: s.sigmaF,
      },
      {
        key: 'bp',
        label: 'Age BP',
        labelI18n: { 'zh-CN': '常规年龄 BP', 'en-US': 'Conventional age BP' },
        type: 'number',
        min: 0,
        max: 50000,
        step: 5,
        value: s.bp,
        hint: this.zh ? '用于「常规 14C 年龄」输入形式' : 'used in the radiocarbon-age input mode',
      },
      {
        key: 'sigmaBp',
        label: 'σ(BP)',
        labelI18n: { 'zh-CN': 'BP 标准差 σ', 'en-US': 'BP standard deviation σ' },
        type: 'range',
        min: 5,
        max: 500,
        step: 5,
        value: s.sigmaBp,
      },
      {
        key: 'source',
        label: 'Calibration source',
        labelI18n: { 'zh-CN': '校准数据源', 'en-US': 'Calibration source' },
        type: 'select',
        options: [
          {
            value: 'intcal20',
            label: this.zh ? 'IntCal20 节选（载入文件）' : 'IntCal20 excerpt (loaded file)',
            labelI18n: { 'zh-CN': 'IntCal20 节选（载入文件）', 'en-US': 'IntCal20 excerpt (loaded file)' },
          },
          {
            value: 'libby',
            label: this.zh ? '无校准（仅 Libby 年龄）' : 'No calibration (Libby age only)',
            labelI18n: { 'zh-CN': '无校准（仅 Libby 年龄）', 'en-US': 'No calibration (Libby age only)' },
          },
        ],
        value: s.source,
      },
      {
        key: 'interp',
        label: 'Interpolation',
        labelI18n: { 'zh-CN': '曲线插值方式', 'en-US': 'Curve interpolation' },
        type: 'select',
        options: [
          { value: 'linear', label: 'Linear', labelI18n: { 'zh-CN': '线性', 'en-US': 'Linear' } },
          { value: 'step', label: 'Step (nearest lower)', labelI18n: { 'zh-CN': '阶梯（取左值）', 'en-US': 'Step (nearest lower)' } },
        ],
        value: s.interp,
      },
      actionButton('calibrate', 'Calibrate', '校准定年', 'primary'),
      actionButton('demo', 'Demo · anchor measurement', '演示 · 锚点测量'),
      actionButton('benchmark', 'Run validation benchmarks', '运行验证基准'),
      actionButton('exportCsv', 'Export profile CSV', '导出概率剖面 CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    const num = (k: string, apply: (n: number) => boolean): void => {
      if (typeof params[k] === 'number' && Number.isFinite(params[k] as number)) {
        if (apply(params[k] as number)) this.draw();
      }
    };
    num('f14c', (n) => {
      if (n === this.state.f14c) return false;
      this.state.f14c = Math.min(1.5, Math.max(0.05, n));
      return true;
    });
    num('sigmaF', (n) => {
      if (n === this.state.sigmaF) return false;
      this.state.sigmaF = Math.min(0.05, Math.max(0.0005, n));
      return true;
    });
    num('bp', (n) => {
      if (n === this.state.bp) return false;
      this.state.bp = Math.min(50000, Math.max(0, n));
      return true;
    });
    num('sigmaBp', (n) => {
      if (n === this.state.sigmaBp) return false;
      this.state.sigmaBp = Math.min(500, Math.max(5, n));
      return true;
    });
    if (typeof params.inputMode === 'string' && (params.inputMode === 'f14c' || params.inputMode === 'bp')) {
      if (params.inputMode !== this.state.inputMode) {
        this.state.inputMode = params.inputMode;
        this.draw();
      }
    }
    if (typeof params.source === 'string' && (params.source === 'intcal20' || params.source === 'libby')) {
      if (params.source !== this.state.source) {
        this.state.source = params.source;
        this.draw();
      }
    }
    if (typeof params.interp === 'string' && (params.interp === 'linear' || params.interp === 'step')) {
      if (params.interp !== this.state.interp) {
        this.state.interp = params.interp as InterpMode;
        this.draw();
      }
    }
    if (actionFired(params, 'calibrate')) this.calibrate();
    if (actionFired(params, 'demo')) this.runDemo();
    if (actionFired(params, 'benchmark')) this.runBenchmarks();
    if (actionFired(params, 'exportCsv')) this.exportCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const low = file.name.toLowerCase();
    if (!low.endsWith('.csv') && !low.endsWith('.tsv') && !low.endsWith('.txt')) {
      notify(this.api, 'warning', 'Calibration curves must be CSV / TSV / TXT.', '校准曲线文件须为 CSV / TSV / TXT。');
      return;
    }
    const text = await file.text();
    const curve = parseCalibrationCurve(text);
    if (curve.length < 3) {
      notify(
        this.api,
        'warning',
        'Need ≥3 curve rows (cal BP, 14C age, sigma).',
        '至少需要 3 行曲线数据（cal BP、14C 年龄、σ）。',
      );
      return;
    }
    this.curve = curve;
    notify(
      this.api,
      'success',
      `Loaded calibration curve: ${curve.length} rows, ${curve[0]!.calBP.toFixed(0)}–${curve[curve.length - 1]!.calBP.toFixed(0)} cal BP.`,
      `已载入校准曲线：${curve.length} 行，${curve[0]!.calBP.toFixed(0)}–${curve[curve.length - 1]!.calBP.toFixed(0)} cal BP。`,
    );
    this.calibrate();
  }

  /** Current measurement as F14C ± σ, from either input mode. */
  private measurement(): { f14c: number; sigma: number } {
    if (this.state.inputMode === 'bp') {
      const f = f14cFromRadiocarbonAge(this.state.bp);
      return { f14c: f, sigma: (f * this.state.sigmaBp) / MEAN_LIFE_14C };
    }
    return { f14c: this.state.f14c, sigma: this.state.sigmaF };
  }

  private calibrate() {
    const meas = this.measurement();
    const uncal = uncalibratedAge(meas.f14c, meas.sigma);
    this.lastUncal = uncal;
    this.result = null;
    if (this.state.source === 'intcal20') {
      if (!this.curve) {
        clearScienceOutputs(this.manifest.id);
        this.draw();
        return;
      }
      const res = calibrateF14C(this.curve, meas.f14c, meas.sigma, { mode: this.state.interp });
      if (!res) {
        notify(this.api, 'warning', 'Calibration failed — check measurement σ.', '校准失败——请检查测量 σ。');
        this.draw();
        return;
      }
      this.result = res;
      this.publishCalibration(uncal);
    } else {
      this.publishLibby(uncal);
    }
    this.draw();
  }

  private publishLibby(uncal: { age: number; sigma: number }) {
    const metrics: ScienceMetric[] = [
      {
        key: 'uncal-age',
        label: 'Uncalibrated age',
        value: `${fmtMetric(uncal.age)} ± ${fmtMetric(uncal.sigma)}`,
        unit: 'yr BP',
        severity: 'info',
        hint: this.zh
          ? 'Libby 常规年龄 t = −8033·ln(F14C)，未做大气校准'
          : 'Libby conventional age t = −8033·ln(F14C), no atmospheric calibration',
      },
      {
        key: 'cal-range',
        label: 'Calibrated range',
        value: this.zh ? '未校准模式' : 'not calibrated',
        severity: 'info',
        hint: this.zh ? '切换数据源为 IntCal20 并载入曲线后输出校准区间' : 'switch the source to IntCal20 and load a curve for calibrated ranges',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private publishCalibration(uncal: { age: number; sigma: number }) {
    const res = this.result;
    if (!res) return;
    const fmtRanges = (rs: Array<{ from: number; to: number }>): string =>
      rs.length === 0 ? '—' : rs.map((r) => `${fmtMetric(r.from)}–${fmtMetric(r.to)}`).join('; ');
    const provenance = this.zh
      ? `IntCal20 节选（Reimer et al. 2020），${this.state.interp === 'linear' ? '线性' : '阶梯'}插值`
      : `IntCal20 excerpt (Reimer et al. 2020), ${this.state.interp} interpolation`;
    const metrics: ScienceMetric[] = [
      {
        key: 'uncal-age',
        label: 'Uncalibrated age',
        value: `${fmtMetric(uncal.age)} ± ${fmtMetric(uncal.sigma)}`,
        unit: 'yr BP',
        severity: 'info',
        hint: this.zh ? 'Libby 常规年龄 t = −8033·ln(F14C)' : 'Libby conventional age t = −8033·ln(F14C)',
      },
      {
        key: 'cal-best',
        label: 'Calibrated best fit',
        value: fmtMetric(res.bestFitCalBP),
        unit: 'cal yr BP',
        severity: 'ok',
        hint: `${this.zh ? 'χ² 最小点，χ²min' : 'χ² minimum, χ²min'} = ${fmtMetric(res.chi2Min)} · ${provenance}`,
      },
      {
        key: 'cal-1sig',
        label: '1σ range',
        value: fmtRanges(res.interval1),
        unit: 'cal yr BP',
        severity: 'info',
        hint: this.zh ? 'Δχ² ≤ 1（≈68%）的连续日历年段' : 'contiguous calendar segments with Δχ² ≤ 1 (≈68%)',
      },
      {
        key: 'cal-2sig',
        label: '2σ range',
        value: fmtRanges(res.interval2),
        unit: 'cal yr BP',
        severity: 'info',
        hint: this.zh ? 'Δχ² ≤ 4（≈95%）；平台期可能给出多段区间' : 'Δχ² ≤ 4 (≈95%); plateaus may yield several segments',
      },
      {
        key: 'cal-chi2',
        label: 'χ²min',
        value: fmtMetric(res.chi2Min),
        severity: res.chi2Min < 4 ? 'ok' : 'warn',
        hint: this.zh ? '拟合优度：过大提示测量偏离校准曲线' : 'goodness of fit: large values indicate the measurement deviates from the curve',
      },
    ];
    setScienceOutputs(this.manifest.id, metrics);
  }

  private runDemo() {
    if (!this.curve) {
      notify(
        this.api,
        'warning',
        'Load an IntCal20 curve first (sample-data bar or Open File).',
        '请先载入 IntCal20 曲线（示例数据栏或打开文件）。',
      );
      return;
    }
    const meas = demoMeasurement(this.curve, 3050, 3050);
    if (!meas) {
      notify(this.api, 'warning', 'Demo measurement failed.', '演示测量生成失败。');
      return;
    }
    this.state.inputMode = 'f14c';
    this.state.f14c = meas.f14c;
    this.state.sigmaF = Math.max(meas.sigma, 0.0005);
    this.state.source = 'intcal20';
    const age = libbyAgeFromF14C(meas.f14c);
    notify(
      this.api,
      'success',
      `Demo: F14C=${meas.f14c.toFixed(4)} ± ${meas.sigma.toFixed(4)} (≈ ${age.toFixed(0)} yr BP) around the cal BP 3050 anchor.`,
      `演示：F14C=${meas.f14c.toFixed(4)} ± ${meas.sigma.toFixed(4)}（≈ ${age.toFixed(0)} yr BP），取自 cal BP 3050 锚点附近。`,
    );
    this.calibrate();
  }

  private runBenchmarks() {
    const outcomes = [benchmarkLibby()];
    if (this.curve) {
      outcomes.push(benchmarkCurveAnchor(this.curve), benchmarkInterpolation(this.curve));
    } else {
      outcomes.push({
        name: 'intcal20-anchor',
        passed: false,
        relErr: null,
        detail: this.zh ? '未载入校准曲线' : 'no calibration curve loaded',
      });
    }
    const metrics: ScienceMetric[] = outcomes.map((o) => ({
      key: `bench-${o.name}`,
      label: `Bench · ${o.name}`,
      value: o.passed ? (o.relErr == null ? 'ok' : `${(o.relErr * 100).toFixed(4)}%`) : 'FAIL',
      severity: o.passed ? 'ok' : 'warn',
      hint: o.detail,
    }));
    setScienceOutputs(this.manifest.id, metrics);
    const allOk = outcomes.every((o) => o.passed);
    notify(
      this.api,
      allOk ? 'success' : 'warning',
      `Benchmarks: ${outcomes.map((o) => `${o.name}=${o.passed ? 'pass' : 'FAIL'}`).join(', ')}`,
      `基准验证：${outcomes.map((o) => `${o.name}=${o.passed ? '通过' : '未通过'}`).join('，')}`,
    );
    this.draw();
  }

  private exportCsv() {
    const res = this.result;
    if (!res || !this.curve) {
      notify(this.api, 'warning', 'Run a calibration first.', '请先运行一次校准。');
      return;
    }
    const rows: Array<Array<number | string>> = res.profile.map((p) => {
      const in1 = res.interval1.some((r) => p.calBP >= r.from && p.calBP <= r.to) ? 1 : 0;
      const in2 = res.interval2.some((r) => p.calBP >= r.from && p.calBP <= r.to) ? 1 : 0;
      return [
        Number(p.calBP.toFixed(1)),
        Number(curveF14CAt(this.curve!, p.calBP, this.state.interp).f14c.toFixed(6)),
        Number(p.chi2.toFixed(5)),
        Number(p.relProb.toFixed(6)),
        in1,
        in2,
      ];
    });
    exportRowsCsv(
      this.api,
      'radiocarbon-calibration-profile',
      ['cal_bp', 'f14c_curve', 'chi2', 'rel_prob', 'in_1sigma', 'in_2sigma'],
      rows,
    );
  }

  private async sendToFigure(): Promise<void> {
    const meas = this.measurement();
    if (!(meas.f14c > 0) || !Number.isFinite(meas.f14c)) {
      notify(this.api, 'warning', 'No valid measurement to plot.', '暂无可绘图的有效测量值。');
      return;
    }
    const uncal = this.lastUncal ?? uncalibratedAge(meas.f14c, meas.sigma);
    const res = this.result;
    const calTxt = res
      ? this.zh
        ? `校准最佳点 ${res.bestFitCalBP.toFixed(0)} cal BP（χ²min=${res.chi2Min.toFixed(2)}），1σ 区间 ${res.interval1
            .map((r) => `${r.from.toFixed(0)}–${r.to.toFixed(0)}`)
            .join('; ') || '—'} cal BP`
        : `calibrated best fit ${res.bestFitCalBP.toFixed(0)} cal BP (χ²min=${res.chi2Min.toFixed(2)}), 1σ range ${res.interval1
            .map((r) => `${r.from.toFixed(0)}–${r.to.toFixed(0)}`)
            .join('; ') || '—'} cal BP`
      : this.zh
        ? '未做大气校准（仅 Libby 年龄）'
        : 'not atmospherically calibrated (Libby age only)';
    const caption: Bilingual = {
      zh: `放射性碳定年：F14C=${meas.f14c.toFixed(4)} ± ${meas.sigma.toFixed(4)}，Libby 常规年龄 ${uncal.age.toFixed(0)} ± ${uncal.sigma.toFixed(0)} yr BP；${calTxt}。`,
      en: `Radiocarbon dating: F14C=${meas.f14c.toFixed(4)} ± ${meas.sigma.toFixed(4)}, Libby conventional age ${uncal.age.toFixed(0)} ± ${uncal.sigma.toFixed(0)} yr BP; ${calTxt}.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '放射性碳定年分析', en: 'Radiocarbon Dating Analysis' },
      caption,
      carbonFigurePanels({ measurement: meas, curve: this.curve, result: this.result }),
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
    const bg = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillStyle = bg;
    g.fillRect(0, 0, canvas.width, canvas.height);

    const needCurve = this.state.source === 'intcal20';
    if (needCurve && !this.curve) {
      clearScienceOutputs(this.manifest.id);
      drawEmptyCanvas(this.api, canvas, {
        title: 'No calibration curve loaded',
        titleZh: '尚未载入校准曲线',
        hint: 'Load an IntCal20 excerpt (CSV: cal BP, 14C age, sigma) via the sample-data bar, or switch the source to Libby-only.',
        hintZh: '请通过示例数据栏载入 IntCal20 节选（CSV：cal BP、14C 年龄、σ），或将数据源切换为「仅 Libby 年龄」。',
      });
      return;
    }
    const zh = this.zh;
    if (needCurve && this.curve && this.result) {
      this.drawCurvePanel(g, canvas, zh);
      this.drawProbabilityPanel(g, canvas, zh);
    } else {
      this.drawLibbyPanel(g, canvas, zh);
    }
    this.drawFooter(g, canvas, zh);
  }

  /** Shared footer with measurement + result summary. */
  private drawFooter(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const meas = this.measurement();
    const uncal = this.lastUncal ?? uncalibratedAge(meas.f14c, meas.sigma);
    g.textAlign = 'left';
    g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const l1 = zh
      ? `测量 F14C=${meas.f14c.toFixed(4)} ± ${meas.sigma.toFixed(4)}  ·  Libby 年龄 ${uncal.age.toFixed(0)} ± ${uncal.sigma.toFixed(0)} yr BP`
      : `Measurement F14C=${meas.f14c.toFixed(4)} ± ${meas.sigma.toFixed(4)}  ·  Libby age ${uncal.age.toFixed(0)} ± ${uncal.sigma.toFixed(0)} yr BP`;
    g.fillText(l1, 54, canvas.height - 28);
    const res = this.result;
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const l2 = res
      ? zh
        ? `校准最佳点 ${res.bestFitCalBP.toFixed(0)} cal BP（χ²min=${res.chi2Min.toFixed(2)}）  ·  1σ：${res.interval1
            .map((r) => `${r.from.toFixed(0)}–${r.to.toFixed(0)}`)
            .join('; ') || '—'}`
        : `Calibrated best fit ${res.bestFitCalBP.toFixed(0)} cal BP (χ²min=${res.chi2Min.toFixed(2)})  ·  1σ: ${res.interval1
            .map((r) => `${r.from.toFixed(0)}–${r.to.toFixed(0)}`)
            .join('; ') || '—'}`
      : zh
        ? '按「校准定年」计算似然剖面与年龄区间'
        : 'Press "Calibrate" to compute the likelihood profile and age ranges';
    g.fillText(l2, 54, canvas.height - 12);
  }

  /** Libby-only view: normal probability density of the uncalibrated age. */
  private drawLibbyPanel(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const meas = this.measurement();
    const uncal = uncalibratedAge(meas.f14c, meas.sigma);
    const padL = 56;
    const padR = 20;
    const padT = 46;
    const padB = 50;
    const x0 = padL;
    const x1 = canvas.width - padR;
    const y0 = padT;
    const y1 = canvas.height - padB;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    const ageMin = uncal.age - 4 * uncal.sigma;
    const ageMax = uncal.age + 4 * uncal.sigma;
    const px = (t: number) => x0 + ((t - ageMin) / (ageMax - ageMin)) * plotW;
    const py = (p: number) => y1 - p * plotH;
    const pdf = (t: number) => {
      const z = (t - uncal.age) / uncal.sigma;
      return Math.exp(-0.5 * z * z); // unnormalised (peak = 1)
    };

    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `13px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(
      zh ? '未校准年龄概率分布（Libby）' : 'Uncalibrated age probability (Libby)',
      canvas.width / 2,
      20,
    );
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // filled gaussian + 1σ/2σ bands
    const band = (k: number, color: string) => {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(px(uncal.age - k * uncal.sigma), y1);
      for (let i = 0; i <= 80; i += 1) {
        const t = uncal.age - k * uncal.sigma + (2 * k * uncal.sigma * i) / 80;
        g.lineTo(px(t), py(pdf(t)));
      }
      g.lineTo(px(uncal.age + k * uncal.sigma), y1);
      g.closePath();
      g.fill();
    };
    band(2, 'rgba(120,170,240,0.14)');
    band(1, 'rgba(120,170,240,0.22)');
    g.strokeStyle = 'rgba(140,190,250,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i <= 160; i += 1) {
      const t = ageMin + ((ageMax - ageMin) * i) / 160;
      const sy = py(pdf(t));
      if (i === 0) g.moveTo(px(t), sy);
      else g.lineTo(px(t), sy);
    }
    g.stroke();

    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = '11px Consolas, monospace';
    for (let i = 0; i <= 4; i += 1) {
      const t = ageMin + ((ageMax - ageMin) * i) / 4;
      g.textAlign = 'center';
      g.fillText(t.toFixed(0), px(t), y1 + 14);
    }
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText(zh ? '常规 14C 年龄 (yr BP)' : 'conventional 14C age (yr BP)', (x0 + x1) / 2, y1 + 30);
    g.textAlign = 'left';
    g.fillText(zh ? '相对概率' : 'rel. probability', x0 + 6, y0 + 14);
  }

  /** Left panel: calibration curve + measurement band + best fit / 1σ bands. */
  private drawCurvePanel(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const curve = this.curve!;
    const res = this.result!;
    const meas = this.measurement();
    const panelW = (canvas.width - 3 * 12) * 0.58;
    const x0 = 54;
    const x1 = x0 + panelW;
    const y0 = 40;
    const y1 = canvas.height - 46;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    const calMin = curve[0]!.calBP;
    const calMax = curve[curve.length - 1]!.calBP;
    let fMin = Number.POSITIVE_INFINITY;
    let fMax = Number.NEGATIVE_INFINITY;
    for (const p of curve) {
      fMin = Math.min(fMin, p.f14c - p.sigmaF14c, meas.f14c - meas.sigma);
      fMax = Math.max(fMax, p.f14c + p.sigmaF14c, meas.f14c + meas.sigma);
    }
    const padF = 0.04 * (fMax - fMin);
    fMin -= padF;
    fMax += padF;
    const px = (t: number) => x0 + ((t - calMin) / (calMax - calMin)) * plotW;
    const py = (f: number) => y1 - ((f - fMin) / (fMax - fMin)) * plotH;

    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(zh ? '校准曲线与测量置信带' : 'Calibration curve + measurement band', x0 + plotW / 2, 20);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // 1σ calibrated ranges as vertical bands
    for (const r of res.interval1) {
      g.fillStyle = 'rgba(120,200,160,0.16)';
      g.fillRect(px(r.from), y0, Math.max(px(r.to) - px(r.from), 1), plotH);
    }

    // measurement band (horizontal) ± σ
    g.fillStyle = 'rgba(250,205,120,0.18)';
    g.fillRect(x0, py(meas.f14c + meas.sigma), plotW, Math.max(py(meas.f14c - meas.sigma) - py(meas.f14c + meas.sigma), 1));

    // curve polyline with ±σ envelope
    g.strokeStyle = 'rgba(140,190,250,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < curve.length; i += 1) {
      const p = curve[i]!;
      const sx = px(p.calBP);
      const sy = py(p.f14c);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    }
    g.stroke();
    g.strokeStyle = 'rgba(140,190,250,0.28)';
    g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i < curve.length; i += 1) {
      const p = curve[i]!;
      if (i === 0) g.moveTo(px(p.calBP), py(p.f14c + p.sigmaF14c));
      else g.lineTo(px(p.calBP), py(p.f14c + p.sigmaF14c));
    }
    for (let i = curve.length - 1; i >= 0; i -= 1) {
      const p = curve[i]!;
      g.lineTo(px(p.calBP), py(p.f14c - p.sigmaF14c));
    }
    g.closePath();
    g.stroke();

    // best-fit vertical line
    const bx = px(res.bestFitCalBP);
    g.strokeStyle = 'rgba(235,240,247,0.8)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(bx, y0);
    g.lineTo(bx, y1);
    g.stroke();
    g.setLineDash([]);

    // ticks
    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = '11px Consolas, monospace';
    for (let i = 0; i <= 4; i += 1) {
      const t = calMin + ((calMax - calMin) * i) / 4;
      g.textAlign = 'center';
      g.fillText(t.toFixed(0), px(t), y1 + 14);
      const f = fMin + ((fMax - fMin) * (4 - i)) / 4;
      g.textAlign = 'right';
      g.fillText(f.toFixed(2), x0 - 6, py(f) + 4);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText('F14C', x0 + 6, y0 + 14);
    g.fillText(zh ? 'cal yr BP' : 'cal yr BP', x1 - 62, y1 + 28);
  }

  /** Right panel: normalised likelihood → age probability distribution. */
  private drawProbabilityPanel(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, zh: boolean) {
    const res = this.result!;
    const gap = 12;
    const leftW = (canvas.width - 3 * gap) * 0.58;
    const x0 = 54 + leftW + gap;
    const x1 = canvas.width - gap - 10;
    const y0 = 40;
    const y1 = canvas.height - 46;
    const plotW = Math.max(x1 - x0, 10);
    const plotH = Math.max(y1 - y0, 10);

    // Focus on the 2σ support when available, else the whole profile.
    let calMin = res.profile[0]!.calBP;
    let calMax = res.profile[res.profile.length - 1]!.calBP;
    if (res.interval2.length > 0) {
      calMin = Math.min(...res.interval2.map((r) => r.from));
      calMax = Math.max(...res.interval2.map((r) => r.to));
    }
    const span = Math.max(calMax - calMin, 1);
    const px = (t: number) => x0 + ((t - calMin) / span) * plotW;
    const py = (p: number) => y1 - p * plotH;

    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = `12px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
    g.textAlign = 'center';
    g.fillText(zh ? '校准年龄概率分布' : 'Calibrated age probability', x0 + plotW / 2, 20);
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.strokeRect(x0, y0, plotW, plotH);

    // filled density
    g.fillStyle = 'rgba(120,200,160,0.25)';
    g.beginPath();
    g.moveTo(px(calMin), y1);
    for (const p of res.profile) {
      if (p.calBP < calMin || p.calBP > calMax) continue;
      g.lineTo(px(p.calBP), py(p.relProb));
    }
    g.lineTo(px(calMax), y1);
    g.closePath();
    g.fill();

    // 1σ boundary ticks
    g.strokeStyle = 'rgba(120,200,160,0.9)';
    for (const r of res.interval1) {
      g.beginPath();
      g.moveTo(px(r.from), y0);
      g.lineTo(px(r.from), y1);
      g.moveTo(px(r.to), y0);
      g.lineTo(px(r.to), y1);
      g.stroke();
    }

    // best-fit marker
    const bx = px(res.bestFitCalBP);
    g.strokeStyle = 'rgba(235,240,247,0.8)';
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(bx, y0);
    g.lineTo(bx, y1);
    g.stroke();
    g.setLineDash([]);

    g.fillStyle = 'rgba(170,182,200,0.9)';
    g.font = '11px Consolas, monospace';
    for (let i = 0; i <= 4; i += 1) {
      const t = calMin + (span * i) / 4;
      g.textAlign = 'center';
      g.fillText(t.toFixed(0), px(t), y1 + 14);
    }
    g.textAlign = 'left';
    g.fillStyle = 'rgba(180,195,214,0.9)';
    g.fillText(zh ? '相对概率' : 'rel. probability', x0 + 6, y0 + 14);
    g.fillText(zh ? 'cal yr BP' : 'cal yr BP', x1 - 62, y1 + 28);
  }
}

export default function createCarbonDatingPlugin(): Plugin {
  return new CarbonDatingPlugin();
}
