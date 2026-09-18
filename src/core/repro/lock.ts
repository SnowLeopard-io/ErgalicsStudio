// ==========================================================================
// Ergalics Studio — Repro Lock (pure TS)
//
// A repro lock freezes the things that decide "do we get the same numbers on
// another machine?": input DATA fingerprints, the CODE snapshot (flow graph /
// block+code sessions / notebook sources), run PARAMS, SEEDs, a VERSIONS
// manifest (studio, project format, plot engine, fonts, runtime) and — since
// lock v2 (FR-11) — a DEPENDENCIES fingerprint (key third-party engine
// versions + the app build hash). `buildLock` writes a versioned JSON
// document; `verifyLock` compares a project (+ its run records, kept in
// IndexedDB outside the project file) against a previously exported lock and
// localises every drift to one of the six categories. v1 locks still read:
// their missing v2 fields are treated as unknown and the result carries an
// `upgradeHint`. `reproduceWithLock` re-runs the locked runs through injected
// executors and asserts every scalar metric within tolerance (1e-9 same-engine
// CPU, 1e-6 for GPU / noisy sources). `diffRuns` produces the structured
// run-vs-run diff surfaced on the experiment page (FR-11).
// ==========================================================================

import { hashString } from './random';
import { fingerprint } from '@/core/chunked/reader';
import type { Project } from '@/types/project';
import type { RunRecord, RunSource } from '@/core/experiment/record';

export const LOCK_SCHEMA = 'ergalics.repro-lock';
/** Bumped on breaking schema changes only (FR6.2). v2 = FR-11 runtime + deps. */
export const LOCK_VERSION = 2;

/** Same-engine deterministic tolerance; GPU sources widen to 1e-6. */
export const TOLERANCE_CPU = 1e-9;
export const TOLERANCE_GPU = 1e-6;

// --------------------------------------------------------------------------
// Lock document types
// --------------------------------------------------------------------------

export interface LockVersions {
  studio: string;
  projectFormat: string;
  /** Plot/chart engine version (Figure Studio renderer). */
  plotEngine?: string;
  /** Font identity list (family + version/style hash). */
  fonts?: string[];
  /** Active plugin / mode versions. */
  plugins?: Record<string, string>;
  /**
   * v2 (FR-11): runtime versions that can silently change numerics —
   * browser engine, WASM toolchain / module revisions, Pyodide build.
   */
  runtime?: { browser?: string; wasm?: string; pyodide?: string };
}

/**
 * v2 (FR-11) dependency fingerprint entry.
 *
 * Collection scope: the numeric-critical third-party engines actually loaded
 * in the session (Pyodide, WASM kernels, TF backend, plot engine) supplied by
 * the caller, plus the studio app build hash appended by `buildLock` under
 * the reserved name `app`. Anything not listed is treated as *unknown* during
 * verification — never as a match.
 */
export interface LockDependency {
  name: string;
  version: string;
  hash?: string;
}

export interface LockDataFile {
  id: string;
  name: string;
  size: number;
  hash: string;
}

export type CodeArtifactKind =
  | 'flow-graph'
  | 'block-session'
  | 'code-session'
  | 'notebook';

export interface LockCodeArtifact {
  kind: CodeArtifactKind;
  id: string;
  /** Language for code sessions (python/r/js); undefined otherwise. */
  language?: string;
  hash: string;
}

export interface LockedRun {
  id: string;
  source: RunSource;
  label?: string;
  paramsHash: string;
  seed: number | null;
  inputFileIds: string[];
  inputsHash?: string;
  outputsHash?: string;
  /** Scalar metrics captured at lock time (reproduction targets). */
  metrics: Record<string, number>;
  /** Executing engine, when known — selects the comparison tolerance. */
  engine?: 'cpu' | 'gpu';
  tolerance: number;
  createdAt: number;
}

export interface ReproLock {
  schema: typeof LOCK_SCHEMA;
  lockVersion: number;
  projectId: string;
  projectName: string;
  createdAt: string;
  versions: LockVersions;
  data: LockDataFile[];
  code: {
    hash: string;
    artifacts: LockCodeArtifact[];
  };
  runs: LockedRun[];
  /** v2 (FR-11): third-party engine versions + the `app` build-hash entry. */
  dependencies?: LockDependency[];
}

export interface BuildLockOptions {
  /** Runs belonging to the project (IndexedDB `runs` store). */
  runs?: RunRecord[];
  /** Restrict the lock to these run ids (default: all). */
  runIds?: string[];
  versions?: Partial<LockVersions>;
  /** Override the stored tolerance of a run (e.g. mark a stochastic source). */
  runTolerance?: (run: RunRecord) => number | undefined;
  /**
   * v2: caller-collected dependency fingerprints (numeric-critical engines).
   * `buildLock` sorts them and appends the reserved `app` build-hash entry.
   */
  dependencies?: LockDependency[];
  /** v2: override the app build hash embedded as the `app` dependency. */
  buildHash?: string;
  now?: Date;
}

// --------------------------------------------------------------------------
// Canonical hashing
// --------------------------------------------------------------------------

/** Deterministic JSON.stringify with object keys sorted. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

function canonicalHash(value: unknown): string {
  return hashString(canonicalJson(value));
}

// --------------------------------------------------------------------------
// Code snapshot
// --------------------------------------------------------------------------

interface NotebookShape {
  cells?: Array<{ type?: string; source?: string }>;
}

/** Extract the reproducible code surface of a project as hashable units. */
export function collectCodeArtifacts(project: Project): LockCodeArtifact[] {
  const artifacts: LockCodeArtifact[] = [];
  const state = project.state ?? {};

  if (state.blockGraph) {
    artifacts.push({ kind: 'flow-graph', id: 'flow', hash: canonicalHash(state.blockGraph) });
  }

  for (const session of state.editorSessions ?? []) {
    const kind: CodeArtifactKind = session.mode === 'block' ? 'block-session' : 'code-session';
    // Hash the executable surface: IR is the source of truth; include the
    // visual graph states and last code text so any edit surface drift counts.
    artifacts.push({
      kind,
      id: session.id,
      language: session.language,
      hash: canonicalHash({
        ir: session.ir,
        lastCode: session.lastCode ?? '',
        blockGraph: session.blockGraph ?? null,
        flowGraph: session.flowGraph ?? null,
      }),
    });
  }

  const notebook = state.notebook as NotebookShape | null | undefined;
  if (notebook && Array.isArray(notebook.cells) && notebook.cells.length > 0) {
    // Sources only — execution outputs must not invalidate the lock.
    const sources = notebook.cells.map((c, i) => `${i}:${c.type ?? ''}:${c.source ?? ''}`);
    artifacts.push({ kind: 'notebook', id: 'notebook', hash: hashString(sources.join('\n')) });
  }

  return artifacts;
}

function aggregateCodeHash(artifacts: LockCodeArtifact[]): string {
  return hashString(
    artifacts
      .map((a) => `${a.kind}:${a.id}:${a.language ?? ''}:${a.hash}`)
      .sort()
      .join('\n'),
  );
}

function runEngine(run: RunRecord): 'cpu' | 'gpu' | undefined {
  const engine = (run.params as Record<string, unknown>)?.engine;
  return engine === 'gpu' ? 'gpu' : engine === 'cpu' ? 'cpu' : undefined;
}

// --------------------------------------------------------------------------
// Dependency fingerprint (v2)
// --------------------------------------------------------------------------

/** Reserved dependency name for the studio app build itself. */
export const APP_DEPENDENCY_NAME = 'app';

/**
 * Default app build hash: the vite-injected `__APP_VERSION__` (falls back to
 * the package.json version under vitest, which does not apply `define`).
 * Callers with a real content hash (e.g. a CI artifact digest) override it via
 * `BuildLockOptions.buildHash`.
 */
export function appBuildHash(): string {
  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.1.0';
  return hashString(`ergalics-studio@${version}`);
}

/** Normalise a dependency list: sorted by name, duplicate names keep first. */
function normalizeDependencies(deps: LockDependency[]): LockDependency[] {
  const byName = new Map<string, LockDependency>();
  for (const d of deps) if (!byName.has(d.name)) byName.set(d.name, { ...d });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// --------------------------------------------------------------------------
// buildLock
// --------------------------------------------------------------------------

/**
 * Build a repro lock for the given project. Runs live outside the project
 * (IndexedDB) and must be supplied by the caller; pass `runIds` to lock a
 * subset.
 */
export function buildLock(project: Project, options: BuildLockOptions = {}): ReproLock {
  const allRuns = options.runs ?? [];
  const idSet = options.runIds ? new Set(options.runIds) : null;
  const runs = allRuns
    .filter((r) => r.projectId === project.id && (!idSet || idSet.has(r.id)))
    .filter((r) => !r.failed);

  const data: LockDataFile[] = (project.data?.files ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    size: f.size ?? (f.content ?? '').length,
    hash: fingerprint(f.content ?? ''),
  }));

  const artifacts = collectCodeArtifacts(project);

  const versions: LockVersions = {
    studio: options.versions?.studio ?? '0.1.0',
    projectFormat:
      options.versions?.projectFormat ?? project.metadata?.version ?? '1.0',
    plotEngine: options.versions?.plotEngine,
    fonts: options.versions?.fonts ? [...options.versions.fonts].sort() : undefined,
    plugins: options.versions?.plugins
      ? Object.fromEntries(Object.entries(options.versions.plugins).sort(([a], [b]) => a.localeCompare(b)))
      : undefined,
    runtime: options.versions?.runtime ? { ...options.versions.runtime } : undefined,
  };

  // v2: caller-collected engine versions + the reserved `app` build-hash entry.
  const dependencies = normalizeDependencies([
    ...(options.dependencies ?? []),
    { name: APP_DEPENDENCY_NAME, version: options.buildHash ?? appBuildHash() },
  ]);

  const lockedRuns: LockedRun[] = runs.map((run) => {
    const engine = runEngine(run);
    const defaultTolerance = engine === 'gpu' ? TOLERANCE_GPU : TOLERANCE_CPU;
    return {
      id: run.id,
      source: run.source,
      label: run.label,
      paramsHash: canonicalHash(run.params ?? {}),
      seed: run.seed ?? null,
      inputFileIds: [...run.inputFileIds],
      inputsHash: run.inputsHash,
      outputsHash: run.outputsHash,
      metrics: { ...run.metrics },
      engine,
      tolerance: options.runTolerance?.(run) ?? defaultTolerance,
      createdAt: run.createdAt,
    };
  });

  return {
    schema: LOCK_SCHEMA,
    lockVersion: LOCK_VERSION,
    projectId: project.id,
    projectName: project.name,
    createdAt: (options.now ?? new Date()).toISOString(),
    versions,
    data,
    code: { hash: aggregateCodeHash(artifacts), artifacts },
    runs: lockedRuns,
    dependencies,
  };
}

/** Serialise a lock to pretty JSON. */
export function lockToJson(lock: ReproLock): string {
  return JSON.stringify(lock, null, 2);
}

/** Parse + structurally validate a lock document. Throws on bad schema. */
export function parseLock(raw: string): ReproLock {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`repro lock is not valid JSON: ${(err as Error).message}`);
  }
  const lock = parsed as Partial<ReproLock> | null;
  if (!lock || typeof lock !== 'object' || lock.schema !== LOCK_SCHEMA) {
    throw new Error(`repro lock schema mismatch (expected ${LOCK_SCHEMA})`);
  }
  if (typeof lock.lockVersion !== 'number' || lock.lockVersion < 1) {
    throw new Error('repro lock missing lockVersion');
  }
  if (typeof lock.projectId !== 'string' || !Array.isArray(lock.data) || !Array.isArray(lock.runs)) {
    throw new Error('repro lock is missing required sections');
  }
  return lock as ReproLock;
}

// --------------------------------------------------------------------------
// verifyLock
// --------------------------------------------------------------------------

export type LockCategory = 'data' | 'code' | 'params' | 'seed' | 'versions' | 'dependency';
export type LockDriftKind = 'changed' | 'missing' | 'added' | 'incompatible';

export interface LockDrift {
  category: LockCategory;
  kind: LockDriftKind;
  /** Stable target identifier: file id, artifact kind:id, run id, version key. */
  target: string;
  /** Human-readable detail. */
  message: string;
  expected?: string;
  actual?: string;
  /** Added files / newer versions are warnings, not hard failures. */
  severity: 'fail' | 'warn';
  /** v2: actionable advice surfaced next to dependency drifts (FR-11). */
  suggestion?: string;
}

export interface LockCategoryResult {
  category: LockCategory;
  /** 'unknown' = a v1 lock never recorded this category; nothing to compare. */
  status: 'pass' | 'warn' | 'fail' | 'unknown';
  drifts: LockDrift[];
}

export interface LockRunPresence {
  id: string;
  status: 'present' | 'missing';
}

export interface LockVerifyResult {
  /** fail = reproducibility broken; warn = likely fine, review advised. */
  status: 'pass' | 'warn' | 'fail';
  compatible: boolean;
  categories: LockCategoryResult[];
  drifts: LockDrift[];
  runs: LockRunPresence[];
  /** v2: true when the lock is a v1 document that should be rebuilt/upgraded. */
  upgradeHint: boolean;
}

export interface VerifyLockOptions {
  /** Current run records (params/seed comparison). */
  runs?: RunRecord[];
  /** Current version environment; defaults reuse lock-time studio version. */
  versions?: Partial<LockVersions>;
  /** v2: current dependency fingerprints (omit = unknown, never a match). */
  dependencies?: LockDependency[];
}

const CATEGORY_ORDER: LockCategory[] = ['data', 'code', 'params', 'seed', 'versions', 'dependency'];

function categoryResult(
  category: LockCategory,
  drifts: LockDrift[],
  status?: 'unknown',
): LockCategoryResult {
  const hasFail = drifts.some((d) => d.severity === 'fail');
  const hasWarn = drifts.some((d) => d.severity === 'warn');
  return {
    category,
    status: status ?? (hasFail ? 'fail' : hasWarn ? 'warn' : 'pass'),
    drifts,
  };
}

const DEPENDENCY_SUGGESTION =
  'restore the locked runtime (pin package/engine versions or reinstall the studio build recorded in the lock) before trusting new numbers';

/**
 * v2 dependency comparison. Entries are keyed by name; a version change or a
 * hash change is a drift. Locked deps the current environment cannot report
 * are *unknown* (warn) — silently skipping them would hide real drift.
 */
function dependencyDrifts(
  lock: ReproLock,
  current: LockDependency[] | undefined,
): { drifts: LockDrift[]; unknown: boolean } {
  const drifts: LockDrift[] = [];
  const locked = lock.dependencies ?? [];
  // Nothing to compare when the lock has no fingerprint (v1) or the current
  // environment does not report one — mark the category unknown, never pass.
  if (locked.length === 0 || current === undefined) return { drifts, unknown: true };
  const currentByName = new Map((current ?? []).map((d) => [d.name, d]));
  let unknown = false;
  for (const dep of locked) {
    const now = currentByName.get(dep.name);
    if (!now) {
      unknown = true;
      drifts.push({
        category: 'dependency',
        kind: 'missing',
        target: dep.name,
        message: `dependency "${dep.name}" (locked ${dep.version}) cannot be checked — current version unknown`,
        expected: dep.version,
        severity: 'warn',
        suggestion: DEPENDENCY_SUGGESTION,
      });
      continue;
    }
    if (now.version !== dep.version || (dep.hash && now.hash && now.hash !== dep.hash)) {
      drifts.push({
        category: 'dependency',
        kind: 'changed',
        target: dep.name,
        message: `dependency "${dep.name}" drifted since the lock was built`,
        expected: dep.hash ? `${dep.version}#${dep.hash}` : dep.version,
        actual: now.hash ? `${now.version}#${now.hash}` : now.version,
        severity: 'warn',
        suggestion: DEPENDENCY_SUGGESTION,
      });
    }
  }
  for (const dep of current ?? []) {
    if (!locked.some((d) => d.name === dep.name)) {
      drifts.push({
        category: 'dependency',
        kind: 'added',
        target: dep.name,
        message: `dependency "${dep.name}" (${dep.version}) is not covered by the lock`,
        severity: 'warn',
      });
    }
  }
  return { drifts, unknown };
}

/**
 * Compare a lock against the current project state. Pure: never executes
 * anything. Missing/changed data or code is a hard failure; version skew and
 * newly added files are warnings.
 */
export function verifyLock(
  lock: ReproLock,
  project: Project,
  options: VerifyLockOptions = {},
): LockVerifyResult {
  const drifts: LockDrift[] = [];
  const compatible = lock.lockVersion <= LOCK_VERSION;

  // --- versions -----------------------------------------------------------
  if (!compatible) {
    drifts.push({
      category: 'versions',
      kind: 'incompatible',
      target: 'lockVersion',
      message: `lock was written by a newer, incompatible lock format (v${lock.lockVersion})`,
      expected: `<= v${LOCK_VERSION}`,
      actual: `v${lock.lockVersion}`,
      severity: 'fail',
    });
  }
  if (lock.projectId !== project.id) {
    drifts.push({
      category: 'versions',
      kind: 'changed',
      target: 'projectId',
      message: 'lock was built for a different project',
      expected: lock.projectId,
      actual: project.id,
      severity: 'fail',
    });
  }
  const currentVersions: LockVersions = {
    studio: options.versions?.studio ?? lock.versions.studio,
    projectFormat: options.versions?.projectFormat ?? project.metadata?.version ?? '1.0',
    plotEngine: options.versions?.plotEngine,
    fonts: options.versions?.fonts ? [...options.versions.fonts].sort() : undefined,
    plugins: options.versions?.plugins,
    runtime: options.versions?.runtime,
  };
  const compareVersion = (key: keyof LockVersions, expected: unknown, actual: unknown): void => {
    if (actual === undefined) return; // environment not reported
    if (key === 'fonts' || key === 'plugins' || key === 'runtime') {
      if (canonicalHash(expected) !== canonicalHash(actual)) {
        drifts.push({
          category: 'versions',
          kind: 'changed',
          target: key,
          message: `${key} manifest differs from the lock`,
          expected: canonicalHash(expected),
          actual: canonicalHash(actual),
          severity: 'warn',
        });
      }
    } else if (expected !== actual) {
      drifts.push({
        category: 'versions',
        kind: 'changed',
        target: key,
        message: `${key} differs from the lock`,
        expected: String(expected),
        actual: String(actual),
        severity: 'warn',
      });
    }
  };
  compareVersion('studio', lock.versions.studio, currentVersions.studio);
  compareVersion('projectFormat', lock.versions.projectFormat, currentVersions.projectFormat);
  compareVersion('plotEngine', lock.versions.plotEngine, currentVersions.plotEngine);
  compareVersion('fonts', lock.versions.fonts, currentVersions.fonts);
  compareVersion('plugins', lock.versions.plugins, currentVersions.plugins);
  // v1 locks never recorded a runtime; do not invent drift for a missing field.
  if (lock.versions.runtime !== undefined) {
    compareVersion('runtime', lock.versions.runtime, currentVersions.runtime);
  }

  // --- data ---------------------------------------------------------------
  const currentFiles = new Map((project.data?.files ?? []).map((f) => [f.id, f]));
  const lockedFileIds = new Set(lock.data.map((f) => f.id));
  for (const locked of lock.data) {
    const current = currentFiles.get(locked.id);
    if (!current) {
      drifts.push({
        category: 'data',
        kind: 'missing',
        target: locked.id,
        message: `data file "${locked.name}" is missing`,
        expected: locked.hash,
        severity: 'fail',
      });
      continue;
    }
    const actualHash = fingerprint(current.content ?? '');
    if (actualHash !== locked.hash) {
      drifts.push({
        category: 'data',
        kind: 'changed',
        target: locked.id,
        message: `data file "${current.name}" changed since the lock was built`,
        expected: locked.hash,
        actual: actualHash,
        severity: 'fail',
      });
    }
  }
  for (const f of project.data?.files ?? []) {
    if (!lockedFileIds.has(f.id)) {
      drifts.push({
        category: 'data',
        kind: 'added',
        target: f.id,
        message: `new data file "${f.name}" is not covered by the lock`,
        severity: 'warn',
      });
    }
  }

  // --- code ---------------------------------------------------------------
  const currentArtifacts = collectCodeArtifacts(project);
  const artifactKey = (a: LockCodeArtifact): string => `${a.kind}:${a.id}`;
  const currentByKey = new Map(currentArtifacts.map((a) => [artifactKey(a), a]));
  for (const locked of lock.code.artifacts) {
    const key = artifactKey(locked);
    const current = currentByKey.get(key);
    if (!current) {
      drifts.push({
        category: 'code',
        kind: 'missing',
        target: key,
        message: `${locked.kind} "${locked.id}" is missing`,
        expected: locked.hash,
        severity: 'fail',
      });
    } else if (current.hash !== locked.hash) {
      drifts.push({
        category: 'code',
        kind: 'changed',
        target: key,
        message: `${locked.kind} "${locked.id}" changed since the lock was built`,
        expected: locked.hash,
        actual: current.hash,
        severity: 'fail',
      });
    }
  }
  const lockedKeys = new Set(lock.code.artifacts.map(artifactKey));
  for (const artifact of currentArtifacts) {
    if (!lockedKeys.has(artifactKey(artifact))) {
      drifts.push({
        category: 'code',
        kind: 'added',
        target: artifactKey(artifact),
        message: `${artifact.kind} "${artifact.id}" is not covered by the lock`,
        severity: 'warn',
      });
    }
  }

  // --- params + seed (+ run presence) ------------------------------------
  const runsById = new Map((options.runs ?? []).map((r) => [r.id, r]));
  const presence: LockRunPresence[] = [];
  for (const locked of lock.runs) {
    const run = runsById.get(locked.id);
    presence.push({ id: locked.id, status: run ? 'present' : 'missing' });
    if (!run) {
      drifts.push({
        category: 'params',
        kind: 'missing',
        target: locked.id,
        message: `run "${locked.label ?? locked.id}" (${locked.source}) record is missing`,
        severity: 'fail',
      });
      drifts.push({
        category: 'seed',
        kind: 'missing',
        target: locked.id,
        message: `run "${locked.label ?? locked.id}" seed cannot be checked (record missing)`,
        severity: 'fail',
      });
      continue;
    }
    const paramsHash = canonicalHash(run.params ?? {});
    if (paramsHash !== locked.paramsHash) {
      drifts.push({
        category: 'params',
        kind: 'changed',
        target: locked.id,
        message: `run "${run.label ?? run.id}" parameters changed since the lock was built`,
        expected: locked.paramsHash,
        actual: paramsHash,
        severity: 'fail',
      });
    }
    const actualSeed = run.seed ?? null;
    if (actualSeed !== locked.seed) {
      drifts.push({
        category: 'seed',
        kind: 'changed',
        target: locked.id,
        message: `run "${run.label ?? run.id}" seed changed`,
        expected: String(locked.seed),
        actual: String(actualSeed),
        severity: 'fail',
      });
    }
  }

  // --- dependencies (v2) ---------------------------------------------------
  const { drifts: depDrifts, unknown: depUnknown } = dependencyDrifts(lock, options.dependencies);
  drifts.push(...depDrifts);
  // A v1 lock recorded no dependency fingerprint — report it as unknown rather
  // than a false pass, and hint the user to rebuild the lock.
  const upgradeHint = lock.lockVersion < LOCK_VERSION;

  const categories = CATEGORY_ORDER.map((category) =>
    categoryResult(
      category,
      drifts.filter((d) => d.category === category),
      category === 'dependency' && depUnknown && depDrifts.length === 0 ? 'unknown' : undefined,
    ),
  );
  const hasFail = drifts.some((d) => d.severity === 'fail');
  const hasWarn = drifts.some((d) => d.severity === 'warn');
  return {
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    compatible,
    categories,
    drifts,
    runs: presence,
    upgradeHint,
  };
}

// --------------------------------------------------------------------------
// reproduceWithLock
// --------------------------------------------------------------------------

export type LockMetricStatus = 'pass' | 'fail' | 'extra';

export interface LockMetricResult {
  name: string;
  expected?: number;
  actual: number;
  absError: number;
  relError: number;
  tolerance: number;
  status: LockMetricStatus;
}

export type LockRunReproStatus =
  | 'pass'
  | 'fail'
  | 'missing-run'
  | 'missing-runner'
  | 'error';

export interface LockRunReproResult {
  runId: string;
  source: RunSource;
  status: LockRunReproStatus;
  tolerance: number;
  engine?: 'cpu' | 'gpu';
  metrics: LockMetricResult[];
  error?: string;
  durationMs: number;
}

export interface LockReproReport {
  status: 'pass' | 'fail';
  results: LockRunReproResult[];
  durationMs: number;
}

/** Executor for one run source; returns the fresh scalar metrics. */
export type LockRunner = (run: RunRecord) => Promise<{
  metrics: Record<string, number>;
  engine?: 'cpu' | 'gpu';
}>;

export interface ReproduceLockOptions {
  runs: RunRecord[];
  runners: Partial<Record<RunSource, LockRunner>>;
  onProgress?: (done: number, total: number, current: LockedRun) => void;
  signal?: AbortSignal;
}

/** |a - b| / max(1, |b|) — scale-free, well-behaved near zero. */
export function relativeMetricError(expected: number, actual: number): {
  abs: number;
  rel: number;
} {
  const abs = Math.abs(actual - expected);
  return { abs, rel: abs / Math.max(1, Math.abs(expected)) };
}

/**
 * Re-execute every locked run (sequentially, single-flight) through the
 * injected source runners and assert each locked metric is within tolerance.
 * GPU reruns automatically widen the tolerance to at least TOLERANCE_GPU.
 */
export async function reproduceWithLock(
  lock: ReproLock,
  options: ReproduceLockOptions,
): Promise<LockReproReport> {
  const started = performance.now();
  const runsById = new Map(options.runs.map((r) => [r.id, r]));
  const results: LockRunReproResult[] = [];

  for (let i = 0; i < lock.runs.length; i += 1) {
    const locked = lock.runs[i];
    if (!locked) continue;
    options.signal?.throwIfAborted();
    options.onProgress?.(i, lock.runs.length, locked);
    const runStarted = performance.now();

    const run = runsById.get(locked.id);
    if (!run) {
      results.push({
        runId: locked.id,
        source: locked.source,
        status: 'missing-run',
        tolerance: locked.tolerance,
        metrics: [],
        durationMs: performance.now() - runStarted,
      });
      continue;
    }
    const runner = options.runners[run.source];
    if (!runner) {
      results.push({
        runId: locked.id,
        source: locked.source,
        status: 'missing-runner',
        tolerance: locked.tolerance,
        metrics: [],
        durationMs: performance.now() - runStarted,
      });
      continue;
    }

    try {
      const fresh = await runner(run);
      // GPU reruns are only deterministic to ~1e-6.
      const tolerance = fresh.engine === 'gpu' ? Math.max(locked.tolerance, TOLERANCE_GPU) : locked.tolerance;
      const metricResults: LockMetricResult[] = [];
      for (const [name, expected] of Object.entries(locked.metrics)) {
        const actual = fresh.metrics[name];
        if (typeof actual !== 'number' || !Number.isFinite(actual)) {
          metricResults.push({
            name,
            expected,
            actual: Number.NaN,
            absError: Number.POSITIVE_INFINITY,
            relError: Number.POSITIVE_INFINITY,
            tolerance,
            status: 'fail',
          });
          continue;
        }
        const { abs, rel } = relativeMetricError(expected, actual);
        metricResults.push({
          name,
          expected,
          actual,
          absError: abs,
          relError: rel,
          tolerance,
          status: rel <= tolerance || abs <= tolerance ? 'pass' : 'fail',
        });
      }
      for (const [name, actual] of Object.entries(fresh.metrics)) {
        if (!(name in locked.metrics)) {
          metricResults.push({
            name,
            actual,
            absError: 0,
            relError: 0,
            tolerance: locked.tolerance,
            status: 'extra',
          });
        }
      }
      const failed = metricResults.some((m) => m.status === 'fail');
      results.push({
        runId: locked.id,
        source: run.source,
        status: failed ? 'fail' : 'pass',
        tolerance,
        engine: fresh.engine,
        metrics: metricResults,
        durationMs: performance.now() - runStarted,
      });
    } catch (err) {
      results.push({
        runId: locked.id,
        source: run.source,
        status: 'error',
        tolerance: locked.tolerance,
        metrics: [],
        error: (err as Error).message,
        durationMs: performance.now() - runStarted,
      });
    }
  }

  return {
    status: results.every((r) => r.status === 'pass') ? 'pass' : 'fail',
    results,
    durationMs: performance.now() - started,
  };
}

// --------------------------------------------------------------------------
// Structured run diff (FR-11)
// --------------------------------------------------------------------------

export interface RunParamChange {
  key: string;
  /** undefined = key only present in the other run. */
  a: unknown;
  b: unknown;
  kind: 'changed' | 'added' | 'removed';
}

export interface RunMetricChange {
  key: string;
  a?: number;
  b?: number;
  delta: number;
  /** Max relative/absolute error between the two values (see relativeMetricError). */
  relError: number;
  absError: number;
  /** True when the two values agree within `tolerance` (treated as equal). */
  withinTolerance: boolean;
  tolerance: number;
}

export interface RunConfigChange {
  key: string;
  a: unknown;
  b: unknown;
}

export interface RunDiff {
  runA: { id: string; label?: string; source: RunSource; createdAt: number };
  runB: { id: string; label?: string; source: RunSource; createdAt: number };
  params: RunParamChange[];
  metrics: RunMetricChange[];
  /** Non-repro environment differences (seed, inputs, duration, engine…). */
  config: RunConfigChange[];
  sameInputs: boolean;
  sameParams: boolean;
  tolerance: number;
}

export interface DiffRunsOptions {
  /** Metric equality tolerance; defaults to TOLERANCE_CPU (deterministic CPU). */
  tolerance?: number;
}

/**
 * Structured diff between two runs (FR-11): parameter changes, metric changes
 * annotated with a numeric tolerance, and configuration differences (seed,
 * input fingerprint, engine, duration). Key sets are unioned + sorted so the
 * diff is stable regardless of insertion order.
 */
export function diffRuns(a: RunRecord, b: RunRecord, options: DiffRunsOptions = {}): RunDiff {
  const tolerance = options.tolerance ?? TOLERANCE_CPU;

  const params: RunParamChange[] = [];
  const paramKeys = [...new Set([...Object.keys(a.params ?? {}), ...Object.keys(b.params ?? {})])].sort();
  for (const key of paramKeys) {
    const va = a.params?.[key];
    const vb = b.params?.[key];
    if (canonicalJson(va ?? null) === canonicalJson(vb ?? null)) continue;
    const kind: RunParamChange['kind'] =
      va === undefined ? 'added' : vb === undefined ? 'removed' : 'changed';
    params.push({ key, a: va, b: vb, kind });
  }

  const metrics: RunMetricChange[] = [];
  const metricKeys = [...new Set([...Object.keys(a.metrics ?? {}), ...Object.keys(b.metrics ?? {})])].sort();
  for (const key of metricKeys) {
    const va = a.metrics?.[key];
    const vb = b.metrics?.[key];
    if (va === undefined || vb === undefined) {
      metrics.push({
        key,
        a: va,
        b: vb,
        delta: (vb ?? 0) - (va ?? 0),
        relError: Number.POSITIVE_INFINITY,
        absError: Number.POSITIVE_INFINITY,
        withinTolerance: false,
        tolerance,
      });
      continue;
    }
    if (va === vb) continue;
    const { abs, rel } = relativeMetricError(va, vb);
    // Values differing below tolerance are listed but flagged as agreeing —
    // hiding them would make a float-noisy pair look identical.
    metrics.push({
      key,
      a: va,
      b: vb,
      delta: vb - va,
      relError: rel,
      absError: abs,
      withinTolerance: rel <= tolerance || abs <= tolerance,
      tolerance,
    });
  }

  const config: RunConfigChange[] = [];
  const configFields: Array<[string, unknown, unknown]> = [
    ['source', a.source, b.source],
    ['seed', a.seed, b.seed],
    ['inputsHash', a.inputsHash, b.inputsHash],
    ['outputsHash', a.outputsHash, b.outputsHash],
    ['engine', a.params?.engine, b.params?.engine],
    ['durationMs', a.durationMs, b.durationMs],
    ['failed', a.failed ?? false, b.failed ?? false],
  ];
  for (const [key, va, vb] of configFields) {
    if (canonicalJson(va ?? null) !== canonicalJson(vb ?? null)) {
      config.push({ key, a: va ?? null, b: vb ?? null });
    }
  }

  return {
    runA: { id: a.id, label: a.label, source: a.source, createdAt: a.createdAt },
    runB: { id: b.id, label: b.label, source: b.source, createdAt: b.createdAt },
    params,
    metrics,
    config,
    sameInputs: a.inputsHash !== undefined && a.inputsHash === b.inputsHash,
    sameParams: params.length === 0,
    tolerance,
  };
}

/** Serialise a run diff for export (FR-11). */
export function runDiffToJson(diff: RunDiff): string {
  return JSON.stringify(diff, null, 2);
}

const DIFF_LABELS = {
  zh: {
    title: '运行对比',
    params: '参数差异',
    metrics: '指标差异',
    config: '配置差异',
    none: '无差异',
    changed: '变更',
    added: '新增',
    removed: '移除',
    inputsSame: '输入相同',
    inputsDiff: '输入不同',
  },
  en: {
    title: 'Run comparison',
    params: 'Parameter differences',
    metrics: 'Metric differences',
    config: 'Configuration differences',
    none: 'none',
    changed: 'changed',
    added: 'added',
    removed: 'removed',
    inputsSame: 'same inputs',
    inputsDiff: 'different inputs',
  },
} as const;

function fmtDiffValue(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(Number(v.toPrecision(6))) : String(v);
  if (v === undefined) return '—';
  try {
    return JSON.stringify(v) ?? '—';
  } catch {
    return String(v);
  }
}

/**
 * Render a run diff as readable text (FR-11). `lang` accepts 'zh' | 'en';
 * anything else falls back to English.
 */
export function formatRunDiff(diff: RunDiff, lang: 'zh' | 'en' | string = 'en'): string {
  const labels = lang === 'zh' ? DIFF_LABELS.zh : DIFF_LABELS.en;
  const lines: string[] = [];
  lines.push(`# ${labels.title}`);
  lines.push(`A: ${diff.runA.label ?? diff.runA.id} (${diff.runA.source}) @ ${new Date(diff.runA.createdAt).toISOString()}`);
  lines.push(`B: ${diff.runB.label ?? diff.runB.id} (${diff.runB.source}) @ ${new Date(diff.runB.createdAt).toISOString()}`);
  lines.push(diff.sameInputs ? labels.inputsSame : labels.inputsDiff);

  lines.push('');
  lines.push(`## ${labels.params}`);
  if (diff.params.length === 0) lines.push(labels.none);
  for (const p of diff.params) {
    const tag = p.kind === 'added' ? labels.added : p.kind === 'removed' ? labels.removed : labels.changed;
    lines.push(`- [${tag}] ${p.key}: ${fmtDiffValue(p.a)} -> ${fmtDiffValue(p.b)}`);
  }

  lines.push('');
  lines.push(`## ${labels.metrics}`);
  if (diff.metrics.length === 0) lines.push(labels.none);
  for (const m of diff.metrics) {
    const flag = m.withinTolerance ? ' [≈tol]' : '';
    lines.push(
      `- ${m.key}: ${fmtDiffValue(m.a)} -> ${fmtDiffValue(m.b)} (delta ${fmtDiffValue(m.delta)}, rel ${m.relError.toExponential(2)}, tol ${m.tolerance.toExponential(0)})${flag}`,
    );
  }

  lines.push('');
  lines.push(`## ${labels.config}`);
  if (diff.config.length === 0) lines.push(labels.none);
  for (const c of diff.config) {
    lines.push(`- ${c.key}: ${fmtDiffValue(c.a)} -> ${fmtDiffValue(c.b)}`);
  }
  return lines.join('\n');
}
