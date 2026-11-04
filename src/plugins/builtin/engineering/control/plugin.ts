// ==========================================================================
// eng-control — linear system & PID control laboratory
//
// Live workbench for first-/second-order plants with an optional ideal PID
// controller in unity feedback. Parameter edits recompute immediately and
// redraw the canvas; pressing "Simulate" additionally publishes the
// scientific outputs (σ%, tp, ts, e_ss with analytic cross-references and
// the closed-loop half-power bandwidth). The step response overlays the
// closed-form analytic solution (open loop) with the ±2 % band; the Bode
// view shows magnitude and phase on a log-ω axis with the −3 dB (half-
// power) line and the interpolated bandwidth marker. Both series export to
// CSV in one click. No file upload: everything is driven by parameters.
// ==========================================================================

import type { ContainerCapabilities, ParamDefinition, Plugin, PluginApi } from '@/types/plugin';
import {
  actionButton,
  actionFired,
  drawEmptyCanvas,
  exportRowsCsv,
  notify,
} from '@/core/plugin-tools/enhance';
import {
  clearScienceOutputs,
  fmtMetric,
  setScienceOutputs,
  type ScienceMetric,
  type ScienceSeverity,
} from '@/core/research/scienceOutput';
import { pushPanelsToFigure, type Bilingual } from '@/core/figure/sheet';
import { engControlManifest } from './manifest';
import { controlFigurePanels } from './figure';
import {
  type BodePoint,
  type ControlParams,
  type StepSim,
  type SystemType,
  analyticFirstOrderSettlingTime,
  analyticOvershootPct,
  analyticPeakTime,
  analyticSecondOrderBandwidth,
  analyticSecondOrderStep,
  analyticSettlingTimeExact,
  bodeSweep,
  closedLoopBandwidth,
  simulateStep,
} from './kernel';

export { engControlManifest } from './manifest';

interface State {
  type: SystemType;
  tau: number;
  wn: number;
  zeta: number;
  kp: number;
  ki: number;
  kd: number;
  tEnd: number;
  dt: number;
  view: 'step' | 'bode' | 'both';
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Tick values for a linear axis (nice 1/2/5 steps). */
function linTicks(lo: number, hi: number, target: number): number[] {
  const span = hi - lo;
  if (!(span > 0) || !Number.isFinite(span)) return [lo];
  const raw = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
  const ticks: number[] = [];
  const start = Math.ceil(lo / step - 1e-9) * step;
  for (let v = start; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e4 || a < 1e-3)) return v.toExponential(1);
  return String(Number(v.toPrecision(3)));
}

/** Axes frame with in-frame title, x label (below right) and rotated y label. */
function drawFrame(g: CanvasRenderingContext2D, r: Rect, title: string, xLabel: string, yLabel: string, showX: boolean, zh: boolean): void {
  g.strokeStyle = 'rgba(120,140,165,0.55)';
  g.lineWidth = 1;
  g.strokeRect(r.x, r.y, r.w, r.h);
  g.fillStyle = 'rgba(230,238,248,0.95)';
  g.font = `11px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  g.textAlign = 'left';
  g.textBaseline = 'alphabetic';
  g.fillText(title, r.x + 6, r.y + 14);
  g.font = '10px Consolas, monospace';
  if (showX) {
    g.fillStyle = 'rgba(160,175,195,0.9)';
    g.textAlign = 'right';
    g.fillText(xLabel, r.x + r.w, r.y + r.h + 13);
  }
  g.save();
  g.translate(r.x - 8, r.y + r.h / 2);
  g.rotate(-Math.PI / 2);
  g.textAlign = 'center';
  g.fillStyle = 'rgba(160,175,195,0.9)';
  g.fillText(yLabel, 0, 0);
  g.restore();
}

export class EngControlPlugin implements Plugin {
  readonly manifest = engControlManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private zh = false;
  private state: State = {
    type: 'second',
    tau: 0.5,
    wn: 2,
    zeta: 0.3,
    kp: 0,
    ki: 0,
    kd: 0,
    tEnd: 12,
    dt: 0.002,
    view: 'both',
  };
  private params: ControlParams | null = null;
  private sim: StepSim | null = null;
  private bode: BodePoint[] | null = null;
  private bandwidth = Number.NaN;
  private errorMsg: string | null = null;

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
        key: 'type',
        label: 'System type',
        labelI18n: { 'zh-CN': '系统类型', 'en-US': 'System type' },
        type: 'select',
        options: [
          {
            value: 'second',
            label: 'Second order (ωn, ζ)',
            labelI18n: { 'zh-CN': '二阶（ωn，ζ）', 'en-US': 'Second order (ωn, ζ)' },
          },
          {
            value: 'first',
            label: 'First order (τ)',
            labelI18n: { 'zh-CN': '一阶（τ）', 'en-US': 'First order (τ)' },
          },
        ],
        value: s.type,
      },
      {
        key: 'tau',
        label: 'τ (s)',
        labelI18n: { 'zh-CN': '时间常数 τ (s)', 'en-US': 'τ (s)' },
        type: 'range',
        min: 0.01,
        max: 10,
        step: 0.01,
        value: s.tau,
        hint: this.zh ? '一阶时间常数' : 'first-order time constant',
        visibleWhen: { key: 'type', in: ['first'] },
      },
      {
        key: 'wn',
        label: 'ωn (rad/s)',
        labelI18n: { 'zh-CN': '自然频率 ωn (rad/s)', 'en-US': 'ωn (rad/s)' },
        type: 'range',
        min: 0.1,
        max: 20,
        step: 0.1,
        value: s.wn,
        hint: this.zh ? '二阶无阻尼自然频率' : 'second-order natural frequency',
        visibleWhen: { key: 'type', in: ['second'] },
      },
      {
        key: 'zeta',
        label: 'ζ',
        labelI18n: { 'zh-CN': '阻尼比 ζ', 'en-US': 'Damping ratio ζ' },
        type: 'range',
        min: 0,
        max: 2,
        step: 0.01,
        value: s.zeta,
        visibleWhen: { key: 'type', in: ['second'] },
      },
      {
        key: 'kp',
        label: 'Kp',
        labelI18n: { 'zh-CN': '比例增益 Kp', 'en-US': 'Proportional Kp' },
        type: 'range',
        min: 0,
        max: 20,
        step: 0.1,
        value: s.kp,
        hint: this.zh ? '全部为 0 时为开环被控对象' : 'all-zero gains = open-loop plant',
      },
      {
        key: 'ki',
        label: 'Ki',
        labelI18n: { 'zh-CN': '积分增益 Ki', 'en-US': 'Integral Ki' },
        type: 'range',
        min: 0,
        max: 20,
        step: 0.1,
        value: s.ki,
      },
      {
        key: 'kd',
        label: 'Kd',
        labelI18n: { 'zh-CN': '微分增益 Kd', 'en-US': 'Derivative Kd' },
        type: 'range',
        min: 0,
        max: 5,
        step: 0.05,
        value: s.kd,
      },
      {
        key: 'tEnd',
        label: 't_end (s)',
        labelI18n: { 'zh-CN': '仿真时长 t_end (s)', 'en-US': 'Horizon t_end (s)' },
        type: 'range',
        min: 1,
        max: 60,
        step: 1,
        value: s.tEnd,
      },
      {
        key: 'dt',
        label: 'dt (s)',
        labelI18n: { 'zh-CN': '步长 dt (s)', 'en-US': 'Step dt (s)' },
        type: 'range',
        min: 0.0005,
        max: 0.05,
        step: 0.0005,
        value: s.dt,
        hint: this.zh ? 'RK4 固定步长' : 'fixed RK4 step',
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'both', label: 'Step + Bode', labelI18n: { 'zh-CN': '阶跃 + Bode', 'en-US': 'Step + Bode' } },
          { value: 'step', label: 'Step response', labelI18n: { 'zh-CN': '阶跃响应', 'en-US': 'Step response' } },
          { value: 'bode', label: 'Bode (mag + phase)', labelI18n: { 'zh-CN': 'Bode（幅值 + 相位）', 'en-US': 'Bode (mag + phase)' } },
        ],
        value: s.view,
      },
      actionButton('simulate', 'Simulate', '仿真', 'primary'),
      actionButton('exportStep', 'Export step CSV', '导出阶跃 CSV'),
      actionButton('exportBode', 'Export Bode CSV', '导出 Bode CSV'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let changed = false;
    const num = (k: 'tau' | 'wn' | 'zeta' | 'kp' | 'ki' | 'kd' | 'tEnd' | 'dt', lo: number, hi: number): void => {
      const v = params[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) return;
      const c = clamp(v, lo, hi);
      if (this.state[k] !== c) {
        this.state[k] = c;
        changed = true;
      }
    };
    num('tau', 0.01, 10);
    num('wn', 0.1, 20);
    num('zeta', 0, 2);
    num('kp', 0, 20);
    num('ki', 0, 20);
    num('kd', 0, 5);
    num('tEnd', 1, 60);
    num('dt', 0.0005, 0.05);
    if ((params.type === 'first' || params.type === 'second') && params.type !== this.state.type) {
      this.state.type = params.type;
      changed = true;
    }
    if ((params.view === 'step' || params.view === 'bode' || params.view === 'both') && params.view !== this.state.view) {
      this.state.view = params.view;
      changed = true;
    }
    // Parameter edits recompute + redraw live; science outputs only on Simulate.
    if (changed) {
      this.recompute();
      this.draw();
    }
    if (actionFired(params, 'simulate')) this.runSimulation();
    if (actionFired(params, 'exportStep')) this.exportStepCsv();
    if (actionFired(params, 'exportBode')) this.exportBodeCsv();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
  }

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  // ---- compute -------------------------------------------------------------

  private recompute() {
    const s = this.state;
    const p: ControlParams = {
      type: s.type,
      tau: s.tau,
      wn: s.wn,
      zeta: s.zeta,
      kp: s.kp,
      ki: s.ki,
      kd: s.kd,
      tEnd: s.tEnd,
      dt: s.dt,
    };
    this.params = p;
    this.errorMsg = null;
    try {
      this.sim = simulateStep(p);
      this.bode = bodeSweep(p, 400);
      this.bandwidth = closedLoopBandwidth(p);
    } catch (e) {
      this.sim = null;
      this.bode = null;
      this.bandwidth = Number.NaN;
      this.errorMsg = e instanceof Error ? e.message : String(e);
      clearScienceOutputs(this.manifest.id);
    }
  }

  /** Simulate button: recompute, publish scientific outputs and announce. */
  private runSimulation() {
    this.recompute();
    if (!this.sim || !this.params) {
      notify(
        this.api,
        'error',
        `Simulation failed: ${this.errorMsg ?? 'invalid parameters'}`,
        `仿真失败：${this.errorMsg ?? '参数无效'}`,
      );
      this.draw();
      return;
    }
    this.publishOutputs();
    const m = this.sim.metrics;
    const ts = Number.isFinite(m.settlingTime) ? fmtMetric(m.settlingTime) : m.settlingTime === Infinity ? '∞' : '—';
    const wb = Number.isFinite(this.bandwidth) ? fmtMetric(this.bandwidth) : this.bandwidth === Infinity ? '∞' : '—';
    notify(
      this.api,
      'success',
      `σ = ${fmtMetric(m.overshootPct)} % · ts = ${ts} s · e_ss = ${fmtMetric(m.ess)} · ω_b = ${wb} rad/s`,
      `σ = ${fmtMetric(m.overshootPct)} % · ts = ${ts} s · e_ss = ${fmtMetric(m.ess)} · ω_b = ${wb} rad/s`,
    );
    this.draw();
  }

  /** Analytic step response overlay (open loop only; null under PID). */
  private analyticOverlay(): ((t: number) => number) | null {
    const p = this.params;
    if (!p || p.kp > 0 || p.ki > 0 || p.kd > 0) return null;
    if (p.type === 'first') return (t) => 1 - Math.exp(-t / p.tau);
    return (t) => analyticSecondOrderStep(p.wn, p.zeta, t);
  }

  /** Analytic references for the metrics (NaN = no closed form available). */
  private analyticRefs(): { sigma: number; tp: number; ts: number; wb: number } {
    const p = this.params;
    if (!p || p.kp > 0 || p.ki > 0 || p.kd > 0) return { sigma: Number.NaN, tp: Number.NaN, ts: Number.NaN, wb: Number.NaN };
    if (p.type === 'first') {
      return { sigma: 0, tp: Number.NaN, ts: analyticFirstOrderSettlingTime(p.tau), wb: 1 / p.tau };
    }
    return {
      sigma: analyticOvershootPct(p.zeta),
      tp: analyticPeakTime(p.wn, p.zeta),
      ts: analyticSettlingTimeExact(p.wn, p.zeta),
      wb: analyticSecondOrderBandwidth(p.wn, p.zeta),
    };
  }

  private publishOutputs() {
    const sim = this.sim;
    const p = this.params;
    if (!sim || !p) return;
    const zh = this.zh;
    const m = sim.metrics;
    const ref = this.analyticRefs();
    const pidActive = p.kp > 0 || p.ki > 0 || p.kd > 0;
    const metrics: ScienceMetric[] = [];

    // Unified yardstick: |computed − analytic| / |analytic| (undefined vs 0).
    const errOk = (c: number, a: number, tol: number): boolean =>
      Number.isFinite(a) && Number.isFinite(c) && (a !== 0 ? Math.abs(c - a) / Math.abs(a) < tol : Math.abs(c - a) < tol);
    const relErrStr = (c: number, a: number): string | null => {
      if (!Number.isFinite(a) || !Number.isFinite(c) || a === 0) return null;
      return `${fmtMetric((Math.abs(c - a) / Math.abs(a)) * 100, 3)}%`;
    };
    const pushRelErr = (key: string, labelZh: string, labelEn: string, c: number, a: number): void => {
      const s = relErrStr(c, a);
      if (s === null) return;
      metrics.push({
        key,
        label: zh ? labelZh : labelEn,
        value: s,
        unit: '%',
        severity: 'info',
        hint: zh ? '统一相对误差口径 |计算−解析|/|解析|' : 'unified yardstick |computed − analytic| / |analytic|',
      });
    };
    const noRefHint = zh ? 'PID 闭环无通用解析参考' : 'no closed-form reference under PID';
    const tsRefHint = zh ? '解析解最后一次越出 ±2% 带的精确时刻（网格扫描+二分）' : 'exact last exit of the ±2% band on the analytic solution (scan + bisection)';

    // Overshoot σ%.
    metrics.push({
      key: 'overshoot',
      label: zh ? '超调 σ%' : 'Overshoot σ%',
      value: fmtMetric(m.overshootPct),
      unit: '%',
      severity: Number.isFinite(ref.sigma) ? (errOk(m.overshootPct, ref.sigma, 0.02) ? 'ok' : 'warn') : 'info',
      hint: Number.isFinite(ref.sigma) ? `${zh ? '解析值' : 'analytic'} ${fmtMetric(ref.sigma)} %` : noRefHint,
    });
    pushRelErr('rel-err-sigma', 'σ% 相对误差', 'σ% rel err', m.overshootPct, ref.sigma);

    // Peak time tp.
    metrics.push({
      key: 'peak-time',
      label: zh ? '峰值时间 tp' : 'Peak time tp',
      value: fmtMetric(m.peakTime),
      unit: 's',
      severity: !Number.isFinite(ref.tp) ? 'info' : errOk(m.peakTime, ref.tp, 0.02) ? 'ok' : 'warn',
      hint: Number.isFinite(ref.tp) ? `${zh ? '解析值' : 'analytic'} ${fmtMetric(ref.tp)} s` : noRefHint,
    });
    pushRelErr('rel-err-tp', 'tp 相对误差', 'tp rel err', m.peakTime, ref.tp);

    // Settling time ts (2 % band).
    metrics.push({
      key: 'settling-time',
      label: zh ? '调节时间 ts' : 'Settling time ts',
      value: Number.isFinite(m.settlingTime) ? fmtMetric(m.settlingTime) : m.settlingTime === Infinity ? '∞' : '—',
      unit: 's',
      severity: m.settlingTime === Infinity ? 'warn' : Number.isFinite(ref.ts) ? (errOk(m.settlingTime, ref.ts, 0.02) ? 'ok' : 'warn') : 'info',
      hint: Number.isFinite(ref.ts) ? `${zh ? '解析基准' : 'analytic reference'} ${fmtMetric(ref.ts)} s · ${tsRefHint}` : tsRefHint,
    });
    pushRelErr('rel-err-ts', 'ts 相对误差', 'ts rel err', m.settlingTime, ref.ts);

    // Steady-state error against the unit-step reference.
    const ydc = sim.dcGain;
    let essSev: ScienceSeverity = 'info';
    let essHint: string;
    if (ydc <= 0) {
      essHint = zh ? '纯微分控制无直流增益，e_ss 对单位阶跃为 1' : 'D-only loop has no DC path; e_ss vs unit step is 1';
    } else if (!pidActive || p.ki > 0) {
      essSev = m.ess < 0.002 ? 'ok' : 'warn';
      essHint = zh
        ? '期望 e_ss → 0；若偏大请延长仿真时长 t_end（包络按 e^(−ζωn·t) 衰减）'
        : 'expected e_ss → 0; if large, extend t_end (envelope decays as e^(−ζωn·t))';
    } else {
      const expected = 1 / (1 + p.kp);
      essSev = errOk(m.ess, expected, 0.01) ? 'ok' : 'warn';
      essHint = zh ? `纯比例闭环期望 e_ss = 1/(1+Kp) = ${fmtMetric(expected)}` : `P-only loop: expected e_ss = 1/(1+Kp) = ${fmtMetric(expected)}`;
    }
    metrics.push({
      key: 'ess',
      label: zh ? '稳态误差 e_ss' : 'Steady-state error e_ss',
      value: fmtMetric(m.ess),
      severity: essSev,
      hint: essHint,
    });

    // Closed-loop half-power (−3 dB) bandwidth.
    metrics.push({
      key: 'bandwidth',
      label: zh ? '闭环带宽 ω_b' : 'Closed-loop bandwidth ω_b',
      value: Number.isFinite(this.bandwidth) ? fmtMetric(this.bandwidth) : this.bandwidth === Infinity ? '∞' : '—',
      unit: 'rad/s',
      severity:
        this.bandwidth === Infinity
          ? 'warn'
          : Number.isFinite(ref.wb)
            ? errOk(this.bandwidth, ref.wb, 0.01)
              ? 'ok'
              : 'warn'
            : 'info',
      hint: Number.isFinite(ref.wb)
        ? `${zh ? '解析' : 'analytic'} ω_b = ${fmtMetric(ref.wb)} rad/s (${zh ? '半功率点定义' : 'half-power definition'})`
        : zh
          ? '扫频插值得到的半功率点（−3 dB）带宽'
          : 'half-power (−3 dB) point from the interpolated sweep',
    });

    setScienceOutputs(this.manifest.id, metrics);
  }

  // ---- export --------------------------------------------------------------

  private exportStepCsv() {
    if (!this.sim) {
      notify(this.api, 'warning', 'Run a simulation first.', '请先运行仿真。');
      return;
    }
    const overlay = this.analyticOverlay();
    const stride = Math.max(1, Math.ceil(this.sim.t.length / 2000));
    const rows: Array<Array<number | string>> = [];
    for (let i = 0; i < this.sim.t.length; i += stride) {
      const t = this.sim.t[i]!;
      const y = this.sim.y[i]!;
      rows.push([Number(t.toPrecision(8)), Number(y.toPrecision(8)), overlay ? Number(overlay(t).toPrecision(8)) : '—']);
    }
    const last = this.sim.t.length - 1;
    rows.push([
      Number(this.sim.t[last]!.toPrecision(8)),
      Number(this.sim.y[last]!.toPrecision(8)),
      overlay ? Number(overlay(this.sim.t[last]!).toPrecision(8)) : '—',
    ]);
    exportRowsCsv(this.api, 'control-step-response', ['t_s', 'y', 'y_analytic'], rows);
  }

  private exportBodeCsv() {
    if (!this.bode) {
      notify(this.api, 'warning', 'Run a simulation first.', '请先运行仿真。');
      return;
    }
    const rows: Array<Array<number | string>> = this.bode.map((pt) => [
      Number(pt.w.toPrecision(8)),
      Number.isFinite(pt.magDb) ? Number(pt.magDb.toPrecision(8)) : '—',
      Number.isFinite(pt.phaseDeg) ? Number(pt.phaseDeg.toPrecision(8)) : '—',
    ]);
    exportRowsCsv(this.api, 'control-bode', ['w_rad_s', 'mag_db', 'phase_deg'], rows);
  }

  private async sendToFigure(): Promise<void> {
    if (!this.params) this.recompute();
    const p = this.params;
    const sim = this.sim;
    const bode = this.bode;
    if (!p || !sim || !bode) {
      notify(this.api, 'warning', 'No simulation yet — press "Simulate" first.', '尚未仿真 — 请先点击「仿真」。');
      return;
    }
    const m = sim.metrics;
    const ts = Number.isFinite(m.settlingTime) ? fmtMetric(m.settlingTime) : '∞';
    const wb = Number.isFinite(this.bandwidth) ? fmtMetric(this.bandwidth) : '∞';
    const caption: Bilingual = {
      zh: `控制系统阶跃/Bode 分析：超调 σ=${fmtMetric(m.overshootPct)}%，调节时间 ts=${ts} s，闭环带宽 ω_b=${wb} rad/s。`,
      en: `Control step/Bode analysis: overshoot σ=${fmtMetric(m.overshootPct)}%, settling time ts=${ts} s, closed-loop bandwidth ω_b=${wb} rad/s.`,
    };
    await pushPanelsToFigure(
      this.api,
      { zh: '控制系统时频域分析', en: 'Control System Step / Bode Analysis' },
      caption,
      controlFigurePanels(p, sim, bode, this.bandwidth),
    );
  }

  // ---- drawing -------------------------------------------------------------

  private fnt(px: number): string {
    return `${px}px ${this.zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
  }

  private draw() {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    canvas.width = canvas.clientWidth || 760;
    canvas.height = canvas.clientHeight || 420;
    const g = canvas.getContext('2d');
    if (!g) return;
    if (!this.params) this.recompute();

    if (!this.sim || !this.bode || !this.params) {
      if (this.errorMsg) {
        g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.fillStyle = 'rgba(255,140,140,0.95)';
        g.font = this.fnt(13);
        g.textAlign = 'center';
        g.fillText(this.zh ? `参数无效：${this.errorMsg}` : `Invalid parameters: ${this.errorMsg}`, canvas.width / 2, canvas.height / 2);
      } else {
        drawEmptyCanvas(this.api, canvas, {
          title: 'No simulation yet',
          titleZh: '尚未仿真',
          hint: 'Adjust the parameters and press "Simulate".',
          hintZh: '调整参数后点击「仿真」。',
        });
      }
      return;
    }

    g.fillStyle = getComputedStyle(canvas).backgroundColor || '#0a0e13';
    g.fillRect(0, 0, canvas.width, canvas.height);
    const zh = this.zh;
    const w = canvas.width;
    const h = canvas.height;

    g.textAlign = 'center';
    g.fillStyle = 'rgba(230,238,248,0.95)';
    g.font = this.fnt(13);
    g.fillText(zh ? '控制系统 · 阶跃 / Bode 分析' : 'Control systems · step / Bode analysis', w / 2, 18);

    const left = 52;
    const top = 30;
    const width = w - left - 16;
    const bottom = h - 40;
    const avail = bottom - top;
    const gap = 12;
    const view = this.state.view;
    if (view === 'step') {
      this.drawStep(g, { x: left, y: top, w: width, h: avail }, false, true);
    } else if (view === 'bode') {
      const mh = (avail - gap) / 2;
      this.drawBode(g, { x: left, y: top, w: width, h: mh }, 'mag', true);
      this.drawBode(g, { x: left, y: top + mh + gap, w: width, h: mh }, 'phase', true);
    } else {
      const stepH = (avail - 2 * gap) * 0.46;
      const subH = (avail - 2 * gap) * 0.27;
      this.drawStep(g, { x: left, y: top, w: width, h: stepH }, true, false);
      this.drawBode(g, { x: left, y: top + stepH + gap, w: width, h: subH }, 'mag', false);
      this.drawBode(g, { x: left, y: top + stepH + subH + 2 * gap, w: width, h: subH }, 'phase', true);
    }
    this.drawFooter(g, h);
  }

  /** Step-response panel: RK4 curve, analytic overlay, ±2 % band, peak marker. */
  private drawStep(g: CanvasRenderingContext2D, r: Rect, compact: boolean, showXLabels: boolean) {
    const sim = this.sim!;
    const p = this.params!;
    const zh = this.zh;
    const ydc = sim.dcGain;
    const band = ydc > 0 ? 0.02 * Math.abs(ydc) : 0;
    const overlay = this.analyticOverlay();

    let yLo = 0;
    let yHi = 0;
    for (const v of sim.y) {
      if (v < yLo) yLo = v;
      if (v > yHi) yHi = v;
    }
    if (ydc > 0) {
      yLo = Math.min(yLo, ydc - band);
      yHi = Math.max(yHi, ydc + band);
    }
    if (overlay) {
      const stride = Math.max(1, Math.floor(sim.t.length / 400));
      for (let i = 0; i < sim.t.length; i += stride) {
        const v = overlay(sim.t[i]!);
        if (v < yLo) yLo = v;
        if (v > yHi) yHi = v;
      }
    }
    const pad = (yHi - yLo) * 0.1 || 0.1;
    yLo -= pad;
    yHi += pad;

    const mapX = (t: number): number => r.x + ((t - 0) / p.tEnd) * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - yLo) / (yHi - yLo)) * r.h;

    drawFrame(g, r, zh ? '阶跃响应（RK4）' : 'Step response (RK4)', 't (s)', 'y', showXLabels, zh);

    // Gridlines.
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    g.fillStyle = 'rgba(160,175,195,0.85)';
    g.font = '10px Consolas, monospace';
    g.textAlign = 'right';
    for (const v of linTicks(yLo, yHi, 5)) {
      const y = mapY(v);
      g.beginPath();
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
      g.stroke();
      g.fillText(fmtTick(v), r.x - 4, y + 3);
    }
    if (showXLabels) {
      g.textAlign = 'center';
      for (const t of linTicks(0, p.tEnd, 6)) {
        const x = mapX(t);
        g.beginPath();
        g.moveTo(x, r.y);
        g.lineTo(x, r.y + r.h);
        g.stroke();
        g.fillText(fmtTick(t), x, r.y + r.h + 13);
      }
    }

    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();

    // ±2 % band and DC final value.
    if (ydc > 0) {
      g.strokeStyle = 'rgba(120,220,150,0.55)';
      g.setLineDash([4, 4]);
      g.lineWidth = 1;
      for (const v of [ydc - band, ydc + band]) {
        g.beginPath();
        g.moveTo(r.x, mapY(v));
        g.lineTo(r.x + r.w, mapY(v));
        g.stroke();
      }
      g.strokeStyle = 'rgba(170,182,200,0.5)';
      g.beginPath();
      g.moveTo(r.x, mapY(ydc));
      g.lineTo(r.x + r.w, mapY(ydc));
      g.stroke();
      g.setLineDash([]);
    }

    // Analytic overlay (open loop only).
    if (overlay) {
      g.strokeStyle = 'rgba(255,170,90,0.9)';
      g.setLineDash([6, 4]);
      g.lineWidth = 1.5;
      g.beginPath();
      for (let i = 0; i <= 400; i += 1) {
        const t = (p.tEnd * i) / 400;
        const x = mapX(t);
        const y = mapY(clamp(overlay(t), yLo, yHi));
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.setLineDash([]);
    }

    // RK4 simulated curve.
    g.strokeStyle = 'rgba(90,190,255,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    for (let i = 0; i < sim.t.length; i += 1) {
      const x = mapX(sim.t[i]!);
      const y = mapY(clamp(sim.y[i]!, yLo, yHi));
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    // Peak marker with σ% annotation.
    const m = sim.metrics;
    if (m.overshootPct > 0 && Number.isFinite(m.peakTime) && ydc > 0) {
      const yPeak = ydc * (1 + m.overshootPct / 100);
      const px = mapX(m.peakTime);
      const py = mapY(yPeak);
      g.fillStyle = 'rgba(255,190,120,0.95)';
      g.beginPath();
      g.arc(px, py, 3.5, 0, Math.PI * 2);
      g.fill();
      if (!compact) {
        g.font = '10px Consolas, monospace';
        g.textAlign = 'center';
        g.fillText(`σ = ${fmtMetric(m.overshootPct)}%`, px, py - 8);
      }
    }
    g.restore();

    // Legend.
    if (!compact) {
      let ly = r.y + 16;
      const lx = r.x + r.w - 96;
      g.font = `10px ${zh ? "'Microsoft YaHei'" : 'Consolas'}, monospace`;
      g.textAlign = 'left';
      g.strokeStyle = 'rgba(90,190,255,0.95)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(lx, ly - 3);
      g.lineTo(lx + 18, ly - 3);
      g.stroke();
      g.fillStyle = 'rgba(200,210,225,0.95)';
      g.fillText('RK4', lx + 24, ly);
      ly += 14;
      if (overlay) {
        g.strokeStyle = 'rgba(255,170,90,0.9)';
        g.setLineDash([5, 3]);
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(lx, ly - 3);
        g.lineTo(lx + 18, ly - 3);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(200,210,225,0.95)';
        g.fillText(zh ? '解析解' : 'analytic', lx + 24, ly);
        ly += 14;
      }
      if (ydc > 0) {
        g.strokeStyle = 'rgba(120,220,150,0.7)';
        g.setLineDash([3, 3]);
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(lx, ly - 3);
        g.lineTo(lx + 18, ly - 3);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = 'rgba(200,210,225,0.95)';
        g.fillText('±2%', lx + 24, ly);
      }
    }
  }

  /** Bode panel (magnitude or phase) on a log-ω axis with decade grid. */
  private drawBode(g: CanvasRenderingContext2D, r: Rect, which: 'mag' | 'phase', showXLabels: boolean) {
    const pts = this.bode!;
    const p = this.params!;
    const zh = this.zh;
    const wLo = pts[0]!.w;
    const wHi = pts[pts.length - 1]!.w;
    const logLo = Math.log10(wLo);
    const logHi = Math.log10(wHi);

    let vLo = Infinity;
    let vHi = -Infinity;
    for (const pt of pts) {
      const v = which === 'mag' ? pt.magDb : pt.phaseDeg;
      if (!Number.isFinite(v)) continue;
      if (v < vLo) vLo = v;
      if (v > vHi) vHi = v;
    }
    const dcDb = 20 * Math.log10(p.kp > 0 || p.ki > 0 || p.kd > 0 ? this.sim!.dcGain : 1);
    const threshold = dcDb - 10 * Math.log10(2);
    if (which === 'mag' && Number.isFinite(threshold)) {
      vLo = Math.min(vLo, threshold);
      vHi = Math.max(vHi, threshold);
    }
    const pad = (vHi - vLo) * 0.1 || 1;
    vLo -= pad;
    vHi += pad;

    const mapX = (w: number): number => r.x + ((Math.log10(w) - logLo) / (logHi - logLo)) * r.w;
    const mapY = (v: number): number => r.y + r.h - ((v - vLo) / (vHi - vLo)) * r.h;

    const title = which === 'mag' ? (zh ? 'Bode 幅值 |T|' : 'Bode magnitude |T|') : zh ? 'Bode 相位 ∠T' : 'Bode phase ∠T';
    drawFrame(g, r, title, 'ω (rad/s, log)', which === 'mag' ? '|T| (dB)' : '∠T (°)', showXLabels, zh);

    // Decade gridlines.
    g.lineWidth = 1;
    g.font = '10px Consolas, monospace';
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.textAlign = 'center';
    for (let k = Math.ceil(logLo); k <= Math.floor(logHi); k += 1) {
      const x = mapX(Math.pow(10, k));
      g.beginPath();
      g.moveTo(x, r.y);
      g.lineTo(x, r.y + r.h);
      g.stroke();
      if (showXLabels) {
        g.fillStyle = 'rgba(160,175,195,0.85)';
        g.fillText(fmtTick(Math.pow(10, k)), x, r.y + r.h + 13);
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.textAlign = 'right';
    for (const v of linTicks(vLo, vHi, 4)) {
      const y = mapY(v);
      g.beginPath();
      g.moveTo(r.x, y);
      g.lineTo(r.x + r.w, y);
      g.stroke();
      g.fillStyle = 'rgba(160,175,195,0.85)';
      g.fillText(fmtTick(v), r.x - 4, y + 3);
    }

    g.save();
    g.beginPath();
    g.rect(r.x, r.y, r.w, r.h);
    g.clip();

    if (which === 'mag' && Number.isFinite(threshold)) {
      // DC level (grey) and the half-power −3 dB threshold (yellow).
      g.setLineDash([4, 4]);
      g.strokeStyle = 'rgba(170,182,200,0.45)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(r.x, mapY(dcDb));
      g.lineTo(r.x + r.w, mapY(dcDb));
      g.stroke();
      g.strokeStyle = 'rgba(255,210,120,0.85)';
      g.beginPath();
      g.moveTo(r.x, mapY(threshold));
      g.lineTo(r.x + r.w, mapY(threshold));
      g.stroke();
      g.setLineDash([]);
    }

    // Closed-loop |T(jω)| / ∠T(jω) curve (T = G when PID is off).
    g.strokeStyle = 'rgba(90,190,255,0.95)';
    g.lineWidth = 2;
    g.beginPath();
    let pen = false;
    for (const pt of pts) {
      const v = which === 'mag' ? pt.magDb : pt.phaseDeg;
      if (!Number.isFinite(v)) {
        pen = false;
        continue;
      }
      const x = mapX(pt.w);
      const y = mapY(clamp(v, vLo, vHi));
      if (!pen) {
        g.moveTo(x, y);
        pen = true;
      } else {
        g.lineTo(x, y);
      }
    }
    g.stroke();

    // Bandwidth marker on the magnitude plot.
    if (which === 'mag' && Number.isFinite(this.bandwidth) && Number.isFinite(threshold)) {
      const bx = mapX(this.bandwidth);
      const by = mapY(threshold);
      g.fillStyle = 'rgba(255,210,120,0.95)';
      g.beginPath();
      g.arc(bx, by, 3.5, 0, Math.PI * 2);
      g.fill();
      if (showXLabels) {
        g.font = '10px Consolas, monospace';
        g.textAlign = 'center';
        g.fillText(`ω_b = ${fmtMetric(this.bandwidth)}`, bx, by - 8);
      }
    }
    g.restore();
  }

  /** Footer: loop status + the four step metrics and the bandwidth. */
  private drawFooter(g: CanvasRenderingContext2D, h: number) {
    const sim = this.sim!;
    const p = this.params!;
    const zh = this.zh;
    const m = sim.metrics;
    const pidActive = p.kp > 0 || p.ki > 0 || p.kd > 0;

    g.textAlign = 'left';
    g.font = this.fnt(11);
    g.fillStyle = 'rgba(170,182,200,0.95)';
    const line1 = pidActive
      ? zh
        ? `闭环（单位反馈，Kp=${fmtMetric(p.kp)}，Ki=${fmtMetric(p.ki)}，Kd=${fmtMetric(p.kd)}）`
        : `Closed loop (unity feedback, Kp=${fmtMetric(p.kp)}, Ki=${fmtMetric(p.ki)}, Kd=${fmtMetric(p.kd)})`
      : zh
        ? '开环被控对象（未启用 PID）'
        : 'Open-loop plant (PID off)';
    g.fillText(line1, 16, h - 26);

    const ts = Number.isFinite(m.settlingTime) ? fmtMetric(m.settlingTime) : m.settlingTime === Infinity ? '∞' : '—';
    const wb = Number.isFinite(this.bandwidth) ? fmtMetric(this.bandwidth) : this.bandwidth === Infinity ? '∞' : '—';
    g.fillStyle = 'rgba(200,210,225,0.95)';
    const line2 = `σ% = ${fmtMetric(m.overshootPct)}  ·  tp = ${fmtMetric(m.peakTime)} s  ·  ts = ${ts} s  ·  e_ss = ${fmtMetric(m.ess)}  ·  ω_b = ${wb} rad/s`;
    g.fillText(line2, 16, h - 10);
  }
}

export default function createEngControlPlugin(): Plugin {
  return new EngControlPlugin();
}
