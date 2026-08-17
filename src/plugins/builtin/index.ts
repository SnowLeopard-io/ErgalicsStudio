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
import { boxPlotManifest } from './boxPlot';
import { parallelCoordinatesManifest } from './parallelCoordinates';
import { mandelbrotManifest } from './mandelbrot';
import { spirographManifest } from './spirograph';
import { lissajousManifest } from './lissajous';
import { lifeManifest } from './life';
import { harmonographManifest } from './harmonograph';
import { paletteManifest } from './palette';
import { errorbandManifest } from './errorband';
import { treemapManifest } from './treemap';
import { qqplotManifest } from './qqplot';
import { kochManifest } from './koch';
import { barnsleyManifest } from './barnsley';
import { fireworksManifest } from './fireworks';
import { truchetManifest } from './truchet';

export interface BuiltinPluginInfo {
  manifest: PluginManifest;
  load: () => Promise<Plugin>;
  /**
   * Whether the plugin is loaded automatically on startup. Fun/utility
   * plugins default to manual loading (the user picks them from the
   * built-in / marketplace panel) so they don't bloat the initial registry.
   * Defaults to `true` when omitted.
   */
  autoload?: boolean;
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
  {
    manifest: boxPlotManifest,
    load: async () => {
      const mod = await import('./boxPlot');
      return mod.default();
    },
  },
  {
    manifest: parallelCoordinatesManifest,
    load: async () => {
      const mod = await import('./parallelCoordinates');
      return mod.default();
    },
  },
  {
    manifest: mandelbrotManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./mandelbrot');
      return mod.default();
    },
  },
  {
    manifest: spirographManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./spirograph');
      return mod.default();
    },
  },
  {
    manifest: lissajousManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./lissajous');
      return mod.default();
    },
  },
  {
    manifest: lifeManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./life');
      return mod.default();
    },
  },
  {
    manifest: harmonographManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./harmonograph');
      return mod.default();
    },
  },
  {
    manifest: paletteManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./palette');
      return mod.default();
    },
  },
  {
    manifest: errorbandManifest,
    load: async () => {
      const mod = await import('./errorband');
      return mod.default();
    },
  },
  {
    manifest: treemapManifest,
    load: async () => {
      const mod = await import('./treemap');
      return mod.default();
    },
  },
  {
    manifest: qqplotManifest,
    load: async () => {
      const mod = await import('./qqplot');
      return mod.default();
    },
  },
  {
    manifest: kochManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./koch');
      return mod.default();
    },
  },
  {
    manifest: barnsleyManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./barnsley');
      return mod.default();
    },
  },
  {
    manifest: fireworksManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./fireworks');
      return mod.default();
    },
  },
  {
    manifest: truchetManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./truchet');
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