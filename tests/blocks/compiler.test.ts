import { describe, it, expect } from 'vitest';
import { compile } from '@/blocks/compiler';
import { makeTestRegistry } from './fixtures';
import type { BlockConnection, BlockGraph, BlockInstance } from '@/types/block';

function instance(id: string, blockId: string, params: Record<string, unknown> = {}): BlockInstance {
  return { id, blockId, position: { x: 0, y: 0 }, params };
}

function conn(from: string, fromPort: string, to: string, toPort: string): BlockConnection {
  return {
    id: `${from}.${fromPort}->${to}.${toPort}`,
    from: { nodeId: from, portId: fromPort },
    to: { nodeId: to, portId: toPort },
  };
}

describe('compiler', () => {
  const registry = makeTestRegistry();

  it('compiles a linear graph in dependency order', () => {
    const graph: BlockGraph = {
      id: 'g',
      instances: [instance('a', 'test.source'), instance('b', 'test.passthrough')],
      connections: [conn('a', 'out', 'b', 'in')],
    };
    const result = compile(graph, registry);
    expect(result.ok).toBe(true);
    expect(result.program?.executionOrder).toEqual(['a', 'b']);
    expect(result.diagnostics).toEqual([]);
  });

  it('topologically sorts a diamond (fan-out + merge)', () => {
    const graph: BlockGraph = {
      id: 'g',
      instances: [
        instance('a', 'test.source'),
        instance('b', 'test.passthrough'),
        instance('c', 'test.passthrough'),
        instance('d', 'test.join'),
      ],
      connections: [
        conn('a', 'out', 'b', 'in'),
        conn('a', 'out', 'c', 'in'),
        conn('b', 'out', 'd', 'l'),
        conn('c', 'out', 'd', 'r'),
      ],
    };
    const result = compile(graph, registry);
    expect(result.ok).toBe(true);
    const order = result.program!.executionOrder;
    expect(order[0]).toBe('a');
    expect(order[order.length - 1]).toBe('d');
    expect(order.indexOf('d')).toBeGreaterThan(order.indexOf('b'));
    expect(order.indexOf('d')).toBeGreaterThan(order.indexOf('c'));
  });

  it('derives per-node input/output maps', () => {
    const graph: BlockGraph = {
      id: 'g',
      instances: [instance('a', 'test.source'), instance('b', 'test.passthrough')],
      connections: [conn('a', 'out', 'b', 'in')],
    };
    const result = compile(graph, registry);
    const nodes = result.program!.nodes;
    const a = nodes.find((n) => n.id === 'a')!;
    const b = nodes.find((n) => n.id === 'b')!;
    expect(b.inputs).toEqual({ in: 'a' });
    expect(a.outputs).toEqual({ out: ['b'] });
  });

  it('merges default and instance params', () => {
    const graph: BlockGraph = {
      id: 'g',
      instances: [
        instance('a', 'test.source'),
        instance('b', 'test.param', { scale: 5 }),
      ],
      connections: [conn('a', 'out', 'b', 'in')],
    };
    const result = compile(graph, registry);
    const b = result.program!.nodes.find((n) => n.id === 'b')!;
    expect(b.params).toEqual({ scale: 5, label: 'a' });
  });

  it('reports a type mismatch', () => {
    const graph: BlockGraph = {
      id: 'g',
      instances: [instance('a', 'test.source'), instance('b', 'test.from_scalar')],
      connections: [conn('a', 'out', 'b', 'in')],
    };
    const result = compile(graph, registry);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'type_mismatch')).toBe(true);
  });

  it('reports a missing required input', () => {
    const graph: BlockGraph = {
      id: 'g',
      instances: [instance('a', 'test.passthrough')],
      connections: [],
    };
    const result = compile(graph, registry);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'missing_required_input')).toBe(true);
  });

  it('reports a cycle', () => {
    const graph: BlockGraph = {
      id: 'g',
      instances: [instance('a', 'test.passthrough'), instance('b', 'test.passthrough')],
      connections: [conn('a', 'out', 'b', 'in'), conn('b', 'out', 'a', 'in')],
    };
    const result = compile(graph, registry);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'cycle_detected')).toBe(true);
  });

  it('reports an unknown block', () => {
    const graph: BlockGraph = {
      id: 'g',
      instances: [instance('a', 'test.nope')],
      connections: [],
    };
    const result = compile(graph, registry);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'unknown_block')).toBe(true);
  });

  it('reports a duplicate input source', () => {
    const graph: BlockGraph = {
      id: 'g',
      instances: [
        instance('a', 'test.source'),
        instance('b', 'test.source'),
        instance('c', 'test.join'),
      ],
      connections: [conn('a', 'out', 'c', 'l'), conn('b', 'out', 'c', 'l')],
    };
    const result = compile(graph, registry);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'duplicate_input')).toBe(true);
  });
});
