// ==========================================================================
// Example plugin: EM Eigensolver (电磁谐振特征值求解器)
//
// Large-scale sparse Hermitian (indefinite) eigenvalue solver for resonant
// microwave-device simulations. Runs the bundled em_eigensolver Python
// package (thick-restart Lanczos / block LOBPCG / Jacobi-Davidson behind a
// shift-invert MINRES inner solver) on a dedicated Pyodide worker, and
// renders the spectrum, residuals and convergence trace on the host canvas.
//
// No GPU, no dense n x n operator: the kernels never densify the input
// matrix (LAPACK is only used for the O(basis_dim^2) projected matrices,
// and for whole problems below `denseThreshold` where it is cheaper than
// any iterative path).
// ==========================================================================

import type {
  ComputeProgress,
  ComputeResult,
  ContainerCapabilities,
  ParamDefinition,
  Plugin,
  PluginApi,
  PluginManifest,
  Scene3DHandle,
} from '@/types/plugin';
import type { Mesh as ThreeMesh } from 'three';
import { emit } from '@/core/events';
import type { PlotSpec } from '@/core/plot';
import { actionButton, actionFired, notify } from '../shared/enhance';
import { EmSolverClient } from './em-client';
import { drawPanels } from './render';
import { buildFieldMesh, fitFieldCamera } from './render3d';
import {
  EM_SAMPLES,
  type EmModeField,
  type EmProgressInfo,
  type EmResultPayload,
  type EmSolverConfig,
} from './types';
// Bundled example matrix — same file the top-bar sample dialog serves, so the
// built-in sample dropdown can route it through the file path too.
import emCavityMtx from '../../../../examples/data/em-cavity-degenerate.mtx?raw';

/** Panels per figure row when exporting mode fields to Figure Studio. */
const FIGURE_COLS = 3;

export interface ModeFieldPanel {
  spec: PlotSpec;
  row: number;
  col: number;
  tag: string;
}

/**
 * Build one Figure Studio panel per returned mode field: a heatmap of the
 * normalized field with a diverging colorbar, laid out row-major with
 * spreadsheet tags (a, b, c, …). Pure so it is directly unit-testable.
 */
export function modeFieldPanels(fields: readonly EmModeField[]): ModeFieldPanel[] {
  return fields.map((f, i) => ({
    row: Math.floor(i / FIGURE_COLS),
    col: i % FIGURE_COLS,
    tag: String.fromCharCode(97 + (i % 26)),
    spec: {
      width: 336,
      height: 252,
      title: `Mode ${f.index + 1} (λ=${f.eigenvalue.toExponential(2)})`,
      xLabel: 'x',
      yLabel: 'y',
      ticks: 4,
      series: [
        {
          name: 'normalized |E|',
          kind: 'field',
          color: '#D55E00',
          field: { values: f.values, rows: f.rows, cols: f.cols, surface: true },
        },
      ],
    },
  }));
}

export const emEigensolverManifest: PluginManifest = {
  id: 'example.em-eigensolver',
  name: 'EM Eigensolver',
  nameI18n: { 'zh-CN': '电磁谐振特征值求解器', 'en-US': 'EM Eigensolver' },
  version: '1.0.0',
  author: 'Ergalics',
  description:
    'Sparse Hermitian (indefinite) eigenpairs via thick-restart Lanczos, block LOBPCG and Jacobi-Davidson with MINRES shift-invert.',
  descriptionI18n: {
    'zh-CN':
      '面向电磁谐振/微波器件仿真的十万阶非正定厄密稀疏矩阵特征值求解器：厚重启 Lanczos、块 LOBPCG、Jacobi-Davidson 三内核 + MINRES 位移逆变换。',
    'en-US':
      'Large-scale sparse Hermitian (indefinite) eigenpairs via thick-restart Lanczos, block LOBPCG and Jacobi-Davidson with MINRES shift-invert.',
  },
  license: 'MIT',
  entry: 'example.em-eigensolver',
  category: 'scientific',
  sandbox: 'trusted',
  formats: [
    { extension: '.npz', mimeTypes: ['application/zip', 'application/octet-stream'], description: 'NumPy sparse/dense matrix archive' },
    { extension: '.npy', mimeTypes: ['application/octet-stream'], description: 'NumPy dense matrix' },
    { extension: '.mtx', mimeTypes: ['text/plain'], description: 'Matrix Market coordinate file' },
  ],
};

const SAMPLE_LABELS: Record<string, { en: string; zh: string }> = {
  cavity_file: { en: 'Degenerate cavity array (bundled example .mtx)', zh: '简并腔体阵列（内置示例文件 .mtx）' },
  cavity_small: { en: 'Cavity 30x30 (dense spectrum)', zh: '谐振腔 30x30（小规模）' },
  cluster_zero: { en: 'Cluster at 0 (dense band, near-singular σ)', zh: '零附近密集谱（近奇异位移）' },
  degenerate_pair: { en: 'Degenerate pair (repeated eigenvalues)', zh: '重特征值样例' },
  cavity_complex: { en: 'Complex Hermitian cavity 24x24', zh: '复厄密谐振腔 24x24' },
  cavity_large: { en: 'Cavity 320x320 (~100k, memory-bound)', zh: '谐振腔 320x320（~十万阶，控内存）' },
};

// Numeric params are dropdown choices (no free number entry): the solver has
// sensible granularity and selects avoid the "default value can't be deleted"
// input-box trap entirely.
const K_CHOICES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 48, 64];
const TOL_CHOICES = [1e-4, 1e-6, 1e-8, 1e-10, 1e-12];
const BASIS_CHOICES = [16, 24, 32, 48, 64, 80, 96, 128, 160, 200];
const SEED_CHOICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/** Accept a select value (string) or number when it is one of the choices. */
export function pickChoice(raw: unknown, choices: number[]): number | null {
  const n = Number(raw);
  return Number.isFinite(n) && choices.includes(n) ? n : null;
}

/** Build a select definition over a fixed numeric choice list. */
function numSelect(
  key: string,
  label: string,
  labelI18n: { 'zh-CN': string; 'en-US': string },
  choices: number[],
  current: number,
  fmt?: (v: number) => string,
): ParamDefinition {
  const shown = choices.includes(current) ? choices : [...choices, current].sort((a, b) => a - b);
  return {
    key,
    label,
    labelI18n,
    type: 'select',
    options: shown.map((v) => ({ value: String(v), label: fmt ? fmt(v) : String(v) })),
    value: String(current),
  };
}

interface State {
  source: 'sample' | 'file';
  sample: string;
  method: EmSolverConfig['method'];
  k: number;
  sigmaText: string;
  tol: number;
  basisDim: number;
  seed: number;
  /** Render surface: 2D report panels or the 3D mode-field view. */
  view: 'report' | 'mode3d';
  /** 1-based mode number within the returned mode-field block. */
  modeIndex: number;
}

/** Parse the sigma text field; empty/invalid means "no shift" (extremal). */
export function parseSigma(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const v = Number(trimmed);
  return Number.isFinite(v) ? v : null;
}

export class EmEigensolverPlugin implements Plugin {
  readonly manifest = emEigensolverManifest;
  private api!: PluginApi;
  private ctx: ContainerCapabilities | null = null;
  private three: Scene3DHandle | null = null;
  private fieldMesh: ThreeMesh | null = null;
  /** The mode field currently baked into `fieldMesh` (skip rebuilds). */
  private fieldMeshFor: EmModeField | null = null;
  private client = new EmSolverClient();
  private file: File | null = null;
  private result: EmResultPayload | null = null;
  private history: EmProgressInfo[] = [];
  private logs: string[] = [];
  private busy = false;
  private disposed = false;
  /** Bumped per runSolve; stale rejections (post-abort) are identified by it. */
  private solveEpoch = 0;
  /** Dedupe flag for the "3D view fell back to 2D" warning. */
  private mode3dHint = '';
  private state: State = {
    source: 'sample',
    sample: 'cluster_zero',
    method: 'auto',
    k: 6,
    sigmaText: '0',
    tol: 1e-8,
    basisDim: 48,
    seed: 0,
    view: 'report',
    modeIndex: 1,
  };

  constructor() {
    this.bindClientLog();
  }

  /** Kernel verbose trace (stdout via Pyodide) — keep the last lines for
   *  the on-canvas log panel. Re-bound whenever the client is rebuilt. */
  private bindClientLog() {
    this.client.onLog = (text) => {
      this.logs.push(text);
      if (this.logs.length > 10) this.logs.splice(0, this.logs.length - 10);
      this.draw();
    };
  }

  async init(api: PluginApi) {
    this.api = api;
  }

  async destroy() {
    this.disposed = true;
    this.ctx = null;
    this.file = null;
    this.teardown3d();
    this.client.dispose();
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    // Declaring renderToScene makes the host mount the 3D surface for us;
    // visibility itself is per-view (draw switches it, report view hides it).
    if (context.container.three) this.three = context.container.three;
    this.draw();
  }

  async deactivate() {
    this.teardown3d();
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

  getSupportedFormats() {
    return this.manifest.formats ?? [];
  }

  async loadData(file: File) {
    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.npz') && !lower.endsWith('.npy') && !lower.endsWith('.mtx')) {
      notify(this.api, 'warning', 'Unsupported file — use .npz / .npy / .mtx.', '不支持的文件格式——请使用 .npz / .npy / .mtx。');
      return;
    }
    this.file = file;
    this.state.source = 'file';
    this.result = null;
    this.history = [];
    notify(this.api, 'info', `Loaded ${file.name} — press Solve.`, `已加载 ${file.name}——点击「运行求解」。`);
    this.draw();
  }

  getParams(): ParamDefinition[] {
    const zh = this.api?.locale === 'zh-CN';
    return [
      {
        // Single flat data-source dropdown: every built-in sample plus the
        // imported file (when one is loaded). Replaces the old two-level
        // "matrix source → sample" pair that read as two conflicting picks.
        key: 'matrix',
        label: 'Data Source',
        labelI18n: { 'zh-CN': '数据来源', 'en-US': 'Data Source' },
        type: 'select',
        options: [
          // Bundled example file (examples/data/em-cavity-degenerate.mtx) —
          // same asset as the top-bar sample dialog, served through the file
          // path so the Python sample dispatch never sees this id.
          { value: 'sample:cavity_file', label: zh ? `内置样例：${SAMPLE_LABELS.cavity_file!.zh}` : `Built-in: ${SAMPLE_LABELS.cavity_file!.en}` },
          ...EM_SAMPLES.map((id) => ({
            value: `sample:${id}`,
            label: zh ? `内置样例：${SAMPLE_LABELS[id]!.zh}` : `Built-in: ${SAMPLE_LABELS[id]!.en}`,
          })),
          ...(this.file
            ? [{
                value: 'file',
                label: zh ? `导入的文件：${this.file.name}` : `Imported file: ${this.file.name}`,
              }]
            : [{
                value: 'sample:cavity_file',
                label: zh ? '（拖入 .mtx/.npz/.npy 文件后此处显示）' : '(imported files appear here)',
              }]),
        ],
        // Never claim 'file' without the File object (it does not survive
        // reloads) — otherwise the dropdown would show an entry that is not
        // offered and solving would fail with "no file loaded".
        value: this.state.source === 'file' && this.file ? 'file' : `sample:${this.state.sample}`,
      },
      {
        key: 'method',
        label: 'Method',
        labelI18n: { 'zh-CN': '算法', 'en-US': 'Method' },
        type: 'select',
        options: [
          { value: 'auto', label: zh ? '自动（有 σ → JD，无 σ → Lanczos）' : 'Auto (σ → JD, else Lanczos)' },
          { value: 'lanczos', label: zh ? '厚重启 Lanczos（Krylov-Schur）' : 'Thick-restart Lanczos' },
          { value: 'lobpcg', label: zh ? '块 LOBPCG（重特征值）' : 'Block LOBPCG' },
          { value: 'jacobi-davidson', label: zh ? 'Jacobi-Davidson（密集谱内部）' : 'Jacobi-Davidson' },
        ],
        value: this.state.method,
      },
      numSelect('k', '# Eigenpairs (k)', { 'zh-CN': '特征值个数 k', 'en-US': '# Eigenpairs (k)' }, K_CHOICES, this.state.k),
      {
        key: 'sigma',
        label: 'Shift σ (empty = extremal)',
        labelI18n: { 'zh-CN': '位移 σ（留空=极端特征值）', 'en-US': 'Shift σ (empty = extremal)' },
        type: 'text',
        value: this.state.sigmaText,
        placeholder: '0',
      },
      numSelect('tol', 'Tolerance', { 'zh-CN': '收敛容差', 'en-US': 'Tolerance' }, TOL_CHOICES, this.state.tol, (v) => v.toExponential(0)),
      numSelect('basisDim', 'Basis Width', { 'zh-CN': '基宽（内存档位）', 'en-US': 'Basis width (memory knob)' }, BASIS_CHOICES, this.state.basisDim),
      numSelect('seed', 'Random Seed', { 'zh-CN': '随机种子', 'en-US': 'Random Seed' }, SEED_CHOICES, this.state.seed),
      {
        key: 'view',
        label: 'View',
        labelI18n: { 'zh-CN': '视图', 'en-US': 'View' },
        type: 'select',
        options: [
          { value: 'report', label: zh ? '求解报告（2D 面板）' : 'Solve report (2D panels)' },
          { value: 'mode3d', label: zh ? '3D 模式场' : '3D mode field' },
        ],
        value: this.state.view,
      },
      {
        key: 'modeIndex',
        label: 'Resonant Mode (3D view)',
        labelI18n: { 'zh-CN': '谐振模式（3D 视图）', 'en-US': 'Resonant mode (3D view)' },
        type: 'select',
        options: this.modeOptions(zh),
        value: String(this.state.modeIndex),
      },
      actionButton('run', this.busy ? 'Solving…' : 'Solve', this.busy ? '计算中…' : '运行求解', 'primary'),
      actionButton('abort', 'Abort', '终止求解'),
      actionButton('exportNpz', 'Export .npz', '导出 .npz'),
      actionButton('sendToFigure', 'Send to Figure Studio', '发送到 Figure Studio'),
      actionButton('reloadPlugin', 'Reset Plugin', '重置插件'),
    ];
  }

  /** Dropdown entries for the resonant-mode selector: one per returned mode
   *  field, labelled with its eigenvalue so the choice is self-describing. */
  private modeOptions(zh: boolean): { value: string; label: string }[] {
    const fields = this.result?.modeFields;
    if (!fields || fields.length === 0) {
      return [{ value: '1', label: zh ? '（先运行一次求解）' : '(run a solve first)' }];
    }
    return fields.map((f) => ({
      value: String(f.index + 1),
      label: zh
        ? `模式 ${f.index + 1}（λ=${f.eigenvalue.toExponential(3)}）`
        : `Mode ${f.index + 1} (λ=${f.eigenvalue.toExponential(3)})`,
    }));
  }

  updateParams(params: Record<string, unknown>) {
    let redraw = false;
    // Merged data-source dropdown: "sample:<id>" picks a built-in sample,
    // "file" selects the imported file (only offered when one is loaded).
    // The legacy source/sample keys stay accepted so persisted projects and
    // the top-bar sample import keep working.
    if (typeof params.matrix === 'string' && params.matrix) {
      if (params.matrix.startsWith('sample:')) {
        const id = params.matrix.slice('sample:'.length);
        const known = id === 'cavity_file' || EM_SAMPLES.includes(id as (typeof EM_SAMPLES)[number]);
        if (known && (this.state.source !== 'sample' || this.state.sample !== id)) {
          this.state.source = 'sample';
          this.state.sample = id;
          redraw = true;
        }
      } else if (params.matrix === 'file' && this.file) {
        if (this.state.source !== 'file') {
          this.state.source = 'file';
          redraw = true;
        }
      }
    }
    // Legacy source/sample keys stay accepted (persisted projects, top-bar
    // sample import) — but "file" only counts when the File object is actually
    // present: it never survives a page reload, so restoring a persisted
    // source:'file' without one must fall back to the sample path.
    if (params.source === 'sample' || (params.source === 'file' && this.file)) {
      if (params.source !== this.state.source) {
        this.state.source = params.source;
        redraw = true;
      }
    }
    if (typeof params.sample === 'string' && params.sample !== this.state.sample) {
      this.state.sample = params.sample;
      redraw = true;
    }
    if (
      params.method === 'auto' || params.method === 'lanczos' ||
      params.method === 'lobpcg' || params.method === 'jacobi-davidson'
    ) {
      if (params.method !== this.state.method) {
        this.state.method = params.method;
        redraw = true;
      }
    }
    if (params.k !== undefined && params.k !== null) {
      const n = pickChoice(params.k, K_CHOICES);
      if (n !== null && n !== this.state.k) {
        this.state.k = n;
        redraw = true;
      }
    }
    if (typeof params.sigma === 'string' && params.sigma !== this.state.sigmaText) {
      this.state.sigmaText = params.sigma;
      redraw = true;
    }
    if (params.tol !== undefined && params.tol !== null) {
      const n = pickChoice(params.tol, TOL_CHOICES);
      if (n !== null && n !== this.state.tol) {
        this.state.tol = n;
        redraw = true;
      }
    }
    if (params.basisDim !== undefined && params.basisDim !== null) {
      const n = pickChoice(params.basisDim, BASIS_CHOICES);
      if (n !== null && n !== this.state.basisDim) {
        this.state.basisDim = n;
        redraw = true;
      }
    }
    if (params.seed !== undefined && params.seed !== null) {
      const n = pickChoice(params.seed, SEED_CHOICES);
      if (n !== null && n !== this.state.seed) {
        this.state.seed = n;
        redraw = true;
      }
    }
    if (params.view === 'report' || params.view === 'mode3d') {
      if (params.view !== this.state.view) {
        this.state.view = params.view;
        redraw = true;
      }
    }
    if (params.modeIndex !== undefined && params.modeIndex !== null) {
      // Select control sends the mode number as a string; accept numbers too.
      const n = Number(params.modeIndex);
      if (Number.isFinite(n) && n >= 1 && n !== this.state.modeIndex) {
        // 1-based in the UI/state; clamped against the actual field count in draw().
        this.state.modeIndex = Math.round(n);
        redraw = true;
      }
    }
    if (actionFired(params, 'run')) void this.runSolve();
    if (actionFired(params, 'abort')) this.abortSolve();
    if (actionFired(params, 'exportNpz')) void this.exportNpz();
    if (actionFired(params, 'sendToFigure')) void this.sendToFigure();
    if (actionFired(params, 'reloadPlugin')) {
      notify(this.api, 'info', 'Resetting plugin…', '正在重置插件…');
      void this.api.reload?.();
    }
    if (redraw) this.draw();
  }

  async compute(
    input: unknown,
    onProgress?: (p: ComputeProgress) => void,
  ): Promise<ComputeResult> {
    const overrides = (input && typeof input === 'object' ? input : {}) as Partial<State>;
    const prev = this.state;
    this.state = {
      ...prev,
      source: overrides.source ?? prev.source,
      sample: overrides.sample ?? prev.sample,
      method: overrides.method ?? prev.method,
      k: overrides.k ?? prev.k,
      sigmaText: overrides.sigmaText ?? prev.sigmaText,
      tol: overrides.tol ?? prev.tol,
      basisDim: overrides.basisDim ?? prev.basisDim,
      seed: overrides.seed ?? prev.seed,
    };
    try {
      const payload = await this.runSolve((info) => {
        onProgress?.({
          done: info.cycle ?? 0,
          total: (this.state.method === 'lanczos' ? 60 : 400),
          label: `cycle ${info.cycle ?? '?'}`,
        });
      });
      return { ok: payload.converged, output: payload };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.state = prev;
    }
  }

  // ---- internals -----------------------------------------------------------

  /** Re-read getParams() into the right-hand panel — busy-dependent button
   *  labels (运行求解/计算中…) only update when the host is told to. */
  private refreshParams() {
    emit('host:params:changed', { pluginId: this.manifest.id });
  }

  private buildRequest() {
    const sigma = parseSigma(this.state.sigmaText);
    const config: EmSolverConfig = {
      method: this.state.method,
      k: this.state.k,
      sigma,
      which: 'LM',
      tol: this.state.tol,
      maxCycles: 60,
      maxIter: 400,
      basisDim: this.state.basisDim,
      seed: this.state.seed,
      denseThreshold: 800,
    };
    if (this.state.source === 'file') {
      if (!this.file) {
        notify(this.api, 'warning', 'No file loaded — pick a sample instead.', '尚未导入文件——请改用样例矩阵。');
        return null;
      }
      // Bytes are read at solve time (never cached in project state).
      return { config, sourcePromise: this.api.readBinary(this.file).then((data) => ({
        source: 'file' as const,
        filename: this.file!.name,
        name: this.file!.name,
        data,
      })) };
    }
    if (this.state.source === 'sample') {
      // The bundled example .mtx routes through the file path (same shape as
      // an imported file) so the Python sample dispatch never sees this id.
      if (this.state.sample === 'cavity_file') {
        const file = new File([emCavityMtx], 'em-cavity-degenerate.mtx', { type: 'text/plain' });
        return { config, sourcePromise: this.api.readBinary(file).then((data) => ({
          source: 'file' as const,
          filename: file.name,
          name: file.name,
          data,
        })) };
      }
      return { config, sourcePromise: Promise.resolve({ source: 'sample' as const, sample: this.state.sample }) };
    }
  }

  private async runSolve(onProgress?: (info: EmProgressInfo) => void): Promise<EmResultPayload> {
    if (this.busy) {
      notify(this.api, 'warning', 'A solve is already running.', '已有求解任务在运行。');
      throw new Error('busy');
    }
    const req = this.buildRequest();
    if (!req) throw new Error('no input');
    this.busy = true;
    this.solveEpoch += 1;
    const epoch = this.solveEpoch;
    this.history = [];
    this.logs = [];
    this.result = null;
    this.api.setStatus('computing');
    this.refreshParams();
    this.draw();
    const started = performance.now();
    try {
      const source = await req.sourcePromise;
      const payload = await this.client.solve(source, req.config, (info) => {
        this.history.push(info);
        onProgress?.(info);
        this.draw();
      });
      if (this.disposed) return payload;
      this.result = payload;
      this.api.reportDataScale(payload.meta.nnz > 0 ? payload.meta.nnz : payload.meta.shape[0]);
      this.api.setStatus('ready');
      const secs = ((performance.now() - started) / 1000).toFixed(1);
      notify(
        this.api,
        payload.converged ? 'success' : 'warning',
        payload.converged
          ? `Solved in ${secs}s (${payload.method}, ${payload.iterations} cycles).`
          : `Not converged after ${payload.iterations} cycles (${secs}s) — relax tol or widen the basis.`,
        payload.converged
          ? `求解完成，用时 ${secs}s（${payload.method}，${payload.iterations} 轮）。`
          : `${payload.iterations} 轮后未收敛（${secs}s）——可放宽容差或加大基宽。`,
      );
      this.refreshParams();
      this.draw();
      return payload;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Stale rejection: this solve was already abandoned (abortSolve hard-reset
      // everything, or a newer solve took over). Never touch current state.
      if (epoch !== this.solveEpoch || (!this.busy && msg === 'solve aborted')) throw err;
      if (msg === 'solve aborted') {
        if (!this.disposed) {
          this.busy = false;
          this.history = [];
          this.api.setStatus('ready');
          notify(this.api, 'info', 'Solve aborted — compute worker fully reset.', '求解已终止，计算线程已整体重置。');
          this.refreshParams();
          this.draw();
        }
      } else if (!this.disposed) {
        this.api.setStatus('error');
        notify(this.api, 'error', msg, '求解失败。');
        this.refreshParams();
      }
      throw err;
    } finally {
      if (epoch === this.solveEpoch) {
        // Emit AFTER busy=false: panels re-read getParams() on this event,
        // so emitting while still busy would freeze the button on 计算中….
        this.busy = false;
        if (!this.disposed) this.refreshParams();
      }
    }
  }

  /** User abort: hard-reset the whole compute stack, synchronously. The
   *  worker is terminated, the client is rebuilt from scratch (a fresh
   *  interpreter spawns on the next solve), and every status surface —
   *  status bar, button labels, canvas — is restored right here instead of
   *  waiting for the in-flight promise to reject. */
  private abortSolve(): void {
    if (!this.busy) {
      notify(this.api, 'info', 'No solve running.', '当前没有求解任务。');
      return;
    }
    this.busy = false;
    this.history = [];
    this.logs = [];
    this.api.setStatus('ready');
    // 整体重建计算线程：旧 worker 已被终止，新 client 从零 spawn。
    this.client.dispose();
    this.client = new EmSolverClient();
    this.bindClientLog();
    notify(this.api, 'info', 'Solve aborted — compute worker fully reset.', '求解已终止，计算线程已整体重置。');
    this.refreshParams();
    this.draw();
  }

  private async exportNpz(): Promise<void> {
    if (!this.result) {
      notify(this.api, 'warning', 'Run a solve first.', '请先运行一次求解。');
      return;
    }
    try {
      const bytes = await this.client.exportNpz();
      const base = (this.result.meta.name || 'eigen-result').replace(/\.[^.]+$/, '');
      this.api.exportFile(`${base}.eigen.npz`, bytes, 'application/zip');
    } catch (err) {
      notify(this.api, 'error', err instanceof Error ? err.message : String(err), '导出失败。');
    }
  }

  /**
   * Export the returned mode fields as a publication figure sheet. The
   * figure store is imported lazily: a static import here would close the
   * cycle plugin → figureStore → projectStore → pluginStore → builtin
   * registry → this module, leaving registry entries undefined at init.
   */
  private async sendToFigure(): Promise<void> {
    const fields = this.result?.modeFields ?? [];
    if (fields.length === 0) {
      notify(this.api, 'warning', 'Run a solve first.', '请先运行一次求解。');
      return;
    }
    const { useFigureStore } = await import('@/stores/figureStore');
    const zh = this.api?.locale === 'zh-CN';
    const figure = useFigureStore.getState();
    const sheetId = figure.createSheet(zh ? '电磁谐振模式场' : 'EM mode fields');
    if (!sheetId) {
      notify(this.api, 'warning', 'Open a project first.', '请先打开一个项目。');
      return;
    }
    for (const panel of modeFieldPanels(fields)) {
      figure.addPanel(sheetId, panel.spec, { row: panel.row, col: panel.col, tag: panel.tag });
    }
    figure.updateSheet(sheetId, {
      caption: zh
        ? `电磁谐振模式场：${fields.length} 个归一化模式（发散色标，零场为白）。`
        : `Resonant mode fields: ${fields.length} normalized modes (diverging colormap, zero field in white).`,
    });
    notify(
      this.api,
      'info',
      `Sent ${fields.length} mode-field panels to Figure Studio.`,
      `已将 ${fields.length} 个模式场面板发送到 Figure Studio。`,
    );
  }

  private draw() {
    const fields = this.result?.modeFields;
    // 3D mode-field view: needs the host scene AND at least one field.
    if (this.state.view === 'mode3d' && this.three && fields && fields.length > 0) {
      const field = fields[Math.min(this.state.modeIndex, fields.length) - 1]!;
      this.mode3dHint = '';
      this.draw3d(field);
      return;
    }
    // Explain why the 3D view fell back to the 2D panels (once per cause).
    if (this.state.view === 'mode3d' && this.mode3dHint !== 'fallback') {
      this.mode3dHint = 'fallback';
      notify(
        this.api,
        'warning',
        this.three
          ? 'This result carries no mode fields — run a solve again to render the 3D view.'
          : '3D container not mounted — press "Reset Plugin" below, then solve again.',
        this.three
          ? '本次结果不含模式场数据——请重新运行一次求解以渲染 3D 视图。'
          : '3D 容器未挂载——请点击下方「重置插件」，然后重新求解。',
      );
    }
    // 2D report view (and fallback when no fields / no scene): hide the 3D
    // overlay and free any stale field mesh so the host's stale frame can
    // never cover the panels.
    this.three?.setVisible(false);
    this.clearFieldMesh();
    const canvas = this.ctx?.canvas2d;
    if (!canvas) return;
    try {
      drawPanels(canvas, {
        result: this.result,
        history: this.history,
        logs: this.logs,
        busy: this.busy,
        hasFile: this.file !== null,
        sigma: parseSigma(this.state.sigmaText),
        zh: this.api?.locale === 'zh-CN',
      });
    } catch (err) {
      // never let a render glitch blank the panel silently
      this.api?.log('error', `[em-eigensolver] render error: ${String(err)}`);
    }
  }

  /** Paint one mode field as a displaced surface in the host scene. */
  private draw3d(field: EmModeField) {
    const three = this.three;
    if (!three) return;
    if (this.fieldMeshFor !== field) {
      this.clearFieldMesh();
      this.fieldMesh = buildFieldMesh(field);
      this.fieldMeshFor = field;
      three.scene.add(this.fieldMesh);
      fitFieldCamera(three.camera, three.controls, field.rows, field.cols);
      this.api?.log(
        'info',
        `[em-eigensolver] 3D mode field: mode ${field.index + 1}, ` +
          `λ=${field.eigenvalue.toExponential(4)}, grid ${field.rows}x${field.cols}` +
          (field.approx ? ' (approximate layout)' : ''),
      );
    }
    three.setVisible(true);
    three.render();
  }

  private clearFieldMesh() {
    if (!this.fieldMesh) return;
    this.three?.scene.remove(this.fieldMesh);
    this.fieldMesh.geometry.dispose();
    (this.fieldMesh.material as { dispose(): void }).dispose();
    this.fieldMesh = null;
    this.fieldMeshFor = null;
  }

  /** Release the 3D surface (plugin deactivate/destroy or view switch). */
  private teardown3d() {
    this.clearFieldMesh();
    this.three?.setVisible(false);
  }
}
