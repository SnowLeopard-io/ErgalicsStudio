import { describe, expect, it } from 'vitest';
import { verifyBuildAttestation } from '@/core/build/provenance';
import { MemoryBuildCache } from '@/core/build/cache';
import { BuildEngine } from '@/core/build/engine';
import { createBuildEnvironment } from '@/core/build/key';
import {
  engineeringPlan,
  runEngineeringBuild,
  type EngineeringBuild,
} from '@/core/engineering/build';
import { INDUSTRIAL_EXAMPLES } from '@/core/engineering/examples';
import { cloneStudy } from '@/core/engineering/study';
import { ensureCase } from '@/core/engineering/cases';

function engine(): BuildEngine {
  return new BuildEngine({ cache: new MemoryBuildCache(), environment: createBuildEnvironment() });
}

describe('engineering build integration', () => {
  it('produces a BuildPlan derived from the study fingerprint', () => {
    const study = INDUSTRIAL_EXAMPLES[0]!.build();
    const step = ensureCase(study.cases)[0]!.steps[0]!;
    const plan = engineeringPlan(study, step);
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]!.kind).toBe('engineering.solve');
    expect(plan.steps[0]!.params).toHaveProperty('mesh');
    expect(plan.steps[0]!.params).toHaveProperty('materials');
  });

  it('hits the content-addressed cache on an unchanged rerun', async () => {
    const study = INDUSTRIAL_EXAMPLES[0]!.build();
    const shared = engine();
    const first: EngineeringBuild = await runEngineeringBuild(study, { engine: shared });
    expect(first.cached).toBe(false);
    expect(first.stats.computed).toBe(1);
    expect(first.result.metrics.maxDisplacement).toBeGreaterThan(0);
    expect(verifyBuildAttestation(first.attestation).ok).toBe(true);

    const second: EngineeringBuild = await runEngineeringBuild(study, { engine: shared });
    expect(second.cached).toBe(true);
    expect(second.stats.cached).toBe(1);
    expect(second.result.metrics.maxDisplacement).toBeCloseTo(first.result.metrics.maxDisplacement!, 6);
  });

  it('recomputes when the study material changes', async () => {
    const study = INDUSTRIAL_EXAMPLES[0]!.build();
    const shared = engine();
    await runEngineeringBuild(study, { engine: shared });
    const changed = cloneStudy(study);
    changed.materials[0]!.properties.E = 1.1e11;
    const rerun = await runEngineeringBuild(changed, { engine: shared });
    expect(rerun.cached).toBe(false);
    expect(rerun.stats.computed).toBe(1);
  });
});
