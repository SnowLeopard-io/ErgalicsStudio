// ==========================================================================
// Ergalics Studio — 程式碼 2 IR 解析器（codegen 的反向轉換）
//
// 將我們自己的 codegen 所產出的 `studio.*` DSL 解析回共享的 IR。這是讓
// 程式碼模式能饋入區塊／流程模式的關鍵一環：在程式碼模式編輯 Python/R/JS
// 後切換到區塊模式時，會依據此次解析重建區塊圖，而非直接沿用原始文字。
//
// 與早期「逐列比對」版本不同，本解析器具備：
//   • 縮排（Python）／括號（JS、R）感知的多行區塊解析：if / elif / else、
//     for / while、函式定義都能完整往返，不再把每一行各自降級為 RawCode；
//   • 共用的運算式遞降解析器（算式、比較、邏輯、not、清單、呼叫）；
//   • 三語言法術差異：JS 的 `let`、R 的 `<-`/`->`、`TRUE/FALSE/NULL`、
//     `%%`/`%/%`/`^`、`list()/c()`、`next` 等。
// 任何無法辨識的結構仍以 RawCode 原樣保留（含整個無法解析的區塊），確保
// 往返過程中不遺失使用者程式碼。
// ==========================================================================

import type {
  IRNode,
  IRProgram,
  SourceLang,
  BinaryOperator,
  NormalizeMode,
} from '@/editor/ir/types';
import { makeProgram } from '@/editor/ir/types';

interface ParseResult {
  program: IRProgram;
  /** 退回到 RawCode 的陳述（或區塊）數量。 */
  rawCount: number;
}

// --------------------------------------------------------------------------
// Tokenizer
// --------------------------------------------------------------------------

type Token =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'punc'; v: string };

const MULTI_OPS = ['**', '//', '==', '!=', '<=', '>=', '&&', '||', '<-', '->', '%%', '%/%'];

function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i]!;
    if (ch === ' ' || ch === '\t') { i += 1; continue; }
    // number
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < n && /[0-9._eE]/.test(src[j]!)) {
        // scientific notation sign: 1e-3 / 1E+2
        if ((src[j] === 'e' || src[j] === 'E') && (src[j + 1] === '+' || src[j + 1] === '-') && /[0-9]/.test(src[j + 2] ?? '')) j += 2;
        else j += 1;
      }
      const raw = src.slice(i, j);
      const v = Number(raw.replace(/_/g, ''));
      toks.push({ t: 'num', v: Number.isFinite(v) ? v : 0 });
      i = j;
      continue;
    }
    // string
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let out = '';
      while (j < n && src[j] !== quote) {
        if (src[j] === '\\' && j + 1 < n) {
          const e = src[j + 1]!;
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
          j += 2;
        } else {
          out += src[j];
          j += 1;
        }
      }
      toks.push({ t: 'str', v: out });
      i = j + 1;
      continue;
    }
    // identifier (`.` kept so `studio.load` / `Math.floor` lex as one name)
    if (/[A-Za-z_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\w.$]/.test(src[j]!)) j += 1;
      toks.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const three = MULTI_OPS.find((op) => op.length === 3 && src.startsWith(op, i));
    if (three) { toks.push({ t: 'op', v: three }); i += 3; continue; }
    const pair = MULTI_OPS.find((op) => op.length === 2 && src.startsWith(op, i));
    if (pair) { toks.push({ t: 'op', v: pair }); i += 2; continue; }
    if ('()[]{},;:'.includes(ch)) { toks.push({ t: 'punc', v: ch }); i += 1; continue; }
    toks.push({ t: 'op', v: ch });
    i += 1;
  }
  return toks;
}

// --------------------------------------------------------------------------
// Expression parser (Pratt)
// --------------------------------------------------------------------------

class ExprParser {
  private pos = 0;
  constructor(private readonly toks: Token[], private readonly lang: SourceLang) {}

  parse(): IRNode | null {
    if (this.toks.length === 0) return null;
    const node = this.expression(0);
    if (node === null) return null;
    return this.pos === this.toks.length ? node : null;
  }

  private peek(): Token | undefined { return this.toks[this.pos]; }
  private next(): Token | undefined { return this.toks[this.pos++]; }

  private expression(minPrec: number): IRNode | null {
    let left: IRNode | null = this.unary();
    if (left === null) return null;
    for (;;) {
      const t = this.peek();
      if (!t) break;
      // `and` / `or` are keyword identifiers in Python (R uses && / ||).
      const op = t.t === 'op' ? this.mapOp(t.v)
        : t.t === 'id' && (t.v === 'and' || t.v === 'or') ? t.v as BinaryOperator
        : null;
      if (!op) {
        // postfix call / index
        if (t.t === 'punc' && (t.v === '(' || t.v === '[')) {
          const after: IRNode | null = t.v === '(' ? this.callAfter(left) : this.indexAfter(left);
          if (after === null) return null;
          left = after;
          continue;
        }
        break;
      }
      const prec = BIN_PREC[op];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.expression(prec + 1); // left-assoc; power handled below
      if (right === null) return null;
      left = { kind: 'BinaryOp', op, left, right };
    }
    return left;
  }

  private mapOp(raw: string): BinaryOperator | null {
    switch (raw) {
      case '+': case '-': case '*': case '/': case '//': case '%':
      case '**': case '==': case '!=': case '<': case '<=': case '>': case '>=':
        return raw;
      case 'and': return 'and';
      case 'or': return 'or';
      case '&&': return 'and';
      case '||': return 'or';
      case '%%': return '%';
      case '%/%': return '//';
      case '^': return '**';
      default: return null;
    }
  }

  private unary(): IRNode | null {
    const t = this.peek();
    if (t?.t === 'op' && (t.v === '-' || t.v === '!')) {
      this.next();
      const operand = this.expression(100);
      if (operand === null) return null;
      return { kind: 'UnaryOp', op: t.v === '!' ? 'not' : '-', operand };
    }
    if (t?.t === 'id' && t.v === 'not') {
      this.next();
      const operand = this.expression(100);
      if (operand === null) return null;
      return { kind: 'UnaryOp', op: 'not', operand };
    }
    return this.primary();
  }

  private primary(): IRNode | null {
    const t = this.next();
    if (!t) return null;
    if (t.t === 'num') return { kind: 'Number', value: t.v };
    if (t.t === 'str') return { kind: 'String', value: t.v };
    if (t.t === 'id') {
      if (t.v === 'True' || t.v === 'TRUE' || t.v === 'true') return { kind: 'Boolean', value: true };
      if (t.v === 'False' || t.v === 'FALSE' || t.v === 'false') return { kind: 'Boolean', value: false };
      if (t.v === 'None' || t.v === 'NULL' || t.v === 'null') return { kind: 'Null' };
      // `studio.<method>(...)` lexes as one dotted identifier; dispatch DSL
      // calls to the IR mapping and keep the rest as generic VarRefs.
      if (t.v.startsWith('studio.')) {
        const method = t.v.slice('studio.'.length);
        if (this.peek()?.t === 'punc' && this.peek()?.v === '(') {
          return this.studioCall(method);
        }
        return { kind: 'VarRef', name: t.v };
      }
      // function call
      if (this.peek()?.t === 'punc' && this.peek()?.v === '(') {
        return this.namedCall(t.v);
      }
      return { kind: 'VarRef', name: t.v };
    }
    if (t.t === 'punc') {
      if (t.v === '(') {
        const inner = this.expression(0);
        if (inner === null || !this.eatPunc(')')) return null;
        return inner;
      }
      if (t.v === '[') return this.listLit();
      if (t.v === '{') return this.dictLit();
      if (t.v === '-') { /* stray minus */ }
    }
    return null;
  }

  private eatPunc(v: string): boolean {
    const t = this.peek();
    if (t?.t === 'punc' && t.v === v) { this.next(); return true; }
    return false;
  }

  /** `[a, b, c]` and Python slices `[a:b:c]` are distinguished by the callee. */
  private listLit(): IRNode | null {
    const items: IRNode[] = [];
    if (this.eatPunc(']')) return { kind: 'List', items };
    for (;;) {
      const e = this.expression(0);
      if (e === null) return null;
      items.push(e);
      if (this.eatPunc(',')) continue;
      break;
    }
    if (!this.eatPunc(']')) return null;
    return { kind: 'List', items };
  }

  private dictLit(): IRNode | null {
    const entries: { key: string; value: IRNode }[] = [];
    if (this.eatPunc('}')) return { kind: 'Dict', entries };
    for (;;) {
      const keyTok = this.next();
      let key = '';
      if (keyTok?.t === 'str') key = keyTok.v;
      else if (keyTok?.t === 'id') key = keyTok.v;
      else return null;
      const colon = this.peek();
      if (colon?.t !== 'punc' || colon.v !== ':') return null;
      this.next();
      const v = this.expression(0);
      if (v === null) return null;
      entries.push({ key, value: v });
      if (this.eatPunc(',')) continue;
      break;
    }
    if (!this.eatPunc('}')) return null;
    return { kind: 'Dict', entries };
  }

  /** Indexing `a[i]` / R double subscript `a[[i]]` and Python slices `a[i:j:k]`. */
  private indexAfter(obj: IRNode): IRNode | null {
    const start = this.pos; // points at `[`
    const double = this.toks[start + 1]?.t === 'punc' && this.toks[start + 1]?.v === '[';
    // Detect a colon at bracket depth 0 → slice, and find the matching close.
    let depth = 0;
    let colonAt = -1;
    let colonAt2 = -1;
    let closeAt = -1;
    for (let k = start; k < this.toks.length; k += 1) {
      const tk = this.toks[k]!;
      if (tk.t === 'punc' && (tk.v === '[' || tk.v === '(' || tk.v === '{')) depth += 1;
      else if (tk.t === 'punc' && (tk.v === ']' || tk.v === ')' || tk.v === '}')) {
        depth -= 1;
        if (depth === 0 && tk.v === ']') { closeAt = k; break; }
      } else if (!double && tk.t === 'punc' && tk.v === ':' && depth === 1) {
        if (colonAt < 0) colonAt = k;
        else if (colonAt2 < 0) colonAt2 = k;
      }
    }
    if (closeAt < 0) return null;
    if (colonAt >= 0) {
      const node = this.sliceAfter(obj, start, closeAt, colonAt, colonAt2);
      if (node) return node;
    }
    // Plain index. R renders numeric indices as `[[i + 1]]`; the double
    // brackets are syntax, not an expression — skip both of them.
    const innerStart = double ? start + 2 : start + 1;
    const innerEnd = double ? closeAt - 1 : closeAt;
    this.pos = innerStart;
    const idx = this.expression(0);
    if (idx === null || this.pos !== innerEnd) return null;
    this.pos = closeAt + 1;
    // Undo R's 1-based offset: `lst[[i + 1]]` is the same index as `lst[i]`.
    return { kind: 'ListIndex', list: obj, index: unwrapRBase1(idx, this.lang) };
  }

  private sliceAfter(obj: IRNode, start: number, close: number, c1: number, c2: number): IRNode | null {
    const part = (a: number, b: number): IRNode | undefined => {
      if (b - a <= 0) return undefined;
      const sub = new ExprParser(this.toks.slice(a, b), this.lang).expression(0);
      return sub ? unwrapRBase1(sub, this.lang) : undefined;
    };
    // `start + 1` skips the opening bracket itself.
    const stopStart = c1 + 1;
    const stopEnd = c2 >= 0 ? c2 : close;
    const startNode = part(start + 1, c1);
    const stopNode = part(stopStart, stopEnd);
    const stepNode = c2 >= 0 ? part(c2 + 1, close) : undefined;
    const node: IRNode = {
      kind: 'ListSlice',
      list: obj,
      ...(startNode ? { start: startNode } : {}),
      ...(stopNode ? { stop: stopNode } : {}),
      ...(stepNode ? { step: stepNode } : {}),
    };
    this.pos = close + 1;
    return node;
  }

  private callAfter(callee: IRNode): IRNode | null {
    // Only VarRef / member refs are callable.
    if (callee.kind !== 'VarRef') return null;
    const args = this.argList(')');
    if (args === null) return null;
    if (callee.name === 'print') {
      return { kind: 'StudioCall', method: 'print', args };
    }
    return { kind: 'Call', callee: callee.name, args };
  }

  /** R/Python collection constructors: `list(...)` and `c(...)`.
   *  Named members (`list(x = 'a')`) become a Dict — that is how R codegen
   *  renders plot option objects. */
  private namedCall(name: string): IRNode | null {
    const lower = name.toLowerCase();
    if (lower === 'list' || lower === 'c') {
      const parsed = this.namedArgs(')');
      if (!parsed) return null;
      if (parsed.named.size > 0) {
        return { kind: 'Dict', entries: [...parsed.named.entries()].map(([key, value]) => ({ key, value })) };
      }
      return { kind: 'List', items: parsed.positional };
    }
    const args = this.argList(')');
    if (args === null) return null;
    if (name === 'print') return { kind: 'StudioCall', method: 'print', args };
    // Inverse of codegen's integer-division lowering:
    //   JS `Math.floor(a / b)` / R `floor(a / b)`  →  BinaryOp '//'
    if ((name === 'Math.floor' || (this.lang === 'r' && name === 'floor'))
      && args.length === 1 && args[0]!.kind === 'BinaryOp' && (args[0] as { op: string }).op === '/') {
      const div = args[0] as Extract<IRNode, { kind: 'BinaryOp' }>;
      return { kind: 'BinaryOp', op: '//', left: div.left, right: div.right };
    }
    // Inverse of JS `.slice(start, stop)` (method call on a bare variable).
    const sliceM = /^([A-Za-z_$][\w$.]*)\.slice$/.exec(name);
    if (sliceM && this.lang !== 'python' && args.length >= 1 && args.length <= 2) {
      const isUndef = (n: IRNode | undefined): boolean => n?.kind === 'VarRef' && n.name === 'undefined';
      return {
        kind: 'ListSlice',
        list: { kind: 'VarRef', name: sliceM[1]! },
        ...(args[0] && !isUndef(args[0]) ? { start: args[0] } : {}),
        ...(args[1] && !isUndef(args[1]) ? { stop: args[1] } : {}),
      };
    }
    return { kind: 'Call', callee: name, args };
  }

  private studioCall(method: string): IRNode | null {
    const args = this.argList(')');
    if (args === null) return null;
    return buildStudioCall(method, args) ?? { kind: 'StudioCall', method, args };
  }

  private argList(close: ')' | ']'): IRNode[] | null {
    const res = this.namedArgs(close);
    return res ? res.positional : null;
  }

  /** Parse call arguments; R named args (`f(x = 1)`) are returned separately. */
  private namedArgs(close: ')' | ']'): { positional: IRNode[]; named: Map<string, IRNode> } | null {
    const positional: IRNode[] = [];
    const named = new Map<string, IRNode>();
    const open = this.peek();
    if (open?.t !== 'punc' || (open.v !== '(' && open.v !== '[')) return null;
    this.next();
    const closePunc = close;
    if (this.eatPunc(closePunc)) return { positional, named };
    for (;;) {
      // named argument: identifier (or R's quoted tag) followed by '='
      // (but never '==' / '=>')
      const save = this.pos;
      const idTok = this.peek();
      if (idTok && (idTok.t === 'id' || idTok.t === 'str')) {
        const nextT = this.toks[this.pos + 1];
        if (nextT?.t === 'op' && nextT.v === '=') {
          this.pos += 2;
          const v = this.expression(0);
          if (v === null) return null;
          named.set(idTok.v, v);
          if (this.eatPunc(',')) continue;
          break;
        }
      }
      this.pos = save;
      const e = this.expression(0);
      if (e === null) return null;
      positional.push(e);
      if (this.eatPunc(',')) continue;
      break;
    }
    if (!this.eatPunc(closePunc)) return null;
    return { positional, named };
  }
}

const BIN_PREC: Partial<Record<BinaryOperator, number>> = {
  or: 1, and: 2,
  '==': 3, '!=': 3, '<': 3, '<=': 3, '>': 3, '>=': 3,
  '+': 4, '-': 4,
  '*': 5, '/': 5, '//': 5, '%': 5,
  '**': 6,
};

/** Parse a standalone expression (used by block argument fields too). */
export function parseExpression(text: string, lang: SourceLang = 'python'): IRNode | null {
  try {
    return new ExprParser(tokenize(text), lang).parse();
  } catch {
    return null;
  }
}

/** R 1-based offset inverse: `(x + 1)` → `x`. */
function unwrapRBase1(node: IRNode, lang: SourceLang): IRNode {
  if (lang !== 'r') return node;
  if (node.kind === 'BinaryOp' && node.op === '+' && node.right.kind === 'Number' && node.right.value === 1) {
    return node.left;
  }
  return node;
}

// --------------------------------------------------------------------------
// studio.* call → IR mapping
// --------------------------------------------------------------------------

function asString(node: IRNode | undefined): string | null {
  return node?.kind === 'String' ? node.value : null;
}
function asNumber(node: IRNode | undefined): number | null {
  return node?.kind === 'Number' ? node.value : null;
}

function buildStudioCall(methodRaw: string, args: IRNode[]): IRNode | null {
  const method = methodRaw;

  // --- data sources ---
  if (method === 'load') {
    const path = asString(args[0]);
    if (path == null) return null;
    return /\.(xyz|dat)$/i.test(path) ? { kind: 'LoadXYZ', path } : { kind: 'LoadCSV', path };
  }
  if (method === 'load_csv' || method === 'loadCSV') {
    const path = asString(args[0]);
    return path == null ? null : { kind: 'LoadCSV', path };
  }
  if (method === 'load_xyz' || method === 'loadXYZ') {
    const path = asString(args[0]);
    return path == null ? null : { kind: 'LoadXYZ', path };
  }
  if (method === 'random' || method === 'generate_random' || method === 'generateRandom') {
    const count = asNumber(args[0]);
    if (count == null) return null;
    const seed = asNumber(args[1]);
    return { kind: 'Random', count: { kind: 'Number', value: count }, ...(seed != null ? { seed: { kind: 'Number', value: seed } } : {}) };
  }
  // R-only rendering of a Python-style slice (0-based, half-open).
  if (method === 'sliceList' || method === 'slice_list') {
    const [list, start, stop, step] = args;
    if (!list) return null;
    return {
      kind: 'ListSlice',
      list,
      ...(start && start.kind !== 'Null' ? { start } : {}),
      ...(stop && stop.kind !== 'Null' ? { stop } : {}),
      ...(step && step.kind !== 'Null' ? { step } : {}),
    };
  }
  if (method === 'range') {
    const start = asNumber(args[0]);
    const stop = asNumber(args[1]);
    if (start == null || stop == null) return null;
    return {
      kind: 'Range',
      start: { kind: 'Number', value: start },
      stop: { kind: 'Number', value: stop },
      ...(args[2]?.kind === 'Number' ? { step: args[2] } : {}),
    };
  }

  // --- transforms ---
  if (method === 'filter' || method === 'filter_range' || method === 'filterRange' || method === 'filter_value' || method === 'filterValue') {
    const [data, col, op, value] = args;
    if (!data || col?.kind !== 'String' || op?.kind !== 'String' || !value) return null;
    if (!ALL_OPS.includes(op.value)) return null;
    return { kind: 'Filter', data, column: col.value, op: op.value as BinaryOperator, value };
  }
  if (method === 'select' || method === 'select_columns' || method === 'selectColumns') {
    const [data, ...rest] = args;
    if (!data) return null;
    const columns = collectStrings(rest.length === 1 ? rest[0]! : { kind: 'List', items: rest });
    if (columns.length === 0) return null;
    return { kind: 'Select', data, columns };
  }
  if (method === 'addColumn' || method === 'add_column') {
    const [data, name, values] = args;
    if (!data || name?.kind !== 'String' || !values) return null;
    return { kind: 'AddColumn', data, name: name.value, values };
  }
  if (method === 'normalize') {
    const [data, col, mode] = args;
    if (!data || col?.kind !== 'String' || mode?.kind !== 'String') return null;
    if (mode.value !== 'minmax' && mode.value !== 'zscore') return null;
    return { kind: 'Normalize', data, column: col.value, mode: mode.value as NormalizeMode };
  }
  if (method === 'sort') {
    const [data, col, dir] = args;
    if (!data || col?.kind !== 'String' || dir?.kind !== 'String') return null;
    return { kind: 'Sort', data, column: col.value, direction: dir.value === 'desc' ? 'desc' : 'asc' };
  }

  // --- statistics ---
  if (method === 'summary') {
    const [data, col] = args;
    if (!data || col?.kind !== 'String') return null;
    return { kind: 'Summary', data, column: col.value };
  }
  if (method === 'histogram') {
    const [data, col, bins] = args;
    if (!data || col?.kind !== 'String') return null;
    return { kind: 'Histogram', data, column: col.value, bins: bins ?? { kind: 'Number', value: 20 } };
  }

  // --- visualization ---
  if (method === 'plot' || method === 'scatter' || method === 'line' || method === 'plot_histogram' || method === 'plotHistogram' || method === 'point_cloud' || method === 'pointCloud') {
    let kind: string;
    let rest: IRNode[];
    if (method === 'plot') {
      kind = asString(args[0]) ?? '';
      rest = args.slice(1);
    } else {
      kind = method === 'scatter' ? 'scatter'
        : method === 'line' ? 'line'
        : method === 'plot_histogram' || method === 'plotHistogram' ? 'histogram'
        : 'pointcloud';
      rest = args;
    }
    const [data, opts] = rest;
    if (!data) return null;
    const o = opts?.kind === 'Dict' ? Object.fromEntries(opts.entries.map((e) => [e.key, e.value])) : {};
    const str = (k: string): string | undefined => {
      const v = o[k];
      return v?.kind === 'String' ? v.value : undefined;
    };
    if (kind === 'histogram') {
      const column = str('column') ?? asString(rest[1]);
      if (!column) return null;
      return { kind: 'PlotHistogram', data, column };
    }
    if (kind === 'pointcloud') {
      const x = str('x') ?? asString(rest[1]);
      const y = str('y') ?? asString(rest[2]);
      const z = str('z') ?? asString(rest[3]);
      if (!x || !y || !z) return null;
      return { kind: 'PlotPointCloud', data, x, y, z };
    }
    const x = str('x');
    const y = str('y');
    if (!x || !y) return null;
    const color = str('color');
    return { kind: kind === 'line' ? 'PlotLine' : 'PlotScatter', data, x, y, ...(kind === 'line' ? {} : color ? { color } : {}) } as IRNode;
  }

  return null;
}

const ALL_OPS: string[] = ['+', '-', '*', '/', '//', '%', '**', '==', '!=', '<', '<=', '>', '>=', 'and', 'or'];

function collectStrings(node: IRNode): string[] {
  if (node.kind === 'List') return node.items.flatMap((i) => (i.kind === 'String' ? [i.value] : []));
  if (node.kind === 'String') return [node.value];
  return [];
}

// --------------------------------------------------------------------------
// Statement parsing — Python (indentation) & JS/R (braces)
// --------------------------------------------------------------------------

interface PhysLine {
  /** Comment-stripped raw text (indentation retained for Python). */
  text: string;
  indent: number;
}

export function parseCodeToIR(source: string, lang: SourceLang = 'python'): ParseResult {
  const lines: PhysLine[] = [];
  for (const rawLine of source.split('\n')) {
    const noComment = stripComment(rawLine, lang);
    if (noComment.trim() === '') continue;
    const indent = noComment.length - noComment.trimStart().length;
    lines.push({ text: noComment, indent });
  }

  const body = lang === 'python' ? parsePyBlock(lines, { i: 0 }, -1) : parseBraceProgram(lines);
  // Hoist top-level function definitions into program.functions, mirroring
  // codegen output (functions emitted first, separately from the body).
  const functions: IRNode[] = [];
  const statements: IRNode[] = [];
  for (const node of body) {
    if (node.kind === 'FuncDef') functions.push(node);
    else statements.push(node);
  }
  const rawCount = countRaw(body);
  return { program: makeProgram(statements, functions, lang), rawCount };
}

function countRaw(nodes: IRNode[]): number {
  let n = 0;
  for (const node of nodes) {
    if (node.kind === 'RawCode') n += 1;
    // Nested statement containers (loops, FuncDef).
    if (node.kind !== 'If' && 'body' in node && Array.isArray((node as { body?: unknown }).body)) {
      n += countRaw((node as { body: IRNode[] }).body);
    }
    if (node.kind === 'If') {
      for (const b of node.branches) n += countRaw(b.body);
      if (node.elseBody) n += countRaw(node.elseBody);
    }
  }
  return n;
}

/**
 * 移除結尾的行註解（Python/R 為 `#`，JS 為 `//`）。掃描時跳過字串字面量。
 */
function stripComment(line: string, lang: SourceLang): string {
  const marker = lang === 'python' || lang === 'r' ? '#' : '//';
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (line.startsWith(marker, i)) return line.slice(0, i);
  }
  return line;
}

// ---- Python ----

interface Cursor { i: number }

function parsePyBlock(lines: PhysLine[], cur: Cursor, parentIndent: number): IRNode[] {
  const out: IRNode[] = [];
  while (cur.i < lines.length) {
    const line = lines[cur.i]!;
    if (line.indent <= parentIndent) break;
    const myIndent = line.indent;
    const stmt = parsePyStmt(lines, cur, myIndent);
    out.push(stmt);
  }
  return out;
}

function rawPy(lines: PhysLine[], cur: Cursor, indent: number, header?: string): IRNode {
  const parts: string[] = [];
  if (header !== undefined) parts.push(header.trim());
  // Consume a dangling indented block (e.g. an unrecognized compound).
  while (cur.i < lines.length && lines[cur.i]!.indent > indent) {
    parts.push(lines[cur.i]!.text.trim());
    cur.i += 1;
  }
  return { kind: 'RawCode', lang: 'python', text: parts.join('\n') };
}

function parsePyStmt(lines: PhysLine[], cur: Cursor, indent: number): IRNode {
  const line = lines[cur.i]!;
  const text = line.text.trim();
  cur.i += 1;

  // if / elif / else
  let m = /^if\s+(.+):$/.exec(text);
  if (m) {
    const cond = parseExpression(m[1]!, 'python');
    if (!cond) return rawPy(lines, cur, indent, text);
    const branches: { cond: IRNode; body: IRNode[] }[] = [{ cond, body: parsePyBlock(lines, cur, indent) }];
    let elseBody: IRNode[] | undefined;
    for (;;) {
      const next = lines[cur.i];
      if (!next || next.indent !== indent) break;
      const t = next.text.trim();
      const em = /^elif\s+(.+):$/.exec(t);
      if (em) {
        const ec = parseExpression(em[1]!, 'python');
        if (!ec) break;
        cur.i += 1;
        branches.push({ cond: ec, body: parsePyBlock(lines, cur, indent) });
        continue;
      }
      if (/^else\s*:$/.test(t)) {
        cur.i += 1;
        elseBody = parsePyBlock(lines, cur, indent);
      }
      break;
    }
    return { kind: 'If', branches, ...(elseBody ? { elseBody } : {}) };
  }

  // for VAR in ITER:  (codegen repeat: for __i in range(int(N)):)
  m = /^for\s+([A-Za-z_]\w*)\s+in\s+(.+):$/.exec(text);
  if (m) {
    const varName = m[1]!;
    const iterText = m[2]!;
    // Any `for _ in range(int(N))` / `range(N)` is a bounded repeat, no matter
    // how the loop variable is spelled (codegen uses `__i`).
    const repeatN = /^range\(\s*int\((.+)\)\s*\)$/.exec(iterText) ?? /^range\(\s*(.+)\s*\)$/.exec(iterText);
    const count = repeatN ? parseExpression(repeatN[1]!, 'python') : null;
    const iterable = count ? null : parseExpression(iterText, 'python');
    if (!count && !iterable) return rawPy(lines, cur, indent, text);
    const body = parsePyBlock(lines, cur, indent);
    if (count) return { kind: 'Repeat', count, body };
    return { kind: 'ForEach', varName, iterable: iterable!, body };
  }

  m = /^while\s+(.+):$/.exec(text);
  if (m) {
    const cond = parseExpression(m[1]!, 'python');
    if (!cond) return rawPy(lines, cur, indent, text);
    return { kind: 'While', cond, body: parsePyBlock(lines, cur, indent) };
  }

  m = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*:$/.exec(text);
  if (m) {
    const body = parsePyBlock(lines, cur, indent);
    return { kind: 'FuncDef', name: m[1]!, params: splitParams(m[2]!), body };
  }

  return parseSimple(text, 'python') ?? { kind: 'RawCode', lang: 'python', text };
}

// ---- JS / R (brace languages) ----

function parseBraceProgram(lines: PhysLine[]): IRNode[] {
  const out: IRNode[] = [];
  const cur: Cursor = { i: 0 };
  while (cur.i < lines.length) {
    out.push(parseBraceStmt(lines, cur, 'js-or-r'));
  }
  return out;
}

/** Detect the source language flavour from the lines we are about to parse. */
function detectBraceLang(lines: PhysLine[], fallback: 'js' | 'r' | 'js-or-r'): 'js' | 'r' {
  if (fallback !== 'js-or-r') return fallback;
  return lines.some((l) => /<-/.test(l.text) || /\bTRUE\b|\bFALSE\b|\bNULL\b|\bfunction\s*\(|\bnext\b/.test(l.text)) ? 'r' : 'js';
}

function parseBraceStmt(lines: PhysLine[], cur: Cursor, fb: 'js' | 'r' | 'js-or-r'): IRNode {
  const lang = detectBraceLang(lines.slice(cur.i, cur.i + 4), fb);
  const raw = lines[cur.i]!.text.trim().replace(/;+$/, '').trim();
  cur.i += 1;
  const text = raw;

  // function defs
  let m = /^function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{\s*(.*)$/.exec(text);
  if (m) return finishFunc(lines, cur, lang, m[1]!, m[2]!, m[3]!);
  m = /^([A-Za-z_][\w.]*)\s*(?:<-|=)\s*function\s*\(([^)]*)\)\s*\{\s*(.*)$/.exec(text);
  if (m) return finishFunc(lines, cur, lang, m[1]!, m[2]!, m[3]!);

  // if (COND) {
  m = /^if\s*\((.*)\)\s*\{\s*(.*)$/.exec(text);
  if (m) {
    const cond = parseExpression(m[1]!, lang);
    const first = readBraceBody(lines, cur, m[2]!);
    if (!cond) return rawBrace(text, first, lang);
    const branches: { cond: IRNode; body: IRNode[] }[] = [{ cond, body: parseBraceLines(first.body, lang) }];
    let elseBody: IRNode[] | undefined;
    // An `else` can be glued to the closing line (R style: `} else {`) or
    // start on the following physical line (JS / Python-brace style).
    let cont = continuationAfter(lines, cur, first.closeTail);
    for (;;) {
      const em = /^else\s+if\s*\((.*)\)\s*\{\s*(.*)$/.exec(cont);
      if (em) {
        const ec = parseExpression(em[1]!, lang);
        const eb = readBraceBody(lines, cur, em[2]!);
        if (!ec) { elseBody = parseBraceLines(eb.body, lang); cont = continuationAfter(lines, cur, eb.closeTail); break; }
        branches.push({ cond: ec, body: parseBraceLines(eb.body, lang) });
        cont = continuationAfter(lines, cur, eb.closeTail);
        continue;
      }
      const el = /^else\s*\{\s*(.*)$/.exec(cont);
      if (el) {
        const eb = readBraceBody(lines, cur, el[1]!);
        elseBody = parseBraceLines(eb.body, lang);
        cont = continuationAfter(lines, cur, eb.closeTail);
      }
      break;
    }
    void cont;
    return { kind: 'If', branches, ...(elseBody ? { elseBody } : {}) };
  }

  // JS repeat:  for (let __i = 0; __i < Math.floor(N); __i++) {
  m = /^for\s*\(\s*(?:let|const|var)\s+__i\s*=\s*0\s*;\s*__i\s*<\s*(?:Math\.)?floor\((.+)\)\s*;\s*__i\+\+\s*\)\s*\{\s*(.*)$/.exec(text);
  if (m) {
    const body = readBraceBody(lines, cur, m[2]!);
    const count = parseExpression(m[1]!, lang);
    if (count) return { kind: 'Repeat', count, body: parseBraceLines(body.body, lang) };
    return rawBrace(text, body, lang);
  }
  // R repeat:  for (__i in seq_len(max(0, floor(N), na.rm = TRUE))) {
  m = /^for\s*\(\s*__i\s+in\s+seq_len\(\s*max\(\s*0\s*,\s*(?:Math\.)?floor\((.+)\)\s*,?\s*na\.rm\s*=\s*TRUE\s*\)\s*\)\s*\)\s*\{\s*(.*)$/.exec(text);
  if (m) {
    const body = readBraceBody(lines, cur, m[2]!);
    const count = parseExpression(m[1]!, lang);
    if (count) return { kind: 'Repeat', count, body: parseBraceLines(body.body, lang) };
    return rawBrace(text, body, lang);
  }
  // for each: JS `for (let x of EXPR) {` / R `for (x in EXPR) {`
  m = /^for\s*\(\s*(?:(?:let|const|var)\s+)?([A-Za-z_$][\w$]*)\s+(?:of|in)\s+(.+?)\s*\)\s*\{\s*(.*)$/.exec(text);
  if (m) {
    const body = readBraceBody(lines, cur, m[3]!);
    const iterable = parseExpression(m[2]!, lang);
    if (iterable) return { kind: 'ForEach', varName: m[1]!, iterable, body: parseBraceLines(body.body, lang) };
    return rawBrace(text, body, lang);
  }

  // while (COND) {
  m = /^while\s*\((.*)\)\s*\{\s*(.*)$/.exec(text);
  if (m) {
    const body = readBraceBody(lines, cur, m[2]!);
    const cond = parseExpression(m[1]!, lang);
    if (cond) return { kind: 'While', cond, body: parseBraceLines(body.body, lang) };
    return rawBrace(text, body, lang);
  }

  // A line that opens a brace we do not understand — consume the whole block
  // so it survives as one RawCode instead of N fragmented raw lines.
  if (/\{\s*$/.test(text)) {
    const body = readBraceBody(lines, cur, '');
    return rawBrace(text, body, lang);
  }

  return parseSimple(text, lang) ?? { kind: 'RawCode', lang, text };
}

/**
 * Return the `else …` continuation after a brace body. It is either glued to
 * the line that closed the body (`} else {`, R style) or sits alone on the
 * next physical line (JS style). Peeked lines belonging to a continuation are
 * consumed here.
 */
function continuationAfter(lines: PhysLine[], cur: Cursor, closeTail: string): string {
  const tail = closeTail.trim();
  if (tail !== '') return tail;
  const next = lines[cur.i];
  if (next && /^\s*else\b/.test(next.text)) {
    cur.i += 1;
    return next.text.trim().replace(/;+$/, '').trim();
  }
  return '';
}

function finishFunc(lines: PhysLine[], cur: Cursor, lang: SourceLang, name: string, paramsRaw: string, tail: string): IRNode {
  const body = readBraceBody(lines, cur, tail);
  return { kind: 'FuncDef', name, params: splitParams(paramsRaw), body: parseBraceLines(body.body, lang) };
}

interface BraceBody { body: string[]; closeTail: string }

/**
 * Consume physical lines until the opening brace is balanced. String-aware.
 * `initialTail` is any code after the header's `{` on the header line.
 * Returns inner lines (trimmed, trailing semicolons dropped) and any text
 * following the matching `}` on its line (e.g. ` else {`).
 */
function readBraceBody(lines: PhysLine[], cur: Cursor, initialTail: string): BraceBody {
  const body: string[] = [];
  let depth = 1;

  // Inline content after the header's opening brace.
  const head = scanLineDepth(initialTail, depth);
  if (head.closed) {
    if (head.beforeClose.trim() !== '') body.push(head.beforeClose.trim());
    return { body, closeTail: head.afterClose };
  }
  depth = head.endDepth;
  if (initialTail.trim() !== '') body.push(initialTail.trim());

  while (cur.i < lines.length) {
    const t = lines[cur.i]!.text.trim().replace(/;+$/, '').trim();
    cur.i += 1;
    const scan = scanLineDepth(t, depth);
    if (scan.closed) {
      if (scan.beforeClose.trim() !== '') body.push(scan.beforeClose.trim());
      return { body, closeTail: scan.afterClose };
    }
    depth = scan.endDepth;
    if (t !== '') body.push(t);
  }
  return { body, closeTail: '' };
}

interface LineScan {
  endDepth: number;
  /** True when a `}` brought the running depth to 0 on this line. */
  closed: boolean;
  beforeClose: string;
  afterClose: string;
}

/** Walk one line string-aware, tracking `{` / `}` relative to `startDepth`. */
function scanLineDepth(line: string, startDepth: number): LineScan {
  let depth = startDepth;
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return { endDepth: 0, closed: true, beforeClose: line.slice(0, i), afterClose: line.slice(i + 1) };
      }
    }
  }
  return { endDepth: depth, closed: false, beforeClose: line, afterClose: '' };
}

function parseBraceLines(bodyLines: string[], lang: SourceLang): IRNode[] {
  const phys: PhysLine[] = bodyLines
    .map((text) => ({ text, indent: 0 }))
    .filter((l) => stripComment(l.text, lang).trim() !== '');
  const out: IRNode[] = [];
  const cur: Cursor = { i: 0 };
  while (cur.i < phys.length) out.push(parseBraceStmt(phys, cur, lang === 'python' ? 'js' : lang));
  return out;
}

function rawBrace(header: string, body: BraceBody, lang: SourceLang): IRNode {
  const text = [header, ...body.body, body.closeTail.trim()].filter((s) => s.trim() !== '').join('\n');
  return { kind: 'RawCode', lang, text };
}

// ---- simple statements (all languages) ----

function parseSimple(raw: string, lang: SourceLang): IRNode | null {
  let text = raw.trim();
  if (text === '') return null;

  // loop control
  if (text === 'break') return { kind: 'Break' };
  if (text === 'continue' || text === 'next') return { kind: 'Continue' };

  // return
  let m = /^return\s*(?:\((.*)\)|(.+))?$/.exec(text);
  if (m && /^return\b/.test(text)) {
    const inner = (m[1] ?? m[2] ?? '').trim();
    if (inner === '') return { kind: 'Return' };
    const v = parseExpression(inner, lang);
    return v ? { kind: 'Return', value: v } : null;
  }

  // R right-assignment:  expr -> name
  m = /^(.+?)\s*->\s*([A-Za-z_][\w.]*)$/.exec(text);
  if (m && lang === 'r') {
    const value = parseExpression(m[1]!, lang);
    if (value) return { kind: 'VarAssign', name: m[2]!, value, declare: true };
    return null;
  }

  // assignments: JS `let/const/var name =`, R `name <-`, plain `name =`
  m = /^(?:let|const|var)\s+([A-Za-z_$][\w$.]*)\s*=\s*(.+)$/.exec(text);
  if (!m && lang === 'r') m = /^([A-Za-z_][\w.$]*)\s*<-\s*(.+)$/.exec(text);
  if (!m) m = /^([A-Za-z_$][\w.$]*)\s*=\s*(.+)$/.exec(text);
  if (m) {
    const name = m[1]!;
    const value = parseExpression(m[2]!, lang);
    if (value) return { kind: 'VarAssign', name, value, declare: true };
    return null;
  }

  // bare expression / call statement
  const expr = parseExpression(text, lang);
  return expr;
}

function splitParams(raw: string): string[] {
  return raw.split(',').map((s) => s.trim().replace(/^\.\.\./, '')).filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
}
