// Tests for the solve/scan input validation kernels added with async parsing:
// findBoundaryConflicts (solve.ts) and validateDesignParameters (cases.ts).

import { describe, expect, it } from 'vitest';
import { findBoundaryConflicts } from '@/core/engineering/solve';
import { validateDesignParameters } from '@/core/engineering/cases';
import type { BoundaryCondition, EngineeringStep } from '@/core/engineering/types';

function bc(name: string, kind: BoundaryCondition['kind'], tag: number, dimension = 2): BoundaryCondition {
  return {
    id: `bc-${name}`,
    name,
    kind,
    stepId: 's1',
    target: { dimension, tag },
    components: { c0: 1, c1: 0 },
  } as BoundaryCondition;
}

describe('findBoundaryConflicts', () => {
  it('flags a load applied to a group with prescribed temperature', () => {
    const conflicts = findBoundaryConflicts([
      bc('fixed', 'temperature', 1),
      bc('in-flux', 'heat-flux', 1),
    ], 'steady-heat');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.prescribed.name).toBe('fixed');
    expect(conflicts[0]!.load.name).toBe('in-flux');
  });

  it('ignores loads on other groups and unrelated kinds', () => {
    expect(findBoundaryConflicts([
      bc('fixed', 'temperature', 1),
      bc('in-flux', 'heat-flux', 2),
    ], 'steady-heat')).toHaveLength(0);
    // force/pressure conflicts only apply to static-structural steps
    expect(findBoundaryConflicts([
      bc('fix-x', 'displacement', 3),
      bc('push', 'force', 3),
    ], 'steady-heat')).toHaveLength(0);
  });

  it('detects force-on-displacement for static structural steps', () => {
    const conflicts = findBoundaryConflicts([
      bc('fix-x', 'displacement', 3, 2),
      bc('push', 'force', 3, 2),
    ], 'static-structural');
    expect(conflicts).toHaveLength(1);
  });
});

describe('validateDesignParameters', () => {
  const ctx = {
    materials: [{ name: 'Steel' }],
    steps: [{ id: 's1' } as EngineeringStep],
    boundaryConditions: [{ name: 'hot' }],
  };

  it('accepts resolvable material/step/bc paths', () => {
    const issues = validateDesignParameters({
      ...ctx,
      parameters: [
        { name: 'material.Steel.E', min: 1e11, max: 2e11, levels: 5 },
        { name: 'step.s1.loadScale', min: 0.5, max: 1.5, levels: 3 },
        { name: 'bc.hot.c0', min: 300, max: 400, levels: 3 },
      ],
    });
    expect(issues).toHaveLength(0);
  });

  it('reports inverted ranges, bad levels and unknown entities', () => {
    const issues = validateDesignParameters({
      ...ctx,
      parameters: [
        { name: 'material.Steel.E', min: 2e11, max: 1e11, levels: 5 },
        { name: 'material.Titanium.E', min: 1e11, max: 2e11, levels: 5 },
        { name: 'bc.cold.c0', min: 300, max: 400, levels: 5 },
        { name: 'flow.speed', min: 0, max: 1, levels: 3 },
        { name: '', min: 0, max: 1, levels: 3 },
        { name: 'p', min: NaN, max: 1, levels: 3 },
        { name: 'p2', min: 0, max: 1, levels: 0 },
      ],
    });
    const reasons = issues.map((issue) => issue.reason);
    expect(reasons).toContain('inverted');
    expect(reasons).toContain('unknown-material');
    expect(reasons).toContain('unknown-bc');
    expect(reasons).toContain('unknown-path');
    expect(reasons).toContain('empty');
    expect(reasons).toContain('non-finite');
    expect(reasons).toContain('levels');
  });
});
