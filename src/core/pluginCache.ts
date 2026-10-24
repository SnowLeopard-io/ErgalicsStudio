// ==========================================================================
// Plugin-scoped intermediate-result cache
// ==========================================================================
//
// Plugins repeatedly recompute the same expensive intermediate state across
// a session: a parsed large CSV, a normalized grid, a converged layout. This
// module gives every plugin a small, bounded scratch space keyed by plugin
// id so those results can be memoized without leaking into project state.
//
// Design constraints:
// - **Bounded.** Each plugin gets a fixed entry cap (default 32) with LRU
//   eviction, so a plugin that caches per-frame data cannot exhaust memory.
// - **Expirable.** `set(key, value, ttlMs)` supports time-boxed entries for
//   results that go stale (e.g. derived from a file that may be re-imported).
// - **Releasable.** `dispose(pluginId)` is called from `pluginStore.unload`,
//   otherwise every unloaded plugin's cache would live until reload.
// - **Async.** The same surface is exposed inside the isolated worker
//   sandbox over the RPC bridge, so it must be await-able everywhere.
//
// The cache is intentionally *not* persisted: anything that must survive a
// reload belongs in `api.setParam` (project state), not here.

import type { PluginCacheApi } from '@/types/plugin';

interface CacheEntry {
  value: unknown;
  /** Epoch ms after which the entry is treated as missing; `null` = forever. */
  expiresAt: number | null;
}

/** Per-plugin entry cap. Chosen to cover "a handful of derived results". */
export const DEFAULT_PLUGIN_CACHE_ENTRIES = 32;

/** One map per plugin id; `Map` iteration order gives us LRU for free. */
const stores = new Map<string, Map<string, CacheEntry>>();
const caps = new Map<string, number>();

function storeFor(pluginId: string): Map<string, CacheEntry> {
  let store = stores.get(pluginId);
  if (!store) {
    store = new Map();
    stores.set(pluginId, store);
  }
  return store;
}

function capFor(pluginId: string): number {
  return caps.get(pluginId) ?? DEFAULT_PLUGIN_CACHE_ENTRIES;
}

function expired(entry: CacheEntry, now: number): boolean {
  return entry.expiresAt !== null && entry.expiresAt <= now;
}

function evictToCap(pluginId: string): void {
  const store = storeFor(pluginId);
  const cap = capFor(pluginId);
  // Delete the oldest (first-inserted) keys until we are back under the cap.
  while (store.size > cap) {
    const oldest = store.keys().next();
    if (oldest.done) break;
    store.delete(oldest.value);
  }
}

/**
 * Create the cache handle handed to a plugin through `PluginApi.cache`.
 * Repeated calls for the same id return handles over the same store.
 */
export function createPluginCache(pluginId: string): PluginCacheApi {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const store = storeFor(pluginId);
      const entry = store.get(key);
      if (!entry) return undefined;
      if (expired(entry, Date.now())) {
        store.delete(key);
        return undefined;
      }
      // Re-insert so the entry becomes the most recently used.
      store.delete(key);
      store.set(key, entry);
      return entry.value as T;
    },
    async set(key: string, value: unknown, ttlMs?: number): Promise<void> {
      const store = storeFor(pluginId);
      const expiresAt =
        typeof ttlMs === 'number' && Number.isFinite(ttlMs) && ttlMs > 0
          ? Date.now() + ttlMs
          : null;
      // Refreshing an existing key must also refresh its LRU position.
      store.delete(key);
      store.set(key, { value, expiresAt });
      evictToCap(pluginId);
    },
    async delete(key: string): Promise<boolean> {
      return storeFor(pluginId).delete(key);
    },
    async clear(): Promise<void> {
      storeFor(pluginId).clear();
    },
    async keys(): Promise<string[]> {
      const store = storeFor(pluginId);
      const now = Date.now();
      const live: string[] = [];
      for (const [key, entry] of store) {
        if (expired(entry, now)) store.delete(key);
        else live.push(key);
      }
      return live;
    },
  };
}

/** Override the entry cap for one plugin (e.g. a known-heavy plugin). */
export function setPluginCacheCap(pluginId: string, cap: number): void {
  caps.set(pluginId, Math.max(1, Math.floor(cap)));
  evictToCap(pluginId);
}

/**
 * Release a plugin's cache. Called from `pluginStore.unload` — without it a
 * session that installs and removes many plugins accumulates dead entries.
 */
export function disposePluginCache(pluginId: string): void {
  stores.delete(pluginId);
  caps.delete(pluginId);
}

/** Drop every cache (used by "clear cache" style actions and by tests). */
export function clearAllPluginCaches(): void {
  stores.clear();
  caps.clear();
}
