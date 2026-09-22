// ==========================================================================
// reactmd — host-side worker client (RPC, serialised one job at a time).
// ==========================================================================

import type {
  PhysicsPayload,
  ReactMDWorkerEvent,
  ReactMDWorkerRequest,
  ReactionRunOptions,
  SimulationResult,
} from './types';

interface PendingJob {
  resolve: (value: SimulationResult) => void;
  reject: (reason: Error) => void;
}

const BOOT_TIMEOUT_MS = 120_000;

export class ReactMDClient {
  private worker: Worker | null = null;
  private readyPromise: Promise<Worker> | null = null;
  private bootSettle: ((err: Error | null) => void) | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingJob>();
  private tail: Promise<unknown> = Promise.resolve();

  /** Whether the NumPy interpreter has booted (for status display). */
  ready = false;

  /** Wall-clock ms of the last completed integration (for status display). */
  durationMs: number | null = null;

  onLog: ((text: string) => void) | null = null;

  private ensureWorker(): Promise<Worker> {
    if (!this.readyPromise) {
      this.readyPromise = new Promise<Worker>((resolve, reject) => {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        let settled = false;
        const settle = (err: Error | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(bootTimer);
          this.bootSettle = null;
          if (err) reject(err);
          else resolve(worker);
        };
        const bootTimer = setTimeout(() => settle(new Error('Python engine boot timed out')), BOOT_TIMEOUT_MS);
        this.bootSettle = settle;

        worker.addEventListener('message', (ev: MessageEvent<ReactMDWorkerEvent>) => {
          const msg = ev.data;
          if (msg.type === 'ready') {
            this.ready = true;
            settle(null);
            return;
          }
          if (msg.type === 'init-failed') {
            this.ready = false;
            worker.terminate();
            this.worker = null;
            this.readyPromise = null;
            settle(new Error(msg.error));
            return;
          }
          this.dispatch(msg);
        });
        worker.addEventListener('error', (ev) => {
          const err = new Error(ev.message || 'engine worker crashed');
          this.worker = null;
          this.readyPromise = null;
          if (settled) this.failPending(err);
          else {
            settle(err);
            this.failPending(err);
          }
        });

        this.worker = worker;
        worker.postMessage({
          type: 'init',
          indexURL: new URL('pyodide/', document.baseURI).href,
        } satisfies ReactMDWorkerRequest);
      });
    }
    return this.readyPromise;
  }

  private dispatch(msg: ReactMDWorkerEvent): void {
    if (msg.type === 'stdout') {
      this.onLog?.(msg.text);
      return;
    }
    if (msg.type === 'result') {
      this.durationMs = msg.durationMs ?? null;
      const job = this.pending.get(msg.id);
      if (!job) return;
      this.pending.delete(msg.id);
      if (msg.ok && msg.payload) job.resolve(msg.payload);
      else job.reject(new Error(msg.error ?? 'reaction engine failed'));
    }
  }

  private failPending(err: Error): void {
    for (const [, job] of this.pending) job.reject(err);
    this.pending.clear();
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Integrate one reactive trajectory at the given conditions. */
  run(payload: PhysicsPayload, opts: ReactionRunOptions): Promise<SimulationResult> {
    return this.enqueue(async () => {
      const worker = await this.ensureWorker();
      if (worker !== this.worker) throw new Error('reaction aborted');
      const id = this.nextId++;
      const full = { ...opts, ...payload };
      return new Promise<SimulationResult>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
        worker.postMessage({ type: 'run', id, payload: full });
      });
    });
  }

  /** Kill the engine worker (abort); next call respawns it. */
  abort(): void {
    this.bootSettle?.(new Error('reaction aborted'));
    this.failPending(new Error('reaction aborted'));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.readyPromise = null;
  }

  dispose(): void {
    this.abort();
  }
}