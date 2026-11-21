import { describe, expect, it } from 'vitest';
import { BuildEngine, type StepRunner } from '@/core/build/engine';
import { MemoryBuildCache } from '@/core/build/cache';
import { createBuildEnvironment } from '@/core/build/key';
import { affectedBy, topoSort, type BuildPlan, type BuildStep } from '@/core/build/plan';
import type { DataValue } from '@/types/datatable';

/** Deterministic PRNG (mulberry32) — property tests must be reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePlan(seed: number, steps: number, override?: (step: BuildStep) => BuildStep): BuildPlan {
  const random = rng(seed);
  const built: BuildStep[] = [];
  for (let i = 0; i < steps; i += 1) {
    const inputs: Record<string, string> = {};
    if (i > 0) {
      inputs.a = `s${Math.floor(random() * i)}`;
      if (random() < 0.5) {
        const second = Math.floor(random() * i);
        if (`s${second}` !== inputs.a) inputs.b = `s${second}`;
      }
    }
    const step: BuildStep = {
      id: `s${i}`,
      kind: 'sum',
      inputs,
      params: { mult: 1 + Math.floor(random() * 3), add: Math.floor(random() * 5) },
    };
    built.push(override ? override(step) : step);
  }
  return { id: `plan-${seed}`, steps: built };
}

function evaluateDirect(plan: BuildPlan): Map<string, number> {
  const values = new Map<string, number>();
  for (const id of topoSort(plan).order) {
    const step = plan.steps.find((s) => s.id === id)!;
    let sum = 0;
    for (const upstream of Object.values(step.inputs)) sum += values.get(upstream) ?? 0;
    const mult = Number(step.params.mult ?? 1);
    const add = Number(step.params.add ?? 0);
    values.set(id, sum * mult + add);
  }
  return values;
}

const runner: StepRunner = async (step, ctx) => {
  let sum = 0;
  for (const port of Object.keys(step.inputs)) {
    const input = ctx.getInput(port);
    if (input && 'kind' in input && input.kind === 'scalar' && typeof input.value === 'number') {
      sum += input.value;
    }
  }
  const mult = Number(step.params.mult ?? 1);
  const add = Number(step.params.add ?? 0);
  return { value: { kind: 'scalar', value: sum * mult + add } };
};

function numericOutputs(outputs: Map<string, DataValue>): Map<string, number> {
  const result = new Map<string, number>();
  for (const [id, value] of outputs) {
    if ('kind' in value && value.kind === 'scalar' && typeof value.value === 'number') {
      result.set(id, value.value);
    }
  }
  return result;
}

describe('incremental-build invariants (property tests)', () => {
  it('never serves a stale value after a parameter change', async () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const before = makePlan(seed, 40);
      const targetIndex = seed % before.steps.length;
      const targetId = before.steps[targetIndex]!.id;
      const after = makePlan(seed, 40, (step) =>
        step.id === targetId
          ? { ...step, params: { ...step.params, add: Number(step.params.add ?? 0) + 7 } }
          : step,
      );

      const engine = new BuildEngine({
        cache: new MemoryBuildCache(),
        environment: createBuildEnvironment({ appVersion: 'test', schemaVersion: 'v1' }),
        concurrency: 4,
      });
      const first = await engine.run(before, runner);
      expect(numericOutputs(first.outputs)).toEqual(evaluateDirect(before));

      const second = await engine.run(after, runner);
      const incremental = numericOutputs(second.outputs);
      expect(incremental).toEqual(evaluateDirect(after));

      // The same plan through a cold engine must agree bit-for-bit.
      const cold = new BuildEngine({
        cache: new MemoryBuildCache(),
        environment: createBuildEnvironment({ appVersion: 'test', schemaVersion: 'v1' }),
        concurrency: 4,
      });
      const coldRun = await cold.run(after, runner);
      expect(numericOutputs(coldRun.outputs)).toEqual(incremental);

      // Exactly the affected sub-graph recomputed.
      const affected = affectedBy(after, [targetId]);
      const status = new Map(second.stats.steps.map((s) => [s.id, s.status]));
      for (const step of after.steps) {
        if (affected.has(step.id)) expect(status.get(step.id)).toBe('computed');
        else expect(status.get(step.id)).toBe('cached');
      }
    }
  });
});
