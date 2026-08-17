// ==========================================================================
// Ergalics Studio — Pyodide client (worker lifecycle + RPC)
//
// Owns the code-mode worker and hides the postMessage protocol behind small
// promises. Interrupt = terminate + respawn: a fresh worker is a fresh
// interpreter, so no SharedArrayBuffer is needed for cancellation.
// ==========================================================================

import {
  PYODIDE_INDEX_URL,
  PYODIDE_LOAD_PACKAGES,
  type PlotPayload,
  type RunMessage,
  type VariableSnapshot,
  type WorkerEvent,
} from './protocol';
import PyodideWorker from './pyodide-worker?worker';

export interface PyodideClientOptions {
  indexURL?: string;
  loadPackages?: string[];
  onStdout?: (text: string) => void;
  onStderr?: (text: string) => void;
  onPlot?: (payload: PlotPayload) => void;
  onNotify?: (kind: 'info' | 'success' | 'warning' | 'error', message: string) => void;
}

export interface PyodideRunResult {
  ok: boolean;
  variables: Record<string, VariableSnapshot>;
  error?: string;
  durationMs: number;
}

export interface PyodideReplResult {
  ok: boolean;
  text: string;
  error?: string;
}

interface Pending {
  resolve: (value: PyodideRunResult | PyodideReplResult) => void;
  reject: (reason: Error) => void;
}

export class PyodideClient {
  private readonly indexURL: string;
  private readonly loadPackages: string[];
  private readonly onStdout?: (text: string) => void;
  private readonly onStderr?: (text: string) => void;
  private readonly onPlot?: (payload: PlotPayload) => void;
  private readonly onNotify?: (
    kind: 'info' | 'success' | 'warning' | 'error',
    message: string,
  ) => void;

  private worker: Worker | null = null;
  /** Resolves once the worker has booted (Pyodide + `studio` injected). */
  private ready: Promise<void> | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(options: PyodideClientOptions = {}) {
    this.indexURL = options.indexURL ?? PYODIDE_INDEX_URL;
    this.loadPackages = options.loadPackages ?? PYODIDE_LOAD_PACKAGES;
    this.onStdout = options.onStdout;
    this.onStderr = options.onStderr;
    this.onPlot = options.onPlot;
    this.onNotify = options.onNotify;
  }

  /** Spawn a worker and boot its interpreter; the promise resolves on ready. */
  private async spawnWorker(): Promise<Worker> {
    const worker = new PyodideWorker();
    this.worker = worker;
    const ready = new Promise<void>((resolve) => {
      const onMessage = (ev: MessageEvent<WorkerEvent>) => {
        const event = ev.data;
        // The `ready` event both resolves the boot promise and is otherwise
        // inert to handleEvent — keep this listener attached for the worker's
        // whole lifetime so stdout/stderr/plot/result are always routed.
        if (event.type === 'ready') resolve();
        this.handleEvent(event);
      };
      worker.addEventListener('message', onMessage);
    });
    this.ready = ready;
    worker.postMessage({ type: 'init', indexURL: this.indexURL, loadPackages: this.loadPackages });
    return worker;
  }

  private async ensureWorker(): Promise<Worker> {
    // Every request — including the very first warm-up — must be posted only
    // after the worker has fully booted (Pyodide + packages + `studio`
    // injected). Posting a run before `init` completes lets it execute on a
    // half-initialized interpreter, which intermittently breaks the run.
    const worker = this.worker ?? (await this.spawnWorker());
    await this.ready;
    return worker;
  }

  private handleEvent(event: WorkerEvent): void {
    switch (event.type) {
      case 'stdout':
        this.onStdout?.(event.text);
        break;
      case 'stderr':
        this.onStderr?.(event.text);
        break;
      case 'plot':
        this.onPlot?.(event.payload);
        break;
      case 'notify':
        this.onNotify?.(event.kind, event.message);
        break;
      case 'result': {
        const pending = this.pending.get(event.id);
        if (pending) {
          this.pending.delete(event.id);
          pending.resolve({
            ok: event.ok,
            variables: event.variables,
            error: event.error,
            durationMs: event.durationMs,
          });
        }
        break;
      }
      case 'repl-result': {
        const pending = this.pending.get(event.id);
        if (pending) {
          this.pending.delete(event.id);
          pending.resolve({ ok: event.ok, text: event.text, error: event.error });
        }
        break;
      }
      case 'ready':
        break;
    }
  }

  private request<T extends PyodideRunResult | PyodideReplResult>(
    message: RunMessage | { type: 'repl'; code: string },
  ): Promise<T> {
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as Pending['resolve'], reject });
    });
    void this.ensureWorker().then((worker) => {
      worker.postMessage({ ...message, id });
    });
    return promise;
  }

  /** Run a full program; returns the post-run variable snapshot. */
  runPython(
    code: string,
    files: Record<string, string>,
    params: Record<string, unknown> = {},
  ): Promise<PyodideRunResult> {
    const msg: RunMessage = { type: 'run', code, files, params };
    return this.request<PyodideRunResult>(msg);
  }

  /** Evaluate one REPL line (expression or statement). */
  repl(code: string): Promise<PyodideReplResult> {
    return this.request<PyodideReplResult>({ type: 'repl', code });
  }

  /** Hard-stop the current run by terminating + discarding the worker. */
  interrupt(): void {
    const worker = this.worker;
    this.worker = null;
    this.ready = null;
    if (worker) worker.terminate();
    for (const [, pending] of this.pending) {
      pending.reject(new Error('interrupted'));
    }
    this.pending.clear();
  }

  /** Tear down the worker (used when code mode unmounts). */
  dispose(): void {
    this.interrupt();
  }
}
