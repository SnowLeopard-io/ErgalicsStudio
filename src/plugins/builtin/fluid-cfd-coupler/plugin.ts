// ==========================================================================
// Fluid-CFD Coupler plugin (1D 管网 ↔ 3D 场 双向耦合求解器)
//
// A coarse-time 1-D pipe/nozzle network is coupled to a fine-time 3-D scalar
// field solver through multi-rate sub-cycling (exchange windows). Runs the
// bundled fluid_cfd Python package (pure NumPy) on a dedicated Pyodide worker,
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
  Scene3DHandle,
} from '@/types/plugin';
import type { Group as ThreeGroup } from 'three';
import { emit } from '@/core/events';
import { actionButton, actionFired, notify } from '../shared/enhance';
import { FluidCfdClient } from './fluid-client';
import { buildDiagReportHtml } from './diag-report';
import { drawPanels } from './render';
import { buildFieldRender, disposeObjectTree, fitFieldCamera } from './render3d';
import { couplingFigurePanels } from './figure';
import { fluidCfdCouplerManifest } from './manifest';
import type { CouplingPayload, FluidCouplingResult, FluidVerifyResult } from './types';

const PRESETS: Array<[FluidCfdPreset, string, string]> = [
  ['case_a', 'Case A · steady choked', 'Case A · 定常壅塞'],
  ['case_b', 'Case B · ms valve control', 'Case B · 毫秒级阀门控制'],
  ['custom', 'Custom', '自定义'],
];

type FluidCfdPreset = 'case_a' | 'case_b' | 'custom';

interface State {
  preset: FluidCfdPreset;
  view: 'coupling' | 'verify' | '3d';
  dt1dMs: number;
  dt3dUs: number;
  tEndS: number;
  exchangePeriodMs: number;
  volumeL: number;
  p0InitBar: number;
  throatAreaCm2: number;
}

export class FluidCfdCouplerPlugin implements Plugin {
  readonly manifest = fluidCfdCouplerManifest;

  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private fieldGroup: ThreeGroup | null = null;
  /** Cache keys so the mesh is only rebuilt when the input changes. */
  private fieldKey = '';
  private fieldScene: Scene3DHandle | null = null;
  private client = new FluidCfdClient();
  private result: FluidCouplingResult | null = null;
  private verify: FluidVerifyResult | null = null;
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
    this.teardown3d();
    this.client.dispose();
  }

  async deactivate() {
    // The host scene is SHARED between 3-D plugins: drop our field mesh on
    // every switch-away or the next 3-D plugin renders on top of it.
    this.teardown3d();
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    if (context.container.three) this.three = context.container.three;
    this.draw();
  }

  render(container: ContainerCapabilities) {
    this.ctx = container;
    if (container.three) this.three = container.three;
    this.draw();
  }

  /** Host entry for 3D-capable plugins (see pluginStore activation). */
  renderToScene(scene: Scene3DHandle) {
    this.three = scene;
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
          { value: '3d', label: zh ? '3D 场体素（耦合场）' : '3D field voxels' },
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
      actionButton('runAll', this.busy ? 'Running all…' : 'Run All (Verify + Coupling)', this.busy ? '运行全部中…' : '运行全部（验证 + 耦合）', 'primary'),
      actionButton('run', this.busy ? 'Coupling…' : 'Run Coupling', this.busy ? '耦合计算中…' : '运行耦合', 'primary'),
      actionButton('verify', 'Verify', '运行验证'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
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
    if (params.view === 'coupling' || params.view === 'verify' || params.view === '3d') {
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

    if (actionFired(params, 'runAll')) void this.runAll();
    if (actionFired(params, 'run')) void this.runCoupling();
    if (actionFired(params, 'verify')) void this.runVerify();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
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
   * net/dom/cpl config maps onto the custom knobs. Loading only fills the
   * knobs — the coupling itself waits for the explicit "Run Coupling" button,
   * so users can inspect/adjust parameters before committing to a run.
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
      notify(
        this.api,
        'info',
        'Sample loaded — press "Run Coupling" to start.',
        '示例已加载——点击「运行耦合」开始计算。',
      );
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

  async runCoupling(
    onProgress?: (info: { done: number; total: number }) => void,
    keepVerify = false,
  ): Promise<FluidCouplingResult> {
    if (this.busy) {
      notify(this.api, 'warning', 'A run is already in progress.', '已有计算任务在运行。');
      throw new Error('busy');
    }
    this.busy = true;
    this.runEpoch += 1;
    const epoch = this.runEpoch;
    this.result = null;
    if (!keepVerify) this.verify = null;
    this.state.view = 'coupling';
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
        if (result.nonfinite) {
          notify(this.api, 'warning', 'Result contains non-finite values — the coupling likely diverged.', '结果包含非有限值（NaN/Inf）——耦合可能已发散，请检查参数。');
        } else if (!keepVerify) {
          notify(this.api, 'success', `Coupling done: ${result.metrics.n_windows} windows.`, `耦合完成：${result.metrics.n_windows} 个交换窗口。`);
        }
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

  async runVerify(
    onProgress?: (info: { done: number; total: number }) => void,
    keepResult = false,
  ): Promise<FluidVerifyResult> {
    if (this.busy) throw new Error('busy');
    this.busy = true;
    this.runEpoch += 1;
    const epoch = this.runEpoch;
    this.verify = null;
    if (!keepResult) this.result = null;
    this.state.view = 'verify';
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
      if (verify.nonfinite) {
        notify(this.api, 'warning', 'Verification contains non-finite values — one case likely diverged.', '验证结果包含非有限值（NaN/Inf）——某个算例可能已发散。');
      } else if (!keepResult) {
        notify(
          this.api,
          'success',
          `Verification: Case A flow err ${(verify.case_a.flow_rel_error * 100).toFixed(1)}%, Case B throttle ${verify.case_b.valve_throttle_ratio.toFixed(2)}.`,
          `验证完成：Case A 流量误差 ${(verify.case_a.flow_rel_error * 100).toFixed(1)}%，Case B 节流比 ${verify.case_b.valve_throttle_ratio.toFixed(2)}。`,
        );
      }
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

  /**
   * Run the full suite in one go: verify first (Case A + B + trade-off) then a
   * coupling for the current preset, keeping BOTH result sets so every view
   * (3D field, coupling time series, verification + trade-off) is populated.
   */
  async runAll(): Promise<void> {
    try {
      this.state.view = 'verify';
      await this.runVerify(undefined, true);
      await this.runCoupling(undefined, true);
      this.state.view = 'verify';
      const m = this.result?.metrics;
      this.api.setStatus('ready');
      notify(
        this.api,
        'success',
        `All done — Verify + Coupling (${m?.n_windows ?? 0} windows).`,
        `全部完成 — 验证 + 耦合（${m?.n_windows ?? 0} 个交换窗口）均已就绪，可在各视图间切换。`,
      );
      this.refreshParams();
      this.draw();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== 'compute aborted') notify(this.api, 'error', msg, '运行全部失败。');
    }
  }

  private abort(): void {
    if (!this.busy) {
      notify(this.api, 'info', 'No run in progress.', '当前没有计算任务。');
      return;
    }
    // Kill the worker and reject the in-flight job atomically; the run's finally
    // clears busy. Next run respawns the worker transparently.
    this.busy = false;
    this.logs = [];
    this.client.abort();
    // The aborted run's catch re-throws before ever calling setStatus(), so
    // reset the host status here or the global "computing" indicator lingers.
    this.api.setStatus('ready');
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

  /** Send the finished coupling to Figure Studio as a scientific figure sheet. */
  private async sendToFigure(): Promise<void> {
    const result = this.result;
    if (!result || !result.ok) {
      notify(this.api, 'warning', 'Run a coupling first.', '请先运行一次耦合。');
      return;
    }
    const { useFigureStore } = await import('@/stores/figureStore');
    const zh = this.api?.locale === 'zh-CN';
    const figure = useFigureStore.getState();
    const sheetId = figure.createSheet(zh ? '1D-3D 双向耦合' : '1D-3D coupling');
    if (!sheetId) {
      notify(this.api, 'warning', 'Open a project first.', '请先打开一个项目。');
      return;
    }
    const panels = couplingFigurePanels(result);
    if (panels.length === 0) {
      notify(this.api, 'warning', 'No plottable data in this result.', '本次结果没有可绘图数据。');
      return;
    }
    for (const panel of panels) {
      figure.addPanel(sheetId, panel.spec, { row: panel.row, col: panel.col, tag: panel.tag });
    }
    figure.updateSheet(sheetId, {
      caption: zh
        ? `1D 管网-3D 场耦合：中平面场切片、1D 出流、3D 背压与毫秒级阀位时间序列（${result.metrics.n_windows} 个交换窗口）。`
        : `1D network-3D field coupling: mid-plane field slice, 1D outlet flow, 3D back pressure and ms valve schedule (${result.metrics.n_windows} exchange windows).`,
    });
    notify(this.api, 'info', `Sent ${panels.length} panels to Figure Studio.`, `已将 ${panels.length} 个面板发送到 Figure Studio。`);
  }

  /**
   * Paint the coupled 3-D field as a voxel cloud in the host scene. The mesh
   * is rebuilt only when the underlying result (content) or the scene (host
   * remount) changes; otherwise we just re-show the cached object.
   */
  private draw3d(): void {
    const three = this.three;
    const result = this.result;
    if (!three || !result || !result.ok) return;
    const f3d = result.final_state_3d;
    const raw = Array.isArray(f3d?.field) ? (f3d.field as number[]) : [];
    const dom = (result.config?.dom ?? {}) as Record<string, unknown>;
    const num = (k: string, d: number) =>
      typeof dom[k] === 'number' && (dom[k] as number) > 0 ? (dom[k] as number) : d;
    const nx = num('nx', 12);
    const ny = num('ny', 12);
    const nz = num('nz', 12);
    // runEpoch: two runs with the same grid/max can still differ in the field
    // distribution — a key without it reused the previous run's stale mesh.
    const key = `e${this.runEpoch}:${nx}x${ny}x${nz}:${raw.length}:${f3d?.field_max ?? 0}`;
    if (this.fieldKey !== key || this.fieldScene !== three) {
      this.clearFieldGroup();
      this.fieldGroup = buildFieldRender({ values: raw, nx, ny, nz });
      this.fieldKey = key;
      this.fieldScene = three;
      three.scene.add(this.fieldGroup);
      fitFieldCamera(three.camera, three.controls, Math.max(nx, ny, nz));
    }
    three.setVisible(true);
    three.render();
  }

  private clearFieldGroup() {
    if (this.fieldGroup) {
      this.three?.scene.remove(this.fieldGroup);
      disposeObjectTree(this.fieldGroup);
      this.fieldGroup = null;
    }
    this.fieldKey = '';
    this.fieldScene = null;
  }

  private teardown3d() {
    this.clearFieldGroup();
    this.three?.setVisible(false);
  }

  private draw(): void {
    // 3D field view: needs the host scene AND a finished coupling.
    if (this.state.view === '3d' && this.three && this.result?.ok) {
      this.draw3d();
      return;
    }
    // Any other view (or missing scene/result): hide the 3D overlay and free
    // the cached mesh so a stale frame can never cover the 2D panels.
    this.three?.setVisible(false);
    this.clearFieldGroup();
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    const view = this.state.view === '3d' ? 'coupling' : this.state.view;
    try {
      drawPanels(canvas, {
        result: this.result,
        verify: this.verify,
        logs: this.logs,
        busy: this.busy,
        zh: this.api?.locale === 'zh-CN',
        view,
      });
    } catch (err) {
      this.api?.log('error', `[fluid-cfd-coupler] render error: ${String(err)}`);
    }
  }
}

export { fluidCfdCouplerManifest } from './manifest';