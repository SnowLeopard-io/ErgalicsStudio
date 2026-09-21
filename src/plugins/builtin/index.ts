// Built-in example plugins registry (spec §3.3.1).
// These are bundled at build time and listed in the "内置示例" tab.
//
// Ordering: default-loaded plugins are listed by importance — fundamental
// data analysis first, then the physics/geo simulation flagships, then the
// remaining charts and 3-D viewers. Fun/utility plugins (autoload: false)
// come last since the user picks them explicitly.

import type { Plugin, PluginManifest } from '@/types/plugin';
import { scatterManifest } from './scatterManifest';
import { timeSeriesManifest } from './timeSeriesManifest';
import { histogramManifest } from './histogramManifest';
import { boxPlotManifest } from './boxPlotManifest';
import { heatmapManifest } from './heatmapManifest';
import { contourManifest } from './contourManifest';
import { nbodyManifest } from './nbodyManifest';
import { fluidManifest } from './fluidManifest';
import { waveManifest } from './waveManifest';
import { pendulumManifest } from './pendulumManifest';
import { geoMapManifest } from './geoMapManifest';
import { aiTrainingManifest } from './ai-training/manifest';
import { errorbandManifest } from './errorbandManifest';
import { qqplotManifest } from './qqplotManifest';
import { violinPlotManifest } from './violinPlotManifest';
import { parallelCoordinatesManifest } from './parallelCoordinatesManifest';
import { sankeyManifest } from './sankeyManifest';
import { treemapManifest } from './treemapManifest';
import { networkGraphManifest } from './networkGraphManifest';
import { barChartManifest } from './barChartManifest';
import { bubbleChartManifest } from './bubbleChartManifest';
import { polarPlotManifest } from './polarPlotManifest';
import { pointCloudManifest } from './pointCloudManifest';
import { pointCloud3DManifest } from './pointCloud3DManifest';
import { surface3DManifest } from './surface3DManifest';
import { voxel3DManifest } from './voxel3DManifest';
import { particleManifest } from './particleManifest';
import { proteinManifest } from './proteinManifest';
import { imageViewerManifest } from './imageViewerManifest';
import { mandelbrotManifest } from './mandelbrotManifest';
import { spirographManifest } from './spirographManifest';
import { lissajousManifest } from './lissajousManifest';
import { lifeManifest } from './lifeManifest';
import { harmonographManifest } from './harmonographManifest';
import { paletteManifest } from './paletteManifest';
import { kochManifest } from './kochManifest';
import { barnsleyManifest } from './barnsleyManifest';
import { fireworksManifest } from './fireworksManifest';
import { truchetManifest } from './truchetManifest';
import { electromagManifest } from './electromagManifest';
import { opticsManifest } from './opticsManifest';
import { structureManifest } from './structureManifest';
import { emEigensolverManifest } from './em-eigensolver/manifest';
import { fluidCfdCouplerManifest } from './fluid-cfd-coupler/manifest';

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
  // ---- Core data analysis ------------------------------------------------
  {
    manifest: scatterManifest,
    load: async () => {
      const mod = await import('./scatter');
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
    manifest: boxPlotManifest,
    load: async () => {
      const mod = await import('./boxPlot');
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
    manifest: contourManifest,
    load: async () => {
      const mod = await import('./contour');
      return mod.default();
    },
  },
  // ---- Simulation flagships (physics / geography) -------------------------
  {
    manifest: nbodyManifest,
    load: async () => {
      const mod = await import('./nbody');
      return mod.default();
    },
  },
  {
    manifest: fluidManifest,
    load: async () => {
      const mod = await import('./fluid');
      return mod.default();
    },
  },
  {
    manifest: waveManifest,
    load: async () => {
      const mod = await import('./wave');
      return mod.default();
    },
  },
  {
    manifest: pendulumManifest,
    load: async () => {
      const mod = await import('./doublePendulum');
      return mod.default();
    },
  },
  {
    manifest: geoMapManifest,
    load: async () => {
      const mod = await import('./geoMap');
      return mod.default();
    },
  },
  {
    manifest: aiTrainingManifest,
    autoload: true,
    load: async () => {
      const mod = await import('./ai-training');
      return mod.default();
    },
  },
  // ---- Interactive physics / optics labs (default-loaded) ------------------
  // Hands-on 2-D labs: draggable objects and on-canvas interaction. These are
  // product flagship demos, so they ship as default plugins — loaded on
  // startup alongside the other simulation flagships and always listed in the
  // built-in / market panels. Each one has matching entries in
  // examples/data/ surfaced by the top-bar "示例" dialog.
  {
    manifest: electromagManifest,
    load: async () => {
      const mod = await import('./electromag');
      return mod.default();
    },
  },
  {
    manifest: opticsManifest,
    load: async () => {
      const mod = await import('./optics');
      return mod.default();
    },
  },
  {
    manifest: structureManifest,
    load: async () => {
      const mod = await import('./structure');
      return mod.default();
    },
  },
  {
    manifest: emEigensolverManifest,
    load: async () => {
      const mod = await import('./em-eigensolver');
      return mod.default();
    },
  },
  {
    manifest: fluidCfdCouplerManifest,
    load: async () => {
      const mod = await import('./fluid-cfd-coupler');
      return mod.default();
    },
  },
  // ---- Statistical charts --------------------------------------------------
  {
    manifest: errorbandManifest,
    load: async () => {
      const mod = await import('./errorband');
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
    manifest: violinPlotManifest,
    load: async () => {
      const mod = await import('./violinPlot');
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
    manifest: sankeyManifest,
    load: async () => {
      const mod = await import('./sankey');
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
    manifest: networkGraphManifest,
    load: async () => {
      const mod = await import('./networkGraph');
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
    manifest: bubbleChartManifest,
    load: async () => {
      const mod = await import('./bubbleChart');
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
  // ---- 3-D & misc viewers ---------------------------------------------------
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
    manifest: surface3DManifest,
    load: async () => {
      const mod = await import('./surface3D');
      return mod.default();
    },
  },
  {
    manifest: voxel3DManifest,
    load: async () => {
      const mod = await import('./voxel3D');
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
    manifest: proteinManifest,
    load: async () => {
      const mod = await import('./protein');
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
  // ---- Fun & utility (manual load) -------------------------------------------
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
