// Lazy-load entry for the econ-evogame plugin.
export { default } from './plugin';
export { evogameManifest } from './manifest';
export {
  cellScore,
  classifyRegime,
  coopFraction,
  payoff,
  runEvogameBenchmark,
  simulate,
  stepAsync,
  stepSync,
} from './kernel';
