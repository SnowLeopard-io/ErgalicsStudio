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
  bootstrapBlock,
  monteCarloBlock,
  mcmcBlock,
];
