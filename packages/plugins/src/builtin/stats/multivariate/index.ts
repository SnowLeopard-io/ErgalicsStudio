// Lazy-load entry for the multivariate statistics plugin.
export { default } from './plugin';
export { statsMultivariateManifest } from './manifest';
export {
  canonicalCorrelation,
  dbscan,
  discriminant,
  factorAnalysis,
  hierarchicalCluster,
  kmeans,
  mahalanobisOutliers,
  parseMultivariate,
  pca,
  runMultivariateBenchmark,
  varimax,
  type CcaResult,
  type ClusterResult,
  type DiscriminantResult,
  type FactorResult,
  type MultiDataset,
  type MultivariateBenchmark,
  type OutlierResult,
  type PcaResult,
} from './kernel';
