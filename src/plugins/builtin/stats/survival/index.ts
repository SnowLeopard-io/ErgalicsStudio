// Lazy-load entry for the survival statistics plugin.
export { default } from './plugin';
export { statsSurvivalManifest } from './manifest';
export {
  coxPH,
  kaplanMeier,
  logRank,
  parseSurvival,
  runSurvivalBenchmark,
  type CoxResult,
  type CoxTerm,
  type KmCurve,
  type KmPoint,
  type LogRankResult,
  type SurvivalBenchmark,
  type SurvivalDataset,
} from './kernel';
