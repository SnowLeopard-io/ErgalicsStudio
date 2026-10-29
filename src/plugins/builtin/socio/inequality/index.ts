// Lazy-load entry for the socio-inequality plugin.
export { default } from './plugin';
export { inequalityManifest } from './manifest';
export {
  applyTax,
  atkinsonIndex,
  classifyInequality,
  gini,
  giniBootstrapCI,
  giniExact,
  giniFromLorenz,
  generateIncomes,
  identifyDistribution,
  lognormalGini,
  lorenzArea,
  lorenzCurve,
  palmaRatio,
  paretoGini,
  percentile,
  runInequalityBenchmark,
  simulateMobility,
  theilIndex,
} from './kernel';
