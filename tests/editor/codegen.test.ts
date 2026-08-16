// Codegen tests — IR → JS/Python text.
import { describe, it, expect } from 'vitest';
import { codegenJS, codegenPython } from '@/editor/codegen';
import { makeProgram } from '@/editor/ir';
import type { IRNode } from '@/editor/ir';

const df: IRNode = { kind: 'VarRef', name: 'df' };
const num = (n: number): IRNode => ({ kind: 'Number', value: n });

function sliceNode(start?: number, stop?: number, step?: number): IRNode {
  return {
    kind: 'ListSlice',
    list: { kind: 'VarRef', name: 'lst' },
    ...(start !== undefined ? { start: num(start) } : {}),
    ...(stop !== undefined ? { stop: num(stop) } : {}),
    ...(step !== undefined ? { step: num(step) } : {}),
  };
}

/** Execute a generated JS program over `lst = [0..9]` and return `a`. */
function runJS(node: IRNode): unknown {
  const out = codegenJS(makeProgram([{ kind: 'VarAssign', name: 'a', value: node, declare: true }]));
  // eslint-disable-next-line no-new-func
  const fn = new Function(`const lst = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];\n${out}\nreturn a;`);
  return fn();
}

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
    expect(out).toContain('for (let __i = 0; __i < Math.floor(10); __i++) {');
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

  it('renders a step-less slice via native .slice', () => {
    const out = codegenJS(makeProgram([{ kind: 'VarAssign', name: 'a', value: sliceNode(1, 5), declare: true }]));
    expect(out).toContain('.slice(1, 5)');
  });

  it('does not silently drop the step in JS output', () => {
    const out = codegenJS(makeProgram([{ kind: 'VarAssign', name: 'a', value: sliceNode(1, 8, 2), declare: true }]));
    expect(out).not.toContain('.slice(1, 8)');
    expect(out).toContain('k=');
  });

  it('emits a JS slice emulation matching Python semantics', () => {
    expect(runJS(sliceNode(1, 8, 2))).toEqual([1, 3, 5, 7]);
    expect(runJS(sliceNode(undefined, undefined, -1))).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
    expect(runJS(sliceNode(7, 2, -2))).toEqual([7, 5, 3]);
    expect(runJS(sliceNode(undefined, undefined, -2))).toEqual([9, 7, 5, 3, 1]);
    expect(runJS(sliceNode(3, -1, -1))).toEqual([]);
    expect(runJS(sliceNode(4, 0, -1))).toEqual([4, 3, 2, 1]);
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

  it('renders a slice with a step natively in Python', () => {
    const out = codegenPython(makeProgram([{ kind: 'VarAssign', name: 'a', value: sliceNode(1, 8, 2), declare: true }]));
    expect(out).toContain('a = lst[1:8:2]');
  });

  it('renders an open-ended reverse slice natively in Python', () => {
    const out = codegenPython(makeProgram([{ kind: 'VarAssign', name: 'a', value: sliceNode(undefined, undefined, -1), declare: true }]));
    expect(out).toContain('a = lst[::-1]');
  });
});
