// ==========================================================================
// Engineering solve ↔ shared build system bridge
//
// An industrial solve is content-addressed exactly like a Flow run:
//   key = H(solver implementation, study fingerprint, step id/environment)
// Re-running an unchanged study HITS the cache instead of re-solving, and the
// run produces the same BuildStats / BuildAttestation surfaces as block mode.
//
// The solve result (fields with Float64Arrays) is not a DataValue, so it is
// transported as a JSON scalar inside the cache; a cache hit restores it from
// that scalar. This keeps the solve itself pure and the cache general.
// ==========================================================================

import { BuildEngine } from '@/core/build/engine';
import { createBuildCache } from '@/core/build/cache';
import { createBuildEnvironment } from '@/core/build/key';
import type { BuildPlan } from '@/core/build/plan';
import type { BuildStats, StepRunner } from '@/core/build/engine';
import { createBuildAttestation, type BuildAttestation } from '@/core/build/provenance';
import type { DataValue } from '@/types/datatable';
import { engineeringFingerprint } from './study';
import { ensureCase, normalizeStep } from './cases';
import { fromResultSnapshot, solveEngineeringStudy, SOLVER_NAME, SOLVER_VERSION, toResultSnapshot } from './solve';
import type { EngineeringSolveResult, EngineeringStep, EngineeringStudy } from './types';

export interface EngineeringBuild {
  result: EngineeringSolveResult;
  stats: BuildStats;
  attestation: BuildAttestation;
  /** True when the solve came from the content-addressed cache. */
  cached: boolean;
}

export interface RunEngineeringBuildOptions {
  step?: EngineeringStep;
  /** Reuse an engine (the app keeps one per session for a warm cache). */
  engine?: BuildEngine;
  /** Override request time for deterministic tests. */
  now?: number;
}

/** Build plan for one engineering solve step (nothing graph-specific). */
export function engineeringPlan(
  study: EngineeringStudy,
  step: EngineeringStep,
): BuildPlan {
  const fingerprint = engineeringFingerprint(study, {
    solverName: SOLVER_NAME,
    solverVersion: SOLVER_VERSION,
  });
  return {
    id: 'engineering-solve',
    steps: [
      {
        id: 'solve',
        kind: 'engineering.solve',
        params: {
          mesh: fingerprint.meshHash,
          materials: fingerprint.materialHashes,
          case: fingerprint.caseHash,
          solver: fingerprint.solver,
          stepId: step.id,
          stepKind: step.kind,
          solverConfig: step.solver,
        },
        inputs: {},
        implementation: `${SOLVER_NAME}@${SOLVER_VERSION}`,
      },
    ],
  };
}

/** Lazily create the shared engineering build engine (one warm cache/session). */
let sharedEngine: BuildEngine | null = null;
export function getEngineeringBuildEngine(): BuildEngine {
  if (!sharedEngine) {
    sharedEngine = new BuildEngine({
      cache: createBuildCache({
        // Same policy as block mode: persistent in the browser, memory in Node.
        persistent: typeof window !== 'undefined',
      }),
      environment: createBuildEnvironment(),
    });
  }
  return sharedEngine;
}

/** Drop all cached engineering solves and reset the engine. */
export function clearEngineeringBuildCache(): void {
  void getEngineeringBuildEngine().clearCache();
  sharedEngine = null;
}

/**
 * Solve an engineering study through the shared build engine. A hit restores
 * the serialized result instead of re-solving; either way a BuildStats and a
 * digest-verifiable attestation are produced.
 */
export async function runEngineeringBuild(
  study: EngineeringStudy,
  options: RunEngineeringBuildOptions = {},
): Promise<EngineeringBuild> {
  const step = normalizeStep(
    options.step ?? ensureCase(study.cases)[0]!.steps[0]!,
  );
  const plan = engineeringPlan(study, step);
  const engine = options.engine ?? getEngineeringBuildEngine();
  let computedResult: EngineeringSolveResult | null = null;
  const runner: StepRunner = async () => {
    const result = solveEngineeringStudy(study, { step });
    computedResult = result;
    const value: DataValue = {
      kind: 'scalar',
      value: JSON.stringify(toResultSnapshot(result)),
    };
    return { value };
  };

  const run = await engine.run(plan, runner);
  const decision = run.stats.steps[0];
  const cached = decision?.status === 'cached';

  // On a hit, restore the result from the cached scalar; on a compute, reuse
  // the freshly solved value. We solve once on compute (runner) and decode on
  // hit — never twice.
  let result: EngineeringSolveResult;
  if (cached) {
    const raw = run.outputs.get('solve');
    const text = raw && 'kind' in raw && raw.kind === 'scalar' ? String(raw.value) : '';
    const restored = fromResultSnapshot(JSON.parse(text));
    if (!restored) throw new Error('cached engineering result could not be restored');
    // Display-only refresh: the snapshot carries the step name from whenever
    // it was first computed, so a rename since then would show stale. stepId
    // is part of the cache key, so identity holds — only the label changes
    // (the cache key itself is untouched).
    result = restored.stepName === step.name ? restored : { ...restored, stepName: step.name };
  } else {
    // The runner solved on the compute path; reuse that result rather than
    // solving a second time.
    const solved = computedResult as EngineeringSolveResult | null;
    if (!solved) throw new Error('engineering solve produced no result');
    result = solved;
  }
  // Keep fields on the returned study object for downstream pages; mutation of
  // a copy avoids clobbering the caller's study.
  const environment = engine.environment;
  const attestation = createBuildAttestation({ plan, stats: run.stats, environment });
  return { result, stats: run.stats, attestation, cached };
}
