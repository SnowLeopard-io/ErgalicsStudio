// ==========================================================================
// Ergalics Studio — science build system (public surface)
//
// Incremental, content-addressed computation for the workbench:
//   hash      → deterministic, cross-platform content fingerprints
//   plan      → serializable DAG + topo/cycle/impact algorithms
//   key       → step cache keys (kind + params + upstream keys + env)
//   codec     → bit-exact persistence of DataValue
//   cache     → memory LRU / IndexedDB stores
//   engine    → wavefront scheduler with hits, recompute and provenance
//   adapter   → plug a compiled block region into the engine
// ==========================================================================

export { ContentHasher, canonicalize, hashColumn, hashDataValue, hashDataset, hashTable, hashValue } from './hash';
export {
  BuildPlanError,
  affectedBy,
  planFingerprint,
  previewAffected,
  reverseDependencies,
  stepDependencies,
  topoSort,
  upstreamOf,
  type BuildPlan,
  type BuildStep,
  type BuildTopology,
} from './plan';
export {
  BUILD_KEY_SCHEMA,
  computeStepKey,
  createBuildEnvironment,
  environmentFingerprint,
  volatileStepKey,
  type BuildEnvironment,
  type StepKeyBreakdown,
} from './key';
export {
  base64ToBytes,
  bytesToBase64,
  decodeColumnData,
  decodeDataValue,
  decodeUnknown,
  encodeColumnData,
  encodeDataValue,
  encodeUnknown,
  estimateEncodedSize,
  type EncodedColumn,
  type EncodedColumnData,
  type EncodedDataset,
  type EncodedScalar,
  type EncodedTable,
  type EncodedValue,
} from './codec';
export {
  IndexedDbBuildCache,
  MemoryBuildCache,
  createBuildCache,
  deleteBuildCacheDatabase,
  type BuildCache,
  type BuildCacheStats,
  type CacheEntry,
  type CacheLimits,
} from './cache';
export {
  BuildAbortedError,
  BuildEngine,
  BuildStepError,
  type BuildEngineOptions,
  type BuildRunOptions,
  type BuildRunResult,
  type BuildStats,
  type StepDecision,
  type StepDecisionStatus,
  type StepRunContext,
  type StepRunOutput,
  type StepRunner,
} from './engine';
export { compiledRegionToPlan, createBlockRunner, runCompiledRegion, type BlockRunnerHooks } from './blockAdapter';
