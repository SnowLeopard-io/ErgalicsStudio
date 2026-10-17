// Lazy-load entry for the psych-rt plugin.
export { default } from './plugin';
export { rtManifest } from './manifest';
export {
  betai,
  cohensD,
  filterOutliers,
  parseRtData,
  runRtBenchmark,
  summarize,
  tQuantile,
  tTwoTailedP,
  welchTest,
} from './kernel';
