// ==========================================================================
// Ergalics Studio — reproducibility (seeds, run manifest, Python export)
// ==========================================================================

export {
  mulberry32,
  randomSeed,
  setSeed,
  currentSeed,
  seededRandom,
  hashString,
} from './random';
export {
  createManifest,
  manifestToText,
  type RunManifest,
  type ManifestInput,
  type ManifestBlock,
} from './manifest';
export {
  dagToPython,
  topoSort,
  type ExportNode,
  type ExportGraph,
} from './exporter';
export {
  LOCK_SCHEMA,
  LOCK_VERSION,
  TOLERANCE_CPU,
  TOLERANCE_GPU,
  APP_DEPENDENCY_NAME,
  appBuildHash,
  buildLock,
  lockToJson,
  parseLock,
  verifyLock,
  reproduceWithLock,
  collectCodeArtifacts,
  canonicalJson,
  relativeMetricError,
  diffRuns,
  runDiffToJson,
  formatRunDiff,
  type ReproLock,
  type LockVersions,
  type LockDependency,
  type LockDataFile,
  type LockCodeArtifact,
  type LockedRun,
  type BuildLockOptions,
  type LockCategory,
  type LockDrift,
  type LockDriftKind,
  type LockCategoryResult,
  type LockVerifyResult,
  type VerifyLockOptions,
  type LockRunner,
  type LockRunReproResult,
  type LockMetricResult,
  type LockReproReport,
  type ReproduceLockOptions,
  type RunDiff,
  type RunParamChange,
  type RunMetricChange,
  type RunConfigChange,
  type DiffRunsOptions,
} from './lock';
export {
  buildReproSnapshot,
  SNAPSHOT_SCHEMA,
  type SnapshotInput,
  type SnapshotProjectSummary,
} from './snapshot';
