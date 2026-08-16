// ==========================================================================
// Ergalics Studio — IR → code generator (shared core)
//
// Pure, side-effect-free walker that renders an IRProgram as JavaScript or
// Python text. Both dialects emit `studio.*` calls that mirror the IR
// transform/stat nodes exactly, so the generated text and the IR interpreter
// (runtime/interpreter.ts) agree on semantics (block-code-modes.md §3.1 #2).
// ==========================================================================

import type { BinaryOperator, IRNode, IRProgram } from '../ir/types';

export type CodegenLang = 'js' | 'python';

interface Ctx {
  lang: CodegenLang;
  indentUnit: string;
}

function quote(s: string): string {
  return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function bool(value: boolean, c: Ctx): string {
  return c.lang === 'js' ? String(value) : value ? 'True' : 'False';
}

function binop(op: BinaryOperator, c: Ctx): string {
  if (op === 'and') return c.lang === 'js' ? '&&' : 'and';
  if (op === 'or') return c.lang === 'js' ? '||' : 'or';
  return op;
}

function binaryExpr(node: Extract<IRNode, { kind: 'BinaryOp' }>, c: Ctx): string {
  const left = expr(node.left, c);
  const right = expr(node.right, c);
  if (node.op === '//' && c.lang === 'js') {
    return `Math.floor(${left} / ${right})`;
  }
  return `(${left} ${binop(node.op, c)} ${right})`;
}

function unaryExpr(node: Extract<IRNode, { kind: 'UnaryOp' }>, c: Ctx): string {
  if (node.op === 'not') return c.lang === 'js' ? `!${expr(node.operand, c)}` : `not ${expr(node.operand, c)}`;
  return `-${expr(node.operand, c)}`;
}

function sliceExpr(node: Extract<IRNode, { kind: 'ListSlice' }>, c: Ctx): string {
  const list = expr(node.list, c);
  const start = node.start ? expr(node.start, c) : '';
  const stop = node.stop ? expr(node.stop, c) : '';
  const step = node.step ? expr(node.step, c) : '';
  if (c.lang === 'python') {
    return `${list}[${start}:${stop}${step ? `:${step}` : ''}]`;
  }
  // JS slice(start, end) — step is not supported, so ignore it when non-unit.
  if (!node.step) return `${list}.slice(${start || '0'}, ${stop || 'undefined'})`;
  return `${list}.slice(${start || '0'}, ${stop || 'undefined'})`;
}

function dictExpr(node: Extract<IRNode, { kind: 'Dict' }>, c: Ctx): string {
  const items = node.entries.map((e) => `${quote(e.key)}: ${expr(e.value, c)}`);
  return `{ ${items.join(', ')} }`;
}

function expr(node: IRNode, c: Ctx): string {
  switch (node.kind) {
    case 'Number':
      return String(node.value);
    case 'String':
      return quote(node.value);
    case 'Boolean':
      return bool(node.value, c);
    case 'Null':
      return c.lang === 'js' ? 'null' : 'None';
    case 'VarRef':
      return node.name;
    case 'List':
      return `[${node.items.map((i) => expr(i, c)).join(', ')}]`;
    case 'ListIndex':
      return `${expr(node.list, c)}[${expr(node.index, c)}]`;
    case 'ListSlice':
      return sliceExpr(node, c);
    case 'Dict':
      return dictExpr(node, c);
    case 'BinaryOp':
      return binaryExpr(node, c);
    case 'UnaryOp':
      return unaryExpr(node, c);
    case 'Call':
      return `${node.callee}(${node.args.map((a) => expr(a, c)).join(', ')})`;
    case 'LoadCSV':
    case 'LoadXYZ':
      return `studio.load(${quote(node.path)})`;
    case 'Random':
      return `studio.random(${expr(node.count, c)}${node.seed ? `, ${expr(node.seed, c)}` : ''})`;
    case 'Range': {
      const step = node.step ? `, ${expr(node.step, c)}` : '';
      return `studio.range(${expr(node.start, c)}, ${expr(node.stop, c)}${step})`;
    }
    case 'Filter':
      return `studio.filter(${expr(node.data, c)}, ${quote(node.column)}, ${quote(node.op)}, ${expr(node.value, c)})`;
    case 'Normalize':
      return `studio.normalize(${expr(node.data, c)}, ${quote(node.column)}, ${quote(node.mode)})`;
    case 'Sort':
      return `studio.sort(${expr(node.data, c)}, ${quote(node.column)}, ${quote(node.direction)})`;
    case 'Select':
      return `studio.select(${expr(node.data, c)}, [${node.columns.map(quote).join(', ')}])`;
    case 'AddColumn':
      return `studio.addColumn(${expr(node.data, c)}, ${quote(node.name)}, ${expr(node.values, c)})`;
    case 'Summary':
      return `studio.summary(${expr(node.data, c)}, ${quote(node.column)})`;
    case 'Histogram':
      return `studio.histogram(${expr(node.data, c)}, ${quote(node.column)}, ${expr(node.bins, c)})`;
    case 'GpuRun':
      return `studio.gpu.run(${quote(node.kernel)}, [${node.args.map((a) => expr(a, c)).join(', ')}])`;
    case 'StudioCall':
      return `studio.${node.method}(${node.args.map((a) => expr(a, c)).join(', ')})`;
    case 'RawCode':
      return node.text;
    default:
      throw new Error(`node kind "${(node as IRNode).kind}" is not an expression`);
  }
}

// ---- statements ----

function terminator(c: Ctx): string {
  return c.lang === 'js' ? ';' : '';
}

function block(lines: string[]): string {
  return lines.join('\n');
}

function ifStmt(node: Extract<IRNode, { kind: 'If' }>, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  const lines: string[] = [];
  node.branches.forEach((b, i) => {
    const keyword = i === 0 ? 'if' : c.lang === 'js' ? 'else if' : 'elif';
    const cond = c.lang === 'js' ? `(${expr(b.cond, c)})` : expr(b.cond, c);
    lines.push(`${ind}${keyword} ${cond}${c.lang === 'js' ? ' {' : ':'}`);
    b.body.forEach((s) => lines.push(stmt(s, c, level + 1)));
    if (c.lang === 'js') lines.push(`${ind}}`);
  });
  if (node.elseBody && node.elseBody.length > 0) {
    lines.push(`${ind}${c.lang === 'js' ? 'else {' : 'else:'}`);
    node.elseBody.forEach((s) => lines.push(stmt(s, c, level + 1)));
    if (c.lang === 'js') lines.push(`${ind}}`);
  }
  return block(lines);
}

function repeatStmt(node: Extract<IRNode, { kind: 'Repeat' }>, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  const lines: string[] = [];
  if (c.lang === 'js') {
    lines.push(`${ind}for (let __i = 0; __i < ${expr(node.count, c)}; __i++) {`);
  } else {
    lines.push(`${ind}for __i in range(int(${expr(node.count, c)})):`);
  }
  node.body.forEach((s) => lines.push(stmt(s, c, level + 1)));
  if (c.lang === 'js') lines.push(`${ind}}`);
  return block(lines);
}

function whileStmt(node: Extract<IRNode, { kind: 'While' }>, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  const cond = c.lang === 'js' ? `(${expr(node.cond, c)})` : expr(node.cond, c);
  const lines: string[] = [`${ind}while ${cond}${c.lang === 'js' ? ' {' : ':'}`];
  node.body.forEach((s) => lines.push(stmt(s, c, level + 1)));
  if (c.lang === 'js') lines.push(`${ind}}`);
  return block(lines);
}

function forEachStmt(node: Extract<IRNode, { kind: 'ForEach' }>, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  const lines: string[] = [];
  if (c.lang === 'js') {
    lines.push(`${ind}for (const ${node.varName} of ${expr(node.iterable, c)}) {`);
  } else {
    lines.push(`${ind}for ${node.varName} in ${expr(node.iterable, c)}:`);
  }
  node.body.forEach((s) => lines.push(stmt(s, c, level + 1)));
  if (c.lang === 'js') lines.push(`${ind}}`);
  return block(lines);
}

function funcStmt(node: Extract<IRNode, { kind: 'FuncDef' }>, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  const params = node.params.join(', ');
  const lines: string[] = [];
  if (c.lang === 'js') {
    lines.push(`${ind}function ${node.name}(${params}) {`);
  } else {
    lines.push(`${ind}def ${node.name}(${params}):`);
  }
  node.body.forEach((s) => lines.push(stmt(s, c, level + 1)));
  if (c.lang === 'js') lines.push(`${ind}}`);
  return block(lines);
}

function rawStmt(node: Extract<IRNode, { kind: 'RawCode' }>, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  // Emit the raw text verbatim, prefixed by an indentation and (for a
  // foreign language) a note so the user knows it must be ported.
  const note = node.lang === c.lang ? '' : `# [${node.lang}]\n`;
  return note + node.text
    .split('\n')
    .map((l) => ind + l)
    .join('\n');
}

function stmt(node: IRNode, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  switch (node.kind) {
    case 'VarAssign':
      return `${ind}${c.lang === 'js' && node.declare ? 'let ' : ''}${node.name} = ${expr(node.value, c)}${terminator(c)}`;
    case 'PlotScatter': {
      const color = node.color ? `, color: ${quote(node.color)}` : '';
      return `${ind}studio.plot('scatter', ${expr(node.data, c)}, { x: ${quote(node.x)}, y: ${quote(node.y)}${color} })${terminator(c)}`;
    }
    case 'PlotLine':
      return `${ind}studio.plot('line', ${expr(node.data, c)}, { x: ${quote(node.x)}, y: ${quote(node.y)} })${terminator(c)}`;
    case 'PlotHistogram':
      return `${ind}studio.plot('histogram', ${expr(node.data, c)}, { column: ${quote(node.column)} })${terminator(c)}`;
    case 'PlotPointCloud':
      return `${ind}studio.plot('pointcloud', ${expr(node.data, c)}, { x: ${quote(node.x)}, y: ${quote(node.y)}, z: ${quote(node.z)} })${terminator(c)}`;
    case 'If':
      return ifStmt(node, c, level);
    case 'Repeat':
      return repeatStmt(node, c, level);
    case 'While':
      return whileStmt(node, c, level);
    case 'ForEach':
      return forEachStmt(node, c, level);
    case 'Break':
      return `${ind}break${terminator(c)}`;
    case 'Continue':
      return `${ind}continue${terminator(c)}`;
    case 'FuncDef':
      return funcStmt(node, c, level);
    case 'Return':
      return `${ind}return${node.value ? ` ${expr(node.value, c)}` : ''}${terminator(c)}`;
    case 'RawCode':
      return rawStmt(node, c, level);
    case 'Call':
      return `${ind}${node.callee}(${node.args.map((a) => expr(a, c)).join(', ')})${terminator(c)}`;
    default:
      // A bare expression statement — evaluate for side effects.
      return `${ind}${expr(node, c)}${terminator(c)}`;
  }
}

/** Render an IR program as JS or Python source text. */
export function generate(program: IRProgram, lang: CodegenLang): string {
  const c: Ctx = { lang, indentUnit: lang === 'js' ? '  ' : '    ' };
  const parts: string[] = [];
  if (program.functions.length > 0) {
    for (const f of program.functions) parts.push(stmt(f, c, 0));
    if (program.body.length > 0) parts.push('');
  }
  for (const node of program.body) parts.push(stmt(node, c, 0));
  return parts.join('\n');
}
