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
  | { t: 'tmpl'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'punc'; v: string };

const MULTI_OPS = ['**', '//', '==', '!=', '<=', '>=', '&&', '||', '<-', '->', '%%', '%/%', '|>', '%>%', '=>'];

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
    // template literal (JS backticks). `${expr}` interpolations stay inline in
    // the payload and are split out later by parseTemplate.
    if (ch === '`') {
      let j = i + 1;
      let out = '';
      while (j < n && src[j] !== '`') {
        if (src[j] === '\\' && j + 1 < n) { out += src[j]! + src[j + 1]!; j += 2; }
        else { out += src[j]!; j += 1; }
      }
      toks.push({ t: 'tmpl', v: out });
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
      // Pipe operators (`|>` R native / magrittr `%>%`) bind loosest: they are
      // only consumed at statement level (minPrec 0), so `a + 1 |> f()` reads
      // as `f(a + 1)`. `x |> f(a)` becomes `f(x, a)`; a bare `x |> f` becomes
      // `f(x)`; a `studio.*` RHS folds straight into the canonical IR call.
      if (minPrec === 0 && t.t === 'op' && (t.v === '|>' || t.v === '%>%')) {
        this.next();
        const fnTok = this.next();
        if (!fnTok || fnTok.t !== 'id') return null;
        let args: IRNode[] = [left];
        if (this.peek()?.t === 'punc' && this.peek()?.v === '(') {
          const more = this.argList(')');
          if (more === null) return null;
          args = [left, ...more];
        }
        left = fnTok.v.startsWith('studio.')
          ? buildStudioCall(fnTok.v.slice('studio.'.length), args) ?? { kind: 'Call', callee: fnTok.v, args }
          : { kind: 'Call', callee: fnTok.v, args };
        continue;
      }
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
        // JS arrow function: `(v) => body` / `([x, y]) => body`. The params
        // arrive as a grouped VarRef (or a List from `(a, b)` / `[a, b]`).
        if (t.t === 'op' && t.v === '=>') {
          const params = arrowParams(left);
          if (!params) return null;
          this.next();
          const body = this.expression(0);
          if (body === null) return null;
          return { kind: 'Lambda', params, body };
        }
        // member access on any receiver: `(df).length`, `(xs).map(…).join(…)`,
        // `(est).toFixed(4)`, `xs[0].length`.
        if (t.t === 'op' && t.v === '.') {
          const prop = this.toks[this.pos + 1];
          const isCall = prop?.t === 'id' && this.toks[this.pos + 2]?.t === 'punc' && this.toks[this.pos + 2]!.v === '(';
          if (prop?.t === 'id') {
            const save = this.pos;
            const handled = this.memberPostfix(left, prop.v, isCall);
            if (handled !== null) { left = handled; continue; }
            this.pos = save;
          }
          return null; // `(x).unknown` — not representable, keep the source raw
        }
        break;
      }
      const prec = BIN_PREC[op];
      if (prec === undefined || prec < minPrec) break;
      this.next();
      const right = this.expression(prec + 1); // left-assoc; power handled below
      if (right === null) return null;
      left = { kind: 'BinaryOp', op, left, right };
      // Inverse of the JS two-arg round lowering (real JS ignores Math.round's
      // second argument, so codegen emits the scaled-div form): fold
      // `Math.round(x * 10 ** n) / 10 ** n` back into `round(x, n)`.
      if (op === '/' && this.lang === 'js') {
        const folded = foldJsScaledRound(left);
        if (folded) left = folded;
      }
    }
    if (minPrec === 0) {
      // Python conditional expression `A if C else B`. The `else` lookahead
      // keeps a comprehension filter (`[v for v in xs if v > 0]`) from being
      // mistaken for a ternary.
      if (this.lang === 'python' && this.peek()?.t === 'id' && this.peek()?.v === 'if') {
        const save = this.pos;
        this.next();
        const cond = this.expression(0);
        if (cond !== null && this.eatId('else')) {
          const alt = this.expression(0);
          if (alt !== null) return { kind: 'Ternary', cond, then: left, alt };
        }
        this.pos = save;
      }
      if (this.lang === 'js' && this.peek()?.t === 'op' && this.peek()?.v === '?') {
        this.next();
        const then = this.expression(0);
        if (then !== null && this.eatPunc(':')) {
          const alt = this.expression(0);
          if (alt !== null) return { kind: 'Ternary', cond: left, then, alt };
        }
      }
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
    if (t.t === 'tmpl') {
      const parsed = parseTemplate(t.v, this.lang);
      if (parsed) return parsed;
    }
    if (t.t === 'id') {
      if (t.v === 'True' || t.v === 'TRUE' || t.v === 'true') return { kind: 'Boolean', value: true };
      if (t.v === 'False' || t.v === 'FALSE' || t.v === 'false') return { kind: 'Boolean', value: false };
      if (t.v === 'None' || t.v === 'NULL' || t.v === 'null') return { kind: 'Null' };
      // python lambda expression.
      if (t.v === 'lambda' && this.lang === 'python') {
        const params: string[] = [];
        for (;;) {
          const p = this.peek();
          if (p?.t === 'id' && p.v !== ':') { params.push(p.v); this.next(); if (this.eatPunc(',')) continue; }
          break;
        }
        if (!this.eatPunc(':')) return null;
        const body = this.expression(0);
        if (body === null) return null;
        return { kind: 'Lambda', params, body };
      }
      // Dialect constants fold into the canonical math.pi VarRef so codegen
      // can re-render them per target (R `pi`, JS `Math.PI`, py `math.pi`).
      if (t.v === 'Math.PI' || (t.v === 'pi' && this.lang === 'r')) {
        return { kind: 'VarRef', name: 'math.pi' };
      }
      // Python f-string: the lexer yields id 'f' immediately followed by the
      // quoted string (the `f` prefix is not part of any identifier).
      if (t.v === 'f' && this.peek()?.t === 'str') {
        const s = this.next()!;
        if (s.t !== 'str') return null;
        const parsed = parseFString(s.v, this.lang);
        if (parsed) return parsed;
      }
      // `studio.<method>(...)` lexes as one dotted identifier; dispatch DSL
      // calls to the IR mapping and keep the rest as generic VarRefs.
      if (t.v.startsWith('studio.')) {
        const method = t.v.slice('studio.'.length);
        if (this.peek()?.t === 'punc' && this.peek()?.v === '(') {
          const call = this.studioCall(method);
          return call ? this.flattenChain(call) : null;
        }
        return { kind: 'VarRef', name: t.v };
      }
      // function call
      if (this.peek()?.t === 'punc' && this.peek()?.v === '(') {
        const call = this.namedCall(t.v);
        return call ? this.flattenChain(call, t.v) : null;
      }
      // `obj.method(...)` — the dot lexed separately (e.g. after an index),
      // and `_random.Random(i).random()` style chains.
      const chained = this.tryChain({ kind: 'VarRef', name: t.v });
      if (chained) return chained;
      // JS `xs.length` lexes as one dotted name → canonical len(xs).
      const lenM = /^([A-Za-z_$][\w$]*)\.length$/.exec(t.v);
      if (lenM) return { kind: 'Call', callee: 'len', args: [{ kind: 'VarRef', name: lenM[1]! }] };
      return { kind: 'VarRef', name: t.v };
    }
    if (t.t === 'str') {
      // `'<sep>'.join(...)` — a string receiver cannot be a generic Call.
      if (this.peek()?.t === 'op' && this.peek()?.v === '.') {
        const save = this.pos;
        this.next();
        const prop = this.next();
        if (prop?.t === 'id' && prop.v === 'join' && this.peek()?.v === '(') {
          const args = this.argList(')');
          if (args && args.length === 1) {
            return { kind: 'Join', sep: t.v, items: args[0]! };
          }
        }
        this.pos = save;
      }
      return { kind: 'String', value: t.v };
    }
    if (t.t === 'punc') {
      if (t.v === '(') {
        // Grouping — or a tuple literal when a comma follows (`for k in (a, b)`).
        const first = this.expression(0);
        if (first === null) return null;
        if (this.peek()?.t === 'punc' && this.peek()?.v === ',') {
          const items: IRNode[] = [first];
          while (this.eatPunc(',')) {
            if (this.peek()?.t === 'punc' && this.peek()?.v === ')') break;
            const e = this.expression(0);
            if (e === null) return null;
            items.push(e);
          }
          if (!this.eatPunc(')')) return null;
          // codegen's JS seeded draw: `(setSeed(S), random01())` — a statement
          // pair that semantically yields one seeded uniform draw, not a list.
          if (items.length === 2) {
            const [a, b] = items;
            if (a && b && a.kind === 'Call' && a.callee === 'random.seed' && a.args.length === 1
              && b.kind === 'Call' && b.callee === 'random.random' && b.args.length === 0) {
              return { kind: 'Call', callee: '_random.Random.random', args: [a.args[0]!] };
            }
          }
          return { kind: 'List', items };
        }
        if (!this.eatPunc(')')) return null;
        return first;
      }
      if (t.v === '[') return this.listLit();
      if (t.v === '{') return this.dictLit();
      if (t.v === '-') { /* stray minus */ }
    }
    return null;
  }

  /** Flatten `X.m1(...).m2(...)` chains into dotted callees so they survive
   *  the Call node's string-callee shape (python round-trips verbatim).
   *  Segment arguments merge into the final call's args in order, so
   *  `_random.Random(i).random()` keeps its seed as args[0]. */
  private flattenChain(node: IRNode, base?: string): IRNode {
    let current = node;
    let prefix = base ?? (current.kind === 'Call' ? current.callee : '');
    let merged: IRNode[] = current.kind === 'Call' ? [...current.args] : [];
    for (;;) {
      const t = this.peek();
      if (!t || t.t !== 'op' || t.v !== '.') break;
      const prop = this.toks[this.pos + 1];
      if (!prop || prop.t !== 'id' || this.toks[this.pos + 2]?.v !== '(') break;
      // Member idioms (String(x).toFixed(4), .padStart(5, ' '), .map(…))
      // take precedence over dotted-callee flattening, which would otherwise
      // swallow `String(k).padStart(…)` into an unrepresentable callee.
      const save = this.pos;
      const handled = this.memberPostfix(current, prop.v, true);
      if (handled !== null) return handled;
      this.pos = save;
      this.pos += 2;
      const args = this.argList(')');
      if (args === null) break;
      prefix = `${prefix}.${prop.v}`;
      merged = [...merged, ...args];
      current = { kind: 'Call', callee: prefix, args: merged };
    }
    return current;
  }

  /** Chain handling for a bare identifier (`rng.random()`). */
  private tryChain(node: IRNode): IRNode | null {
    const t = this.peek();
    if (!t || t.t !== 'op' || t.v !== '.') return null;
    const prop = this.toks[this.pos + 1];
    if (!prop || prop.t !== 'id' || this.toks[this.pos + 2]?.v !== '(') return null;
    return this.flattenChain(node, node.kind === 'VarRef' ? node.name : '');
  }

  private eatPunc(v: string): boolean {
    const t = this.peek();
    if (t?.t === 'punc' && t.v === v) { this.next(); return true; }
    return false;
  }

  /** `[a, b, c]`, Python slices `[a:b:c]`, and comprehensions
   *  `[body for v in iter if cond]` are distinguished by what follows. */
  private listLit(): IRNode | null {
    const items: IRNode[] = [];
    if (this.eatPunc(']')) return { kind: 'List', items };
    const first = this.expression(0);
    if (first === null) return null;
    // Comprehension header: `for var(s) in iter [if cond]`.
    if (this.peek()?.t === 'id' && this.peek()?.v === 'for') {
      const comp = this.compTail(first);
      if (comp === null) return null;
      if (!this.eatPunc(']')) return null;
      return comp;
    }
    items.push(first);
    for (;;) {
      if (this.eatPunc(',')) {
        if (this.peek()?.t === 'punc' && this.peek()?.v === ']') break;
        const e = this.expression(0);
        if (e === null) return null;
        items.push(e);
        continue;
      }
      break;
    }
    if (!this.eatPunc(']')) return null;
    return { kind: 'List', items };
  }

  /** Parse `for v in iter [if cond]` after a leading body expression. */
  private compTail(body: IRNode): IRNode | null {
    if (!this.eatId('for')) return null;
    const vars: string[] = [];
    for (;;) {
      const t = this.next();
      if (!t || t.t !== 'id') return null;
      vars.push(t.v);
      if (!this.eatPunc(',')) break;
    }
    if (!this.eatId('in')) return null;
    const iter = this.expression(0);
    if (iter === null) return null;
    let cond: IRNode | undefined;
    if (this.peek()?.t === 'id' && this.peek()?.v === 'if') {
      this.next();
      cond = this.expression(0) ?? undefined;
      if (!cond) return null;
    }
    return { kind: 'ListComp', vars, iter, body, ...(cond ? { cond } : {}) };
  }

  private eatId(v: string): boolean {
    const t = this.peek();
    if (t?.t === 'id' && t.v === v) { this.next(); return true; }
    return false;
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
    const node: IRNode = canonSlice({
      kind: 'ListSlice',
      list: obj,
      ...(startNode ? { start: startNode } : {}),
      ...(stopNode ? { stop: stopNode } : {}),
      ...(stepNode ? { step: stepNode } : {}),
    });
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
   *  renders plot option objects. Also restores the dialect idioms the
   *  codegen emits (sprintf ⇄ f-string, length ⇄ len, seq ⇄ range, …) back
   *  into their canonical IR so conversions round-trip instead of drifting. */
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
    // codegen's inline seeded draw — intercept before generic arg parsing,
    // whose `{ … }` statement block is not expression-parseable.
    if (name === 'local' && this.lang === 'r') {
      const seeded = this.trySeededLocal();
      if (seeded) return seeded;
    }
    const parsed = this.namedArgs(')');
    if (!parsed) return null;
    const args = parsed.positional;
    const named = parsed.named;
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
      return canonSlice({
        kind: 'ListSlice',
        list: { kind: 'VarRef', name: sliceM[1]! },
        ...(args[0] && !isUndef(args[0]) ? { start: args[0] } : {}),
        ...(args[1] && !isUndef(args[1]) ? { stop: args[1] } : {}),
      });
    }
    // ---- dialect idiom inverses → canonical IR ----
    // sapply/lapply over a vector (optionally Filtered) ⇄ python comprehension.
    if (name === 'sapply' || name === 'lapply') {
      const [iter, fn] = args;
      if (iter && fn?.kind === 'Lambda' && fn.params.length === 1) {
        if (iter.kind === 'Call' && iter.callee === 'Filter' && iter.args.length === 2 && iter.args[0]!.kind === 'Lambda') {
          const cf = iter.args[0] as Extract<IRNode, { kind: 'Lambda' }>;
          return { kind: 'ListComp', vars: fn.params, iter: iter.args[1]!, body: fn.body, cond: cf.body };
        }
        return { kind: 'ListComp', vars: fn.params, iter, body: fn.body };
      }
    }
    // mapply walks zipped sequences in lockstep ⇄ `for x, y in zip(a, b)`.
    if (name === 'mapply' && args.length >= 2 && args[0]!.kind === 'Lambda') {
      const fn = args[0] as Extract<IRNode, { kind: 'Lambda' }>;
      const seqs = args.slice(1);
      if (seqs.length === fn.params.length) {
        return { kind: 'ListComp', vars: fn.params, iter: { kind: 'Call', callee: 'zip', args: seqs }, body: fn.body };
      }
    }
    // JS `out.push(x)` — the dotted name lexed whole → python `.append`.
    const pushM = /^([A-Za-z_$][\w$.]*)\.push$/.exec(name);
    if (pushM && args.length === 1) return { kind: 'Call', callee: `${pushM[1]}.append`, args };
    if (name === 'sprintf' && args.length >= 1 && args[0]!.kind === 'String') {
      const fstr = sprintfToFString(args[0]!.value, args.slice(1));
      if (fstr) return fstr;
    }
    if (name === 'length' && args.length === 1) return { kind: 'Call', callee: 'len', args };
    // R `seq(0, (n) - 1)` is the emitted form of python `range(0, n)`.
    if (name === 'seq' && args.length === 2) {
      const stop = args[1]!;
      if (stop.kind === 'BinaryOp' && stop.op === '-' && stop.right.kind === 'Number' && stop.right.value === 1) {
        const start = args[0]!;
        if (start.kind === 'Number' && start.value === 0) return { kind: 'Call', callee: 'range', args: [stop.left] };
        return { kind: 'Call', callee: 'range', args: [start, stop.left] };
      }
    }
    // Bare math functions in R/JS source (`sin(x)`) canonicalize to math.*.
    if (this.lang !== 'python' && MATH_FN_ALIASES.includes(name) && args.length >= 1) {
      return { kind: 'Call', callee: `math.${name}`, args };
    }
    if (name === 'set.seed' && args.length === 1) return { kind: 'Call', callee: 'random.seed', args };
    if (name === 'setSeed' && args.length === 1) return { kind: 'Call', callee: 'random.seed', args };
    // python RNG-object idiom: `rng = random.Random(S)` binds a seeded
    // generator the shared engine models globally — the binding becomes a
    // seed statement and `<var>.random()` a bare uniform draw, so the IR
    // matches what R/JS set.seed / random01 sources parse back into.
    if ((name === '_random.Random' || name === 'random.Random') && args.length === 1) {
      return { kind: 'Call', callee: 'random.seed', args };
    }
    if (args.length === 0 && /^[A-Za-z_]\w*\.random$/.test(name)) {
      return { kind: 'Call', callee: 'random.random', args: [] };
    }
    if (name === 'runif' && args.length === 1 && args[0]!.kind === 'Number' && args[0]!.value === 1) {
      return { kind: 'Call', callee: 'random.random', args: [] };
    }
    if (name === 'random01' && args.length === 0) return { kind: 'Call', callee: 'random.random', args: [] };
    if (name === 'ifelse' && args.length === 3) {
      return { kind: 'Ternary', cond: args[0]!, then: args[1]!, alt: args[2]! };
    }
    // R `paste(items, collapse = sep)` ⇄ python `sep.join(items)`.
    if (name === 'paste' && args.length === 1 && named.get('collapse')?.kind === 'String') {
      return { kind: 'Join', sep: (named.get('collapse') as { value: string }).value, items: args[0]! };
    }
    // JS `Math.*` ⇄ python `math.*` (Math.PI folded to the constant VarRef).
    // abs/min/max/round are python builtins, not math.* members — canonicalize
    // them to the bare call every dialect renders back to Math.<fn> / base R.
    if (name.startsWith('Math.')) {
      const fn = name.slice('Math.'.length);
      if (fn === 'PI') return { kind: 'VarRef', name: 'math.pi' };
      if (fn === 'abs' || fn === 'min' || fn === 'max' || fn === 'round') {
        return { kind: 'Call', callee: fn, args };
      }
      return { kind: 'Call', callee: `math.${fn}`, args };
    }
    return { kind: 'Call', callee: name, args };
  }

  /** `.prop` / `.method(args)` on any receiver. Recognizes the idioms the
   *  codegen emits (map/filter → ListComp, toFixed/padStart → FString spec,
   *  join → Join, length → len, push → append); anything else returns null so
   *  the source degrades honestly. Tokens are consumed only on success. */
  private memberPostfix(receiver: IRNode, prop: string, isCall: boolean): IRNode | null {
    // Consume `.` + the member id up front; undo on failure (the caller also
    // restores, so this just keeps argList's peek position correct).
    this.pos += 2;
    if (!isCall) {
      if (prop === 'length') return { kind: 'Call', callee: 'len', args: [receiver] };
      this.pos -= 2;
      return null;
    }
    const args = this.argList(')');
    if (args === null) {
      this.pos -= 2;
      return null;
    }
    const lambda = (n: IRNode | undefined): Extract<IRNode, { kind: 'Lambda' }> | null =>
      n && n.kind === 'Lambda' ? n : null;
    if (prop === 'map') {
      const fn = args.length === 1 ? lambda(args[0]) : null;
      if (fn) return { kind: 'ListComp', vars: fn.params, iter: receiver, body: fn.body };
      return null;
    }
    if (prop === 'filter') {
      const fn = args.length === 1 ? lambda(args[0]) : null;
      if (!fn || fn.params.length !== 1) return null;
      // `.filter(c).map(b)` is the emitted form of a conditional comprehension.
      const t = this.peek();
      if (t?.t === 'op' && t.v === '.' && (this.toks[this.pos + 1] as { v?: string })?.v === 'map'
        && this.toks[this.pos + 2]?.t === 'punc' && this.toks[this.pos + 2]!.v === '(') {
        this.pos += 2;
        const mapArgs = this.argList(')');
        const mapFn = mapArgs && mapArgs.length === 1 ? lambda(mapArgs[0]) : null;
        if (!mapFn) return null;
        return { kind: 'ListComp', vars: mapFn.params, iter: receiver, body: mapFn.body, cond: fn.body };
      }
      // A bare `.filter(c)` renders python `[v for v in xs if c]`.
      return { kind: 'ListComp', vars: fn.params, iter: receiver, body: { kind: 'VarRef', name: fn.params[0]! }, cond: fn.body };
    }
    if (prop === 'join' && args.length === 1 && args[0]!.kind === 'String') {
      return { kind: 'Join', sep: args[0]!.value, items: receiver };
    }
    if (prop === 'push' && args.length === 1 && receiver.kind === 'VarRef') {
      return { kind: 'Call', callee: `${receiver.name}.append`, args };
    }
    // Formatting specs: `String(k).padStart(5, ' ')` / `(est).toFixed(4)`.
    if (receiver.kind === 'Call' && receiver.callee === 'String' && receiver.args.length === 1
      && (prop === 'toFixed' || prop === 'padStart' || prop === 'padEnd')) {
      receiver = receiver.args[0]!;
    }
    if (prop === 'toFixed' && args.length === 1 && args[0]!.kind === 'Number') {
      return { kind: 'FString', parts: [{ expr: receiver, spec: `.${args[0]!.value}f` }] };
    }
    if ((prop === 'padStart' || prop === 'padEnd') && args.length === 2
      && args[0]!.kind === 'Number' && args[1]!.kind === 'String' && args[1]!.value === ' ') {
      return { kind: 'FString', parts: [{ expr: receiver, spec: `${prop === 'padStart' ? '>' : '<'}${args[0]!.value}` }] };
    }
    return null;
  }

  /** codegen's inline seeded draw `local({ set.seed(S); runif(1) })` —
   *  reverse it into the canonical `_random.Random.random` call. */
  private trySeededLocal(): IRNode | null {
    const save = this.pos;
    if (!this.eatPunc('(') || !this.eatPunc('{')) { this.pos = save; return null; }
    const fn = this.peek();
    if (!fn || fn.t !== 'id' || fn.v !== 'set.seed') { this.pos = save; return null; }
    this.pos += 1;
    const seedArgs = this.argList(')');
    if (!seedArgs || seedArgs.length !== 1) { this.pos = save; return null; }
    if (!this.eatPunc(';')) { this.pos = save; return null; }
    const rn = this.peek();
    if (!rn || rn.t !== 'id' || rn.v !== 'runif') { this.pos = save; return null; }
    this.pos += 1;
    const rnArgs = this.argList(')');
    if (!rnArgs || rnArgs.length !== 1 || rnArgs[0]!.kind !== 'Number' || rnArgs[0]!.value !== 1) {
      this.pos = save;
      return null;
    }
    if (!this.eatPunc('}') || !this.eatPunc(')')) { this.pos = save; return null; }
    return { kind: 'Call', callee: '_random.Random.random', args: seedArgs };
  }

  /** R anonymous function in argument position: `function(v) expr`. */
  private parseRFunction(): IRNode | null {
    this.next(); // 'function'
    if (!this.eatPunc('(')) return null;
    const params: string[] = [];
    if (!this.eatPunc(')')) {
      for (;;) {
        const t = this.next();
        if (!t || t.t !== 'id') return null;
        params.push(t.v);
        if (this.eatPunc(',')) continue;
        break;
      }
      if (!this.eatPunc(')')) return null;
    }
    const body = this.expression(0);
    if (body === null) return null;
    return { kind: 'Lambda', params, body };
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
      // R anonymous function in argument position: `sapply(X, function(v) …)`.
      const t0 = this.peek();
      if (t0?.t === 'id' && t0.v === 'function') {
        const fn = this.parseRFunction();
        if (!fn) return null;
        positional.push(fn);
        if (this.eatPunc(',')) continue;
        break;
      }
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
      // Bare generator expression: `sum(1 for i in range(k) if cond)`.
      if (this.peek()?.t === 'id' && this.peek()?.v === 'for') {
        const comp = this.compTail(e);
        if (comp === null) return null;
        positional.push(comp);
        if (this.eatPunc(',')) continue;
        break;
      }
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

/** Bare names in R/JS source that canonicalize to python `math.*` calls.
 *  Excluded: `round`, `abs`, `min`, `max` — python builtins (there is no
 *  `math.round`/`math.abs`/…), kept as bare calls in every dialect. */
const MATH_FN_ALIASES = ['sin', 'cos', 'sqrt', 'log', 'exp', 'floor'];

/** Canonical slice form: an explicit literal-0 start equals the omitted
 *  default whenever no negative step is involved — drop it so `x[0:5]`,
 *  `x[:5]` and JS `x.slice(0, 5)` share one IR shape. */
function canonSlice(node: IRNode): IRNode {
  if (node.kind !== 'ListSlice' || !node.start) return node;
  if (node.start.kind !== 'Number' || node.start.value !== 0) return node;
  if (node.step && !(node.step.kind === 'Number' && node.step.value > 0)) return node;
  const { start: _dropped, ...rest } = node;
  return rest;
}

/** Variable names bound by an arrow function's parameter list — a grouped
 *  VarRef (`(v) => …`) or a List from `(a, b) =>` / destructured `[a, b] =>`. */
function arrowParams(left: IRNode): string[] | null {
  if (left.kind === 'VarRef' && /^[A-Za-z_$][\w$]*$/.test(left.name)) return [left.name];
  if (left.kind === 'List' && left.items.length > 0
    && left.items.every((i) => i.kind === 'VarRef' && /^[A-Za-z_$][\w$]*$/.test((i as { name: string }).name))) {
    return left.items.map((i) => (i as { name: string }).name);
  }
  return null;
}

/** Parse a standalone expression (used by block argument fields too). */
export function parseExpression(text: string, lang: SourceLang = 'python'): IRNode | null {
  try {
    return new ExprParser(tokenize(text), lang).parse();
  } catch {
    return null;
  }
}

/** Parse the body of a python f-string into literal/expr parts. The lexer has
 *  already resolved escape sequences, so `{{`/`}}` remain as the only escapes. */
function parseFString(value: string, lang: SourceLang): IRNode | null {
  const parts: { text?: string; expr?: IRNode; spec?: string }[] = [];
  let text = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (ch === '{' && value[i + 1] === '{') { text += '{'; i += 1; continue; }
    if (ch === '}' && value[i + 1] === '}') { text += '}'; i += 1; continue; }
    if (ch === '{') {
      const close = value.indexOf('}', i + 1);
      if (close < 0) return null;
      const raw = value.slice(i + 1, close);
      i = close;
      let exprSrc = raw;
      let spec: string | undefined;
      const colon = raw.indexOf(':');
      if (colon >= 0) {
        const tail = raw.slice(colon + 1);
        if (/^[.<^>]?\d+(?:\.\d+)?[fdgs%]?$/.test(tail)) {
          exprSrc = raw.slice(0, colon);
          spec = tail;
        }
      }
      const e = parseExpression(exprSrc, lang);
      if (e === null) return null;
      if (text) { parts.push({ text }); text = ''; }
      parts.push({ expr: e, ...(spec ? { spec } : {}) });
      continue;
    }
    text += ch;
  }
  if (text) parts.push({ text });
  if (parts.length === 0) return { kind: 'String', value: '' };
  return { kind: 'FString', parts };
}

/** Inverse of codegen's R `sprintf('…', …)` rendering of an FString: rebuild
 *  the canonical FString from a printf format string. rFormat only ever emits
 *  `%s`, `%.Nf`, `%[N]d`, `%[N]g`, `%[-]N s` — each maps back losslessly.
 *  Returns null for any directive the spec vocabulary cannot express (or an
 *  argument-count mismatch) so the original Call{sprintf} is preserved. */
function sprintfToFString(fmt: string, args: IRNode[]): IRNode | null {
  const parts: { text?: string; expr?: IRNode; spec?: string }[] = [];
  let text = '';
  let argIdx = 0;
  let i = 0;
  while (i < fmt.length) {
    const ch = fmt[i]!;
    if (ch !== '%') { text += ch; i += 1; continue; }
    if (fmt[i + 1] === '%') { text += '%'; i += 2; continue; }
    const m = /^%(-)?(\d+)?(?:\.(\d+))?([sdfgi])/.exec(fmt.slice(i));
    if (!m) return null;
    const [, left, width, frac, kind] = m;
    if (argIdx >= args.length) return null;
    if (text) { parts.push({ text }); text = ''; }
    let spec: string | undefined;
    if (frac) {
      if (kind !== 'f') return null; // %.Ng / %.Ns → not expressible
      spec = `.${frac}f`;
    } else if (kind === 'f') spec = '.6f';
    else if (kind === 'd' || kind === 'i') spec = `${width ?? ''}d`;
    else if (kind === 'g') spec = `${width ?? ''}g`;
    else if (width) spec = left ? `<${width}` : `>${width}`;
    parts.push({ expr: args[argIdx]!, ...(spec ? { spec } : {}) });
    argIdx += 1;
    i += m[0].length;
  }
  // Leftover arguments would be dropped by an FString — keep the call instead.
  if (argIdx !== args.length) return null;
  if (text) parts.push({ text });
  if (parts.length === 0) return { kind: 'String', value: '' };
  return { kind: 'FString', parts };
}

/** Parse a JS template literal payload (backticks stripped by the lexer) into
 *  FString parts. `${expr}` interpolations are parsed as expressions; a
 *  single-part FString produced by a spec idiom (`(x).toFixed(2)`,
 *  `String(k).padStart(5, ' ')`) flattens into the surrounding template. */
function parseTemplate(value: string, lang: SourceLang): IRNode | null {
  const parts: { text?: string; expr?: IRNode; spec?: string }[] = [];
  let text = '';
  let i = 0;
  while (i < value.length) {
    const ch = value[i]!;
    if (ch === '\\' && i + 1 < value.length) {
      const e = value[i + 1]!;
      text += e === 'n' ? '\n' : e === 't' ? '\t' : e === 'r' ? '\r' : e;
      i += 2;
      continue;
    }
    if (ch === '$' && value[i + 1] === '{') {
      const close = matchBrace(value, i + 1);
      if (close < 0) return null;
      const inner = value.slice(i + 2, close);
      i = close + 1;
      const e = parseExpression(inner, lang);
      if (e === null) return null;
      if (text) { parts.push({ text }); text = ''; }
      if (e.kind === 'FString' && e.parts.length === 1 && e.parts[0]!.expr) {
        parts.push(e.parts[0] as { expr: IRNode; spec?: string });
      } else {
        parts.push({ expr: e });
      }
      continue;
    }
    text += ch;
    i += 1;
  }
  if (text) parts.push({ text });
  if (parts.length === 0) return { kind: 'String', value: '' };
  return { kind: 'FString', parts };
}

/** Index of the `}` matching the `{` at `open`, brace-depth aware. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let k = open; k < s.length; k += 1) {
    if (s[k] === '{') depth += 1;
    else if (s[k] === '}') {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return -1;
}

/** R 1-based offset inverse: `(x + 1)` → `x`. */
function unwrapRBase1(node: IRNode, lang: SourceLang): IRNode {
  if (lang !== 'r') return node;
  if (node.kind === 'BinaryOp' && node.op === '+' && node.right.kind === 'Number' && node.right.value === 1) {
    return node.left;
  }
  return node;
}

/** JS two-arg round inverse: python `round(x, n)` lowers to the executable
 *  `Math.round(x * 10 ** n) / 10 ** n` (real JS ignores Math.round's second
 *  argument). Fold that exact shape back into the canonical call. */
function foldJsScaledRound(node: IRNode): IRNode | null {
  if (node.kind !== 'BinaryOp' || node.op !== '/') return null;
  const call = node.left;
  const scale = node.right;
  if (call.kind !== 'Call' || (call.callee !== 'round' && call.callee !== 'math.round') || call.args.length !== 1) return null;
  if (scale.kind !== 'BinaryOp' || scale.op !== '**') return null;
  if (!(scale.left.kind === 'Number' && scale.left.value === 10)) return null;
  const scaled = call.args[0]!;
  if (scaled.kind !== 'BinaryOp' || scaled.op !== '*') return null;
  if (JSON.stringify(scaled.right) !== JSON.stringify(scale)) return null;
  return { kind: 'Call', callee: 'round', args: [scaled.left, scale.right] };
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
    return canonSlice({
      kind: 'ListSlice',
      list,
      ...(start && start.kind !== 'Null' ? { start } : {}),
      ...(stop && stop.kind !== 'Null' ? { stop } : {}),
      ...(step && step.kind !== 'Null' ? { step } : {}),
    });
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

  const body = lang === 'python' ? parsePyBlock(lines, { i: 0 }, -1) : parseBraceProgram(lines, lang);
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

  // Imports are no-ops for execution but must round-trip instead of degrading.
  m = /^import\s+([A-Za-z_][\w.]*)(?:\s+as\s+[A-Za-z_]\w*)?$/.exec(text);
  if (m) return { kind: 'Import', module: m[1]! };
  m = /^from\s+([A-Za-z_][\w.]*)\s+import\s+.+$/.exec(text);
  if (m) return { kind: 'Import', module: m[1]! };

  return parseSimple(text, 'python') ?? { kind: 'RawCode', lang: 'python', text };
}

// ---- JS / R (brace languages) ----

function parseBraceProgram(lines: PhysLine[], lang: 'js' | 'r'): IRNode[] {
  const out: IRNode[] = [];
  const cur: Cursor = { i: 0 };
  while (cur.i < lines.length) {
    out.push(parseBraceStmt(lines, cur, lang));
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
  const text = raw.trim();
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
