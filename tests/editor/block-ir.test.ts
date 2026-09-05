// Block ⇄ IR round-trip tests — the pure JSON converter.
import { describe, it, expect } from 'vitest';
import {
  blockJSONToIR,
  workspaceJSONToIR,
  irToBlockJSON,
  irToWorkspaceJSON,
} from '@/editor/block';
import type { BlockJSON } from '@/editor/block';
import { makeProgram } from '@/editor/ir';
import type { IRNode } from '@/editor/ir';

const num = (n: number): IRNode => ({ kind: 'Number', value: n });
const ref = (name: string): IRNode => ({ kind: 'VarRef', name });

describe('blockJSONToIR', () => {
  it('converts a number block', () => {
    expect(blockJSONToIR({ type: 'studio_number', fields: { NUM: 42 } })).toEqual({ kind: 'Number', value: 42 });
  });

  it('converts a nested normalize block', () => {
    const json: BlockJSON = {
      type: 'studio_normalize',
      fields: { COLUMN: 'x', MODE: 'minmax' },
      inputs: {
        DATA: { block: { type: 'studio_load_csv', fields: { PATH: 'd.csv' } } },
      },
    };
    expect(blockJSONToIR(json)).toEqual({
      kind: 'Normalize',
      data: { kind: 'LoadCSV', path: 'd.csv' },
      column: 'x',
      mode: 'minmax',
    });
  });

  it('converts a repeat block with a chained body', () => {
    const json: BlockJSON = {
      type: 'studio_repeat',
      inputs: {
        COUNT: { block: { type: 'studio_number', fields: { NUM: 3 } } },
        DO: {
          block: {
            type: 'studio_print',
            inputs: { TEXT: { block: { type: 'studio_string', fields: { STR: 'hi' } } } },
            next: { block: { type: 'studio_print', inputs: { TEXT: { block: { type: 'studio_string', fields: { STR: 'yo' } } } } } },
          },
        },
      },
    };
    expect(blockJSONToIR(json)).toEqual({
      kind: 'Repeat',
      count: { kind: 'Number', value: 3 },
      body: [
        { kind: 'StudioCall', method: 'print', args: [{ kind: 'String', value: 'hi' }] },
        { kind: 'StudioCall', method: 'print', args: [{ kind: 'String', value: 'yo' }] },
      ],
    });
  });
});

describe('irToBlockJSON', () => {
  it('converts a number to a studio_number block', () => {
    expect(irToBlockJSON(num(5))).toEqual({ type: 'studio_number', fields: { NUM: 5 }, inputs: {} });
  });

  it('converts a binary op to the right operator block', () => {
    const b = irToBlockJSON({ kind: 'BinaryOp', op: '>', left: num(1), right: num(2) });
    expect(b.type).toBe('studio_compare');
    expect((b.fields as Record<string, unknown>).OP).toBe('>');
  });
});

describe('workspace round-trip', () => {
  it('wraps an empty program under a single run hat', () => {
    const ws = irToWorkspaceJSON(makeProgram([]));
    expect(ws.blocks!.blocks).toHaveLength(1);
    expect(ws.blocks!.blocks![0]!.type).toBe('studio_run');
  });

  it('preserves a multi-node program', () => {
    const program = makeProgram([
      { kind: 'VarAssign', name: 'df', value: { kind: 'LoadXYZ', path: 'galaxy.dat' }, declare: true },
      { kind: 'VarAssign', name: 'n', value: { kind: 'Normalize', data: ref('df'), column: 'x', mode: 'minmax' }, declare: true },
      { kind: 'PlotScatter', data: ref('n'), x: 'x', y: 'x_minmax' },
    ]);
    const ws = irToWorkspaceJSON(program);
    expect(ws.blocks!.blocks![0]!.type).toBe('studio_run');
    const round = workspaceJSONToIR(ws);
    expect(round.body).toEqual(program.body);
  });

  it('preserves control flow nesting', () => {
    const program = makeProgram([
      {
        kind: 'If',
        branches: [{ cond: { kind: 'Boolean', value: true }, body: [{ kind: 'StudioCall', method: 'print', args: [{ kind: 'String', value: 'yes' }] }] }],
        elseBody: [{ kind: 'StudioCall', method: 'print', args: [{ kind: 'String', value: 'no' }] }],
      },
    ]);
    const round = workspaceJSONToIR(irToWorkspaceJSON(program));
    expect(round.body).toEqual(program.body);
  });

  it('round-trips while / for-each / list / unary / line blocks', () => {
    const program = makeProgram([
      { kind: 'VarAssign', name: 'xs', value: { kind: 'List', items: [num(1), num(2), num(3)] }, declare: true },
      { kind: 'While', cond: { kind: 'BinaryOp', op: '<', left: num(1), right: num(2) }, body: [] },
      { kind: 'ForEach', varName: 'item', iterable: ref('xs'), body: [{ kind: 'StudioCall', method: 'print', args: [ref('item')] }] },
      { kind: 'VarAssign', name: 'neg', value: { kind: 'UnaryOp', op: '-', operand: num(5) }, declare: true },
      { kind: 'PlotLine', data: ref('df2'), x: 'x', y: 'y' },
    ]);
    const round = workspaceJSONToIR(irToWorkspaceJSON(program));
    expect(round.body).toEqual(program.body);
  });

  it('ignores orphaned blocks (only the run hat executes)', () => {
    const ws = {
      blocks: {
        languageVersion: 0,
        blocks: [
          { type: 'studio_run', next: { block: { type: 'studio_print', inputs: { TEXT: { block: { type: 'studio_string', fields: { STR: 'hi' } } } } } } },
          { type: 'studio_print', inputs: { TEXT: { block: { type: 'studio_string', fields: { STR: 'orphan' } } } } },
        ],
      },
    };
    const round = workspaceJSONToIR(ws);
    expect(round.body).toEqual([{ kind: 'StudioCall', method: 'print', args: [{ kind: 'String', value: 'hi' }] }]);
  });

  it('degrades an unexpressible node (GpuRun) to a raw block that round-trips as RawCode', () => {
    const program = makeProgram([{ kind: 'GpuRun', kernel: 'k', args: [] }]);
    const ws = irToWorkspaceJSON(program);
    const run = ws.blocks!.blocks![0]!;
    const first = run.next!.block!;
    expect(first.type).toBe('studio_raw');
    const round = workspaceJSONToIR(ws);
    expect(round.body[0]!.kind).toBe('RawCode');
  });

  it('preserves the RawCode lang field across a workspace round-trip', () => {
    const program = makeProgram([{ kind: 'RawCode', lang: 'python', text: 'print(1)' }]);
    const round = workspaceJSONToIR(irToWorkspaceJSON(program));
    expect(round.body[0]).toEqual({ kind: 'RawCode', lang: 'python', text: 'print(1)' });
  });

  it('degrades an unexpressible expression to a value raw block (studio_raw_value)', () => {
    // Reproduces the recurring "studio_raw ... is missing a(n) output connection"
    // warning: an expression the blocks can't model must become a *value* block
    // (one with an `output` connection) so it can legally sit in a value input.
    const b = irToBlockJSON({ kind: 'Call', callee: 'f', args: [] }, 'value');
    expect(b.type).toBe('studio_raw_value');
  });

  it('round-trips a raw expression through a workspace as RawExpr', () => {
    const program = makeProgram([
      { kind: 'VarAssign', name: 'x', value: { kind: 'Call', callee: 'f', args: [] }, declare: true },
    ]);
    const round = workspaceJSONToIR(irToWorkspaceJSON(program));
    expect(round.body[0]).toMatchObject({
      kind: 'VarAssign',
      name: 'x',
      declare: true,
      value: { kind: 'RawExpr', lang: 'js' },
    });
  });

  it('degrades a // BinaryOp expression to a value raw block', () => {
    const b = irToBlockJSON({ kind: 'BinaryOp', op: '//', left: num(7), right: num(2) }, 'value');
    expect(b.type).toBe('studio_raw_value');
  });
});
