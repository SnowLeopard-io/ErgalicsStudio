// ==========================================================================
// Ergalics Studio — Repro Lock (pure TS)
//
// A repro lock freezes the four things that decide "do we get the same
// numbers on another machine?": input DATA fingerprints, the CODE snapshot
// (flow graph / block+code sessions / notebook sources), run PARAMS, and
// SEEDs — plus a VERSIONS manifest (studio, project format, plot engine,
// fonts). `buildLock` writes a versioned JSON document; `verifyLock` compares
// a project (+ its run records, kept in IndexedDB outside the project file)
// against a previously exported lock and localises every drift to one of
// the five categories. `reproduceWithLock` re-runs the locked runs through
// injected executors and asserts every scalar metric within tolerance
// (1e-9 same-engine CPU, 1e-6 for GPU / noisy sources).
// ==========================================================================

import { hashString } from './random';
import { fingerprint } from '@/core/chunked/reader';
import type { Project } from '@/types/project';
import type { RunRecord, RunSource } from '@/core/experiment/record';

export const LOCK_SCHEMA = 'ergalics.repro-lock';
/** Bumped on breaking schema changes only (FR6.2). */
export const LOCK_VERSION = 1;

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
}

export interface BuildLockOptions {
  /** Runs belonging to the project (IndexedDB `runs` store). */
  runs?: RunRecord[];
  /** Restrict the lock to these run ids (default: all). */
  runIds?: string[];
  versions?: Partial<LockVersions>;
  /** Override the stored tolerance of a run (e.g. mark a stochastic source). */
  runTolerance?: (run: RunRecord) => number | undefined;
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
  };

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

export type LockCategory = 'data' | 'code' | 'params' | 'seed' | 'versions';
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
}

export interface LockCategoryResult {
  category: LockCategory;
  status: 'pass' | 'warn' | 'fail';
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
}

export interface VerifyLockOptions {
  /** Current run records (params/seed comparison). */
  runs?: RunRecord[];
  /** Current version environment; defaults reuse lock-time studio version. */
  versions?: Partial<LockVersions>;
}

const CATEGORY_ORDER: LockCategory[] = ['data', 'code', 'params', 'seed', 'versions'];

function categoryResult(category: LockCategory, drifts: LockDrift[]): LockCategoryResult {
  const hasFail = drifts.some((d) => d.severity === 'fail');
  const hasWarn = drifts.some((d) => d.severity === 'warn');
  return {
    category,
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    drifts,
  };
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
  };
  const compareVersion = (key: keyof LockVersions, expected: unknown, actual: unknown): void => {
    if (actual === undefined) return; // environment not reported
    if (key === 'fonts' || key === 'plugins') {
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

  const categories = CATEGORY_ORDER.map((category) =>
    categoryResult(category, drifts.filter((d) => d.category === category)),
  );
  const hasFail = drifts.some((d) => d.severity === 'fail');
  const hasWarn = drifts.some((d) => d.severity === 'warn');
  return {
    status: hasFail ? 'fail' : hasWarn ? 'warn' : 'pass',
    compatible,
    categories,
    drifts,
    runs: presence,
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
