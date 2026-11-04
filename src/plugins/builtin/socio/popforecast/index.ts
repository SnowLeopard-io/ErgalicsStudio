// Lazy-load entry for the socio-popforecast plugin.
export { default } from './plugin';
export { popForecastManifest } from './manifest';
export {
  ageStructure,
  buildLeslie,
  buildLeslieMatrix,
  classifyAging,
  dominantEigen,
  fertilitySchedule,
  growthRate,
  initialPopulation,
  migrationVector,
  project,
  runPopForecastBenchmark,
  simulatePopForecast,
  survivalSchedule,
  totalPopulation,
  DEFAULT_POP_PARAMS,
  POP_BENCHMARK,
  type PopForecastParams,
  type PopRun,
} from './kernel';
