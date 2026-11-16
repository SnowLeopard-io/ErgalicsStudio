// Block-mode advanced statistics: block ⇄ IR mapping and Studio API tables.
import { describe, it, expect, vi } from 'vitest';
import {
  blockJSONToIR,
  irToWorkspaceJSON,
  workspaceJSONToIR,
} from '@/editor/block';
import { makeProgram, type IRNode } from '@/editor/ir';
import { createStudioApi, type StudioApiHost } from '@/editor/runtime/studio-api';
import { createDataTable, type ColumnSpec, type DataTable } from '@/types/datatable';

const str = (value: string): IRNode => ({ kind: 'String', value });
const num = (value: number): IRNode => ({ kind: 'Number', value });
const ref = (name: string): IRNode => ({ kind: 'VarRef', name });

function host(): StudioApiHost {
  return {
    loadText: vi.fn(async () => ''),
    renderView: vi.fn(async () => undefined),
    notify: vi.fn(),
    print: vi.fn(),
  };
}

function table(columns: ColumnSpec[]): DataTable {
  return createDataTable('t', columns, { provenance: 'test' });
}

describe('advanced statistics blocks → IR', () => {
  it('maps a Tukey block onto studio.tukeyHSD', () => {
    expect(
      blockJSONToIR({
        type: 'studio_tukey',
        fields: { VALUE: 'y', GROUP: 'group', ALPHA: 0.01 },
        inputs: { DATA: { block: { type: 'studio_var', fields: { NAME: 'df' } } } },
      }),
    ).toEqual({
      kind: 'StudioCall',
      method: 'tukeyHSD',
      args: [ref('df'), str('y'), str('group'), num(0.01)],
    });
  });

  it('maps a nonlinear block onto studio.nonlinearFit', () => {
    expect(
      blockJSONToIR({
        type: 'studio_nonlinear',
        fields: { X: 'dose', Y: 'response', MODEL: 'sigmoid4' },
        inputs: { DATA: { block: { type: 'studio_var', fields: { NAME: 'df' } } } },
      }),
    ).toEqual({
      kind: 'StudioCall',
      method: 'nonlinearFit',
      args: [ref('df'), str('dose'), str('response'), str('sigmoid4')],
    });
  });

  it('round-trips every advanced statistics block through a workspace', () => {
    const calls: Array<{ method: string; args: IRNode[] }> = [
      { method: 'tukeyHSD', args: [ref('df'), str('y'), str('g'), num(0.05)] },
      { method: 'dunnettTest', args: [ref('df'), str('y'), str('g'), str('control'), num(0.05)] },
      { method: 'kruskalWallis', args: [ref('df'), str('y'), str('g'), str('bh'), num(0.05)] },
      { method: 'nonlinearFit', args: [ref('df'), str('x'), str('y'), str('michaelis-menten')] },
      { method: 'kaplanMeier', args: [ref('df'), str('time'), str('event'), str('group')] },
      { method: 'logRank', args: [ref('df'), str('time'), str('event'), str('group')] },
      { method: 'cronbachAlpha', args: [ref('df'), str('q1,q2,q3')] },
      { method: 'kmoTest', args: [ref('df'), str('q1,q2,q3')] },
      { method: 'bartlettTest', args: [ref('df'), str('')] },
      { method: 'pivotLonger', args: [ref('df'), str('id'), str('a,b'), str('variable'), str('value')] },
      { method: 'pivotWider', args: [ref('df'), str('id'), str('variable'), str('value'), str('')] },
    ];
    const program = makeProgram(
      calls.map((call, i) => ({
        kind: 'VarAssign' as const,
        name: `r${i}`,
        value: { kind: 'StudioCall' as const, method: call.method, args: call.args },
        declare: true,
      })),
    );
    expect(workspaceJSONToIR(irToWorkspaceJSON(program)).body).toEqual(program.body);
  });
});

describe('advanced Studio API tables', () => {
  const groups = table([
    { name: 'group', type: 'string', data: ['a', 'a', 'a', 'b', 'b', 'b', 'c', 'c', 'c'] },
    { name: 'y', type: 'f64', data: Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]) },
  ]);

  it('builds Tukey and Dunnett comparison tables', () => {
    const api = createStudioApi(host());
    const tukey = api.tukeyHSD(groups, 'y', 'group');
    expect(tukey.columnNames()).toEqual([
      'group_a', 'group_b', 'mean_diff', 'se', 'statistic', 'p_value', 'ci_low', 'ci_high',
    ]);
    expect(tukey.length).toBe(3);
    const dunnett = api.dunnettTest(groups, 'y', 'group', 'a');
    expect(dunnett.length).toBe(2);
    const p = dunnett.getColumn('p_value') as Float64Array;
    expect([...p].every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('builds a Kruskal–Wallis summary with Dunn rows', () => {
    const api = createStudioApi(host());
    const out = api.kruskalWallis(groups, 'y', 'group', 'bh');
    expect(out.columnNames()).toEqual(['metric', 'value', 'note']);
    expect((out.getColumn('metric') as string[]).slice(0, 4)).toEqual([
      'H', 'df', 'p_value', 'epsilon_squared',
    ]);
    expect(out.length).toBe(4 + 3);
  });

  it('fits a nonlinear model into a metric/value table', () => {
    const api = createStudioApi(host());
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const df = table([
      { name: 'x', type: 'f64', data: Float64Array.from(x) },
      { name: 'v', type: 'f64', data: Float64Array.from(x.map((v) => (2 * v) / (1 + v))) },
    ]);
    const out = api.nonlinearFit(df, 'x', 'v', 'michaelis-menten');
    const metrics = out.getColumn('metric') as string[];
    expect(metrics).toContain('Vmax');
    expect(metrics).toContain('r_squared');
    expect(metrics).toContain('converged');
  });

  it('builds Kaplan–Meier and log-rank tables from an event column', () => {
    const api = createStudioApi(host());
    const df = table([
      { name: 'time', type: 'f64', data: Float64Array.from([1, 2, 3, 4, 5, 6]) },
      { name: 'event', type: 'string', data: ['event', 'censored', 'event', 'event', 'censored', 'event'] },
      { name: 'arm', type: 'string', data: ['a', 'a', 'a', 'b', 'b', 'b'] },
    ]);
    const km = api.kaplanMeier(df, 'time', 'event', 'arm');
    expect(km.columnNames()).toContain('survival');
    expect(new Set(km.getColumn('group') as string[])).toEqual(new Set(['a', 'b']));
    const lr = api.logRank(df, 'time', 'event', 'arm');
    expect((lr.getColumn('metric') as string[])[0]).toBe('chi2');
  });

  it('runs the psychometric routines', () => {
    const api = createStudioApi(host());
    const df = table([
      { name: 'q1', type: 'f64', data: Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8]) },
      { name: 'q2', type: 'f64', data: Float64Array.from([2, 1, 4, 3, 6, 5, 8, 7]) },
      { name: 'q3', type: 'f64', data: Float64Array.from([1, 3, 2, 5, 4, 7, 6, 8]) },
    ]);
    const alpha = api.cronbachAlpha(df, 'q1,q2,q3');
    expect(Number.isFinite((alpha.getColumn('value') as Float64Array)[0]!)).toBe(true);
    const kmoOut = api.kmoTest(df, ['q1', 'q2', 'q3']);
    expect((kmoOut.getColumn('metric') as string[])[0]).toBe('kmo');
    const bartlett = api.bartlettTest(df);
    expect((bartlett.getColumn('metric') as string[]).slice(0, 3)).toEqual(['chi2', 'df', 'p_value']);
  });

  it('pivots wide → long and back', () => {
    const api = createStudioApi(host());
    const wide = table([
      { name: 'id', type: 'string', data: ['r1', 'r2'] },
      { name: 'a', type: 'f64', data: Float64Array.from([1, 2]) },
      { name: 'b', type: 'f64', data: Float64Array.from([3, 4]) },
    ]);
    const long = api.pivotLonger(wide, 'id', 'a,b');
    expect(long.columnNames()).toEqual(['id', 'variable', 'value']);
    expect(long.length).toBe(4);
    const back = api.pivotWider(long, 'id', 'variable', 'value');
    expect(back.columnNames()).toEqual(['id', 'a', 'b']);
    expect([...(back.getColumn('b') as Float64Array)]).toEqual([3, 4]);
  });
});
