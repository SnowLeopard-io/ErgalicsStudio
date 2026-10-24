// ==========================================================================
// Sweep Studio — draft ↔ plan mapping, field-level validation, boundary
// caps and response-surface derivation (pure domain extracted from the page).
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { expandPlan } from '@/core/sweep/design';
import type { SweepPlan, SweepResult } from '@/core/sweep/types';
import {
  buildPlanDraft,
  draftFromPlan,
  resultMatchesPlan,
  MAX_SWEEP_CELLS,
} from '@/pages/sweeps/draft';
import type { AxisDraft, PlanDraft } from '@/pages/sweeps/draft';
import { buildSurface, heatColor } from '@/pages/sweeps/surface';

function axis(partial: Partial<AxisDraft> = {}): AxisDraft {
  return {
    param: 'a',
    mode: 'grid',
    from: '0',
    to: '1',
    steps: '5',
    list: '0.1, 0.2',
    n: '8',
    seed: '42',
    ...partial,
  };
}

function draft(partial: Partial<PlanDraft> = {}): PlanDraft {
  return {
    name: 'test',
    source: 'flow',
    sourceRef: '',
    metric: 'value',
    expression: 'p.a',
    repeats: '1',
    baseParams: '{}',
    axes: [axis()],
    ...partial,
  };
}

function issueFields(built: ReturnType<typeof buildPlanDraft>): string[] {
  return built.issues.map((i) => i.field);
}

describe('draft ↔ plan mapping', () => {
  it('round-trips a persisted grid plan', () => {
    const plan: SweepPlan = {
      id: 'p1',
      name: 'scan',
      source: 'flow',
      sourceRef: 'pipe-1',
      axes: [{ param: 'a', mode: 'grid', grid: { from: 0, to: 2, steps: 3 } }],
      metric: 'metrics.error',
      expression: 'p.a * 2',
      repeats: 2,
      baseParams: { x: 1 },
      createdAt: 5,
    };
    const rebuilt = buildPlanDraft(draftFromPlan(plan), { id: plan.id, createdAt: plan.createdAt });
    expect(rebuilt.plan).not.toBeNull();
    expect(rebuilt.plan?.repeats).toBe(2);
    expect(rebuilt.plan?.baseParams).toEqual({ x: 1 });
    expect(rebuilt.plan?.metric).toBe('metrics.error');
    expect(rebuilt.plan?.expression).toBe('p.a * 2');
    expect(rebuilt.plan?.axes[0]?.grid).toEqual({ from: 0, to: 2, steps: 3 });
    expect(rebuilt.plan?.createdAt).toBe(5);
  });

  it('builds a valid grid draft and expands repeats × cells', () => {
    const built = buildPlanDraft(draft({ repeats: '3' }), { id: 'p2', createdAt: 1 });
    expect(built.issues).toEqual([]);
    expect(built.plan?.id).toBe('p2');
    expect(expandPlan(built.plan!)).toHaveLength(15);
  });

  it('accepts list and lhs axes', () => {
    const listBuilt = buildPlanDraft(
      draft({ axes: [axis({ mode: 'list', list: '1, x, 2' })] }),
      { id: 'p3' },
    );
    expect(listBuilt.plan?.axes[0]?.list).toEqual([1, 'x', 2]);

    const lhsBuilt = buildPlanDraft(
      draft({
        axes: [
          axis({ param: 'a', mode: 'lhs', n: '4', seed: '1', from: '0', to: '1' }),
          axis({ param: 'b', mode: 'lhs', n: '4', seed: '2', from: '0', to: '2' }),
        ],
      }),
      { id: 'p4' },
    );
    expect(lhsBuilt.issues).toEqual([]);
    expect(lhsBuilt.plan?.axes).toHaveLength(2);
    expect(expandPlan(lhsBuilt.plan!)).toHaveLength(4);
  });
});

describe('draft validation', () => {
  it('requires at least one axis and rejects too many', () => {
    expect(buildPlanDraft(draft({ axes: [] }), { id: 'x' }).issues[0]?.key).toBe(
      'sweep.err_axes_empty',
    );
    const tooMany = buildPlanDraft(
      draft({ axes: [axis({ param: 'a' }), axis({ param: 'b' }), axis({ param: 'c' }), axis({ param: 'd' })] }),
      { id: 'x' },
    );
    expect(issueFields(tooMany)).toContain('axes');
    expect(tooMany.issues.some((i) => i.key === 'sweep.err_axes_max')).toBe(true);
  });

  it('validates grid bounds and steps', () => {
    const badBounds = buildPlanDraft(
      draft({ axes: [axis({ from: 'oops', to: 'inf!', steps: '1' })] }),
      { id: 'x' },
    );
    expect(issueFields(badBounds)).toContain('axes.0.from');
    expect(issueFields(badBounds)).toContain('axes.0.to');
    expect(issueFields(badBounds)).toContain('axes.0.steps');
  });

  it('rejects empty lists and bad lhs n', () => {
    const emptyList = buildPlanDraft(draft({ axes: [axis({ mode: 'list', list: ' , ' })] }), { id: 'x' });
    expect(issueFields(emptyList)).toContain('axes.0.list');

    const badLhs = buildPlanDraft(
      draft({ axes: [axis({ mode: 'lhs', n: '0', seed: 'x' })] }),
      { id: 'x' },
    );
    expect(issueFields(badLhs)).toContain('axes.0.n');
    expect(issueFields(badLhs)).toContain('axes.0.seed');
  });

  it('validates parameter paths, duplicates and lhs consistency', () => {
    const badPath = buildPlanDraft(draft({ axes: [axis({ param: '1bad' })] }), { id: 'x' });
    expect(issueFields(badPath)).toContain('axes.0.param');

    const duplicate = buildPlanDraft(
      draft({ axes: [axis({ param: 'a' }), axis({ param: 'a', from: '2', to: '3' })] }),
      { id: 'x' },
    );
    expect(duplicate.issues.some((i) => i.key === 'sweep.err_param_dup')).toBe(true);

    const mixed = buildPlanDraft(
      draft({ axes: [axis({ param: 'a', mode: 'lhs' }), axis({ param: 'b', mode: 'grid' })] }),
      { id: 'x' },
    );
    expect(mixed.issues.some((i) => i.key === 'sweep.err_lhs_mix')).toBe(true);

    const mismatchedN = buildPlanDraft(
      draft({
        axes: [
          axis({ param: 'a', mode: 'lhs', n: '4' }),
          axis({ param: 'b', mode: 'lhs', n: '5' }),
        ],
      }),
      { id: 'x' },
    );
    expect(mismatchedN.issues.some((i) => i.key === 'sweep.err_lhs_n_equal')).toBe(true);
  });

  it('validates expression syntax, repeats and base-params JSON', () => {
    const badExpression = buildPlanDraft(draft({ expression: 'p.a +' }), { id: 'x' });
    expect(issueFields(badExpression)).toContain('expression');
    expect(badExpression.issues[0]?.key).toBe('sweep.err_expression');

    expect(issueFields(buildPlanDraft(draft({ repeats: '0' }), { id: 'x' }))).toContain('repeats');
    expect(issueFields(buildPlanDraft(draft({ metric: '  ' }), { id: 'x' }))).toContain('metric');

    const badJson = buildPlanDraft(draft({ baseParams: '{oops' }), { id: 'x' });
    expect(issueFields(badJson)).toContain('baseParams');
    expect(badJson.issues.some((i) => i.key === 'sweep.err_json')).toBe(true);

    const arrayJson = buildPlanDraft(draft({ baseParams: '[1, 2]' }), { id: 'x' });
    expect(arrayJson.issues.some((i) => i.key === 'sweep.err_json_object')).toBe(true);

    const goodJson = buildPlanDraft(draft({ baseParams: '{\n  "k": 2\n}' }), { id: 'x' });
    expect(goodJson.plan?.baseParams).toEqual({ k: 2 });
  });

  it('enforces the global cell-count cap', () => {
    const huge = buildPlanDraft(
      draft({
        repeats: '1',
        axes: [
          axis({ param: 'a', from: '0', to: '1', steps: '500' }),
          axis({ param: 'b', from: '0', to: '1', steps: '201' }),
        ],
      }),
      { id: 'x' },
    );
    const capIssue = huge.issues.find((i) => i.key === 'sweep.err_cells');
    expect(capIssue).toBeDefined();
    expect(Number(capIssue?.params?.count)).toBeGreaterThan(MAX_SWEEP_CELLS);
    expect(huge.plan).toBeNull();
  });
});

describe('stored-result matching', () => {
  it('detects stale results after plan changes', () => {
    const built = buildPlanDraft(draft(), { id: 'p5' });
    const plan = built.plan!;
    const cells = expandPlan(plan);
    const result: SweepResult = {
      planId: plan.id,
      cells: cells.map((cell) => ({
        key: cell.key,
        params: cell.params,
        rep: cell.rep,
        value: 1,
        runId: cell.key,
        seed: cell.seed,
      })),
      total: cells.length,
      startedAt: 0,
      finishedAt: 1,
      status: 'done',
    };
    expect(resultMatchesPlan(plan, result)).toBe(true);
    expect(resultMatchesPlan(plan, { ...result, total: result.total + 1 })).toBe(false);
    expect(resultMatchesPlan(null, result)).toBe(false);
  });
});

describe('response surface', () => {
  function resultFor(plan: SweepPlan, valueOf: (params: Record<string, number | string>) => number): SweepResult {
    const design = expandPlan(plan);
    return {
      planId: plan.id,
      total: design.length,
      startedAt: 0,
      finishedAt: 1,
      status: 'done',
      cells: design.map((cell) => ({
        key: cell.key,
        params: cell.params,
        rep: cell.rep,
        value: valueOf(cell.params as Record<string, number | string>),
        runId: cell.key,
        seed: cell.seed,
      })),
    };
  }

  it('builds a 1-axis line surface', () => {
    const built = buildPlanDraft(
      draft({ axes: [axis({ from: '0', to: '1', steps: '3' })] }),
      { id: 'surf1' },
    );
    const plan = built.plan!;
    const surface = buildSurface(plan, resultFor(plan, (p) => Number(p.a) * 10));
    expect(surface?.kind).toBe('line');
    if (surface?.kind === 'line') {
      const points = surface.spec.series[0]?.points ?? [];
      expect(points.map((point) => point.y)).toEqual([0, 5, 10]);
    }
  });

  it('builds a 2-axis heat surface with a value grid', () => {
    const built = buildPlanDraft(
      draft({
        axes: [
          axis({ param: 'a', from: '0', to: '2', steps: '3' }),
          axis({ param: 'b', from: '0', to: '1', steps: '2' }),
        ],
      }),
      { id: 'surf2' },
    );
    const plan = built.plan!;
    const surface = buildSurface(plan, resultFor(plan, (p) => Number(p.a) + Number(p.b)));
    expect(surface?.kind).toBe('heat');
    if (surface?.kind === 'heat') {
      expect(surface.xVals).toEqual([0, 1, 2]);
      expect(surface.yVals).toEqual([0, 1]);
      expect(surface.grid).toHaveLength(2);
      expect(surface.grid[0]).toHaveLength(3);
      expect(surface.lo).toBe(0);
      expect(surface.hi).toBe(3);
    }
  });

  it('returns a neutral colour for non-finite values', () => {
    expect(heatColor(Number.NaN, 0, 1)).toBe('#e5e5e5');
    expect(heatColor(0.5, 1, 1)).toBe('#e5e5e5');
    expect(heatColor(0, 0, 1)).not.toBe('#e5e5e5');
  });
});
