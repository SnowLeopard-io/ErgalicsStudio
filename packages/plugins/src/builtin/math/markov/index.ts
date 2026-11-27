// Lazy-load entry for the stats-markov plugin.
export { default } from './plugin';
export { statsMarkovManifest } from './manifest';
export {
  absorbingAnalysis,
  chainPeriod,
  isIrreducible,
  matrixInverse,
  pageRank,
  parseInitial,
  parseMatrixText,
  runMarkovBenchmark,
  serializeMatrix,
  simulateChain,
  steadyStateByPower,
  stepDistribution,
  stochasticize,
  PRESETS,
  WEB5_MATRIX,
  type AbsorbingResult,
  type MarkovBenchmark,
  type ParsedMatrix,
  type Preset,
  type SteadyResult,
  type Stochasticized,
} from './kernel';
