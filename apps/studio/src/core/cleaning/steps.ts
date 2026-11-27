// ==========================================================================
// Ergalics Studio — FR-14 data-cleaning wizard: step model + engine (pure TS)
//
// A CleaningStep is a serialisable discriminated union over the five wizard
// operations: type conversion, missing-value policy (drop / fill mean /
// median / zero / forward-fill), outlier flagging (IQR / z-score), dedupe
// and column rename. `applySteps` runs them in order over a CleaningTable
// and reports the affected-row count of every step; navigation (forward /
// back / jump) is just applying a prefix of the list, and "undo this step"
// removes it from the list. Steps never mutate their input table.
//
// Errors are thrown as `CleaningStepError` with a stable `code` so the UI
// can localise the message through the `clean.error.*` i18n keys.
// ==========================================================================

import {
  cloneTable,
  columnIndex,
  isMissing,
  mean,
  median,
  quantile,
  toBoolean,
  toNumber,
  type Cell,
  type CleaningTable,
} from './table';

// ---- step model -------------------------------------------------------------

export type ConvertTarget = 'number' | 'string' | 'boolean';
export type MissingStrategy = 'drop' | 'mean' | 'median' | 'zero' | 'ffill';
export type OutlierMethod = 'iqr' | 'zscore';

export interface StepBase {
  /** Stable id (uuid at creation) — keys previews, reviews and undo. */
  id: string;
}

export interface ConvertStep extends StepBase {
  kind: 'convert';
  column: string;
  target: ConvertTarget;
}

export interface MissingStep extends StepBase {
  kind: 'missing';
  column: string;
  strategy: MissingStrategy;
}

export interface OutlierStep extends StepBase {
  kind: 'outlier';
  column: string;
  method: OutlierMethod;
  /** IQR fence multiplier (default 1.5) / z-score cutoff (default 3). */
  threshold: number;
}

export interface DedupeStep extends StepBase {
  kind: 'dedupe';
  /** Key columns; empty = whole-row duplicates. */
  columns: string[];
}

export interface RenameStep extends StepBase {
  kind: 'rename';
  from: string;
  to: string;
}

export type CleaningStep =
  | ConvertStep
  | MissingStep
  | OutlierStep
  | DedupeStep
  | RenameStep;

export type CleaningStepKind = CleaningStep['kind'];

/** Default outlier thresholds per method. */
export const DEFAULT_IQR_MULTIPLIER = 1.5;
export const DEFAULT_ZSCORE_CUTOFF = 3;

/** Stable error codes → `clean.error.<code>` i18n keys. */
export type CleaningErrorCode =
  | 'unknown-column'
  | 'duplicate-column'
  | 'invalid-threshold'
  | 'empty-table'
  | 'bad-step';

export class CleaningStepError extends Error {
  readonly code: CleaningErrorCode;
  readonly column?: string;
  readonly stepId?: string;

  constructor(code: CleaningErrorCode, message: string, extra?: { column?: string; stepId?: string }) {
    super(message);
    this.name = 'CleaningStepError';
    this.code = code;
    this.column = extra?.column;
    this.stepId = extra?.stepId;
  }
}

// ---- serialisation -----------------------------------------------------------

const CONVERT_TARGETS: readonly ConvertTarget[] = ['number', 'string', 'boolean'];
const MISSING_STRATEGIES: readonly MissingStrategy[] = ['drop', 'mean', 'median', 'zero', 'ffill'];
const OUTLIER_METHODS: readonly OutlierMethod[] = ['iqr', 'zscore'];

/** Steps are plain JSON — write them into a project / lock them with a run. */
export function stepsToJson(steps: CleaningStep[]): string {
  return JSON.stringify(steps, null, 2);
}

/** Parse + structurally validate a persisted step list. Throws on bad shape. */
export function stepsFromJson(raw: string): CleaningStep[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CleaningStepError('bad-step', `steps JSON is not valid: ${(err as Error).message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new CleaningStepError('bad-step', 'steps must be an array');
  }
  return parsed.map((item, i) => reviveStep(item, i));
}

function requireString(value: unknown, field: string, index: number): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new CleaningStepError('bad-step', `step ${index}: field "${field}" must be a non-empty string`);
  }
  return value;
}

function reviveStep(value: unknown, index: number): CleaningStep {
  if (!value || typeof value !== 'object') {
    throw new CleaningStepError('bad-step', `step ${index}: not an object`);
  }
  const s = value as Record<string, unknown>;
  const id = requireString(s.id, 'id', index);
  switch (s.kind) {
    case 'convert': {
      const target = CONVERT_TARGETS.find((t) => t === s.target);
      if (!target) throw new CleaningStepError('bad-step', `step ${index}: bad convert target`);
      return { id, kind: 'convert', column: requireString(s.column, 'column', index), target };
    }
    case 'missing': {
      const strategy = MISSING_STRATEGIES.find((t) => t === s.strategy);
      if (!strategy) throw new CleaningStepError('bad-step', `step ${index}: bad missing strategy`);
      return { id, kind: 'missing', column: requireString(s.column, 'column', index), strategy };
    }
    case 'outlier': {
      const method = OUTLIER_METHODS.find((t) => t === s.method);
      if (!method) throw new CleaningStepError('bad-step', `step ${index}: bad outlier method`);
      const threshold = Number(s.threshold);
      return {
        id,
        kind: 'outlier',
        column: requireString(s.column, 'column', index),
        method,
        threshold:
          Number.isFinite(threshold) && threshold > 0
            ? threshold
            : method === 'iqr'
              ? DEFAULT_IQR_MULTIPLIER
              : DEFAULT_ZSCORE_CUTOFF,
      };
    }
    case 'dedupe': {
      if (!Array.isArray(s.columns) || s.columns.some((c) => typeof c !== 'string')) {
        throw new CleaningStepError('bad-step', `step ${index}: dedupe columns must be strings`);
      }
      return { id, kind: 'dedupe', columns: s.columns as string[] };
    }
    case 'rename': {
      return {
        id,
        kind: 'rename',
        from: requireString(s.from, 'from', index),
        to: requireString(s.to, 'to', index),
      };
    }
    default:
      throw new CleaningStepError('bad-step', `step ${index}: unknown kind "${String(s.kind)}"`);
  }
}

// ---- column helpers ------------------------------------------------------------

function requireIndex(table: CleaningTable, name: string, stepId: string): number {
  const idx = columnIndex(table, name);
  if (idx < 0) {
    throw new CleaningStepError('unknown-column', `column "${name}" does not exist`, {
      column: name,
      stepId,
    });
  }
  return idx;
}

/** Copy a table with one column replaced (same row order). */
function withColumn(table: CleaningTable, index: number, data: Cell[]): CleaningTable {
  const next = cloneTable(table);
  for (let r = 0; r < next.rows.length; r += 1) next.rows[r]![index] = data[r] ?? null;
  return next;
}

/** Copy a table keeping only the given row indices. */
function withRows(table: CleaningTable, keep: number[]): CleaningTable {
  return {
    columns: [...table.columns],
    rows: keep.map((i) => [...table.rows[i]!]),
  };
}

// ---- per-step application --------------------------------------------------------

export interface StepOutcome {
  step: CleaningStep;
  /** Rows removed (drop/dedupe), cells changed (convert/fill) or rows flagged. */
  affected: number;
  rowsBefore: number;
  rowsAfter: number;
  table: CleaningTable;
}

function numericColumn(table: CleaningTable, index: number): (number | null)[] {
  return table.rows.map((row) => toNumber(row[index] ?? null));
}

function applyConvert(table: CleaningTable, step: ConvertStep): StepOutcome {
  const index = requireIndex(table, step.column, step.id);
  const before = table.rows.map((row) => row[index] ?? null);
  const after = before.map((cell): Cell => {
    if (isMissing(cell)) return null;
    if (step.target === 'number') return toNumber(cell);
    if (step.target === 'boolean') return toBoolean(cell);
    return String(cell).trim();
  });
  let affected = 0;
  for (let r = 0; r < after.length; r += 1) {
    if (after[r] !== before[r]) affected += 1;
  }
  return {
    step,
    affected,
    rowsBefore: table.rows.length,
    rowsAfter: table.rows.length,
    table: withColumn(table, index, after),
  };
}

function applyMissing(table: CleaningTable, step: MissingStep): StepOutcome {
  const index = requireIndex(table, step.column, step.id);
  const cells = table.rows.map((row) => row[index] ?? null);
  const missingCount = cells.filter((c) => isMissing(c)).length;

  if (step.strategy === 'drop') {
    const keep: number[] = [];
    cells.forEach((c, i) => {
      if (!isMissing(c)) keep.push(i);
    });
    return {
      step,
      affected: missingCount,
      rowsBefore: table.rows.length,
      rowsAfter: keep.length,
      table: withRows(table, keep),
    };
  }

  if (step.strategy === 'ffill') {
    const after = [...cells];
    let prev: Cell = null;
    let filled = 0;
    for (let i = 0; i < after.length; i += 1) {
      if (isMissing(after[i] ?? null)) {
        if (prev !== null) {
          after[i] = prev;
          filled += 1;
        }
      } else {
        prev = after[i] ?? null;
      }
    }
    return {
      step,
      affected: filled,
      rowsBefore: table.rows.length,
      rowsAfter: table.rows.length,
      table: withColumn(table, index, after),
    };
  }

  let fill: Cell;
  if (step.strategy === 'zero') {
    fill = 0;
  } else {
    const nums = numericColumn(table, index).filter((v): v is number => v !== null);
    fill = nums.length > 0 ? (step.strategy === 'mean' ? mean(nums) : median(nums)) : 0;
  }
  const after = cells.map((c) => (isMissing(c) ? fill : c));
  return {
    step,
    affected: missingCount,
    rowsBefore: table.rows.length,
    rowsAfter: table.rows.length,
    table: withColumn(table, index, after),
  };
}

/** Name of the boolean flag column an outlier step appends. */
export function outlierFlagColumn(column: string): string {
  return `${column}_outlier`;
}

function applyOutlier(table: CleaningTable, step: OutlierStep): StepOutcome {
  const index = requireIndex(table, step.column, step.id);
  if (!(step.threshold > 0) || !Number.isFinite(step.threshold)) {
    throw new CleaningStepError('invalid-threshold', 'outlier threshold must be a positive number', {
      stepId: step.id,
    });
  }
  const nums = numericColumn(table, index);
  const finite = nums.filter((v): v is number => v !== null);
  const flags: boolean[] = nums.map(() => false);
  if (finite.length > 0) {
    let lo = Number.NEGATIVE_INFINITY;
    let hi = Number.POSITIVE_INFINITY;
    if (step.method === 'iqr') {
      const q1 = quantile(finite, 0.25);
      const q3 = quantile(finite, 0.75);
      const fence = step.threshold * (q3 - q1);
      lo = q1 - fence;
      hi = q3 + fence;
    } else {
      const m = mean(finite);
      const variance = finite.reduce((s, v) => s + (v - m) * (v - m), 0) / finite.length;
      const sd = Math.sqrt(variance);
      if (sd > 0) {
        lo = m - step.threshold * sd;
        hi = m + step.threshold * sd;
      }
    }
    for (let i = 0; i < nums.length; i += 1) {
      const v = nums[i] ?? null;
      flags[i] = v !== null && (v < lo || v > hi);
    }
  }
  const flagged = flags.filter((f) => f).length;
  const next: CleaningTable = {
    columns: [...table.columns, outlierFlagColumn(step.column)],
    rows: table.rows.map((row, i) => [...row, flags[i] ?? false]),
  };
  return {
    step,
    affected: flagged,
    rowsBefore: table.rows.length,
    rowsAfter: next.rows.length,
    table: next,
  };
}

function applyDedupe(table: CleaningTable, step: DedupeStep): StepOutcome {
  const keyIndexes =
    step.columns.length === 0
      ? table.columns.map((_, i) => i)
      : step.columns.map((c) => requireIndex(table, c, step.id));
  const seen = new Set<string>();
  const keep: number[] = [];
  for (let i = 0; i < table.rows.length; i += 1) {
    const row = table.rows[i]!;
    const key = JSON.stringify(keyIndexes.map((k) => row[k] ?? null));
    if (seen.has(key)) continue;
    seen.add(key);
    keep.push(i);
  }
  return {
    step,
    affected: table.rows.length - keep.length,
    rowsBefore: table.rows.length,
    rowsAfter: keep.length,
    table: withRows(table, keep),
  };
}

function applyRename(table: CleaningTable, step: RenameStep): StepOutcome {
  const index = requireIndex(table, step.from, step.id);
  if (step.to !== step.from && table.columns.includes(step.to)) {
    throw new CleaningStepError('duplicate-column', `column "${step.to}" already exists`, {
      column: step.to,
      stepId: step.id,
    });
  }
  const columns = [...table.columns];
  columns[index] = step.to;
  return {
    step,
    affected: 0,
    rowsBefore: table.rows.length,
    rowsAfter: table.rows.length,
    table: { columns, rows: table.rows.map((r) => [...r]) },
  };
}

function applyStep(table: CleaningTable, step: CleaningStep): StepOutcome {
  switch (step.kind) {
    case 'convert':
      return applyConvert(table, step);
    case 'missing':
      return applyMissing(table, step);
    case 'outlier':
      return applyOutlier(table, step);
    case 'dedupe':
      return applyDedupe(table, step);
    case 'rename':
      return applyRename(table, step);
  }
}

// ---- public engine -------------------------------------------------------------

export interface ApplyResult {
  table: CleaningTable;
  /** One outcome per applied step (same order as the input list). */
  outcomes: StepOutcome[];
}

/** Apply every step in order; a step error aborts (partial results discarded). */
export function applySteps(table: CleaningTable, steps: CleaningStep[]): ApplyResult {
  const outcomes: StepOutcome[] = [];
  let current = table;
  for (const step of steps) {
    const outcome = applyStep(current, step);
    outcomes.push(outcome);
    current = outcome.table;
  }
  return { table: current, outcomes };
}

export interface StepPreview {
  /** First `sample` rows of the input table. */
  before: Cell[][];
  /** First `sample` rows of the step output. */
  after: Cell[][];
  /** Columns of the output table (rename/outlier can change the header). */
  afterColumns: string[];
  affected: number;
  rowsBefore: number;
  rowsAfter: number;
}

/**
 * Preview one step against a table without committing: returns the head of
 * the input and the head of the output plus the affected-row count. The
 * wizard calls it with the table produced by the steps *before* this one, so
 * every preview reflects the real running state.
 */
export function previewStep(table: CleaningTable, step: CleaningStep, sample = 5): StepPreview {
  const outcome = applyStep(table, step);
  return {
    before: table.rows.slice(0, sample).map((r) => [...r]),
    after: outcome.table.rows.slice(0, sample).map((r) => [...r]),
    afterColumns: outcome.table.columns,
    affected: outcome.affected,
    rowsBefore: outcome.rowsBefore,
    rowsAfter: outcome.rowsAfter,
  };
}

// ---- dependency validation -------------------------------------------------------

export interface StepWarning {
  /** Index of the step in the list. */
  stepIndex: number;
  stepId: string;
  /** `unknown-column` = the step references a column that does not exist at
   *  this point in the sequence (usually caused by a reordering). */
  code: 'unknown-column' | 'duplicate-column';
  column: string;
}

/**
 * Dry-run the step sequence tracking column names, and report steps that
 * would fail where they now sit (e.g. a convert left dangling after its
 * column was renamed away). The wizard surfaces these as reorder warnings.
 */
export function validateSteps(steps: CleaningStep[], sourceColumns: string[]): StepWarning[] {
  const warnings: StepWarning[] = [];
  let columns = [...sourceColumns];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    const check = (name: string): void => {
      if (!columns.includes(name)) {
        warnings.push({ stepIndex: i, stepId: step.id, code: 'unknown-column', column: name });
      }
    };
    switch (step.kind) {
      case 'convert':
      case 'missing':
        check(step.column);
        break;
      case 'outlier':
        check(step.column);
        columns = [...columns, outlierFlagColumn(step.column)];
        break;
      case 'dedupe':
        step.columns.forEach(check);
        break;
      case 'rename':
        check(step.from);
        if (columns.includes(step.to) && step.to !== step.from) {
          warnings.push({ stepIndex: i, stepId: step.id, code: 'duplicate-column', column: step.to });
        }
        columns = columns.map((c) => (c === step.from ? step.to : c));
        break;
    }
  }
  return warnings;
}
