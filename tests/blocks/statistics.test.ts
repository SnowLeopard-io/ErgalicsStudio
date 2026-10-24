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
