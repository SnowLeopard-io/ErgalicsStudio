// ==========================================================================
// Ergalics Studio — portable build-cache bundles (pure TS)
//
// Cache entries are content addresses: `key = H(kind, params, upstream keys,
// environment)`. That makes them safe to move between devices — a value is
// only reused when every input that produced it is identical. This module
// freezes a set of entries into a JSON snapshot with two integrity layers:
//
//   • each entry carries a digest of its encoded value, so a corrupted value
//     cannot be mistaken for the computation its key claims to represent;
//   • the bundle carries a digest over (schema, environment, all entry keys
//     and digests), so the manifest itself cannot be edited unnoticed.
//
// Import rejects bundles produced under a different environment fingerprint
// unless explicitly overridden — a key computed by another app version can
// be perfectly valid JSON and still be the wrong answer for this build.
// ==========================================================================

import type { BuildCache } from './cache';
import { decodeDataValue, type EncodedValue } from './codec';
import { hashValue } from './hash';

export const BUILD_CACHE_BUNDLE_SCHEMA = 'ergalics.build-cache-bundle/v1';

export interface CacheBundleEntry {
  key: string;
  value: EncodedValue;
  /** Human label for diagnostics; not part of the key or any digest. */
  label?: string;
  /** Digest of the encoded value (never of runtime metadata). */
  digest: string;
  sizeBytes: number;
}

export interface BuildCacheBundle {
  schema: string;
  /** Wall-clock export time; excluded from the digest. */
  createdAt: number;
  /** Environment fingerprint of the exporter. */
  environment: string;
  entries: CacheBundleEntry[];
  totals: { entries: number; bytes: number };
  digest: string;
}

/** Deterministic digest over the manifest — excludes `createdAt` and labels. */
export function bundleDigest(
  bundle: Omit<BuildCacheBundle, 'digest'>,
): string {
  return hashValue({
    schema: bundle.schema,
    environment: bundle.environment,
    entries: bundle.entries.map((entry) => ({ key: entry.key, digest: entry.digest })),
  });
}

export interface ExportCacheOptions {
  /** Environment fingerprint to stamp on the bundle. */
  environment: string;
  createdAt?: number;
  maxEntries?: number;
  maxBytes?: number;
}

/** Snapshot the cache into a deterministic, verifiable JSON structure. */
export async function exportCacheBundle(
  cache: BuildCache,
  options: ExportCacheOptions,
): Promise<BuildCacheBundle> {
  const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 20_000));
  const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? 128 * 1024 * 1024));
  const keys = await cache.keys();
  const entries: CacheBundleEntry[] = [];
  let bytes = 0;
  for (const key of keys) {
    if (entries.length >= maxEntries || bytes >= maxBytes) break;
    const entry = await cache.get(key);
    if (!entry) continue;
    const sizeBytes = entry.sizeBytes > 0 ? entry.sizeBytes : 0;
    if (bytes + sizeBytes > maxBytes && entries.length > 0) break;
    entries.push({
      key: entry.key,
      value: entry.value,
      ...(entry.label !== undefined ? { label: entry.label } : {}),
      digest: hashValue(entry.value),
      sizeBytes,
    });
    bytes += sizeBytes;
  }
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  const unsigned: Omit<BuildCacheBundle, 'digest'> = {
    schema: BUILD_CACHE_BUNDLE_SCHEMA,
    createdAt: options.createdAt ?? Date.now(),
    environment: options.environment,
    entries,
    totals: { entries: entries.length, bytes },
  };
  return { ...unsigned, digest: bundleDigest(unsigned) };
}

export function cacheBundleToJson(bundle: BuildCacheBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export interface BundleVerification {
  ok: boolean;
  issues: string[];
}

/** Structural + digest verification of a parsed bundle. */
export function verifyCacheBundle(value: unknown): BundleVerification {
  if (value === null || typeof value !== 'object') {
    return { ok: false, issues: ['bundle is not an object'] };
  }
  const bundle = value as Partial<BuildCacheBundle>;
  const issues: string[] = [];
  if (bundle.schema !== BUILD_CACHE_BUNDLE_SCHEMA) {
    issues.push(`unsupported schema: ${String(bundle.schema)}`);
  }
  if (!Array.isArray(bundle.entries)) {
    issues.push('missing entries');
  }
  if (typeof bundle.environment !== 'string' || bundle.environment.length === 0) {
    issues.push('missing environment fingerprint');
  }
  if (typeof bundle.digest !== 'string' || bundle.digest.length === 0) {
    issues.push('missing digest');
  }
  if (issues.length > 0) return { ok: false, issues };

  const entries = bundle.entries as CacheBundleEntry[];
  for (const entry of entries) {
    if (typeof entry.key !== 'string' || entry.key.length === 0) {
      issues.push('entry with empty key');
      continue;
    }
    if (typeof entry.digest !== 'string' || entry.digest !== hashValue(entry.value)) {
      issues.push(`entry digest mismatch: ${entry.key}`);
    }
  }
  const { digest: _digest, ...rest } = bundle as BuildCacheBundle;
  if (bundleDigest(rest) !== bundle.digest) {
    issues.push('manifest digest mismatch');
  }
  return { ok: issues.length === 0, issues };
}

export interface ImportCacheOptions {
  /** Reject bundles stamped with another environment (default: true). */
  expectedEnvironment?: string;
  /** Explicitly allow foreign environments. */
  allowForeignEnvironment?: boolean;
  maxEntries?: number;
  maxBytes?: number;
}

export interface ImportCacheResult {
  examined: number;
  imported: number;
  skipped: number;
  errors: string[];
  environment: string;
}

/** Parse, verify and merge a bundle into a cache. Bad entries are skipped. */
export async function importCacheBundle(
  cache: BuildCache,
  source: string | unknown,
  options: ImportCacheOptions = {},
): Promise<ImportCacheResult> {
  let parsed: unknown = source;
  if (typeof source === 'string') {
    try {
      parsed = JSON.parse(source) as unknown;
    } catch (err) {
      return {
        examined: 0,
        imported: 0,
        skipped: 0,
        environment: '',
        errors: [`invalid JSON: ${err instanceof Error ? err.message : String(err)}`],
      };
    }
  }
  const verification = verifyCacheBundle(parsed);
  if (!verification.ok) {
    const environment =
      parsed !== null && typeof parsed === 'object'
        ? String((parsed as BuildCacheBundle).environment ?? '')
        : '';
    return { examined: 0, imported: 0, skipped: 0, environment, errors: verification.issues };
  }
  const bundle = parsed as BuildCacheBundle;
  const expected = options.expectedEnvironment;
  if (
    expected !== undefined &&
    bundle.environment !== expected &&
    options.allowForeignEnvironment !== true
  ) {
    return {
      examined: bundle.entries.length,
      imported: 0,
      skipped: bundle.entries.length,
      environment: bundle.environment,
      errors: [
        `environment mismatch: bundle ${bundle.environment.slice(0, 16)} vs local ${expected.slice(0, 16)}`,
      ],
    };
  }

  const result: ImportCacheResult = {
    examined: bundle.entries.length,
    imported: 0,
    skipped: 0,
    errors: [],
    environment: bundle.environment,
  };
  let bytes = 0;
  const maxBytes = Math.max(1, Math.floor(options.maxBytes ?? 128 * 1024 * 1024));
  const maxEntries = Math.max(0, Math.floor(options.maxEntries ?? 20_000));
  for (const entry of bundle.entries) {
    if (result.imported >= maxEntries || bytes + entry.sizeBytes > maxBytes) {
      result.skipped += 1;
      continue;
    }
    try {
      // A decodable value is the minimum proof that the bytes really are a
      // DataValue, not arbitrary JSON placed under a plausible key.
      decodeDataValue(entry.value);
      await cache.put({ key: entry.key, value: entry.value, label: entry.label });
      result.imported += 1;
      bytes += entry.sizeBytes;
    } catch (err) {
      result.skipped += 1;
      result.errors.push(`${entry.key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
