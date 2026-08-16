import { describe, it, expect } from 'vitest';
import { compile } from '@/blocks/compiler';
import { DagExecutor } from '@/blocks/executor';
import { createMemoryStorage } from '@/blocks/context';
import { block, makeCountingRegistry } from './fixtures';
import type { BlockConnection, BlockGraph, BlockInstance } from '@/types/block';
import type { DataTable } from '@/types/datatable';

function instance(id: string, blockId: string): BlockInstance {
  return { id, blockId, position: { x: 0, y: 0 }, params: {} };
}

function conn(from: string, fromPort: string, to: string, toPort: string): BlockConnection {
  return {
    id: `${from}->${to}`,
    from: { nodeId: from, portId: fromPort },
    to: { nodeId: to, portId: toPort },
  };
}

function executorOf(graph: BlockGraph, registry: ReturnType<typeof makeCountingRegistry>['registry']) {
  const result = compile(graph, registry);
  expect(result.ok).toBe(true);
  return new DagExecutor(result.program!, { storage: createMemoryStorage() });
}

describe('DagExecutor', () => {
  it('runs a graph and caches node outputs', async () => {
    const { registry } = makeCountingRegistry();
    const graph: BlockGraph = {
      id: 'g',
      instances: [instance('a', 'test.source'), instance('b', 'test.counter')],
      connections: [conn('a', 'out', 'b', 'in')],
    };
    const ex = executorOf(graph, registry);
    await ex.run();
    expect(ex.getOutput('b')).toBeDefined();
    expect(ex.isDirty('a')).toBe(false);
    expect(ex.isDirty('b')).toBe(false);
  });

  it('skips clean nodes on re-run', async () => {
    const { registry, counts } = makeCountingRegistry();
    const graph: BlockGraph = {
      id: 'g',
      instances: [instance('a', 'test.source'), instance('b', 'test.counter')],
      connections: [conn('a', 'out', 'b', 'in')],
    };
    const ex = executorOf(graph, registry);
    await ex.run();
    expect(counts.get('b')).toBe(1);
    await ex.run();
    expect(counts.get('b')).toBe(1);
  });

  it('invalidate recomputes only the node and its downstream', async () => {
    const { registry, counts } = makeCountingRegistry();
    const graph: BlockGraph = {
      id: 'g',
      instances: [
        instance('a', 'test.source'),
        instance('b', 'test.counter'),
        instance('c', 'test.counter'),
      ],
      connections: [conn('a', 'out', 'b', 'in'), conn('b', 'out', 'c', 'in')],
    };
    const ex = executorOf(graph, registry);
    await ex.run();
    expect(counts.get('b')).toBe(1);
    expect(counts.get('c')).toBe(1);

    ex.invalidate('b');
    expect(ex.isDirty('b')).toBe(true);
    expect(ex.isDirty('c')).toBe(true);
    expect(ex.isDirty('a')).toBe(false);

    await ex.run();
    expect(counts.get('b')).toBe(2);
    expect(counts.get('c')).toBe(2);
  });

  it('propagates executor errors', async () => {
    const { registry } = makeCountingRegistry();
    registry.register(
      block({
        id: 'test.boom',
        category: 'transform',
        inputs: [{ id: 'in', label: 'in', type: 'data', dataType: 'DataTable', required: true }],
        outputs: [{ id: 'out', label: 'out', type: 'data', dataType: 'DataTable', required: false }],
      }),
      async () => {
        throw new Error('boom');
      },
    );
    const graph: BlockGraph = {
      id: 'g',
      instances: [instance('a', 'test.source'), instance('b', 'test.boom')],
      connections: [conn('a', 'out', 'b', 'in')],
    };
    const ex = executorOf(graph, registry);
    await expect(ex.run()).rejects.toThrow('boom');
  });

  it('flags a node with no executor at compile time', async () => {
    const { registry } = makeCountingRegistry();
    registry.register(
      block({
        id: 'test.no_exec',
        category: 'transform',
        inputs: [],
        outputs: [{ id: 'out', label: 'out', type: 'data', dataType: 'DataTable', required: false }],
      }),
    );
    const graph: BlockGraph = {
      id: 'g',
      instances: [instance('a', 'test.no_exec')],
      connections: [],
    };
    const result = compile(graph, registry);
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === 'missing_executor')).toBe(true);
  });

  it('markDirty during execution leaves the node dirty for the next run', async () => {
    const { registry } = makeCountingRegistry();
    // A block that signals its own output is stale after every execution.
    registry.register(
      block({
        id: 'test.self_dirty',
        category: 'transform',
        inputs: [{ id: 'in', label: 'in', type: 'data', dataType: 'DataTable', required: true }],
        outputs: [{ id: 'out', label: 'out', type: 'data', dataType: 'DataTable', required: false }],
      }),
      async (ctx) => {
        const input = ctx.getInput('in') as DataTable;
        ctx.markDirty();
        return input;
      },
    );
    const graph: BlockGraph = {
      id: 'g',
      instances: [instance('a', 'test.source'), instance('b', 'test.self_dirty')],
      connections: [conn('a', 'out', 'b', 'in')],
    };
    const ex = executorOf(graph, registry);
    await ex.run();
    // The markDirty must NOT be swallowed: b stays dirty so the next run
    // recomputes it.
    expect(ex.isDirty('b')).toBe(true);
    await ex.run();
    expect(ex.isDirty('b')).toBe(true);
    // Downstream nodes would also be recomputed on a subsequent run.
  });
});
