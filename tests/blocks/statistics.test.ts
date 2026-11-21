// ==========================================================================
// Ergalics Studio — statistics block tests (block system)
//
// Each block's executor is invoked with a mock context that supplies the
// upstream DataTable and params, then the resulting result-table is checked
// against known scipy/R reference values.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { createDataTable } from '@/types/datatable';
import type { ColumnSpec, DataTable } from '@/types/datatable';
import type { BlockDefinition } from '@/blocks/catalog/types';
import type { DagExecutionContext } from '@/types/dag';
import {
  tTestOneBlock,
  tTestTwoBlock,
  tTestPairedBlock,
  anovaBlock,
  mannWhitneyBlock,
  chiSquareBlock,
  correlationBlock,
  cohensDBlock,
  correctionBlock,
  tukeyBlock,
  dunnettBlock,
  kruskalBlock,
  nonlinearBlock,
  kaplanMeierBlock,
  logRankBlock,
  cronbachBlock,
  kmoBlock,
  bartlettBlock,
} from '@/blocks/catalog/statistics';

const close = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps;

function tbl(columns: ColumnSpec[]): DataTable {
  return createDataTable('in', columns, { provenance: 'test' });
}

function ctx(input: DataTable | undefined, params: Record<string, unknown>): DagExecutionContext {
  return {
    nodeId: 'n',
    getInput: () => input,
    getParam: (k) => params[k],
    markDirty: () => {},
    storage: { save: async () => {}, load: async () => undefined },
    onProgress: () => {},
  };
}

async function run(
  block: BlockDefinition,
  input: DataTable | undefined,
  params: Record<string, unknown>,
): Promise<DataTable> {
  const out = await block.executor!(ctx(input, params));
  expect(out).toBeDefined();
  return out as DataTable;
}

function valueOf(out: DataTable, metric: string): number {
  const m = out.getColumn('metric') as string[];
  const v = out.getColumn('value') as Float64Array;
  const i = m.indexOf(metric);
  expect(i).toBeGreaterThanOrEqual(0);
  return v[i]!;
}

describe('statistics blocks — hypothesis tests', () => {
  it('one-sample t-test at the sample mean gives t=0, p=1', async () => {
    const out = await run(
      tTestOneBlock,
      tbl([{ name: 'x', type: 'f64', data: new Float64Array([1, 2, 3, 4, 5]) }]),
      { column: 'x', mu: 3 },
    );
    expect(close(valueOf(out, 'statistic (t)'), 0, 1e-9)).toBe(true);
    expect(close(valueOf(out, 'p_value'), 1, 1e-9)).toBe(true);
    expect(close(valueOf(out, 'mean'), 3, 1e-9)).toBe(true);
  });

  it('Welch two-sample t-test matches scipy (t=-1, df=8)', async () => {
    const out = await run(
      tTestTwoBlock,
      tbl([
        { name: 'x', type: 'f64', data: new Float64Array([1, 2, 3, 4, 5]) },
        { name: 'y', type: 'f64', data: new Float64Array([2, 3, 4, 5, 6]) },
      ]),
      { column1: 'x', column2: 'y' },
    );
    expect(close(valueOf(out, 'statistic (t)'), -1, 1e-9)).toBe(true);
    expect(close(valueOf(out, 'df'), 8, 1e-9)).toBe(true);
    expect(close(valueOf(out, 'p_value'), 0.3461, 2e-3)).toBe(true);
    expect(close(valueOf(out, 'cohens_d'), -0.6325, 5e-3)).toBe(true);
  });

  it('paired t-test reports the mean difference of the pairs', async () => {
    const out = await run(
      tTestPairedBlock,
      tbl([
        { name: 'x', type: 'f64', data: new Float64Array([10, 20, 30, 40, 50]) },
        { name: 'y', type: 'f64', data: new Float64Array([8, 19, 28, 39, 49]) },
      ]),
      { column1: 'x', column2: 'y' },
    );
    expect(close(valueOf(out, 'mean_diff'), 1.4, 1e-9)).toBe(true);
    expect(valueOf(out, 'p_value')).toBeGreaterThan(0);
    expect(valueOf(out, 'p_value')).toBeLessThanOrEqual(1);
  });

  it('one-way ANOVA F = 3.0 across three groups', async () => {
    const out = await run(
      anovaBlock,
      tbl([
        { name: 'value', type: 'f64', data: new Float64Array([1, 2, 3, 2, 3, 4, 3, 4, 5]) },
        { name: 'group', type: 'string', data: ['a', 'a', 'a', 'b', 'b', 'b', 'c', 'c', 'c'] },
      ]),
      { valueColumn: 'value', groupColumn: 'group' },
    );
    expect(close(valueOf(out, 'statistic (F)'), 3.0, 1e-9)).toBe(true);
    expect(close(valueOf(out, 'df_between'), 2, 1e-9)).toBe(true);
    expect(close(valueOf(out, 'df_within'), 6, 1e-9)).toBe(true);
  });

  it('Mann-Whitney U = 0 when group A ranks fully below B', async () => {
    const out = await run(
      mannWhitneyBlock,
      tbl([
        { name: 'value', type: 'f64', data: new Float64Array([1, 2, 3, 4, 5, 6]) },
        { name: 'group', type: 'string', data: ['a', 'a', 'a', 'b', 'b', 'b'] },
      ]),
      { valueColumn: 'value', groupColumn: 'group' },
    );
    expect(close(valueOf(out, 'U'), 0, 1e-9)).toBe(true);
    expect(close(valueOf(out, 'p_value'), 0.0808, 5e-3)).toBe(true);
  });

  it('chi-square independence on [[10,10],[10,30]] gives chi2 = 3.75', async () => {
    const out = await run(
      chiSquareBlock,
      tbl([
        { name: 'x', type: 'f64', data: new Float64Array([10, 10]) },
        { name: 'y', type: 'f64', data: new Float64Array([10, 30]) },
      ]),
      {},
    );
    expect(close(valueOf(out, 'chi2'), 3.75, 1e-9)).toBe(true);
    expect(close(valueOf(out, 'df'), 1, 1e-9)).toBe(true);
    expect(close(valueOf(out, 'p_value'), 0.0528, 3e-3)).toBe(true);
  });
});

describe('statistics blocks — effect & correction', () => {
  it('Pearson correlation of a perfect line is r=1, p=0', async () => {
    const out = await run(
      correlationBlock,
      tbl([
        { name: 'x', type: 'f64', data: new Float64Array([1, 2, 3, 4, 5]) },
        { name: 'y', type: 'f64', data: new Float64Array([2, 4, 6, 8, 10]) },
      ]),
      { column1: 'x', column2: 'y', method: 'pearson' },
    );
    expect(close(valueOf(out, 'coefficient'), 1, 1e-9)).toBe(true);
    expect(valueOf(out, 'p_value')).toBe(0);
  });

  it("Cohen's d is 0 for identical samples", async () => {
    const out = await run(
      cohensDBlock,
      tbl([
        { name: 'x', type: 'f64', data: new Float64Array([1, 2, 3, 4, 5]) },
        { name: 'y', type: 'f64', data: new Float64Array([1, 2, 3, 4, 5]) },
      ]),
      { column1: 'x', column2: 'y' },
    );
    expect(close(valueOf(out, 'cohens_d (independent)'), 0, 1e-9)).toBe(true);
    expect(close(valueOf(out, 'cohens_d (paired)'), 0, 1e-9)).toBe(true);
  });

  it('Bonferroni correction multiplies raw p-values by m', async () => {
    const out = await run(
      correctionBlock,
      tbl([{ name: 'p', type: 'f64', data: new Float64Array([0.01, 0.02, 0.03]) }]),
      { column: 'p', method: 'bonferroni', alpha: 0.05 },
    );
    const adjusted = out.getColumn('p_adjusted') as Float64Array;
    const significant = out.getColumn('significant') as string[];
    expect(close(adjusted[0]!, 0.03, 1e-9)).toBe(true);
    expect(close(adjusted[2]!, 0.09, 1e-9)).toBe(true);
    expect(significant[0]).toBe('yes');
    expect(significant[1]).toBe('no');
    expect(significant[2]).toBe('no');
  });
});

describe('statistics blocks — new kernels', () => {
  const grouped = () =>
    tbl([
      {
        name: 'value',
        type: 'f64',
        data: new Float64Array([10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33]),
      },
      {
        name: 'group',
        type: 'string',
        data: ['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b', 'c', 'c', 'c', 'c'],
      },
    ]);

  it('Tukey block returns all pairwise comparisons', async () => {
    const out = await run(tukeyBlock, grouped(), {
      valueColumn: 'value',
      groupColumn: 'group',
      alpha: 0.05,
    });
    expect(out.length).toBe(3);
    expect(out.columnNames()).toContain('mean_diff');
    expect(Array.from(out.getColumn('group_a') as string[])).toEqual(['a', 'a', 'b']);
    const p = Array.from(out.getColumn('p_value') as Float64Array);
    expect(p.every((v) => v <= 1 && v >= 0)).toBe(true);
  });

  it('Dunnett block compares treatments with the configured control', async () => {
    const out = await run(dunnettBlock, grouped(), {
      valueColumn: 'value',
      groupColumn: 'group',
      control: 'a',
      alpha: 0.05,
    });
    expect(out.length).toBe(2);
    const a = Array.from(out.getColumn('group_a') as string[]);
    expect(a.every((g) => g === 'a')).toBe(true);
  });

  it('Kruskal-Wallis block reports H and Dunn rows', async () => {
    const out = await run(kruskalBlock, grouped(), {
      valueColumn: 'value',
      groupColumn: 'group',
      correction: 'bonferroni',
    });
    expect(valueOf(out, 'df')).toBe(2);
    expect(valueOf(out, 'H')).toBeGreaterThan(5);
    const metrics = out.getColumn('metric') as string[];
    expect(metrics.filter((m) => m.startsWith('dunn['))).toHaveLength(3);
  });

  it('nonlinear block recovers Michaelis-Menten parameters', async () => {
    const S = [0.5, 1, 2, 4, 8, 16, 32];
    const out = await run(
      nonlinearBlock,
      tbl([
        { name: 's', type: 'f64', data: new Float64Array(S) },
        { name: 'v', type: 'f64', data: new Float64Array(S.map((s) => (10 * s) / (2 + s))) },
      ]),
      { xColumn: 's', yColumn: 'v', model: 'michaelis-menten' },
    );
    expect(close(valueOf(out, 'Vmax'), 10, 1e-3)).toBe(true);
    expect(close(valueOf(out, 'Km'), 2, 1e-3)).toBe(true);
    expect(close(valueOf(out, 'converged'), 1, 1e-9)).toBe(true);
  });

  it('Kaplan-Meier block emits the curve and risk table', async () => {
    const out = await run(
      kaplanMeierBlock,
      tbl([
        { name: 'time', type: 'f64', data: new Float64Array([1, 2, 3, 4]) },
        { name: 'event', type: 'f64', data: new Float64Array([1, 1, 0, 1]) },
      ]),
      { timeColumn: 'time', eventColumn: 'event', groupColumn: '' },
    );
    expect(out.length).toBe(5); // t=0 plus four distinct times
    expect(out.columnNames()).toEqual([
      'group',
      'time',
      'survival',
      'se',
      'ci_low',
      'ci_high',
      'n_at_risk',
      'n_events',
      'n_censored',
    ]);
    const survival = Array.from(out.getColumn('survival') as Float64Array);
    expect(survival[0]).toBe(1);
  });

  it('log-rank block compares exactly two groups', async () => {
    const out = await run(
      logRankBlock,
      tbl([
        {
          name: 'time',
          type: 'f64',
          data: new Float64Array([1, 2, 3, 4, 10, 11, 12, 13]),
        },
        { name: 'event', type: 'f64', data: new Float64Array([1, 1, 1, 1, 1, 1, 1, 1]) },
        {
          name: 'group',
          type: 'string',
          data: ['a', 'a', 'a', 'a', 'b', 'b', 'b', 'b'],
        },
      ]),
      { timeColumn: 'time', eventColumn: 'event', groupColumn: 'group' },
    );
    expect(valueOf(out, 'df')).toBe(1);
    expect(valueOf(out, 'p_value')).toBeLessThan(0.05);
  });

  it('psychometrics blocks accept all numeric columns as items', async () => {
    const items = tbl([
      { name: 'q1', type: 'f64', data: new Float64Array([1, 2, 3, 4, 5]) },
      { name: 'q2', type: 'f64', data: new Float64Array([1, 2, 3, 4, 5]) },
      { name: 'q3', type: 'f64', data: new Float64Array([1, 2, 3, 4, 5]) },
    ]);
    const alpha = await run(cronbachBlock, items, { itemColumns: [] });
    expect(close(valueOf(alpha, 'alpha'), 1, 1e-10)).toBe(true);
    expect(valueOf(alpha, 'n_items')).toBe(3);

    const b = await run(bartlettBlock, items, { itemColumns: [] });
    expect(valueOf(b, 'df')).toBe(3);

    const kmoItems = tbl([
      { name: 'q1', type: 'f64', data: new Float64Array([1, 2, 3, 4, 5, 6, 7, 8]) },
      { name: 'q2', type: 'f64', data: new Float64Array([2, 4, 3, 6, 5, 8, 7, 9]) },
      { name: 'q3', type: 'f64', data: new Float64Array([5, 4, 6, 5, 8, 7, 9, 10]) },
    ]);
    const k = await run(kmoBlock, kmoItems, { itemColumns: [] });
    expect(valueOf(k, 'kmo')).toBeGreaterThan(0);
    expect(valueOf(k, 'kmo')).toBeLessThanOrEqual(1);
  });
});
