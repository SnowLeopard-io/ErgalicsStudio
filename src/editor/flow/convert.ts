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

// ---- studio.* 方法 → simple-kit 區塊 id（IR 以通用 StudioCall 承載
//      simple-kit 專有、而 IR 沒有專用節點的區塊） ----
const BLOCK_FOR_STUDIO_METHOD: Record<string, string> = {
  exampleData: 'source.example_data',
  grid: 'source.generate_grid',
  filterRange: 'filter.range',
  topK: 'filter.top_k',
  addConstantColumn: 'transform.add_column',
  renameColumn: 'transform.rename_column',
};

/** 一條（可能被 VarAssign 包裝的）IR 陳述對應的流程區塊 id。 */
function flowBlockIdFor(node: IRNode): string | undefined {
  const payload: IRNode = node.kind === 'VarAssign' ? node.value : node;
  if (payload.kind === 'StudioCall') return BLOCK_FOR_STUDIO_METHOD[payload.method];
  return BLOCK_FOR_KIND[payload.kind];
}

// ---- 區塊id → IR節點工廠（參數名與 @/blocks/catalog 完全對齊） ----
function irFromBlock(
  blockId: string,
  params: Record<string, unknown>,
  dataVar: string | null,
): IRNode | null {
  const dataArg: IRNode = dataVar ? { kind: 'VarRef', name: dataVar } : { kind: 'Null' };
  const studioCall = (method: string, args: IRNode[]): IRNode => ({ kind: 'StudioCall', method, args });
  switch (blockId) {
    case 'source.file': {
      // 目錄參數名為 fileName；相容早期寫入的 path。
      const path = String(params.fileName ?? params.path ?? 'data.csv');
      return /\.(xyz|dat)$/i.test(path) ? { kind: 'LoadXYZ', path } : { kind: 'LoadCSV', path };
    }
    case 'source.example_data':
      return studioCall('exampleData', [
        { kind: 'Number', value: Number(params.count ?? 100) },
        ...(params.seed != null ? [{ kind: 'Number', value: Number(params.seed) } as IRNode] : []),
      ]);
    case 'source.generate_grid':
      return studioCall('grid', [{ kind: 'Number', value: Number(params.size ?? 10) }]);
    case 'source.generate_random':
      return {
        kind: 'Random',
        count: { kind: 'Number', value: Number(params.count ?? 100) },
        ...(params.seed != null ? { seed: { kind: 'Number', value: Number(params.seed) } } : {}),
      };
    case 'filter.range':
      return studioCall('filterRange', [
        dataArg,
        { kind: 'String', value: String(params.column ?? '') },
        { kind: 'Number', value: Number(params.min ?? 0) },
        { kind: 'Number', value: Number(params.max ?? 1) },
      ]);
    case 'filter.value':
      return {
        kind: 'Filter',
        data: dataArg,
        column: String(params.column ?? ''),
        op: (String(params.op ?? '==') as BinaryOperator),
        value: numOrLiteral(params.value),
      };
    case 'filter.top_k':
      return studioCall('topK', [
        dataArg,
        { kind: 'String', value: String(params.column ?? '') },
        { kind: 'Number', value: Number(params.k ?? 10) },
        { kind: 'String', value: String(params.direction ?? 'largest') },
      ]);
    case 'transform.select_columns':
      return {
        kind: 'Select',
        data: dataArg,
        columns: Array.isArray(params.columns) ? (params.columns as string[]) : [],
      };
    case 'transform.add_column':
      // simple-kit 的添加列是「常量廣播」，與 IR AddColumn 的顯式值數列
      // 語義不同，故由 studio.addConstantColumn 承載。
      return studioCall('addConstantColumn', [
        dataArg,
        { kind: 'String', value: String(params.name ?? 'col') },
        { kind: 'Number', value: Number(params.value ?? 0) },
      ]);
    case 'transform.rename_column':
      return studioCall('renameColumn', [
        dataArg,
        { kind: 'String', value: String(params.from ?? '') },
        { kind: 'String', value: String(params.to ?? '') },
      ]);
    case 'transform.normalize':
      return {
        kind: 'Normalize',
        data: dataArg,
        column: String(params.column ?? ''),
        mode: (String(params.mode ?? 'minmax') as NormalizeMode),
      };
    case 'transform.sort':
      return {
        kind: 'Sort',
        data: dataArg,
        column: String(params.column ?? ''),
        direction: (String(params.direction ?? 'asc') as 'asc' | 'desc'),
      };
    case 'stats.summary':
      return { kind: 'Summary', data: dataArg, column: String(params.column ?? '') };
    case 'stats.histogram':
      return {
        kind: 'Histogram',
        data: dataArg,
        column: String(params.column ?? ''),
        bins: { kind: 'Number', value: Number(params.bins ?? 20) },
      };
    // 新 SVG 出版級圖（plot.*）與舊插件圖（viz.*）映射到同一組 IR Plot 節點。
    case 'viz.scatter':
    case 'plot.scatter':
      return {
        kind: 'PlotScatter',
        data: dataArg,
        x: String(params.xColumn ?? params.x ?? ''),
        y: String(params.yColumn ?? params.y ?? ''),
        ...(params.colorColumn || params.color
          ? { color: String(params.colorColumn ?? params.color ?? '') }
          : {}),
      };
    case 'viz.line':
    case 'plot.line':
      return {
        kind: 'PlotLine',
        data: dataArg,
        x: String(params.xColumn ?? params.x ?? ''),
        y: String(params.yColumn ?? params.y ?? ''),
      };
    case 'viz.histogram':
    case 'plot.histogram':
      return { kind: 'PlotHistogram', data: dataArg, column: String(params.column ?? '') };
    case 'viz.point_cloud_2d':
      return {
        kind: 'PlotPointCloud',
        data: dataArg,
        x: String(params.xColumn ?? params.x ?? ''),
        y: String(params.yColumn ?? params.y ?? ''),
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

    const blockId = flowBlockIdFor(node);
    if (!blockId) {
      // 無法在 DAG 中呈現——略過（其在程式碼模式中會以 RawCode 保留；
      // syncFromFlow 會用 mergeFlowIR 把這些陳述保留回 IR，不致遺失）。
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
  // simple-kit 專有區塊以 StudioCall 承載，data 一律是第一個引數。
  if (node.kind === 'StudioCall' && BLOCK_FOR_STUDIO_METHOD[node.method]) {
    return node.args[0] ?? null;
  }
  return null;
}

/** 依 IR 節點的欄位建立區塊參數（鍵名與 @/blocks/catalog 一致）。 */
function paramsFromIR(node: IRNode): Record<string, unknown> {
  switch (node.kind) {
    case 'LoadCSV':
    case 'LoadXYZ':
      return { fileName: node.path };
    case 'Random':
      return { count: (node.count as { value: number }).value, ...(node.seed ? { seed: (node.seed as { value: number }).value } : {}) };
    case 'Filter':
      return { column: node.column, op: node.op, value: literalValue(node.value) };
    case 'Select':
      return { columns: node.columns };
    case 'AddColumn':
      return { name: node.name, value: literalValue(node.values) };
    case 'Normalize':
      return { column: node.column, mode: node.mode };
    case 'Sort':
      return { column: node.column, direction: node.direction };
    case 'Summary':
      return { column: node.column };
    case 'Histogram':
      return { column: node.column, bins: (node.bins as { value: number }).value };
    case 'PlotScatter':
      return { xColumn: node.x, yColumn: node.y, ...(node.color ? { colorColumn: node.color } : {}) };
    case 'PlotLine':
      return { xColumn: node.x, yColumn: node.y };
    case 'PlotHistogram':
      return { column: node.column };
    case 'PlotPointCloud':
      // simple-kit 的 2D 點雲只有 x/y。
      return { xColumn: node.x, yColumn: node.y };
    case 'StudioCall':
      return studioParamsFromIR(node.method, node.args);
    default:
      return {};
  }
}

/** StudioCall（simple-kit 專有區塊）的引數 → 目錄參數。 */
function studioParamsFromIR(method: string, args: (IRNode | undefined)[]): Record<string, unknown> {
  switch (method) {
    case 'exampleData':
      return { count: literalValue(args[0]), ...(args[1] ? { seed: literalValue(args[1]) } : {}) };
    case 'grid':
      return { size: literalValue(args[0]) };
    case 'filterRange':
      return { column: literalValue(args[1]), min: literalValue(args[2]), max: literalValue(args[3]) };
    case 'topK':
      return { column: literalValue(args[1]), k: literalValue(args[2]), direction: literalValue(args[3]) };
    case 'addConstantColumn':
      return { name: literalValue(args[1]), value: literalValue(args[2]) };
    case 'renameColumn':
      return { from: literalValue(args[1]), to: literalValue(args[2]) };
    default:
      return {};
  }
}

function literalValue(node: IRNode | undefined): unknown {
  if (!node) return 0;
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
 *
 * 節點按連線做拓撲排序（Kahn 演算法）後才輸出——即使使用者先放下游區塊、
 * 後放上游區塊，IR 中的 VarRef 也不會出現在定義之前。同名次序以畫布上的
 * 建立順序為準，維持穩定輸出；若 DAG 含環，剩餘節點退回原始順序。
 */
export function flowToIR(graph: BlockGraph | BlockGraphState): IRProgram {
  const instances = graph.instances;
  const connections = graph.connections;

  const producesData = (blockId: string) =>
    blockId.startsWith('source.') ||
    blockId.startsWith('transform.') ||
    blockId.startsWith('filter.') ||
    blockId.startsWith('stats.');

  // ---- 拓撲排序：data 埠連線即「上游 → 下游」的執行相依邊 ----
  const order = topoOrder(instances, connections);

  // 依拓撲順序為產生資料的節點命名，df1 一定是最先執行的資料來源。
  const varNameOf = new Map<string, string>();
  let dfCount = 0;
  for (const inst of order) {
    if (producesData(inst.blockId)) {
      dfCount += 1;
      varNameOf.set(inst.id, `df${dfCount}`);
    }
  }

  // 一個 data 輸入埠只連接一條上游線；解析為該上游節點的變數名。
  const upstreamVarOf = new Map<string, string>();
  for (const conn of connections) {
    if (conn.to.portId === 'data') {
      const upVar = varNameOf.get(conn.from.nodeId);
      if (upVar) upstreamVarOf.set(conn.to.nodeId, upVar);
    }
  }

  const body: IRNode[] = [];
  for (const inst of order) {
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

// ==========================================================================
// 流程編輯合併：保留流程 DAG 無法表達的 IR 陳述
// ==========================================================================

/** 判斷一條 body 陳述是否能由流程 DAG 表示（含 VarAssign 包裝）。 */
function isFlowStatement(node: IRNode): boolean {
  return flowBlockIdFor(node) !== undefined;
}

/**
 * 以「流程編輯後的新 DAG IR」更新舊程式，同時保留 DAG 無法表示的陳述
 * （print、if/for/while、函式呼叫、RawCode…）與頂層函式定義。
 *
 * 對位策略：舊 body 中的「可流程化」子序列按順序由新 DAG 節點逐個取代，
 * 其餘陳述保留原位；新 DAG 多出的節點附加到末端。這樣僅僅進出流程模式
 * （或只調整管線節點）不會丟失控制流程、函式與自訂程式碼。
 */
export function mergeFlowIR(prev: IRProgram, next: IRProgram): IRProgram {
  const queue = [...next.body];
  const body: IRNode[] = [];
  for (const stmt of prev.body) {
    if (isFlowStatement(stmt)) {
      const replacement = queue.shift();
      if (replacement) body.push(replacement);
      // 節點被刪除且無替換物 → 丟棄該陳述。
    } else {
      body.push(stmt);
    }
  }
  // 新增的管線節點（DAG 裡多畫的）補在末端。
  body.push(...queue);
  return makeProgram(body, prev.functions, prev.sourceLang);
}

/** 流程圖結構簽章：連線/節點/參數完全相同時視為未編輯（避免注水後誤同步）。 */
export function flowGraphSignature(graph: BlockGraph | BlockGraphState): string {
  return JSON.stringify({
    i: graph.instances.map((i) => [i.id, i.blockId, i.params]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    c: graph.connections.map((c) => [c.from.nodeId, c.from.portId, c.to.nodeId, c.to.portId]).sort(),
  });
}

/**
 * Kahn 拓撲排序。節點就緒次序以 instances 內的原始索引作為 tiebreak，
 * 確保未連線的節點仍依照畫布建立順序穩定輸出。存在環時，未排入的節點
 * 依原順序附加於末端（環上的資料相依無法線性化，至少不能遺失節點）。
 */
function topoOrder(instances: BlockInstance[], connections: BlockConnection[]): BlockInstance[] {
  const indexById = new Map<string, number>();
  instances.forEach((inst, i) => indexById.set(inst.id, i));

  // 預設每個節點都有一條來自虛隱起點的邊，使孤立節點也會參與就緒競賽；
  // indegree 只計算真實的 data 相依邊。
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const inst of instances) {
    indegree.set(inst.id, 0);
    outgoing.set(inst.id, []);
  }
  for (const conn of connections) {
    if (conn.to.portId !== 'data') continue;
    if (!indexById.has(conn.from.nodeId) || !indexById.has(conn.to.nodeId)) continue;
    indegree.set(conn.to.nodeId, (indegree.get(conn.to.nodeId) ?? 0) + 1);
    outgoing.get(conn.from.nodeId)!.push(conn.to.nodeId);
  }

  // 以原始索引排序的就緒集合（手作小排序，資料量小、避免額外依賴）。
  const ready: number[] = [];
  const pushReady = (idx: number) => {
    ready.push(idx);
    for (let i = ready.length - 1; i > 0 && ready[i - 1]! > ready[i]!; i -= 1) {
      [ready[i - 1], ready[i]] = [ready[i]!, ready[i - 1]!];
    }
  };
  instances.forEach((inst, i) => {
    if ((indegree.get(inst.id) ?? 0) === 0) pushReady(i);
  });

  const result: BlockInstance[] = [];
  const visited = new Set<string>();
  while (ready.length > 0) {
    const idx = ready.shift()!;
    const inst = instances[idx]!;
    if (visited.has(inst.id)) continue;
    visited.add(inst.id);
    result.push(inst);
    for (const downId of outgoing.get(inst.id) ?? []) {
      const d = (indegree.get(downId) ?? 1) - 1;
      indegree.set(downId, d);
      if (d === 0) pushReady(indexById.get(downId)!);
    }
  }

  // 迴圈或孤立異常：把沒排入的節點以原順序補回。
  for (const inst of instances) {
    if (!visited.has(inst.id)) result.push(inst);
  }
  return result;
}
