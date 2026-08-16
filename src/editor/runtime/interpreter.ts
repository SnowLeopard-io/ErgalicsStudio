// ==========================================================================
// Ergalics Studio — IR interpreter (block mode execution)
//
// Executes an IRProgram directly against the injected StudioApi. It is the
// block-mode runtime (block-code-modes.md §8.1 "editor-js" path), and shares
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
  const a = toNum(l);
  const b = toNum(r);
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
  private scopes: Map<string, Value>[] = [new Map()];

  constructor(private readonly studio: StudioApi) {}

  private get current(): Map<string, Value> {
    return this.scopes[this.scopes.length - 1]!;
  }

  private resolve(name: string): Value {
    for (let i = this.scopes.length - 1; i >= 0; i -= 1) {
      const v = this.scopes[i]!.get(name);
      if (v !== undefined) return v;
    }
    throw new Error(`variable "${name}" is not defined`);
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
      case 'UnaryOp': {
        const v = await this.evalExpr(node.operand);
        if (node.op === 'not') return !truthy(v);
        return -toNum(v);
      }
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
    const fn = this.resolve(callee);
    if (!fn || typeof fn !== 'object' || (fn as unknown as FuncValue).kind !== 'func') {
      throw new Error(`"${callee}" is not a function`);
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
