// ==========================================================================
// Storage v2 — `runs` object store (experiment tracking persistence)
//
// Vitest runs in a node environment, so this suite installs a minimal
// in-memory IndexedDB fake covering exactly the surface storage.ts uses:
// open+onupgradeneeded, single-store transactions, put/get/delete/getAll/
// clear, and index.openCursor(direction) with cursor.delete().
// ==========================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetDbForTests,
  deleteRun,
  deleteRunsByProject,
  listRuns,
  saveRun,
} from '@/core/storage';
import { createRunRecord } from '@/core/experiment/record';
import type { RunRecord } from '@/core/experiment/record';

// ---- minimal IndexedDB fake -------------------------------------------------

interface FakeIndex {
  name: string;
  keyPath: string;
}

interface FakeRequest {
  result: unknown;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

class FakeCursor {
  result: {
    key: unknown;
    primaryKey: unknown;
    value: unknown;
    continue: () => void;
    delete: () => void;
  } | null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private rows: Array<{ key: unknown; value: Record<string, unknown> }>;
  private pos = 0;
  private direction: IDBCursorDirection | undefined;
  private store: FakeObjectStore;

  constructor(
    rows: Array<{ key: unknown; value: Record<string, unknown> }>,
    direction: IDBCursorDirection | undefined,
    store: FakeObjectStore,
  ) {
    // Real indexes iterate in key order, not insertion order.
    this.rows = [...rows].sort((a, b) =>
      a.key === b.key ? 0 : (a.key as number) < (b.key as number) ? -1 : 1,
    );
    this.direction = direction;
    this.store = store;
    this.result = null;
    // Real IndexedDB fires the first success asynchronously; subsequent
    // continue() calls re-fire synchronously from within the handler.
    queueMicrotask(() => {
      this.open();
      this.onsuccess?.();
    });
  }

  open(): void {
    const ordered =
      this.direction === 'prev' ? [...this.rows].reverse() : this.rows;
    if (this.pos >= ordered.length) {
      this.result = null;
      return;
    }
    const row = ordered[this.pos]!;
    this.pos += 1;
    this.result = {
      key: row.key,
      primaryKey: row.value.id,
      value: row.value,
      continue: () => {
        this.open();
        this.onsuccess?.();
      },
      delete: () => {
        this.store.deleteValue(row.value.id as string);
      },
    };
  }
}

class FakeObjectStore {
  private rows = new Map<string, Record<string, unknown>>();
  private indexes = new Map<string, FakeIndex>();

  constructor(
    public name: string,
    public keyPath: string,
    indexes: FakeIndex[],
    private onDirty: () => void,
  ) {
    for (const idx of indexes) this.indexes.set(idx.name, idx);
  }

  createIndex(name: string, keyPath: string): FakeIndex {
    const idx: FakeIndex = { name, keyPath };
    this.indexes.set(name, idx);
    return idx;
  }

  put(value: Record<string, unknown>): FakeRequest {
    const key = value[this.keyPath] as string;
    this.rows.set(key, value);
    this.onDirty();
    return this.settle(undefined);
  }

  get(key: string): FakeRequest {
    return this.settle(this.rows.get(key));
  }

  delete(key: string): FakeRequest {
    this.rows.delete(key);
    this.onDirty();
    return this.settle(undefined);
  }

  getAll(): FakeRequest {
    return this.settle([...this.rows.values()]);
  }

  clear(): FakeRequest {
    this.rows.clear();
    this.onDirty();
    return this.settle(undefined);
  }

  index(name: string): { openCursor: (range: unknown, direction?: IDBCursorDirection) => FakeCursor } {
    const idx = this.indexes.get(name);
    if (!idx) throw new Error(`no index ${name}`);
    const rows = [...this.rows.values()].map((value) => ({
      key: value[idx.keyPath],
      value,
    }));
    return {
      openCursor: (_range: unknown, direction?: IDBCursorDirection) =>
        new FakeCursor(rows, direction, this),
    };
  }

  deleteValue(key: string): void {
    this.rows.delete(key);
    this.onDirty();
  }

  private settle(result: unknown): FakeRequest {
    const req: FakeRequest = { result, onsuccess: null, onerror: null };
    queueMicrotask(() => req.onsuccess?.());
    return req;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(private stores: FakeObjectStore[]) {
    // Complete on a macrotask so every request/cursor microtask (including
    // handlers assigned after construction) runs to completion first.
    queueMicrotask(() => {
      setTimeout(() => this.oncomplete?.(), 0);
    });
  }
  objectStore(name: string): FakeObjectStore {
    const store = this.stores.find((s) => s.name === name);
    if (!store) throw new Error(`no store ${name}`);
    return store;
  }
}

class FakeDb {
  objectStoreNames: { contains: (name: string) => boolean };
  private stores = new Map<string, FakeObjectStore>();

  constructor(public version: number) {
    this.objectStoreNames = { contains: (name) => this.stores.has(name) };
  }

  createObjectStore(
    name: string,
    opts: { keyPath: string },
  ): FakeObjectStore {
    const store = new FakeObjectStore(name, opts.keyPath, [], () => undefined);
    this.stores.set(name, store);
    return store;
  }

  transaction(names: string | string[]): FakeTransaction {
    const list = Array.isArray(names) ? names : [names];
    const stores = list.map((name) => {
      const store = this.stores.get(name);
      if (!store) throw new Error(`no store ${name}`);
      return store;
    });
    return new FakeTransaction(stores);
  }
}

function installFakeIndexedDB(): void {
  const g = globalThis as unknown as {
    indexedDB: {
      open: (name: string, version: number) => {
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        result: FakeDb;
      };
    };
  };
  g.indexedDB = {
    open: (_name: string, version: number) => {
      const req: {
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        result: FakeDb;
      } = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        result: null as unknown as FakeDb,
      };
      // Mirror the real API: upgrade fires before success, and storage.ts
      // creates stores on the upgrade pass.
      const db = new FakeDb(version);
      if (version >= 1 && !db.objectStoreNames.contains('projects')) {
        const projects = db.createObjectStore('projects', { keyPath: 'id' });
        projects.createIndex('updatedAt', 'updatedAt');
        projects.createIndex('name', 'name');
      }
      if (version >= 1 && !db.objectStoreNames.contains('plugins')) {
        db.createObjectStore('plugins', { keyPath: 'id' });
      }
      if (version >= 2 && !db.objectStoreNames.contains('runs')) {
        const runs = db.createObjectStore('runs', { keyPath: 'id' });
        runs.createIndex('projectId', 'projectId');
        runs.createIndex('createdAt', 'createdAt');
      }
      req.result = db;
      queueMicrotask(() => {
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

// ---- suite ------------------------------------------------------------------

function run(projectId: string, createdAt: number, source = 'flow'): RunRecord {
  return createRunRecord({
    projectId,
    source: source as RunRecord['source'],
    params: { alpha: 0.05 },
    metrics: { loss: 1 / (createdAt + 1) },
    createdAt,
  });
}

describe('storage runs store (v2)', () => {
  beforeEach(() => {
    installFakeIndexedDB();
    // storage.ts caches its connection module-wide; drop it so every test
    // starts from a fresh (v2-created) fake database.
    __resetDbForTests();
  });

  afterEach(() => {
    const g = globalThis as unknown as { indexedDB?: unknown };
    delete g.indexedDB;
  });

  it('persists and reads back a run record', async () => {
    const rec = run('p1', 100);
    await saveRun(rec);
    const list = await listRuns('p1');
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(rec.id);
    expect(list[0]?.params).toEqual({ alpha: 0.05 });
  });

  it('lists newest first, filtered by project, honoring limit', async () => {
    await saveRun(run('p1', 100));
    await saveRun(run('p1', 300));
    await saveRun(run('p1', 200));
    await saveRun(run('p2', 400));

    const all = await listRuns('p1');
    expect(all.map((r) => r.createdAt)).toEqual([300, 200, 100]);

    const limited = await listRuns('p1', 2);
    expect(limited.map((r) => r.createdAt)).toEqual([300, 200]);
  });

  it('deletes a single run and cascade-deletes by project', async () => {
    const a = run('p1', 1);
    const b = run('p1', 2);
    const c = run('p2', 3);
    await saveRun(a);
    await saveRun(b);
    await saveRun(c);

    await deleteRun(a.id);
    expect((await listRuns('p1')).map((r) => r.id)).toEqual([b.id]);

    await deleteRunsByProject('p1');
    expect(await listRuns('p1')).toEqual([]);
    expect((await listRuns('p2')).map((r) => r.id)).toEqual([c.id]);
  });

  it('filters heterogeneous projects via the projectId index path', async () => {
    for (let i = 0; i < 12; i += 1) {
      await saveRun(run(i % 2 === 0 ? 'px' : 'py', i));
    }
    expect(await listRuns('px')).toHaveLength(6);
    expect(await listRuns('pz')).toEqual([]);
  });
});
