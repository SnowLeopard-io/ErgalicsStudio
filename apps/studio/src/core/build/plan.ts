// ==========================================================================
// Ergalics Studio — build plan model & graph algorithms (pure TS)
//
// A `BuildPlan` is the serializable, executor-free form of a computation:
// every step has a `kind` (what it computes), `params` (its knobs) and named
// `inputs` (port → upstream step id). The engine turns this into content-
// addressed cache keys, so the plan never contains runtime state.
//
// Everything here is deterministic and dependency-free: topological layering,
// cycle reporting (with the actual cycle), reverse dependency closure and
// "what would a parameter change recompute?" queries.
// ==========================================================================

import { hashValue } from './hash';

/** One pure computation node. */
export interface BuildStep {
  /** Graph-local identity; NOT part of the cache key (renames must reuse). */
  id: string;
  /** Executor/block identity, e.g. `stats.mean` or `code`. */
  kind: string;
  params: Record<string, unknown>;
  /** Input port id → upstream step id. */
  inputs: Record<string, string>;
  /**
   * Optional fingerprint of the *implementation* (block executor source,
   * compiled code, interpreter version). Part of the cache key, so editing
   * code invalidates results even when inputs and params are unchanged.
   */
  implementation?: string;
  /**
   * Session-local executor identity (the function object itself). Never part
   * of a key or a fingerprint: it lets the engine reject a *same-session*
   * cache hit produced by a different function with identical source text
   * (hot-reloaded plugins, test registries). Cross-session hits, where no
   * identity is known yet, are still trusted.
   */
  identity?: object;
}

export interface BuildPlan {
  id: string;
  steps: BuildStep[];
}

/** Invalid graph: duplicate ids, dangling dependencies or a cycle. */
export class BuildPlanError extends Error {
  readonly cycle: string[];
  constructor(message: string, cycle: string[] = []) {
    super(message);
    this.name = 'BuildPlanError';
    this.cycle = cycle;
  }
}

export interface BuildTopology {
  /** Flat topological order (stable: declaration order breaks ties). */
  order: string[];
  /** Same order, grouped into levels that can run concurrently. */
  layers: string[][];
  /** step id → ids it directly depends on (deduplicated). */
  dependencies: Map<string, string[]>;
}

function indexPlan(plan: BuildPlan): Map<string, BuildStep> {
  const byId = new Map<string, BuildStep>();
  for (const step of plan.steps) {
    if (byId.has(step.id)) {
      throw new BuildPlanError(`duplicate step id "${step.id}"`);
    }
    byId.set(step.id, step);
  }
  return byId;
}

/** Direct dependencies, deduplicated and stable by port declaration order. */
export function stepDependencies(step: BuildStep): string[] {
  const seen = new Set<string>();
  const deps: string[] = [];
  for (const upstream of Object.values(step.inputs)) {
    if (seen.has(upstream)) continue;
    seen.add(upstream);
    deps.push(upstream);
  }
  return deps;
}

/**
 * Kahn layering with deterministic tie-breaking. Throws `BuildPlanError` for
 * dangling references or cycles (the cycle path is attached for the UI).
 */
export function topoSort(plan: BuildPlan): BuildTopology {
  const byId = indexPlan(plan);
  const dependencies = new Map<string, string[]>();
  const dependents = new Map<string, string[]>();

  for (const step of plan.steps) {
    const deps = stepDependencies(step);
    for (const dep of deps) {
      if (!byId.has(dep)) {
        throw new BuildPlanError(`step "${step.id}" depends on unknown step "${dep}"`);
      }
    }
    dependencies.set(step.id, deps);
    for (const dep of deps) {
      const list = dependents.get(dep);
      if (list) list.push(step.id);
      else dependents.set(dep, [step.id]);
    }
  }

  // `remaining` = unmet dependency count. Declaration order is preserved by
  // iterating `plan.steps` (not the Map) when seeding each layer.
  const remaining = new Map<string, number>();
  for (const step of plan.steps) remaining.set(step.id, dependencies.get(step.id)?.length ?? 0);

  let ready = plan.steps.filter((s) => remaining.get(s.id) === 0).map((s) => s.id);
  const layers: string[][] = [];
  const order: string[] = [];

  while (ready.length > 0) {
    layers.push(ready);
    order.push(...ready);
    const next: string[] = [];
    for (const id of ready) {
      for (const dependent of dependents.get(id) ?? []) {
        const left = (remaining.get(dependent) ?? 0) - 1;
        remaining.set(dependent, left);
        if (left === 0) next.push(dependent);
      }
    }
    ready = next;
  }

  if (order.length !== plan.steps.length) {
    const cycle = findCycle(plan, byId, dependencies, new Set(order));
    const label = cycle.length > 0 ? cycle.join(' → ') : 'unknown cycle';
    throw new BuildPlanError(`build plan contains a cycle: ${label}`, cycle);
  }

  return { order, layers, dependencies };
}

/** Depth-first search restricted to nodes not yet topologically ordered. */
function findCycle(
  plan: BuildPlan,
  byId: Map<string, BuildStep>,
  dependencies: Map<string, string[]>,
  ordered: Set<string>,
): string[] {
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    if (ordered.has(id)) return null;
    const current = state.get(id);
    if (current === 'done') return null;
    if (current === 'visiting') {
      const start = stack.indexOf(id);
      return [...stack.slice(start >= 0 ? start : 0), id];
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of dependencies.get(id) ?? []) {
      if (!byId.has(dep)) continue;
      const found = visit(dep);
      if (found) return found;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };

  for (const step of plan.steps) {
    const found = visit(step.id);
    if (found) return found;
  }
  return [];
}

/** step id → direct dependents (reverse edges), declaration-ordered. */
export function reverseDependencies(plan: BuildPlan): Map<string, string[]> {
  const reverse = new Map<string, string[]>();
  for (const step of plan.steps) {
    for (const dep of stepDependencies(step)) {
      const list = reverse.get(dep);
      if (list) list.push(step.id);
      else reverse.set(dep, [step.id]);
    }
  }
  return reverse;
}

/**
 * Transitive downstream closure of `seeds`, including the seeds themselves.
 * This is the exact sub-graph a changed input/param can affect.
 */
export function affectedBy(plan: BuildPlan, seeds: Iterable<string>): Set<string> {
  const reverse = reverseDependencies(plan);
  const affected = new Set<string>();
  const stack = [...seeds];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (affected.has(id)) continue;
    affected.add(id);
    for (const dependent of reverse.get(id) ?? []) stack.push(dependent);
  }
  return affected;
}

/** Transitive upstream closure of `seeds` (provenance / "why this number"). */
export function upstreamOf(plan: BuildPlan, seeds: Iterable<string>): Set<string> {
  const byId = indexPlan(plan);
  const seen = new Set<string>();
  const stack = [...seeds];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const step = byId.get(id);
    if (!step) continue;
    for (const dep of stepDependencies(step)) stack.push(dep);
  }
  return seen;
}

/**
 * Structural fingerprint of a plan, for run records and provenance. Includes
 * step ids (it identifies *this* graph), unlike step cache keys.
 */
export function planFingerprint(plan: BuildPlan): string {
  const steps = [...plan.steps]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((step) => ({
      id: step.id,
      kind: step.kind,
      params: step.params,
      inputs: step.inputs,
      implementation: step.implementation ?? '',
    }));
  return hashValue({ plan: plan.id, steps });
}

/**
 * Steps whose *cache key* would change if `changed` steps produced different
 * content. This is what the engine actually recomputes; unlike `affectedBy`
 * (structural), it is used by callers to preview a partial rebuild before the
 * run starts.
 */
export function previewAffected(plan: BuildPlan, changed: Iterable<string>): BuildStep[] {
  const affected = affectedBy(plan, changed);
  return plan.steps.filter((step) => affected.has(step.id));
}
