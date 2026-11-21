import { describe, expect, it } from 'vitest';
import {
  BUILD_CACHE_BUNDLE_SCHEMA,
  bundleDigest,
  cacheBundleToJson,
  exportCacheBundle,
  importCacheBundle,
  verifyCacheBundle,
  type BuildCacheBundle,
} from '@/core/build/bundle';
import { MemoryBuildCache } from '@/core/build/cache';
import { decodeDataValue, encodeDataValue } from '@/core/build/codec';
import type { DataValue } from '@/types/datatable';

function scalar(value: number): DataValue {
  return { kind: 'scalar', value };
}

async function seeded(cache: MemoryBuildCache): Promise<void> {
  await cache.put({ key: 'key-a', value: encodeDataValue(scalar(1))!, label: 'source:a' });
  await cache.put({ key: 'key-b', value: encodeDataValue(scalar(2))!, label: 'transform:b' });
}

const ENV = 'env-abcdef';

describe('portable build-cache bundles', () => {
  it('round-trips entries into another cache with values intact', async () => {
    const source = new MemoryBuildCache();
    await seeded(source);
    const bundle = await exportCacheBundle(source, { environment: ENV, createdAt: 7 });
    expect(bundle.schema).toBe(BUILD_CACHE_BUNDLE_SCHEMA);
    expect(bundle.totals.entries).toBe(2);
    expect(bundle.entries.map((e) => e.key)).toEqual(['key-a', 'key-b']);
    expect(bundleDigest(bundle)).toBe(bundle.digest);

    const target = new MemoryBuildCache();
    const result = await importCacheBundle(target, cacheBundleToJson(bundle), {
      expectedEnvironment: ENV,
    });
    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(2);
    const decoded = decodeDataValue((await target.get('key-b'))!.value);
    expect(decoded).toEqual(scalar(2));
  });

  it('rejects a tampered entry value and a tampered manifest digest', async () => {
    const source = new MemoryBuildCache();
    await seeded(source);
    const bundle = await exportCacheBundle(source, { environment: ENV });

    const brokenEntry = JSON.parse(cacheBundleToJson(bundle)) as BuildCacheBundle;
    brokenEntry.entries[0]!.value = encodeDataValue(scalar(999))!;
    const entryCheck = verifyCacheBundle(brokenEntry);
    expect(entryCheck.ok).toBe(false);
    expect(entryCheck.issues).toContain('entry digest mismatch: key-a');

    const brokenManifest = JSON.parse(cacheBundleToJson(bundle)) as BuildCacheBundle;
    brokenManifest.entries.reverse();
    const manifestCheck = verifyCacheBundle(brokenManifest);
    expect(manifestCheck.ok).toBe(false);
    expect(manifestCheck.issues).toContain('manifest digest mismatch');
  });

  it('refuses a foreign environment unless explicitly allowed', async () => {
    const source = new MemoryBuildCache();
    await seeded(source);
    const json = cacheBundleToJson(
      await exportCacheBundle(source, { environment: 'other-env' }),
    );
    const target = new MemoryBuildCache();
    const blocked = await importCacheBundle(target, json, { expectedEnvironment: ENV });
    expect(blocked.imported).toBe(0);
    expect(blocked.environment).toBe('other-env');
    expect(blocked.errors[0]).toContain('environment mismatch');

    const allowed = await importCacheBundle(target, json, {
      expectedEnvironment: ENV,
      allowForeignEnvironment: true,
    });
    expect(allowed.imported).toBe(2);
  });

  it('reports invalid JSON and non-bundles without throwing', async () => {
    const target = new MemoryBuildCache();
    const invalid = await importCacheBundle(target, '{not json');
    expect(invalid.errors[0]).toContain('invalid JSON');
    const wrong = await importCacheBundle(target, { hello: 'world' });
    expect(wrong.imported).toBe(0);
    expect(wrong.errors).toContain('unsupported schema: undefined');
  });

  it('honours export limits', async () => {
    const source = new MemoryBuildCache();
    await seeded(source);
    const one = await exportCacheBundle(source, { environment: ENV, maxEntries: 1 });
    expect(one.entries).toHaveLength(1);
    expect(one.totals.entries).toBe(1);
    expect(one.digest).toBe(bundleDigest(one));
  });
});
