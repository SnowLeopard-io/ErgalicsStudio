// ==========================================================================
// EM Eigensolver plugin — host-side worker client (RPC + progress)
//
// Owns the worker lifecycle (spawn on first use, terminate on dispose) and
// serialises solve/export requests: one job at a time, everything else is
// queued behind a promise chain. Progress messages are forwarded to the
// per-request `onProgress` callback.
// ==========================================================================

import type {
  EmProgressInfo,
  EmResultPayload,
  EmSolveSource,
  EmSolverConfig,
  EmWorkerEvent,
  EmWorkerRequest,
} from './types';

interface PendingJob {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  onProgress?: (info: EmProgressInfo) => void;
}

const BOOT_TIMEOUT_MS = 120_000;

export class EmSolverClient {
  private worker: Worker | null = null;
  private readyPromise: Promise<Worker> | null = null;
  /** Settle an in-flight boot early (abort) so queued jobs fail fast. */
  private bootSettle: ((err: Error | null) => void) | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingJob>();
  private tail: Promise<unknown> = Promise.resolve();

  /** Solver stdout (kernel verbose trace, one line per call). */
  onLog: ((text: string) => void) | null = null;

  /** Spawn (once) and wait for the interpreter to become ready. */
  private ensureWorker(): Promise<Worker> {
    if (!this.readyPromise) {
      this.readyPromise = new Promise<Worker>((resolve, reject) => {
        const worker = new Worker(new URL('./em-worker.ts', import.meta.url), {
          type: 'module',
        });
        let settled = false;
        const settle = (err: Error | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(bootTimer);
          this.bootSettle = null;
          if (err) reject(err);
          else resolve(worker);
        };
        const bootTimer = setTimeout(
          () => settle(new Error('Python runtime boot timed out')),
          BOOT_TIMEOUT_MS,
        );
        this.bootSettle = settle;

        worker.addEventListener('message', (ev: MessageEvent<EmWorkerEvent>) => {
          const msg = ev.data;
          if (msg.type === 'ready') {
            settle(null);
            return;
          }
          if (msg.type === 'init-failed') {
            worker.terminate();
            this.worker = null;
            this.readyPromise = null;
            settle(new Error(msg.error));
            return;
          }
          this.dispatch(msg);
        });
        worker.addEventListener('error', (ev) => {
          const err = new Error(ev.message || 'worker crashed');
          if (settled) {
            // A crash after boot used to leave this.worker/readyPromise
            // pointing at the dead worker: the next request posted into it
            // and hung forever. Reset so the next call respawns fresh.
            this.worker = null;
            this.readyPromise = null;
            this.failPending(err);
            return;
          }
          this.readyPromise = null;
          settle(err);
          this.failPending(err);
        });

        this.worker = worker;
        worker.postMessage({
          type: 'init',
          indexURL: new URL('pyodide/', document.baseURI).href,
        } satisfies EmWorkerRequest);
      });
    }
    return this.readyPromise;
  }

  private dispatch(msg: EmWorkerEvent): void {
    if (msg.type === 'stdout') {
      this.onLog?.(msg.text);
      return;
    }
    if (msg.type === 'progress') {
      this.pending.get(msg.id)?.onProgress?.(msg.info);
      return;
    }
    if (msg.type === 'result' || msg.type === 'export-result') {
      const job = this.pending.get(msg.id);
      if (!job) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        job.resolve(msg.type === 'result' ? (msg.payload as EmResultPayload) : (msg.bytes as ArrayBuffer));
      } else {
        job.reject(new Error(msg.error ?? 'solve failed'));
      }
    }
  }

  private failPending(err: Error): void {
    for (const [, job] of this.pending) job.reject(err);
    this.pending.clear();
  }

  /** Serialise access to the single worker: jobs run strictly one at a time. */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Run one solve on the Python side. */
  solve(
    request: EmSolveSource,
    config: EmSolverConfig,
    onProgress?: (info: EmProgressInfo) => void,
  ): Promise<EmResultPayload> {
    return this.enqueue(async () => {
      const worker = await this.ensureWorker();
      if (worker !== this.worker) throw new Error('solve aborted');
      const id = this.nextId++;
      return new Promise<EmResultPayload>((resolve, reject) => {
        this.pending.set(id, { resolve: (v) => resolve(v as EmResultPayload), reject, onProgress });
        worker.postMessage({ type: 'solve', id, request, config } satisfies EmWorkerRequest);
      });
    });
  }

  /** Export the last solve's eigenpairs as an `.npz` byte buffer. */
  exportNpz(): Promise<ArrayBuffer> {
    return this.enqueue(async () => {
      const worker = await this.ensureWorker();
      if (worker !== this.worker) throw new Error('solve aborted');
      const id = this.nextId++;
      return new Promise<ArrayBuffer>((resolve, reject) => {
        this.pending.set(id, { resolve: (v) => resolve(v as ArrayBuffer), reject });
        worker.postMessage({ type: 'export', id } satisfies EmWorkerRequest);
      });
    });
  }

  /** Kill the worker immediately (user abort). Pending jobs reject with
   *  'solve aborted'; the next solve respawns a fresh interpreter. An
   *  in-flight boot is rejected too, so aborting during the first solve
   *  (Pyodide still loading) fails fast instead of hanging to the timeout. */
  abort(): void {
    this.bootSettle?.(new Error('solve aborted'));
    this.failPending(new Error('solve aborted'));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.readyPromise = null;
  }

  /** Terminate the worker and reject everything in flight. */
  dispose(): void {
    this.abort();
  }
}
