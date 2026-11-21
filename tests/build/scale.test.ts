import { describe, expect, it } from 'vitest';
import { BuildEngine, type StepRunner } from '@/core/build/engine';
import { MemoryBuildCache } from '@/core/build/cache';
import { createBuildEnvironment } from '@/core/build/key';
import { topoSort, type BuildPlan } from '@/core/build/plan';

const STEPS = 10_000;

function widePlan(): BuildPlan {
  const steps = Array.from({ length: STEPS }, (_, i) => ({
    id: `s${i}`,
    kind: 'identity',
    inputs: {},
    params: { i },
  }));
  return { id: 'wide-10k', steps };
}

const runner: StepRunner = async (step) => ({
  value: { kind: 'scalar', value: Number(step.params.i) },
});

describe('scale', () => {
  it('schedules and caches a 10,000-step DAG', async () => {
    const plan = widePlan();
    const topology = topoSort(plan);
    expect(topology.layers).toHaveLength(1);
    expect(topology.order).toHaveLength(STEPS);

    const engine = new BuildEngine({
      cache: new MemoryBuildCache({ maxEntries: STEPS + 1 }),
      environment: createBuildEnvironment({ appVersion: 'test', schemaVersion: 'v1' }),
      concurrency: 8,
    });

    const first = await engine.run(plan, runner);
    expect(first.stats.total).toBe(STEPS);
    expect(first.stats.computed).toBe(STEPS);
    expect(first.stats.failed).toBe(0);
    expect(first.outputs.size).toBe(STEPS);

    const second = await engine.run(plan, runner);
    expect(second.stats.computed).toBe(0);
    expect(second.stats.cached).toBe(STEPS);
    expect(second.outputs.size).toBe(STEPS);
  }, 60_000);
});
