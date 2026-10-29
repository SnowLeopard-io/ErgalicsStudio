// Lazy-load entry for the socio-opinion plugin.
export { default } from './plugin';
export { opinionManifest } from './manifest';
export {
  buildNetwork,
  expectedReach,
  greedySeeds,
  homophilyIndex,
  opinionStep,
  opinionSeriesRow,
  runIndependentCascade,
  runLinearThreshold,
  runOpinionBenchmark,
  runOpinionSimulation,
} from './kernel';
