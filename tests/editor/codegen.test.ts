// Codegen tests — IR → JS/Python text.
import { describe, it, expect } from 'vitest';
import { codegenJS, codegenPython } from '@/editor/codegen';
import { makeProgram } from '@/editor/ir';
import type { IRNode } from '@/editor/ir';

const df: IRNode = { kind: 'VarRef', name: 'df' };
const num = (n: number): IRNode => ({ kind: 'Number', value: n });

describe('codegenJS', () => {
  it('renders data load + normalize + scatter', () => {
    const program = makeProgram([
      { kind: 'VarAssign', name: 'df', value: { kind: 'LoadXYZ', path: 'galaxy.dat' }, declare: true },
      { kind: 'VarAssign', name: 'n', value: { kind: 'Normalize', data: df, column: 'x', mode: 'minmax' }, declare: true },
      { kind: 'PlotScatter', data: { kind: 'VarRef', name: 'n' }, x: 'x', y: 'x_minmax' },
    ]);
    const out = codegenJS(program);
    expect(out).toContain("let df = studio.load('galaxy.dat');");
    expect(out).toContain("studio.normalize(df, 'x', 'minmax')");
    expect(out).toContain("studio.plot('scatter', n, { x: 'x', y: 'x_minmax' });");
  });

  it('renders arithmetic and comparison ops', () => {
    const program = makeProgram([
      { kind: 'VarAssign', name: 'sum', value: { kind: 'BinaryOp', op: '+', left: num(1), right: num(2) }, declare: true },
      { kind: 'VarAssign', name: 'ok', value: { kind: 'BinaryOp', op: '>', left: num(3), right: num(2) }, declare: true },
    ]);
    const out = codegenJS(program);
    expect(out).toContain('let sum = (1 + 2);');
    expect(out).toContain('let ok = (3 > 2);');
  });

  it('renders repeat with a nested body', () => {
    const program = makeProgram([
      { kind: 'Repeat', count: num(10), body: [{ kind: 'StudioCall', method: 'print', args: [{ kind: 'String', value: 'hi' }] }] },
    ]);
    const out = codegenJS(program);
    expect(out).toContain('for (let __i = 0; __i < 10; __i++) {');
    expect(out).toContain("studio.print('hi');");
  });

  it('renders if/else', () => {
    const program = makeProgram([
      { kind: 'If', branches: [{ cond: { kind: 'Boolean', value: true }, body: [num(1)] }], elseBody: [num(2)] },
    ]);
    const out = codegenJS(program);
    expect(out).toContain('if (true) {');
    expect(out).toContain('else {');
  });
});

describe('codegenPython', () => {
  it('uses Python keywords and no semicolons', () => {
    const program = makeProgram([
      { kind: 'VarAssign', name: 'df', value: { kind: 'LoadCSV', path: 'data.csv' }, declare: true },
      { kind: 'VarAssign', name: 'ok', value: { kind: 'BinaryOp', op: 'and', left: { kind: 'Boolean', value: true }, right: { kind: 'Boolean', value: false } }, declare: true },
    ]);
    const out = codegenPython(program);
    expect(out).toBe("df = studio.load('data.csv')\nok = (True and False)");
  });

  it('renders repeat with Python for-range', () => {
    const program = makeProgram([{ kind: 'Repeat', count: num(5), body: [] }]);
    expect(codegenPython(program)).toContain('for __i in range(int(5)):');
  });

  it('renders floor division as //', () => {
    const program = makeProgram([{ kind: 'VarAssign', name: 'q', value: { kind: 'BinaryOp', op: '//', left: num(7), right: num(2) }, declare: true }]);
    expect(codegenPython(program)).toContain('q = (7 // 2)');
  });

  it('renders boolean literals as True/False', () => {
    const program = makeProgram([{ kind: 'VarAssign', name: 'b', value: { kind: 'Boolean', value: true }, declare: true }]);
    expect(codegenPython(program)).toContain('b = True');
  });
});
