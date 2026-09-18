// ==========================================================================
// Shared fakes for FR-17 / FR-16 suites: an in-memory OPFS tree and the
// v4 IndexedDB fake (fileChunks + opfsMigration stores). Not a test file —
// vitest only collects tests/**/*.test.ts.
// ==========================================================================

export function makeNotFoundError(name: string): Error {
  const err = new Error(`not found: ${name}`);
  err.name = 'NotFoundError';
  return err;
}

// ---- Fake OPFS ---------------------------------------------------------------

class FakeFileHandle {
  readonly kind = 'file';
  data = new Uint8Array(0);
  constructor(public readonly name: string) {}

  async createWritable(): Promise<{
    write(d: Uint8Array): Promise<void>;
    close(): Promise<void>;
  }> {
    const chunks: Uint8Array[] = [];
    const self = this;
    return {
      async write(d: Uint8Array) {
        chunks.push(d);
      },
      async close() {
        const total = chunks.reduce((s, c) => s + c.byteLength, 0);
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          out.set(c, off);
          off += c.byteLength;
        }
        self.data = out;
      },
    };
  }

  async getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> {
    const self = this;
    return {
      async arrayBuffer() {
        return self.data.slice().buffer as ArrayBuffer;
      },
    };
  }
}

export class FakeDirHandle {
  readonly kind = 'directory';
  readonly dirs = new Map<string, FakeDirHandle>();
  readonly files = new Map<string, FakeFileHandle>();

  async getDirectoryHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FakeDirHandle> {
    const existing = this.dirs.get(name);
    if (existing) return existing;
    if (opts?.create) {
      const dir = new FakeDirHandle();
      this.dirs.set(name, dir);
      return dir;
    }
    throw makeNotFoundError(name);
  }

  async getFileHandle(
    name: string,
    opts?: { create?: boolean },
  ): Promise<FakeFileHandle> {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (opts?.create) {
      const file = new FakeFileHandle(name);
      this.files.set(name, file);
      return file;
    }
    throw makeNotFoundError(name);
  }

  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    const dir = this.dirs.get(name);
    if (dir) {
      if (!opts?.recursive && (dir.dirs.size > 0 || dir.files.size > 0)) {
        throw new Error('directory not empty');
      }
      this.dirs.delete(name);
      return;
    }
    if (this.files.has(name)) {
      this.files.delete(name);
      return;
    }
    throw makeNotFoundError(name);
  }

  async *entries(): AsyncGenerator<[string, { kind: string }]> {
    for (const [name, d] of this.dirs) yield [name, d];
    for (const [name, f] of this.files) yield [name, f];
  }
}

export function makeFakeRoot(): FakeDirHandle {
  return new FakeDirHandle();
}

// ---- Fake IndexedDB (v4: projects/plugins/runs/trustedKeys/fileChunks/opfsMigration)

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
    this.rows = [...rows].sort((a, b) =>
      a.key === b.key ? 0 : String(a.key) < String(b.key) ? -1 : 1,
    );
    this.direction = direction;
    this.store = store;
    this.result = null;
    queueMicrotask(() => {
      this.open();
      this.onsuccess?.();
    });
  }

  open(): void {
    const ordered = this.direction === 'prev' ? [...this.rows].reverse() : this.rows;
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

  createObjectStore(name: string, opts: { keyPath: string }): FakeObjectStore {
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

export function installFakeIndexedDB(): void {
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
      if (version >= 3 && !db.objectStoreNames.contains('trustedKeys')) {
        db.createObjectStore('trustedKeys', { keyPath: 'fingerprint' });
      }
      if (version >= 4 && !db.objectStoreNames.contains('fileChunks')) {
        const chunks = db.createObjectStore('fileChunks', { keyPath: 'id' });
        chunks.createIndex('fileId', 'fileId');
      }
      if (version >= 4 && !db.objectStoreNames.contains('opfsMigration')) {
        db.createObjectStore('opfsMigration', { keyPath: 'id' });
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

export function uninstallFakeIndexedDB(): void {
  const g = globalThis as unknown as { indexedDB?: unknown };
  delete g.indexedDB;
}
