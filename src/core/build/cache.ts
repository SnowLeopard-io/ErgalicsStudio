// ==========================================================================
// Ergalics Studio — build cache stores (pure TS + IndexedDB)
//
// Two implementations behind one interface:
//   • MemoryBuildCache — bounded LRU, used in tests and as the automatic
//     fallback when IndexedDB is unavailable (private mode, quota denial).
//   • IndexedDbBuildCache — a *separate* database (`ergalics-build-cache`) so
//     cache churn never touches the project database, its schema version or
//     its migrations. Entries are content-addressed: the key is the hash, so
//     the same value computed in two projects is stored once.
//
// `createBuildCache` returns a resilient wrapper: the first persistent error
// degrades the session to memory instead of failing the run.
// ==========================================================================

import { estimateEncodedSize, type EncodedValue } from './codec';

export interface CacheEntry {
  key: string;
  value: EncodedValue;
  createdAt: number;
  lastUsed: number;
  sizeBytes: number;
  /** Human label for diagnostics (step kind/id), never part of the key. */
  label?: string;
}

export interface BuildCacheStats {
  entries: number;
  bytes: number;
  maxEntries: number;
  maxBytes: number;
  /** True when entries survive a reload (IndexedDB), false for memory. */
  persistent: boolean;
  /** True when a persistent store was requested but failed and degraded. */
  degraded?: boolean;
}

export interface BuildCache {
  get(key: string): Promise<CacheEntry | undefined>;
  /** Cheap existence probe for dry-run previews (no decode / no LRU bump). */
  has(key: string): Promise<boolean>;
  /** All keys currently stored, for portable cache snapshots. */
  keys(): Promise<string[]>;
  put(entry: { key: string; value: EncodedValue; label?: string }): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  stats(): Promise<BuildCacheStats>;
  close?(): Promise<void>;
}

export interface CacheLimits {
  maxEntries: number;
  maxBytes: number;
  /** Single entries larger than this are not persisted (they would evict
   *  everything else for one value). */
  maxEntryBytes: number;
}

const DEFAULT_LIMITS: CacheLimits = {
  maxEntries: 20_000,
  maxBytes: 512 * 1024 * 1024,
  maxEntryBytes: 128 * 1024 * 1024,
};

function normalizeLimits(limits: Partial<CacheLimits> | undefined): CacheLimits {
  return {
    maxEntries: Math.max(1, limits?.maxEntries ?? DEFAULT_LIMITS.maxEntries),
    maxBytes: Math.max(1, limits?.maxBytes ?? DEFAULT_LIMITS.maxBytes),
    maxEntryBytes: Math.max(1, limits?.maxEntryBytes ?? DEFAULT_LIMITS.maxEntryBytes),
  };
}

export class MemoryBuildCache implements BuildCache {
  private readonly map = new Map<string, CacheEntry>();
  private bytes = 0;
  private readonly limits: CacheLimits;

  constructor(limits?: Partial<CacheLimits>) {
    this.limits = normalizeLimits(limits);
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    entry.lastUsed = Date.now();
    // Map preserves insertion order; re-inserting makes LRU eviction O(1).
    this.map.delete(key);
    this.map.set(key, entry);
    return entry;
  }

  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }

  async keys(): Promise<string[]> {
    return [...this.map.keys()];
  }

  async put(entry: { key: string; value: EncodedValue; label?: string }): Promise<void> {
    const sizeBytes = estimateEncodedSize(entry.value);
    if (sizeBytes > this.limits.maxEntryBytes) return;
    const previous = this.map.get(entry.key);
    if (previous) {
      this.bytes -= previous.sizeBytes;
      this.map.delete(entry.key);
    }
    const now = Date.now();
    this.map.set(entry.key, {
      key: entry.key,
      value: entry.value,
      createdAt: previous?.createdAt ?? now,
      lastUsed: now,
      sizeBytes,
      ...(entry.label !== undefined ? { label: entry.label } : {}),
    });
    this.bytes += sizeBytes;
    this.evict();
  }

  async delete(key: string): Promise<void> {
    const entry = this.map.get(key);
    if (!entry) return;
    this.bytes -= entry.sizeBytes;
    this.map.delete(key);
  }

  async clear(): Promise<void> {
    this.map.clear();
    this.bytes = 0;
  }

  async stats(): Promise<BuildCacheStats> {
    return {
      entries: this.map.size,
      bytes: this.bytes,
      maxEntries: this.limits.maxEntries,
      maxBytes: this.limits.maxBytes,
      persistent: false,
    };
  }

  private evict(): void {
    while (
      this.map.size > this.limits.maxEntries ||
      (this.bytes > this.limits.maxBytes && this.map.size > 1)
    ) {
      const oldest = this.map.keys().next();
      if (oldest.done) return;
      const entry = this.map.get(oldest.value);
      if (entry) this.bytes -= entry.sizeBytes;
      this.map.delete(oldest.value);
    }
  }
}

// ---- IndexedDB ------------------------------------------------------------

const STORE_ENTRIES = 'entries';
const IDX_LAST_USED = 'lastUsed';

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export class IndexedDbBuildCache implements BuildCache {
  private readonly dbName: string;
  private readonly limits: CacheLimits;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly touching = new Set<string>();

  constructor(options?: { dbName?: string } & Partial<CacheLimits>) {
    this.dbName = options?.dbName ?? 'ergalics-build-cache';
    this.limits = normalizeLimits(options);
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
          const store = db.createObjectStore(STORE_ENTRIES, { keyPath: 'key' });
          store.createIndex(IDX_LAST_USED, 'lastUsed');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('cannot open build cache database'));
      request.onblocked = () => reject(new Error('build cache database upgrade blocked'));
    }).catch((err) => {
      // Never cache a rejected open: a transient failure must not poison the
      // session (mirrors core/storage.ts).
      this.dbPromise = null;
      throw err;
    });
    this.dbPromise = promise;
    return promise;
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const db = await this.open();
    const tx = db.transaction(STORE_ENTRIES, 'readonly');
    const entry = await requestResult(
      tx.objectStore(STORE_ENTRIES).get(key) as IDBRequest<CacheEntry | undefined>,
    );
    if (entry) this.touch(entry);
    return entry;
  }

  /** Count-only probe; avoids shipping a potentially huge value to the UI. */
  async has(key: string): Promise<boolean> {
    const db = await this.open();
    const tx = db.transaction(STORE_ENTRIES, 'readonly');
    const count = await requestResult(tx.objectStore(STORE_ENTRIES).count(key));
    return count > 0;
  }

  async keys(): Promise<string[]> {
    const db = await this.open();
    const tx = db.transaction(STORE_ENTRIES, 'readonly');
    return requestResult(tx.objectStore(STORE_ENTRIES).getAllKeys() as IDBRequest<IDBValidKey[]>).then(
      (keys) => keys.filter((key): key is string => typeof key === 'string'),
    );
  }

  /** Fire-and-forget LRU bump; a failed touch must never fail a cache read. */
  private touch(entry: CacheEntry): void {
    if (this.touching.has(entry.key)) return;
    this.touching.add(entry.key);
    entry.lastUsed = Date.now();
    void (async () => {
      try {
        const db = await this.open();
        const tx = db.transaction(STORE_ENTRIES, 'readwrite');
        tx.objectStore(STORE_ENTRIES).put(entry);
        await transactionDone(tx);
      } catch {
        // Best-effort only.
      } finally {
        this.touching.delete(entry.key);
      }
    })();
  }

  async put(entry: { key: string; value: EncodedValue; label?: string }): Promise<void> {
    const sizeBytes = estimateEncodedSize(entry.value);
    if (sizeBytes > this.limits.maxEntryBytes) return;
    const db = await this.open();
    const now = Date.now();
    const stored: CacheEntry = {
      key: entry.key,
      value: entry.value,
      createdAt: now,
      lastUsed: now,
      sizeBytes,
      ...(entry.label !== undefined ? { label: entry.label } : {}),
    };
    const tx = db.transaction(STORE_ENTRIES, 'readwrite');
    tx.objectStore(STORE_ENTRIES).put(stored);
    await transactionDone(tx);
    await this.evictIfNeeded();
  }

  async delete(key: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_ENTRIES, 'readwrite');
    tx.objectStore(STORE_ENTRIES).delete(key);
    await transactionDone(tx);
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(STORE_ENTRIES, 'readwrite');
    tx.objectStore(STORE_ENTRIES).clear();
    await transactionDone(tx);
  }

  async stats(): Promise<BuildCacheStats> {
    const db = await this.open();
    const tx = db.transaction(STORE_ENTRIES, 'readonly');
    const store = tx.objectStore(STORE_ENTRIES);
    // One cursor pass yields both count and bytes; a second request on the
    // same read transaction could race its auto-commit.
    const summary = await new Promise<{ entries: number; bytes: number }>((resolve, reject) => {
      let entries = 0;
      let bytes = 0;
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve({ entries, bytes });
          return;
        }
        const entry = cursor.value as CacheEntry;
        entries += 1;
        bytes += entry.sizeBytes ?? 0;
        cursor.continue();
      };
      cursorRequest.onerror = () =>
        reject(cursorRequest.error ?? new Error('build cache stats cursor failed'));
    });
    return {
      entries: summary.entries,
      bytes: summary.bytes,
      maxEntries: this.limits.maxEntries,
      maxBytes: this.limits.maxBytes,
      persistent: true,
    };
  }

  async close(): Promise<void> {
    const db = await this.dbPromise?.catch(() => undefined);
    db?.close();
    this.dbPromise = null;
  }

  /** Drop the oldest entries until the count fits the configured limit. */
  private async evictIfNeeded(): Promise<void> {
    const db = await this.open();
    const countTx = db.transaction(STORE_ENTRIES, 'readonly');
    const count = await requestResult(countTx.objectStore(STORE_ENTRIES).count());
    let excess = count - this.limits.maxEntries;
    if (excess <= 0) return;

    const tx = db.transaction(STORE_ENTRIES, 'readwrite');
    const index = tx.objectStore(STORE_ENTRIES).index(IDX_LAST_USED);
    const cursorRequest = index.openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor || excess <= 0) return;
      cursor.delete();
      excess -= 1;
      cursor.continue();
    };
    await transactionDone(tx);
  }
}

/** Persistently delete a build-cache database (tests / "clear cache" UI). */
export async function deleteBuildCacheDatabase(dbName = 'ergalics-build-cache'): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error('cannot delete build cache database'));
    request.onblocked = () => resolve();
  });
}

/**
 * Wraps a persistent cache and degrades to memory on the first hard failure
 * (private mode, quota, blocked upgrade). Once degraded, the run keeps going
 * — a cache is an optimisation, never a correctness dependency.
 */
class ResilientBuildCache implements BuildCache {
  private primary: BuildCache | null;
  private readonly fallback: MemoryBuildCache;
  private degraded = false;

  constructor(primary: BuildCache, fallback: MemoryBuildCache) {
    this.primary = primary;
    this.fallback = fallback;
  }

  private degrade(): void {
    this.degraded = true;
    this.primary = null;
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    if (this.primary) {
      try {
        const hit = await this.primary.get(key);
        if (hit) return hit;
      } catch {
        this.degrade();
      }
    }
    return this.fallback.get(key);
  }

  async has(key: string): Promise<boolean> {
    if (this.primary) {
      try {
        return await this.primary.has(key);
      } catch {
        this.degrade();
      }
    }
    return this.fallback.has(key);
  }

  async keys(): Promise<string[]> {
    if (this.primary) {
      try {
        return await this.primary.keys();
      } catch {
        this.degrade();
      }
    }
    return this.fallback.keys();
  }

  async put(entry: { key: string; value: EncodedValue; label?: string }): Promise<void> {
    if (this.primary) {
      try {
        await this.primary.put(entry);
        return;
      } catch {
        this.degrade();
      }
    }
    await this.fallback.put(entry);
  }

  async delete(key: string): Promise<void> {
    if (this.primary) {
      try {
        await this.primary.delete(key);
      } catch {
        this.degrade();
      }
    }
    await this.fallback.delete(key);
  }

  async clear(): Promise<void> {
    if (this.primary) {
      try {
        await this.primary.clear();
      } catch {
        this.degrade();
      }
    }
    await this.fallback.clear();
  }

  async stats(): Promise<BuildCacheStats> {
    if (this.primary) {
      try {
        return { ...(await this.primary.stats()), degraded: this.degraded };
      } catch {
        this.degrade();
      }
    }
    const stats = await this.fallback.stats();
    return { ...stats, degraded: this.degraded };
  }

  async close(): Promise<void> {
    const closing = this.primary?.close?.();
    if (closing) await closing.catch(() => undefined);
    this.primary = null;
  }
}

/**
 * Pick the best available cache. `persistent: false` forces memory (tests,
 * private-mode fallback); otherwise IndexedDB if the platform provides it.
 */
export function createBuildCache(options?: {
  persistent?: boolean;
  dbName?: string;
  limits?: Partial<CacheLimits>;
}): BuildCache {
  const limits = normalizeLimits(options?.limits);
  const memory = new MemoryBuildCache(limits);
  if (options?.persistent === false || typeof indexedDB === 'undefined') return memory;
  const primary = new IndexedDbBuildCache({
    ...(options?.dbName !== undefined ? { dbName: options.dbName } : {}),
    ...limits,
  });
  return new ResilientBuildCache(primary, memory);
}
