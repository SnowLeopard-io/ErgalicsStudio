// Built-in example plugins registry (spec §3.3.1).
// These are bundled at build time and listed in the "内置示例" tab.

import type { Plugin, PluginManifest } from '@/types/plugin';
import { pointCloudManifest } from './pointCloud';
import { particleManifest } from './particles';

export interface BuiltinPluginInfo {
  manifest: PluginManifest;
  load: () => Promise<Plugin>;
}

export const BUILTIN_PLUGINS: BuiltinPluginInfo[] = [
  {
    manifest: pointCloudManifest,
    load: async () => {
      const mod = await import('./pointCloud');
      return mod.default();
    },
  },
  {
    manifest: particleManifest,
    load: async () => {
      const mod = await import('./particles');
      return mod.default();
    },
  },
];

export function findBuiltin(id: string): BuiltinPluginInfo | undefined {
  return BUILTIN_PLUGINS.find((p) => p.manifest.id === id);
}

export function getBuiltinManifests(): PluginManifest[] {
  return BUILTIN_PLUGINS.map((p) => p.manifest);
}