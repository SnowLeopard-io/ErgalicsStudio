import { describe, expect, it } from 'vitest';
import { BuildEngine } from '@/core/build/engine';
import { MemoryBuildCache } from '@/core/build/cache';
import { createBuildEnvironment } from '@/core/build/key';
import {
  compiledRegionToPlan,
  runCompiledRegion,
} from '@/core/build/blockAdapter';
import { createMemoryStorage } from '@/blocks/context';
import type { CompiledNode, CompiledRegion, DagExecutionContext } from '@/types/dag';
import type { DataValue, Scalar } from '@/types/datatable';

function scalar(value: number): Scalar {
  return { kind: 'scalar', value };
}

function node(
  id: string,
  execute: (ctx: DagExecutionContext) => Promise<DataValue | void>,
  inputs: Record<string, string> = {},
  params: Record<string, unknown> = {},
): CompiledNode {
  return { id, blockId: `test.${id}`, label: id, params, inputs, outputs: {}, execute };
}

function region(nodes: CompiledNode[]): CompiledRegion {
  return { id: 'r', nodes, executionOrder: nodes.map((n) => n.id) };
}

function engine(): BuildEngine {
  return new BuildEngine({
    cache: new MemoryBuildCache(),
    environment: createBuildEnvironment({ appVersion: 'test', schemaVersion: 'v1' }),
    concurrency: 2,
  });
}

describe('compiledRegionToPlan', () => {
  it('maps nodes to steps, including the executor fingerprint', () => {
    const r = region([node('a', async () => scalar(1)), node('b', async () => scalar(2), { in: 'a' })]);
    const plan = compiledRegionToPlan(r);
    expect(plan.id).toBe('r');
    expect(plan.steps).toHaveLength(2);
    expect(plan.steps[1]?.kind).toBe('test.b');
    expect(plan.steps[1]?.inputs).toEqual({ in: 'a' });
    expect(plan.steps[1]?.implementation).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes the key when the executor implementation changes', () => {
    const a = compiledRegionToPlan(region([node('x', async () => scalar(1))]));
    const b = compiledRegionToPlan(region([node('x', async () => scalar(2))]));
    expect(a.steps[0]?.implementation).not.toBe(b.steps[0]?.implementation);
  });
});

describe('runCompiledRegion', () => {
  it('executes a compiled region and reuses results across calls', async () => {
    let runs = 0;
    const r = region([
      node('source', async () => {
        runs += 1;
        return scalar(21);
      }),
      node(
        'double',
        async (ctx) => {
          const input = ctx.getInput('in') as Scalar;
          return scalar(Number(input.value) * 2);
        },
        { in: 'source' },
      ),
    ]);
    const build = engine();
    const first = await runCompiledRegion(r, { storage: createMemoryStorage() }, build);
    expect(first.stats.computed).toBe(2);
    expect((first.outputs.get('double') as Scalar).value).toBe(42);
    expect(runs).toBe(1);

    const second = await runCompiledRegion(r, { storage: createMemoryStorage() }, build);
    expect(second.stats.cached).toBe(2);
    expect((second.outputs.get('double') as Scalar).value).toBe(42);
    expect(runs).toBe(1);
  });

  it('recomputes when a parameter changes', async () => {
    const r = region([
      node('source', async (ctx) => {
        const factor = Number(ctx.getParam('factor') ?? 1);
        return scalar(10 * factor);
      }),
    ]);
    const build = engine();
    await runCompiledRegion(r, { storage: createMemoryStorage() }, build);
    const changed = region([
      node('source', async (ctx) => {
        const factor = Number(ctx.getParam('factor') ?? 1);
        return scalar(10 * factor);
      }, {}, { factor: 2 }),
    ]);
    // Same executor source; the parameter is what changed.
    const run = await runCompiledRegion(changed, { storage: createMemoryStorage() }, build);
    expect(run.stats.computed).toBe(1);
    expect((run.outputs.get('source') as Scalar).value).toBe(20);
  });

  it('treats markDirty as run-local and reports the reason', async () => {
    let runs = 0;
    const r = region([
      node('fragile', async (ctx) => {
        runs += 1;
        ctx.markDirty();
        return scalar(runs);
      }),
    ]);
    const build = engine();
    const first = await runCompiledRegion(r, { storage: createMemoryStorage() }, build);
    expect(first.stats.steps[0]?.reason).toBe('mark-dirty');
    expect(first.stats.steps[0]?.cacheable).toBe(false);
    const second = await runCompiledRegion(r, { storage: createMemoryStorage() }, build);
    expect(second.stats.cached).toBe(0);
    expect((second.outputs.get('fragile') as Scalar).value).toBe(2);
  });

  it('surfaces node status to the caller', async () => {
    const statuses: string[] = [];
    const r = region([node('only', async () => scalar(1))]);
    await runCompiledRegion(r, { storage: createMemoryStorage() }, engine(), {
      onStepStatus: (id, status) => statuses.push(`${id}:${status}`),
    });
    expect(statuses).toEqual(['only:computing', 'only:done']);
  });

  it('reports a missing executor as a step failure', async () => {
    const missing: CompiledNode = {
      id: 'nope',
      blockId: 'test.nope',
      label: 'nope',
      params: {},
      inputs: {},
      outputs: {},
    };
    await expect(
      runCompiledRegion(region([missing]), { storage: createMemoryStorage() }, engine()),
    ).rejects.toThrow(/has no executor/);
  });
});
