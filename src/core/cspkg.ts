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
  if (manifest.sandbox !== undefined && manifest.sandbox !== 'isolated' && manifest.sandbox !== 'trusted') {
    throw new Error(`cspkg: unknown sandbox mode "${String(manifest.sandbox)}"`);
  }
}

export async function parseCspkg(buffer: ArrayBuffer): Promise<{
  manifest: PluginManifest;
  files: Record<string, Uint8Array>;
}> {
  const files = unzipSync(new Uint8Array(buffer));
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
      throw new Error('cspkg: entry evaluation failed');
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
        throw new Error('cspkg: entry evaluation failed');
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
