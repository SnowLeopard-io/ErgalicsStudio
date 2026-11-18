// ==========================================================================
// Ergalics Studio — build-system adapter for the block DAG (pure TS)
//
// The existing block system already has a serializable execution model:
// `compile(graph, registry)` → `CompiledRegion` (nodes + a topological order)
// and each node carries an `execute(ctx)` function. This adapter maps that
// region onto a `BuildPlan` and turns each node into a build step, so the
// content-addressed engine can drive it without changing the compiler, the
// block catalog or the runtime environment contract.
//
// Semantics preserved from `DagExecutor`:
//   • `getInput` / `getParam` / `gpu` / `storage` / `onProgress`
//   • `onNodeStatus('computing' | 'done' | 'error')` for the canvas
//   • cancellation between nodes via the engine's AbortSignal
//
// Semantics *changed* (documented deliberately):
//   • `markDirty()` no longer marks a dirty set. It declares the current
//     result run-local (`uncacheable`), because a block that reports a hidden
//     input cannot be trusted under a content key. Consumers then recompute
//     from a volatile key. This is strictly safer than the old behaviour,
//     which dropped the invalidation once the run had finished.
//   • A node whose output is a `RenderedView` is never persisted (it is a
//     handle into the live plugin runtime, not data).
// ==========================================================================

import type { RuntimeEnvironment } from '@/blocks/context';
import type { CompiledNode, CompiledRegion, DagExecutionContext } from '@/types/dag';
import { hashValue } from './hash';
import type {
  BuildEngine,
  BuildRunOptions,
  BuildRunResult,
  StepRunOutput,
  StepRunner,
} from './engine';
import type { BuildPlan, BuildStep } from './plan';

/** Map a compiled block region onto the engine's pure plan model. */
export function compiledRegionToPlan(region: CompiledRegion): BuildPlan {
  const steps: BuildStep[] = region.nodes.map((node) => ({
    id: node.id,
    kind: node.blockId,
    params: node.params,
    inputs: node.inputs,
    // The executor source is the "code" component of the cache key. Without
    // it, editing a block implementation while keeping its id/params would
    // serve stale results from a previous session.
    ...(node.execute ? { implementation: hashValue(node.execute.toString()) } : {}),
    ...(node.execute ? { identity: node.execute } : {}),
  }));
  return { id: region.id, steps };
}

export interface BlockRunnerHooks {
  /** Called when a block invokes `markDirty()` (surfaced for diagnostics). */
  onDirty?: (nodeId: string) => void;
}

/**
 * Build a `StepRunner` that executes compiled block nodes. Inputs are read
 * from the engine's live output map (never from a stale global cache).
 */
export function createBlockRunner(
  region: CompiledRegion,
  env: RuntimeEnvironment,
  hooks: BlockRunnerHooks = {},
): StepRunner {
  const byId = new Map<string, CompiledNode>();
  for (const node of region.nodes) byId.set(node.id, node);

  return async (step, ctx): Promise<StepRunOutput> => {
    const node = byId.get(step.id);
    if (!node) throw new Error(`build step "${step.id}" has no compiled node`);
    if (!node.execute) {
      throw new Error(`node "${node.id}" (block "${node.blockId}") has no executor`);
    }

    let runLocalReason: string | undefined;
    const executionContext: DagExecutionContext = {
      nodeId: node.id,
      getInput: (portId) => ctx.getInput(portId),
      getParam: (name) => node.params[name],
      markDirty: () => {
        runLocalReason = 'mark-dirty';
        ctx.markUncacheable('mark-dirty');
        hooks.onDirty?.(node.id);
      },
      gpu: env.gpu,
      storage: env.storage,
      onProgress: (progress) => env.onProgress?.(progress),
    };

    const value = await node.execute(executionContext);
    return {
      value: value ?? undefined,
      cacheable: runLocalReason === undefined,
      ...(runLocalReason !== undefined ? { reason: runLocalReason } : {}),
    };
  };
}

/**
 * Execute a compiled region through the build engine. The returned stats
 * distinguish cache hits from real computations — the data behind the UI's
 * "why did this rerun?" panel and the run-record metrics.
 */
export async function runCompiledRegion(
  region: CompiledRegion,
  env: RuntimeEnvironment,
  engine: BuildEngine,
  options: BuildRunOptions = {},
  hooks: BlockRunnerHooks = {},
): Promise<BuildRunResult> {
  const plan = compiledRegionToPlan(region);
  const runner = createBlockRunner(region, env, hooks);
  const onStepStatus = options.onStepStatus ?? env.onNodeStatus;
  return engine.run(plan, runner, {
    ...options,
    ...(onStepStatus ? { onStepStatus } : {}),
  });
}
