// Built-in example plugins registry (spec §3.3.1).
// These are bundled at build time and listed in the "内置示例" tab.

import type { Plugin, PluginManifest } from '@/types/plugin';
import { pointCloudManifest } from './pointCloud';
import { pointCloud3DManifest } from './pointCloud3D';
import { particleManifest } from './particles';
import { timeSeriesManifest } from './timeSeries';
import { histogramManifest } from './histogram';
import { heatmapManifest } from './heatmap';
import { imageViewerManifest } from './imageViewer';

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
    manifest: pointCloud3DManifest,
    load: async () => {
      const mod = await import('./pointCloud3D');
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
  {
    manifest: timeSeriesManifest,
    load: async () => {
      const mod = await import('./timeSeries');
      return mod.default();
    },
  },
  {
    manifest: histogramManifest,
    load: async () => {
      const mod = await import('./histogram');
      return mod.default();
    },
  },
  {
    manifest: heatmapManifest,
    load: async () => {
      const mod = await import('./heatmap');
      return mod.default();
    },
  },
  {
    manifest: imageViewerManifest,
    load: async () => {
      const mod = await import('./imageViewer');
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