// ==========================================================================
// Ergalics Studio — statistics block catalog (block system)
// ==========================================================================

import { createDataTable } from '@/types/datatable';
import type { ColumnType, DataTable } from '@/types/datatable';
import { asFloat64, histogram, isNumericType, requireColumn, summarize } from '../ops';
import {
  tTestOneSample,
  tTestPaired,
  tTestTwoSample,
  anovaOneWay,
  mannWhitney,
  chiSquareIndependence,
} from '@/core/stats/tests';
import { cohensD, pearson, spearman } from '@/core/stats/effect';
import { bonferroni, benjaminiHochberg } from '@/core/stats/correction';
import { dunnettTest, tukeyHSD } from '@/core/stats/posthoc';
import { dunnPostHoc, kruskalWallis } from '@/core/stats/nonparametric';
import { kaplanMeier, logRankTest } from '@/core/stats/survival';
import { bartlettTest, cronbachAlpha, kmo } from '@/core/stats/psychometrics';
import { fitNonlinearModel, type NonlinearModelKind } from '@/core/model/nonlinear';
import { mean as meanOf, meanCI, median as medianOf, std as stdOf } from '@/core/stats/descriptive';
import { studentTCdf as studTCdf } from '@/core/stats/special';
import { bootstrapCI } from '@/core/uncertainty/bootstrap';
import { propagateError, type DistSpec } from '@/core/uncertainty/montecarlo';
import { metropolisHastings } from '@/core/uncertainty/mcmc';
import { dataTableInOut, defineBlock } from './types';
import type { BlockDefinition } from './types';

const STAT_COLOR = '#8E24AA';

/** Build a two-column (metric / value) result table from key/value rows. */
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

/** Narrow a `TestResult.df` (number | [number, number] | undefined) to a number. */
function dfToNum(df: number | [number, number] | undefined): number {
  return typeof df === 'number' ? df : NaN;
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

interface PairRow {
  groupA: string;
  groupB: string;
  meanDiff: number;
  se: number;
  statistic: number;
  pValue: number;
  ciLow: number;
  ciHigh: number;
}

/** Pairwise comparison table shared by Tukey and Dunnett. */
function comparisonTable(id: string, rows: PairRow[]): DataTable {
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

/** Coerce an event/status column (boolean, 0/1, "yes"/"no", "event") to booleans. */
function eventColumn(table: DataTable, name: string): boolean[] {
  if (!name) throw new Error('this block is not configured — pick the event/status column');
  const col = table.getColumn(name);
  if (!col) throw new Error(`column "${name}" does not exist`);
  const out: boolean[] = [];
  for (let i = 0; i < table.length; i += 1) {
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

/** All numeric columns, or a configured subset, as an n × k item matrix. */
function itemMatrix(table: DataTable, configured: string[]): number[][] {
  const names =
    configured.length > 0
      ? configured
      : table.columns.filter((c) => isNumericType(c.type)).map((c) => c.name);
  if (names.length < 2) throw new Error('select at least two numeric item columns');
  const cols = names.map((name) => numCol(table, name));
  const rows: number[][] = [];
  for (let i = 0; i < table.length; i += 1) rows.push(cols.map((c) => c[i]!));
  return rows;
}

function numCol(table: DataTable, name: string): Float64Array {
  return requireColumn(table, name);
}

function strCol(table: DataTable, name: string): string[] {
  if (!name) throw new Error('this block is not configured — pick a column first');
  const col = table.getColumn(name);
  if (col === undefined) throw new Error(`column "${name}" does not exist`);
  if (!Array.isArray(col)) throw new Error(`column "${name}" is not a category/string column`);
  return col as string[];
}

/** Split a numeric value column into groups keyed by a string group column. */
function groupValues(table: DataTable, valueCol: string, groupCol: string): number[][] {
  return groupedValues(table, valueCol, groupCol).groups;
}

/** Like `groupValues`, but also returns the group labels in first-seen order. */
function groupedValues(
  table: DataTable,
  valueCol: string,
  groupCol: string,
): { names: string[]; groups: number[][] } {
  const values = numCol(table, valueCol);
  const groups = strCol(table, groupCol);
  const map = new Map<string, number[]>();
  for (let i = 0; i < table.length; i += 1) {
    const g = groups[i]!;
    let bucket = map.get(g);
    if (!bucket) {
      bucket = [];
      map.set(g, bucket);
    }
    bucket.push(values[i]!);
  }
  return { names: [...map.keys()], groups: [...map.values()] };
}

/** Two-sided p-value for a Pearson/Spearman correlation coefficient. */
function correlationP(r: number, n: number): number {
  if (!Number.isFinite(r) || n < 3) return NaN;
  if (Math.abs(r) >= 1 - 1e-12) return 0; // perfect relationship → report p = 0
  const t = r * Math.sqrt((n - 2) / (1 - r * r));
  return 2 * (1 - studTCdf(Math.abs(t), n - 2));
}

export const summaryBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.summary',
    category: 'statistics',
    name: '统计摘要',
    nameI18n: { 'en-US': 'Summary' },
    description: '每个数值列的均值/标准差/最值/中位数',
    descriptionI18n: { 'en-US': 'Mean / std / min / max / median per numeric column' },
    color: STAT_COLOR,
    ...dataTableInOut(),
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const numeric = input.columns.filter((c) => isNumericType(c.type));
    const statLabels = ['mean', 'std', 'min', 'max', 'median'];
    const specs: { name: string; type: ColumnType; data: Float64Array }[] = numeric.map((c) => {
      const s = summarize(asFloat64(input, c.name));
      return {
        name: c.name,
        type: 'f64',
        data: new Float64Array([s.mean, s.std, s.min, s.max, s.median]),
      };
    });
    return createDataTable(
      'summary',
      [{ name: 'stat', type: 'string', data: statLabels }, ...specs],
      { provenance: 'stats.summary' },
    );
  },
);

export const histogramBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.histogram',
    category: 'statistics',
    name: '直方图',
    nameI18n: { 'en-US': 'Histogram' },
    description: '数值列分箱计数（bin center / count）',
    descriptionI18n: { 'en-US': 'Bin a numeric column into counts (bin center / count)' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { column: '', bins: 10 },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
      bins: { label: '分箱数', labelI18n: { 'en-US': 'Bins' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const column = String(ctx.getParam('column') ?? '');
    // Clamp so a huge/NaN `bins` cannot allocate a giant Float64Array.
    const rawBins = Number(ctx.getParam('bins') ?? 10);
    const bins = Number.isFinite(rawBins)
      ? Math.min(10_000, Math.max(1, Math.floor(rawBins)))
      : 10;
    const h = histogram(requireColumn(input, column), bins);
    return createDataTable(
      'hist',
      [
        { name: 'center', type: 'f64', data: h.centers },
        { name: 'count', type: 'f64', data: h.counts },
      ],
      { provenance: 'stats.histogram' },
    );
  },
);

// ---- hypothesis tests ------------------------------------------------------

export const tTestOneBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.ttest_one',
    category: 'statistics',
    name: '单样本 t 检验',
    nameI18n: { 'en-US': 'One-sample t-test' },
    description: '检验单列均值是否等于给定 μ（含 95% 置信区间）',
    descriptionI18n: { 'en-US': 'Test whether a column mean equals μ (with 95% CI)' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { column: '', mu: 0 },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
      mu: { label: '原假设均值 μ', labelI18n: { 'en-US': 'Null mean μ' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const a = numCol(input, String(ctx.getParam('column') ?? ''));
    const mu = Number(ctx.getParam('mu') ?? 0);
    const r = tTestOneSample(Array.from(a), mu);
    const [lo, hi] = meanCI(Array.from(a), 0.95);
    return resultTable('stats.ttest_one', [
      ['statistic (t)', r.statistic],
      ['df', dfToNum(r.df)],
      ['p_value', r.pValue],
      ['mean', meanOf(Array.from(a))],
      ['ci95_low', lo],
      ['ci95_high', hi],
    ]);
  },
);

export const tTestTwoBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.ttest_two',
    category: 'statistics',
    name: '独立样本 t 检验',
    nameI18n: { 'en-US': 'Two-sample t-test' },
    description: '两列均值差检验（Welch 不等方差校正）',
    descriptionI18n: { 'en-US': 'Compare two column means (Welch correction)' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { column1: '', column2: '' },
    paramLabels: {
      column1: { label: '列 1', labelI18n: { 'en-US': 'Column 1' } },
      column2: { label: '列 2', labelI18n: { 'en-US': 'Column 2' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const a = Array.from(numCol(input, String(ctx.getParam('column1') ?? '')));
    const b = Array.from(numCol(input, String(ctx.getParam('column2') ?? '')));
    const r = tTestTwoSample(a, b);
    return resultTable('stats.ttest_two', [
      ['statistic (t)', r.statistic],
      ['df', dfToNum(r.df)],
      ['p_value', r.pValue],
      ['mean_1', meanOf(a)],
      ['mean_2', meanOf(b)],
      ['mean_diff', meanOf(a) - meanOf(b)],
      ['cohens_d', cohensD(a, b)],
    ]);
  },
);

export const tTestPairedBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.ttest_paired',
    category: 'statistics',
    name: '配对 t 检验',
    nameI18n: { 'en-US': 'Paired t-test' },
    description: '成对差分均值为零的检验',
    descriptionI18n: { 'en-US': 'Test whether paired differences have zero mean' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { column1: '', column2: '' },
    paramLabels: {
      column1: { label: '列 1', labelI18n: { 'en-US': 'Column 1' } },
      column2: { label: '列 2', labelI18n: { 'en-US': 'Column 2' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const a = Array.from(numCol(input, String(ctx.getParam('column1') ?? '')));
    const b = Array.from(numCol(input, String(ctx.getParam('column2') ?? '')));
    const r = tTestPaired(a, b);
    const diffs = a.map((v, i) => v - (b[i] ?? 0));
    return resultTable('stats.ttest_paired', [
      ['statistic (t)', r.statistic],
      ['df', dfToNum(r.df)],
      ['p_value', r.pValue],
      ['mean_diff', meanOf(diffs)],
      ['cohens_d', cohensD(a, b, true)],
    ]);
  },
);

export const anovaBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.anova',
    category: 'statistics',
    name: '单因素 ANOVA',
    nameI18n: { 'en-US': 'One-way ANOVA' },
    description: '按分组列对数值列做单因素方差分析（F 检验）',
    descriptionI18n: { 'en-US': 'One-way F-test of a value column across groups' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { valueColumn: '', groupColumn: '' },
    paramLabels: {
      valueColumn: { label: '数值列', labelI18n: { 'en-US': 'Value column' } },
      groupColumn: { label: '分组列', labelI18n: { 'en-US': 'Group column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const groups = groupValues(
      input,
      String(ctx.getParam('valueColumn') ?? ''),
      String(ctx.getParam('groupColumn') ?? ''),
    );
    const r = anovaOneWay(groups);
    const df = r.df as [number, number] | undefined;
    return resultTable('stats.anova', [
      ['statistic (F)', r.statistic],
      ['df_between', df ? df[0] : NaN],
      ['df_within', df ? df[1] : NaN],
      ['p_value', r.pValue],
    ]);
  },
);

export const mannWhitneyBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.mannwhitney',
    category: 'statistics',
    name: 'Mann-Whitney U',
    nameI18n: { 'en-US': 'Mann-Whitney U' },
    description: '两独立样本的非参数秩和检验',
    descriptionI18n: { 'en-US': 'Non-parametric rank-sum test for two groups' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { valueColumn: '', groupColumn: '' },
    paramLabels: {
      valueColumn: { label: '数值列', labelI18n: { 'en-US': 'Value column' } },
      groupColumn: { label: '分组列', labelI18n: { 'en-US': 'Group column' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const groups = groupValues(
      input,
      String(ctx.getParam('valueColumn') ?? ''),
      String(ctx.getParam('groupColumn') ?? ''),
    );
    if (groups.length !== 2) {
      throw new Error('Mann-Whitney needs exactly two groups in the group column');
    }
    const r = mannWhitney(groups[0]!, groups[1]!);
    return resultTable('stats.mannwhitney', [
      ['U', r.u],
      ['z', r.z],
      ['p_value', r.pValue],
    ]);
  },
);

export const chiSquareBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.chisquare',
    category: 'statistics',
    name: '卡方独立性',
    nameI18n: { 'en-US': 'Chi-square independence' },
    description: '以列联表（数值列为计数）做独立性检验',
    descriptionI18n: { 'en-US': 'Independence test on a contingency table (numeric columns = counts)' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: {},
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const numeric = input.columns.filter((c) => isNumericType(c.type));
    if (numeric.length < 2) {
      throw new Error('contingency table needs at least two count columns');
    }
    const matrix: number[][] = [];
    for (let i = 0; i < input.length; i += 1) {
      const row: number[] = [];
      for (const c of numeric) {
        const col = input.getColumn(c.name)!;
        // ColumnData may be a typed array or string[]; index access gives number|string.
        row.push(Number(col[i]));
      }
      matrix.push(row);
    }
    const r = chiSquareIndependence(matrix);
    return resultTable('stats.chisquare', [
      ['chi2', r.statistic],
      ['df', r.df],
      ['p_value', r.pValue],
    ]);
  },
);

export const correlationBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.correlation',
    category: 'statistics',
    name: '相关分析',
    nameI18n: { 'en-US': 'Correlation' },
    description: '两列间的 Pearson / Spearman 相关及显著性',
    descriptionI18n: { 'en-US': 'Pearson / Spearman correlation with significance' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { column1: '', column2: '', method: 'pearson' },
    paramLabels: {
      column1: { label: '列 1', labelI18n: { 'en-US': 'Column 1' } },
      column2: { label: '列 2', labelI18n: { 'en-US': 'Column 2' } },
      method: { label: '方法', labelI18n: { 'en-US': 'Method (pearson/spearman)' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const a = Array.from(numCol(input, String(ctx.getParam('column1') ?? '')));
    const b = Array.from(numCol(input, String(ctx.getParam('column2') ?? '')));
    const method = String(ctx.getParam('method') ?? 'pearson').toLowerCase();
    const r = method === 'spearman' ? spearman(a, b) : pearson(a, b);
    return resultTable('stats.correlation', [
      ['coefficient', r],
      ['p_value', correlationP(r, a.length)],
      ['n', a.length],
    ]);
  },
);

export const cohensDBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.cohensd',
    category: 'statistics',
    name: "Cohen's d",
    nameI18n: { 'en-US': "Cohen's d" },
    description: '两列的标准化效应量（独立 / 配对）',
    descriptionI18n: { 'en-US': "Standardized effect size between two columns (independent / paired)" },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { column1: '', column2: '' },
    paramLabels: {
      column1: { label: '列 1', labelI18n: { 'en-US': 'Column 1' } },
      column2: { label: '列 2', labelI18n: { 'en-US': 'Column 2' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const a = Array.from(numCol(input, String(ctx.getParam('column1') ?? '')));
    const b = Array.from(numCol(input, String(ctx.getParam('column2') ?? '')));
    return resultTable('stats.cohensd', [
      ['cohens_d (independent)', cohensD(a, b)],
      ['cohens_d (paired)', cohensD(a, b, true)],
    ]);
  },
);

export const correctionBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.correction',
    category: 'statistics',
    name: '多重比较校正',
    nameI18n: { 'en-US': 'Multiple-comparison correction' },
    description: '对 p 值列做 Bonferroni / Benjamini-Hochberg 校正',
    descriptionI18n: { 'en-US': 'Adjust a column of p-values (Bonferroni / BH)' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { column: '', method: 'bonferroni', alpha: 0.05 },
    paramLabels: {
      column: { label: 'p 值列', labelI18n: { 'en-US': 'p-value column' } },
      method: { label: '方法', labelI18n: { 'en-US': 'Method (bonferroni/bh)' } },
      alpha: { label: '显著性水平 α', labelI18n: { 'en-US': 'Alpha' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const pvals = Array.from(numCol(input, String(ctx.getParam('column') ?? '')));
    const alpha = Number(ctx.getParam('alpha') ?? 0.05);
    const method = String(ctx.getParam('method') ?? 'bonferroni').toLowerCase();
    const res = method === 'bh' ? benjaminiHochberg(pvals, alpha) : bonferroni(pvals, alpha);
    const n = pvals.length;
    return createDataTable(
      'stats.correction',
      [
        { name: 'index', type: 'f64', data: Float64Array.from({ length: n }, (_, i) => i) },
        { name: 'p_raw', type: 'f64', data: numCol(input, String(ctx.getParam('column') ?? '')) },
        { name: 'p_adjusted', type: 'f64', data: new Float64Array(res.adjusted) },
        { name: 'significant', type: 'string', data: res.significant.map((s) => (s ? 'yes' : 'no')) },
      ],
      { provenance: 'stats.correction' },
    );
  },
);

// ---- uncertainty suite -----------------------------------------------------

/** Parse an optional seed param: blank/NaN → null (non-reproducible). */
function seedParam(ctx: { getParam: (key: string) => unknown }): number | null {
  const raw = ctx.getParam('seed');
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : null;
}

export const bootstrapBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.bootstrap',
    category: 'statistics',
    name: 'Bootstrap 置信区间',
    nameI18n: { 'en-US': 'Bootstrap CI' },
    description: '对列统计量做非参数 Bootstrap 重采样，给出百分位置信区间',
    descriptionI18n: { 'en-US': 'Percentile bootstrap CI for a column statistic' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { column: '', stat: 'mean', iters: 2000, alpha: 0.05, seed: '' },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
      stat: { label: '统计量', labelI18n: { 'en-US': 'Statistic (mean/median/std)' } },
      iters: { label: '重采样次数', labelI18n: { 'en-US': 'Resamples' } },
      alpha: { label: '显著性水平 α', labelI18n: { 'en-US': 'Alpha' } },
      seed: { label: '随机种子（可空）', labelI18n: { 'en-US': 'Seed (optional)' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const x = Array.from(numCol(input, String(ctx.getParam('column') ?? '')));
    const stat = String(ctx.getParam('stat') ?? 'mean').toLowerCase();
    const statistic =
      stat === 'median' ? medianOf : stat === 'std' ? (s: number[]) => stdOf(s) : meanOf;
    const r = bootstrapCI(x, statistic, {
      iters: Number(ctx.getParam('iters') ?? 2000),
      alpha: Number(ctx.getParam('alpha') ?? 0.05),
      seed: seedParam(ctx),
    });
    return resultTable('stats.bootstrap', [
      ['estimate', r.estimate],
      ['ci_low', r.lower],
      ['ci_high', r.upper],
      ['bootstrap_se', r.se],
      ['iters', r.iters],
      ['alpha', r.alpha],
    ]);
  },
);

export const monteCarloBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.montecarlo',
    category: 'statistics',
    name: '蒙特卡洛抽样',
    nameI18n: { 'en-US': 'Monte-Carlo draws' },
    description:
      '从参数分布抽样（normal: μ,σ · uniform: low,high · lognormal: logμ,logσ · triangular: low,mode,high）',
    descriptionI18n: {
      'en-US':
        'Draw from a distribution (normal: mean,sd · uniform: low,high · lognormal: logMean,logSd · triangular: low,mode,high)',
    },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { kind: 'normal', p1: 0, p2: 1, p3: 0, n: 10000, seed: '' },
    paramLabels: {
      kind: { label: '分布', labelI18n: { 'en-US': 'Distribution' } },
      p1: { label: '参数 1', labelI18n: { 'en-US': 'Param 1' } },
      p2: { label: '参数 2', labelI18n: { 'en-US': 'Param 2' } },
      p3: { label: '参数 3', labelI18n: { 'en-US': 'Param 3' } },
      n: { label: '抽样数', labelI18n: { 'en-US': 'Draws' } },
      seed: { label: '随机种子（可空）', labelI18n: { 'en-US': 'Seed (optional)' } },
    },
  },
  async (ctx) => {
    const kind = String(ctx.getParam('kind') ?? 'normal').toLowerCase();
    const p1 = Number(ctx.getParam('p1') ?? 0);
    const p2 = Number(ctx.getParam('p2') ?? 1);
    const p3 = Number(ctx.getParam('p3') ?? 0);
    const spec: DistSpec =
      kind === 'uniform'
        ? { kind: 'uniform', low: p1, high: p2 }
        : kind === 'lognormal'
          ? { kind: 'lognormal', logMean: p1, logSd: p2 }
          : kind === 'triangular'
            ? { kind: 'triangular', low: p1, mode: p2, high: p3 }
            : { kind: 'normal', mean: p1, sd: p2 };
    const n = Number(ctx.getParam('n') ?? 10000);
    const { samples } = propagateError((xs) => xs[0]!, [spec], n, { seed: seedParam(ctx) });
    return createDataTable(
      'stats.montecarlo',
      [{ name: 'x', type: 'f64', data: samples }],
      { provenance: 'stats.montecarlo' },
    );
  },
);

export const mcmcBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.mcmc',
    category: 'statistics',
    name: 'MCMC 贝叶斯估计',
    nameI18n: { 'en-US': 'Bayesian MCMC' },
    description: '正态似然 + 无信息先验，Metropolis 采样 μ 与 σ 的后验',
    descriptionI18n: {
      'en-US': 'Normal likelihood, flat priors — Metropolis posterior over μ and σ',
    },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { column: '', iters: 10000, burnIn: 5000, seed: '' },
    paramLabels: {
      column: { label: '列', labelI18n: { 'en-US': 'Column' } },
      iters: { label: '迭代数', labelI18n: { 'en-US': 'Iterations' } },
      burnIn: { label: '预热期', labelI18n: { 'en-US': 'Burn-in' } },
      seed: { label: '随机种子（可空）', labelI18n: { 'en-US': 'Seed (optional)' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const y = Array.from(numCol(input, String(ctx.getParam('column') ?? '')));
    if (y.length < 2) throw new Error('MCMC estimation needs at least two observations');
    const n = y.length;
    const sum = y.reduce((s, v) => s + v, 0);
    const yBar = sum / n;
    const sd = stdOf(y);
    // theta = [mu, logSigma]; normal likelihood, flat priors on mu and
    // logSigma (constants dropped). σ enters in log space so the proposal
    // never leaves the support.
    const logPost = (theta: number[]): number => {
      const mu = theta[0]!;
      const logSigma = theta[1]!;
      if (!Number.isFinite(mu) || !Number.isFinite(logSigma)) return -Infinity;
      const inv2s2 = Math.exp(-2 * logSigma);
      if (!Number.isFinite(inv2s2)) return -Infinity;
      let ss = 0;
      for (const v of y) {
        const d = v - mu;
        ss += d * d;
      }
      return -n * logSigma - ss * inv2s2 * 0.5;
    };
    const r = await metropolisHastings(logPost, [yBar, Math.log(Math.max(sd, 1e-12))], {
      iters: Number(ctx.getParam('iters') ?? 10000),
      burnIn: Number(ctx.getParam('burnIn') ?? 5000),
      seed: seedParam(ctx),
      // Optimal 1-D random-walk step ≈ 2.4 × posterior sd ≈ 2.4 × se(mu);
      // logSigma is O(1/√(2n)) wide, so scale it similarly.
      stepSizes: [Math.max(2.4 * sd, 1e-9) / Math.sqrt(n), Math.max(0.8 / Math.sqrt(2 * n), 0.01)],
    });
    const muDraws = Array.from(r.samples[0]!);
    const sigmaDraws = Array.from(r.samples[1]!).map((v) => Math.exp(v));
    const q = (arr: number[], p: number) => [...arr].sort((a, b) => a - b)[Math.floor(p * arr.length)]!;
    return resultTable('stats.mcmc', [
      ['mu_posterior_mean', meanOf(muDraws)],
      ['mu_ci_low', q(muDraws, 0.025)],
      ['mu_ci_high', q(muDraws, 0.975)],
      ['sigma_posterior_mean', meanOf(sigmaDraws)],
      ['sigma_median', q(sigmaDraws, 0.5)],
      ['acceptance_rate', r.acceptanceRate],
      ['iters', r.iters],
      ['burn_in', r.burnIn],
    ]);
  },
);

export const tukeyBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.tukey',
    category: 'statistics',
    name: 'Tukey HSD 事后检验',
    nameI18n: { 'en-US': 'Tukey HSD post-hoc' },
    description: 'ANOVA 显著后的所有两两均值比较（控制族错误率）',
    descriptionI18n: { 'en-US': 'All pairwise mean comparisons after ANOVA (FWER-controlled)' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { valueColumn: '', groupColumn: '', alpha: 0.05 },
    paramLabels: {
      valueColumn: { label: '数值列', labelI18n: { 'en-US': 'Value column' } },
      groupColumn: { label: '分组列', labelI18n: { 'en-US': 'Group column' } },
      alpha: { label: '显著性水平', labelI18n: { 'en-US': 'Alpha' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const alpha = Number(ctx.getParam('alpha') ?? 0.05);
    const { names, groups } = groupedValues(
      input,
      String(ctx.getParam('valueColumn') ?? ''),
      String(ctx.getParam('groupColumn') ?? ''),
    );
    if (groups.length < 2) throw new Error('Tukey HSD needs at least two groups');
    return comparisonTable('stats.tukey', tukeyHSD(groups, names, alpha).comparisons);
  },
);

export const dunnettBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.dunnett',
    category: 'statistics',
    name: 'Dunnett 对照检验',
    nameI18n: { 'en-US': 'Dunnett vs control' },
    description: '每个处理组与一个对照组比较（药理学/生物学常用）',
    descriptionI18n: { 'en-US': 'Compare every treatment group with one control' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { valueColumn: '', groupColumn: '', control: '', alpha: 0.05 },
    paramLabels: {
      valueColumn: { label: '数值列', labelI18n: { 'en-US': 'Value column' } },
      groupColumn: { label: '分组列', labelI18n: { 'en-US': 'Group column' } },
      control: { label: '对照组名称', labelI18n: { 'en-US': 'Control group label' } },
      alpha: { label: '显著性水平', labelI18n: { 'en-US': 'Alpha' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const { names, groups } = groupedValues(
      input,
      String(ctx.getParam('valueColumn') ?? ''),
      String(ctx.getParam('groupColumn') ?? ''),
    );
    const controlName = String(ctx.getParam('control') ?? '');
    const controlIndex = names.indexOf(controlName);
    if (controlIndex < 0) throw new Error(`control group "${controlName}" was not found`);
    const treatments = groups.filter((_, i) => i !== controlIndex);
    const treatmentNames = names.filter((_, i) => i !== controlIndex);
    const ordered = [controlName, ...treatmentNames];
    return comparisonTable(
      'stats.dunnett',
      dunnettTest(groups[controlIndex]!, treatments, ordered, Number(ctx.getParam('alpha') ?? 0.05))
        .comparisons,
    );
  },
);

export const kruskalBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.kruskal',
    category: 'statistics',
    name: 'Kruskal-Wallis 检验',
    nameI18n: { 'en-US': 'Kruskal-Wallis H' },
    description: '三组以上非参数比较，附 Dunn 事后两两检验',
    descriptionI18n: { 'en-US': 'Non-parametric multi-group test with Dunn post-hoc' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { valueColumn: '', groupColumn: '', correction: 'bonferroni' },
    paramLabels: {
      valueColumn: { label: '数值列', labelI18n: { 'en-US': 'Value column' } },
      groupColumn: { label: '分组列', labelI18n: { 'en-US': 'Group column' } },
      correction: { label: '多重比较校正', labelI18n: { 'en-US': 'Correction' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const { names, groups } = groupedValues(
      input,
      String(ctx.getParam('valueColumn') ?? ''),
      String(ctx.getParam('groupColumn') ?? ''),
    );
    if (groups.length < 2) throw new Error('Kruskal-Wallis needs at least two groups');
    const kw = kruskalWallis(groups);
    const correction =
      String(ctx.getParam('correction') ?? 'bonferroni') === 'bh' ? 'bh' : 'bonferroni';
    const dunn = dunnPostHoc(groups, names, correction);
    const rows: Array<[string, number, string]> = [
      ['H', kw.H, ''],
      ['df', kw.df, ''],
      ['p_value', kw.pValue, ''],
      ['epsilon_squared', kw.epsilonSquared, ''],
    ];
    for (const c of dunn.comparisons) {
      rows.push([`dunn[${c.groupA} vs ${c.groupB}]`, c.adjustedP, `${c.z.toFixed(3)} z`]);
    }
    return noteTable('stats.kruskal', rows);
  },
);

export const nonlinearBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.nonlinear',
    category: 'statistics',
    name: '非线性最小二乘拟合',
    nameI18n: { 'en-US': 'Nonlinear least squares' },
    description: 'Levenberg-Marquardt 拟合 Michaelis-Menten / 剂量反应 / 指数衰减等模型',
    descriptionI18n: { 'en-US': 'Levenberg–Marquardt fit of common lab models' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { xColumn: '', yColumn: '', model: 'michaelis-menten' },
    paramLabels: {
      xColumn: { label: 'X 列', labelI18n: { 'en-US': 'X column' } },
      yColumn: { label: 'Y 列', labelI18n: { 'en-US': 'Y column' } },
      model: {
        label: '模型 (michaelis-menten/sigmoid4/exponential/power/gaussian/arrhenius)',
        labelI18n: { 'en-US': 'Model id' },
      },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const x = Array.from(numCol(input, String(ctx.getParam('xColumn') ?? '')));
    const y = Array.from(numCol(input, String(ctx.getParam('yColumn') ?? '')));
    const kind = String(ctx.getParam('model') ?? 'michaelis-menten') as NonlinearModelKind;
    const fit = fitNonlinearModel(kind, x, y);
    const rows: Array<[string, number]> = [];
    for (const c of fit.coefficients) {
      rows.push([c.name, c.estimate], [`${c.name}_se`, c.se], [`${c.name}_ci_low`, c.ciLow], [`${c.name}_ci_high`, c.ciHigh]);
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
    return resultTable('stats.nonlinear', rows);
  },
);

export const kaplanMeierBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.kaplanmeier',
    category: 'statistics',
    name: 'Kaplan-Meier 生存曲线',
    nameI18n: { 'en-US': 'Kaplan-Meier curve' },
    description: '按时间/事件列生成 KM 曲线（可选分组），含 Greenwood 标准误与风险表',
    descriptionI18n: { 'en-US': 'Kaplan–Meier curve with Greenwood SE and risk table' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { timeColumn: '', eventColumn: '', groupColumn: '' },
    paramLabels: {
      timeColumn: { label: '时间列', labelI18n: { 'en-US': 'Time column' } },
      eventColumn: { label: '事件列 (1=事件, 0=删失)', labelI18n: { 'en-US': 'Event column' } },
      groupColumn: { label: '分组列（可选）', labelI18n: { 'en-US': 'Group column (optional)' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const times = Array.from(numCol(input, String(ctx.getParam('timeColumn') ?? '')));
    const events = eventColumn(input, String(ctx.getParam('eventColumn') ?? ''));
    const groupCol = String(ctx.getParam('groupColumn') ?? '');
    const groupMap = new Map<string, { times: number[]; events: boolean[] }>();
    if (groupCol) {
      const labels = strCol(input, groupCol);
      for (let i = 0; i < input.length; i += 1) {
        const key = labels[i]!;
        let bucket = groupMap.get(key);
        if (!bucket) {
          bucket = { times: [], events: [] };
          groupMap.set(key, bucket);
        }
        bucket.times.push(times[i]!);
        bucket.events.push(events[i]!);
      }
    } else {
      groupMap.set('', { times, events });
    }
    const curves = [...groupMap.entries()].map(([group, data]) => ({
      group,
      km: kaplanMeier(data.times, data.events),
    }));
    const rowCount = curves.reduce((s, c) => s + c.km.curve.length, 0);
    const groupOut: string[] = [];
    const time = new Float64Array(rowCount);
    const survival = new Float64Array(rowCount);
    const se = new Float64Array(rowCount);
    const ciLow = new Float64Array(rowCount);
    const ciHigh = new Float64Array(rowCount);
    const atRisk = new Float64Array(rowCount);
    const nEvents = new Float64Array(rowCount);
    const nCensored = new Float64Array(rowCount);
    let r = 0;
    for (const { group, km } of curves) {
      for (const p of km.curve) {
        groupOut.push(group);
        time[r] = p.time;
        survival[r] = p.survival;
        se[r] = p.se;
        ciLow[r] = p.ciLow;
        ciHigh[r] = p.ciHigh;
        atRisk[r] = p.nAtRisk;
        nEvents[r] = p.nEvents;
        nCensored[r] = p.nCensored;
        r += 1;
      }
    }
    return createDataTable(
      'stats.kaplanmeier',
      [
        { name: 'group', type: 'string', data: groupOut },
        { name: 'time', type: 'f64', data: time },
        { name: 'survival', type: 'f64', data: survival },
        { name: 'se', type: 'f64', data: se },
        { name: 'ci_low', type: 'f64', data: ciLow },
        { name: 'ci_high', type: 'f64', data: ciHigh },
        { name: 'n_at_risk', type: 'f64', data: atRisk },
        { name: 'n_events', type: 'f64', data: nEvents },
        { name: 'n_censored', type: 'f64', data: nCensored },
      ],
      { provenance: 'stats.kaplanmeier' },
    );
  },
);

export const logRankBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.logrank',
    category: 'statistics',
    name: 'Log-rank 检验',
    nameI18n: { 'en-US': 'Log-rank test' },
    description: '比较两条生存曲线的 Mantel-Cox 检验，返回 χ²、p 与风险比',
    descriptionI18n: { 'en-US': 'Mantel–Cox comparison of two survival curves' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { timeColumn: '', eventColumn: '', groupColumn: '' },
    paramLabels: {
      timeColumn: { label: '时间列', labelI18n: { 'en-US': 'Time column' } },
      eventColumn: { label: '事件列 (1=事件, 0=删失)', labelI18n: { 'en-US': 'Event column' } },
      groupColumn: { label: '分组列（两组）', labelI18n: { 'en-US': 'Group column (two groups)' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const times = Array.from(numCol(input, String(ctx.getParam('timeColumn') ?? '')));
    const events = eventColumn(input, String(ctx.getParam('eventColumn') ?? ''));
    const groupCol = String(ctx.getParam('groupColumn') ?? '');
    if (!groupCol) throw new Error('Log-rank needs a group column');
    const labels = strCol(input, groupCol);
    const names = [...new Set(labels)];
    if (names.length !== 2) throw new Error('Log-rank needs exactly two groups');
    const bucket = (label: string) => {
      const res = { times: [] as number[], events: [] as boolean[] };
      for (let i = 0; i < input.length; i += 1) {
        if (labels[i] === label) {
          res.times.push(times[i]!);
          res.events.push(events[i]!);
        }
      }
      return res;
    };
    const r = logRankTest(bucket(names[0]!), bucket(names[1]!));
    return noteTable('stats.logrank', [
      ['chi2', r.chiSquare, ''],
      ['df', r.df, ''],
      ['p_value', r.pValue, ''],
      ['hazard_ratio', r.hazardRatio, names[0]! + ' vs ' + names[1]!],
      ['hr_ci_low', r.hazardRatioCi95?.[0] ?? NaN, ''],
      ['hr_ci_high', r.hazardRatioCi95?.[1] ?? NaN, ''],
    ]);
  },
);

export const cronbachBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.cronbach',
    category: 'statistics',
    name: 'Cronbach α 信度',
    nameI18n: { 'en-US': "Cronbach's alpha" },
    description: '问卷内部一致性信度，含删除该题后的 α',
    descriptionI18n: { 'en-US': 'Internal-consistency reliability with alpha-if-deleted' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { itemColumns: [] },
    paramLabels: {
      itemColumns: { label: '题目列（留空=全部数值列）', labelI18n: { 'en-US': 'Item columns (empty = all numeric)' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const configured = (ctx.getParam('itemColumns') as string[] | undefined) ?? [];
    const items = itemMatrix(input, configured);
    const r = cronbachAlpha(items);
    const itemNames =
      configured.length > 0
        ? configured
        : input.columns.filter((c) => isNumericType(c.type)).map((c) => c.name);
    const rows: Array<[string, number, string]> = [
      ['alpha', r.alpha, r.interpretation],
      ['n_items', r.nItems, ''],
      ['n_subjects', r.nSubjects, ''],
      ['mean_inter_item_r', r.meanInterItemCorrelation, ''],
    ];
    r.alphaIfDeleted.forEach((a, i) => rows.push([`alpha_if_deleted[${itemNames[i]}]`, a, '']));
    return noteTable('stats.cronbach', rows);
  },
);

export const kmoBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.kmo',
    category: 'statistics',
    name: 'KMO 取样适切性',
    nameI18n: { 'en-US': 'KMO sampling adequacy' },
    description: '因子分析前置检验：KMO 总体与逐题取样适切性',
    descriptionI18n: { 'en-US': 'Kaiser–Meyer–Olkin sampling adequacy, overall and per item' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { itemColumns: [] },
    paramLabels: {
      itemColumns: { label: '题目列（留空=全部数值列）', labelI18n: { 'en-US': 'Item columns (empty = all numeric)' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const configured = (ctx.getParam('itemColumns') as string[] | undefined) ?? [];
    const items = itemMatrix(input, configured);
    const r = kmo(items);
    const itemNames =
      configured.length > 0
        ? configured
        : input.columns.filter((c) => isNumericType(c.type)).map((c) => c.name);
    const rows: Array<[string, number, string]> = [['kmo', r.overall, r.interpretation]];
    r.perItem.forEach((v, i) => rows.push([`kmo[${itemNames[i]}]`, v, '']));
    return noteTable('stats.kmo', rows);
  },
);

export const bartlettBlock: BlockDefinition = defineBlock(
  {
    id: 'stats.bartlett',
    category: 'statistics',
    name: 'Bartlett 球形检验',
    nameI18n: { 'en-US': 'Bartlett sphericity' },
    description: '相关矩阵是否显著偏离单位阵（因子分析可行性）',
    descriptionI18n: { 'en-US': 'Is the correlation matrix distinguishable from identity?' },
    color: STAT_COLOR,
    ...dataTableInOut(),
    defaultParams: { itemColumns: [] },
    paramLabels: {
      itemColumns: { label: '题目列（留空=全部数值列）', labelI18n: { 'en-US': 'Item columns (empty = all numeric)' } },
    },
  },
  async (ctx) => {
    const input = ctx.getInput('data') as DataTable;
    const configured = (ctx.getParam('itemColumns') as string[] | undefined) ?? [];
    const items = itemMatrix(input, configured);
    const r = bartlettTest(items);
    return resultTable('stats.bartlett', [
      ['chi2', r.chiSquare],
      ['df', r.df],
      ['p_value', r.pValue],
      ['determinant', r.determinant],
    ]);
  },
);

export const statisticsBlocks: BlockDefinition[] = [
  summaryBlock,
  histogramBlock,
  tTestOneBlock,
  tTestTwoBlock,
  tTestPairedBlock,
  anovaBlock,
  tukeyBlock,
  dunnettBlock,
  mannWhitneyBlock,
  kruskalBlock,
  chiSquareBlock,
  correlationBlock,
  cohensDBlock,
  correctionBlock,
  nonlinearBlock,
  kaplanMeierBlock,
  logRankBlock,
  cronbachBlock,
  kmoBlock,
  bartlettBlock,
  bootstrapBlock,
  monteCarloBlock,
  mcmcBlock,
];
