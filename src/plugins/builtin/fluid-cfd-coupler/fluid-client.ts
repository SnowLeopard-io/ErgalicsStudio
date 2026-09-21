// ==========================================================================
// Fluid-CFD Coupler plugin — host-side worker client (RPC + progress)
//
// Owns the worker lifecycle (spawn on first use, terminate on dispose) and
// serialises run/verify requests: one job at a time, everything else queued
// behind a promise chain. Progress messages are forwarded to the per-request
// onProgress callback.
// ==========================================================================

import type {
  CouplingPayload,
  FluidCouplingResult,
  FluidProgressInfo,
  FluidVerifyResult,
  FluidWorkerEvent,
  FluidWorkerRequest,
} from './types';

interface PendingJob {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  onProgress?: (info: FluidProgressInfo) => void;
}

const BOOT_TIMEOUT_MS = 120_000;

export class FluidCfdClient {
  private worker: Worker | null = null;
  private readyPromise: Promise<Worker> | null = null;
  private bootSettle: ((err: Error | null) => void) | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingJob>();
  private tail: Promise<unknown> = Promise.resolve();

  /** Kernel verbose trace (stdout via Pyodide), one line per call. */
  onLog: ((text: string) => void) | null = null;

  private ensureWorker(): Promise<Worker> {
    if (!this.readyPromise) {
      this.readyPromise = new Promise<Worker>((resolve, reject) => {
        const worker = new Worker(new URL('./fluid-worker.ts', import.meta.url), { type: 'module' });
        let settled = false;
        const settle = (err: Error | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(bootTimer);
          this.bootSettle = null;
          if (err) reject(err);
          else resolve(worker);
        };
        const bootTimer = setTimeout(() => settle(new Error('Python runtime boot timed out')), BOOT_TIMEOUT_MS);
        this.bootSettle = settle;

        worker.addEventListener('message', (ev: MessageEvent<FluidWorkerEvent>) => {
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
        } satisfies FluidWorkerRequest);
      });
    }
    return this.readyPromise;
  }

  private dispatch(msg: FluidWorkerEvent): void {
    if (msg.type === 'stdout') {
      this.onLog?.(msg.text);
      return;
    }
    if (msg.type === 'progress') {
      this.pending.get(msg.id)?.onProgress?.({ done: msg.done, total: msg.total });
      return;
    }
    if (msg.type === 'result' || msg.type === 'verify-result') {
      const job = this.pending.get(msg.id);
      if (!job) return;
      this.pending.delete(msg.id);
      if (msg.ok) {
        job.resolve(msg.type === 'result' ? (msg.payload as FluidCouplingResult) : (msg.payload as FluidVerifyResult));
      } else {
        job.reject(new Error(msg.error ?? 'compute failed'));
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

  private postJob<T>(_type: 'solve' | 'verify', build: (id: number) => FluidWorkerRequest, onProgress?: (info: FluidProgressInfo) => void): Promise<T> {
    return this.enqueue(async () => {
      const worker = await this.ensureWorker();
      if (worker !== this.worker) throw new Error('compute aborted');
      const id = this.nextId++;
      return new Promise<T>((resolve, reject) => {
        this.pending.set(id, { resolve: (v) => resolve(v as T), reject, onProgress });
        worker.postMessage(build(id));
      });
    });
  }

  /** Run a single coupled 1D-3D simulation. */
  runCoupling(payload: CouplingPayload, onProgress?: (info: FluidProgressInfo) => void): Promise<FluidCouplingResult> {
    return this.postJob<FluidCouplingResult>('solve', (id) => ({ type: 'solve', id, payload }), onProgress);
  }

  /** Run the verification suite (Case A + Case B + trade-off). */
  verify(onProgress?: (info: FluidProgressInfo) => void): Promise<FluidVerifyResult> {
    return this.postJob<FluidVerifyResult>('verify', (id) => ({ type: 'verify', id }), onProgress);
  }

  /** Kill the worker immediately (user abort); the next call respawns it. */
  abort(): void {
    this.bootSettle?.(new Error('compute aborted'));
    this.failPending(new Error('compute aborted'));
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