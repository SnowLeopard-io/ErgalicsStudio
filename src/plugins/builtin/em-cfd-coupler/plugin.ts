// ==========================================================================
// EM-CFD Coupler plugin (1D 管网 ↔ 3D 场 双向耦合求解器)
//
// A coarse-time 1-D pipe/nozzle network is coupled to a fine-time 3-D scalar
// field solver through multi-rate sub-cycling (exchange windows). Runs the
// bundled em_cfd Python package (pure NumPy) on a dedicated Pyodide worker,
// and renders the flow / valve-opening / back-pressure time series and the
// verification trade-off on the host canvas.
//
// Two workloads:
//   * Run Coupling — one 1D-3D run (Case A / Case B / custom) → time-series
//     panels plus the coupling metrics (latency, interface error, sync error).
//   * Verify — Case A vs analytic choked flow, Case B vs millisecond valve
//     control, plus the precision-vs-efficiency trade-off curve.
// ==========================================================================

import type {
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
} from '@/types/plugin';
import { emit } from '@/core/events';
import { actionButton, actionFired, notify } from '../shared/enhance';
import { EmCfdClient } from './em-client';
import { buildDiagReportHtml } from './diag-report';
import { drawPanels } from './render';
import { emCfdCouplerManifest } from './manifest';
import type { CouplingPayload, EmCouplingResult, EmVerifyResult } from './types';

const PRESETS: Array<[EmCfdPreset, string, string]> = [
  ['case_a', 'Case A · steady choked', 'Case A · 定常壅塞'],
  ['case_b', 'Case B · ms valve control', 'Case B · 毫秒级阀门控制'],
  ['custom', 'Custom', '自定义'],
];

type EmCfdPreset = 'case_a' | 'case_b' | 'custom';

interface State {
  preset: EmCfdPreset;
  view: 'coupling' | 'verify';
  dt1dMs: number;
  dt3dUs: number;
  tEndS: number;
  exchangePeriodMs: number;
  volumeL: number;
  p0InitBar: number;
  throatAreaCm2: number;
}

export class EmCfdCouplerPlugin implements Plugin {
  readonly manifest = emCfdCouplerManifest;

  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private client = new EmCfdClient();
  private result: EmCouplingResult | null = null;
  private verify: EmVerifyResult | null = null;
  private logs: string[] = [];
  private busy = false;
  private runEpoch = 0;
  private disposed = false;
  private state: State = {
    preset: 'case_a',
    view: 'coupling',
    dt1dMs: 2.0,
    dt3dUs: 250,
    tEndS: 0.16,
    exchangePeriodMs: 0,
    volumeL: 60,
    p0InitBar: 6,
    throatAreaCm2: 1.0,
  };

  constructor() {
    this.client.onLog = (text) => {
      this.logs.push(text);
      if (this.logs.length > 8) this.logs.splice(0, this.logs.length - 8);
      this.draw();
    };
  }

  async init(api: PluginApi) {
    this.api = api;
    api.onLocaleChange(() => this.draw());
  }

  async destroy() {
    this.disposed = true;
    this.client.dispose();
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.draw();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    this.draw();
  }

  getParams(): ParamDefinition[] {
    const zh = this.api?.locale === 'zh-CN';
    const preset = this.state.preset;
    return [
      {
        key: 'preset',
        label: 'Workload',
        labelI18n: { 'zh-CN': '算例', 'en-US': 'Workload' },
        type: 'select',
        options: PRESETS.map(([value, en, c]) => ({ value, label: zh ? c : en })),
        value: preset,
      },
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'coupling', label: zh ? '耦合时间序列' : 'Coupling time series' },
          { value: 'verify', label: zh ? '验证 + 权衡曲线' : 'Verification + trade-off' },
        ],
        value: this.state.view,
      },
      {
        key: 'dt1dMs',
        label: '1-D step dt1d (ms)',
        labelI18n: { 'zh-CN': '1-D 时间步 dt1d（ms）', 'en-US': '1-D step dt1d (ms)' },
        type: 'number',
        min: 0.1,
        max: 50,
        step: 0.1,
        value: this.state.dt1dMs,
        hint: 'custom',
      },
      {
        key: 'dt3dUs',
        label: '3-D step dt3d (µs)',
        labelI18n: { 'zh-CN': '3-D 时间步 dt3d（µs）', 'en-US': '3-D step dt3d (µs)' },
        type: 'number',
        min: 10,
        max: 5000,
        step: 10,
        value: this.state.dt3dUs,
        hint: 'custom',
      },
      {
        key: 'tEndS',
        label: 'Horizon t_end (s)',
        labelI18n: { 'zh-CN': '仿真时长 t_end（s）', 'en-US': 'Horizon t_end (s)' },
        type: 'number',
        min: 0.01,
        max: 2,
        step: 0.01,
        value: this.state.tEndS,
        hint: 'custom',
      },
      {
        key: 'exchangePeriodMs',
        label: 'Exchange period (ms, 0=each 1-D step)',
        labelI18n: { 'zh-CN': '交换周期（ms，0=每 1-D 步交换）', 'en-US': 'Exchange period (ms, 0=each 1-D step)' },
        type: 'number',
        min: 0,
        max: 50,
        step: 0.5,
        value: this.state.exchangePeriodMs,
        hint: 'custom',
      },
      {
        key: 'volumeL',
        label: 'Plenum volume (L)',
        labelI18n: { 'zh-CN': '气室容积（L）', 'en-US': 'Plenum volume (L)' },
        type: 'number',
        min: 1,
        max: 500,
        step: 1,
        value: this.state.volumeL,
        hint: 'custom',
      },
      {
        key: 'p0InitBar',
        label: 'Initial plenum pressure (bar)',
        labelI18n: { 'zh-CN': '初始气室压力（bar）', 'en-US': 'Initial plenum pressure (bar)' },
        type: 'number',
        min: 1,
        max: 50,
        step: 0.5,
        value: this.state.p0InitBar,
        hint: 'custom',
      },
      {
        key: 'throatAreaCm2',
        label: 'Nozzle throat area (cm²)',
        labelI18n: { 'zh-CN': '喷管喉部面积（cm²）', 'en-US': 'Nozzle throat area (cm²)' },
        type: 'number',
        min: 0.1,
        max: 10,
        step: 0.1,
        value: this.state.throatAreaCm2,
        hint: 'custom',
      },
      actionButton('run', this.busy ? 'Coupling…' : 'Run Coupling', this.busy ? '耦合计算中…' : '运行耦合', 'primary'),
      actionButton('verify', 'Verify', '运行验证'),
      actionButton('abort', 'Abort', '终止'),
      actionButton('exportReport', 'Export Diagnostic Report', '导出诊断报告'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let redraw = false;
    if (params.preset === 'case_a' || params.preset === 'case_b' || params.preset === 'custom') {
      if (params.preset !== this.state.preset) {
        this.state.preset = params.preset;
        redraw = true;
      }
    }
    if (params.view === 'coupling' || params.view === 'verify') {
      if (params.view !== this.state.view) {
        this.state.view = params.view;
        redraw = true;
      }
    }
    redraw = this.numParam(params, 'dt1dMs', this.state.dt1dMs) || redraw;
    redraw = this.numParam(params, 'dt3dUs', this.state.dt3dUs) || redraw;
    redraw = this.numParam(params, 'tEndS', this.state.tEndS) || redraw;
    redraw = this.numParam(params, 'exchangePeriodMs', this.state.exchangePeriodMs) || redraw;
    redraw = this.numParam(params, 'volumeL', this.state.volumeL) || redraw;
    redraw = this.numParam(params, 'p0InitBar', this.state.p0InitBar) || redraw;
    redraw = this.numParam(params, 'throatAreaCm2', this.state.throatAreaCm2) || redraw;

    if (actionFired(params, 'run')) void this.runCoupling();
    if (actionFired(params, 'verify')) void this.runVerify();
    if (actionFired(params, 'abort')) this.abort();
    if (actionFired(params, 'exportReport')) this.exportReport();
    if (actionFired(params, 'reloadPlugin')) {
      notify(this.api, 'info', 'Resetting plugin…', '正在重置插件…');
      void this.api.reload?.();
    }
    if (redraw) this.draw();
  }

  /** Apply one numeric param when finite and different; returns whether it changed. */
  private numParam(params: Record<string, unknown>, key: keyof State, current: number): boolean {
    const v = params[key];
    if (v === undefined || v === null) return false;
    const n = Number(v);
    if (!Number.isFinite(n) || n === current) return false;
    (this.state as unknown as Record<string, number>)[key] = n;
    return true;
  }

  async compute(input: unknown, onProgress?: (p: ComputeProgress) => void): Promise<ComputeResult> {
    if (input && typeof input === 'object' && 'preset' in input) {
      const p = (input as { preset?: unknown }).preset;
      if (p === 'case_a' || p === 'case_b' || p === 'custom') this.state.preset = p;
    }
    try {
      const result = await this.runCoupling((info) => {
        onProgress?.({ done: info.done, total: info.total, label: `${info.done}%` });
      });
      return { ok: result.ok, output: result };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Accept sample data from the top-bar "示例" dialog. A solve_json payload
   * with ``case`` ("a"/"b") selects the verified benchmark preset; a full
   * net/dom/cpl config maps onto the custom knobs. Either way the coupling
   * starts automatically so loading a sample is immediately illustrative.
   */
  async loadData(file: File): Promise<void> {
    try {
      const text = await file.text();
      const data = JSON.parse(text) as {
        case?: string;
        net?: Record<string, unknown>;
        cpl?: Record<string, unknown>;
      };
      const c = data.case;
      if (c === 'a' || c === 'b') {
        this.state.preset = c === 'a' ? 'case_a' : 'case_b';
      } else {
        this.state.preset = 'custom';
        this.tryNum(data.net ?? {}, 'volume', (v) => (this.state.volumeL = v * 1e3));
        this.tryNum(data.net ?? {}, 'p0_init', (v) => (this.state.p0InitBar = v / 1e5));
        this.tryNum(data.net ?? {}, 'throat_area', (v) => (this.state.throatAreaCm2 = v * 1e4));
        this.tryNum(data.cpl ?? {}, 'dt1d', (v) => (this.state.dt1dMs = v * 1e3));
        this.tryNum(data.cpl ?? {}, 'dt3d', (v) => (this.state.dt3dUs = v * 1e6));
        this.tryNum(data.cpl ?? {}, 't_end', (v) => (this.state.tEndS = v));
        this.tryNum(data.cpl ?? {}, 'exchange_period', (v) => (this.state.exchangePeriodMs = v * 1e3));
      }
      this.refreshParams();
      this.draw();
      notify(this.api, 'info', 'Sample loaded — running coupling…', '示例已加载，正在耦合计算…');
      await this.runCoupling();
    } catch (err) {
      notify(this.api, 'error', `Sample load failed: ${err instanceof Error ? err.message : String(err)}`, '示例加载失败。');
    }
  }

  private tryNum(obj: Record<string, unknown>, key: string, apply: (v: number) => void): void {
    const v = obj[key];
    if (typeof v === 'number' && Number.isFinite(v)) apply(v);
  }

  // ---- internals -----------------------------------------------------------

  private refreshParams() {
    emit('host:params:changed', { pluginId: this.manifest.id });
  }

  /** Build the exact JSON payload driver.solve_json accepts. */
  buildPayload(): CouplingPayload {
    const s = this.state;
    if (s.preset === 'case_a') return { case: 'a' };
    if (s.preset === 'case_b') return { case: 'b' };
    const cpl: Record<string, unknown> = {
      dt1d: s.dt1dMs * 1e-3,
      dt3d: s.dt3dUs * 1e-6,
      t_end: s.tEndS,
    };
    if (s.exchangePeriodMs > 0) cpl.exchange_period = s.exchangePeriodMs * 1e-3;
    return {
      net: { volume: s.volumeL * 1e-3, p0_init: s.p0InitBar * 1e5, throat_area: s.throatAreaCm2 * 1e-4 },
      cpl,
    };
  }

  async runCoupling(onProgress?: (info: { done: number; total: number }) => void): Promise<EmCouplingResult> {
    if (this.busy) {
      notify(this.api, 'warning', 'A run is already in progress.', '已有计算任务在运行。');
      throw new Error('busy');
    }
    this.busy = true;
    this.runEpoch += 1;
    const epoch = this.runEpoch;
    this.result = null;
    this.verify = null;
    this.logs = [];
    this.api.setStatus('computing');
    this.refreshParams();
    this.draw();
    try {
      const payload = this.buildPayload();
      const result = await this.client.runCoupling(payload, (info) => {
        onProgress?.({ done: info.done, total: info.total });
        this.draw();
      });
      if (this.disposed) return result;
      this.result = result;
      if (result.ok) {
        this.api.setStatus('ready');
        notify(this.api, 'success', `Coupling done: ${result.metrics.n_windows} windows.`, `耦合完成：${result.metrics.n_windows} 个交换窗口。`);
      } else {
        this.api.setStatus('error');
        notify(this.api, 'error', result.error || 'Coupling failed.', '耦合失败。');
      }
      this.refreshParams();
      this.draw();
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (epoch !== this.runEpoch || msg === 'compute aborted') throw err;
      if (!this.disposed) {
        this.api.setStatus('error');
        notify(this.api, 'error', msg, '耦合失败。');
        this.refreshParams();
      }
      throw err;
    } finally {
      if (epoch === this.runEpoch) {
        this.busy = false;
        if (!this.disposed) this.refreshParams();
      }
    }
  }

  async runVerify(onProgress?: (info: { done: number; total: number }) => void): Promise<EmVerifyResult> {
    if (this.busy) throw new Error('busy');
    this.busy = true;
    this.runEpoch += 1;
    const epoch = this.runEpoch;
    this.verify = null;
    this.result = null;
    this.logs = [];
    this.api.setStatus('computing');
    this.refreshParams();
    this.draw();
    try {
      const verify = await this.client.verify((info) => {
        onProgress?.({ done: info.done, total: info.total });
      });
      if (this.disposed) return verify;
      this.verify = verify;
      this.api.setStatus('ready');
      notify(
        this.api,
        'success',
        `Verification: Case A flow err ${(verify.case_a.flow_rel_error * 100).toFixed(1)}%, Case B throttle ${verify.case_b.valve_throttle_ratio.toFixed(2)}.`,
        `验证完成：Case A 流量误差 ${(verify.case_a.flow_rel_error * 100).toFixed(1)}%，Case B 节流比 ${verify.case_b.valve_throttle_ratio.toFixed(2)}。`,
      );
      this.refreshParams();
      this.draw();
      return verify;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (epoch !== this.runEpoch || msg === 'compute aborted') throw err;
      if (!this.disposed) {
        this.api.setStatus('error');
        notify(this.api, 'error', msg, '验证失败。');
        this.refreshParams();
      }
      throw err;
    } finally {
      if (epoch === this.runEpoch) {
        this.busy = false;
        if (!this.disposed) this.refreshParams();
      }
    }
  }

  private abort(): void {
    if (!this.busy) {
      notify(this.api, 'info', 'No run in progress.', '当前没有计算任务。');
      return;
    }
    this.busy = false;
    this.logs = [];
    this.api.setStatus('ready');
    this.client.dispose();
    this.client = new EmCfdClient();
    this.client.onLog = (text) => {
      this.logs.push(text);
      if (this.logs.length > 8) this.logs.splice(0, this.logs.length - 8);
      this.draw();
    };
    notify(this.api, 'info', 'Run aborted — compute worker fully reset.', '已终止，计算线程已整体重置。');
    this.refreshParams();
    this.draw();
  }

  private exportReport(): void {
    const result = this.result;
    const verify = this.verify;
    if (!result && !verify) {
      notify(this.api, 'warning', 'Run a coupling or verification first.', '请先运行一次耦合或验证。');
      return;
    }
    try {
      const html = buildDiagReportHtml({
        result,
        verify,
        locale: this.api?.locale,
      });
      const base = verify ? 'em-cfd-verify' : (result?.ok ? 'em-cfd-coupling' : 'em-cfd-coupling-failed');
      this.api.exportFile(`${base}.diag-report.html`, html, 'text/html');
    } catch (err) {
      notify(this.api, 'error', err instanceof Error ? err.message : String(err), '导出失败。');
    }
  }

  private draw(): void {
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    try {
      drawPanels(canvas, {
        result: this.result,
        verify: this.verify,
        logs: this.logs,
        busy: this.busy,
        zh: this.api?.locale === 'zh-CN',
      });
    } catch (err) {
      this.api?.log('error', `[em-cfd-coupler] render error: ${String(err)}`);
    }
  }
}

export { emCfdCouplerManifest } from './manifest';