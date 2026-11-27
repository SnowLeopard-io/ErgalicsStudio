// ==========================================================================
// Ergalics Studio — statistics result tables for the Studio API
//
// The Flow catalog builds result `DataTable`s inside its block executors.
// Block and Code mode call `studio.*` instead, so this module mirrors those
// table shapes for the advanced routines: post-hoc comparisons, survival
// analysis, psychometrics, nonlinear fits and long/wide reshaping.
//
// Everything is pure (DataTable in / DataTable out) and shares the tested
// `@/core` kernels with the Flow blocks and the lab pages.
// ==========================================================================

import { asFloat64, isNumericType } from '@/blocks/ops';
import {
  createDataTable,
  type ColumnSpec,
  type DataTable,
} from '@ergalics/plugin-sdk/types';
import { dunnettTest, tukeyHSD, type PosthocComparison } from '@ergalics/sci-kernels/stats/posthoc';
import { dunnPostHoc, kruskalWallis } from '@ergalics/sci-kernels/stats/nonparametric';
import { kaplanMeier, logRankTest } from '@ergalics/sci-kernels/stats/survival';
import { bartlettTest, cronbachAlpha, kmo } from '@ergalics/sci-kernels/stats/psychometrics';
import {
  fitNonlinearModel,
  NONLINEAR_MODELS,
  type NonlinearModelKind,
} from '@/core/model/nonlinear';
import { pivotLonger, pivotWider } from '@/core/dataeng/reshape';

// ---- table builders --------------------------------------------------------

/** Two-column (metric / value) result table. */
function resultTable(id: string, rows: Array<[string, number]>): DataTable {
  return createDataTable(
    id,
    [
      { name: 'metric', type: 'string', data: rows.map((r) => r[0]) },
      { name: 'value', type: 'f64', data: new Float64Array(rows.map((r) => r[1])) },
    ],
    { provenance: id },
  );
}

/** Metric / value / note table, used when a label is part of the answer. */
function noteTable(id: string, rows: Array<[string, number, string]>): DataTable {
  return createDataTable(
    id,
    [
      { name: 'metric', type: 'string', data: rows.map((r) => r[0]) },
      { name: 'value', type: 'f64', data: new Float64Array(rows.map((r) => r[1])) },
      { name: 'note', type: 'string', data: rows.map((r) => r[2]) },
    ],
    { provenance: id },
  );
}

/** Pairwise comparison table shared by Tukey and Dunnett. */
function comparisonTable(id: string, rows: PosthocComparison[]): DataTable {
  return createDataTable(
    id,
    [
      { name: 'group_a', type: 'string', data: rows.map((r) => r.groupA) },
      { name: 'group_b', type: 'string', data: rows.map((r) => r.groupB) },
      { name: 'mean_diff', type: 'f64', data: new Float64Array(rows.map((r) => r.meanDiff)) },
      { name: 'se', type: 'f64', data: new Float64Array(rows.map((r) => r.se)) },
      { name: 'statistic', type: 'f64', data: new Float64Array(rows.map((r) => r.statistic)) },
      { name: 'p_value', type: 'f64', data: new Float64Array(rows.map((r) => r.pValue)) },
      { name: 'ci_low', type: 'f64', data: new Float64Array(rows.map((r) => r.ciLow)) },
      { name: 'ci_high', type: 'f64', data: new Float64Array(rows.map((r) => r.ciHigh)) },
    ],
    { provenance: id },
  );
}

// ---- column helpers --------------------------------------------------------

/** Coerce a column of any type to display labels. */
function labelsOf(df: DataTable, name: string): string[] {
  if (!name) throw new Error('pick a column first');
  const col = df.getColumn(name);
  if (!col) throw new Error(`column "${name}" does not exist`);
  const out: string[] = [];
  for (let i = 0; i < df.length; i += 1) {
    const v = col[i];
    out.push(v === null || v === undefined ? '' : String(v));
  }
  return out;
}

/** Normalise a `string[]` / comma-separated field into trimmed names. */
function splitList(values: string | string[] | undefined): string[] {
  if (values === undefined) return [];
  const raw = Array.isArray(values) ? values : values.split(',');
  return raw.map((s) => String(s).trim()).filter((s) => s.length > 0);
}

function alphaOf(value: number | undefined, fallback = 0.05): number {
  const alpha = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) {
    throw new Error('alpha must be between 0 and 1');
  }
  return alpha;
}

/** Split a numeric column into groups keyed by an arbitrary label column. */
function groupSamples(
  df: DataTable,
  valueColumn: string,
  groupColumn: string,
): { names: string[]; groups: number[][] } {
  const values = asFloat64(df, valueColumn);
  const labels = labelsOf(df, groupColumn);
  const byGroup = new Map<string, number[]>();
  for (let i = 0; i < df.length; i += 1) {
    const key = labels[i]!;
    let bucket = byGroup.get(key);
    if (!bucket) {
      bucket = [];
      byGroup.set(key, bucket);
    }
    bucket.push(values[i]!);
  }
  return { names: [...byGroup.keys()], groups: [...byGroup.values()] };
}

/**
 * Coerce an event / status column to booleans using the same vocabulary as
 * the statistics Flow blocks (1/0, true/false, yes/no, event/censored).
 */
function eventFlags(df: DataTable, name: string): boolean[] {
  if (!name) throw new Error('pick the event/status column');
  const col = df.getColumn(name);
  if (!col) throw new Error(`column "${name}" does not exist`);
  const out: boolean[] = [];
  for (let i = 0; i < df.length; i += 1) {
    const v = col[i];
    if (typeof v === 'boolean') out.push(v);
    else if (typeof v === 'number') out.push(v !== 0);
    else {
      const s = String(v).trim().toLowerCase();
      if (['1', 'true', 'yes', 'y', 'event', 'dead', 'died'].includes(s)) out.push(true);
      else if (['0', 'false', 'no', 'n', 'censored', 'alive'].includes(s)) out.push(false);
      else throw new Error(`event column "${name}" has an unrecognised value "${String(v)}"`);
    }
  }
  return out;
}

/** n × k item matrix for the psychometric routines (default: all numeric). */
function itemMatrix(
  df: DataTable,
  items: string | string[] | undefined,
): { rows: number[][]; names: string[] } {
  const requested = splitList(items);
  const names =
    requested.length > 0
      ? requested
      : df.columns.filter((c) => isNumericType(c.type)).map((c) => c.name);
  if (names.length < 2) throw new Error('choose at least two item columns');
  if (new Set(names).size !== names.length) throw new Error('item columns must be unique');
  const cols = names.map((name) => asFloat64(df, name));
  const rows: number[][] = [];
  for (let i = 0; i < df.length; i += 1) rows.push(cols.map((c) => c[i]!));
  return { rows, names };
}

// ---- multi-group comparisons ----------------------------------------------

/** Tukey HSD (Tukey–Kramer for unequal n) over a value / group column pair. */
export function tukeyTable(
  df: DataTable,
  valueColumn: string,
  groupColumn: string,
  alpha?: number,
): DataTable {
  const { names, groups } = groupSamples(df, valueColumn, groupColumn);
  if (groups.length < 2) throw new Error('Tukey HSD needs at least two groups');
  return comparisonTable('studio.tukeyHSD', tukeyHSD(groups, names, alphaOf(alpha)).comparisons);
}

/** Dunnett: every treatment group against one named control group. */
export function dunnettTable(
  df: DataTable,
  valueColumn: string,
  groupColumn: string,
  control: string,
  alpha?: number,
): DataTable {
  const controlName = String(control ?? '').trim();
  if (!controlName) throw new Error('pick the control group label');
  const { names, groups } = groupSamples(df, valueColumn, groupColumn);
  if (groups.length < 2) throw new Error('Dunnett needs at least two groups');
  const at = names.indexOf(controlName);
  if (at < 0) throw new Error(`control group "${controlName}" was not found`);
  const treatments = groups.filter((_, i) => i !== at);
  const ordered = [controlName, ...names.filter((_, i) => i !== at)];
  return comparisonTable(
    'studio.dunnettTest',
    dunnettTest(groups[at]!, treatments, ordered, alphaOf(alpha)).comparisons,
  );
}

/** Kruskal–Wallis H with Dunn's pairwise post-hoc comparison. */
export function kruskalTable(
  df: DataTable,
  valueColumn: string,
  groupColumn: string,
  correction: 'bonferroni' | 'bh' = 'bonferroni',
  alpha?: number,
): DataTable {
  if (correction !== 'bonferroni' && correction !== 'bh') {
    throw new Error('correction must be "bonferroni" or "bh"');
  }
  const { names, groups } = groupSamples(df, valueColumn, groupColumn);
  if (groups.length < 2) throw new Error('Kruskal–Wallis needs at least two groups');
  const a = alphaOf(alpha);
  const kw = kruskalWallis(groups);
  const dunn = dunnPostHoc(groups, names, correction, a);
  const rows: Array<[string, number, string]> = [
    ['H', kw.H, ''],
    ['df', kw.df, ''],
    ['p_value', kw.pValue, ''],
    ['epsilon_squared', kw.epsilonSquared, ''],
  ];
  for (const c of dunn.comparisons) {
    rows.push([`dunn[${c.groupA} vs ${c.groupB}]`, c.adjustedP, `${c.z.toFixed(3)} z`]);
  }
  return noteTable('studio.kruskalWallis', rows);
}

// ---- nonlinear least squares ----------------------------------------------

/** Fit one of the built-in nonlinear models to a two-column dataset. */
export function nonlinearTable(
  df: DataTable,
  xColumn: string,
  yColumn: string,
  model: NonlinearModelKind = 'michaelis-menten',
): DataTable {
  if (!(model in NONLINEAR_MODELS)) throw new Error(`unknown nonlinear model "${String(model)}"`);
  const x = Array.from(asFloat64(df, xColumn));
  const y = Array.from(asFloat64(df, yColumn));
  const fit = fitNonlinearModel(model, x, y);
  const rows: Array<[string, number]> = [];
  for (const c of fit.coefficients) {
    rows.push(
      [c.name, c.estimate],
      [`${c.name}_se`, c.se],
      [`${c.name}_ci_low`, c.ciLow],
      [`${c.name}_ci_high`, c.ciHigh],
    );
  }
  rows.push(
    ['r_squared', fit.rSquared],
    ['adj_r_squared', fit.adjRSquared],
    ['rmse', fit.rmse],
    ['sse', fit.sse],
    ['aic', fit.aic],
    ['bic', fit.bic],
    ['iterations', fit.iterations],
    ['converged', fit.converged ? 1 : 0],
  );
  return resultTable('studio.nonlinearFit', rows);
}

// ---- survival --------------------------------------------------------------

/** Kaplan–Meier curve(s), optionally split by a group column. */
export function kaplanMeierTable(
  df: DataTable,
  timeColumn: string,
  eventColumn: string,
  groupColumn = '',
): DataTable {
  const times = Array.from(asFloat64(df, timeColumn));
  const events = eventFlags(df, eventColumn);
  const group = String(groupColumn ?? '');
  const buckets = new Map<string, { times: number[]; events: boolean[] }>();
  if (group) {
    const labels = labelsOf(df, group);
    for (let i = 0; i < df.length; i += 1) {
      const key = labels[i]!;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = { times: [], events: [] };
        buckets.set(key, bucket);
      }
      bucket.times.push(times[i]!);
      bucket.events.push(events[i]!);
    }
  } else {
    buckets.set('', { times, events });
  }

  const groupOut: string[] = [];
  const timeOut: number[] = [];
  const survivalOut: number[] = [];
  const seOut: number[] = [];
  const ciLowOut: number[] = [];
  const ciHighOut: number[] = [];
  const atRiskOut: number[] = [];
  const eventsOut: number[] = [];
  const censoredOut: number[] = [];
  for (const [label, data] of buckets) {
    const km = kaplanMeier(data.times, data.events);
    for (const p of km.curve) {
      groupOut.push(label);
      timeOut.push(p.time);
      survivalOut.push(p.survival);
      seOut.push(p.se);
      ciLowOut.push(p.ciLow);
      ciHighOut.push(p.ciHigh);
      atRiskOut.push(p.nAtRisk);
      eventsOut.push(p.nEvents);
      censoredOut.push(p.nCensored);
    }
  }

  const cols: ColumnSpec[] = [
    { name: 'group', type: 'string', data: groupOut },
    { name: 'time', type: 'f64', data: Float64Array.from(timeOut) },
    { name: 'survival', type: 'f64', data: Float64Array.from(survivalOut) },
    { name: 'se', type: 'f64', data: Float64Array.from(seOut) },
    { name: 'ci_low', type: 'f64', data: Float64Array.from(ciLowOut) },
    { name: 'ci_high', type: 'f64', data: Float64Array.from(ciHighOut) },
    { name: 'n_at_risk', type: 'f64', data: Float64Array.from(atRiskOut) },
    { name: 'n_events', type: 'f64', data: Float64Array.from(eventsOut) },
    { name: 'n_censored', type: 'f64', data: Float64Array.from(censoredOut) },
  ];
  return createDataTable('studio.kaplanMeier', cols, { provenance: 'studio.kaplanMeier' });
}

/** Two-sample Mantel–Cox log-rank test. */
export function logRankTable(
  df: DataTable,
  timeColumn: string,
  eventColumn: string,
  groupColumn: string,
): DataTable {
  const group = String(groupColumn ?? '');
  if (!group) throw new Error('Log-rank needs a group column');
  const times = Array.from(asFloat64(df, timeColumn));
  const events = eventFlags(df, eventColumn);
  const labels = labelsOf(df, group);
  const names = [...new Set(labels)];
  if (names.length !== 2) throw new Error('Log-rank needs exactly two groups');
  const bucket = (label: string): { times: number[]; events: boolean[] } => {
    const out = { times: [] as number[], events: [] as boolean[] };
    for (let i = 0; i < df.length; i += 1) {
      if (labels[i] === label) {
        out.times.push(times[i]!);
        out.events.push(events[i]!);
      }
    }
    return out;
  };
  const r = logRankTest(bucket(names[0]!), bucket(names[1]!));
  return noteTable('studio.logRank', [
    ['chi2', r.chiSquare, ''],
    ['df', r.df, ''],
    ['p_value', r.pValue, ''],
    ['hazard_ratio', r.hazardRatio, `${names[0]!} vs ${names[1]!}`],
    ['hr_ci_low', r.hazardRatioCi95?.[0] ?? NaN, ''],
    ['hr_ci_high', r.hazardRatioCi95?.[1] ?? NaN, ''],
  ]);
}

// ---- psychometrics ---------------------------------------------------------

/** Cronbach's α, including the alpha-if-deleted refinement table. */
export function cronbachTable(
  df: DataTable,
  items?: string | string[],
): DataTable {
  const matrix = itemMatrix(df, items);
  const r = cronbachAlpha(matrix.rows);
  const rows: Array<[string, number, string]> = [
    ['alpha', r.alpha, r.interpretation],
    ['n_items', r.nItems, ''],
    ['n_subjects', r.nSubjects, ''],
    ['mean_inter_item_r', r.meanInterItemCorrelation, ''],
  ];
  r.alphaIfDeleted.forEach((a, i) => {
    rows.push([`alpha_if_deleted[${matrix.names[i]}]`, a, '']);
  });
  return noteTable('studio.cronbachAlpha', rows);
}

/** Kaiser–Meyer–Olkin sampling adequacy, overall and per item. */
export function kmoTable(df: DataTable, items?: string | string[]): DataTable {
  const matrix = itemMatrix(df, items);
  const r = kmo(matrix.rows);
  const rows: Array<[string, number, string]> = [['kmo', r.overall, r.interpretation]];
  r.perItem.forEach((v, i) => rows.push([`kmo[${matrix.names[i]}]`, v, '']));
  return noteTable('studio.kmoTest', rows);
}

/** Bartlett's test of sphericity. */
export function bartlettTable(df: DataTable, items?: string | string[]): DataTable {
  const matrix = itemMatrix(df, items);
  const r = bartlettTest(matrix.rows);
  return resultTable('studio.bartlettTest', [
    ['chi2', r.chiSquare],
    ['df', r.df],
    ['p_value', r.pValue],
    ['determinant', r.determinant],
  ]);
}

// ---- long / wide reshaping -------------------------------------------------

/** Wide → long (tidyr::pivot_longer). */
export function pivotLongerTable(
  df: DataTable,
  idCols: string | string[],
  measureCols?: string | string[],
  namesTo = 'variable',
  valuesTo = 'value',
): DataTable {
  const ids = splitList(idCols);
  if (ids.length === 0) throw new Error('pivot_longer needs at least one id column');
  const measures = splitList(measureCols);
  return pivotLonger(df, {
    idCols: ids,
    ...(measures.length > 0 ? { measureCols: measures } : {}),
    namesTo: String(namesTo || 'variable'),
    valuesTo: String(valuesTo || 'value'),
    id: 'studio.pivotLonger',
  });
}

/** Long → wide (tidyr::pivot_wider). */
export function pivotWiderTable(
  df: DataTable,
  idCols: string | string[],
  namesFrom: string,
  valuesFrom: string,
  namesPrefix = '',
): DataTable {
  const ids = splitList(idCols);
  if (ids.length === 0) throw new Error('pivot_wider needs at least one id column');
  if (!namesFrom || !valuesFrom) throw new Error('pivot_wider needs a names column and a values column');
  return pivotWider(df, {
    idCols: ids,
    namesFrom,
    valuesFrom,
    namesPrefix: String(namesPrefix ?? ''),
    id: 'studio.pivotWider',
  });
}
