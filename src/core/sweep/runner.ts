// ==========================================================================
// Ergalics Studio — sweep runner (FR2.2 / FR2.3)
//
// Executes an expanded SweepPlan sequentially (single flight — GPU sources
// must never overlap, CPU sources yield to the event loop between cells) via
// an injected executor, so the core stays free of Flow/Pyodide/React deps.
//
// Resume: pass the previously persisted SweepResult as `existing`; every
// completed cell key is skipped, so a cancelled or failed sweep restarts
// exactly where it stopped (AC2). Per-cell failures are recorded in
// lastError and NOT appended, which makes them retry automatically.
// ==========================================================================

import { expandPlan, extractMetric, setPath, type AxisValue } from './design';
import type { SweepCell, SweepPlan, SweepResult } from './types';

export interface SweepExecution {
  /** Stable cell key (params + repeat), used for resume matching. */
  key: string;
  /** Nested run params (dotted axis paths applied over baseParams). */
  params: Record<string, unknown>;
  /** Flat axis values keyed by the axis param path. */
  flatParams: Record<string, AxisValue>;
  rep: number;
  /** Deterministic per-cell seed. */
  seed: number;
}

export interface SweepExecutorResult {
  /** Child run id in the experiment history. */
  runId: string;
  /** Scalar metrics of the child run. */
  metrics: Record<string, number>;
  durationMs?: number;
}

/** Source-specific executor (Flow / block interpreter / Pyodide / …). */
export type SweepExecutor = (
  cell: SweepExecution,
  signal?: AbortSignal,
) => Promise<SweepExecutorResult>;

export interface RunSweepOptions {
  executor: SweepExecutor;
  /** Previously persisted result to resume from (same planId). */
  existing?: SweepResult | null;
  onProgress?: (done: number, total: number, result: SweepResult) => void;
  signal?: AbortSignal;
  /** Yield to the event loop every N cells (default 1). */
  yieldEvery?: number;
  /** Injected clock (tests). */
  now?: () => number;
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/**
 * Run (or resume) a sweep. Abortion returns a partial `cancelled` result
 * instead of throwing, so callers can persist progress and resume later.
 */
export async function runSweep(plan: SweepPlan, options: RunSweepOptions): Promise<SweepResult> {
  if (options.existing && options.existing.planId !== plan.id) {
    throw new Error('cannot resume: existing result belongs to a different sweep plan');
  }

  const design = expandPlan(plan);
  const now = options.now ?? (() => Date.now());
  const yieldEvery = Math.max(1, options.yieldEvery ?? 1);

  const byKey = new Map<SweepCell['key'], SweepCell>();
  for (const cell of options.existing?.cells ?? []) byKey.set(cell.key, cell);

  const result: SweepResult = options.existing
    ? {
        planId: plan.id,
        cells: [],
        total: design.length,
        startedAt: options.existing.startedAt,
        status: 'running',
      }
    : {
        planId: plan.id,
        cells: [],
        total: design.length,
        startedAt: now(),
        status: 'running',
      };

  let aborted = options.signal?.aborted ?? false;
  let sawError = false;

  for (let i = 0; i < design.length; i += 1) {
    const spec = design[i];
    if (!spec) continue;
    const doneCell = byKey.get(spec.key);
    if (doneCell) {
      result.cells.push(doneCell);
      continue;
    }

    if (aborted || options.signal?.aborted) {
      aborted = true;
      break;
    }

    // Build nested params: baseParams (cloned) then axis paths.
    const params: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(plan.baseParams ?? {})) params[k] = structuredClone(v);
    for (const [path, value] of Object.entries(spec.params)) setPath(params, path, value);

    const execution: SweepExecution = {
      key: spec.key,
      params,
      flatParams: { ...spec.params },
      rep: spec.rep,
      seed: spec.seed,
    };

    const started = now();
    try {
      const outcome = await options.executor(execution, options.signal);
      const value = extractMetric(outcome as unknown as Record<string, unknown>, plan.metric);
      if (!Number.isFinite(value)) {
        throw new Error(`metric "${plan.metric}" missing or not finite in run ${outcome.runId}`);
      }
      const cell: SweepCell = {
        key: spec.key,
        params: { ...spec.params },
        rep: spec.rep,
        value,
        runId: outcome.runId,
        seed: spec.seed,
        durationMs: outcome.durationMs ?? now() - started,
      };
      byKey.set(cell.key, cell);
      result.cells.push(cell);
    } catch (err) {
      if (isAbortError(err) || options.signal?.aborted) {
        aborted = true;
        break;
      }
      sawError = true;
      result.lastError = (err as Error).message;
    }

    options.onProgress?.(result.cells.length, design.length, result);
    if ((i + 1) % yieldEvery === 0) await tick();
  }

  // Restore canonical design order (resumed runs interleave old/new cells).
  const order = new Map(design.map((d, i) => [d.key, i]));
  result.cells.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));

  result.finishedAt = aborted || sawError || result.cells.length === design.length ? now() : undefined;
  result.status = aborted
    ? 'cancelled'
    : result.cells.length === design.length
      ? 'done'
      : 'error';
  return result;
}

// --------------------------------------------------------------------------
// Result aggregation helpers (feed FR2.4 visualisations)
// --------------------------------------------------------------------------

/** Arithmetic mean of a cell subset. */
export function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation of a cell subset. */
export function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1));
}

export interface SweepPointSummary {
  params: Record<string, AxisValue>;
  mean: number;
  sd: number;
  n: number;
}

/**
 * Collapse repeats of every design point into mean ± SD rows (1-axis error
 * bars / 2-axis heat map inputs).
 */
export function summarizePoints(result: SweepResult): SweepPointSummary[] {
  const groups = new Map<string, { params: Record<string, AxisValue>; values: number[] }>();
  for (const cell of result.cells) {
    const key = Object.keys(cell.params)
      .sort()
      .map((k) => `${k}=${cell.params[k]}`)
      .join('|');
    let group = groups.get(key);
    if (!group) {
      group = { params: { ...cell.params }, values: [] };
      groups.set(key, group);
    }
    group.values.push(cell.value);
  }
  return [...groups.values()].map((g) => ({
    params: g.params,
    mean: mean(g.values),
    sd: sd(g.values),
    n: g.values.length,
  }));
}
