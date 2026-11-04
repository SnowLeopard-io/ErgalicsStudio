// Lazy-load entry for the nonparametric statistics plugin.
export { default } from './plugin';
export { statsNonparametricManifest } from './manifest';
export {
  friedman,
  kruskalWallis,
  ksOneSampleNormal,
  ksTwoSample,
  mannWhitney,
  parseNonparametric,
  rankCorrelations,
  runNonparametricBenchmark,
  signTest,
  wilcoxonSignedRank,
  type NonparametricBenchmark,
  type NpDataset,
  type NpGroup,
  type NpResult,
} from './kernel';
