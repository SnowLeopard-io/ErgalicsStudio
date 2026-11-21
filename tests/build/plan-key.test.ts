import { describe, expect, it } from 'vitest';
import {
  BuildPlanError,
  affectedBy,
  planFingerprint,
  previewAffected,
  reverseDependencies,
  topoSort,
  upstreamOf,
  type BuildPlan,
  type BuildStep,
} from '@/core/build/plan';
import {
  computeStepKey,
  createBuildEnvironment,
  environmentFingerprint,
  volatileStepKey,
} from '@/core/build/key';

function step(id: string, kind: string, inputs: Record<string, string> = {}, params: Record<string, unknown> = {}): BuildStep {
  return { id, kind, inputs, params };
}

const diamond: BuildPlan = {
  id: 'diamond',
  steps: [
    step('a', 'source'),
    step('b', 'transform', { in: 'a' }, { k: 1 }),
    step('c', 'transform', { in: 'a' }, { k: 2 }),
    step('d', 'join', { left: 'b', right: 'c' }),
  ],
};

describe('build plan topology', () => {
  it('groups independent steps into concurrent layers', () => {
    const topology = topoSort(diamond);
    expect(topology.layers).toEqual([['a'], ['b', 'c'], ['d']]);
    expect(topology.order).toEqual(['a', 'b', 'c', 'd']);
    expect(topology.dependencies.get('d')).toEqual(['b', 'c']);
  });

  it('deduplicates repeated edges to the same upstream', () => {
    const plan: BuildPlan = {
      id: 'p',
      steps: [step('a', 'src'), step('b', 'join', { x: 'a', y: 'a' })],
    };
    expect(topoSort(plan).layers).toEqual([['a'], ['b']]);
  });

  it('reports the actual cycle', () => {
    const plan: BuildPlan = {
      id: 'cycle',
      steps: [step('a', 'x', { in: 'c' }), step('b', 'x', { in: 'a' }), step('c', 'x', { in: 'b' })],
    };
    try {
      topoSort(plan);
      throw new Error('expected a cycle');
    } catch (err) {
      expect(err).toBeInstanceOf(BuildPlanError);
      const cycle = (err as BuildPlanError).cycle;
      expect(cycle.length).toBeGreaterThan(1);
      expect(cycle[0]).toBe(cycle[cycle.length - 1]);
    }
  });

  it('rejects duplicate ids and dangling dependencies', () => {
    expect(() => topoSort({ id: 'p', steps: [step('a', 'x'), step('a', 'y')] })).toThrow(/duplicate/);
    expect(() => topoSort({ id: 'p', steps: [step('a', 'x', { in: 'ghost' })] })).toThrow(/unknown step/);
  });

  it('computes downstream impact and upstream provenance', () => {
    expect([...affectedBy(diamond, ['b'])].sort()).toEqual(['b', 'd']);
    expect([...affectedBy(diamond, ['a'])].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...upstreamOf(diamond, ['d'])].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...upstreamOf(diamond, ['b'])].sort()).toEqual(['a', 'b']);
    expect(reverseDependencies(diamond).get('a')).toEqual(['b', 'c']);
    expect(previewAffected(diamond, ['c']).map((s) => s.id)).toEqual(['c', 'd']);
  });

  it('fingerprints the plan independently of step declaration order', () => {
    const reordered: BuildPlan = { id: 'diamond', steps: [...diamond.steps].reverse() };
    expect(planFingerprint(reordered)).toBe(planFingerprint(diamond));
    const changed: BuildPlan = {
      id: 'diamond',
      steps: diamond.steps.map((s) => (s.id === 'a' ? { ...s, params: { n: 1 } } : s)),
    };
    expect(planFingerprint(changed)).not.toBe(planFingerprint(diamond));
  });
});

describe('step keys', () => {
  const env = environmentFingerprint(createBuildEnvironment({ appVersion: 'test', schemaVersion: 'v1' }));
  const single = step('a', 'source', {}, { n: 1 });

  it('does not depend on the step id', () => {
    const renamed = { ...single, id: 'renamed' };
    expect(computeStepKey(single, {}, env).key).toBe(computeStepKey(renamed, {}, env).key);
  });

  it('depends on params, implementation, inputs and environment', () => {
    const base = computeStepKey(single, {}, env).key;
    expect(computeStepKey({ ...single, params: { n: 2 } }, {}, env).key).not.toBe(base);
    expect(computeStepKey({ ...single, implementation: 'v2' }, {}, env).key).not.toBe(base);
    const env2 = environmentFingerprint(createBuildEnvironment({ appVersion: 'next', schemaVersion: 'v1' }));
    expect(computeStepKey(single, {}, env2).key).not.toBe(base);
  });

  it('uses upstream content keys, not upstream ids', () => {
    const consumer = step('b', 'double', { in: 'a' });
    const one = computeStepKey(consumer, { in: computeStepKey(single, {}, env).key }, env).key;
    const other = computeStepKey(consumer, { in: 'deadbeef' }, env).key;
    expect(one).not.toBe(other);
  });

  it('is insensitive to port declaration order but sensitive to ports', () => {
    const a = computeStepKey(step('b', 'join', { x: 'a', y: 'c' }), { x: '1', y: '2' }, env).key;
    const b = computeStepKey(step('b', 'join', { y: 'c', x: 'a' }), { y: '2', x: '1' }, env).key;
    expect(a).toBe(b);
    const missing = computeStepKey(step('b', 'join', { x: 'a', z: 'c' }), { x: '1', y: '2' }, env).key;
    expect(missing).not.toBe(a);
  });

  it('exposes a breakdown for provenance and volatile keys are run-scoped', () => {
    const breakdown = computeStepKey(step('b', 'x', { in: 'a' }, { k: 2 }), { in: 'abc' }, env);
    expect(breakdown.params).toHaveLength(16);
    expect(breakdown.inputs).toHaveLength(16);
    expect(breakdown.inputKeys).toEqual({ in: 'abc' });
    const v1 = volatileStepKey(single, 'run-1', env);
    const v2 = volatileStepKey(single, 'run-2', env);
    expect(v1).not.toBe(v2);
    expect(v1).not.toBe(breakdown.key);
  });
});
