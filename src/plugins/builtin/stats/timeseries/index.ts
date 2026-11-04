// Lazy-load entry for the time-series statistics plugin.
export { default } from './plugin';
export { statsTimeseriesManifest } from './manifest';
export {
  acf,
  adfTest,
  fitArima,
  fitGarch11,
  forecastArima,
  grangerCausality,
  kpssTest,
  pacf,
  parseSeries,
  ppTest,
  runTimeSeriesBenchmark,
  seasonalDecompose,
  type AcfPoint,
  type ArimaModel,
  type Decomposition,
  type ForecastPoint,
  type GarchFit,
  type GrangerResult,
  type SeriesData,
  type TimeSeriesBenchmark,
  type UnitRootTest,
} from './kernel';
