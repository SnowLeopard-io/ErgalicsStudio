// Lazy-load entry for the Bayesian statistics plugin.
export { default } from './plugin';
export { statsBayesManifest } from './manifest';
export {
  DEFAULT_PRIOR,
  Rng,
  bayesFactor,
  convergence,
  credibleInterval,
  gibbsNormal,
  hierarchicalModel,
  hmcMean,
  kde,
  metropolisHastings,
  parseBayes,
  posteriorPredictive,
  runBayes,
  runBayesBenchmark,
  type BayesBenchmark,
  type BayesDataset,
  type BayesResult,
  type Chain,
  type Convergence,
  type HierarchicalResult,
  type NormalPrior,
} from './kernel';
