// ==========================================================================
// Ergalics Studio — IR → code generator (shared core)
//
// Pure, side-effect-free walker that renders an IRProgram as JavaScript or
// Python text. Both dialects emit `studio.*` calls that mirror the IR
// transform/stat nodes exactly, so the generated text and the IR interpreter
// (runtime/interpreter.ts) agree on semantics (editor architecture §3.1 #2).
// ==========================================================================

import type { BinaryOperator, IRNode, IRProgram } from '../ir/types';

export type CodegenLang = 'js' | 'python' | 'r';

interface Ctx {
  lang: CodegenLang;
  indentUnit: string;
  /** Variable names already `let`-declared in the current function scope. */
  declared: Set<string>;
  /** Whether we are inside a FuncDef body (top-level `return` is a syntax error). */
  inFunction: boolean;
}

function quote(s: string): string {
  // R and Python use single quotes; we quote with single quotes for all
  // targets and escape embedded single quotes.
  return `'${s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t')}'`;
}

function bool(value: boolean, c: Ctx): string {
  if (c.lang === 'js') return String(value);
  if (c.lang === 'r') return value ? 'TRUE' : 'FALSE';
  return value ? 'True' : 'False';
}

function binop(op: BinaryOperator, c: Ctx): string {
  // R has no `and`/`or` keywords (they would be a parse error) — it uses the
  // scalar `&&`/`||` operators like JS. Modulo in R is `%%`, not `%`.
  if (op === 'and') return c.lang === 'python' ? 'and' : '&&';
  if (op === 'or') return c.lang === 'python' ? 'or' : '||';
  if (op === '%' && c.lang === 'r') return '%%';
  return op;
}

function binaryExpr(node: Extract<IRNode, { kind: 'BinaryOp' }>, c: Ctx): string {
  const left = expr(node.left, c);
  const right = expr(node.right, c);
  // Integer division has no infix form in JS or R.
  if (node.op === '//') {
    if (c.lang === 'js') return `Math.floor(${left} / ${right})`;
    if (c.lang === 'r') return `floor(${left} / ${right})`;
  }
  return `(${left} ${binop(node.op, c)} ${right})`;
}

function unaryExpr(node: Extract<IRNode, { kind: 'UnaryOp' }>, c: Ctx): string {
  // Python spells logical negation `not`; JS and R both use `!`.
  if (node.op === 'not') {
    return c.lang === 'python'
      ? `not ${expr(node.operand, c)}`
      : `!(${expr(node.operand, c)})`;
  }
  // Parenthesize so a negative literal operand (`-(-5)`) never renders as
  // `--5`, which is a decrement syntax error in JS.
  return `-(${expr(node.operand, c)})`;
}

function sliceExpr(node: Extract<IRNode, { kind: 'ListSlice' }>, c: Ctx): string {
  const list = expr(node.list, c);
  if (c.lang === 'python') {
    const start = node.start ? expr(node.start, c) : '';
    const stop = node.stop ? expr(node.stop, c) : '';
    const step = node.step ? expr(node.step, c) : '';
    return `${list}[${start}:${stop}${step ? `:${step}` : ''}]`;
  }
  // R has no Python-style half-open/strided slicing. Render through a DSL
  // helper (0-based, half-open semantics identical to Python) instead of
  // base R's inclusive `:` operator, which the parser maps back to ListSlice.
  if (c.lang === 'r') {
    const start = node.start ? expr(node.start, c) : 'NULL';
    const stop = node.stop ? expr(node.stop, c) : 'NULL';
    const step = node.step ? `, ${expr(node.step, c)}` : '';
    return `studio.sliceList(${list}, ${start}, ${stop}${step})`;
  }
  if (!node.step) {
    const start = node.start ? expr(node.start, c) : '0';
    const stop = node.stop ? expr(node.stop, c) : 'undefined';
    return `${list}.slice(${start}, ${stop})`;
  }
  // JS has no slice-step; emit a small inline emulation of Python slice
  // semantics so the generated code matches the interpreter and the Python
  // codegen instead of silently dropping the step (old behaviour). Omitted
  // bounds get Python's sign-dependent defaults — including the `-1` stop
  // sentinel for a negative step, which must NOT be clamped — while explicit
  // bounds are clamped against the list length exactly like Python's
  // `slice.indices`.
  const step = expr(node.step, c);
  const startRaw = node.start ? expr(node.start, c) : null;
  const stopRaw = node.stop ? expr(node.stop, c) : null;
  return `(function(l){const k=${step};const s=${startRaw ?? `(k < 0 ? l.length - 1 : 0)`};const e=${stopRaw ?? `(k < 0 ? -1 : l.length)`};if(k===0)throw new Error('slice step cannot be zero');const o=[];let i=${startRaw ? '(s < 0 ? Math.max(l.length + s, -1) : Math.min(s, l.length))' : 's'};const stop=${stopRaw ? '(e < 0 ? Math.max(l.length + e, -1) : Math.min(e, l.length))' : 'e'};for(;k>0?i<stop:i>stop;i+=k){if(i>=0&&i<l.length)o.push(l[i]);}return o;})(${list})`;
}

function dictExpr(node: Extract<IRNode, { kind: 'Dict' }>, c: Ctx): string {
  if (c.lang === 'r') {
    // `{ 'k': v }` is not an R literal (a bare `{ ... }` is a block). A named
    // list is R's idiomatic ordered mapping; quoted tags are legal call syntax.
    const items = node.entries.map((e) => `${quote(e.key)} = ${expr(e.value, c)}`);
    return `list(${items.join(', ')})`;
  }
  const items = node.entries.map((e) => {
    const key = /^[A-Za-z_$][\w$]*$/.test(e.key) ? e.key : quote(e.key);
    return `${key}: ${expr(e.value, c)}`;
  });
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
      // R has no `None`; its null object is `NULL`.
      return c.lang === 'js' ? 'null' : c.lang === 'r' ? 'NULL' : 'None';
    case 'VarRef':
      return node.name;
    case 'List': {
      // `[a, b]` is a parse error in R — the vector/list constructor is `list`.
      const items = node.items.map((i) => expr(i, c)).join(', ');
      return c.lang === 'r' ? `list(${items})` : `[${items}]`;
    }
    case 'ListIndex': {
      // R subscripts start at 1, so a numeric index needs the +1 offset. A
      // string index is a name lookup and must be left alone.
      const list = expr(node.list, c);
      const idx = expr(node.index, c);
      if (c.lang === 'r' && node.index.kind === 'Number') return `${list}[[${idx} + 1]]`;
      return `${list}[${c.lang === 'r' ? `[${idx}]` : idx}]`;
    }
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
    case 'Select': {
      // R has no `[...]` literal — wrap columns in `list(...)` so the output
      // is valid R and round-trips through the parser.
      const cols = node.columns.map(quote).join(', ');
      const wrapped = c.lang === 'r' ? `list(${cols})` : `[${cols}]`;
      return `studio.select(${expr(node.data, c)}, ${wrapped})`;
    }
    case 'AddColumn':
      return `studio.addColumn(${expr(node.data, c)}, ${quote(node.name)}, ${expr(node.values, c)})`;
    case 'Summary':
      return `studio.summary(${expr(node.data, c)}, ${quote(node.column)})`;
    case 'Histogram':
      return `studio.histogram(${expr(node.data, c)}, ${quote(node.column)}, ${expr(node.bins, c)})`;
    case 'GpuRun':
      // There is no `studio.gpu.run` API in any runtime, so emitting one would
      // fail at run time with a confusing "studio.gpu is not defined". Surface
      // the limitation at generation time instead (the interpreter already
      // rejects GpuRun, and the block converter degrades it to raw code).
      throw new Error('GpuRun nodes cannot be generated — GPU kernels are not supported by the studio runtime');
    case 'StudioCall':
      return `studio.${node.method}(${node.args.map((a) => expr(a, c)).join(', ')})`;
    case 'RawCode':
      return node.text;
    case 'RawExpr':
      return node.text;
    default:
      throw new Error(`node kind "${(node as IRNode).kind}" is not an expression`);
  }
}

// ---- statements ----

function terminator(c: Ctx): string {
  // R and Python are newline-terminated; only JS needs a semicolon.
  return c.lang === 'js' ? ';' : '';
}

function block(lines: string[]): string {
  return lines.join('\n');
}

function ifStmt(node: Extract<IRNode, { kind: 'If' }>, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  const usesBraces = c.lang !== 'python';
  // R's parser rejects an `else` that starts a new line right after a closing
  // `}` ("unexpected else"), so R chains must render `} else {` on one line.
  const inlineElse = c.lang === 'r';
  const lines: string[] = [];
  node.branches.forEach((b, i) => {
    const keyword = i === 0 ? 'if' : usesBraces ? 'else if' : 'elif';
    const cond = usesBraces ? `(${expr(b.cond, c)})` : expr(b.cond, c);
    if (i === 0) {
      lines.push(`${ind}${keyword} ${cond}${usesBraces ? ' {' : ':'}`);
    } else if (inlineElse) {
      // The previous branch already pushed its closing brace as the last line.
      lines[lines.length - 1] = `${lines[lines.length - 1]} ${keyword} ${cond} {`;
    } else {
      lines.push(`${ind}${keyword} ${cond}${usesBraces ? ' {' : ':'}`);
    }
    b.body.forEach((s) => lines.push(stmt(s, c, level + 1)));
    if (usesBraces) lines.push(`${ind}}`);
  });
  if (node.elseBody && node.elseBody.length > 0) {
    if (inlineElse) lines[lines.length - 1] = `${lines[lines.length - 1]} else {`;
    else lines.push(`${ind}${usesBraces ? 'else {' : 'else:'}`);
    node.elseBody.forEach((s) => lines.push(stmt(s, c, level + 1)));
    if (usesBraces) lines.push(`${ind}}`);
  }
  return block(lines);
}

function repeatStmt(node: Extract<IRNode, { kind: 'Repeat' }>, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  const lines: string[] = [];
  if (c.lang === 'js') {
    // Floor the count so a fractional value iterates the same as Python's
    // `range(int(n))` (a fractional `n` would otherwise run ceil iterations).
    lines.push(`${ind}for (let __i = 0; __i < Math.floor(${expr(node.count, c)}); __i++) {`);
  } else if (c.lang === 'r') {
    // R has no C-style `for`; it iterates over a sequence. `max(..., na.rm=TRUE)`
    // mirrors the JS/Python behaviour of running zero times for a NaN/NA count.
    lines.push(`${ind}for (__i in seq_len(max(0, floor(${expr(node.count, c)}), na.rm = TRUE))) {`);
  } else {
    lines.push(`${ind}for __i in range(int(${expr(node.count, c)})):`);
  }
  node.body.forEach((s) => lines.push(stmt(s, c, level + 1)));
  if (c.lang !== 'python') lines.push(`${ind}}`);
  return block(lines);
}

function whileStmt(node: Extract<IRNode, { kind: 'While' }>, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  const usesBraces = c.lang !== 'python';
  const cond = usesBraces ? `(${expr(node.cond, c)})` : expr(node.cond, c);
  const lines: string[] = [`${ind}while ${cond}${usesBraces ? ' {' : ':'}`];
  node.body.forEach((s) => lines.push(stmt(s, c, level + 1)));
  if (usesBraces) lines.push(`${ind}}`);
  return block(lines);
}

function forEachStmt(node: Extract<IRNode, { kind: 'ForEach' }>, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  const lines: string[] = [];
  if (c.lang === 'js') {
    // `let`, not `const`: the interpreter re-binds the loop variable on every
    // iteration, so a body that reassigns it must not become a TypeError.
    lines.push(`${ind}for (let ${node.varName} of ${expr(node.iterable, c)}) {`);
  } else if (c.lang === 'r') {
    // R's `for … in …` is the direct analogue; there is no `of` keyword.
    lines.push(`${ind}for (${node.varName} in ${expr(node.iterable, c)}) {`);
  } else {
    lines.push(`${ind}for ${node.varName} in ${expr(node.iterable, c)}:`);
  }
  node.body.forEach((s) => lines.push(stmt(s, c, level + 1)));
  if (c.lang !== 'python') lines.push(`${ind}}`);
  return block(lines);
}

function funcStmt(node: Extract<IRNode, { kind: 'FuncDef' }>, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  const params = node.params.join(', ');
  const lines: string[] = [];
  if (c.lang === 'js') {
    lines.push(`${ind}function ${node.name}(${params}) {`);
  } else if (c.lang === 'r') {
    lines.push(`${ind}${node.name} <- function(${params}) {`);
  } else {
    lines.push(`${ind}def ${node.name}(${params}):`);
  }
  // Function bodies are a fresh declaration scope with top-level-return legal.
  const fc: Ctx = { ...c, declared: new Set(), inFunction: true };
  node.body.forEach((s) => lines.push(stmt(s, fc, level + 1)));
  if (c.lang !== 'python') lines.push(`${ind}}`);
  return block(lines);
}

function rawStmt(node: Extract<IRNode, { kind: 'RawCode' }>, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  // Emit the raw text verbatim, prefixed by an indentation and (for a
  // foreign language) a note so the user knows it must be ported. The note
  // must use the *target* dialect's comment syntax.
  const comment = c.lang === 'r' ? '#' : c.lang === 'js' ? '//' : '#';
  const note = node.lang === c.lang ? '' : `${comment} [${node.lang}]\n`;
  return note + node.text
    .split('\n')
    .map((l) => ind + l)
    .join('\n');
}

function stmt(node: IRNode, c: Ctx, level: number): string {
  const ind = c.indentUnit.repeat(level);
  switch (node.kind) {
    case 'VarAssign': {
      // A `declare` VarAssign emits `let` only the first time it appears in a
      // function scope; a second `let x` in the same scope is a SyntaxError.
      const needsDecl = node.declare && c.lang === 'js' && !c.declared.has(node.name);
      if (needsDecl) c.declared.add(node.name);
      const assignOp = c.lang === 'r' ? ' <- ' : ' = ';
      const prefix = needsDecl ? 'let ' : '';
      return `${ind}${prefix}${node.name}${assignOp}${expr(node.value, c)}${terminator(c)}`;
    }
    case 'PlotScatter': {
      const entries = [
        { key: 'x', value: { kind: 'String', value: node.x } as IRNode },
        { key: 'y', value: { kind: 'String', value: node.y } as IRNode },
        ...(node.color ? [{ key: 'color', value: { kind: 'String', value: node.color } as IRNode }] : []),
      ];
      const opts = dictExpr({ kind: 'Dict', entries }, c);
      return `${ind}studio.plot('scatter', ${expr(node.data, c)}, ${opts})${terminator(c)}`;
    }
    case 'PlotLine': {
      const opts = dictExpr({
        kind: 'Dict',
        entries: [
          { key: 'x', value: { kind: 'String', value: node.x } as IRNode },
          { key: 'y', value: { kind: 'String', value: node.y } as IRNode },
        ],
      }, c);
      return `${ind}studio.plot('line', ${expr(node.data, c)}, ${opts})${terminator(c)}`;
    }
    case 'PlotHistogram': {
      const opts = dictExpr({
        kind: 'Dict',
        entries: [{ key: 'column', value: { kind: 'String', value: node.column } as IRNode }],
      }, c);
      return `${ind}studio.plot('histogram', ${expr(node.data, c)}, ${opts})${terminator(c)}`;
    }
    case 'PlotPointCloud': {
      const opts = dictExpr({
        kind: 'Dict',
        entries: [
          { key: 'x', value: { kind: 'String', value: node.x } as IRNode },
          { key: 'y', value: { kind: 'String', value: node.y } as IRNode },
          { key: 'z', value: { kind: 'String', value: node.z } as IRNode },
        ],
      }, c);
      return `${ind}studio.plot('pointcloud', ${expr(node.data, c)}, ${opts})${terminator(c)}`;
    }
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
      // R's loop-control keywords are `break` / `next` — `continue` does not
      // exist and would fail at run time as an undefined symbol.
      return `${ind}${c.lang === 'r' ? 'next' : 'continue'}${terminator(c)}`;
    case 'FuncDef':
      return funcStmt(node, c, level);
    case 'Return':
      // A `return` at the top level is a syntax error in both JS and Python;
      // evaluate the value for its side effects instead.
      if (!c.inFunction) {
        if (c.lang === 'js') return `${ind}${node.value ? expr(node.value, c) : ''};`;
        // Python needs `pass` where R wants its null object.
        return `${ind}${node.value ? expr(node.value, c) : c.lang === 'r' ? 'NULL' : 'pass'}`;
      }
      // R's `return` is a function, so `return x` is a syntax error there.
      if (c.lang === 'r') {
        return `${ind}return(${node.value ? expr(node.value, c) : 'NULL'})`;
      }
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
  const c: Ctx = { lang, indentUnit: lang === 'js' ? '  ' : '    ', declared: new Set(), inFunction: false };
  const parts: string[] = [];
  if (program.functions.length > 0) {
    // Emit each function once — a duplicated FuncDef would define the same
    // symbol twice (a redeclaration error in strict JS).
    const seen = new Set<string>();
    for (const f of program.functions) {
      if (f.kind !== 'FuncDef' || seen.has(f.name)) continue;
      seen.add(f.name);
      parts.push(stmt(f, c, 0));
    }
    if (program.body.length > 0) parts.push('');
  }
  for (const node of program.body) parts.push(stmt(node, c, 0));
  return parts.join('\n');
}
