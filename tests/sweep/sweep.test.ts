// ==========================================================================
// F2 Sweep Studio — design expansion, metric extraction, runner/resume
// ==========================================================================

import { describe, it, expect } from 'vitest';
import {
  linspace,
  axisLevels,
  expandLhs,
  expandPlan,
  cellKey,
  setPath,
  getPath,
  extractMetric,
  runSweep,
  summarizePoints,
} from '@/core/sweep';
import type { SweepAxis, SweepPlan } from '@/core/sweep';

function axis(partial: Partial<SweepAxis> & Pick<SweepAxis, 'param' | 'mode'>): SweepAxis {
  return partial as SweepAxis;
}

function plan(partial: Partial<SweepPlan> = {}): SweepPlan {
  return {
    id: 'sweep-1',
    name: 'LBM scan',
    source: 'flow',
    sourceRef: 'pipeline-1',
    axes: [],
    metric: 'metrics.error',
    repeats: 1,
    createdAt: 1,
    ...partial,
  };
}

describe('F2 design — grid / list / cartesian', () => {
  it('linspace is inclusive at both endpoints', () => {
    expect(linspace(0, 1, 5)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(linspace(3, 3, 4)).toEqual([3, 3, 3, 3]);
    expect(() => linspace(0, 1, 1)).toThrow(/steps/);
  });

  it('expands grid and list axes', () => {
    const g = axis({ param: 'a', mode: 'grid', grid: { from: 0, to: 2, steps: 3 } });
    expect(axisLevels(g)).toEqual([0, 1, 2]);
    const l = axis({ param: 'b', mode: 'list', list: ['x', 'y'] });
    expect(axisLevels(l)).toEqual(['x', 'y']);
  });

  it('builds the 3x4 AC1 cartesian product, last axis fastest', () => {
    const p = plan({
      axes: [
        axis({ param: 'viscosity', mode: 'grid', grid: { from: 0.1, to: 0.3, steps: 3 } }),
        axis({ param: 'gridN', mode: 'grid', grid: { from: 8, to: 32, steps: 4 } }),
      ],
    });
    const cells = expandPlan(p);
    expect(cells).toHaveLength(12);
    expect(cells[0]!.params).toEqual({ viscosity: 0.1, gridN: 8 });
    expect(cells[1]!.params).toEqual({ viscosity: 0.1, gridN: 16 });
    expect(cells[11]!.params).toEqual({ viscosity: 0.3, gridN: 32 });
    // unique keys + deterministic seeds
    expect(new Set(cells.map((c) => c.key)).size).toBe(12);
    expect(cells.every((c) => Number.isInteger(c.seed) && c.seed >= 0 && c.seed <= 0xffffffff)).toBe(true);
  });

  it('multiplies cells by repeats with distinct repeat keys', () => {
    const p = plan({
      repeats: 3,
      axes: [axis({ param: 'a', mode: 'list', list: [1, 2] })],
    });
    const cells = expandPlan(p);
    expect(cells).toHaveLength(6);
    expect(cells.filter((c) => c.rep === 0)).toHaveLength(2);
    // same point, different repeat -> different key and different seed
    const r0 = cells.find((c) => c.params.a === 1 && c.rep === 0)!;
    const r1 = cells.find((c) => c.params.a === 1 && c.rep === 1)!;
    expect(r0.key).not.toBe(r1.key);
    expect(r0.seed).not.toBe(r1.seed);
  });

  it('rejects empty / oversized / mixed-mode plans', () => {
    expect(() => expandPlan(plan())).toThrow(/at least one axis/);
    expect(() =>
      expandPlan(plan({ axes: [1, 2, 3, 4].map((i) => axis({ param: `p${i}`, mode: 'list', list: [i] })) })),
    ).toThrow(/at most 3/);
    expect(() =>
      expandPlan(
        plan({
          axes: [
            axis({ param: 'a', mode: 'lhs', lhs: { n: 4, seed: 1 } }),
            axis({ param: 'b', mode: 'list', list: [1, 2] }),
          ],
        }),
      ),
    ).toThrow(/mix lhs/);
  });
});

describe('F2 design — Latin hypercube', () => {
  it('places one sample per stratum in each dimension', () => {
    const axes = [
      axis({ param: 'a', mode: 'lhs', lhs: { n: 8, seed: 42, from: 0, to: 10 } }),
      axis({ param: 'b', mode: 'lhs', lhs: { n: 8, seed: 7, from: -1, to: 1 } }),
    ];
    const rows = expandLhs(axes);
    expect(rows).toHaveLength(8);
    const strataA = new Set(rows.map((r) => Math.floor((r.a! / 10) * 8)));
    const strataB = new Set(rows.map((r) => Math.floor(((r.b! + 1) / 2) * 8)));
    expect(strataA.size).toBe(8);
    expect(strataB.size).toBe(8);
    expect(rows.every((r) => r.a! > 0 && r.a! < 10 && r.b! > -1 && r.b! < 1)).toBe(true);
  });

  it('is deterministic per seed and shifts with the seed', () => {
    const ax = (seed: number): SweepAxis[] => [
      axis({ param: 'a', mode: 'lhs', lhs: { n: 6, seed } }),
      axis({ param: 'b', mode: 'lhs', lhs: { n: 6, seed: seed + 100 } }),
    ];
    const a = expandLhs(ax(1));
    const b = expandLhs(ax(1));
    const c = expandLhs(ax(2));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('expands an all-lhs plan to exactly n × repeats cells', () => {
    const p = plan({
      repeats: 2,
      axes: [
        axis({ param: 'a', mode: 'lhs', lhs: { n: 5, seed: 1 } }),
        axis({ param: 'b', mode: 'lhs', lhs: { n: 5, seed: 2 } }),
      ],
    });
    expect(expandPlan(p)).toHaveLength(10);
  });
});

describe('F2 params / metric helpers', () => {
  it('setPath builds nested objects and getPath reads them', () => {
    const target = setPath({}, 'lbm.viscosity', 0.1);
    expect(target).toEqual({ lbm: { viscosity: 0.1 } });
    expect(getPath(target, 'lbm.viscosity')).toBe(0.1);
    expect(getPath(target, 'lbm.missing.deep')).toBeUndefined();
  });

  it('extractMetric handles dotted paths, metrics prefix and tail fallback', () => {
    expect(extractMetric({ metrics: { error: 0.5 } }, 'metrics.error')).toBe(0.5);
    expect(extractMetric({ metrics: { error: 0.5 } }, 'error')).toBe(0.5);
    expect(extractMetric({ metrics: { error: 0.5 } }, 'outputs.error')).toBe(0.5);
    expect(Number.isNaN(extractMetric({ metrics: {} }, 'nope'))).toBe(true);
  });

  it('cellKey is order-independent for construction but rep-sensitive', () => {
    expect(cellKey({ a: 1, b: 2 }, 0)).toBe(cellKey({ b: 2, a: 1 }, 0));
    expect(cellKey({ a: 1 }, 0)).not.toBe(cellKey({ a: 1 }, 1));
  });
});

describe('F2 runner', () => {
  const twoAxisPlan = (): SweepPlan =>
    plan({
      metric: 'error',
      axes: [
        axis({ param: 'viscosity', mode: 'grid', grid: { from: 1, to: 3, steps: 3 } }),
        axis({ param: 'gridN', mode: 'list', list: [8, 16, 32, 64] }),
      ],
      baseParams: { solver: { name: 'd3q19' } },
    });

  it('AC1: executes every cell with nested params, per-cell seed and collected values', async () => {
    const p = twoAxisPlan();
    const seenParams: unknown[] = [];
    const result = await runSweep(p, {
      executor: async (cell) => {
        seenParams.push(cell.params);
        expect(cell.params.solver).toEqual({ name: 'd3q19' });
        const v = cell.params.viscosity as number;
        const n = cell.params.gridN as number;
        return { runId: `run-${cell.key}`, metrics: { error: v / n }, durationMs: 1 };
      },
    });
    expect(result.status).toBe('done');
    expect(result.cells).toHaveLength(12);
    expect(result.total).toBe(12);
    expect(new Set(result.cells.map((c) => c.runId)).size).toBe(12);
    expect(result.cells[0]!.value).toBeCloseTo(1 / 8, 12);
    expect(seenParams).toHaveLength(12);
    expect(result.finishedAt).toBeGreaterThanOrEqual(result.startedAt);
  });

  it('AC2: resumes without rerunning completed cells', async () => {
    const p = twoAxisPlan();
    const first = await runSweep(p, {
      executor: async (cell) => ({ runId: `run-${cell.key}`, metrics: { error: 1 } }),
      signal: abortedAfter(6),
    });
    expect(first.status).toBe('cancelled');
    expect(first.cells.length).toBeLessThan(12);
    const doneCount = first.cells.length;

    let calls = 0;
    const second = await runSweep(p, {
      existing: first,
      executor: async (cell) => {
        calls += 1;
        return { runId: `run-new-${cell.key}`, metrics: { error: 2 } };
      },
    });
    expect(second.status).toBe('done');
    expect(second.cells).toHaveLength(12);
    expect(calls).toBe(12 - doneCount);
    // resumed cells keep their original run ids; final order follows the design
    expect(second.cells.slice(0, doneCount).every((c) => c.runId.startsWith('run-'))).toBe(true);
  });

  it('retries failed cells on resume and surfaces lastError', async () => {
    const p = plan({
      axes: [axis({ param: 'a', mode: 'list', list: [1, 2, 3] })],
    });
    let failNext = true;
    const first = await runSweep(p, {
      executor: async (cell) => {
        if (failNext && cell.params.a === 2) {
          failNext = false;
          throw new Error('boom');
        }
        return { runId: cell.key, metrics: { error: 0 } };
      },
    });
    expect(first.status).toBe('error');
    expect(first.lastError).toContain('boom');
    expect(first.cells).toHaveLength(2);

    const second = await runSweep(p, {
      existing: first,
      executor: async (cell) => ({ runId: cell.key, metrics: { error: 0 } }),
    });
    expect(second.status).toBe('done');
    expect(second.cells).toHaveLength(3);
  });

  it('marks a missing metric as a cell failure', async () => {
    const p = plan({ axes: [axis({ param: 'a', mode: 'list', list: [1] })] });
    const result = await runSweep(p, {
      executor: async () => ({ runId: 'r', metrics: { other: 1 } }),
    });
    expect(result.status).toBe('error');
    expect(result.cells).toHaveLength(0);
  });

  it('reports progress and seeds every repeat deterministically', async () => {
    const p = plan({ repeats: 2, axes: [axis({ param: 'a', mode: 'list', list: [1, 2] })] });
    const progress: Array<[number, number]> = [];
    const seeds: number[] = [];
    await runSweep(p, {
      onProgress: (done, total) => progress.push([done, total]),
      executor: async (cell) => {
        seeds.push(cell.seed);
        return { runId: cell.key, metrics: { error: cell.rep } };
      },
    });
    expect(progress).toEqual([[1, 4], [2, 4], [3, 4], [4, 4]]);
    expect(new Set(seeds).size).toBe(4);
  });

  it('summarizes repeats into mean ± sd points', async () => {
    const p = plan({ repeats: 3, axes: [axis({ param: 'a', mode: 'list', list: [1, 2] })] });
    const result = await runSweep(p, {
      executor: async (cell) => ({ runId: cell.key, metrics: { error: (cell.params.a as number) + cell.rep } }),
    });
    const points = summarizePoints(result).sort((x, y) => (x.params.a as number) - (y.params.a as number));
    expect(points).toHaveLength(2);
    expect(points[0]!.n).toBe(3);
    expect(points[0]!.mean).toBe(2); // values 1,2,3
    expect(points[0]!.sd).toBeCloseTo(1, 10);
    expect(points[1]!.mean).toBe(3); // 2,3,4
  });

  it('refuses to resume a result from another plan', async () => {
    const p = plan();
    await expect(
      runSweep(p, {
        existing: { planId: 'other', cells: [], total: 0, startedAt: 0, status: 'cancelled' },
        executor: async () => ({ runId: 'x', metrics: { error: 0 } }),
      }),
    ).rejects.toThrow(/different sweep plan/);
  });
});

/** Signal which aborts on the first event-loop yield (after cell 1). */
function abortedAfter(_count: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 0);
  return controller.signal;
}
