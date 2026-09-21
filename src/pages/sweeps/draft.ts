// ==========================================================================
// Sweep Studio — plan draft model and field-level validation (pure domain)
//
// Extracted from the former 787-line SweepsPage so the mapping/validation
// rules are framework-agnostic and unit-testable (Single Responsibility).
// The editor works on string-typed drafts (every input is text); this module
// converts drafts ↔ persisted SweepPlans and collects *every* field issue in
// one pass, including boundary guards (NaN/Infinity, range limits, the
// billion-cell Cartesian cap and expression compile errors).
// ==========================================================================

import { expandPlan } from '@/core/sweep/design';
import type { SweepAxis, SweepPlan, SweepResult, SweepSource } from '@/core/sweep/types';
import { parseJsonText, parseNumericText } from '@/core/validation';

export type AxisMode = 'grid' | 'list' | 'lhs';

export interface AxisDraft {
  param: string;
  mode: AxisMode;
  from: string;
  to: string;
  steps: string;
  list: string;
  n: string;
  seed: string;
}

export interface PlanDraft {
  name: string;
  source: SweepSource;
  sourceRef: string;
  metric: string;
  expression: string;
  repeats: string;
  baseParams: string;
  axes: AxisDraft[];
}

/** One field-level problem; `key`/`params` feed the i18n layer. */
export interface DraftIssue {
  /** Field path, e.g. 'repeats' or 'axes.0.grid.from'. */
  field: string;
  key: string;
  params?: Record<string, string | number>;
  /** English fallback used outside the UI (tests, logs). */
  message: string;
}

export interface BuiltDraft {
  plan: SweepPlan | null;
  issues: DraftIssue[];
}

export const SOURCES: SweepSource[] = ['flow', 'block', 'code', 'notebook'];

export const EMPTY_AXIS: AxisDraft = {
  param: '',
  mode: 'grid',
  from: '0',
  to: '1',
  steps: '5',
  list: '0.1, 0.2, 0.3',
  n: '8',
  seed: '42',
};

/** Boundary caps — a 3-axis grid must not be able to schedule 1e9 runs. */
export const MAX_AXES = 3;
export const MAX_REPEATS = 10_000;
export const MAX_GRID_STEPS = 10_000;
export const MAX_LHS_N = 100_000;
export const MAX_SWEEP_CELLS = 100_000;

const PARAM_PATH = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const DEFAULT_EXPRESSION = 'p.a';
const DEFAULT_METRIC = 'value';

export function newPlan(): SweepPlan {
  return {
    id: crypto.randomUUID(),
    name: `sweep-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}`,
    source: 'flow',
    sourceRef: '',
    axes: [],
    metric: DEFAULT_METRIC,
    expression: DEFAULT_EXPRESSION,
    repeats: 1,
    baseParams: {},
    createdAt: Date.now(),
  };
}

export function emptyDraft(): PlanDraft {
  const plan = newPlan();
  return draftFromPlan(plan);
}

export function draftFromPlan(plan: SweepPlan): PlanDraft {
  return {
    name: plan.name,
    source: plan.source,
    sourceRef: plan.sourceRef,
    metric: plan.metric,
    expression: plan.expression ?? DEFAULT_EXPRESSION,
    repeats: String(plan.repeats),
    baseParams: JSON.stringify(plan.baseParams ?? {}, null, 2),
    axes: plan.axes.map((axis) => ({
      param: axis.param,
      mode: axis.mode,
      from: String(axis.grid?.from ?? 0),
      to: String(axis.grid?.to ?? 1),
      steps: String(axis.grid?.steps ?? 5),
      list: (axis.list ?? []).join(', '),
      n: String(axis.lhs?.n ?? 8),
      seed: String(axis.lhs?.seed ?? 42),
    })),
  };
}

// ---- issue helpers ----------------------------------------------------------

function issue(field: string, key: string, message: string, params?: Record<string, string | number>): DraftIssue {
  return { field, key, message, ...(params ? { params } : {}) };
}

function numericIssue(
  field: string,
  labelKey: string,
  result: Extract<ReturnType<typeof parseNumericText>, { ok: false }>,
): DraftIssue {
  switch (result.code) {
    case 'required':
      return issue(field, 'sweep.err_required', `${labelKey} is required`);
    case 'number.integer':
      return issue(field, 'sweep.err_integer', `${labelKey} must be an integer`);
    case 'number.min':
      return issue(field, 'sweep.err_min', `${labelKey} is below the minimum`, { min: 0 });
    case 'number.max':
      return issue(field, 'sweep.err_max', `${labelKey} is above the maximum`);
    default:
      return issue(field, 'sweep.err_number', `${labelKey} must be a finite number`);
  }
}

function parseAxis(
  draft: AxisDraft,
  prefix: string,
): { axis: SweepAxis | null; issues: DraftIssue[] } {
  const issues: DraftIssue[] = [];
  const param = draft.param.trim();
  if (param.length === 0) {
    issues.push(issue(`${prefix}.param`, 'sweep.err_required', 'Parameter path is required'));
  } else if (!PARAM_PATH.test(param)) {
    issues.push(
      issue(`${prefix}.param`, 'sweep.err_param', 'Parameter path must be a dot-path identifier'),
    );
  }

  if (draft.mode === 'grid') {
    const from = parseNumericText(draft.from);
    const to = parseNumericText(draft.to);
    const steps = parseNumericText(draft.steps, { integer: true, min: 2, max: MAX_GRID_STEPS });
    if (!from.ok) issues.push(numericIssue(`${prefix}.from`, 'from', from));
    if (!to.ok) issues.push(numericIssue(`${prefix}.to`, 'to', to));
    if (!steps.ok) issues.push(issue(`${prefix}.steps`, 'sweep.err_grid_steps', 'Steps must be an integer ≥ 2'));
    if (issues.length === 0 && from.ok && to.ok && steps.ok) {
      return { axis: { param, mode: 'grid', grid: { from: from.value, to: to.value, steps: steps.value } }, issues };
    }
    return { axis: null, issues };
  }

  if (draft.mode === 'list') {
    const values = draft.list
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .map((token) => (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(token) ? Number(token) : token));
    if (values.length === 0) {
      issues.push(issue(`${prefix}.list`, 'sweep.err_list_empty', 'List mode needs at least one value'));
      return { axis: null, issues };
    }
    return { axis: { param, mode: 'list', list: values }, issues };
  }

  // lhs
  const n = parseNumericText(draft.n, { integer: true, min: 1, max: MAX_LHS_N });
  const seed = parseNumericText(draft.seed, { integer: true });
  const from = parseNumericText(draft.from);
  const to = parseNumericText(draft.to);
  if (!n.ok) issues.push(issue(`${prefix}.n`, 'sweep.err_lhs_n', `LHS n must be an integer in [1, ${MAX_LHS_N}]`));
  if (!seed.ok) issues.push(numericIssue(`${prefix}.seed`, 'seed', seed));
  if (!from.ok) issues.push(numericIssue(`${prefix}.from`, 'from', from));
  if (!to.ok) issues.push(numericIssue(`${prefix}.to`, 'to', to));
  if (issues.length === 0 && n.ok && seed.ok && from.ok && to.ok) {
    return {
      axis: { param, mode: 'lhs', lhs: { n: n.value, seed: seed.value, from: from.value, to: to.value } },
      issues,
    };
  }
  return { axis: null, issues };
}

/** Compile the metric expression for syntax (never executes it here). */
function compileExpression(expression: string): DraftIssue | null {
  try {
     
    new Function('p', `"use strict"; return (${expression});`);
    return null;
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    return issue('expression', 'sweep.err_expression', `Invalid expression: ${reason}`, { reason });
  }
}

/**
 * Convert an editor draft into a persistable plan, collecting every field
 * issue. On any error `plan` is null. Cross-axis rules and the global cell
 * cap are checked before a plan is returned.
 */
export function buildPlanDraft(
  draft: PlanDraft,
  options: { id?: string; createdAt?: number } = {},
): BuiltDraft {
  const issues: DraftIssue[] = [];

  const repeatsParsed = parseNumericText(draft.repeats, { integer: true, min: 1, max: MAX_REPEATS });
  if (!repeatsParsed.ok) {
    issues.push(
      issue('repeats', 'sweep.err_repeats', `Repeats must be an integer in [1, ${MAX_REPEATS}]`),
    );
  }

  const metric = draft.metric.trim();
  if (metric.length === 0) {
    issues.push(issue('metric', 'sweep.err_metric', 'Metric path is required'));
  }

  const expression = draft.expression.trim() || DEFAULT_EXPRESSION;
  const expressionIssue = compileExpression(expression);
  if (expressionIssue) issues.push(expressionIssue);

  let baseParams: Record<string, unknown> = {};
  const baseText = draft.baseParams.trim();
  if (baseText.length > 0) {
    const parsed = parseJsonText<unknown>(baseText);
    if (!parsed.ok) {
      issues.push(
        issue('baseParams', 'sweep.err_json', `Invalid JSON: ${parsed.error.message}`, {
          reason: parsed.error.message,
        }),
      );
    } else if (typeof parsed.value !== 'object' || parsed.value === null || Array.isArray(parsed.value)) {
      issues.push(
        issue('baseParams', 'sweep.err_json_object', 'Base parameters must be a JSON object'),
      );
    } else {
      baseParams = parsed.value as Record<string, unknown>;
    }
  }

  if (draft.axes.length === 0) {
    issues.push(issue('axes', 'sweep.err_axes_empty', 'Add at least one parameter axis'));
  } else if (draft.axes.length > MAX_AXES) {
    issues.push(issue('axes', 'sweep.err_axes_max', `At most ${MAX_AXES} axes are supported`));
  }

  const axes: SweepAxis[] = [];
  draft.axes.forEach((axisDraft, index) => {
    const built = parseAxis(axisDraft, `axes.${index}`);
    issues.push(...built.issues);
    if (built.axis) axes.push(built.axis);
  });

  // Cross-axis rules (the design expander throws for these; validate up front
  // so the editor can explain them instead of surfacing a raw exception).
  if (axes.length > 0 && axes.length <= MAX_AXES) {
    const seenParams = new Set<string>();
    for (const axis of axes) {
      if (seenParams.has(axis.param)) {
        issues.push(
          issue('axes', 'sweep.err_param_dup', `Duplicate parameter axis "${axis.param}"`, {
            param: axis.param,
          }),
        );
      }
      seenParams.add(axis.param);
    }
    const modes = new Set(axes.map((a) => a.mode));
    if (modes.has('lhs') && modes.size > 1) {
      issues.push(issue('axes', 'sweep.err_lhs_mix', 'LHS axes cannot be mixed with grid/list axes'));
    }
    const lhsNs = axes.filter((a) => a.mode === 'lhs').map((a) => a.lhs?.n);
    if (modes.has('lhs') && new Set(lhsNs).size > 1) {
      issues.push(issue('axes', 'sweep.err_lhs_n_equal', 'All LHS axes must use the same n'));
    }
  }

  if (issues.length > 0 || !repeatsParsed.ok) return { plan: null, issues };

  const plan: SweepPlan = {
    id: options.id ?? crypto.randomUUID(),
    name: draft.name.trim() || 'sweep',
    source: draft.source,
    sourceRef: draft.sourceRef.trim(),
    axes,
    metric: metric || DEFAULT_METRIC,
    expression,
    repeats: repeatsParsed.ok ? repeatsParsed.value : 1,
    baseParams,
    createdAt: options.createdAt ?? Date.now(),
  };

  // Cell-count cap (guards the UI and runner against runaway designs).
  try {
    const count = expandPlan(plan).length;
    if (count > MAX_SWEEP_CELLS) {
      issues.push(
        issue('axes', 'sweep.err_cells', `Sweep expands to ${count} cells (limit ${MAX_SWEEP_CELLS})`, {
          count,
          max: MAX_SWEEP_CELLS,
        }),
      );
      return { plan: null, issues };
    }
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : String(caught);
    issues.push(issue('axes', 'sweep.err_design', reason, { reason }));
    return { plan: null, issues };
  }

  return { plan, issues: [] };
}

/** True when a stored result still matches the plan's current cell design. */
export function resultMatchesPlan(plan: SweepPlan | null, result: SweepResult | null): boolean {
  if (!plan || !result) return false;
  try {
    const keys = new Set(expandPlan(plan).map((cell) => cell.key));
    return result.total === keys.size && result.cells.every((cell) => keys.has(cell.key));
  } catch {
    return false;
  }
}
