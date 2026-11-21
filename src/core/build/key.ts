// ==========================================================================
// Ergalics Studio — content-addressed cache keys (pure TS)
//
// A step key fingerprints *what is computed*, never *where it lives*:
//
//   key = H(schema, kind, params, {port → upstream content key}, environment)
//
// Consequences that make the cache trustworthy:
//   • Renaming a node, moving it on the canvas, or re-importing identical data
//     under another file name reuses the entry (no ids in the key).
//   • Changing one numeric parameter changes that key and every downstream key
//     (inputs are content keys, not ids), so stale values are unreachable.
//   • Upgrading the app or changing the key schema invalidates everything in
//     one shot via the environment fingerprint.
// ==========================================================================

import { currentAppVersion } from '@/core/citation';
import { ContentHasher, hashValue } from './hash';
import type { BuildStep } from './plan';

/**
 * Bump when the *meaning* of a key changes (hash layout, codec semantics).
 * All persisted entries are then unreachable and evict naturally.
 */
export const BUILD_KEY_SCHEMA = 'ergalics.build-key/v1';

/** Environment inputs that can change a computation's result. */
export interface BuildEnvironment {
  /** Studio build version (`__APP_VERSION__`). */
  appVersion: string;
  /** Key schema / engine semantics version. */
  schemaVersion: string;
  /**
   * Extra runtime capabilities that affect results, e.g. `gpu: 'webgpu'`,
   * plugin versions, or a Python/R runtime build id. Sorted when hashed.
   */
  capabilities?: Record<string, string>;
}

export function createBuildEnvironment(overrides: Partial<BuildEnvironment> = {}): BuildEnvironment {
  return {
    appVersion: overrides.appVersion ?? currentAppVersion(),
    schemaVersion: overrides.schemaVersion ?? BUILD_KEY_SCHEMA,
    ...(overrides.capabilities ? { capabilities: { ...overrides.capabilities } } : {}),
  };
}

/** Stable fingerprint of the environment component of every cache key. */
export function environmentFingerprint(env: BuildEnvironment): string {
  const capabilities: Record<string, string> = {};
  for (const [key, value] of Object.entries(env.capabilities ?? {})) {
    capabilities[key] = value;
  }
  return hashValue({
    appVersion: env.appVersion,
    schemaVersion: env.schemaVersion,
    capabilities,
  });
}

/** Four separately inspectable hash components (UI: "why did this rerun?"). */
export interface StepKeyBreakdown {
  key: string;
  /** What the step computes (block/code kind). */
  kind: string;
  /** Hash of parameters only. */
  params: string;
  /** Hash of the sorted port → upstream-key map. */
  inputs: string;
  /** Environment fingerprint. */
  environment: string;
  /** Port → upstream key actually used (provenance debugging). */
  inputKeys: Record<string, string>;
}

/**
 * Compute a step's content key.
 *
 * `inputKeys` must contain one entry per input port. Missing ports are folded
 * in as the literal `"missing"` so adding/removing an edge always changes the
 * key even when both sides happen to be undefined.
 */
export function computeStepKey(
  step: BuildStep,
  inputKeys: Readonly<Record<string, string>>,
  environment: string,
): StepKeyBreakdown {
  const ports = Object.keys(step.inputs).sort();
  const canonicalInputs: Record<string, string> = {};
  for (const port of ports) canonicalInputs[port] = inputKeys[port] ?? 'missing';

  const params = hashValue(step.params);
  const inputs = hashValue(canonicalInputs);
  const key = new ContentHasher()
    .updateString(BUILD_KEY_SCHEMA)
    .updateString(step.kind)
    .updateString(step.implementation ?? '')
    .updateString(params)
    .updateString(inputs)
    .updateString(environment)
    .digest();

  return { key, kind: step.kind, params, inputs, environment, inputKeys: canonicalInputs };
}

/**
 * Key for an output that must not be persisted (rendered views, steps that
 * declared themselves non-deterministic via `markDirty`). `runToken` makes it
 * unique per run, so downstream steps always recompute when they consume a
 * run-local value.
 */
export function volatileStepKey(step: BuildStep, runToken: string, environment: string): string {
  return hashValue({ volatile: step.id, kind: step.kind, run: runToken, env: environment });
}
