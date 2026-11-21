import { describe, expect, it } from 'vitest';
import {
  ancestors,
  backdoorPaths,
  descendants,
  dSeparated,
  findAdjustmentSets,
  satisfiesBackdoor,
  type CausalGraph,
} from '@/core/causal/graph';

const confounded: CausalGraph = {
  nodes: ['X', 'T', 'Y'],
  edges: [['X', 'T'], ['X', 'Y'], ['T', 'Y']],
};

describe('causal DAG algorithms', () => {
  it('computes ancestors and descendants', () => {
    expect([...ancestors(confounded, ['Y'])].sort()).toEqual(['T', 'X']);
    expect([...descendants(confounded, ['X'])].sort()).toEqual(['T', 'Y']);
  });

  it('requires adjusting for a confounder', () => {
    const paths = backdoorPaths(confounded, 'T', 'Y');
    expect(paths).toHaveLength(1);
    expect(paths[0]!.nodes).toEqual(['T', 'X', 'Y']);
    expect(satisfiesBackdoor(confounded, 'T', 'Y', [])).toBe(false);
    expect(satisfiesBackdoor(confounded, 'T', 'Y', ['X'])).toBe(true);
    expect(findAdjustmentSets(confounded, 'T', 'Y')).toEqual([['X']]);
  });

  it('does not adjust for a collider or a mediator', () => {
    const collider: CausalGraph = {
      nodes: ['T', 'Y', 'C'],
      edges: [['T', 'Y'], ['T', 'C'], ['Y', 'C']],
    };
    expect(backdoorPaths(collider, 'T', 'Y')).toHaveLength(0);
    expect(findAdjustmentSets(collider, 'T', 'Y')).toEqual([[]]);

    const mediator: CausalGraph = {
      nodes: ['T', 'M', 'Y'],
      edges: [['T', 'M'], ['M', 'Y']],
    };
    expect(findAdjustmentSets(mediator, 'T', 'Y')).toEqual([[]]);
    expect([...descendants(mediator, ['T'])]).toContain('M');
  });

  it('handles M-bias: conditioning on the collider opens a path', () => {
    const mBias: CausalGraph = {
      nodes: ['T', 'A', 'C', 'B', 'Y'],
      edges: [['A', 'T'], ['A', 'C'], ['B', 'C'], ['B', 'Y']],
    };
    expect(satisfiesBackdoor(mBias, 'T', 'Y', [])).toBe(true);
    expect(satisfiesBackdoor(mBias, 'T', 'Y', ['C'])).toBe(false);
  });

  it('answers d-separation queries for chains, forks and colliders', () => {
    const chain: CausalGraph = { nodes: ['X', 'M', 'Y'], edges: [['X', 'M'], ['M', 'Y']] };
    expect(dSeparated(chain, 'X', 'Y')).toBe(false);
    expect(dSeparated(chain, 'X', 'Y', ['M'])).toBe(true);

    const collider: CausalGraph = {
      nodes: ['X', 'C', 'Y'],
      edges: [['X', 'C'], ['Y', 'C']],
    };
    expect(dSeparated(collider, 'X', 'Y')).toBe(true);
    expect(dSeparated(collider, 'X', 'Y', ['C'])).toBe(false);
  });
});
