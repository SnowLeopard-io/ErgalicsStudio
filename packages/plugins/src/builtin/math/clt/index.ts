// Lazy-load entry for the stats-clt plugin.
export { default } from './plugin';
export { statsCltManifest } from './manifest';
export {
  clampParam,
  histogram,
  jarqueBera,
  normalPdf,
  paramLabel,
  relErr,
  runClt,
  runCltBenchmark,
  sampleMeans,
  sampleOne,
  sampleStats,
  standardized,
  theoryMoments,
  POPULATION_KINDS,
  type CltBenchmark,
  type CltResult,
  type Histogram,
  type PopulationKind,
  type PopulationSpec,
  type PopMoments,
  type SampleStats,
} from './kernel';
