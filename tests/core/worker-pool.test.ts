// ==========================================================================
// FR-16 — WorkerPool: inline fallback + fake-worker RPC, queueing, sizing,
// cancellation and error propagation.
// ==========================================================================

import { describe, expect, it, vi } from 'vitest';
import { WorkerPool } from '@/core/worker-pool';
import { createParseWorkerRuntime } from '@/core/parse-worker';
import { fingerprint } from '@/core/chunked/reader';
import type { ParseResult } from '@/core/parse-tasks';

const CSV = 'a,b\n1,2\n3,4\n5,6\n7,8\n';

class FakeWorker {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  private runtime = createParseWorkerRuntime((msg) => {
    queueMicrotask(() => this.onmessage?.({ data: msg }));
  });
  private chain: Promise<void> = Promise.resolve();
  terminated = false;

  constructor(_scriptURL: string | URL, _opts?: WorkerOptions) {}

  postMessage(msg: unknown, _transfer?: Transferable[]): void {
    this.chain = this.chain.then(() => this.runtime.handleMessage(msg));
  }

  terminate(): void {
    this.terminated = true;
  }
}

const fakeCtor = FakeWorker as unknown as new (
  url: string | URL,
  opts?: WorkerOptions,
) => Worker;

// ---- inline fallback (no Worker available) ---------------------------------

describe('WorkerPool inline fallback', () => {
  function inlinePool(): WorkerPool {
    // No Worker constructor anywhere → tasks run on the calling thread.
    vi.stubGlobal('Worker', undefined);
    try {
      return new WorkerPool({ size: 2 });
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it('runs parse tasks inline with correct results', async () => {
    const pool = inlinePool();
    const result = await pool.exec<ParseResult>({ kind: 'parse', text: CSV, chunkRows: 2 });
    expect(result.totalRows).toBe(4);
    expect(result.chunks).toBe(2);
    expect(result.columnNames).toEqual(['a', 'b']);
    expect(result.columnData).toEqual([
      [5, 7],
      [6, 8],
    ]);
  });

  it('runs fingerprint inline', async () => {
    const pool = inlinePool();
    expect(await pool.exec<string>({ kind: 'fingerprint', text: CSV })).toBe(fingerprint(CSV));
  });

  it('runs profile inline', async () => {
    const pool = inlinePool();
    const profile = await pool.exec<{ rows: number }>({
      kind: 'profile',
      rows: [
        [1, 2],
        [3, 4],
      ],
      columns: ['x', 'y'],
    });
    expect(profile.rows).toBe(2);
  });

  it('streams progress callbacks inline', async () => {
    const pool = inlinePool();
    const seen: Array<{ done: number; total: number }> = [];
    await pool.exec({ kind: 'ingest', text: CSV, chunkRows: 2 }, (p) => seen.push(p));
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[seen.length - 1]!.done).toBe(4);
  });
});

// ---- worker-backed pool ------------------------------------------------------

describe('WorkerPool with workers', () => {
  it('rejects failed worker startup and allows a later retry', async () => {
    let attempts = 0;
    class StartupWorker extends FakeWorker {
      constructor(url: string | URL, opts?: WorkerOptions) {
        if (++attempts === 1) throw new Error('worker blocked');
        super(url, opts);
      }
    }
    const pool = new WorkerPool({ size: 1, workerCtor: StartupWorker as unknown as typeof fakeCtor });
    try {
      await expect(pool.exec({ kind: 'fingerprint', text: CSV })).rejects.toThrow('worker');
      expect(await pool.exec({ kind: 'fingerprint', text: CSV })).toBe(fingerprint(CSV));
    } finally {
      pool.terminateAll();
    }
  }, 1000);

  it('rejects queued tasks when the last worker dies and cannot be replaced', async () => {
    let attempts = 0;
    let live!: FakeWorker;
    class ReplacementWorker extends FakeWorker {
      constructor(url: string | URL, opts?: WorkerOptions) {
        if (++attempts > 1) throw new Error('replacement blocked');
        super(url, opts);
        live = this;
      }
      override postMessage(): void { /* wait for the injected failure */ }
    }
    const pool = new WorkerPool({ size: 1, workerCtor: ReplacementWorker as unknown as typeof fakeCtor });
    const first = pool.exec({ kind: 'fingerprint', text: 'first' });
    const queued = pool.exec({ kind: 'fingerprint', text: 'queued' });
    const checks = Promise.all([
      expect(first).rejects.toThrow('worker'),
      expect(queued).rejects.toThrow('worker'),
    ]);
    live.onerror?.({ message: 'crashed' });
    try {
      await checks;
    } finally {
      pool.terminateAll();
    }
  }, 1000);

  it('keeps queued tasks when another healthy worker can still process them', async () => {
    let attempts = 0;
    class LimitedWorker extends FakeWorker {
      constructor(url: string | URL, opts?: WorkerOptions) {
        if (++attempts > 1) throw new Error('worker limit');
        super(url, opts);
      }
    }
    const pool = new WorkerPool({ size: 2, workerCtor: LimitedWorker as unknown as typeof fakeCtor });
    try {
      const results = await Promise.all(['a', 'b', 'c'].map((text) => pool.exec({ kind: 'fingerprint', text })));
      expect(results).toEqual(['a', 'b', 'c'].map(fingerprint));
    } finally {
      pool.terminateAll();
    }
  });

  it('exec round-trips a parse task through the worker', async () => {
    const pool = new WorkerPool({ size: 2, workerCtor: fakeCtor });
    const result = await pool.exec<ParseResult>({ kind: 'parse', text: CSV, chunkRows: 3 });
    expect(result.totalRows).toBe(4);
    expect(result.chunks).toBe(2);
    pool.terminateAll();
  });

  it('rejects when the task runner throws inside the worker', async () => {
    const pool = new WorkerPool({ size: 1, workerCtor: fakeCtor });
    await expect(
      pool.exec({ kind: 'fingerprint', text: 'x'.repeat(200_000_001) }),
    ).rejects.toThrow('memory limit');
    pool.terminateAll();
  });

  it('caps concurrency at pool size', async () => {
    let live = 0;
    let maxLive = 0;
    class CountingWorker extends FakeWorker {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts);
        live += 1;
        maxLive = Math.max(maxLive, live);
      }
      override terminate(): void {
        live -= 1;
        super.terminate();
      }
    }
    const pool = new WorkerPool({
      size: 2,
      workerCtor: CountingWorker as unknown as typeof fakeCtor,
    });
    const tasks = Array.from({ length: 6 }, () =>
      pool.exec<ParseResult>({ kind: 'parse', text: CSV, chunkRows: 1 }),
    );
    await Promise.all(tasks);
    expect(maxLive).toBeLessThanOrEqual(2);
    pool.terminateAll();
  });

  it('processes queued tasks FIFO', async () => {
    const order: number[] = [];
    let workerCount = 0;
    class SlowWorker extends FakeWorker {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts);
        workerCount += 1;
      }
      override postMessage(msg: unknown, transfer?: Transferable[]): void {
        const m = msg as { id?: number };
        if (typeof m.id === 'number') order.push(m.id);
        super.postMessage(msg, transfer);
      }
    }
    // size 1 → strict FIFO dispatch order.
    const pool = new WorkerPool({ size: 1, workerCtor: SlowWorker as unknown as typeof fakeCtor });
    const tasks = [1, 2, 3].map((i) =>
      pool.exec<ParseResult>({ kind: 'parse', text: CSV, chunkRows: i }),
    );
    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3]);
    expect(workerCount).toBe(1);
    pool.terminateAll();
  });

  it('terminateAll rejects in-flight and queued tasks', async () => {
    class SilentWorker {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: ((ev: { message: string }) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminated = false;
      constructor(_url: string | URL, _opts?: WorkerOptions) {}
      postMessage(_msg: unknown, _transfer?: Transferable[]): void {
        /* never replies */
      }
      terminate(): void {
        this.terminated = true;
      }
    }
    const pool = new WorkerPool({
      size: 1,
      workerCtor: SilentWorker as unknown as typeof fakeCtor,
    });
    const a = pool.exec({ kind: 'fingerprint', text: 'a' });
    const b = pool.exec({ kind: 'fingerprint', text: 'b' });
    pool.terminateAll();
    await expect(a).rejects.toThrow('worker pool terminated');
    await expect(b).rejects.toThrow('worker pool terminated');
    await expect(pool.exec({ kind: 'fingerprint', text: 'c' })).rejects.toThrow('terminated');
  });

  it('worker onerror fails only that slot; the pool recovers', async () => {
    let created = 0;
    class FlakyWorker extends FakeWorker {
      constructor(url: string | URL, opts?: WorkerOptions) {
        super(url, opts);
        created += 1;
        if (created === 1) {
          queueMicrotask(() => this.onerror?.({ message: 'boom' }));
        }
      }
    }
    const pool = new WorkerPool({ size: 1, workerCtor: FlakyWorker as unknown as typeof fakeCtor });
    await expect(pool.exec({ kind: 'fingerprint', text: 'x' })).rejects.toThrow('boom');
    const result = await pool.exec<string>({ kind: 'fingerprint', text: CSV });
    expect(result).toBe(fingerprint(CSV));
    pool.terminateAll();
  });

  it('default size is min(hardwareConcurrency, 4)', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 12 });
    expect(new WorkerPool({ workerCtor: fakeCtor }).size).toBe(4);
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
    expect(new WorkerPool({ workerCtor: fakeCtor }).size).toBe(2);
    vi.stubGlobal('navigator', {});
    expect(new WorkerPool({ workerCtor: fakeCtor }).size).toBe(4);
    vi.unstubAllGlobals();
  });

  it('honors an explicit size', () => {
    expect(new WorkerPool({ size: 8, workerCtor: fakeCtor }).size).toBe(8);
  });
});
