import { describe, expect, it } from 'vitest';
import {
  BuildAbortedError,
  BuildEngine,
  BuildStepError,
  type StepRunner,
} from '@/core/build/engine';
import { MemoryBuildCache } from '@/core/build/cache';
import { computeStepKey } from '@/core/build/key';
import { environmentFingerprint, createBuildEnvironment } from '@/core/build/key';
import type { BuildPlan } from '@/core/build/plan';
import type { EncodedValue } from '@/core/build/codec';
import type { DataValue } from '@/types/datatable';

const environment = createBuildEnvironment({ appVersion: 'test', schemaVersion: 'v1' });
const envFingerprint = environmentFingerprint(environment);

function engine(cache = new MemoryBuildCache()): BuildEngine {
  return new BuildEngine({ cache, environment, concurrency: 2 });
}

function scalar(value: number): DataValue {
  return { kind: 'scalar', value };
}

function scalarValue(outputs: Map<string, DataValue>, id: string): unknown {
  const value = outputs.get(id);
  if (value === undefined || !('kind' in value) || value.kind !== 'scalar') {
    throw new Error(`expected scalar output for ${id}`);
  }
  return value.value;
}

const chain: BuildPlan = {
  id: 'chain',
  steps: [
    { id: 'a', kind: 'source', inputs: {}, params: { n: 1 } },
    { id: 'b', kind: 'double', inputs: { in: 'a' }, params: { k: 2 } },
    { id: 'd', kind: 'side', inputs: { in: 'a' }, params: {} },
  ],
};
chain.steps.push({ id: 'c', kind: 'triple', inputs: { in: 'b' }, params: {} });

function countingRunner(counts: Map<string, number>): StepRunner {
  return async (step, ctx) => {
    counts.set(step.id, (counts.get(step.id) ?? 0) + 1);
    const input = ctx.getInput('in');
    const base = input && 'kind' in input && input.kind === 'scalar' && typeof input.value === 'number'
      ? input.value
      : 1;
    const factor = step.kind === 'double' ? Number(step.params.k ?? 2)
      : step.kind === 'triple' ? 3
        : 1;
    return { value: scalar(base * factor) };
  };
}

describe('BuildEngine', () => {
  it('computes on the first run and serves everything from cache afterwards', async () => {
    const counts = new Map<string, number>();
    const build = engine();
    const first = await build.run(chain, countingRunner(counts));
    expect(first.stats.computed).toBe(4);
    expect(first.stats.cached).toBe(0);
    expect(scalarValue(first.outputs, 'c')).toBe(6);
    expect(first.stats.outputs.c).toMatch(/^[0-9a-f]{16}$/);

    const second = await build.run(chain, countingRunner(counts));
    expect(second.stats.cached).toBe(4);
    expect(second.stats.computed).toBe(0);
    expect(Object.fromEntries(counts)).toEqual({ a: 1, b: 1, c: 1, d: 1 });
    expect(scalarValue(second.outputs, 'c')).toBe(6);
    expect([...second.outputs.keys()].sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('recomputes only the downstream sub-graph of a changed parameter', async () => {
    const counts = new Map<string, number>();
    const build = engine();
    await build.run(chain, countingRunner(counts));
    const changed: BuildPlan = {
      id: chain.id,
      steps: chain.steps.map((s) => (s.id === 'b' ? { ...s, params: { k: 3 } } : s)),
    };
    const run = await build.run(changed, countingRunner(counts));
    expect(run.stats.cached).toBe(2); // a and d
    expect(run.stats.computed).toBe(2); // b and c
    expect(counts.get('a')).toBe(1);
    expect(counts.get('d')).toBe(1);
    expect(counts.get('b')).toBe(2);
    expect(counts.get('c')).toBe(2);
    expect(scalarValue(run.outputs, 'c')).toBe(9);
    // The decision report explains *why* each step ran.
    const decisions = new Map(run.stats.steps.map((s) => [s.id, s]));
    expect(decisions.get('a')?.reason).toBe('cache-hit');
    expect(decisions.get('b')?.status).toBe('computed');
  });

  it('survives a cache entry with corrupt bytes by treating it as a miss', async () => {
    const cache = new MemoryBuildCache();
    const build = engine(cache);
    const source = chain.steps[0]!;
    const key = computeStepKey(source, {}, envFingerprint).key;
    await cache.put({ key, value: { kind: 'bogus' } as unknown as EncodedValue });
    const counts = new Map<string, number>();
    const run = await build.run({ id: 'one', steps: [source] }, countingRunner(counts));
    expect(run.stats.computed).toBe(1);
    expect(counts.get('a')).toBe(1);
    expect(await cache.get(key)).toBeDefined();
  });

  it('blocks downstream steps after a failure but keeps independent branches', async () => {
    const counts = new Map<string, number>();
    const runner: StepRunner = async (step, ctx) => {
      counts.set(step.id, (counts.get(step.id) ?? 0) + 1);
      if (step.id === 'b') throw new Error('boom');
      return countingRunner(counts)(step, ctx);
    };
    const run = await engine().run(chain, runner, { stopOnError: false });
    expect(run.stats.failed).toBe(1);
    expect(run.stats.blocked).toBe(1); // c depends on b
    expect(run.stats.computed).toBe(2); // a and d
    expect(run.errors.get('b')).toContain('boom');
    expect(run.outputs.has('c')).toBe(false);
    const decisions = new Map(run.stats.steps.map((s) => [s.id, s]));
    expect(decisions.get('c')?.reason).toBe('upstream-failed');
  });

  it('throws a BuildStepError that identifies the failing node', async () => {
    const runner: StepRunner = async (step) => {
      if (step.id === 'b') throw new Error('detonation');
      return { value: scalar(1) };
    };
    await expect(engine().run(chain, runner)).rejects.toMatchObject({
      name: 'BuildStepError',
      stepId: 'b',
      message: 'detonation',
    });
    try {
      await engine().run(chain, runner);
    } catch (err) {
      expect(err).toBeInstanceOf(BuildStepError);
    }
  });

  it('never persists rendered views or self-declared run-local results', async () => {
    const plan: BuildPlan = {
      id: 'views',
      steps: [
        { id: 'v', kind: 'viz', inputs: {}, params: {} },
        { id: 'm', kind: 'dirty', inputs: {}, params: {} },
      ],
    };
    let views = 0;
    let dirty = 0;
    const runner: StepRunner = async (step, ctx) => {
      if (step.kind === 'viz') {
        views += 1;
        return { value: { kind: 'rendered-view', id: `v${views}`, viewType: 'scatter' } };
      }
      dirty += 1;
      ctx.markUncacheable('mark-dirty');
      return { value: scalar(dirty) };
    };
    const build = engine();
    const first = await build.run(plan, runner);
    expect(first.stats.computed).toBe(2);
    const second = await build.run(plan, runner);
    expect(second.stats.cached).toBe(0);
    expect(second.stats.computed).toBe(2);
    expect(views).toBe(2);
    expect(dirty).toBe(2);
    expect(second.stats.steps.every((s) => s.cacheable === false)).toBe(true);
  });

  it('recomputes consumers when an upstream result is run-local', async () => {
    const plan: BuildPlan = {
      id: 'volatile-chain',
      steps: [
        { id: 'a', kind: 'dirty', inputs: {}, params: {} },
        { id: 'b', kind: 'consume', inputs: { in: 'a' }, params: {} },
      ],
    };
    let runs = 0;
    const runner: StepRunner = async (step, ctx) => {
      if (step.id === 'a') {
        ctx.markUncacheable();
        return { value: scalar(++runs) };
      }
      const input = ctx.getInput('in');
      const value = input && 'kind' in input && input.kind === 'scalar' && typeof input.value === 'number' ? input.value : 0;
      return { value: scalar(value * 10) };
    };
    const build = engine();
    await build.run(plan, runner);
    const second = await build.run(plan, runner);
    expect(second.stats.cached).toBe(0);
    expect(scalarValue(second.outputs, 'b')).toBe(20);
  });

  it('honours AbortSignal before starting any step', async () => {
    const controller = new AbortController();
    controller.abort();
    let started = 0;
    const runner: StepRunner = async () => {
      started += 1;
      return { value: scalar(1) };
    };
    await expect(
      engine().run(chain, runner, { signal: controller.signal }),
    ).rejects.toBeInstanceOf(BuildAbortedError);
    expect(started).toBe(0);
  });

  it('runs independent steps concurrently up to the configured limit', async () => {
    const plan: BuildPlan = {
      id: 'parallel',
      steps: [
        { id: 'a', kind: 'work', inputs: {}, params: {} },
        { id: 'b', kind: 'work', inputs: {}, params: {} },
      ],
    };
    let started = 0;
    const releases: Array<() => void> = [];
    const runner: StepRunner = async () => {
      started += 1;
      await new Promise<void>((resolve) => releases.push(resolve));
      return { value: scalar(1) };
    };
    const running = engine().run(plan, runner, { concurrency: 2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(started).toBe(2);
    for (const release of releases) release();
    await running;
  });

  it('bypassCache recomputes but keeps the cache warm', async () => {
    const counts = new Map<string, number>();
    const build = engine();
    await build.run(chain, countingRunner(counts));
    const forced = await build.run(chain, countingRunner(counts), { bypassCache: true });
    expect(forced.stats.computed).toBe(4);
    expect(forced.stats.cached).toBe(0);
    const after = await build.run(chain, countingRunner(counts));
    expect(after.stats.cached).toBe(4);
  });

  it('exposes cache stats and clearCache forces a full recompute', async () => {
    const counts = new Map<string, number>();
    const build = engine();
    await build.run(chain, countingRunner(counts));
    const stats = await build.cacheStats();
    expect(stats.entries).toBe(4);
    expect(stats.bytes).toBeGreaterThan(0);

    await build.clearCache();
    expect((await build.cacheStats()).entries).toBe(0);

    const after = await build.run(chain, countingRunner(counts));
    expect(after.stats.computed).toBe(4);
    expect(after.stats.cached).toBe(0);
  });
});
