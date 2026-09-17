// Code → IR parser tests.
//
// These guard the inverse of `codegen/core.ts`: every IR construct our own
// generator can emit must parse back from Python, JS and R with zero RawCode
// nodes, and re-generating from the parsed IR must be text-stable. That is the
// contract that lets the code mode feed block / flow mode in all languages.
import { describe, it, expect } from 'vitest';
import { generate } from '@/editor/codegen/core';
import { parseCodeToIR, parseExpression } from '@/editor/code/parse';
import { makeProgram } from '@/editor/ir/types';
import type { IRNode, IRProgram } from '@/editor/ir/types';

const num = (n: number): IRNode => ({ kind: 'Number', value: n });
const str = (s: string): IRNode => ({ kind: 'String', value: s });
const ref = (name: string): IRNode => ({ kind: 'VarRef', name });
const LANGS = ['python', 'js', 'r'] as const;

function buildProgram(): IRProgram {
  return makeProgram(
    [
      { kind: 'VarAssign', name: 'df', value: { kind: 'LoadXYZ', path: 'galaxy.xyz' }, declare: true },
      { kind: 'VarAssign', name: 'r1', value: { kind: 'Random', count: num(100), seed: num(42) }, declare: true },
      { kind: 'VarAssign', name: 'r2', value: { kind: 'Range', start: num(0), stop: num(10), step: num(2) }, declare: true },
      { kind: 'VarAssign', name: 'f1', value: { kind: 'Filter', data: ref('df'), column: 'x', op: '>', value: num(0) }, declare: true },
      { kind: 'VarAssign', name: 's1', value: { kind: 'Select', data: ref('df'), columns: ['x', 'y'] }, declare: true },
      {
        kind: 'VarAssign',
        name: 'a1',
        value: { kind: 'AddColumn', data: ref('df'), name: 'z', values: { kind: 'BinaryOp', op: '**', left: ref('x'), right: num(2) } },
        declare: true,
      },
      { kind: 'VarAssign', name: 'n1', value: { kind: 'Normalize', data: ref('df'), column: 'x', mode: 'zscore' }, declare: true },
      { kind: 'VarAssign', name: 'o1', value: { kind: 'Sort', data: ref('df'), column: 'x', direction: 'asc' }, declare: true },
      { kind: 'VarAssign', name: 'sum1', value: { kind: 'Summary', data: ref('df'), column: 'x' }, declare: true },
      { kind: 'VarAssign', name: 'h1', value: { kind: 'Histogram', data: ref('df'), column: 'x', bins: num(20) }, declare: true },
      {
        kind: 'VarAssign',
        name: 'arith',
        value: {
          kind: 'BinaryOp',
          op: '+',
          left: { kind: 'BinaryOp', op: '//', left: num(7), right: num(2) },
          right: { kind: 'BinaryOp', op: '%', left: num(7), right: num(3) },
        },
        declare: true,
      },
      {
        kind: 'VarAssign',
        name: 'logic',
        value: {
          kind: 'BinaryOp',
          op: 'and',
          left: { kind: 'UnaryOp', op: 'not', operand: { kind: 'Boolean', value: false } },
          right: { kind: 'Boolean', value: true },
        },
        declare: true,
      },
      { kind: 'VarAssign', name: 'lst', value: { kind: 'List', items: [num(1), num(2), num(3)] }, declare: true },
      { kind: 'VarAssign', name: 'item', value: { kind: 'ListIndex', list: ref('lst'), index: num(0) }, declare: true },
      { kind: 'VarAssign', name: 'sl', value: { kind: 'ListSlice', list: ref('lst'), start: num(1), stop: num(3) }, declare: true },
      { kind: 'VarAssign', name: 'd1', value: { kind: 'Dict', entries: [{ key: 'k', value: str('v') }] }, declare: true },
      { kind: 'VarAssign', name: 'nl', value: { kind: 'Null' }, declare: true },
      { kind: 'PlotScatter', data: ref('df'), x: 'x', y: 'y', color: 'grp' },
      { kind: 'PlotLine', data: ref('df'), x: 'x', y: 'y' },
      { kind: 'PlotHistogram', data: ref('df'), column: 'x' },
      { kind: 'PlotPointCloud', data: ref('df'), x: 'x', y: 'y', z: 'z' },
      {
        kind: 'If',
        branches: [
          { cond: { kind: 'BinaryOp', op: '>', left: num(1), right: num(0) }, body: [{ kind: 'StudioCall', method: 'print', args: [str('a')] }] },
          { cond: { kind: 'BinaryOp', op: '<', left: num(0), right: num(1) }, body: [{ kind: 'StudioCall', method: 'print', args: [str('b')] }] },
        ],
        elseBody: [{ kind: 'StudioCall', method: 'print', args: [str('c')] }],
      },
      { kind: 'Repeat', count: num(10), body: [{ kind: 'Break' }, { kind: 'Continue' }] },
      { kind: 'While', cond: { kind: 'Boolean', value: true }, body: [{ kind: 'Break' }] },
      { kind: 'ForEach', varName: 'item', iterable: ref('lst'), body: [{ kind: 'StudioCall', method: 'print', args: [ref('item')] }] },
      { kind: 'Return', value: num(42) },
    ],
    [
      {
        kind: 'FuncDef',
        name: 'square',
        params: ['x'],
        body: [{ kind: 'Return', value: { kind: 'BinaryOp', op: '**', left: ref('x'), right: num(2) } }],
      },
    ],
    'python',
  );
}

describe('parseCodeToIR round-trips', () => {
  for (const lang of LANGS) {
    it(`parses every generated ${lang} construct back to IR`, () => {
      const program = buildProgram();
      const code = generate(program, lang);
      const parsed = parseCodeToIR(code, lang);
      expect(parsed.rawCount, `unexpected RawCode in ${lang} output:\n${code}`).toBe(0);
      expect(parsed.program.functions.length).toBe(1);
      expect(parsed.program.body.length).toBe(program.body.length);
    });

    it(`re-generating parsed ${lang} is text-stable`, () => {
      const code = generate(buildProgram(), lang);
      const parsed = parseCodeToIR(code, lang).program;
      expect(generate(parsed, lang).trim()).toBe(code.trim());
    });
  }
});

describe('parseCodeToIR language specifics', () => {
  it('parses Python indentation blocks', () => {
    const src = [
      'if x > 0:',
      "    studio.print('pos')",
      'elif x < 0:',
      "    studio.print('neg')",
      'else:',
      "    studio.print('zero')",
      'for i in range(int(5)):',
      '    if i > 2:',
      '        break',
    ].join('\n');
    const { program, rawCount } = parseCodeToIR(src, 'python');
    expect(rawCount).toBe(0);
    const ifNode = program.body[0]!;
    expect(ifNode.kind).toBe('If');
    if (ifNode.kind !== 'If') throw new Error('expected If');
    expect(ifNode.branches.length).toBe(2);
    expect(ifNode.elseBody).toHaveLength(1);
    const repeat = program.body[1]!;
    expect(repeat.kind).toBe('Repeat');
  });

  it('parses R left/right assignment and next keyword', () => {
    const src = [
      'df <- studio.load(\'a.csv\')',
      '42 -> answer',
      'while (TRUE) {',
      '    next',
      '}',
      'square <- function(x) {',
      '    return(x * x)',
      '}',
    ].join('\n');
    const { program, rawCount } = parseCodeToIR(src, 'r');
    expect(rawCount).toBe(0);
    expect(program.body[0]).toMatchObject({ kind: 'VarAssign', name: 'df' });
    expect(program.body[1]).toMatchObject({ kind: 'VarAssign', name: 'answer' });
    expect(program.body[2]?.kind).toBe('While');
    expect(program.functions[0]?.kind).toBe('FuncDef');
  });

  it('parses JS let declarations and brace blocks', () => {
    const src = [
      'let df = studio.load(\'a.csv\');',
      'if (df) {',
      "  studio.print('ok');",
      '} else {',
      "  studio.print('empty');",
      '}',
      'for (let item of lst) {',
      '  studio.print(item);',
      '}',
    ].join('\n');
    const { program, rawCount } = parseCodeToIR(src, 'js');
    expect(rawCount).toBe(0);
    expect(program.body[0]).toMatchObject({ kind: 'VarAssign', name: 'df' });
    expect(program.body[1]?.kind).toBe('If');
    expect(program.body[2]?.kind).toBe('ForEach');
  });

  it('keeps unrecognized source as RawCode instead of dropping it', () => {
    const { rawCount } = parseCodeToIR('class Foo:\n    pass', 'python');
    expect(rawCount).toBeGreaterThan(0);
  });

  it('hoists top-level function definitions to program.functions', () => {
    const src = 'def f(x):\n    return x\nstudio.print(f(2))';
    const { program } = parseCodeToIR(src, 'python');
    expect(program.functions).toHaveLength(1);
    expect(program.body).toHaveLength(1);
  });
});

describe('parseExpression', () => {
  it('parses R idioms into language-neutral IR', () => {
    expect(parseExpression('a %% b', 'r')).toMatchObject({ kind: 'BinaryOp', op: '%' });
    expect(parseExpression('a %/% b', 'r')).toMatchObject({ kind: 'BinaryOp', op: '//' });
    expect(parseExpression('a ^ 2', 'r')).toMatchObject({ kind: 'BinaryOp', op: '**' });
    expect(parseExpression('TRUE && FALSE', 'r')).toMatchObject({ kind: 'BinaryOp', op: 'and' });
    expect(parseExpression('NULL', 'r')).toMatchObject({ kind: 'Null' });
    expect(parseExpression("list('a', 'b')", 'r')).toMatchObject({ kind: 'List' });
    expect(parseExpression("list(x = 'a')", 'r')).toMatchObject({ kind: 'Dict' });
  });

  it('parses Python slices with optional parts', () => {
    expect(parseExpression('a[1:3]', 'python')).toMatchObject({ kind: 'ListSlice' });
    expect(parseExpression('a[:2]', 'python')).toMatchObject({ kind: 'ListSlice' });
    expect(parseExpression('a[::2]', 'python')).toMatchObject({ kind: 'ListSlice' });
    expect(parseExpression('a[0]', 'python')).toMatchObject({ kind: 'ListIndex' });
  });

  it('returns null on invalid input', () => {
    expect(parseExpression('1 + ', 'python')).toBeNull();
    expect(parseExpression('', 'python')).toBeNull();
  });
});
