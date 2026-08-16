// ==========================================================================
// Ergalics Studio — Blockly JSON ⇄ IR converter (block mode)
//
// The pure, testable heart of the block⇄IR bridge. It operates on plain
// Blockly serialization JSON (not live Block objects) so it can run in Node
// and round-trips without a DOM. The browser engine (engine.ts) is a thin
// wrapper: it saves a workspace to JSON, converts here, and loads back.
//
// block → IR uses `blockJSONToIR` / `workspaceJSONToIR`;
// IR → block uses `irToBlockJSON` / `irToWorkspaceJSON`.
// ==========================================================================

import { makeProgram, type BinaryOperator, type IRNode, type IRProgram } from '../ir/types';
import { codegenJS } from '../codegen/js';

// ---- Blockly JSON shapes (loosely typed — Blockly's serializer is untyped) ----

export interface BlockJSON {
  type?: string;
  id?: string;
  x?: number;
  y?: number;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockJSON; shadow?: BlockJSON }>;
  next?: { block?: BlockJSON };
}

export interface WorkspaceJSON {
  blocks?: { languageVersion?: number; blocks?: BlockJSON[] };
}

// ---- helpers ----

function fieldStr(b: BlockJSON, name: string): string {
  return String(b.fields?.[name] ?? '');
}

function inputBlock(b: BlockJSON, name: string): BlockJSON | undefined {
  const input = b.inputs?.[name];
  // A connected block takes precedence; fall back to the shadow (default)
  // block so unconfigured inputs still round-trip with their default value.
  return input?.block ?? input?.shadow;
}

function requireIR(node: BlockJSON | undefined, what: string): IRNode {
  if (!node) throw new Error(`block is missing input "${what}"`);
  return blockJSONToIR(node);
}

/** Walk a `next` chain into an IR statement list. */
function chainToIR(first: BlockJSON | undefined): IRNode[] {
  const out: IRNode[] = [];
  let cur = first;
  while (cur) {
    out.push(blockJSONToIR(cur));
    cur = cur.next?.block;
  }
  return out;
}

// ---- block JSON → IR ----

export function blockJSONToIR(b: BlockJSON): IRNode {
  const type = b.type ?? '';
  switch (type) {
    // literals
    case 'studio_number':
      return { kind: 'Number', value: Number(b.fields?.['NUM'] ?? 0) };
    case 'studio_string':
      return { kind: 'String', value: fieldStr(b, 'STR') };
    case 'studio_boolean':
      return { kind: 'Boolean', value: fieldStr(b, 'BOOL') === 'true' };
    // variables
    case 'studio_var':
      return { kind: 'VarRef', name: fieldStr(b, 'NAME') };
    case 'studio_var_assign':
      return { kind: 'VarAssign', name: fieldStr(b, 'NAME'), value: requireIR(inputBlock(b, 'VALUE'), 'VALUE'), declare: true };
    // data sources
    case 'studio_load_csv':
      return { kind: 'LoadCSV', path: fieldStr(b, 'PATH') };
    case 'studio_load_xyz':
      return { kind: 'LoadXYZ', path: fieldStr(b, 'PATH') };
    case 'studio_random': {
      const count = requireIR(inputBlock(b, 'COUNT'), 'COUNT');
      const seedBlock = inputBlock(b, 'SEED');
      return { kind: 'Random', count, ...(seedBlock ? { seed: blockJSONToIR(seedBlock) } : {}) };
    }
    case 'studio_range': {
      const start = requireIR(inputBlock(b, 'START'), 'START');
      const stop = requireIR(inputBlock(b, 'STOP'), 'STOP');
      const stepBlock = inputBlock(b, 'STEP');
      return { kind: 'Range', start, stop, ...(stepBlock ? { step: blockJSONToIR(stepBlock) } : {}) };
    }
    case 'studio_list': {
      const items = fieldStr(b, 'VALUES')
        .split(/[\s,]+/)
        .filter((s) => s.length > 0)
        // Skip tokens that do not parse to a number: `Number('abc')` would
        // otherwise produce a NaN literal, which IR validation rejects.
        .filter((s) => Number.isFinite(Number(s)))
        .map((s) => ({ kind: 'Number', value: Number(s) } as IRNode));
      return { kind: 'List', items };
    }
    case 'studio_list_index':
      return { kind: 'ListIndex', list: requireIR(inputBlock(b, 'LIST'), 'LIST'), index: requireIR(inputBlock(b, 'INDEX'), 'INDEX') };
    // operators
    case 'studio_math_op':
    case 'studio_compare':
    case 'studio_logic_op': {
      const op = fieldStr(b, 'OP') as BinaryOperator;
      return {
        kind: 'BinaryOp',
        op,
        left: requireIR(inputBlock(b, 'A'), 'A'),
        right: requireIR(inputBlock(b, 'B'), 'B'),
      };
    }
    case 'studio_unary': {
      const op = fieldStr(b, 'OP') === 'not' ? 'not' : '-';
      return { kind: 'UnaryOp', op, operand: requireIR(inputBlock(b, 'A'), 'A') };
    }
    // transforms
    case 'studio_normalize':
      return {
        kind: 'Normalize',
        data: requireIR(inputBlock(b, 'DATA'), 'DATA'),
        column: fieldStr(b, 'COLUMN'),
        mode: fieldStr(b, 'MODE') === 'zscore' ? 'zscore' : 'minmax',
      };
    case 'studio_sort':
      return {
        kind: 'Sort',
        data: requireIR(inputBlock(b, 'DATA'), 'DATA'),
        column: fieldStr(b, 'COLUMN'),
        direction: fieldStr(b, 'DIR') === 'desc' ? 'desc' : 'asc',
      };
    case 'studio_select': {
      const columns = fieldStr(b, 'COLUMNS')
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      return { kind: 'Select', data: requireIR(inputBlock(b, 'DATA'), 'DATA'), columns };
    }
    case 'studio_filter':
      return {
        kind: 'Filter',
        data: requireIR(inputBlock(b, 'DATA'), 'DATA'),
        column: fieldStr(b, 'COLUMN'),
        op: fieldStr(b, 'OP') as BinaryOperator,
        value: requireIR(inputBlock(b, 'VALUE'), 'VALUE'),
      };
    // statistics
    case 'studio_summary':
      return { kind: 'Summary', data: requireIR(inputBlock(b, 'DATA'), 'DATA'), column: fieldStr(b, 'COLUMN') };
    case 'studio_histogram':
      return {
        kind: 'Histogram',
        data: requireIR(inputBlock(b, 'DATA'), 'DATA'),
        column: fieldStr(b, 'COLUMN'),
        bins: requireIR(inputBlock(b, 'BINS'), 'BINS'),
      };
    // visualization
    case 'studio_plot_scatter': {
      const color = fieldStr(b, 'COLOR');
      return {
        kind: 'PlotScatter',
        data: requireIR(inputBlock(b, 'DATA'), 'DATA'),
        x: fieldStr(b, 'X'),
        y: fieldStr(b, 'Y'),
        ...(color ? { color } : {}),
      };
    }
    case 'studio_plot_histogram':
      return { kind: 'PlotHistogram', data: requireIR(inputBlock(b, 'DATA'), 'DATA'), column: fieldStr(b, 'COLUMN') };
    case 'studio_plot_pointcloud':
      return {
        kind: 'PlotPointCloud',
        data: requireIR(inputBlock(b, 'DATA'), 'DATA'),
        x: fieldStr(b, 'X'),
        y: fieldStr(b, 'Y'),
        z: fieldStr(b, 'Z'),
      };
    case 'studio_line':
      return {
        kind: 'PlotLine',
        data: requireIR(inputBlock(b, 'DATA'), 'DATA'),
        x: fieldStr(b, 'X'),
        y: fieldStr(b, 'Y'),
      };
    // control
    case 'studio_repeat':
      return { kind: 'Repeat', count: requireIR(inputBlock(b, 'COUNT'), 'COUNT'), body: chainToIR(inputBlock(b, 'DO')) };
    case 'studio_while':
      return { kind: 'While', cond: requireIR(inputBlock(b, 'COND'), 'COND'), body: chainToIR(inputBlock(b, 'DO')) };
    case 'studio_for_each':
      return {
        kind: 'ForEach',
        varName: fieldStr(b, 'VAR'),
        iterable: requireIR(inputBlock(b, 'LIST'), 'LIST'),
        body: chainToIR(inputBlock(b, 'DO')),
      };
    case 'studio_if': {
      const cond = requireIR(inputBlock(b, 'COND'), 'COND');
      const body = chainToIR(inputBlock(b, 'DO'));
      const elseBody = chainToIR(inputBlock(b, 'ELSE'));
      return { kind: 'If', branches: [{ cond, body }], ...(elseBody.length > 0 ? { elseBody } : {}) };
    }
    // host / raw
    case 'studio_print':
      return { kind: 'StudioCall', method: 'print', args: [requireIR(inputBlock(b, 'TEXT'), 'TEXT')] };
    case 'studio_raw': {
      const lang = fieldStr(b, 'LANG');
      return {
        kind: 'RawCode',
        // The lang is persisted in a LANG field; default to 'js' so older
        // workspaces (no LANG) still round-trip.
        lang: lang === 'python' || lang === 'r' ? lang : 'js',
        text: fieldStr(b, 'TEXT'),
      };
    }
    default:
      throw new Error(`unknown block type "${type}"`);
  }
}

/**
 * Convert a serialized Blockly workspace into an IR program.
 *
 * Execution is gated by the `studio_run` "运行时" hat block — the unique
 * entry point. Only blocks chained under a run hat become the program body;
 * any floating/orphan blocks are ignored, so broken code never runs.
 */
export function workspaceJSONToIR(ws: WorkspaceJSON): IRProgram {
  const body: IRNode[] = [];
  for (const top of ws.blocks?.blocks ?? []) {
    if (top.type !== 'studio_run') continue; // ignore orphaned blocks
    body.push(...chainToIR(top.next?.block));
  }
  return makeProgram(body, [], 'js');
}

// ---- IR → block JSON ----

const COMPARISON_OPS = new Set(['==', '!=', '<', '<=', '>', '>=']);

function valueBlock(type: string, fields: Record<string, unknown>, inputs: Record<string, { block?: BlockJSON }> = {}): BlockJSON {
  return { type, fields, inputs };
}

function statementBlock(type: string, fields: Record<string, unknown>, inputs: Record<string, { block?: BlockJSON }> = {}): BlockJSON {
  return { type, fields, inputs };
}

function irChain(nodes: IRNode[]): BlockJSON | undefined {
  let head: BlockJSON | undefined;
  let tail: BlockJSON | undefined;
  for (const n of nodes) {
    const b = irToBlockJSON(n);
    if (!head) head = b;
    else tail!.next = { block: b };
    tail = b;
  }
  return head;
}

function stmtInput(nodes: IRNode[]): { block?: BlockJSON } {
  const head = irChain(nodes);
  return head ? { block: head } : {};
}

export function irToBlockJSON(node: IRNode): BlockJSON {
  switch (node.kind) {
    case 'Number':
      return valueBlock('studio_number', { NUM: node.value });
    case 'String':
      return valueBlock('studio_string', { STR: node.value });
    case 'Boolean':
      return valueBlock('studio_boolean', { BOOL: node.value ? 'true' : 'false' });
    case 'VarRef':
      return valueBlock('studio_var', { NAME: node.name });
    case 'LoadCSV':
      return valueBlock('studio_load_csv', { PATH: node.path });
    case 'LoadXYZ':
      return valueBlock('studio_load_xyz', { PATH: node.path });
    case 'Random':
      return valueBlock('studio_random', {}, {
        COUNT: { block: irToBlockJSON(node.count) },
        ...(node.seed ? { SEED: { block: irToBlockJSON(node.seed) } } : {}),
      });
    case 'Range':
      return valueBlock('studio_range', {}, {
        START: { block: irToBlockJSON(node.start) },
        STOP: { block: irToBlockJSON(node.stop) },
        ...(node.step ? { STEP: { block: irToBlockJSON(node.step) } } : {}),
      });
    case 'List':
      // The block only expresses numeric lists; a non-Number item would be
      // silently rewritten to `0`, so degrade the whole list to raw code.
      if (node.items.every((i) => i.kind === 'Number')) {
        return valueBlock('studio_list', {
          VALUES: node.items.map((i) => (i.kind === 'Number' ? String(i.value) : '0')).join(','),
        });
      }
      return rawFallback(node);
    case 'ListIndex':
      return valueBlock('studio_list_index', {}, {
        LIST: { block: irToBlockJSON(node.list) },
        INDEX: { block: irToBlockJSON(node.index) },
      });
    case 'BinaryOp': {
      // The math dropdown only exposes + - * / %; `//` and `**` must degrade
      // to raw code instead of writing an invalid dropdown value.
      if (node.op === '//' || node.op === '**') return rawFallback(node);
      const type =
        node.op === 'and' || node.op === 'or'
          ? 'studio_logic_op'
          : COMPARISON_OPS.has(node.op)
            ? 'studio_compare'
            : 'studio_math_op';
      return valueBlock(type, { OP: node.op }, {
        A: { block: irToBlockJSON(node.left) },
        B: { block: irToBlockJSON(node.right) },
      });
    }
    case 'UnaryOp':
      return valueBlock('studio_unary', { OP: node.op }, {
        A: { block: irToBlockJSON(node.operand) },
      });
    case 'Normalize':
      return valueBlock('studio_normalize', { COLUMN: node.column, MODE: node.mode }, {
        DATA: { block: irToBlockJSON(node.data) },
      });
    case 'Sort':
      return valueBlock('studio_sort', { COLUMN: node.column, DIR: node.direction }, {
        DATA: { block: irToBlockJSON(node.data) },
      });
    case 'Select':
      return valueBlock('studio_select', { COLUMNS: node.columns.join(',') }, {
        DATA: { block: irToBlockJSON(node.data) },
      });
    case 'Filter':
      return valueBlock('studio_filter', { COLUMN: node.column, OP: node.op }, {
        DATA: { block: irToBlockJSON(node.data) },
        VALUE: { block: irToBlockJSON(node.value) },
      });
    case 'Summary':
      return valueBlock('studio_summary', { COLUMN: node.column }, {
        DATA: { block: irToBlockJSON(node.data) },
      });
    case 'Histogram':
      return valueBlock('studio_histogram', { COLUMN: node.column }, {
        DATA: { block: irToBlockJSON(node.data) },
        BINS: { block: irToBlockJSON(node.bins) },
      });
    case 'VarAssign':
      // The block always declares a fresh variable; a bare assignment
      // (`declare: false`) would silently become a redeclaration, so degrade.
      if (!node.declare) return rawFallback(node);
      return statementBlock('studio_var_assign', { NAME: node.name }, {
        VALUE: { block: irToBlockJSON(node.value) },
      });
    case 'PlotScatter':
      return statementBlock('studio_plot_scatter', { X: node.x, Y: node.y, COLOR: node.color ?? '' }, {
        DATA: { block: irToBlockJSON(node.data) },
      });
    case 'PlotHistogram':
      return statementBlock('studio_plot_histogram', { COLUMN: node.column }, {
        DATA: { block: irToBlockJSON(node.data) },
      });
    case 'PlotPointCloud':
      return statementBlock('studio_plot_pointcloud', { X: node.x, Y: node.y, Z: node.z }, {
        DATA: { block: irToBlockJSON(node.data) },
      });
    case 'PlotLine':
      return statementBlock('studio_line', { X: node.x, Y: node.y }, {
        DATA: { block: irToBlockJSON(node.data) },
      });
    case 'Repeat':
      return statementBlock('studio_repeat', {}, {
        COUNT: { block: irToBlockJSON(node.count) },
        DO: stmtInput(node.body),
      });
    case 'While':
      return statementBlock('studio_while', {}, {
        COND: { block: irToBlockJSON(node.cond) },
        DO: stmtInput(node.body),
      });
    case 'ForEach':
      return statementBlock('studio_for_each', { VAR: node.varName }, {
        LIST: { block: irToBlockJSON(node.iterable) },
        DO: stmtInput(node.body),
      });
    case 'If': {
      // The `studio_if` block only models a single condition + else. An If with
      // multiple branches (elif) would silently drop branches, so degrade.
      if (node.branches.length !== 1) return rawFallback(node);
      const branch = node.branches[0];
      return statementBlock('studio_if', {}, {
        COND: { block: irToBlockJSON(branch!.cond) },
        DO: stmtInput(branch!.body),
        ...(node.elseBody ? { ELSE: stmtInput(node.elseBody) } : {}),
      });
    }
    case 'StudioCall':
      if (node.method === 'print' && node.args.length === 1) {
        return statementBlock('studio_print', {}, { TEXT: { block: irToBlockJSON(node.args[0]!) } });
      }
      return rawFallback(node);
    case 'RawCode':
      return statementBlock('studio_raw', { LANG: node.lang, TEXT: node.text });
    default:
      return rawFallback(node);
  }
}

/** Degrade an IR node the blocks cannot express to a `studio_raw` block. */
function rawFallback(node: IRNode): BlockJSON {
  let text: string;
  try {
    text = codegenJS(makeProgram([node], [], 'js'));
  } catch (err) {
    // Some nodes (e.g. GpuRun) cannot be generated at all; keep the raw block
    // meaningful instead of letting the failure escape the workspace round-trip.
    text = `// cannot express as code: ${err instanceof Error ? err.message : String(err)}`;
  }
  return statementBlock('studio_raw', { TEXT: text });
}

/**
 * Serialize an IR program into a Blockly workspace JSON object.
 *
 * The whole body is wrapped under a single `studio_run` "运行时" hat block —
 * the unique entry point — so the workspace always renders a clear "start
 * here" block (even for an empty program).
 */
export function irToWorkspaceJSON(program: IRProgram): WorkspaceJSON {
  const runBlock: BlockJSON = { type: 'studio_run' };
  // Functions cannot be expressed as blocks, so they degrade to raw blocks;
  // chain them before the body so they survive a workspace round-trip instead
  // of being silently dropped.
  const chain = irChain([...program.functions, ...program.body]);
  if (chain) runBlock.next = { block: chain };
  return { blocks: { languageVersion: 0, blocks: [runBlock] } };
}
