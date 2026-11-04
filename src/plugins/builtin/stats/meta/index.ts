// Lazy-load entry for the meta-analysis statistics plugin.
export { default } from './plugin';
export { statsMetaManifest } from './manifest';
export {
  metaAnalyze,
  parseMeta,
  runMetaBenchmark,
  type MetaBenchmark,
  type MetaDataset,
  type MetaPooled,
  type MetaResult,
  type MetaStudy,
} from './kernel';
