// ==========================================================================
// F6 Repro Lock — build / verify / drift localisation / reproduction tests
// ==========================================================================

import { describe, it, expect } from 'vitest';
import {
  buildLock,
  parseLock,
  lockToJson,
  verifyLock,
  reproduceWithLock,
  canonicalJson,
  TOLERANCE_CPU,
  TOLERANCE_GPU,
  type ReproLock,
} from '@/core/repro/lock';
import { createRunRecord, type RunRecord } from '@/core/experiment/record';
import { createEmptyProject, type Project } from '@/types/project';

function makeProject(): Project {
  const p = createEmptyProject('Repro Test');
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

describe('F6 buildLock', () => {
  it('writes the versioned lock schema with data/code/run sections', () => {
    const project = makeProject();
    const lock = buildLock(project, { runs: [makeRun({ projectId: project.id })] });
    expect(lock.schema).toBe('ergalics.repro-lock');
    expect(lock.lockVersion).toBe(1);
    expect(lock.projectId).toBe(project.id);
    expect(lock.data).toHaveLength(2);
    expect(lock.data[0].hash).toMatch(/^[0-9a-f]{8}$/);
    expect(lock.runs).toHaveLength(1);
    expect(lock.runs[0].paramsHash).toMatch(/^[0-9a-f]{8}$/);
    expect(lock.runs[0].seed).toBe(42);
    expect(lock.runs[0].tolerance).toBe(TOLERANCE_CPU);
    expect(lock.versions.studio).toBe('0.1.0');
  });

  it('excludes failed runs and honours the runIds subset', () => {
    const project = makeProject();
    const r1 = makeRun({ projectId: project.id });
    const r2 = makeRun({ projectId: project.id, failed: true });
    const r3 = makeRun({ projectId: project.id, source: 'code' });
    const lock = buildLock(project, { runs: [r1, r2, r3], runIds: [r1.id, r2.id] });
    expect(lock.runs.map((r) => r.id)).toEqual([r1.id]);
  });

  it('uses the wide GPU tolerance when a run reports a gpu engine', () => {
    const project = makeProject();
    const run = makeRun({ projectId: project.id, params: { engine: 'gpu' } });
    const lock = buildLock(project, { runs: [run] });
    expect(lock.runs[0].engine).toBe('gpu');
    expect(lock.runs[0].tolerance).toBe(TOLERANCE_GPU);
  });
});

describe('F6 verifyLock — five categories', () => {
  it('passes on the unchanged project', () => {
    const project = makeProject();
    const runs = [makeRun({ projectId: project.id })];
    const lock = buildLock(project, { runs });
    const result = verifyLock(lock, project, { runs });
    expect(result.status).toBe('pass');
    expect(result.compatible).toBe(true);
    expect(result.categories.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
    expect(result.runs[0].status).toBe('present');
  });

  it('AC1: FAILs and names the file when one data file changes; recovers after restore', () => {
    const project = makeProject();
    const runs = [makeRun({ projectId: project.id })];
    const lock = buildLock(project, { runs });
    const original = project.data.files[0].content;
    project.data.files[0].content = 'x\n1\n2\n999\n';

    let result = verifyLock(lock, project, { runs });
    expect(result.status).toBe('fail');
    const dataDrift = result.drifts.find((d) => d.category === 'data' && d.target === 'f1');
    expect(dataDrift?.kind).toBe('changed');
    expect(dataDrift?.message).toContain('a.csv');

    project.data.files[0].content = original;
    result = verifyLock(lock, project, { runs });
    expect(result.status).toBe('pass');
  });

  it('flags deleted files as missing (fail) and added files as warnings', () => {
    const project = makeProject();
    const lock = buildLock(project);
    project.data.files.splice(0, 1);
    let result = verifyLock(lock, project);
    expect(result.status).toBe('fail');
    expect(result.drifts.some((d) => d.category === 'data' && d.kind === 'missing' && d.target === 'f1')).toBe(true);

    // Rebuild baseline, then add an un-locked file.
    const lock2 = buildLock(project);
    project.data.files.push({
      id: 'f3', name: 'new.csv', size: 3, mimeType: 'text/csv', format: 'csv', content: 'z\n',
    });
    result = verifyLock(lock2, project);
    expect(result.status).toBe('warn');
    expect(result.drifts.some((d) => d.kind === 'added' && d.target === 'f3' && d.severity === 'warn')).toBe(true);
  });

  it('detects code drift in the flow graph but ignores notebook re-execution', () => {
    const project = makeProject();
    (project.state as { blockGraph?: unknown }).blockGraph = { nodes: [{ id: 'n1' }], edges: [] };
    (project.state as { notebook?: unknown }).notebook = {
      cells: [{ id: 'c1', type: 'code', source: 'print(1)', outputs: [] }],
    };
    const lock = buildLock(project);
    expect(lock.code.artifacts.map((a) => a.kind).sort()).toEqual(['flow-graph', 'notebook']);

    // Outputs change (re-run) but sources stay — lock must remain valid.
    (project.state as { notebook?: { cells: Array<{ outputs: unknown[] }> } }).notebook.cells[0].outputs =
      [{ text: 'new output' }];
    expect(verifyLock(lock, project).status).toBe('pass');

    // Editing the graph breaks the lock.
    (project.state as { blockGraph: { nodes: unknown[] } }).blockGraph.nodes.push({ id: 'n2' });
    const result = verifyLock(lock, project);
    expect(result.status).toBe('fail');
    expect(result.drifts.some((d) => d.category === 'code' && d.target === 'flow-graph:flow')).toBe(true);
  });

  it('flags changed run parameters and changed seeds separately', () => {
    const project = makeProject();
    const runs = [makeRun({ projectId: project.id })];
    const lock = buildLock(project, { runs });

    runs[0].params = { k: 4, threshold: 0.05 };
    let result = verifyLock(lock, project, { runs });
    expect(result.drifts.some((d) => d.category === 'params' && d.kind === 'changed')).toBe(true);

    runs[0].params = { k: 3, threshold: 0.05 };
    runs[0].seed = 99;
    result = verifyLock(lock, project, { runs });
    expect(result.status).toBe('fail');
    expect(result.drifts.some((d) => d.category === 'seed' && d.kind === 'changed')).toBe(true);
  });

  it('treats a missing run record as both params and seed failure', () => {
    const project = makeProject();
    const lock = buildLock(project, { runs: [makeRun({ projectId: project.id })] });
    const result = verifyLock(lock, project, { runs: [] });
    expect(result.status).toBe('fail');
    expect(result.drifts.filter((d) => d.target === lock.runs[0].id).map((d) => d.category).sort())
      .toEqual(['params', 'seed']);
    expect(result.runs[0].status).toBe('missing');
  });

  it('downgrades version skew (studio/plot/fonts) to a warning', () => {
    const project = makeProject();
    const lock = buildLock(project, {
      versions: { studio: '0.1.0', plotEngine: 'vega-5', fonts: ['Inter@3'] },
    });
    const result = verifyLock(lock, project, {
      versions: { studio: '0.2.0', plotEngine: 'vega-6', fonts: ['Inter@4'] },
    });
    expect(result.status).toBe('warn');
    const keys = result.drifts.map((d) => d.target).sort();
    expect(keys).toContain('studio');
    expect(keys).toContain('plotEngine');
    expect(keys).toContain('fonts');
  });

  it('refuses a lock written by a newer schema (FR6.2)', () => {
    const project = makeProject();
    const lock = buildLock(project);
    const future = { ...lock, lockVersion: 99 };
    const result = verifyLock(future, project);
    expect(result.status).toBe('fail');
    expect(result.compatible).toBe(false);
    expect(result.drifts.some((d) => d.kind === 'incompatible')).toBe(true);
  });
});

describe('F6 parseLock / serialisation', () => {
  it('round-trips through JSON', () => {
    const project = makeProject();
    const lock = buildLock(project, { runs: [makeRun({ projectId: project.id })] });
    const reparsed = parseLock(lockToJson(lock));
    expect(reparsed).toEqual(lock);
  });

  it('throws on invalid JSON or wrong schema', () => {
    expect(() => parseLock('{not json')).toThrow(/JSON/);
    expect(() => parseLock(JSON.stringify({ schema: 'other', lockVersion: 1 }))).toThrow(/schema/);
    expect(() => parseLock(JSON.stringify({ schema: 'ergalics.repro-lock' }))).toThrow(/lockVersion/);
  });
});

describe('F6 canonicalJson', () => {
  it('sorts object keys but preserves array order', () => {
    expect(canonicalJson({ a: 1, b: [2, 1] })).toBe(canonicalJson({ b: [2, 1], a: 1 }));
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });
});

describe('F6 reproduceWithLock (FR6.3)', () => {
  const baseRuns = (project: Project): RunRecord[] => [
    makeRun({ projectId: project.id }),
    makeRun({ projectId: project.id, id: undefined, source: 'code', label: 'code run', seed: 7 }),
  ];

  it('AC2: reruns mixed-source runs and PASSes identical metrics', async () => {
    const project = makeProject();
    const runs = baseRuns(project);
    const lock = buildLock(project, { runs });
    const report = await reproduceWithLock(lock, {
      runs,
      runners: {
        flow: async (r) => ({ metrics: { ...r.metrics } }),
        code: async (r) => ({ metrics: { ...r.metrics } }),
      },
    });
    expect(report.status).toBe('pass');
    expect(report.results).toHaveLength(2);
    expect(report.results.every((r) => r.status === 'pass')).toBe(true);
    // Extra metrics in the fresh run do not fail reproduction.
    expect(report.results[0].metrics.every((m) => m.relError === 0)).toBe(true);
  });

  it('FAILs a metric drifting beyond tolerance but accepts tiny float error', async () => {
    const project = makeProject();
    const runs = baseRuns(project);
    const lock = buildLock(project, { runs });
    const report = await reproduceWithLock(lock, {
      runs,
      runners: {
        flow: async () => ({ metrics: { r2: 0.9500000001, pValue: 0.5 } }),
        code: async (r) => ({ metrics: { ...r.metrics } }),
      },
    });
    expect(report.status).toBe('fail');
    const flow = report.results[0];
    const r2 = flow.metrics.find((m) => m.name === 'r2');
    const p = flow.metrics.find((m) => m.name === 'pValue');
    expect(r2?.status).toBe('pass');
    expect(p?.status).toBe('fail');
  });

  it('widens tolerance to 1e-6 for a GPU rerun', async () => {
    const project = makeProject();
    const gpuRun = makeRun({ projectId: project.id, params: { engine: 'gpu' } });
    const lock = buildLock(project, { runs: [gpuRun] });
    const report = await reproduceWithLock(lock, {
      runs: [gpuRun],
      runners: { flow: async () => ({ engine: 'gpu', metrics: { r2: 0.9500005, pValue: 0.001 } }) },
    });
    // 0.9500005 vs 0.95: rel error 5e-7 < 1e-6 → pass on GPU.
    expect(report.status).toBe('pass');
    expect(report.results[0].tolerance).toBe(TOLERANCE_GPU);
  });

  it('reports missing runs, missing runners and runner errors without crashing', async () => {
    const project = makeProject();
    const runs = baseRuns(project);
    const lock = buildLock(project, { runs });

    const noRuns = await reproduceWithLock(lock, { runs: [], runners: {} });
    expect(noRuns.results.every((r) => r.status === 'missing-run')).toBe(true);

    const noRunner = await reproduceWithLock(lock, { runs, runners: {} });
    expect(noRunner.results.some((r) => r.status === 'missing-runner')).toBe(true);

    const boom = await reproduceWithLock(lock, {
      runs,
      runners: {
        flow: async () => {
          throw new Error('kernel panic');
        },
        code: async (r) => ({ metrics: { ...r.metrics } }),
      },
    });
    expect(boom.results[0].status).toBe('error');
    expect(boom.results[0].error).toContain('kernel panic');
    expect(boom.status).toBe('fail');
  });

  it('runs sequentially and reports progress', async () => {
    const project = makeProject();
    const runs = baseRuns(project);
    const lock = buildLock(project, { runs });
    const order: number[] = [];
    await reproduceWithLock(lock, {
      runs,
      onProgress: (done) => order.push(done),
      runners: {
        flow: async (r) => ({ metrics: { ...r.metrics } }),
        code: async (r) => ({ metrics: { ...r.metrics } }),
      },
    });
    expect(order).toEqual([0, 1]);
  });

  it('honours aborts between runs', async () => {
    const project = makeProject();
    const runs = baseRuns(project);
    const lock = buildLock(project, { runs });
    const controller = new AbortController();
    await expect(
      reproduceWithLock(lock, {
        runs,
        runners: {
          flow: async (r) => ({ metrics: { ...r.metrics } }),
          code: async (r) => ({ metrics: { ...r.metrics } }),
        },
        signal: controller.signal,
      }).then(() => {
        controller.abort();
      }),
    ).resolves.toBeUndefined();
    await expect(
      reproduceWithLock(lock, {
        runs,
        signal: controller.signal,
        runners: {
          flow: async (r) => ({ metrics: { ...r.metrics } }),
          code: async (r) => ({ metrics: { ...r.metrics } }),
        },
      }),
    ).rejects.toThrow(DOMException);
  });
});

describe('F6 lock shape guards', () => {
  it('captures input file references per run', () => {
    const project = makeProject();
    const lock: ReproLock = buildLock(project, { runs: [makeRun({ projectId: project.id })] });
    expect(lock.runs[0].inputFileIds).toEqual(['f1']);
    expect(lock.code.hash).toMatch(/^[0-9a-f]{8}$/);
  });
});
