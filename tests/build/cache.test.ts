import { afterEach, describe, expect, it } from 'vitest';
import {
  IndexedDbBuildCache,
  MemoryBuildCache,
  createBuildCache,
  deleteBuildCacheDatabase,
} from '@/core/build/cache';

const scalar = { kind: 'scalar', value: 1 } as const;

describe('MemoryBuildCache', () => {
  it('stores, counts and evicts least-recently-used entries', async () => {
    const cache = new MemoryBuildCache({ maxEntries: 2, maxBytes: 10_000 });
    await cache.put({ key: 'a', value: scalar });
    await cache.put({ key: 'b', value: scalar });
    await cache.get('a'); // bump a
    await cache.put({ key: 'c', value: scalar });
    expect(await cache.get('b')).toBeUndefined();
    expect(await cache.get('a')).toBeDefined();
    expect(await cache.get('c')).toBeDefined();
    const stats = await cache.stats();
    expect(stats.entries).toBe(2);
    expect(stats.persistent).toBe(false);
    await cache.delete('a');
    expect((await cache.stats()).entries).toBe(1);
    await cache.clear();
    expect((await cache.stats()).entries).toBe(0);
  });

  it('enforces the byte budget', async () => {
    const cache = new MemoryBuildCache({ maxEntries: 100, maxBytes: 50 });
    await cache.put({ key: 'a', value: scalar });
    await cache.put({ key: 'b', value: scalar });
    expect((await cache.stats()).bytes).toBeLessThanOrEqual(50);
  });

  it('skips single entries larger than maxEntryBytes', async () => {
    const cache = new MemoryBuildCache({ maxEntryBytes: 1 });
    await cache.put({ key: 'big', value: scalar });
    expect(await cache.get('big')).toBeUndefined();
  });
});

describe('IndexedDbBuildCache', () => {
  const dbName = `ergalics-build-cache-test-${Math.random().toString(36).slice(2)}`;

  afterEach(async () => {
    await deleteBuildCacheDatabase(dbName);
  });

  it('persists entries across store instances', async () => {
    const first = new IndexedDbBuildCache({ dbName });
    await first.put({ key: 'k', value: scalar, label: 'src:a' });
    const hit = await first.get('k');
    expect(hit?.value).toEqual(scalar);
    expect(hit?.label).toBe('src:a');
    await first.close();

    const second = new IndexedDbBuildCache({ dbName });
    expect((await second.get('k'))?.value).toEqual(scalar);
    expect((await second.stats()).entries).toBe(1);
    expect((await second.stats()).persistent).toBe(true);
    await second.clear();
    expect(await second.get('k')).toBeUndefined();
    await second.close();
  });

  it('evicts the oldest entries over maxEntries', async () => {
    const cache = new IndexedDbBuildCache({ dbName, maxEntries: 2 });
    await cache.put({ key: 'a', value: scalar });
    await cache.put({ key: 'b', value: scalar });
    await cache.put({ key: 'c', value: scalar });
    expect((await cache.stats()).entries).toBeLessThanOrEqual(2);
    await cache.close();
  });

  it('factory falls back to memory when persistence is disabled', async () => {
    const cache = createBuildCache({ persistent: false });
    expect((await cache.stats()).persistent).toBe(false);
    await cache.put({ key: 'x', value: scalar });
    expect(await cache.get('x')).toBeDefined();
  });
});
