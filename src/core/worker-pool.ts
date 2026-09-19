// ==========================================================================
// FR-16 — Web Worker pool for heavy parse/profile tasks
//
// Keeps the main thread fluid by running chunked parses, fingerprints and
// table profiles on a small pool of module workers. Semantics:
//
//   • Lazy slots: a worker boots on first use, capped at `size`.
//   • FIFO queue: more tasks than free slots wait their turn.
//   • Progress: the worker streams { done, total } updates through
//     `onProgress` while a task runs.
//   • Graceful degradation: with no Worker constructor (node tests, ancient
//     browsers) tasks run inline via runParseTask — same results, no pool.
//   • terminateAll(): queued + in-flight tasks reject; workers terminate.
//
// The message protocol mirrors parse-worker.ts:
//   host → worker : { id, task }
//   worker → host : { id, progress } | { id, ok, result | error }
// ==========================================================================

import { runParseTask } from './parse-tasks';
import type { ParseTask, PoolProgress } from './parse-tasks';
import { loadSettings } from './settings';
import { logger } from './logger';

export type { ParseTask, PoolProgress } from './parse-tasks';

/** Default cap on parallel parse workers (cores are precious elsewhere). */
const MAX_DEFAULT_SIZE = 4;

function defaultPoolSize(): number {
  const cores = globalThis.navigator?.hardwareConcurrency ?? MAX_DEFAULT_SIZE;
  return Math.max(1, Math.min(cores, MAX_DEFAULT_SIZE));
}

export interface PoolOptions {
  size?: number;
  /** Worker constructor injection point (tests use a fake). */
  workerCtor?: new (scriptURL: string | URL, options?: WorkerOptions) => Worker;
}

interface PendingTask {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (p: PoolProgress) => void;
}

interface Slot {
  worker: Worker;
  busy: boolean;
  /** Id of the task currently assigned to this slot (in-flight tracking). */
  taskId: number | null;
}

export class WorkerPool {
  readonly size: number;
  private readonly workerCtor:
    | (new (scriptURL: string | URL, options?: WorkerOptions) => Worker)
    | null;
  private readonly slots: Slot[] = [];
  private readonly pending = new Map<number, PendingTask>();
  private readonly queue: Array<{ id: number; task: ParseTask }> = [];
  private nextId = 1;
  private terminated = false;

  constructor(opts: PoolOptions = {}) {
    this.size = Math.max(1, Math.floor(opts.size ?? defaultPoolSize()));
    this.workerCtor =
      opts.workerCtor ??
      (typeof globalThis.Worker === 'function' ? globalThis.Worker : null);
  }

  /** Run a task; resolves with the worker's result (or inline equivalent). */
  exec<T = unknown>(task: ParseTask, onProgress?: (p: PoolProgress) => void): Promise<T> {
    if (this.terminated) return Promise.reject(new Error('worker pool terminated'));

    if (!this.workerCtor) {
      // Inline fallback: same runner, same progress contract, main thread.
      return runParseTask(task, onProgress) as Promise<T>;
    }

    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
        onProgress,
      });
    });

    this.queue.push({ id, task });
    this.pump();
    return promise;
  }

  /** Terminate every worker and reject queued + in-flight tasks. */
  terminateAll(): void {
    this.terminated = true;
    for (const slot of this.slots) {
      try {
        slot.worker.terminate();
      } catch (err) {
        logger.warn('worker-pool', 'terminate failed', err);
      }
    }
    this.slots.length = 0;
    this.queue.length = 0;
    for (const [, p] of this.pending) {
      p.reject(new Error('worker pool terminated'));
    }
    this.pending.clear();
  }

  private createSlot(): Slot | null {
    if (!this.workerCtor) return null;
    let worker: Worker;
    try {
      worker = new this.workerCtor(new URL('./parse-worker.ts', import.meta.url), {
        type: 'module',
        name: 'ergalics-parse',
      });
    } catch (err) {
      logger.warn('worker-pool', 'worker creation failed', err);
      return null;
    }
    const slot: Slot = { worker, busy: false, taskId: null };
    this.slots.push(slot);

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as {
        id?: number;
        ok?: boolean;
        result?: unknown;
        error?: string;
        progress?: PoolProgress;
      };
      if (typeof msg?.id !== 'number') return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      if (msg.progress) {
        p.onProgress?.(msg.progress);
        return;
      }
      this.pending.delete(msg.id);
      slot.busy = false;
      slot.taskId = null;
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error ?? 'parse task failed'));
      this.pump();
    };

    // A dead slot fails only ITS in-flight task; the slot is removed and
    // recreated lazily so a wedged worker cannot strand other tasks.
    const failSlot = (reason: string) => {
      const id = slot.taskId;
      if (id !== null) {
        const p = this.pending.get(id);
        if (p) {
          this.pending.delete(id);
          p.reject(new Error(reason));
        }
      }
      try {
        slot.worker.terminate();
      } catch {
        /* already gone */
      }
      const at = this.slots.indexOf(slot);
      if (at >= 0) this.slots.splice(at, 1);
      this.pump();
    };

    worker.onerror = (ev) => {
      logger.error('worker-pool', `worker error: ${ev.message}`);
      failSlot(`worker error: ${ev.message}`);
    };
    worker.onmessageerror = () => failSlot('worker message error');
    return slot;
  }

  private dispatch(slot: Slot, id: number, task: ParseTask): void {
    slot.busy = true;
    slot.taskId = id;
    try {
      slot.worker.postMessage({ id, task });
    } catch (err) {
      slot.busy = false;
      slot.taskId = null;
      const p = this.pending.get(id);
      if (p) {
        this.pending.delete(id);
        p.reject(new Error(`failed to send task to worker: ${String(err)}`));
      }
      this.pump();
    }
  }

  /** Hand queued tasks to any free slot (FIFO). */
  private pump(): void {
    while (this.queue.length > 0) {
      const free = this.slots.find((s) => !s.busy);
      if (free) {
        const next = this.queue.shift()!;
        if (this.pending.has(next.id)) this.dispatch(free, next.id, next.task);
        continue;
      }
      if (this.slots.length < this.size) {
        const slot = this.createSlot();
        if (!slot) {
          // A live worker can drain the queue when it becomes free. Without
          // one, nothing can wake pump() again: fail instead of hanging.
          if (this.slots.length === 0) {
            for (const { id } of this.queue.splice(0)) {
              const pending = this.pending.get(id);
              this.pending.delete(id);
              pending?.reject(new Error('failed to create parse worker'));
            }
          }
          break;
        }
        const next = this.queue.shift()!;
        if (this.pending.has(next.id)) this.dispatch(slot, next.id, next.task);
        continue;
      }
      break;
    }
  }
}

// ---- shared pool -------------------------------------------------------------

let shared: WorkerPool | null = null;
let sharedSize: number | 'auto' = 'auto';

/**
 * Process-wide pool sized by the `workerPoolSize` setting ('auto' → core
 * count capped at 4). Recreated when the setting changes.
 */
export function getSharedPool(): WorkerPool {
  let requested: number | 'auto' = 'auto';
  try {
    requested = loadSettings().workerPoolSize;
  } catch {
    requested = 'auto';
  }
  if (!shared || requested !== sharedSize) {
    shared = new WorkerPool(requested === 'auto' ? undefined : { size: requested });
    sharedSize = requested;
  }
  return shared;
}
