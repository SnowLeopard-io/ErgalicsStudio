// ==========================================================================
// Experiment tracking — run comparison (pure TS, data layer)
// ==========================================================================

import type { RunRecord } from './record';

export interface ValueChange {
  key: string;
  a: unknown;
  b: unknown;
}

export interface MetricChange {
  key: string;
  a: number;
  b: number;
  /** b - a (positive = increased from a to b). */
  delta: number;
}

export interface RunDiff {
  paramChanges: ValueChange[];
  metricChanges: MetricChange[];
  /** True when the two runs used identical parameters. */
  sameParams: boolean;
  /** True when both runs consumed the same input fingerprint. */
  sameInputs: boolean;
}

function formatScalar(v: unknown): string {
  return typeof v === 'number' ? String(Number(v.toFixed(6))) : String(v);
}

/** Human-readable one-line summary of a parameter change, e.g. `iters: 100 → 500`. */
export function formatChange(c: ValueChange): string {
  return `${c.key}: ${formatScalar(c.a)} → ${formatScalar(c.b)}`;
}

/**
 * Compare two runs. Parameter and metric key sets are unioned and sorted so
 * the diff is stable regardless of insertion order.
 */
export function diffRuns(a: RunRecord, b: RunRecord): RunDiff {
  const paramChanges: ValueChange[] = [];
  const paramKeys = [...new Set([...Object.keys(a.params), ...Object.keys(b.params)])].sort();
  for (const key of paramKeys) {
    const va = a.params[key];
    const vb = b.params[key];
    if (JSON.stringify(va) !== JSON.stringify(vb)) {
      paramChanges.push({ key, a: va, b: vb });
    }
  }

  const metricChanges: MetricChange[] = [];
  const metricKeys = [...new Set([...Object.keys(a.metrics), ...Object.keys(b.metrics)])].sort();
  for (const key of metricKeys) {
    const va = a.metrics[key];
    const vb = b.metrics[key];
    if (typeof va === 'number' && typeof vb === 'number' && va !== vb) {
      metricChanges.push({ key, a: va, b: vb, delta: vb - va });
    }
  }

  return {
    paramChanges,
    metricChanges,
    sameParams: paramChanges.length === 0,
    sameInputs: a.inputsHash !== undefined && a.inputsHash === b.inputsHash,
  };
}
