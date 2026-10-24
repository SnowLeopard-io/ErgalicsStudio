// Flow DAG ⇄ IR conversion tests.
import { describe, it, expect } from 'vitest';
import { flowToIR, irToFlow, mergeFlowIR } from '@/editor/flow/convert';
import { makeProgram } from '@/editor/ir/types';
import type { BlockGraphState } from '@/types/block';

function inst(id: string, blockId: string, params: Record<string, unknown> = {}) {
  return { id, blockId, position: { x: 0, y: 0 }, params };
}

function conn(id: string, from: string, to: string) {
  return { id, from: { nodeId: from, portId: 'out' }, to: { nodeId: to, portId: 'data' } };
}

describe('flowToIR', () => {
  it('emits nodes in topological order even when authored backwards', () => {
    // Downstream block was placed before its source on the canvas.
    const graph: BlockGraphState = {
      instances: [
        inst('filter', 'filter.value', { column: 'x', op: '>', value: 0 }),
        inst('source', 'source.file', { path: 'a.csv' }),
      ],
      connections: [conn('c1', 'source', 'filter')],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const program = flowToIR(graph);
    expect(program.body).toHaveLength(2);
    expect(program.body[0]?.kind).toBe('VarAssign');
    const first = program.body[0] as { name: string; value: { kind: string } };
    const second = program.body[1] as { name: string; value: { kind: string; data: { name: string } } };
    expect(first.value.kind).toBe('LoadCSV');
    expect(second.value.kind).toBe('Filter');
    // The filter must reference the upstream variable that was defined first.
    expect(second.value.data.name).toBe(first.name);
  });

  it('keeps disconnected nodes in their authored (stable) order', () => {
    const graph: BlockGraphState = {
      instances: [
        inst('a', 'source.generate_random', { count: 10 }),
        inst('b', 'source.file', { path: 'b.csv' }),
      ],
      connections: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const program = flowToIR(graph);
    const kinds = program.body.map((n) => (n as { value: { kind: string } }).value?.kind);
    expect(kinds).toEqual(['Random', 'LoadCSV']);
  });

  it('linearizes a three-stage diamond pipeline by connections', () => {
    const graph: BlockGraphState = {
      instances: [
        inst('viz', 'viz.scatter', { x: 'x', y: 'y' }),
        inst('norm', 'transform.normalize', { column: 'x', mode: 'minmax' }),
        inst('src', 'source.file', { path: 'a.xyz' }),
      ],
      connections: [conn('c1', 'norm', 'viz'), conn('c2', 'src', 'norm')],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const program = flowToIR(graph);
    const kinds = program.body.map((n) => {
      if (n.kind === 'PlotScatter') return 'PlotScatter';
      return (n as { value: { kind: string } }).value?.kind;
    });
    expect(kinds).toEqual(['LoadXYZ', 'Normalize', 'PlotScatter']);
  });

  it('maps transform.add_column to a constant-broadcast studio call', () => {
    const graph: BlockGraphState = {
      instances: [
        inst('src', 'source.file', { fileName: 'a.csv' }),
        inst('add', 'transform.add_column', { name: 'z', value: 1 }),
      ],
      connections: [conn('c1', 'src', 'add')],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const program = flowToIR(graph);
    const add = program.body[1] as {
      value: { kind: string; method: string; args: { kind: string; value?: unknown }[] };
    };
    expect(add.value.kind).toBe('StudioCall');
    expect(add.value.method).toBe('addConstantColumn');
    expect(add.value.args[1]).toEqual({ kind: 'String', value: 'z' });
    expect(add.value.args[2]).toEqual({ kind: 'Number', value: 1 });
  });

  it('maps flow-only blocks (example_data / grid / range / top_k / rename) to studio calls', () => {
    const graph: BlockGraphState = {
      instances: [
        inst('ex', 'source.example_data', { count: 200, seed: 1 }),
        inst('grid', 'source.generate_grid', { size: 5 }),
        inst('range', 'filter.range', { column: 'x', min: -1, max: 1 }),
        inst('top', 'filter.top_k', { column: 'x', k: 3, direction: 'largest' }),
        inst('ren', 'transform.rename_column', { from: 'x', to: 'z' }),
      ],
      connections: [
        conn('r1', 'ex', 'range'),
        conn('r2', 'ex', 'top'),
        conn('r3', 'ex', 'ren'),
      ],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    const program = flowToIR(graph);
    const calls = program.body
      .map((n) => (n as { value?: { kind?: string; method?: string } }).value)
      .filter((v) => v?.kind === 'StudioCall')
      .map((v) => v!.method);
    // grid is unconnected: stable authored order places it right after ex.
    expect(calls).toEqual(['exampleData', 'grid', 'filterRange', 'topK', 'renameColumn']);
  });
});

describe('mergeFlowIR', () => {
  it('preserves non-DAG statements and functions when a flow edit round-trips', () => {
    // A program authored in code/block with prints + a loop + a function.
    const prev = makeProgram(
      [
        { kind: 'VarAssign', name: 'df1', value: { kind: 'LoadCSV', path: 'a.csv' }, declare: true },
        { kind: 'StudioCall', method: 'print', args: [{ kind: 'String', value: 'loaded' }] },
        {
          kind: 'Repeat',
          count: { kind: 'Number', value: 3 },
          body: [{ kind: 'StudioCall', method: 'print', args: [{ kind: 'String', value: 'tick' }] }],
        },
        { kind: 'VarAssign', name: 'df2', value: { kind: 'Summary', data: { kind: 'VarRef', name: 'df1' }, column: 'x' }, declare: true },
      ],
      [{ kind: 'FuncDef', name: 'f', params: [], body: [] }],
      'python',
    );

    // User edits ONLY the pipeline in flow mode: random source + scatter.
    const next = makeProgram([
      { kind: 'VarAssign', name: 'df1', value: { kind: 'Random', count: { kind: 'Number', value: 10 } }, declare: true },
      { kind: 'PlotScatter', data: { kind: 'VarRef', name: 'df1' }, x: 'x', y: 'y' },
    ]);

    const merged = mergeFlowIR(prev, next);
    const kinds = merged.body.map((n) => n.kind);
    // New pipeline nodes replace old ones in order; print/loop survive.
    expect(kinds).toEqual(['VarAssign', 'StudioCall', 'Repeat', 'PlotScatter']);
    expect((merged.body[0] as { value: { kind: string } }).value.kind).toBe('Random');
    // Functions are carried over untouched.
    expect(merged.functions).toHaveLength(1);
    expect(merged.functions[0]?.kind).toBe('FuncDef');
    expect(merged.sourceLang).toBe('python');
  });

  it('appends newly added pipeline nodes at the end', () => {
    const prev = makeProgram([
      { kind: 'StudioCall', method: 'print', args: [{ kind: 'String', value: 'hi' }] },
    ]);
    const next = makeProgram([
      { kind: 'VarAssign', name: 'df1', value: { kind: 'LoadCSV', path: 'a.csv' }, declare: true },
      { kind: 'VarAssign', name: 'df2', value: { kind: 'Sort', data: { kind: 'VarRef', name: 'df1' }, column: 'x', direction: 'asc' }, declare: true },
    ]);
    const merged = mergeFlowIR(prev, next);
    expect(merged.body.map((n) => n.kind)).toEqual(['StudioCall', 'VarAssign', 'VarAssign']);
  });
});

describe('irToFlow', () => {
  it('emits an add_column block for AddColumn nodes and wires its data port', () => {
    const program = makeProgram([
      { kind: 'VarAssign', name: 'df', value: { kind: 'LoadCSV', path: 'a.csv' }, declare: true },
      {
        kind: 'VarAssign',
        name: 'df2',
        value: { kind: 'AddColumn', data: { kind: 'VarRef', name: 'df' }, name: 'z', values: { kind: 'Number', value: 1 } },
        declare: true,
      },
    ]);
    const state = irToFlow(program);
    const ids = state.instances.map((i) => i.blockId);
    expect(ids).toContain('source.file');
    expect(ids).toContain('transform.add_column');
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0]!.to).toEqual({ nodeId: state.instances[1]!.id, portId: 'data' });
  });
});
