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
import { contourManifest } from './contour';
import { scatterManifest } from './scatter';
import { nbodyManifest } from './nbody';
import { proteinManifest } from './protein';
import { barChartManifest } from './barChart';
import { polarPlotManifest } from './polarPlot';
import { networkGraphManifest } from './networkGraph';
import { bubbleChartManifest } from './bubbleChart';
import { violinPlotManifest } from './violinPlot';
import { sankeyManifest } from './sankey';

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
  {
    manifest: contourManifest,
    load: async () => {
      const mod = await import('./contour');
      return mod.default();
    },
  },
  {
    manifest: scatterManifest,
    load: async () => {
      const mod = await import('./scatter');
      return mod.default();
    },
  },
  {
    manifest: nbodyManifest,
    load: async () => {
      const mod = await import('./nbody');
      return mod.default();
    },
  },
  {
    manifest: proteinManifest,
    load: async () => {
      const mod = await import('./protein');
      return mod.default();
    },
  },
  {
    manifest: barChartManifest,
    load: async () => {
      const mod = await import('./barChart');
      return mod.default();
    },
  },
  {
    manifest: polarPlotManifest,
    load: async () => {
      const mod = await import('./polarPlot');
      return mod.default();
    },
  },
  {
    manifest: networkGraphManifest,
    load: async () => {
      const mod = await import('./networkGraph');
      return mod.default();
    },
  },
  {
    manifest: bubbleChartManifest,
    load: async () => {
      const mod = await import('./bubbleChart');
      return mod.default();
    },
  },
  {
    manifest: violinPlotManifest,
    load: async () => {
      const mod = await import('./violinPlot');
      return mod.default();
    },
  },
  {
    manifest: sankeyManifest,
    load: async () => {
      const mod = await import('./sankey');
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