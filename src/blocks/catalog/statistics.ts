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
import { mean as meanOf, meanCI } from '@/core/stats/descriptive';
import { studentTCdf as studTCdf } from '@/core/stats/special';
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
  return [...map.values()];
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

export const statisticsBlocks: BlockDefinition[] = [
  summaryBlock,
  histogramBlock,
  tTestOneBlock,
  tTestTwoBlock,
  tTestPairedBlock,
  anovaBlock,
  mannWhitneyBlock,
  chiSquareBlock,
  correlationBlock,
  cohensDBlock,
  correctionBlock,
];
