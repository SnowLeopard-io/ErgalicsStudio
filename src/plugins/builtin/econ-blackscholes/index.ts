// Lazy-load entry for the econ-blackscholes plugin.
export { default } from './plugin';
export { blackscholesManifest } from './manifest';
export {
  bsGreeks,
  bsPrices,
  mcPrices,
  parityResidual,
  runBlackscholesBenchmark,
  stdNormCdf,
} from './kernel';
