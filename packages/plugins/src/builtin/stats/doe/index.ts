// Lazy-load entry for the DOE plugin.
export { default } from './plugin';
export { statsDoeManifest } from './manifest';
export {
  codeDesign,
  doeBenchmark,
  doeFromTable,
  factorEffects,
  fitDoe,
  orthogonalityDefect,
  parseDoeTable,
  taguchiSN,
  type AnovaRow,
  type CodedDesign,
  type CoefRow,
  type DoeBenchmark,
  type DoeDataset,
  type DoeFit,
  type DoeRow,
} from './kernel';
