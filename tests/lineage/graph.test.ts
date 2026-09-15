// ==========================================================================
// Ergalics Studio — lineage graph & layout tests (core)
//
// DAG construction from files + runs, and the layered layout: left→right
// flow, unique (x,y) per node (no overlap), cycle safety.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { buildLineage, layoutDag } from '@/core/lineage/graph';
import type { LineageLayout } from '@/core/lineage/graph';
import { createRunRecord } from '@/core/experiment/record';

function run(id: string, inputFileIds: string[], label = `run ${id}`) {
  // createRunRecord mints its own UUID; tests override with stable ids.
  return { ...createRunRecord({
    projectId: 'p',
    source: 'flow',
    label,
    inputFileIds,
    createdAt: 1000,
    durationMs: 1,
  }), id };
}

function nodeOf(layout: LineageLayout, id: string) {
  return layout.positions[id];
}

describe('buildLineage', () => {
  it('creates file and run nodes with file→run edges', () => {
    const files = [
      { id: 'f1', name: 'samples.csv' },
      { id: 'f2', name: 'controls.csv' },
    ];
    const g = buildLineage(files, [run('r1', ['f1']), run('r2', ['f1', 'f2'])]);

    expect(g.nodes.map((n) => n.id).sort()).toEqual([
      'file:f1', 'file:f2', 'run:r1', 'run:r2',
    ]);
    expect(g.edges).toContainEqual({ from: 'file:f1', to: 'run:r1' });
    expect(g.edges).toContainEqual({ from: 'file:f1', to: 'run:r2' });
    expect(g.edges).toContainEqual({ from: 'file:f2', to: 'run:r2' });
    expect(g.edges).toHaveLength(3);
  });

  it('skips dangling file references but keeps isolated runs', () => {
    const g = buildLineage([{ id: 'f1', name: 'a.csv' }], [
      run('r1', ['missing']),
      run('r2', []),
    ]);
    expect(g.edges).toHaveLength(0);
    expect(g.nodes.map((n) => n.kind)).toEqual(['file', 'run', 'run']);
  });

  it('carries run metadata (label/source/failed) onto nodes', () => {
    const g = buildLineage([], [run('r1', [], 'calibration sweep')]);
    const node = g.nodes[0]!;
    expect(node.label).toBe('calibration sweep');
    expect(node.source).toBe('flow');
    expect(node.failed).toBe(false);
  });
});

describe('layoutDag', () => {
  it('places roots in layer 0 and downstream nodes to the right', () => {
    const files = [
      { id: 'f1', name: 'a.csv' },
      { id: 'f2', name: 'b.csv' },
    ];
    const g = buildLineage(files, [run('r1', ['f1']), run('r2', ['f1'])]);
    const layout = layoutDag(g);

    expect(layout.positions['file:f1']!.layer).toBe(0);
    expect(layout.positions['file:f2']!.layer).toBe(0);
    expect(layout.positions['run:r1']!.layer).toBe(1);
    expect(layout.positions['run:r2']!.layer).toBe(1);
    // edges flow left → right
    for (const e of g.edges) {
      expect(layout.positions[e.from]!.x).toBeLessThan(layout.positions[e.to]!.x);
    }
  });

  it('chains runs into successive layers (longest-path layering)', () => {
    // r1 consumes f1; r2 is a downstream stage consuming r1's output file.
    const files = [{ id: 'f1', name: 'a.csv' }];
    const g = buildLineage(files, [run('r1', ['f1']), run('r2', [])]);
    const layout = layoutDag(g);
    // r2 has no inputs → layer 0 alongside f1; r1 → layer 1
    expect(layout.positions['run:r2']!.layer).toBe(0);
    expect(layout.positions['run:r1']!.layer).toBe(1);
  });

  it('never assigns two nodes the same (x, y)', () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, name: `f${i}.csv` }));
    const runs = [
      run('r1', ['f0', 'f1']),
      run('r2', ['f1', 'f2']),
      run('r3', ['f2', 'f3', 'f4']),
      run('r4', []),
      run('r5', ['f0']),
    ];
    const g = buildLineage(files, runs);
    const layout = layoutDag(g);

    const seen = new Set<string>();
    for (const p of Object.values(layout.positions)) {
      const key = `${p.x},${p.y}`;
      expect(seen.has(key)).toBe(false); // no overlap
      seen.add(key);
    }
  });

  it('centers smaller layers vertically and reports drawing extents', () => {
    const files = [
      { id: 'f1', name: 'a.csv' },
      { id: 'f2', name: 'b.csv' },
      { id: 'f3', name: 'c.csv' },
    ];
    const g = buildLineage(files, [run('r1', ['f1'])]);
    const layout = layoutDag(g);

    // 3 nodes in layer 0, 1 node in layer 1 → the single run is centered.
    const r1 = layout.positions['run:r1']!;
    const f1 = layout.positions['file:f1']!;
    const f3 = layout.positions['file:f3']!;
    expect(r1.y).toBeGreaterThan(f1.y);
    expect(r1.y).toBeLessThan(f3.y);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it('terminates on cyclic input (defensive) without overlap', () => {
    const a = run('a', []);
    const b = run('b', []);
    const g = buildLineage([], [a, b]);
    // artificial cycle between run nodes
    g.edges.push({ from: 'run:a', to: 'run:b' }, { from: 'run:b', to: 'run:a' });
    const layout = layoutDag(g);
    expect(Object.keys(layout.positions)).toHaveLength(2);
    const [pa, pb] = Object.values(layout.positions);
    expect(`${pa!.x},${pa!.y}`).not.toBe(`${pb!.x},${pb!.y}`);
  });

  it('returns an empty layout for an empty graph', () => {
    const layout = layoutDag({ nodes: [], edges: [] });
    expect(layout.positions).toEqual({});
    expect(layout.width).toBe(0);
  });

  it('exposes positions via a plain record keyed by node id', () => {
    const g = buildLineage([{ id: 'f1', name: 'a.csv' }], [run('r1', ['f1'])]);
    const layout = layoutDag(g);
    expect(Object.keys(layout.positions).sort()).toEqual(['file:f1', 'run:r1']);
    expect(nodeOf(layout, 'file:f1')).toBeDefined();
  });
});
