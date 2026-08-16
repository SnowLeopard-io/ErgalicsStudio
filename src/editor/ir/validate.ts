// ==========================================================================
// Ergalics Studio — IR structural validation
//
// Purely structural checks (shape + required fields). It intentionally does
// NOT do semantic/type analysis — that is deferred (see block-code-modes.md
// open question #1). Validators return diagnostics rather than throwing so
// the sync engine can surface partial failures instead of aborting.
// ==========================================================================

import { IR_VERSION, isFuncDef, type IRDiagnostic, type IRNode, type IRProgram } from './types';
import { hashIR } from './hash';

function diag(path: string, message: string): IRDiagnostic {
  return { path, message };
}

const BINARY_OPS = new Set([
  '+', '-', '*', '/', '//', '%', '**',
  '==', '!=', '<', '<=', '>', '>=',
  'and', 'or',
]);

/** Operators a column Filter node may use (comparisons only). */
const COMPARE_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);

function validateNode(node: unknown, path: string, out: IRDiagnostic[]): void {
  if (node === null || typeof node !== 'object') {
    out.push(diag(path, 'node must be an object'));
    return;
  }
  const n = node as IRNode;
  if (typeof n.kind !== 'string') {
    out.push(diag(path, 'node is missing a string "kind"'));
    return;
  }

  switch (n.kind) {
    case 'Number':
      if (typeof n.value !== 'number' || !Number.isFinite(n.value)) {
        out.push(diag(path, 'Number.value must be a finite number'));
      }
      break;
    case 'String':
      if (typeof n.value !== 'string') out.push(diag(path, 'String.value must be a string'));
      break;
    case 'Boolean':
      if (typeof n.value !== 'boolean') out.push(diag(path, 'Boolean.value must be a boolean'));
      break;
    case 'Null':
      break;
    case 'VarRef':
    case 'VarAssign':
      if (typeof n.name !== 'string' || n.name.length === 0) {
        out.push(diag(path, `${n.kind}.name must be a non-empty string`));
      }
      if (n.kind === 'VarAssign') {
        if (typeof n.declare !== 'boolean') out.push(diag(path, 'VarAssign.declare must be a boolean'));
        validateNode(n.value, `${path}.value`, out);
      }
      break;
    case 'List':
      if (!Array.isArray(n.items)) out.push(diag(path, 'List.items must be an array'));
      else n.items.forEach((it, i) => validateNode(it, `${path}.items[${i}]`, out));
      break;
    case 'ListIndex':
      validateNode(n.list, `${path}.list`, out);
      validateNode(n.index, `${path}.index`, out);
      break;
    case 'ListSlice':
      validateNode(n.list, `${path}.list`, out);
      if (n.start !== undefined) validateNode(n.start, `${path}.start`, out);
      if (n.stop !== undefined) validateNode(n.stop, `${path}.stop`, out);
      if (n.step !== undefined) validateNode(n.step, `${path}.step`, out);
      break;
    case 'Dict':
      if (!Array.isArray(n.entries)) out.push(diag(path, 'Dict.entries must be an array'));
      else {
        const seen = new Set<string>();
        n.entries.forEach((e, i) => {
          // A null entry previously crashed here on `e.value`; report it as a
          // diagnostic instead of throwing.
          if (e === null || typeof e !== 'object') {
            out.push(diag(`${path}.entries[${i}]`, 'Dict entry must be an object'));
            return;
          }
          if (typeof e.key !== 'string' || e.key.length === 0) {
            out.push(diag(`${path}.entries[${i}]`, 'Dict entry key must be a non-empty string'));
          } else if (seen.has(e.key)) {
            out.push(diag(`${path}.entries[${i}]`, `duplicate Dict key "${e.key}"`));
          } else {
            seen.add(e.key);
          }
          validateNode(e.value, `${path}.entries[${i}].value`, out);
        });
      }
      break;
    case 'BinaryOp':
      if (!BINARY_OPS.has(n.op)) out.push(diag(path, `unknown binary operator "${String(n.op)}"`));
      validateNode(n.left, `${path}.left`, out);
      validateNode(n.right, `${path}.right`, out);
      break;
    case 'UnaryOp':
      if (n.op !== '-' && n.op !== 'not') out.push(diag(path, `unknown unary operator "${String(n.op)}"`));
      validateNode(n.operand, `${path}.operand`, out);
      break;
    case 'If':
      if (!Array.isArray(n.branches) || n.branches.length === 0) {
        out.push(diag(path, 'If.branches must be a non-empty array'));
      } else {
        n.branches.forEach((b, i) => {
          // A null branch previously crashed here on `b.cond`; diagnose it.
          if (b === null || typeof b !== 'object') {
            out.push(diag(`${path}.branches[${i}]`, 'branch must be an object'));
            return;
          }
          validateNode(b.cond, `${path}.branches[${i}].cond`, out);
          if (!Array.isArray(b.body)) out.push(diag(`${path}.branches[${i}].body`, 'branch body must be an array'));
          else b.body.forEach((s, j) => validateNode(s, `${path}.branches[${i}].body[${j}]`, out));
        });
      }
      if (n.elseBody !== undefined) {
        if (!Array.isArray(n.elseBody)) out.push(diag(path, 'If.elseBody must be an array'));
        else n.elseBody.forEach((s, i) => validateNode(s, `${path}.elseBody[${i}]`, out));
      }
      break;
    case 'Repeat':
      validateNode(n.count, `${path}.count`, out);
      if (!Array.isArray(n.body)) out.push(diag(path, 'Repeat.body must be an array'));
      else n.body.forEach((s, i) => validateNode(s, `${path}.body[${i}]`, out));
      break;
    case 'While':
      validateNode(n.cond, `${path}.cond`, out);
      if (!Array.isArray(n.body)) out.push(diag(path, 'While.body must be an array'));
      else n.body.forEach((s, i) => validateNode(s, `${path}.body[${i}]`, out));
      break;
    case 'ForEach':
      if (typeof n.varName !== 'string' || n.varName.length === 0) {
        out.push(diag(path, 'ForEach.varName must be a non-empty string'));
      }
      validateNode(n.iterable, `${path}.iterable`, out);
      if (!Array.isArray(n.body)) out.push(diag(path, 'ForEach.body must be an array'));
      else n.body.forEach((s, i) => validateNode(s, `${path}.body[${i}]`, out));
      break;
    case 'Break':
    case 'Continue':
      break;
    case 'FuncDef':
      if (typeof n.name !== 'string' || n.name.length === 0) {
        out.push(diag(path, 'FuncDef.name must be a non-empty string'));
      }
      if (!Array.isArray(n.params)) out.push(diag(path, 'FuncDef.params must be an array'));
      else n.params.forEach((p, i) => {
        if (typeof p !== 'string' || p.length === 0) out.push(diag(`${path}.params[${i}]`, 'param must be a non-empty string'));
      });
      if (!Array.isArray(n.body)) out.push(diag(path, 'FuncDef.body must be an array'));
      else n.body.forEach((s, i) => validateNode(s, `${path}.body[${i}]`, out));
      break;
    case 'Return':
      if (n.value !== undefined) validateNode(n.value, `${path}.value`, out);
      break;
    case 'Call':
      if (typeof n.callee !== 'string' || n.callee.length === 0) {
        out.push(diag(path, 'Call.callee must be a non-empty string'));
      }
      if (!Array.isArray(n.args)) out.push(diag(path, 'Call.args must be an array'));
      else n.args.forEach((a, i) => validateNode(a, `${path}.args[${i}]`, out));
      break;
    case 'LoadCSV':
    case 'LoadXYZ':
      if (typeof n.path !== 'string' || n.path.length === 0) {
        out.push(diag(path, `${n.kind}.path must be a non-empty string`));
      }
      break;
    case 'Random':
      validateNode(n.count, `${path}.count`, out);
      if (n.seed !== undefined) validateNode(n.seed, `${path}.seed`, out);
      break;
    case 'Range':
      validateNode(n.start, `${path}.start`, out);
      validateNode(n.stop, `${path}.stop`, out);
      if (n.step !== undefined) validateNode(n.step, `${path}.step`, out);
      break;
    case 'Filter':
      validateNode(n.data, `${path}.data`, out);
      if (typeof n.column !== 'string' || n.column.length === 0) out.push(diag(path, 'Filter.column must be a non-empty string'));
      // A Filter can only use comparison operators; validating against the
      // arithmetic set would accept `+`/`*`, which the runtime rejects.
      if (!COMPARE_OPS.has(n.op)) out.push(diag(path, `unknown filter operator "${String(n.op)}"`));
      validateNode(n.value, `${path}.value`, out);
      break;
    case 'Normalize':
      validateNode(n.data, `${path}.data`, out);
      if (typeof n.column !== 'string' || n.column.length === 0) out.push(diag(path, 'Normalize.column must be a non-empty string'));
      if (n.mode !== 'minmax' && n.mode !== 'zscore') out.push(diag(path, `unknown normalize mode "${String(n.mode)}"`));
      break;
    case 'Sort':
      validateNode(n.data, `${path}.data`, out);
      if (typeof n.column !== 'string' || n.column.length === 0) out.push(diag(path, 'Sort.column must be a non-empty string'));
      if (n.direction !== 'asc' && n.direction !== 'desc') out.push(diag(path, `unknown sort direction "${String(n.direction)}"`));
      break;
    case 'Select':
      validateNode(n.data, `${path}.data`, out);
      if (!Array.isArray(n.columns) || n.columns.length === 0) out.push(diag(path, 'Select.columns must be a non-empty array'));
      else n.columns.forEach((c, i) => {
        if (typeof c !== 'string' || c.length === 0) out.push(diag(`${path}.columns[${i}]`, 'column must be a non-empty string'));
      });
      break;
    case 'AddColumn':
      validateNode(n.data, `${path}.data`, out);
      if (typeof n.name !== 'string' || n.name.length === 0) out.push(diag(path, 'AddColumn.name must be a non-empty string'));
      validateNode(n.values, `${path}.values`, out);
      break;
    case 'Summary':
      validateNode(n.data, `${path}.data`, out);
      if (typeof n.column !== 'string' || n.column.length === 0) out.push(diag(path, 'Summary.column must be a non-empty string'));
      break;
    case 'Histogram':
      validateNode(n.data, `${path}.data`, out);
      if (typeof n.column !== 'string' || n.column.length === 0) out.push(diag(path, 'Histogram.column must be a non-empty string'));
      validateNode(n.bins, `${path}.bins`, out);
      break;
    case 'PlotScatter':
      validateNode(n.data, `${path}.data`, out);
      if (typeof n.x !== 'string' || n.x.length === 0) out.push(diag(path, 'PlotScatter.x must be a non-empty string'));
      if (typeof n.y !== 'string' || n.y.length === 0) out.push(diag(path, 'PlotScatter.y must be a non-empty string'));
      break;
    case 'PlotLine':
      validateNode(n.data, `${path}.data`, out);
      if (typeof n.x !== 'string' || n.x.length === 0) out.push(diag(path, 'PlotLine.x must be a non-empty string'));
      if (typeof n.y !== 'string' || n.y.length === 0) out.push(diag(path, 'PlotLine.y must be a non-empty string'));
      break;
    case 'PlotHistogram':
      validateNode(n.data, `${path}.data`, out);
      if (typeof n.column !== 'string' || n.column.length === 0) out.push(diag(path, 'PlotHistogram.column must be a non-empty string'));
      break;
    case 'PlotPointCloud':
      validateNode(n.data, `${path}.data`, out);
      if (typeof n.x !== 'string' || n.x.length === 0) out.push(diag(path, 'PlotPointCloud.x must be a non-empty string'));
      if (typeof n.y !== 'string' || n.y.length === 0) out.push(diag(path, 'PlotPointCloud.y must be a non-empty string'));
      if (typeof n.z !== 'string' || n.z.length === 0) out.push(diag(path, 'PlotPointCloud.z must be a non-empty string'));
      break;
    case 'GpuRun':
      if (typeof n.kernel !== 'string' || n.kernel.length === 0) out.push(diag(path, 'GpuRun.kernel must be a non-empty string'));
      if (!Array.isArray(n.args)) out.push(diag(path, 'GpuRun.args must be an array'));
      else n.args.forEach((a, i) => validateNode(a, `${path}.args[${i}]`, out));
      break;
    case 'StudioCall':
      if (typeof n.method !== 'string' || n.method.length === 0) out.push(diag(path, 'StudioCall.method must be a non-empty string'));
      if (!Array.isArray(n.args)) out.push(diag(path, 'StudioCall.args must be an array'));
      else n.args.forEach((a, i) => validateNode(a, `${path}.args[${i}]`, out));
      break;
    case 'RawCode':
      if (n.lang !== 'python' && n.lang !== 'r' && n.lang !== 'js') out.push(diag(path, `unknown RawCode lang "${String(n.lang)}"`));
      if (typeof n.text !== 'string') out.push(diag(path, 'RawCode.text must be a string'));
      break;
    default:
      out.push(diag(path, `unknown node kind "${String((n as { kind?: string }).kind)}"`));
  }
}

/**
 * Validate a program's shape and (optionally) its hash consistency. Returns
 * an empty array when the program is valid.
 */
export function validateIR(program: IRProgram, opts?: { checkHash?: boolean }): IRDiagnostic[] {
  const out: IRDiagnostic[] = [];
  if (program.version !== IR_VERSION) {
    out.push(diag('$', `unsupported IR version ${String(program.version)} (expected ${IR_VERSION})`));
  }
  if (!Array.isArray(program.body)) {
    out.push(diag('$.body', 'body must be an array'));
  } else {
    program.body.forEach((node, i) => validateNode(node, `$.body[${i}]`, out));
  }
  if (!Array.isArray(program.functions)) {
    out.push(diag('$.functions', 'functions must be an array'));
  } else {
    program.functions.forEach((node, i) => {
      validateNode(node, `$.functions[${i}]`, out);
      if (!isFuncDef(node)) out.push(diag(`$.functions[${i}]`, 'functions may only contain FuncDef nodes'));
    });
  }
  if (opts?.checkHash && typeof program.hash === 'string' && program.hash.length > 0) {
    const expected = hashIR(program);
    if (expected !== program.hash) {
      out.push(diag('$.hash', `hash mismatch (expected ${expected}, got ${program.hash})`));
    }
  }
  return out;
}
