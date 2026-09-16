// ==========================================================================
// Ergalics Studio — Sweep Studio types (FR2.1 / §3.5)
//
// A sweep plan fans one execution source (flow / block / code / notebook)
// out over 1–3 parameter axes using a full Cartesian grid, explicit value
// lists, or a Latin-hypercube sample, optionally repeating every cell with a
// deterministic per-cell seed. Results are a flat table of cells; each cell
// corresponds to one independent child run in the experiment history.
// ==========================================================================

import type { RunSource } from '@/core/experiment/record';

/** Sources a sweep can drive (any runnable surface in the workbench). */
export type SweepSource = Exclude<RunSource, 'sweep'>;

export interface GridSpec {
  from: number;
  to: number;
  /** Number of levels (inclusive endpoints); must be >= 2. */
  steps: number;
}

export interface ListSpec {
  // values carried on the axis itself
}

export interface LhsSpec {
  /** Number of strata / sample rows (same for every LHS axis in a plan). */
  n: number;
  seed: number;
  /** Sample range (defaults to the unit interval [0, 1]). */
  from?: number;
  to?: number;
}

export interface SweepAxis {
  /** Dotted parameter path applied to the run params, e.g. `lbm.viscosity`. */
  param: string;
  mode: 'grid' | 'list' | 'lhs';
  grid?: GridSpec;
  list?: Array<number | string>;
  lhs?: LhsSpec;
}

export interface SweepPlan {
  id: string;
  name: string;
  source: SweepSource;
  /** Pipeline / program / notebook id being fanned out. */
  sourceRef: string;
  /** 1..3 axes. */
  axes: SweepAxis[];
  /** Dotted metric path in the run output, e.g. `metrics.error`. */
  metric: string;
  /** Repeats per design point (>= 1); repeat r gets its own seed. */
  repeats: number;
  /** Constant params merged underneath the axis values. */
  baseParams?: Record<string, unknown>;
  createdAt: number;
}

export type SweepStatus = 'running' | 'done' | 'cancelled' | 'error';

export interface SweepCell {
  /** Stable identity: canonical params + repeat index (resume key). */
  key: string;
  params: Record<string, number | string>;
  rep: number;
  value: number;
  runId: string;
  /** Deterministic per-cell RNG seed. */
  seed: number;
  durationMs?: number;
}

export interface SweepResult {
  planId: string;
  /** Flat cell table in execution order. */
  cells: SweepCell[];
  total: number;
  startedAt: number;
  finishedAt?: number;
  status: SweepStatus;
  /** Last failure message (failed cells are retried on resume). */
  lastError?: string;
}

/** ProjectState persistence containers (see types/project.ts). */
export type SweepMap = Record<string, SweepResult>;
