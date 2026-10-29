// Built-in example plugins registry (spec §3.3.1).
// These are bundled at build time and listed in the "内置示例" tab.
//
// Ordering: default-loaded plugins are listed by importance — fundamental
// data analysis first, then the physics/geo simulation flagships, then the
// remaining charts and 3-D viewers. Fun/utility plugins (autoload: false)
// come last since the user picks them explicitly.

import type { Plugin, PluginManifest } from '@/types/plugin';
import { scatterManifest } from './charts/scatter/manifest';
import { timeSeriesManifest } from './charts/timeSeries/manifest';
import { histogramManifest } from './charts/histogram/manifest';
import { boxPlotManifest } from './charts/boxPlot/manifest';
import { heatmapManifest } from './charts/heatmap/manifest';
import { contourManifest } from './charts/contour/manifest';
import { nbodyManifest } from './physics/nbody/manifest';
import { fluidManifest } from './physics/fluid/manifest';
import { fluid3dManifest } from './physics/fluid3d/manifest';
import { waveManifest } from './physics/wave/manifest';
import { pendulumManifest } from './physics/pendulum/manifest';
import { geoMapManifest } from './geo/geoMap/manifest';
import { solarManifest } from './geo/solar/manifest';
import { climographManifest } from './geo/climograph/manifest';
import { popPyramidManifest } from './geo/popPyramid/manifest';
import { spatialInterpManifest } from './geo/spatialInterp/manifest';
import { geoMeasureManifest } from './geo/geoMeasure/manifest';
import { tissotManifest } from './geo/tissot/manifest';
import { terrainManifest } from './geo/terrain/manifest';
import { gpxTrackManifest } from './geo/gpxTrack/manifest';
import { globeManifest } from './geo/globe/manifest';
import { aiTrainingManifest } from './data/ai-training/manifest';
import { errorbandManifest } from './charts/errorband/manifest';
import { qqplotManifest } from './charts/qqplot/manifest';
import { violinPlotManifest } from './charts/violinPlot/manifest';
import { parallelCoordinatesManifest } from './charts/parallelCoordinates/manifest';
import { sankeyManifest } from './charts/sankey/manifest';
import { treemapManifest } from './charts/treemap/manifest';
import { networkGraphManifest } from './charts/networkGraph/manifest';
import { barChartManifest } from './charts/barChart/manifest';
import { bubbleChartManifest } from './charts/bubbleChart/manifest';
import { polarPlotManifest } from './charts/polarPlot/manifest';
import { pointCloudManifest } from './charts/pointCloud/manifest';
import { pointCloud3DManifest } from './charts/pointCloud3D/manifest';
import { surface3DManifest } from './charts/surface3D/manifest';
import { voxel3DManifest } from './charts/voxel3D/manifest';
import { modelViewerManifest } from './charts/modelViewer/manifest';
import { particleManifest } from './physics/particles/manifest';
import { proteinManifest } from './bio/protein/manifest';
import { imageViewerManifest } from './charts/imageViewer/manifest';
import { mandelbrotManifest } from './fun/mandelbrot/manifest';
import { spirographManifest } from './fun/spirograph/manifest';
import { lissajousManifest } from './fun/lissajous/manifest';
import { lifeManifest } from './fun/life/manifest';
import { harmonographManifest } from './fun/harmonograph/manifest';
import { paletteManifest } from './fun/palette/manifest';
import { kochManifest } from './fun/koch/manifest';
import { barnsleyManifest } from './fun/barnsley/manifest';
import { fireworksManifest } from './fun/fireworks/manifest';
import { truchetManifest } from './fun/truchet/manifest';
import { electromagManifest } from './physics/electromag/manifest';
import { opticsManifest } from './physics/optics/manifest';
import { structureManifest } from './engineering/structure/manifest';
import { emEigensolverManifest } from './physics/eigensolver/manifest';
import { fluidCfdCouplerManifest } from './physics/cfd-coupler/manifest';
import { chemCrystalManifest } from './chem/crystal/manifest';
import { chemReactionManifest } from './chem/reaction/manifest';
import { matsXrdManifest } from './materials/xrd/manifest';
import { matsMechManifest } from './materials/mech/manifest';
import { matsThermalManifest } from './materials/thermal/manifest';
import { blackholeManifest } from './fx/blackhole/manifest';
import { waterManifest as waterFxManifest } from './fx/water/manifest';
import { cloudManifest } from './fx/cloud/manifest';
import { skyManifest } from './fx/sky/manifest';
import { starsManifest } from './fx/stars/manifest';
import { oceanManifest } from './fx/ocean/manifest';
import { mistyManifest } from './fx/misty/manifest';
import { astroManifest } from './astro/pipeline/manifest';
import { bioEnzymeManifest } from './bio/enzyme/manifest';
import { bioEpidemicManifest } from './bio/epidemic/manifest';
import { bioSeqalignManifest } from './bio/seqalign/manifest';
import { bioPopgenManifest } from './bio/popgen/manifest';
import { aqiManifest } from './env/aqi/manifest';
import { waterManifest } from './env/water/manifest';
import { greenhouseManifest } from './env/greenhouse/manifest';
import { carbonManifest } from './env/carbon/manifest';
import { biodiversityManifest } from './env/biodiversity/manifest';
import { plumeManifest } from './env/plume/manifest';
import { earth3dManifest } from './env/earth3d/manifest';
import { chemTitrationManifest } from './chem/titration/manifest';
import { chemReactionOrderManifest } from './chem/reaction-order/manifest';
import { chemTuringManifest } from './chem/turing/manifest';
import { schrodingerManifest } from './physics/schrodinger/manifest';
import { isingManifest } from './physics/ising/manifest';
import { heatEngineManifest } from './physics/heatengine/manifest';
import { physicsDiffusionManifest } from './physics/diffusion/manifest';
import { physicsDiffractionManifest } from './physics/diffraction/manifest';
import { physicsTrajectoryManifest } from './physics/trajectory/manifest';
import { engCircuitManifest } from './engineering/circuit/manifest';
import { engTrussManifest } from './engineering/truss/manifest';
import { engControlManifest } from './engineering/control/manifest';
import { femLabManifest } from '../fem-lab/manifest';
import { bioPkManifest } from './bio/pk/manifest';
import { bioMendelManifest } from './bio/mendel/manifest';
import { bioNeuronManifest } from './bio/neuron/manifest';
import { envPredatorPreyManifest } from './env/predator-prey/manifest';
import { carbonDatingManifest } from './geo/carbondating/manifest';
import { soilWaterManifest } from './geo/soilwater/manifest';
import { hydrologyManifest } from './geo/hydrology/manifest';
import { seismicManifest } from './geo/seismic/manifest';
import { mineralsManifest } from './geo/minerals/manifest';
import { hydrogeologyManifest } from './geo/hydrogeology/manifest';
import { mathFourierManifest } from './math/fourier/manifest';
import { mathDomaincolorManifest } from './math/domaincolor/manifest';
import { mathOdefieldManifest } from './math/odefield/manifest';
import { mathLinalgManifest } from './math/linalg/manifest';
import { mathDistManifest } from './math/dist/manifest';
import { mathNumericsManifest } from './math/numerics/manifest';
import { mathGraphManifest } from './math/graph/manifest';
import { mathTopologyManifest } from './math/topology/manifest';
import { mathGameManifest } from './math/game/manifest';
import { statsCltManifest } from './math/clt/manifest';
import { statsMarkovManifest } from './math/markov/manifest';
import { statsZipfManifest } from './math/zipf/manifest';
import { statsDoeManifest } from './stats/doe/manifest';
import { statsTimeseriesManifest } from './stats/timeseries/manifest';
import { statsMultivariateManifest } from './stats/multivariate/manifest';
import { statsNonparametricManifest } from './stats/nonparametric/manifest';
import { statsSurvivalManifest } from './stats/survival/manifest';
import { statsMetaManifest } from './stats/meta/manifest';
import { statsBayesManifest } from './stats/bayes/manifest';
import { blackscholesManifest } from './econ/blackscholes/manifest';
import { evogameManifest } from './econ/evogame/manifest';
import { sdtManifest } from './psych/sdt/manifest';
import { rtManifest } from './psych/rt/manifest';
import { astroTransitManifest } from './astro/transit/manifest';
import { astroHrdiagramManifest } from './astro/hrdiagram/manifest';
import { dataImageprocManifest } from './data/imageproc/manifest';
import { acousticsManifest } from './artsci/acoustics/manifest';
import { tuningManifest } from './artsci/tuning/manifest';
import { synthManifest } from './artsci/synth/manifest';
import { colorScienceManifest } from './artsci/color-science/manifest';
import { algorithmsManifest } from './cs/algorithms/manifest';
import { dataStructuresManifest } from './cs/datastructures/manifest';
import { automataManifest } from './cs/automata/manifest';
import { cryptoManifest } from './cs/crypto/manifest';
import { neuralVizManifest } from './cs/neuralviz/manifest';
import { complexityManifest } from './cs/complexity/manifest';
import { netProtoManifest } from './cs/netproto/manifest';

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
      const mod = await import('./charts/scatter/plugin');
      return mod.default();
    },
  },
  {
    manifest: timeSeriesManifest,
    load: async () => {
      const mod = await import('./charts/timeSeries/plugin');
      return mod.default();
    },
  },
  {
    manifest: histogramManifest,
    load: async () => {
      const mod = await import('./charts/histogram/plugin');
      return mod.default();
    },
  },
  {
    manifest: boxPlotManifest,
    load: async () => {
      const mod = await import('./charts/boxPlot/plugin');
      return mod.default();
    },
  },
  {
    manifest: heatmapManifest,
    load: async () => {
      const mod = await import('./charts/heatmap/plugin');
      return mod.default();
    },
  },
  {
    manifest: contourManifest,
    load: async () => {
      const mod = await import('./charts/contour/plugin');
      return mod.default();
    },
  },
  // ---- Simulation flagships (physics / geography) -------------------------
  {
    manifest: nbodyManifest,
    load: async () => {
      const mod = await import('./physics/nbody/plugin');
      return mod.default();
    },
  },
  {
    manifest: fluidManifest,
    load: async () => {
      const mod = await import('./physics/fluid/plugin');
      return mod.default();
    },
  },
  {
    manifest: fluid3dManifest,
    load: async () => {
      const mod = await import('./physics/fluid3d');
      return mod.default();
    },
  },
  {
    manifest: waveManifest,
    load: async () => {
      const mod = await import('./physics/wave/plugin');
      return mod.default();
    },
  },
  {
    manifest: pendulumManifest,
    load: async () => {
      const mod = await import('./physics/pendulum/plugin');
      return mod.default();
    },
  },
  {
    manifest: geoMapManifest,
    load: async () => {
      const mod = await import('./geo/geoMap/plugin');
      return mod.default();
    },
  },
  {
    manifest: solarManifest,
    load: async () => {
      const mod = await import('./geo/solar/plugin');
      return mod.default();
    },
  },
  {
    manifest: climographManifest,
    load: async () => {
      const mod = await import('./geo/climograph/plugin');
      return mod.default();
    },
  },
  {
    manifest: popPyramidManifest,
    load: async () => {
      const mod = await import('./geo/popPyramid/plugin');
      return mod.default();
    },
  },
  {
    manifest: spatialInterpManifest,
    load: async () => {
      const mod = await import('./geo/spatialInterp/plugin');
      return mod.default();
    },
  },
  {
    manifest: geoMeasureManifest,
    load: async () => {
      const mod = await import('./geo/geoMeasure/plugin');
      return mod.default();
    },
  },
  {
    manifest: tissotManifest,
    load: async () => {
      const mod = await import('./geo/tissot/plugin');
      return mod.default();
    },
  },
  {
    manifest: terrainManifest,
    load: async () => {
      const mod = await import('./geo/terrain/plugin');
      return mod.default();
    },
  },
  {
    manifest: gpxTrackManifest,
    load: async () => {
      const mod = await import('./geo/gpxTrack/plugin');
      return mod.default();
    },
  },
  {
    manifest: globeManifest,
    load: async () => {
      const mod = await import('./geo/globe/plugin');
      return mod.default();
    },
  },
  {
    manifest: aiTrainingManifest,
    autoload: true,
    load: async () => {
      const mod = await import('./data/ai-training');
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
      const mod = await import('./physics/electromag/plugin');
      return mod.default();
    },
  },
  {
    manifest: opticsManifest,
    load: async () => {
      const mod = await import('./physics/optics/plugin');
      return mod.default();
    },
  },
  {
    manifest: structureManifest,
    load: async () => {
      const mod = await import('./engineering/structure/plugin');
      return mod.default();
    },
  },
  {
    manifest: emEigensolverManifest,
    load: async () => {
      const mod = await import('./physics/eigensolver');
      return mod.default();
    },
  },
  {
    manifest: fluidCfdCouplerManifest,
    load: async () => {
      const mod = await import('./physics/cfd-coupler');
      return mod.default();
    },
  },
  {
    manifest: chemCrystalManifest,
    load: async () => {
      const mod = await import('./chem/crystal');
      return mod.default();
    },
  },
  {
    manifest: chemReactionManifest,
    load: async () => {
      const mod = await import('./chem/reaction');
      return mod.default();
    },
  },
  // ---- Materials science suite (research-grade kernels) ---------------------
  {
    manifest: matsXrdManifest,
    load: async () => {
      const mod = await import('./materials/xrd');
      return mod.default();
    },
  },
  {
    manifest: matsMechManifest,
    load: async () => {
      const mod = await import('./materials/mech');
      return mod.default();
    },
  },
  {
    manifest: matsThermalManifest,
    load: async () => {
      const mod = await import('./materials/thermal');
      return mod.default();
    },
  },
  // ---- Special FX (GPU ray tracing / fluid; own sidebar discipline) ---------
  {
    manifest: blackholeManifest,
    load: async () => {
      const mod = await import('./fx/blackhole');
      return mod.default();
    },
  },
  {
    manifest: waterFxManifest,
    load: async () => {
      const mod = await import('./fx/water');
      return mod.default();
    },
  },
  {
    manifest: cloudManifest,
    load: async () => {
      const mod = await import('./fx/cloud');
      return mod.default();
    },
  },
  {
    manifest: skyManifest,
    load: async () => {
      const mod = await import('./fx/sky');
      return mod.default();
    },
  },
  {
    manifest: starsManifest,
    load: async () => {
      const mod = await import('./fx/stars');
      return mod.default();
    },
  },
  {
    manifest: oceanManifest,
    load: async () => {
      const mod = await import('./fx/ocean');
      return mod.default();
    },
  },
  {
    manifest: mistyManifest,
    load: async () => {
      const mod = await import('./fx/misty');
      return mod.default();
    },
  },
  // ---- Astronomy (research-grade CCD pipeline) ------------------------------
  {
    manifest: astroManifest,
    load: async () => {
      const mod = await import('./astro/pipeline');
      return mod.default();
    },
  },
  // ---- Biology suite (research-grade kernels) ------------------------------
  {
    manifest: bioEnzymeManifest,
    load: async () => {
      const mod = await import('./bio/enzyme');
      return mod.default();
    },
  },
  {
    manifest: bioEpidemicManifest,
    load: async () => {
      const mod = await import('./bio/epidemic');
      return mod.default();
    },
  },
  {
    manifest: bioSeqalignManifest,
    load: async () => {
      const mod = await import('./bio/seqalign');
      return mod.default();
    },
  },
  {
    manifest: bioPopgenManifest,
    load: async () => {
      const mod = await import('./bio/popgen');
      return mod.default();
    },
  },
  // ---- Environmental science suite (data-driven; samples via 示例 dialog) ---
  {
    manifest: aqiManifest,
    load: async () => {
      const mod = await import('./env/aqi/plugin');
      return mod.default();
    },
  },
  {
    manifest: waterManifest,
    load: async () => {
      const mod = await import('./env/water/plugin');
      return mod.default();
    },
  },
  {
    manifest: greenhouseManifest,
    load: async () => {
      const mod = await import('./env/greenhouse/plugin');
      return mod.default();
    },
  },
  {
    manifest: carbonManifest,
    load: async () => {
      const mod = await import('./env/carbon/plugin');
      return mod.default();
    },
  },
  {
    manifest: biodiversityManifest,
    load: async () => {
      const mod = await import('./env/biodiversity/plugin');
      return mod.default();
    },
  },
  {
    manifest: plumeManifest,
    load: async () => {
      const mod = await import('./env/plume/plugin');
      return mod.default();
    },
  },
  {
    manifest: earth3dManifest,
    load: async () => {
      const mod = await import('./env/earth3d/plugin');
      return mod.default();
    },
  },
  // ---- Research suite: chemistry (research-grade kernels) -------------------
  {
    manifest: chemTitrationManifest,
    load: async () => {
      const mod = await import('./chem/titration');
      return mod.default();
    },
  },
  {
    manifest: chemReactionOrderManifest,
    load: async () => {
      const mod = await import('./chem/reaction-order');
      return mod.default();
    },
  },
  {
    manifest: chemTuringManifest,
    load: async () => {
      const mod = await import('./chem/turing');
      return mod.default();
    },
  },
  // ---- Research suite: physics (research-grade kernels) ---------------------
  {
    manifest: schrodingerManifest,
    load: async () => {
      const mod = await import('./physics/schrodinger');
      return mod.default();
    },
  },
  {
    manifest: isingManifest,
    load: async () => {
      const mod = await import('./physics/ising');
      return mod.default();
    },
  },
  {
    manifest: heatEngineManifest,
    load: async () => {
      const mod = await import('./physics/heatengine');
      return mod.default();
    },
  },
  {
    manifest: physicsDiffusionManifest,
    load: async () => {
      const mod = await import('./physics/diffusion');
      return mod.default();
    },
  },
  {
    manifest: physicsDiffractionManifest,
    load: async () => {
      const mod = await import('./physics/diffraction');
      return mod.default();
    },
  },
  {
    manifest: physicsTrajectoryManifest,
    load: async () => {
      const mod = await import('./physics/trajectory');
      return mod.default();
    },
  },
  // ---- Research suite: engineering (research-grade kernels) ------------------
  {
    manifest: engCircuitManifest,
    load: async () => {
      const mod = await import('./engineering/circuit');
      return mod.default();
    },
  },
  {
    manifest: engTrussManifest,
    load: async () => {
      const mod = await import('./engineering/truss');
      return mod.default();
    },
  },
  {
    manifest: engControlManifest,
    load: async () => {
      const mod = await import('./engineering/control');
      return mod.default();
    },
  },
  {
    manifest: femLabManifest,
    load: async () => {
      const mod = await import('../fem-lab');
      return mod.default();
    },
  },
  // ---- Research suite: biology & environment (research-grade kernels) --------
  {
    manifest: bioPkManifest,
    load: async () => {
      const mod = await import('./bio/pk');
      return mod.default();
    },
  },
  {
    manifest: bioMendelManifest,
    load: async () => {
      const mod = await import('./bio/mendel');
      return mod.default();
    },
  },
  {
    manifest: bioNeuronManifest,
    load: async () => {
      const mod = await import('./bio/neuron');
      return mod.default();
    },
  },
  {
    manifest: envPredatorPreyManifest,
    load: async () => {
      const mod = await import('./env/predator-prey');
      return mod.default();
    },
  },
  // ---- Research suite: earth science (research-grade kernels) ----------------
  {
    manifest: carbonDatingManifest,
    load: async () => {
      const mod = await import('./geo/carbondating');
      return mod.default();
    },
  },
  {
    manifest: soilWaterManifest,
    load: async () => {
      const mod = await import('./geo/soilwater');
      return mod.default();
    },
  },
  {
    manifest: hydrologyManifest,
    load: async () => {
      const mod = await import('./geo/hydrology');
      return mod.default();
    },
  },
  // ---- Research suite: geoscience (seismic / minerals / groundwater) ----------
  {
    manifest: seismicManifest,
    load: async () => {
      const mod = await import('./geo/seismic');
      return mod.default();
    },
  },
  {
    manifest: mineralsManifest,
    load: async () => {
      const mod = await import('./geo/minerals');
      return mod.default();
    },
  },
  {
    manifest: hydrogeologyManifest,
    load: async () => {
      const mod = await import('./geo/hydrogeology');
      return mod.default();
    },
  },
  // ---- Research suite: mathematics (research-grade kernels) ------------------
  {
    manifest: mathFourierManifest,
    load: async () => {
      const mod = await import('./math/fourier');
      return mod.default();
    },
  },
  {
    manifest: mathDomaincolorManifest,
    load: async () => {
      const mod = await import('./math/domaincolor');
      return mod.default();
    },
  },
  {
    manifest: mathOdefieldManifest,
    load: async () => {
      const mod = await import('./math/odefield');
      return mod.default();
    },
  },
  {
    manifest: mathLinalgManifest,
    load: async () => {
      const mod = await import('./math/linalg');
      return mod.default();
    },
  },
  {
    manifest: mathDistManifest,
    load: async () => {
      const mod = await import('./math/dist');
      return mod.default();
    },
  },
  {
    manifest: mathNumericsManifest,
    load: async () => {
      const mod = await import('./math/numerics');
      return mod.default();
    },
  },
  {
    manifest: mathGraphManifest,
    load: async () => {
      const mod = await import('./math/graph');
      return mod.default();
    },
  },
  {
    manifest: mathTopologyManifest,
    load: async () => {
      const mod = await import('./math/topology');
      return mod.default();
    },
  },
  {
    manifest: mathGameManifest,
    load: async () => {
      const mod = await import('./math/game');
      return mod.default();
    },
  },
  // ---- Research suite: statistics (research-grade kernels) -------------------
  {
    manifest: statsCltManifest,
    load: async () => {
      const mod = await import('./math/clt');
      return mod.default();
    },
  },
  {
    manifest: statsMarkovManifest,
    load: async () => {
      const mod = await import('./math/markov');
      return mod.default();
    },
  },
  {
    manifest: statsZipfManifest,
    load: async () => {
      const mod = await import('./math/zipf');
      return mod.default();
    },
  },
  // ---- Research suite: dedicated statistical analysis ------------------------
  {
    manifest: statsDoeManifest,
    load: async () => {
      const mod = await import('./stats/doe');
      return mod.default();
    },
  },
  {
    manifest: statsTimeseriesManifest,
    load: async () => {
      const mod = await import('./stats/timeseries');
      return mod.default();
    },
  },
  {
    manifest: statsMultivariateManifest,
    load: async () => {
      const mod = await import('./stats/multivariate');
      return mod.default();
    },
  },
  {
    manifest: statsNonparametricManifest,
    load: async () => {
      const mod = await import('./stats/nonparametric');
      return mod.default();
    },
  },
  {
    manifest: statsSurvivalManifest,
    load: async () => {
      const mod = await import('./stats/survival');
      return mod.default();
    },
  },
  {
    manifest: statsMetaManifest,
    load: async () => {
      const mod = await import('./stats/meta');
      return mod.default();
    },
  },
  {
    manifest: statsBayesManifest,
    load: async () => {
      const mod = await import('./stats/bayes');
      return mod.default();
    },
  },
  // ---- Research suite: economics & psychology (research-grade kernels) -------
  {
    manifest: blackscholesManifest,
    load: async () => {
      const mod = await import('./econ/blackscholes');
      return mod.default();
    },
  },
  {
    manifest: evogameManifest,
    load: async () => {
      const mod = await import('./econ/evogame');
      return mod.default();
    },
  },
  {
    manifest: sdtManifest,
    load: async () => {
      const mod = await import('./psych/sdt');
      return mod.default();
    },
  },
  {
    manifest: rtManifest,
    load: async () => {
      const mod = await import('./psych/rt');
      return mod.default();
    },
  },
  // ---- Research suite: astronomy & data (research-grade kernels) -------------
  {
    manifest: astroTransitManifest,
    load: async () => {
      const mod = await import('./astro/transit');
      return mod.default();
    },
  },
  {
    manifest: astroHrdiagramManifest,
    load: async () => {
      const mod = await import('./astro/hrdiagram');
      return mod.default();
    },
  },
  {
    manifest: dataImageprocManifest,
    load: async () => {
      const mod = await import('./data/imageproc');
      return mod.default();
    },
  },
  // ---- Music & art science (interdisciplinary labs) --------------------------
  {
    manifest: acousticsManifest,
    load: async () => {
      const mod = await import('./artsci/acoustics');
      return mod.default();
    },
  },
  {
    manifest: tuningManifest,
    load: async () => {
      const mod = await import('./artsci/tuning');
      return mod.default();
    },
  },
  {
    manifest: synthManifest,
    load: async () => {
      const mod = await import('./artsci/synth');
      return mod.default();
    },
  },
  {
    manifest: colorScienceManifest,
    load: async () => {
      const mod = await import('./artsci/color-science');
      return mod.default();
    },
  },
  // ---- Computer science & software engineering -------------------------------
  {
    manifest: algorithmsManifest,
    load: async () => {
      const mod = await import('./cs/algorithms');
      return mod.default();
    },
  },
  {
    manifest: dataStructuresManifest,
    load: async () => {
      const mod = await import('./cs/datastructures');
      return mod.default();
    },
  },
  {
    manifest: automataManifest,
    load: async () => {
      const mod = await import('./cs/automata');
      return mod.default();
    },
  },
  {
    manifest: cryptoManifest,
    load: async () => {
      const mod = await import('./cs/crypto');
      return mod.default();
    },
  },
  {
    manifest: neuralVizManifest,
    load: async () => {
      const mod = await import('./cs/neuralviz');
      return mod.default();
    },
  },
  {
    manifest: complexityManifest,
    load: async () => {
      const mod = await import('./cs/complexity');
      return mod.default();
    },
  },
  {
    manifest: netProtoManifest,
    load: async () => {
      const mod = await import('./cs/netproto');
      return mod.default();
    },
  },
  // ---- Statistical charts --------------------------------------------------
  {
    manifest: errorbandManifest,
    load: async () => {
      const mod = await import('./charts/errorband/plugin');
      return mod.default();
    },
  },
  {
    manifest: qqplotManifest,
    load: async () => {
      const mod = await import('./charts/qqplot/plugin');
      return mod.default();
    },
  },
  {
    manifest: violinPlotManifest,
    load: async () => {
      const mod = await import('./charts/violinPlot/plugin');
      return mod.default();
    },
  },
  {
    manifest: parallelCoordinatesManifest,
    load: async () => {
      const mod = await import('./charts/parallelCoordinates/plugin');
      return mod.default();
    },
  },
  {
    manifest: sankeyManifest,
    load: async () => {
      const mod = await import('./charts/sankey/plugin');
      return mod.default();
    },
  },
  {
    manifest: treemapManifest,
    load: async () => {
      const mod = await import('./charts/treemap/plugin');
      return mod.default();
    },
  },
  {
    manifest: networkGraphManifest,
    load: async () => {
      const mod = await import('./charts/networkGraph/plugin');
      return mod.default();
    },
  },
  {
    manifest: barChartManifest,
    load: async () => {
      const mod = await import('./charts/barChart/plugin');
      return mod.default();
    },
  },
  {
    manifest: bubbleChartManifest,
    load: async () => {
      const mod = await import('./charts/bubbleChart/plugin');
      return mod.default();
    },
  },
  {
    manifest: polarPlotManifest,
    load: async () => {
      const mod = await import('./charts/polarPlot/plugin');
      return mod.default();
    },
  },
  // ---- 3-D & misc viewers ---------------------------------------------------
  {
    manifest: pointCloudManifest,
    load: async () => {
      const mod = await import('./charts/pointCloud/plugin');
      return mod.default();
    },
  },
  {
    manifest: pointCloud3DManifest,
    load: async () => {
      const mod = await import('./charts/pointCloud3D/plugin');
      return mod.default();
    },
  },
  {
    manifest: surface3DManifest,
    load: async () => {
      const mod = await import('./charts/surface3D/plugin');
      return mod.default();
    },
  },
  {
    manifest: voxel3DManifest,
    load: async () => {
      const mod = await import('./charts/voxel3D/plugin');
      return mod.default();
    },
  },
  {
    manifest: modelViewerManifest,
    load: async () => {
      const mod = await import('./charts/modelViewer/plugin');
      return mod.default();
    },
  },
  {
    manifest: particleManifest,
    load: async () => {
      const mod = await import('./physics/particles/plugin');
      return mod.default();
    },
  },
  {
    manifest: proteinManifest,
    load: async () => {
      const mod = await import('./bio/protein/plugin');
      return mod.default();
    },
  },
  {
    manifest: imageViewerManifest,
    load: async () => {
      const mod = await import('./charts/imageViewer/plugin');
      return mod.default();
    },
  },
  // ---- Fun & utility (manual load) -------------------------------------------
  {
    manifest: mandelbrotManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./fun/mandelbrot/plugin');
      return mod.default();
    },
  },
  {
    manifest: spirographManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./fun/spirograph/plugin');
      return mod.default();
    },
  },
  {
    manifest: lissajousManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./fun/lissajous/plugin');
      return mod.default();
    },
  },
  {
    manifest: lifeManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./fun/life/plugin');
      return mod.default();
    },
  },
  {
    manifest: harmonographManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./fun/harmonograph/plugin');
      return mod.default();
    },
  },
  {
    manifest: paletteManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./fun/palette/plugin');
      return mod.default();
    },
  },
  {
    manifest: kochManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./fun/koch/plugin');
      return mod.default();
    },
  },
  {
    manifest: barnsleyManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./fun/barnsley/plugin');
      return mod.default();
    },
  },
  {
    manifest: fireworksManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./fun/fireworks/plugin');
      return mod.default();
    },
  },
  {
    manifest: truchetManifest,
    autoload: false,
    load: async () => {
      const mod = await import('./fun/truchet/plugin');
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
