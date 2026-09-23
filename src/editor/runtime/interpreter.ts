// ==========================================================================
// Ergalics Studio — IR interpreter (block mode execution)
//
// Executes an IRProgram directly against the injected StudioApi. It is the
// block-mode runtime (editor architecture §8.1 "editor-js" path), and shares
// semantics 1:1 with the codegen (IR→JS/Python) so a program behaves the same
// whether interpreted or generated (invariant #2).
// ==========================================================================

import type { BinaryOperator, IRNode, IRProgram } from '../ir/types';
import {
  isDataTable,
  isRenderedView,
  type DataTable,
  type DataValue,
  type RenderedView,
} from '@/types/datatable';
import type { StudioApi } from './studio-api';

type Value =
  | number
  | string
  | boolean
  | null
  | DataTable
  | RenderedView
  | Value[]
  | { [key: string]: Value };

type Signal =
  | { type: 'normal' }
  | { type: 'break' }
  | { type: 'continue' }
  | { type: 'return'; value: Value };

interface FuncValue {
  kind: 'func';
  params: string[];
  body: IRNode[];
}

/** A builtin function provided by the runtime (len, sum, math.* …). */
interface NativeFunc {
  kind: 'native-func';
  fn: (args: Value[]) => Value | Promise<Value>;
}

function isNativeFunc(v: unknown): v is NativeFunc {
  return !!v && typeof v === 'object' && (v as NativeFunc).kind === 'native-func';
}

function isTableValue(v: Value): v is DataTable {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    isDataTable(v as DataValue) &&
    typeof (v as DataTable).columnNames === 'function'
  );
}

/** Sentinel returned by the dotted-call dispatcher when it did not handle the
 *  callee, so `call` can fall through to scope resolution (user functions). */
const UNRESOLVED: unique symbol = Symbol('interpreter.unresolved');

/** Render a value like python's str() with an optional f-string spec. */
function formatSpec(v: Value, spec: string | undefined): string {
  if (spec === undefined || spec === '') {
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (v === null) return 'None';
    return String(v);
  }
  const m = /^([<>^]?)(\d+)?(?:\.(\d+))?([fdgs%])?$/.exec(spec);
  if (!m) return String(v);
  const [, align, width, frac, kind] = m;
  let text: string;
  if (frac !== undefined) text = toNum(v).toFixed(Number(frac));
  else if (kind === 'd') text = String(Math.round(toNum(v)));
  else if (kind === '%') text = `${(toNum(v) * 100).toFixed(frac ? Number(frac) : 0)}%`;
  else if (typeof v === 'boolean') text = v ? 'True' : 'False';
  else if (v === null) text = 'None';
  else text = String(v);
  if (width !== undefined) {
    const w = Number(width);
    if (align === '<') return text.padEnd(w, ' ');
    if (align === '^') {
      const left = Math.floor(Math.max(0, w - text.length) / 2);
      return text.padStart(text.length + left, ' ').padEnd(w, ' ');
    }
    // '>' or omitted: python right-aligns numbers, left-aligns strings.
    return align === '>' || typeof v === 'number' ? text.padStart(w, ' ') : text.padEnd(w, ' ');
  }
  return text;
}

/** The language builtins every parsed program may call. Seeded with the
 *  studio api so `random.seed` / scalar draws hit the same shared engine. */
function createBuiltins(studio: StudioApi): Map<string, NativeFunc> {
  const one = (f: (x: number) => number): NativeFunc => ({
    kind: 'native-func',
    fn: (args) => f(toNum(args[0] ?? null)),
  });
  const asList = (v: Value | undefined): Value[] => {
    if (Array.isArray(v)) return v;
    throw new Error('expected a list');
  };
  const map = new Map<string, NativeFunc>();
  map.set('len', {
    kind: 'native-func',
    fn: (args) => {
      const v = args[0] ?? null;
      if (typeof v === 'string') return v.length;
      if (Array.isArray(v)) return v.length;
      if (isTableValue(v)) return v.length;
      throw new Error('len() expects a list, string or table');
    },
  });
  map.set('sum', {
    kind: 'native-func',
    fn: (args) => asList(args[0]).reduce<number>((acc, x) => acc + toNum(x), 0),
  });
  map.set('sqrt', one(Math.sqrt));
  map.set('abs', one(Math.abs));
  map.set('sin', one(Math.sin));
  map.set('cos', one(Math.cos));
  map.set('log', one(Math.log));
  map.set('exp', one(Math.exp));
  map.set('floor', one(Math.floor));
  map.set('min', { kind: 'native-func', fn: (args) => Math.min(...args.map(toNum)) });
  map.set('max', { kind: 'native-func', fn: (args) => Math.max(...args.map(toNum)) });
  map.set('round', {
    kind: 'native-func',
    fn: (args) => {
      const x = toNum(args[0] ?? null);
      const d = args.length > 1 ? Math.max(0, Math.floor(toNum(args[1]!))) : 0;
      const f = 10 ** d;
      return Math.round(x * f) / f;
    },
  });
  map.set('range', {
    kind: 'native-func',
    fn: (args) => {
      const a = toNum(args[0] ?? null);
      const b = args.length > 1 ? toNum(args[1]!) : undefined;
      const step = args.length > 2 && args[2] !== null ? toNum(args[2]!) : 1;
      const start = b === undefined ? 0 : a;
      const stop = b === undefined ? a : b;
      const s = step === 0 ? 1 : step;
      const out: Value[] = [];
      for (let v = start; s > 0 ? v < stop : v > stop; v += s) out.push(v);
      return out;
    },
  });
  map.set('zip', {
    kind: 'native-func',
    fn: (args) => {
      const lists = args.map((a) => asList(a));
      const n = lists.length > 0 ? Math.min(...lists.map((l) => l.length)) : 0;
      const out: Value[] = [];
      for (let i = 0; i < n; i += 1) out.push(lists.map((l) => l[i] ?? null));
      return out;
    },
  });
  // ---- R-flavoured aliases (running R-side IR in the builtin engine) ----
  map.set('length', { kind: 'native-func', fn: (args) => map.get('len')!.fn(args) });
  map.set('seq', {
    kind: 'native-func',
    // R seq is inclusive on both ends.
    fn: (args) => {
      const a = toNum(args[0] ?? null);
      const b = toNum(args[1] ?? null);
      const step = args.length > 2 && args[2] !== null ? Math.abs(toNum(args[2]!)) : 1;
      const out: Value[] = [];
      for (let v = a; step > 0 ? v <= b : v >= b; v += step) out.push(v);
      return out;
    },
  });
  map.set('seq_len', {
    kind: 'native-func',
    fn: (args) => {
      const n = Math.max(0, Math.floor(toNum(args[0] ?? null)));
      const out: Value[] = [];
      for (let v = 1; v <= n; v += 1) out.push(v);
      return out;
    },
  });
  map.set('paste', {
    kind: 'native-func',
    fn: (args) => args.map((a) => formatSpec(a ?? null, undefined)).join(' '),
  });
  map.set('ifelse', {
    kind: 'native-func',
    fn: (args) => (truthy(args[0] ?? null) ? args[1] ?? null : args[2] ?? null),
  });
  map.set('sprintf', {
    kind: 'native-func',
    fn: (args) => {
      const fmt = String(args[0] ?? '');
      const rest = args.slice(1);
      let out = '';
      let ai = 0;
      for (let i = 0; i < fmt.length; i += 1) {
        const ch = fmt[i]!;
        if (ch !== '%') {
          out += ch;
          continue;
        }
        if (fmt[i + 1] === '%') {
          out += '%';
          i += 1;
          continue;
        }
        const m = /^%(-)?(\d+)?(?:\.(\d+))?([sdfg])/.exec(fmt.slice(i));
        if (!m) {
          out += ch;
          continue;
        }
        i += m[0].length - 1;
        const v = rest[ai] ?? null;
        ai += 1;
        let text: string;
        if (m[4] === 'd') text = String(Math.round(toNum(v)));
        else if (m[4] === 'f') text = toNum(v).toFixed(m[3] ? Number(m[3]) : 6);
        else text = formatSpec(v, undefined);
        if (m[2] !== undefined) {
          const w = Number(m[2]);
          text = m[1] ? text.padEnd(w, ' ') : text.padStart(w, ' ');
        }
        out += text;
      }
      return out;
    },
  });
  map.set('runif', {
    kind: 'native-func',
    fn: (args) => {
      const n = args.length > 0 ? Math.floor(toNum(args[0]!)) : 1;
      if (n === 1) return studio.random01();
      const out: Value[] = [];
      for (let i = 0; i < n; i += 1) out.push(studio.random01());
      return out;
    },
  });
  map.set('random01', { kind: 'native-func', fn: () => studio.random01() });
  map.set('setSeed', {
    kind: 'native-func',
    fn: (args) => {
      studio.seedRandom(toNum(args[0] ?? null));
      return null;
    },
  });
  return map;
}

export interface InterpreterResult {
  ok: boolean;
  /** Top-level variables, mapped to panel-ready DataValue. */
  variables: Record<string, DataValue>;
  error?: { message: string };
}

function truthy(v: Value): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0; // empty list is falsy (Python)
  return v != null;
}

function toNum(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  throw new Error('expected a number');
}

function applyBinary(op: BinaryOperator, l: Value, r: Value): Value {
  if (op === 'and') return truthy(l) ? r : l;
  if (op === 'or') return truthy(l) ? l : r;
  // String-aware comparisons and concatenation match the codegen exactly.
  if (typeof l === 'string' && typeof r === 'string') {
    switch (op) {
      case '+': return l + r;
      case '==': return l === r;
      case '!=': return l !== r;
      case '<': return l < r;
      case '<=': return l <= r;
      case '>': return l > r;
      case '>=': return l >= r;
    }
  }
  if (op === '+' && (typeof l === 'string' || typeof r === 'string')) {
    return String(l) + String(r);
  }
  // Python semantics (the default codegen dialect): a number and a string are
  // never equal and cannot be ordered. Without this the numeric fallback turned
  // `'5' == 5` into `Number('5') === 5` → true, while the Python codegen emits
  // `('5') == (5)` → False — a silent interpreter/codegen divergence.
  if ((typeof l === 'string') !== (typeof r === 'string')) {
    switch (op) {
      case '==': return false;
      case '!=': return true;
      case '<': case '<=': case '>': case '>=':
        throw new Error(`cannot compare a string with a number using "${op}"`);
    }
  }
  const a = toNum(l);
  const b = toNum(r);
  // JS would return Infinity / NaN here and let it flow silently into every
  // downstream statistic. Python raises, so expose the error instead.
  if (b === 0 && (op === '/' || op === '//' || op === '%')) {
    throw new Error('division by zero');
  }
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return a / b;
    case '//': return Math.floor(a / b);
    case '%': return a % b;
    case '**': return a ** b;
    case '==': return a === b;
    case '!=': return a !== b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
  }
}

function asTable(v: Value): DataTable {
  if (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    isDataTable(v as DataValue) &&
    typeof (v as DataTable).columnNames === 'function'
  ) {
    return v as DataTable;
  }
  throw new Error('expected a DataTable');
}

function asNumberArray(v: Value): number[] {
  if (Array.isArray(v)) return v.map((x) => toNum(x));
  throw new Error('expected a list of numbers');
}

/** Convert an interpreter value into a panel-ready DataValue. */
function toDataValue(v: Value): DataValue | null {
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') {
    return { kind: 'scalar', value: v };
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  if (isRenderedView(v as DataValue)) return v as RenderedView;
  if (isDataTable(v as DataValue)) return v as DataTable;
  return null; // arrays / dicts / functions are not surfaced to the panel
}

export class Interpreter {
  /** Hard cap on user-function recursion depth (see `call`). */
  private static readonly MAX_CALL_DEPTH = 500;

  private scopes: Map<string, Value>[] = [new Map()];
  private readonly builtins: Map<string, NativeFunc>;

  constructor(private readonly studio: StudioApi) {
    this.builtins = createBuiltins(studio);
  }

  private get current(): Map<string, Value> {
    return this.scopes[this.scopes.length - 1]!;
  }

  /** Scope lookup only — no builtins, no dotted fallbacks. */
  private lookup(name: string): Value | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i -= 1) {
      const v = this.scopes[i]!.get(name);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  private resolve(name: string): Value {
    const scoped = this.lookup(name);
    if (scoped !== undefined) return scoped;
    const builtin = this.builtins.get(name);
    if (builtin) return builtin as unknown as Value;
    return this.varRef(name);
  }

  /** Variable reference with dotted-name support (`math.pi`, `df.columns`). */
  private varRef(name: string): Value {
    if (name === 'math.pi') return Math.PI;
    if (name.endsWith('.columns')) {
      const table = this.lookup(name.slice(0, -'.columns'.length));
      if (table !== undefined && isTableValue(table)) {
        // getColumn returns the raw column payload (a typed/number array), not a
        // `{ data }` wrapper — so iterate the payload directly. Each element is
        // a `[name, values]` pair, indexed elsewhere as `[0]`/`[1]`.
        return table.columnNames().map((n): Value => {
          const payload = table.getColumn(n);
          if (payload === undefined || payload === null) return [n, [] as Value[]] as Value;
          const values = Array.from(payload as ArrayLike<unknown>).map((v) =>
            typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'
              ? v
              : String(v),
          ) as Value[];
          return [n, values] as Value;
        });
      }
    }
    throw new Error(`variable "${name}" is not defined`);
  }

  /** Like `resolve` but reports failure with `undefined` (dotted dispatch).
   *
   *  IMPORTANT: callers pass plain variable names (`df`, `out`, `nums`), which
   *  `varRef` would reject (it only knows dotted specials like `math.pi` /
   *  `.columns`) — so we must run the full scope+buitin+cooked-var lookup, and
   *  only swallow the miss. Feeding a dotted name here returns undefined (the
   *  dotted form is dispatched by the caller, not here). */
  private tryVarRef(name: string): Value | undefined {
    try {
      return this.resolve(name);
    } catch {
      return undefined;
    }
  }

  private setVar(name: string, value: Value): void {
    this.current.set(name, value);
  }

  async run(program: IRProgram): Promise<InterpreterResult> {
    try {
      this.scopes = [new Map()];
      for (const fn of program.functions) await this.exec(fn);
      await this.execBlock(program.body);
      return { ok: true, variables: this.panelVariables() };
    } catch (err) {
      return { ok: false, variables: {}, error: { message: err instanceof Error ? err.message : String(err) } };
    }
  }

  private panelVariables(): Record<string, DataValue> {
    const out: Record<string, DataValue> = {};
    const top = this.scopes[0]!;
    for (const [name, value] of top) {
      const dv = toDataValue(value);
      if (dv) out[name] = dv;
    }
    return out;
  }

  private async evalExpr(node: IRNode): Promise<Value> {
    switch (node.kind) {
      case 'Number': return node.value;
      case 'String': return node.value;
      case 'Boolean': return node.value;
      case 'Null': return null;
      case 'VarRef': return this.resolve(node.name);
      case 'List': {
        const items: Value[] = [];
        for (const it of node.items) items.push(await this.evalExpr(it));
        return items;
      }
      case 'ListIndex': {
        const list = await this.evalExpr(node.list);
        const rawIdx = toNum(await this.evalExpr(node.index));
        if (!Array.isArray(list)) throw new Error('ListIndex target is not a list');
        const idx = rawIdx < 0 ? list.length + rawIdx : rawIdx;
        if (idx < 0 || idx >= list.length) return null;
        return list[idx] ?? null;
      }
      case 'ListSlice': {
        const list = await this.evalExpr(node.list);
        if (!Array.isArray(list)) throw new Error('ListSlice target is not a list');
        const n = list.length;
        const step = node.step ? toNum(await this.evalExpr(node.step)) : 1;
        if (step === 0) throw new Error('ListSlice step cannot be zero');
        const rawStart = node.start ? toNum(await this.evalExpr(node.start)) : undefined;
        const rawStop = node.stop ? toNum(await this.evalExpr(node.stop)) : undefined;
        // Python slice semantics. An omitted bound's default depends on the
        // sign of the step: `[::-1]` must walk from the last element down to
        // the first (start n-1, stop "before index 0") instead of collapsing
        // to an empty list because the old code defaulted both to 0/n.
        const clamp = (bound: number | undefined, fallback: number): number => {
          if (bound === undefined) return fallback;
          return bound < 0 ? Math.max(n + bound, -1) : Math.min(bound, n);
        };
        const start = clamp(rawStart, step < 0 ? n - 1 : 0);
        const stop = clamp(rawStop, step < 0 ? -1 : n);
        const out: Value[] = [];
        for (let i = start; step > 0 ? i < stop : i > stop; i += step) {
          if (i >= 0 && i < n) out.push(list[i]!);
        }
        return out;
      }
      case 'Dict': {
        const obj: { [k: string]: Value } = {};
        for (const e of node.entries) obj[e.key] = await this.evalExpr(e.value);
        return obj;
      }
      case 'BinaryOp':
        return applyBinary(node.op, await this.evalExpr(node.left), await this.evalExpr(node.right));
      case 'Ternary':
        return truthy(await this.evalExpr(node.cond))
          ? await this.evalExpr(node.then)
          : await this.evalExpr(node.alt);
      case 'FString': {
        let out = '';
        for (const p of node.parts) {
          if (p.text !== undefined) out += p.text;
          else out += formatSpec(await this.evalExpr(p.expr!), p.spec);
        }
        return out;
      }
      case 'ListComp': {
        const iterVal = await this.evalExpr(node.iter);
        if (!Array.isArray(iterVal)) throw new Error('comprehension iterable must be a list');
        const out: Value[] = [];
        for (const item of iterVal) {
          if (node.vars.length === 1) {
            this.setVar(node.vars[0]!, item);
          } else {
            const parts = Array.isArray(item) ? item : [item];
            node.vars.forEach((v, k) => this.setVar(v, parts[k] ?? null));
          }
          if (node.cond && !truthy(await this.evalExpr(node.cond))) continue;
          out.push(await this.evalExpr(node.body));
        }
        return out;
      }
      case 'Join': {
        const items = await this.evalExpr(node.items);
        if (!Array.isArray(items)) throw new Error('join() expects a list');
        return items.map((v) => formatSpec(v ?? null, undefined)).join(node.sep);
      }
      case 'UnaryOp': {
        const v = await this.evalExpr(node.operand);
        if (node.op === 'not') return !truthy(v);
        return -toNum(v);
      }
      case 'Lambda':
        // An expression-bodied function value: the body returns implicitly.
        return {
          kind: 'func',
          params: node.params,
          body: [{ kind: 'Return', value: node.body }],
        } as unknown as Value;
      case 'Call':
        return this.call(node.callee, await Promise.all(node.args.map((a) => this.evalExpr(a))));
      case 'LoadCSV':
      case 'LoadXYZ':
        return this.studio.load(node.path);
      case 'Random':
        return this.studio.random(
          toNum(await this.evalExpr(node.count)),
          node.seed ? toNum(await this.evalExpr(node.seed)) : undefined,
        );
      case 'Range':
        return this.studio.range(
          toNum(await this.evalExpr(node.start)),
          toNum(await this.evalExpr(node.stop)),
          node.step ? toNum(await this.evalExpr(node.step)) : undefined,
        );
      case 'Filter':
        return this.studio.filter(
          asTable(await this.evalExpr(node.data)),
          node.column,
          node.op as never,
          toNum(await this.evalExpr(node.value)),
        );
      case 'Normalize':
        return this.studio.normalize(
          asTable(await this.evalExpr(node.data)),
          node.column,
          node.mode,
        );
      case 'Sort':
        return this.studio.sort(
          asTable(await this.evalExpr(node.data)),
          node.column,
          node.direction,
        );
      case 'Select':
        return this.studio.select(asTable(await this.evalExpr(node.data)), node.columns);
      case 'AddColumn':
        return this.studio.addColumn(
          asTable(await this.evalExpr(node.data)),
          node.name,
          asNumberArray(await this.evalExpr(node.values)),
        );
      case 'Summary':
        return this.studio.summary(asTable(await this.evalExpr(node.data)), node.column);
      case 'Histogram':
        return this.studio.histogram(
          asTable(await this.evalExpr(node.data)),
          node.column,
          toNum(await this.evalExpr(node.bins)),
        );
      case 'GpuRun':
        throw new Error('GPU blocks are not supported yet');
      case 'StudioCall':
        return this.dispatchStudio(node.method, await Promise.all(node.args.map((a) => this.evalExpr(a))));
      case 'RawCode':
        return null; // preserved, not executed (block mode)
      case 'RawExpr':
        return null; // preserved, not executed (block mode)
      default:
        throw new Error(`node kind "${(node as IRNode).kind}" is not an expression`);
    }
  }

  private async dispatchStudio(method: string, args: Value[]): Promise<Value> {
    const studio = this.studio as unknown as Record<string, unknown>;
    const fn = studio[method];
    if (typeof fn !== 'function') throw new Error(`studio.${method} is not a function`);
    return (await (fn as (...a: unknown[]) => unknown).apply(this.studio, args)) as Value;
  }

  private async call(callee: string, args: Value[]): Promise<Value> {
    // Dotted callees (stdlib modules, method-style ops) dispatch first; a
    // user-defined function whose name contains a dot falls through.
    if (callee.includes('.')) {
      const dotted = await this.callDotted(callee, args);
      if (dotted !== UNRESOLVED) return dotted;
    }
    const fn = this.resolve(callee);
    if (isNativeFunc(fn)) return await fn.fn(args);
    if (!fn || typeof fn !== 'object' || (fn as unknown as FuncValue).kind !== 'func') {
      throw new Error(`"${callee}" is not a function`);
    }
    // `Repeat`/`While` are capped at 1e6 iterations, but a self-recursive
    // function (`def f(): f()`) had no limit and blew the JS stack — which
    // surfaces as an unlocatable "Maximum call stack size exceeded".
    const depth = this.scopes.length - 1;
    if (depth >= Interpreter.MAX_CALL_DEPTH) {
      throw new Error(
        `call depth exceeded ${Interpreter.MAX_CALL_DEPTH} calling "${callee}" (recursion without a base case?)`,
      );
    }
    const func = fn as unknown as FuncValue;
    const scope = new Map<string, Value>();
    func.params.forEach((p, i) => scope.set(p, args[i] ?? null));
    this.scopes.push(scope);
    try {
      const sig = await this.execBlock(func.body);
      if (sig.type === 'return') return sig.value;
      return null;
    } finally {
      this.scopes.pop();
    }
  }

  /** Dispatch a dotted callee (`math.sqrt`, `random.seed`, `out.append`,
   *  `df.column_names`, `_random.Random(i).random`). Returns UNRESOLVED when
   *  the callee is not a runtime-known dotted form. */
  private async callDotted(callee: string, args: Value[]): Promise<Value | typeof UNRESOLVED> {
    // python `math.*` module functions share the bare builtin table.
    if (callee.startsWith('math.')) {
      const fn = this.builtins.get(callee.slice('math.'.length));
      if (!fn) throw new Error(`unsupported call "${callee}"`);
      return await fn.fn(args);
    }
    // Seeding the shared deterministic engine.
    if (callee === 'random.seed' || callee === 'set.seed') {
      this.studio.seedRandom(toNum(args[0] ?? null));
      return null;
    }
    // A bare uniform draw (python random.random / converted rng.random()).
    if (callee === 'random.random') return this.studio.random01();
    // `_random.Random(i).random()` — chain-flattened with the seed merged
    // into args[0]; also matches any `x.random()` converted form.
    if (/^[A-Za-z_][\w$.]*\.random$/.test(callee)) {
      if (args.length > 0) this.studio.seedRandom(toNum(args[0]!));
      return this.studio.random01();
    }
    // `_random.Random(seed)` — seeds the engine; no object is bound (R/JS
    // semantics; the binding value is unused by converted programs).
    if (/\.Random$/.test(callee) && args.length === 1) {
      this.studio.seedRandom(toNum(args[0]!));
      return null;
    }
    // `out.append(x)` — python list growth.
    if (callee.endsWith('.append') && args.length === 1) {
      const target = this.tryVarRef(callee.slice(0, -'.append'.length));
      if (!Array.isArray(target)) throw new Error('.append target is not a list');
      target.push(args[0]!);
      return null;
    }
    // Generic `obj.method(...)`: DataTable methods (snake_case → camelCase)
    // and plain property functions on dicts.
    const dot = callee.lastIndexOf('.');
    const base = this.tryVarRef(callee.slice(0, dot));
    if (base !== undefined && base !== null && typeof base === 'object') {
      const method = callee
        .slice(dot + 1)
        .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      const fn = (base as unknown as Record<string, unknown>)[method];
      if (typeof fn === 'function') {
        return (await (fn as (...a: unknown[]) => unknown).apply(base, args)) as Value;
      }
    }
    return UNRESOLVED;
  }

  private async execBlock(nodes: IRNode[]): Promise<Signal> {
    for (const node of nodes) {
      const sig = await this.exec(node);
      if (sig.type !== 'normal') return sig;
    }
    return { type: 'normal' };
  }

  private async exec(node: IRNode): Promise<Signal> {
    switch (node.kind) {
      case 'VarAssign': {
        const value = await this.evalExpr(node.value);
        this.setVar(node.name, value);
        return { type: 'normal' };
      }
      case 'PlotScatter':
        await this.studio.plot('scatter', asTable(await this.evalExpr(node.data)), { x: node.x, y: node.y, ...(node.color ? { color: node.color } : {}) });
        return { type: 'normal' };
      case 'PlotLine':
        await this.studio.plot('line', asTable(await this.evalExpr(node.data)), { x: node.x, y: node.y });
        return { type: 'normal' };
      case 'PlotHistogram':
        await this.studio.plot('histogram', asTable(await this.evalExpr(node.data)), { column: node.column });
        return { type: 'normal' };
      case 'PlotPointCloud':
        await this.studio.plot('pointcloud', asTable(await this.evalExpr(node.data)), { x: node.x, y: node.y, z: node.z });
        return { type: 'normal' };
      case 'If': {
        for (const branch of node.branches) {
          if (truthy(await this.evalExpr(branch.cond))) {
            return this.execBlock(branch.body);
          }
        }
        if (node.elseBody) return this.execBlock(node.elseBody);
        return { type: 'normal' };
      }
      case 'Repeat': {
        const raw = Math.floor(toNum(await this.evalExpr(node.count)));
        const count = Number.isFinite(raw) ? Math.max(0, raw) : 0;
        if (count > 1_000_000) throw new Error(`repeat exceeded 1,000,000 iterations (got ${count})`);
        for (let i = 0; i < count; i += 1) {
          const sig = await this.execBlock(node.body);
          if (sig.type === 'break') break;
          if (sig.type === 'continue') continue;
          if (sig.type === 'return') return sig;
        }
        return { type: 'normal' };
      }
      case 'While': {
        let guard = 0;
        while (truthy(await this.evalExpr(node.cond))) {
          if (++guard > 1_000_000) throw new Error('while loop exceeded 1,000,000 iterations');
          const sig = await this.execBlock(node.body);
          if (sig.type === 'break') break;
          if (sig.type === 'return') return sig;
        }
        return { type: 'normal' };
      }
      case 'ForEach': {
        const iterable = await this.evalExpr(node.iterable);
        const items = Array.isArray(iterable)
          ? iterable
          : isDataTable(iterable as DataValue) && typeof (iterable as DataTable).columnNames === 'function'
            ? (iterable as DataTable).columnNames()
            : iterable;
        if (!Array.isArray(items)) throw new Error('ForEach iterable must be a list or DataTable');
        for (const item of items) {
          this.setVar(node.varName, item as Value);
          const sig = await this.execBlock(node.body);
          if (sig.type === 'break') break;
          if (sig.type === 'continue') continue;
          if (sig.type === 'return') return sig;
        }
        return { type: 'normal' };
      }
      case 'Break':
        return { type: 'break' };
      case 'Continue':
        return { type: 'continue' };
      case 'FuncDef': {
        this.setVar(node.name, { kind: 'func', params: node.params, body: node.body } as unknown as Value);
        return { type: 'normal' };
      }
      case 'Return': {
        const value = node.value ? await this.evalExpr(node.value) : null;
        return { type: 'return', value };
      }
      case 'StudioCall': {
        await this.dispatchStudio(node.method, await Promise.all(node.args.map((a) => this.evalExpr(a))));
        return { type: 'normal' };
      }
      case 'RawCode':
        return { type: 'normal' }; // preserved, not executed
      case 'Import':
        // Imports bind nothing in the studio runtime (stdlib is ambient).
        return { type: 'normal' };
      case 'Call': {
        await this.call(node.callee, await Promise.all(node.args.map((a) => this.evalExpr(a))));
        return { type: 'normal' };
      }
      default:
        // A bare expression statement — evaluate for side effects.
        await this.evalExpr(node);
        return { type: 'normal' };
    }
  }
}

/** Execute an IR program against a StudioApi, returning panel-ready variables. */
export async function interpret(program: IRProgram, studio: StudioApi): Promise<InterpreterResult> {
  return new Interpreter(studio).run(program);
}
