// Lazy-load entry for the stats-zipf plugin.
export { default } from './plugin';
export { statsZipfManifest } from './manifest';
export {
  analyzeZipf,
  countFrequencies,
  fitZipf,
  olsFit,
  parseFrequencyPairs,
  parseZipfUpload,
  rankByFrequency,
  runZipfBenchmark,
  synthZipfText,
  tokenize,
  tokenizeCjk,
  tokenizeEnglish,
  type FitOptions,
  type OlsFit,
  type RankedWord,
  type TokenizerMode,
  type ZipfAnalysis,
  type ZipfBenchmark,
  type ZipfFit,
} from './kernel';
