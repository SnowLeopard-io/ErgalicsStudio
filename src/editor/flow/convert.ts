// ==========================================================================
// Ergalics Studio — DAG轉換器
//
// 流程模式是由具型別區塊構成的資料流 DAG，詳見 types/block.ts；相對地，
// IR 是一份線性陳述列表。這兩個函式負責銜接兩者，使三種編輯器模式
// （區塊／流程／程式碼）皆能透過單一 IR 中樞完成往返轉換：
//
//   IRProgram ─irToFlow─> BlockGraph   （程式碼／區塊 → 流程）
//   BlockGraph ─flowToIR─> IRProgram   （流程 → 區塊／程式碼）
//
// IR 中的變數賦值會為每個產生資料的步驟命名；我們重複使用這些名稱作為
// 對應流程節點的識別碼，如此同一份 IR 便能產生穩定且可編輯的 DAG。
// ==========================================================================

import type { IRNode, IRProgram, BinaryOperator, NormalizeMode } from '@/editor/ir/types';
import { makeProgram } from '@/editor/ir/types';
import type { BlockGraph, BlockGraphState, BlockInstance, BlockConnection } from '@/types/block';

// ---- IR 節點種類 → 區塊 id（須與 src/blocks/catalog 一致） ----
const BLOCK_FOR_KIND: Partial<Record<IRNode['kind'], string>> = {
  LoadCSV: 'source.file',
  LoadXYZ: 'source.file',
  Random: 'source.generate_random',
  Filter: 'filter.value',
  Select: 'transform.select_columns',
  AddColumn: 'transform.add_column',
  Normalize: 'transform.normalize',
  Sort: 'transform.sort',
  Summary: 'stats.summary',
  Histogram: 'stats.histogram',
  PlotScatter: 'viz.scatter',
  PlotLine: 'viz.line',
  PlotHistogram: 'viz.histogram',
  PlotPointCloud: 'viz.point_cloud_2d',
};

// ---- 區塊id → IR節點工廠 ----
function irFromBlock(
  blockId: string,
  params: Record<string, unknown>,
  dataVar: string | null,
): IRNode | null {
  switch (blockId) {
    case 'source.file': {
      const path = String(params.path ?? 'data.csv');
      return /\.(xyz|dat)$/i.test(path) ? { kind: 'LoadXYZ', path } : { kind: 'LoadCSV', path };
    }
    case 'source.generate_random':
      return {
        kind: 'Random',
        count: { kind: 'Number', value: Number(params.count ?? 100) },
        ...(params.seed != null ? { seed: { kind: 'Number', value: Number(params.seed) } } : {}),
      };
    case 'filter.range':
    case 'filter.value':
    case 'filter.top_k':
      return {
        kind: 'Filter',
        data: dataVar ? { kind: 'VarRef', name: dataVar } : { kind: 'Null' },
        column: String(params.column ?? ''),
        op: (String(params.op ?? '>') as BinaryOperator),
        value: numOrLiteral(params.value),
      };
    case 'transform.select_columns':
      return {
        kind: 'Select',
        data: dataVar ? { kind: 'VarRef', name: dataVar } : { kind: 'Null' },
        columns: Array.isArray(params.columns) ? (params.columns as string[]) : [],
      };
    case 'transform.add_column':
      return {
        kind: 'AddColumn',
        data: dataVar ? { kind: 'VarRef', name: dataVar } : { kind: 'Null' },
        name: String(params.name ?? ''),
        values: numOrLiteral(params.values),
      };
    case 'transform.normalize':
      return {
        kind: 'Normalize',
        data: dataVar ? { kind: 'VarRef', name: dataVar } : { kind: 'Null' },
        column: String(params.column ?? ''),
        mode: (String(params.mode ?? 'minmax') as NormalizeMode),
      };
    case 'transform.sort':
      return {
        kind: 'Sort',
        data: dataVar ? { kind: 'VarRef', name: dataVar } : { kind: 'Null' },
        column: String(params.column ?? ''),
        direction: (String(params.direction ?? 'asc') as 'asc' | 'desc'),
      };
    case 'stats.summary':
      return { kind: 'Summary', data: dataVar ? { kind: 'VarRef', name: dataVar } : { kind: 'Null' }, column: String(params.column ?? '') };
    case 'stats.histogram':
      return {
        kind: 'Histogram',
        data: dataVar ? { kind: 'VarRef', name: dataVar } : { kind: 'Null' },
        column: String(params.column ?? ''),
        bins: { kind: 'Number', value: Number(params.bins ?? 20) },
      };
    case 'viz.scatter':
      return {
        kind: 'PlotScatter',
        data: dataVar ? { kind: 'VarRef', name: dataVar } : { kind: 'Null' },
        x: String(params.x ?? ''),
        y: String(params.y ?? ''),
        ...(params.color ? { color: String(params.color) } : {}),
      };
    case 'viz.line':
      return { kind: 'PlotLine', data: dataVar ? { kind: 'VarRef', name: dataVar } : { kind: 'Null' }, x: String(params.x ?? ''), y: String(params.y ?? '') };
    case 'viz.histogram':
      return { kind: 'PlotHistogram', data: dataVar ? { kind: 'VarRef', name: dataVar } : { kind: 'Null' }, column: String(params.column ?? '') };
    case 'viz.point_cloud_2d':
      return {
        kind: 'PlotPointCloud',
        data: dataVar ? { kind: 'VarRef', name: dataVar } : { kind: 'Null' },
        x: String(params.x ?? ''),
        y: String(params.y ?? ''),
        z: String(params.z ?? ''),
      };
    default:
      return null;
  }
}

function numOrLiteral(v: unknown): IRNode {
  if (typeof v === 'number') return { kind: 'Number', value: v };
  if (typeof v === 'string') return { kind: 'String', value: v };
  return { kind: 'Null' };
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

// ==========================================================================
// IR → Flow
// ==========================================================================

/** 將 IR 程式轉換為流程 DAG（BlockGraph + 視埠狀態）。 */
export function irToFlow(program: IRProgram): BlockGraphState {
  const instances: BlockInstance[] = [];
  const connections: BlockConnection[] = [];
  const nodeForVar = new Map<string, string>(); // 變數名稱 -> 實例 id

  // 簡易的左到右欄位佈局。
  const colGap = 240;
  const rowGap = 120;
  let col = 0;
  let row = 0;
  const place = () => {
    const pos = { x: 40 + col * colGap, y: 40 + row * rowGap };
    col += 1;
    if (col > 4) { col = 0; row += 1; }
    return pos;
  };

  const visitData = (node: IRNode): string | null => {
    // 回傳持有此節點輸出的變數名稱（若為具名 VarAssign），行內運算式則回傳 null。
    if (node.kind === 'VarRef') return node.name;
    if (node.kind === 'VarAssign') return node.name;
    return null;
  };

  for (const node of program.body) {
    const targetVar = node.kind === 'VarAssign' ? node.name : null;
    const payload: IRNode = node.kind === 'VarAssign' ? node.value : node;

    const blockId = BLOCK_FOR_KIND[payload.kind];
    if (!blockId) {
      // 無法在 DAG 中呈現——略過（其在程式碼模式中會以 RawCode 保留）。
      continue;
    }

    const instId = nextId('blk');
    const params = paramsFromIR(payload);
    const inst: BlockInstance = { id: instId, blockId, position: place(), params };

    // 解析 data 運算元：若為參照前節點的 VarRef/VarAssign，則將該上游節點的
    // 輸出連接到本節點的 data 埠。
    const dataOperand = getDataOperand(payload);
    if (dataOperand) {
      const upstreamVar = visitData(dataOperand);
      if (upstreamVar && nodeForVar.has(upstreamVar)) {
        const upstreamId = nodeForVar.get(upstreamVar)!;
        connections.push({
          id: nextId('conn'),
          from: { nodeId: upstreamId, portId: 'out' },
          to: { nodeId: instId, portId: 'data' },
        });
      }
    }

    instances.push(inst);
    if (targetVar) nodeForVar.set(targetVar, instId);
  }

  return { instances, connections, viewport: { x: 0, y: 0, zoom: 1 } };
}

/** 從轉換／統計／視覺化的 IR 節點中抽取 data 運算元節點。 */
function getDataOperand(node: IRNode): IRNode | null {
  if ('data' in node && node.data) return node.data as IRNode;
  return null;
}

/** 依 IR 節點的欄位建立區塊參數。 */
function paramsFromIR(node: IRNode): Record<string, unknown> {
  switch (node.kind) {
    case 'LoadCSV':
    case 'LoadXYZ':
      return { path: node.path };
    case 'Random':
      return { count: (node.count as { value: number }).value, ...(node.seed ? { seed: (node.seed as { value: number }).value } : {}) };
    case 'Filter':
      return { column: node.column, op: node.op, value: literalValue(node.value) };
    case 'Select':
      return { columns: node.columns };
    case 'AddColumn':
      return { name: node.name, values: literalValue(node.values) };
    case 'Normalize':
      return { column: node.column, mode: node.mode };
    case 'Sort':
      return { column: node.column, direction: node.direction };
    case 'Summary':
      return { column: node.column };
    case 'Histogram':
      return { column: node.column, bins: (node.bins as { value: number }).value };
    case 'PlotScatter':
      return { x: node.x, y: node.y, ...(node.color ? { color: node.color } : {}) };
    case 'PlotLine':
      return { x: node.x, y: node.y };
    case 'PlotHistogram':
      return { column: node.column };
    case 'PlotPointCloud':
      return { x: node.x, y: node.y, z: node.z };
    default:
      return {};
  }
}

function literalValue(node: IRNode): unknown {
  if (node.kind === 'Number') return node.value;
  if (node.kind === 'String') return node.value;
  if (node.kind === 'Boolean') return node.value;
  return 0;
}

// ==========================================================================
// Flow → IR
// ==========================================================================

/**
 * 將流程 DAG 轉換回 IR 程式。每個區塊實例成為一個 IR 節點；連線透過參照
 * 上游節點的變數名稱來提供 `data` 運算元。我們為每個產生資料的區塊合成
 * 穩定的變數名稱（`df1`、`df2` …），使產生的 IR/程式碼具可讀性。
 */
export function flowToIR(graph: BlockGraph | BlockGraphState): IRProgram {
  const instances = graph.instances;
  const connections = graph.connections;

  // 透過 data 埠連線，將下游節點對應到上游變數名稱。
  const upstreamVarOf = new Map<string, string>();
  const varNameOf = new Map<string, string>();
  let dfCount = 0;

  // 第一輪：為每個產生資料的節點指派穩定的變數名稱，使下游區塊得以透過
  // 連線圖參照它。
  const producesData = (blockId: string) =>
    blockId.startsWith('source.') ||
    blockId.startsWith('transform.') ||
    blockId.startsWith('filter.') ||
    blockId.startsWith('stats.');
  for (const inst of instances) {
    if (producesData(inst.blockId)) {
      dfCount += 1;
      varNameOf.set(inst.id, `df${dfCount}`);
    }
  }

  // 第二輪：將每個 `data` 輸入埠解析為其上游節點的變數。
  for (const conn of connections) {
    if (conn.to.portId === 'data') {
      const upVar = varNameOf.get(conn.from.nodeId);
      if (upVar) upstreamVarOf.set(conn.to.nodeId, upVar);
    }
  }

  const body: IRNode[] = [];
  for (const inst of instances) {
    const dataVar = upstreamVarOf.get(inst.id) ?? null;
    const ir = irFromBlock(inst.blockId, inst.params, dataVar);
    if (!ir) continue;

    const varName = varNameOf.get(inst.id);
    if (varName) {
      body.push({ kind: 'VarAssign', name: varName, value: ir, declare: true });
    } else {
      body.push(ir);
    }
  }

  return makeProgram(body, [], 'python');
}
