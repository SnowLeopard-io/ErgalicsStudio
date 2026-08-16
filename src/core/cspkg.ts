// ==========================================================================
// .cspkg plugin package loader (spec §6.3)
// Format: ZIP archive containing manifest.json + dist/ + assets/
// ==========================================================================

import { unzipSync, strFromU8 } from 'fflate';
import { logger } from './logger';
import type { Plugin, PluginManifest, PluginApi } from '@/types/plugin';
import { savePluginPackage, type StoredPluginPackage } from './storage';
import { createPluginSandbox, evaluatePluginLegacy } from './sandbox';

// Object URLs created for a stored package, keyed by plugin id, so they can
// be revoked when the package is re-installed or uninstalled.
const urlRegistry = new Map<string, string[]>();

function trackUrls(id: string, urls: string[]) {
  const previous = urlRegistry.get(id);
  if (previous) {
    for (const url of previous) URL.revokeObjectURL(url);
  }
  urlRegistry.set(id, urls);
}

/**
 * Revoke all Blob URLs held for a stored plugin package. Call this when a
 * plugin package is uninstalled so long-lived object URLs are released.
 */
export function revokeCspkgUrls(id: string) {
  const urls = urlRegistry.get(id);
  if (!urls) return;
  for (const url of urls) URL.revokeObjectURL(url);
  urlRegistry.delete(id);
}

const REQUIRED_MANIFEST_FIELDS = ['id', 'entry', 'name', 'version'] as const;

/** Hard caps against zip-bomb / oversized archives. The input size is bounded
 *  up front and the central directory is scanned (without decompressing) so
 *  entry count and total uncompressed size are enforced *before* `unzipSync`
 *  materializes the tree in memory. */
const MAX_PACKAGE_BYTES = 16 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 512;

/** Keys that would shadow Object.prototype members on the plain object that
 *  `unzipSync` builds. Even though the loader rebuilds into a null-prototype
 *  map, a hostile archive must not be able to corrupt the intermediate object
 *  or the parsed manifest's prototype chain. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

interface ZipEntryMeta {
  /** Entry name with backslashes already normalized to `/`. */
  name: string;
  /** Uncompressed size from the central directory. */
  size: number;
}

/** Lightweight ZIP central-directory scan. Reads the End-Of-Central-Directory
 *  record plus every central-directory entry — names and uncompressed sizes
 *  only — so caps can be enforced without decompressing the archive. Throws
 *  on structural corruption (missing EOCD, truncated central directory). */
function scanZipCentralDirectory(buffer: ArrayBuffer): ZipEntryMeta[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // EOCD signature 0x06054b50; scan backwards so a trailing archive comment
  // cannot mask the real record (the last occurrence wins).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('missing end-of-central-directory record');

  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (cdOffset + cdSize > bytes.length) {
    throw new Error('central directory out of bounds');
  }

  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntryMeta[] = [];
  let pos = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (pos + 46 > bytes.length || view.getUint32(pos, true) !== 0x02014b50) {
      throw new Error('malformed central directory entry');
    }
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const size = view.getUint32(pos + 24, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen)).replace(/\\/g, '/');
    entries.push({ name, size });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Reject malformed package ids / entry paths early (path traversal guard). */
function validateManifest(manifest: PluginManifest): void {
  for (const field of REQUIRED_MANIFEST_FIELDS) {
    if (!manifest[field]) {
      throw new Error(`cspkg: manifest missing required field "${field}"`);
    }
  }
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(manifest.id)) {
    throw new Error(`cspkg: invalid plugin id "${manifest.id}"`);
  }
  if (manifest.entry.includes('..') || manifest.entry.startsWith('/') || /^[a-zA-Z]:/.test(manifest.entry)) {
    throw new Error(`cspkg: entry path must be a package-relative path, got "${manifest.entry}"`);
  }
  // Archives may store keys with backslashes (zip entries from Windows
  // tooling) or a leading "./"; normalize so the manifest entry always
  // resolves against the normalized file keys.
  manifest.entry = manifest.entry.replace(/\\/g, '/').replace(/^\.\//, '');
  if (manifest.sandbox !== undefined && manifest.sandbox !== 'isolated' && manifest.sandbox !== 'trusted') {
    throw new Error(`cspkg: unknown sandbox mode "${String(manifest.sandbox)}"`);
  }
}

/** Rebuild the unzipped file map with normalized, validated keys. Zip entries
 *  written by Windows tooling may use backslashes, so keys are normalized to
 *  `/`; traversal (`..`) and absolute paths are dropped, as are keys that
 *  would shadow Object.prototype members. The map is null-prototype so even a
 *  surviving hostile key cannot corrupt lookups. */
function normalizeFileKeys(files: Record<string, Uint8Array>): Record<string, Uint8Array> {
  const normalized: Record<string, Uint8Array> = Object.create(null) as Record<string, Uint8Array>;
  for (const [key, data] of Object.entries(files)) {
    const name = key.replace(/\\/g, '/').replace(/^\.\//, '');
    if (name.length === 0 || name.includes('..') || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) {
      continue;
    }
    if (DANGEROUS_KEYS.has(name)) continue;
    normalized[name] = data;
  }
  return normalized;
}

export async function parseCspkg(buffer: ArrayBuffer): Promise<{
  manifest: PluginManifest;
  files: Record<string, Uint8Array>;
}> {
  // Reject oversized archives before decompressing (zip-bomb defense).
  if (buffer.byteLength > MAX_PACKAGE_BYTES) {
    throw new Error(`cspkg: package exceeds ${Math.round(MAX_PACKAGE_BYTES / 1024 / 1024)} MB limit`);
  }

  // Pre-flight the central directory so a decompression bomb is rejected
  // *before* unzipSync materializes the whole tree in memory.
  let entries: ZipEntryMeta[];
  try {
    entries = scanZipCentralDirectory(buffer);
  } catch (err) {
    throw new Error(`cspkg: invalid zip archive — ${String(err)}`);
  }
  if (entries.length > MAX_FILES) {
    throw new Error(`cspkg: archive contains too many files (${entries.length} > ${MAX_FILES})`);
  }
  let total = 0;
  for (const entry of entries) total += entry.size;
  if (total > MAX_DECOMPRESSED_BYTES) {
    throw new Error(`cspkg: decompressed size exceeds ${Math.round(MAX_DECOMPRESSED_BYTES / 1024 / 1024)} MB`);
  }

  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch (err) {
    throw new Error(`cspkg: invalid zip archive — ${String(err)}`);
  }

  files = normalizeFileKeys(files);

  const manifestEntry = files['manifest.json'];
  if (!manifestEntry) throw new Error('cspkg: missing manifest.json');

  let manifest: PluginManifest;
  try {
    manifest = JSON.parse(strFromU8(manifestEntry)) as PluginManifest;
  } catch (err) {
    throw new Error(`cspkg: invalid manifest.json — ${String(err)}`);
  }

  validateManifest(manifest);
  return { manifest, files };
}

export type CspkgExecutionMode = 'isolated' | 'trusted' | 'legacy-fallback';

export interface LoadedCspkg {
  plugin: Plugin;
  /** Which execution context the plugin ended up running in. */
  mode: CspkgExecutionMode;
}

/**
 * Load a plugin directly from a .cspkg file.
 *
 * Unless the manifest opts into `sandbox: "trusted"`, the entry code runs
 * inside a Web Worker sandbox (spec §6.2) with an RPC bridge — it cannot
 * reach the host page's globals, DOM, or stores. If workers are
 * unavailable, execution falls back to a best-effort restricted scope and
 * `mode` is set to `"legacy-fallback"` so the UI can warn the user.
 *
 * @param getApi builds the host PluginApi for the (parsed) plugin id.
 */
export async function loadCspkg(
  file: File,
  getApi: (pluginId: string) => PluginApi,
): Promise<LoadedCspkg> {
  const buffer = await file.arrayBuffer();
  const { manifest, files } = await parseCspkg(buffer);

  const entryFile = files[manifest.entry];
  if (!entryFile) throw new Error(`cspkg: entry "${manifest.entry}" not found`);
  const entrySrc = strFromU8(entryFile);

  let plugin: Plugin;
  let mode: CspkgExecutionMode;

  if (manifest.sandbox === 'trusted') {
    // Trusted packages execute directly (full DOM capability). This is the
    // legacy path kept for packages that must use `dom`/`three` handles.
    try {
      plugin = evaluatePluginLegacy(entrySrc, getApi(manifest.id));
      mode = 'trusted';
    } catch (err) {
      logger.error('cspkg', 'entry evaluation failed', err);
      throw new Error(`cspkg: entry evaluation failed — ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    const sandboxed = await createPluginSandbox({
      entrySource: entrySrc,
      manifest,
      getApi,
    });
    if (sandboxed) {
      plugin = sandboxed.plugin;
      mode = 'isolated';
    } else {
      logger.warn('cspkg', `worker sandbox unavailable for ${manifest.id}, using fallback`);
      try {
        plugin = evaluatePluginLegacy(entrySrc, getApi(manifest.id));
        mode = 'legacy-fallback';
      } catch (err) {
        logger.error('cspkg', 'entry evaluation failed', err);
        throw new Error(`cspkg: entry evaluation failed — ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Persist the package for later re-loading. Revoke any previous URLs for
  // this id (re-install) so the registry does not accumulate dead blobs.
  const assets: Record<string, string> = {};
  const createdUrls: string[] = [];
  for (const [path, data] of Object.entries(files)) {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/octet-stream' }));
    assets[path] = url;
    createdUrls.push(url);
  }
  trackUrls(manifest.id, createdUrls);
  const stored: StoredPluginPackage = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    description: manifest.description,
    icon: manifest.icon,
    entryUrl: assets[manifest.entry] ?? '',
    assets,
    installedAt: Date.now(),
  };
  await savePluginPackage(stored).catch(() => {
    logger.warn('cspkg', 'failed to persist package');
  });

  return { plugin, mode };
}
