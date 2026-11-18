// ==========================================================================
// Ergalics Studio — incremental build engine (pure TS)
//
// The engine executes a `BuildPlan` as a dependency-ordered wavefront:
//
//     key = H(kind, params, upstream content keys, environment)
//     hit  → decode the cached value, skip the computation entirely
//     miss → run the step, encode + persist the result under its key
//
// Because keys are *content* addresses, a parameter change produces new keys
// for exactly the affected downstream sub-graph; every untouched branch still
// hits the cache. That is the whole trick behind both "partial recompute" and
// "why did this number change" provenance.
//
// Guarantees:
//   • No stale values: a step is only served from cache under the key of this
//     run's exact inputs/params/environment.
//   • Deterministic report: decisions are emitted in topological order.
//   • Cooperative cancellation via `AbortSignal` (checked between steps).
//   • Failure isolation: on `stopOnError` the first failure aborts the run;
//     otherwise downstream steps are marked blocked and independent branches
//     continue.
// ==========================================================================

import {
  isDataTable,
  isDataset,
  isRenderedView,
  isScalar,
  type DataValue,
} from '@/types/datatable';
import type { BuildCache } from './cache';
import { decodeDataValue, encodeDataValue } from './codec';
import { environmentFingerprint, type BuildEnvironment } from './key';
import { computeStepKey, volatileStepKey, type StepKeyBreakdown } from './key';
import {
  planFingerprint,
  topoSort,
  type BuildPlan,
  type BuildStep,
} from './plan';
import { hashDataValue } from './hash';

/** Cooperative cancellation; callers usually swallow this (as the old DAG
 *  executor did) so a superseded run never paints an error onto the canvas. */
export class BuildAbortedError extends Error {
  constructor() {
    super('build cancelled');
    this.name = 'BuildAbortedError';
  }
}

/** A step threw. `stepId` identifies the failing node for UI status writes. */
export class BuildStepError extends Error {
  readonly stepId: string;
  constructor(stepId: string, message: string) {
    super(message);
    this.name = 'BuildStepError';
    this.stepId = stepId;
  }
}

/** What a runner may return. A bare `DataValue` is accepted as a convenience. */
export interface StepRunOutput {
  value?: DataValue | void;
  /** False forces this step (and its consumers) to recompute next run. */
  cacheable?: boolean;
  /** Free-form note surfaced in the report (e.g. `markDirty()`). */
  reason?: string;
}

export interface StepRunContext {
  readonly step: BuildStep;
  /** Value arriving on an input port (undefined when unconnected). */
  getInput(port: string): DataValue | undefined;
  /** Output of any already-computed step (used for lineage/adapters). */
  getOutput(stepId: string): DataValue | undefined;
  /**
   * Declare the current result run-local: never persisted, and consumers get a
   * volatile key. Adapters call this when a block invokes `markDirty()`.
   */
  markUncacheable(reason?: string): void;
}

export type StepRunner = (
  step: BuildStep,
  ctx: StepRunContext,
) => Promise<StepRunOutput | DataValue | void>;

export type StepDecisionStatus = 'computed' | 'cached' | 'blocked' | 'failed';

export interface StepDecision {
  id: string;
  kind: string;
  status: StepDecisionStatus;
  /** Content key (volatile for run-local outputs; empty when blocked). */
  key: string;
  /** Machine-readable explanation: `cache-hit`, `computed`, `mark-dirty`, … */
  reason: string;
  cacheable: boolean;
  durationMs: number;
  /** Hash components, so the UI can explain *which* part changed. */
  breakdown?: StepKeyBreakdown;
  /** For cached steps: true when the persisted bytes could not be decoded. */
  error?: string;
  /** For cached steps: whether the value came from a persistent store. */
  fromPersistence?: boolean;
}

export interface BuildStats {
  planId: string;
  planHash: string;
  environment: string;
  total: number;
  computed: number;
  cached: number;
  blocked: number;
  failed: number;
  durationMs: number;
  concurrency: number;
  /** Content hash of every output, in step id order (provenance/reporting). */
  outputs: Record<string, string>;
  steps: StepDecision[];
}

export interface BuildRunResult {
  outputs: Map<string, DataValue>;
  stats: BuildStats;
  errors: Map<string, string>;
}

export interface BuildRunOptions {
  signal?: AbortSignal;
  /** Defaults to the engine's constructor value. */
  concurrency?: number;
  /** Abort on the first failing step (default true). */
  stopOnError?: boolean;
  /** Recompute everything, but still refresh the cache (e.g. "force rebuild"). */
  bypassCache?: boolean;
  onStepStatus?: (stepId: string, status: 'computing' | 'done' | 'error') => void;
  onDecision?: (decision: StepDecision) => void;
}

export interface BuildEngineOptions {
  cache: BuildCache;
  environment: BuildEnvironment;
  /** Parallel steps per layer. Defaults to 4 (I/O + CPU mix in a browser). */
  concurrency?: number;
}

function isDataValueLike(value: unknown): value is DataValue {
  if (value === null || typeof value !== 'object') return false;
  const v = value as DataValue;
  return isDataTable(v) || isDataset(v) || isScalar(v) || isRenderedView(v);
}

/** Accept both `{ value }` envelopes and bare `DataValue` returns. */
function normalizeOutput(result: StepRunOutput | DataValue | void): StepRunOutput {
  if (result === undefined || result === null) return {};
  if (isDataValueLike(result)) return { value: result };
  return result as StepRunOutput;
}

export class BuildEngine {
  private readonly cache: BuildCache;
  readonly environment: BuildEnvironment;
  private readonly envFingerprint: string;
  private readonly concurrency: number;
  /**
   * key → executor object that produced the current session's cached value.
   * Not persisted; see `BuildStep.identity`.
   */
  private readonly producers = new Map<string, object>();
  private runSeq = 0;

  constructor(options: BuildEngineOptions) {
    this.cache = options.cache;
    this.environment = options.environment;
    this.envFingerprint = environmentFingerprint(options.environment);
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
  }

  get environmentFingerprint(): string {
    return this.envFingerprint;
  }

  /** Storage-level stats of the backing cache (UI: build cache panel). */
  async cacheStats(): ReturnType<BuildCache['stats']> {
    return this.cache.stats();
  }

  /**
   * Drop every cached value (memory + persistence) and the session's producer
   * identities. Subsequent runs recompute from scratch under fresh keys.
   */
  async clearCache(): Promise<void> {
    await this.cache.clear();
    this.producers.clear();
  }

  async run(
    plan: BuildPlan,
    runner: StepRunner,
    options: BuildRunOptions = {},
  ): Promise<BuildRunResult> {
    const topology = topoSort(plan);
    const runToken = `${++this.runSeq}-${plan.steps.length}`;
    const limit = Math.max(1, Math.floor(options.concurrency ?? this.concurrency));
    const stopOnError = options.stopOnError ?? true;

    const byId = new Map<string, BuildStep>();
    for (const step of plan.steps) byId.set(step.id, step);

    const outputs = new Map<string, DataValue>();
    const keys = new Map<string, string>();
    const failed = new Set<string>();
    const blocked = new Set<string>();
    const errors = new Map<string, string>();
    const decisions: StepDecision[] = [];
    const startedAt = Date.now();
    const decisionsById = new Map<string, StepDecision>();

    let stopped = false;
    let firstError: BuildStepError | null = null;

    const signal = options.signal;
    const checkAbort = (): void => {
      if (signal?.aborted) throw new BuildAbortedError();
    };

    for (const layer of topology.layers) {
      checkAbort();
      if (stopped) break;
      await this.runLimited(layer, limit, async (id) => {
        if (stopped || signal?.aborted) return;
        const step = byId.get(id);
        if (!step) return;
        const decision = await this.runStep(step, {
          runner,
          keys,
          outputs,
          failed,
          blocked,
          errors,
          runToken,
          bypassCache: options.bypassCache ?? false,
          onStepStatus: options.onStepStatus,
        });
        decisions.push(decision);
        decisionsById.set(decision.id, decision);
        options.onDecision?.(decision);
        if (decision.status === 'failed') {
          if (stopOnError) {
            stopped = true;
            if (!firstError) {
              firstError = new BuildStepError(
                decision.id,
                errors.get(decision.id) ?? `step "${decision.id}" failed`,
              );
            }
          }
        }
      });
      if (firstError) break;
    }

    // Steps never reached because of a failure/abort are reported as blocked,
    // so `stats.total` always matches the plan size.
    for (const step of plan.steps) {
      if (decisionsById.has(step.id)) continue;
      const decision: StepDecision = {
        id: step.id,
        kind: step.kind,
        status: 'blocked',
        key: '',
        reason: stopped ? 'upstream-failed' : 'not-run',
        cacheable: false,
        durationMs: 0,
      };
      decisions.push(decision);
      decisionsById.set(step.id, decision);
    }

    const stats = this.summarize(plan, topology.order, decisions, outputs, startedAt, limit);
    if (firstError) throw firstError;
    if (signal?.aborted) throw new BuildAbortedError();
    return { outputs, stats, errors };
  }

  private async runStep(
    step: BuildStep,
    state: {
      runner: StepRunner;
      keys: Map<string, string>;
      outputs: Map<string, DataValue>;
      failed: Set<string>;
      blocked: Set<string>;
      errors: Map<string, string>;
      runToken: string;
      bypassCache: boolean;
      onStepStatus?: BuildRunOptions['onStepStatus'];
    },
  ): Promise<StepDecision> {
    const startedAt = Date.now();
    const inputKeys: Record<string, string> = {};
    const upstreamFailed: string[] = [];
    const upstreamBlocked: string[] = [];
    for (const [port, upstream] of Object.entries(step.inputs)) {
      inputKeys[port] = state.keys.get(upstream) ?? 'missing';
      if (state.failed.has(upstream)) upstreamFailed.push(upstream);
      else if (state.blocked.has(upstream)) upstreamBlocked.push(upstream);
    }

    if (upstreamFailed.length > 0 || upstreamBlocked.length > 0) {
      const reason = upstreamFailed.length > 0 ? 'upstream-failed' : 'upstream-blocked';
      const key = volatileStepKey(step, state.runToken, this.envFingerprint);
      state.keys.set(step.id, key);
      state.blocked.add(step.id);
      return {
        id: step.id,
        kind: step.kind,
        status: 'blocked',
        key,
        reason,
        cacheable: false,
        durationMs: Date.now() - startedAt,
      };
    }

    const breakdown = computeStepKey(step, inputKeys, this.envFingerprint);

    if (!state.bypassCache) {
      // A same-session entry produced by a *different* function object is not
      // trustworthy even when its source text hashes the same.
      const knownProducer = this.producers.get(breakdown.key);
      const identityConflict =
        step.identity !== undefined &&
        knownProducer !== undefined &&
        knownProducer !== step.identity;
      if (!identityConflict) {
        const cached = await this.readCache(breakdown.key);
        if (cached) {
          if (step.identity !== undefined) this.producers.set(breakdown.key, step.identity);
          state.outputs.set(step.id, cached.value);
          state.keys.set(step.id, breakdown.key);
          state.onStepStatus?.(step.id, 'done');
          return {
            id: step.id,
            kind: step.kind,
            status: 'cached',
            key: breakdown.key,
            reason: 'cache-hit',
            cacheable: true,
            durationMs: Date.now() - startedAt,
            breakdown,
            ...(cached.fromPersistence !== undefined
              ? { fromPersistence: cached.fromPersistence }
              : {}),
          };
        }
      }
    }

    state.onStepStatus?.(step.id, 'computing');
    let uncacheableReason: string | undefined;
    let result: StepRunOutput;
    try {
      result = normalizeOutput(
        await state.runner(step, {
          step,
          getInput: (port) => {
            const upstream = step.inputs[port];
            return upstream ? state.outputs.get(upstream) : undefined;
          },
          getOutput: (stepId) => state.outputs.get(stepId),
          markUncacheable: (reason) => {
            uncacheableReason = reason ?? 'mark-dirty';
          },
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.failed.add(step.id);
      state.errors.set(step.id, message);
      state.keys.set(step.id, volatileStepKey(step, state.runToken, this.envFingerprint));
      state.onStepStatus?.(step.id, 'error');
      return {
        id: step.id,
        kind: step.kind,
        status: 'failed',
        key: '',
        reason: 'error',
        cacheable: false,
        durationMs: Date.now() - startedAt,
        breakdown,
        error: message,
      };
    }

    const value = result.value ?? undefined;
    const renderedView = value !== undefined && isRenderedView(value);
    const cacheable = !renderedView && result.cacheable !== false && uncacheableReason === undefined;
    let encoded: ReturnType<typeof encodeDataValue> = null;
    if (cacheable && value !== undefined) {
      try {
        encoded = encodeDataValue(value);
      } catch {
        // A value the codec cannot represent is simply not persisted.
        encoded = null;
      }
    }
    const canPersist = cacheable && encoded !== null;

    if (canPersist && encoded !== null) {
      state.keys.set(step.id, breakdown.key);
      if (step.identity !== undefined) this.producers.set(breakdown.key, step.identity);
      try {
        await this.cache.put({
          key: breakdown.key,
          value: encoded,
          label: `${step.kind}:${step.id}`,
        });
      } catch {
        // A cache write failure must never fail a successful computation.
      }
    } else {
      state.keys.set(step.id, volatileStepKey(step, state.runToken, this.envFingerprint));
      // A run-local result must not leave a reusable stale entry behind for a
      // block that declared hidden/nondeterministic inputs.
      if (value !== undefined) {
        try {
          await this.cache.delete(breakdown.key);
        } catch {
          // best effort
        }
      }
    }

    if (value !== undefined) state.outputs.set(step.id, value);
    state.onStepStatus?.(step.id, 'done');

    const reason = renderedView
      ? 'rendered-view'
      : uncacheableReason ?? result.reason ?? (value === undefined ? 'no-output' : 'computed');

    return {
      id: step.id,
      kind: step.kind,
      status: 'computed',
      key: state.keys.get(step.id) ?? breakdown.key,
      reason,
      cacheable: canPersist,
      durationMs: Date.now() - startedAt,
      breakdown,
    };
  }

  /** Decode a cache hit; a corrupt entry is treated as a miss and evicted. */
  private async readCache(
    key: string,
  ): Promise<{ value: DataValue; fromPersistence?: boolean } | null> {
    let entry;
    try {
      entry = await this.cache.get(key);
    } catch {
      return null;
    }
    if (!entry) return null;
    try {
      const value = decodeDataValue(entry.value);
      return { value };
    } catch {
      try {
        await this.cache.delete(key);
      } catch {
        // best effort
      }
      return null;
    }
  }

  private summarize(
    plan: BuildPlan,
    order: string[],
    decisions: StepDecision[],
    outputs: Map<string, DataValue>,
    startedAt: number,
    concurrency: number,
  ): BuildStats {
    const byId = new Map(decisions.map((d) => [d.id, d] as const));
    const ordered = order
      .map((id) => byId.get(id))
      .filter((d): d is StepDecision => d !== undefined);
    const outputsHashed: Record<string, string> = {};
    for (const id of order) {
      const value = outputs.get(id);
      if (value !== undefined) outputsHashed[id] = hashDataValue(value);
    }
    return {
      planId: plan.id,
      planHash: planFingerprint(plan),
      environment: this.envFingerprint,
      total: plan.steps.length,
      computed: decisions.filter((d) => d.status === 'computed').length,
      cached: decisions.filter((d) => d.status === 'cached').length,
      blocked: decisions.filter((d) => d.status === 'blocked').length,
      failed: decisions.filter((d) => d.status === 'failed').length,
      durationMs: Date.now() - startedAt,
      concurrency,
      outputs: outputsHashed,
      steps: ordered,
    };
  }

  /**
   * Run independent items with at most `limit` concurrent workers. A worker
   * error is captured by the caller, never thrown out of `Promise.all` here.
   */
  private async runLimited<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    if (items.length === 0) return;
    let next = 0;
    const width = Math.min(Math.max(1, limit), items.length);
    const workers: Promise<void>[] = [];
    for (let w = 0; w < width; w += 1) {
      workers.push(
        (async () => {
          for (;;) {
            const index = next;
            next += 1;
            if (index >= items.length) return;
            await worker(items[index]!);
          }
        })(),
      );
    }
    await Promise.all(workers);
  }
}
