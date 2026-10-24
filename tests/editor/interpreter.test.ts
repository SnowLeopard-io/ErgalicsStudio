// Interpreter tests — IR execution against a StudioApi.
import { describe, it, expect, vi } from 'vitest';
import { interpret } from '@/editor/runtime/interpreter';
import { createStudioApi } from '@/editor/runtime/studio-api';
import type { StudioApiHost } from '@/editor/runtime/studio-api';
import { makeProgram } from '@/editor/ir';
import type { IRNode } from '@/editor/ir';
import type { RenderedView } from '@/types/datatable';
import { isDataTable } from '@/types/datatable';

function makeHost(files: Record<string, string>): StudioApiHost & { rendered: RenderedView[]; printed: string[] } {
  const rendered: RenderedView[] = [];
  const printed: string[] = [];
  return {
    loadText: vi.fn(async (path: string) => {
      const text = files[path];
      if (text === undefined) throw new Error(`file "${path}" not found`);
      return text;
    }),
    renderView: vi.fn(async (view: RenderedView) => {
      rendered.push(view);
    }),
    notify: vi.fn(),
    print: vi.fn((text: string) => printed.push(text)),
    rendered,
    printed,
  };
}

const ref = (name: string): IRNode => ({ kind: 'VarRef', name });
const num = (n: number): IRNode => ({ kind: 'Number', value: n });

describe('interpreter', () => {
  it('runs the canonical load → normalize → scatter pipeline', async () => {
    const host = makeHost({ 'galaxy.dat': '0 1\n1 2\n2 3' });
    const program = makeProgram([
      { kind: 'VarAssign', name: 'df', value: { kind: 'LoadXYZ', path: 'galaxy.dat' }, declare: true },
      { kind: 'VarAssign', name: 'n', value: { kind: 'Normalize', data: ref('df'), column: 'x', mode: 'minmax' }, declare: true },
      { kind: 'PlotScatter', data: ref('n'), x: 'x', y: 'x_minmax' },
    ]);
    const result = await interpret(program, createStudioApi(host));
    expect(result.ok).toBe(true);
    expect(host.rendered).toHaveLength(1);
    const df = result.variables['df'];
    expect(df && isDataTable(df)).toBe(true);
    const normalized = result.variables['n'];
    expect(normalized && isDataTable(normalized) && normalized.columnNames()).toEqual(['x', 'y', 'x_minmax']);
  });

  it('evaluates arithmetic and comparisons into scalar variables', async () => {
    const host = makeHost({});
    const program = makeProgram([
      { kind: 'VarAssign', name: 'sum', value: { kind: 'BinaryOp', op: '+', left: num(1), right: num(2) }, declare: true },
      { kind: 'VarAssign', name: 'big', value: { kind: 'BinaryOp', op: '>', left: num(3), right: num(2) }, declare: true },
    ]);
    const result = await interpret(program, createStudioApi(host));
    expect(result.ok).toBe(true);
    expect(result.variables['sum']).toEqual({ kind: 'scalar', value: 3 });
    expect(result.variables['big']).toEqual({ kind: 'scalar', value: true });
  });

  it('runs repeat loops and prints', async () => {
    const host = makeHost({});
    const program = makeProgram([
      {
        kind: 'Repeat',
        count: num(3),
        body: [{ kind: 'StudioCall', method: 'print', args: [{ kind: 'String', value: 'hi' }] }],
      },
    ]);
    const result = await interpret(program, createStudioApi(host));
    expect(result.ok).toBe(true);
    expect(host.printed).toEqual(['hi', 'hi', 'hi']);
  });

  it('routes filter through the column predicate', async () => {
    const host = makeHost({});
    const program = makeProgram([
      { kind: 'VarAssign', name: 'df', value: { kind: 'LoadCSV', path: 'd.csv' }, declare: true },
      { kind: 'VarAssign', name: 'f', value: { kind: 'Filter', data: ref('df'), column: 'x', op: '>', value: num(1) }, declare: true },
    ]);
    const api = createStudioApi(host);
    // Patch the loadText result for the CSV fixture.
    host.loadText = vi.fn(async () => 'x,y\n1,4\n2,5\n3,6');
    const result = await interpret(program, api);
    expect(result.ok).toBe(true);
    const f = result.variables['f'];
    expect(f && isDataTable(f) && f.length).toBe(2);
  });

  it('reports a clean error for undefined variables', async () => {
    const host = makeHost({});
    const program = makeProgram([{ kind: 'VarAssign', name: 'a', value: ref('missing'), declare: true }]);
    const result = await interpret(program, createStudioApi(host));
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('missing');
  });
});
