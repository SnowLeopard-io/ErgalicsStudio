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
} from '@/types/plugin';
import { actionButton, actionFired, notify } from '../shared/enhance';
import { EmSolverClient } from './em-client';
import { drawPanels } from './render';
import { EM_SAMPLES, type EmProgressInfo, type EmResultPayload, type EmSolverConfig } from './types';
// Bundled example matrix — same file the top-bar sample dialog serves, so the
// built-in sample dropdown can route it through the file path too.
import emCavityMtx from '../../../../examples/data/em-cavity-degenerate.mtx?raw';

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

interface State {
  source: 'sample' | 'file';
  sample: string;
  method: EmSolverConfig['method'];
  k: number;
  sigmaText: string;
  tol: number;
  basisDim: number;
  seed: number;
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
  private client = new EmSolverClient();
  private file: File | null = null;
  private result: EmResultPayload | null = null;
  private history: EmProgressInfo[] = [];
  private logs: string[] = [];
  private busy = false;
  private disposed = false;
  private state: State = {
    source: 'sample',
    sample: 'cluster_zero',
    method: 'auto',
    k: 6,
    sigmaText: '0',
    tol: 1e-8,
    basisDim: 48,
    seed: 0,
  };

  constructor() {
    // Kernel verbose trace (stdout via Pyodide) — keep the last lines for
    // the on-canvas log panel so the workstation shows live output.
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
    this.client.dispose();
  }

  async activate(context: { container: ContainerCapabilities }) {
    this.ctx = context.container;
    this.draw();
  }

  async deactivate() {}

  render(container: ContainerCapabilities) {
    this.ctx = container;
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
        key: 'source',
        label: 'Matrix Source',
        labelI18n: { 'zh-CN': '矩阵来源', 'en-US': 'Matrix Source' },
        type: 'select',
        options: [
          { value: 'sample', label: zh ? '内置样例矩阵' : 'Built-in sample' },
          {
            value: 'file',
            // Show the loaded file's name once one is imported, so the
            // selected source is self-describing (top-bar samples and
            // drag-drop both land here via loadData).
            label: this.file
              ? (zh ? `导入的文件：${this.file.name}` : `Imported file: ${this.file.name}`)
              : (zh ? '导入的文件 (.npz/.npy/.mtx)' : 'Imported file (.npz/.npy/.mtx)'),
          },
        ],
        value: this.state.source,
      },
      {
        key: 'sample',
        label: 'Sample',
        labelI18n: { 'zh-CN': '样例矩阵', 'en-US': 'Sample' },
        type: 'select',
        options: [
          // Bundled example file (examples/data/em-cavity-degenerate.mtx) —
          // same asset as the top-bar sample dialog, served through the file
          // path so the Python sample dispatch never sees this id.
          { value: 'cavity_file', label: zh ? SAMPLE_LABELS.cavity_file!.zh : SAMPLE_LABELS.cavity_file!.en },
          ...EM_SAMPLES.map((id) => ({
            value: id,
            label: SAMPLE_LABELS[id] ? (zh ? SAMPLE_LABELS[id]!.zh : SAMPLE_LABELS[id]!.en) : id,
          })),
        ],
        value: this.state.sample,
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
      { key: 'k', label: '# Eigenpairs (k)', labelI18n: { 'zh-CN': '特征值个数 k', 'en-US': '# Eigenpairs (k)' }, type: 'number', min: 1, max: 64, step: 1, value: this.state.k },
      {
        key: 'sigma',
        label: 'Shift σ (empty = extremal)',
        labelI18n: { 'zh-CN': '位移 σ（留空=极端特征值）', 'en-US': 'Shift σ (empty = extremal)' },
        type: 'text',
        value: this.state.sigmaText,
        placeholder: '0',
      },
      { key: 'tol', label: 'Tolerance', labelI18n: { 'zh-CN': '收敛容差', 'en-US': 'Tolerance' }, type: 'number', min: 1e-12, max: 1e-3, step: 1e-9, value: this.state.tol },
      { key: 'basisDim', label: 'Basis Width', labelI18n: { 'zh-CN': '基宽（内存档位）', 'en-US': 'Basis width (memory knob)' }, type: 'number', min: 16, max: 200, step: 1, value: this.state.basisDim },
      { key: 'seed', label: 'Random Seed', labelI18n: { 'zh-CN': '随机种子', 'en-US': 'Random Seed' }, type: 'number', min: 0, step: 1, value: this.state.seed },
      actionButton('run', this.busy ? 'Solving…' : 'Solve', this.busy ? '计算中…' : '运行求解', 'primary'),
      actionButton('abort', 'Abort', '终止求解'),
      actionButton('exportNpz', 'Export .npz', '导出 .npz'),
    ];
  }

  updateParams(params: Record<string, unknown>) {
    let redraw = false;
    if (params.source === 'sample' || params.source === 'file') {
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
    if (typeof params.k === 'number' && params.k !== this.state.k) {
      this.state.k = Math.max(1, Math.min(64, Math.round(params.k)));
      redraw = true;
    }
    if (typeof params.sigma === 'string' && params.sigma !== this.state.sigmaText) {
      this.state.sigmaText = params.sigma;
      redraw = true;
    }
    if (typeof params.tol === 'number' && params.tol > 0 && params.tol !== this.state.tol) {
      this.state.tol = params.tol;
      redraw = true;
    }
    if (typeof params.basisDim === 'number' && params.basisDim !== this.state.basisDim) {
      this.state.basisDim = Math.max(16, Math.min(200, Math.round(params.basisDim)));
      redraw = true;
    }
    if (typeof params.seed === 'number' && params.seed !== this.state.seed) {
      this.state.seed = Math.max(0, Math.round(params.seed));
      redraw = true;
    }
    if (actionFired(params, 'run')) void this.runSolve();
    if (actionFired(params, 'abort')) this.abortSolve();
    if (actionFired(params, 'exportNpz')) void this.exportNpz();
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
    this.history = [];
    this.logs = [];
    this.result = null;
    this.api.setStatus('computing');
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
      this.draw();
      return payload;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === 'solve aborted') {
        if (!this.disposed) {
          this.history = [];
          this.api.setStatus('ready');
          notify(this.api, 'info', 'Solve aborted — worker restarted.', '求解已终止，计算线程已重启。');
          this.draw();
        }
      } else if (!this.disposed) {
        this.api.setStatus('error');
        notify(this.api, 'error', msg, '求解失败。');
      }
      throw err;
    } finally {
      this.busy = false;
    }
  }

  /** User abort: kill the worker (Python cannot be interrupted mid-solve);
   *  the pending promise rejects and the next solve respawns cleanly. */
  private abortSolve(): void {
    if (!this.busy) {
      notify(this.api, 'info', 'No solve running.', '当前没有求解任务。');
      return;
    }
    this.client.abort();
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

  private draw() {
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
}
