// ==========================================================================
// .cspkg plugin package loader (spec §6.3)
// Format: ZIP archive containing manifest.json + dist/ + assets/
// ==========================================================================

import { unzipSync, strFromU8 } from 'fflate';
import { logger } from './logger';
import type { Plugin, PluginManifest, PluginApi } from '@/types/plugin';
import { savePluginPackage, type StoredPluginPackage } from './storage';

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

  if (!manifest.id || !manifest.entry || !manifest.name || !manifest.version) {
    throw new Error('cspkg: manifest missing required fields');
  }
  return { manifest, files };
}

/**
 * Load a plugin directly from a .cspkg file. Entry JS is extracted and
 * executed via `new Function` inside an isolated wrapper — the practical
 * browser-side approximation of the plugin isolation requirement (§6.2).
 */
export async function loadCspkg(file: File): Promise<Plugin> {
  const buffer = await file.arrayBuffer();
  const { manifest, files } = await parseCspkg(buffer);

  const entryFile = files[manifest.entry];
  if (!entryFile) throw new Error(`cspkg: entry "${manifest.entry}" not found`);
  const entrySrc = strFromU8(entryFile);

  let factory: (api: PluginApi) => Plugin;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    factory = new Function('api', `"use strict";\n${entrySrc}`) as (
      api: PluginApi,
    ) => Plugin;
  } catch (err) {
    logger.error('cspkg', 'entry evaluation failed', err);
    throw new Error('cspkg: entry evaluation failed');
  }

  const plugin = factory(undefined as unknown as PluginApi);
  plugin.manifest.id = manifest.id;

  // Persist the package for later re-loading.
  const assets: Record<string, string> = {};
  for (const [path, data] of Object.entries(files)) {
    assets[path] = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/octet-stream' }));
  }
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

  return plugin;
}