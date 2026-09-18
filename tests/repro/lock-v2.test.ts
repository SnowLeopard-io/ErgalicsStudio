// ==========================================================================
// FR-11 Repro Lock v2 — runtime/dependency fingerprint, v1 compatibility,
// dependency drift, structured run diff (diffRuns / formatRunDiff).
// ==========================================================================

import { describe, it, expect } from 'vitest';
import {
  buildLock,
  parseLock,
  lockToJson,
  verifyLock,
  diffRuns,
  runDiffToJson,
  formatRunDiff,
  appBuildHash,
  APP_DEPENDENCY_NAME,
  LOCK_VERSION,
  TOLERANCE_CPU,
  type ReproLock,
  type LockDependency,
} from '@/core/repro/lock';
import { createRunRecord, type RunRecord } from '@/core/experiment/record';
import { createEmptyProject, type Project } from '@/types/project';

function makeProject(): Project {
  const p = createEmptyProject('Lock v2 Test');
  p.data.files = [
    { id: 'f1', name: 'a.csv', size: 8, mimeType: 'text/csv', format: 'csv', content: 'x\n1\n2\n3\n' },
    { id: 'f2', name: 'b.csv', size: 8, mimeType: 'text/csv', format: 'csv', content: 'y\n4\n5\n6\n' },
  ];
  return p;
}

function makeRun(partial: Partial<RunRecord> = {}): RunRecord {
  return createRunRecord({
    projectId: 'project-x',
    source: 'flow',
    label: 'flow run',
    params: { k: 3, threshold: 0.05 },
    inputFileIds: ['f1'],
    metrics: { r2: 0.95, pValue: 0.001 },
    seed: 42,
    durationMs: 12,
    ...partial,
  });
}

const DEPS: LockDependency[] = [
  { name: 'pyodide', version: '0.26.1' },
  { name: 'duckdb-wasm', version: '1.33.1', hash: 'abcd1234' },
];

/** Strip the v2-only fields to simulate a legacy v1 lock document. */
function toV1(lock: ReproLock): ReproLock {
  const v1 = JSON.parse(lockToJson(lock)) as ReproLock & { dependencies?: unknown };
  v1.lockVersion = 1;
  delete v1.dependencies;
  delete v1.versions.runtime;
  return v1;
}

// --------------------------------------------------------------------------
// buildLock v2
// --------------------------------------------------------------------------

describe('FR-11 buildLock v2', () => {
  it('writes lockVersion 2 with a dependencies section', () => {
    const project = makeProject();
    const lock = buildLock(project, { runs: [makeRun({ projectId: project.id })] });
    expect(lock.lockVersion).toBe(LOCK_VERSION);
    expect(lock.lockVersion).toBe(2);
    expect(Array.isArray(lock.dependencies)).toBe(true);
  });

  it('always appends the reserved `app` build-hash entry', () => {
    const project = makeProject();
    const lock = buildLock(project, { dependencies: DEPS });
    const app = lock.dependencies?.find((d) => d.name === APP_DEPENDENCY_NAME);
    expect(app).toBeDefined();
    expect(app!.version).toMatch(/^[0-9a-f]{8}$/);
  });

  it('honours the buildHash override for the app entry', () => {
    const project = makeProject();
    const lock = buildLock(project, { buildHash: 'deadbeef' });
    expect(lock.dependencies?.find((d) => d.name === APP_DEPENDENCY_NAME)?.version).toBe('deadbeef');
  });

  it('sorts dependencies by name and keeps first on duplicate names', () => {
    const project = makeProject();
    const lock = buildLock(project, {
      dependencies: [
        { name: 'webgpu', version: '1' },
        { name: 'pyodide', version: '0.26.1' },
        { name: 'pyodide', version: 'WRONG' },
      ],
    });
    const names = lock.dependencies!.map((d) => d.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    const pyodides = lock.dependencies!.filter((d) => d.name === 'pyodide');
    expect(pyodides).toHaveLength(1);
    expect(pyodides[0]!.version).toBe('0.26.1');
  });

  it('records runtime versions in the versions manifest', () => {
    const project = makeProject();
    const lock = buildLock(project, {
      versions: { runtime: { browser: 'Chrome/128', wasm: 'wasm-2.0', pyodide: '0.26.1' } },
    });
    expect(lock.versions.runtime?.browser).toBe('Chrome/128');
    expect(lock.versions.runtime?.pyodide).toBe('0.26.1');
  });

  it('appBuildHash is a stable 8-hex string', () => {
    expect(appBuildHash()).toMatch(/^[0-9a-f]{8}$/);
    expect(appBuildHash()).toBe(appBuildHash());
  });

  it('round-trips the v2 document through JSON', () => {
    const project = makeProject();
    const lock = buildLock(project, { dependencies: DEPS });
    expect(parseLock(lockToJson(lock))).toEqual(lock);
  });
});

// --------------------------------------------------------------------------
// v1 compatibility
// --------------------------------------------------------------------------

describe('FR-11 verifyLock v1 compatibility', () => {
  it('reads a v1 lock, marks it compatible and hints an upgrade', () => {
    const project = makeProject();
    const runs = [makeRun({ projectId: project.id })];
    const v1 = toV1(buildLock(project, { runs }));
    const result = verifyLock(v1, project, { runs });
    expect(result.compatible).toBe(true);
    expect(result.upgradeHint).toBe(true);
  });

  it('reports the dependency category as unknown for v1 locks (no drift)', () => {
    const project = makeProject();
    const runs = [makeRun({ projectId: project.id })];
    const v1 = toV1(buildLock(project, { runs }));
    const result = verifyLock(v1, project, { runs });
    const dep = result.categories.find((c) => c.category === 'dependency');
    expect(dep?.status).toBe('unknown');
    expect(result.drifts.some((d) => d.category === 'dependency')).toBe(false);
    expect(result.status).toBe('pass');
  });

  it('a v2 lock verified against its own environment carries no upgrade hint', () => {
    const project = makeProject();
    const runs = [makeRun({ projectId: project.id })];
    const lock = buildLock(project, { runs, dependencies: DEPS });
    const result = verifyLock(lock, project, { runs, dependencies: lock.dependencies });
    expect(result.upgradeHint).toBe(false);
    expect(result.status).toBe('pass');
    expect(result.categories.find((c) => c.category === 'dependency')?.status).toBe('pass');
  });
});

// --------------------------------------------------------------------------
// Dependency drift
// --------------------------------------------------------------------------

describe('FR-11 dependency drift detection', () => {
  const base = () => {
    const project = makeProject();
    const runs = [makeRun({ projectId: project.id })];
    const lock = buildLock(project, { runs, dependencies: DEPS });
    return { project, runs, lock };
  };

  it('flags a changed dependency version as a warn drift with a suggestion', () => {
    const { project, runs, lock } = base();
    const drifted = lock.dependencies!.map((d) =>
      d.name === 'pyodide' ? { ...d, version: '0.27.0' } : d,
    );
    const result = verifyLock(lock, project, { runs, dependencies: drifted });
    const drift = result.drifts.find((d) => d.category === 'dependency' && d.target === 'pyodide');
    expect(drift?.kind).toBe('changed');
    expect(drift?.severity).toBe('warn');
    expect(drift?.expected).toBe('0.26.1');
    expect(drift?.actual).toBe('0.27.0');
    expect(drift?.suggestion).toBeTruthy();
    expect(result.status).toBe('warn');
  });

  it('marks locked dependencies the environment cannot report as unknown (warn)', () => {
    const { project, runs, lock } = base();
    const partial = lock.dependencies!.filter((d) => d.name !== 'duckdb-wasm');
    const result = verifyLock(lock, project, { runs, dependencies: partial });
    const drift = result.drifts.find((d) => d.category === 'dependency' && d.target === 'duckdb-wasm');
    expect(drift?.kind).toBe('missing');
    expect(drift?.severity).toBe('warn');
    expect(result.categories.find((c) => c.category === 'dependency')?.status).toBe('warn');
  });

  it('warns about new dependencies not covered by the lock', () => {
    const { project, runs, lock } = base();
    const current = [...lock.dependencies!, { name: 'tensorflow', version: '4.22.0' }];
    const result = verifyLock(lock, project, { runs, dependencies: current });
    expect(
      result.drifts.some((d) => d.category === 'dependency' && d.kind === 'added' && d.target === 'tensorflow'),
    ).toBe(true);
  });

  it('detects a hash-only change even when the version string matches', () => {
    const { project, runs, lock } = base();
    const current = lock.dependencies!.map((d) =>
      d.name === 'duckdb-wasm' ? { ...d, hash: 'ffffffff' } : d,
    );
    const result = verifyLock(lock, project, { runs, dependencies: current });
    expect(
      result.drifts.some((d) => d.category === 'dependency' && d.target === 'duckdb-wasm' && d.kind === 'changed'),
    ).toBe(true);
  });

  it('passes when the reported environment matches the lock exactly', () => {
    const { project, runs, lock } = base();
    const result = verifyLock(lock, project, { runs, dependencies: lock.dependencies });
    expect(result.drifts.filter((d) => d.category === 'dependency')).toHaveLength(0);
  });

  it('compares runtime versions in the versions category', () => {
    const project = makeProject();
    const lock = buildLock(project, { versions: { runtime: { wasm: 'wasm-2.0' } } });
    const result = verifyLock(lock, project, { versions: { runtime: { wasm: 'wasm-3.0' } } });
    expect(
      result.drifts.some((d) => d.category === 'versions' && d.target === 'runtime'),
    ).toBe(true);
  });
});

// --------------------------------------------------------------------------
// diffRuns / formatRunDiff / runDiffToJson
// --------------------------------------------------------------------------

describe('FR-11 diffRuns', () => {
  it('detects changed, added and removed parameters', () => {
    const a = makeRun({ params: { k: 3, s: 'x' } });
    const b = makeRun({ params: { k: 4, w: true } });
    const diff = diffRuns(a, b);
    expect(diff.params.find((p) => p.key === 'k')?.kind).toBe('changed');
    expect(diff.params.find((p) => p.key === 's')?.kind).toBe('removed');
    expect(diff.params.find((p) => p.key === 'w')?.kind).toBe('added');
    expect(diff.sameParams).toBe(false);
  });

  it('reports no parameter differences for identical params (order-insensitive)', () => {
    const a = makeRun({ params: { a: 1, b: 'x' } });
    const b = makeRun({ params: { b: 'x', a: 1 } });
    const diff = diffRuns(a, b);
    expect(diff.params).toHaveLength(0);
    expect(diff.sameParams).toBe(true);
  });

  it('computes metric deltas and errors', () => {
    const a = makeRun({ metrics: { r2: 0.9, loss: 1.0 } });
    const b = makeRun({ metrics: { r2: 0.8, loss: 1.0 } });
    const diff = diffRuns(a, b);
    const r2 = diff.metrics.find((m) => m.key === 'r2');
    expect(r2?.delta).toBeCloseTo(-0.1);
    expect(r2?.relError).toBeGreaterThan(0);
    expect(r2?.withinTolerance).toBe(false);
    expect(diff.metrics.some((m) => m.key === 'loss')).toBe(false);
  });

  it('lists float-noise metrics but flags them within tolerance', () => {
    const a = makeRun({ metrics: { r2: 0.95 } });
    const b = makeRun({ metrics: { r2: 0.9500000001 } });
    const diff = diffRuns(a, b);
    const r2 = diff.metrics.find((m) => m.key === 'r2');
    expect(r2).toBeDefined();
    expect(r2!.withinTolerance).toBe(true);
    expect(r2!.tolerance).toBe(TOLERANCE_CPU);
  });

  it('honours a custom tolerance', () => {
    const a = makeRun({ metrics: { v: 1.0 } });
    const b = makeRun({ metrics: { v: 1.001 } });
    expect(diffRuns(a, b).metrics.find((m) => m.key === 'v')?.withinTolerance).toBe(false);
    expect(
      diffRuns(a, b, { tolerance: 1e-2 }).metrics.find((m) => m.key === 'v')?.withinTolerance,
    ).toBe(true);
  });

  it('flags metrics present in only one run as infinite error', () => {
    const a = makeRun({ metrics: { extra: 5 } });
    const b = makeRun({ metrics: {} });
    const extra = diffRuns(a, b).metrics.find((m) => m.key === 'extra');
    expect(extra?.a).toBe(5);
    expect(extra?.b).toBeUndefined();
    expect(extra?.withinTolerance).toBe(false);
    expect(Number.isFinite(extra!.relError)).toBe(false);
  });

  it('surfaces configuration differences (seed, inputs, duration)', () => {
    const a = makeRun({ seed: 42, inputsHash: 'aaa11111', durationMs: 12 });
    const b = makeRun({ seed: 7, inputsHash: 'bbb22222', durationMs: 12 });
    const diff = diffRuns(a, b);
    expect(diff.config.find((c) => c.key === 'seed')).toBeDefined();
    expect(diff.config.find((c) => c.key === 'inputsHash')).toBeDefined();
    expect(diff.config.some((c) => c.key === 'durationMs')).toBe(false);
    expect(diff.sameInputs).toBe(false);
  });

  it('marks sameInputs when both runs share the input fingerprint', () => {
    const a = makeRun({ inputsHash: 'same-hash' });
    const b = makeRun({ inputsHash: 'same-hash' });
    expect(diffRuns(a, b).sameInputs).toBe(true);
  });

  it('carries run identities for the diff header', () => {
    const a = makeRun({ label: 'first' });
    const b = makeRun({ label: 'second', source: 'code' });
    const diff = diffRuns(a, b);
    expect(diff.runA.id).toBe(a.id);
    expect(diff.runA.label).toBe('first');
    expect(diff.runB.source).toBe('code');
  });
});

describe('FR-11 formatRunDiff / export', () => {
  const sample = () =>
    diffRuns(
      makeRun({ params: { k: 3 }, metrics: { r2: 0.9 }, seed: 42 }),
      makeRun({ params: { k: 4 }, metrics: { r2: 0.8 }, seed: 7 }),
    );

  it('renders English sections', () => {
    const text = formatRunDiff(sample(), 'en');
    expect(text).toContain('Parameter differences');
    expect(text).toContain('Metric differences');
    expect(text).toContain('Configuration differences');
    expect(text).toContain('k: 3 -> 4');
  });

  it('renders Chinese sections', () => {
    const text = formatRunDiff(sample(), 'zh');
    expect(text).toContain('参数差异');
    expect(text).toContain('指标差异');
    expect(text).toContain('配置差异');
  });

  it('shows the no-difference marker for an empty diff', () => {
    const r = makeRun();
    expect(formatRunDiff(diffRuns(r, r), 'en')).toContain('none');
  });

  it('exports a JSON-serialisable diff that round-trips', () => {
    const diff = sample();
    const parsed = JSON.parse(runDiffToJson(diff));
    expect(parsed).toEqual(diff);
    expect(parsed.params.length).toBeGreaterThan(0);
  });
});
