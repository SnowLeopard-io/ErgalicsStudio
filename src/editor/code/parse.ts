// ==========================================================================
// Ergalics Studio — 程式碼 2 IR 解析器（codegen 的反向轉換）
//
// 將我們自己的 codegen 所產出的 `studio.*` DSL 解析回共享的 IR。這是讓
// 程式碼模式能饋入區塊／流程模式的關鍵一環：在程式碼模式編輯 Python/JS
// 後切換到區塊模式時，會依據此次解析重建區塊圖，而非直接沿用原始文字。
// ==========================================================================

import type {
  IRNode,
  IRProgram,
  SourceLang,
  BinaryOperator,
  NormalizeMode,
} from '@/editor/ir/types';
import { makeProgram } from '@/editor/ir/types';

/** 我們關注的命名空間；其餘一律視為原始文字或略過。 */
const STUDIO = 'studio';

interface ParseResult {
  program: IRProgram;
  /** 退回到 RawCode 的陳述數量。 */
  rawCount: number;
}

/**
 * 將程式碼模式的緩衝區（Python 或 JS）解析為一份 IR 程式。
 *
 * `lang` 為緩衝區所撰寫的語言。我們同時接受 Python（`studio.load_csv(...)`）
 * 與 JS（`studio.loadCSV(...)`）兩種拼寫，並統一正規化為 IR。當某些列無法
 * 解析時（它們會以字面形式保留在 RawCode 節點內），回傳的 `rawCount > 0`。
 */
export function parseCodeToIR(source: string, lang: SourceLang = 'python'): ParseResult {
  const lines = source.split('\n');
  const body: IRNode[] = [];
  let rawCount = 0;

  for (const rawLine of lines) {
    let line = stripComment(rawLine, lang).trim();
    if (line === '') continue;
    // 去除結尾的陳述結束符（JS 使用 `;`），使右側比對器看到乾淨的
    // `studio.foo(...)` 呼叫。
    if (lang === 'js' && line.endsWith(';')) line = line.slice(0, -1).trim();

    const node = tryParseStatement(line, lang);
    if (node) {
      body.push(node);
    } else {
      // 保留原始（未裁空白）文字，讓往返轉換不遺失任何內容。
      body.push({ kind: 'RawCode', lang, text: rawLine.trim() });
      rawCount += 1;
    }
  }

  return { program: makeProgram(body, [], lang), rawCount };
}

/** 移除結尾的行註解（Python 為 `#`，JS 為 `//`）。 */
function stripComment(line: string, lang: SourceLang): string {
  if (lang === 'python' || lang === 'r') {
    const idx = line.indexOf('#');
    return idx >= 0 ? line.slice(0, idx) : line;
  }
  const idx = line.indexOf('//');
  return idx >= 0 ? line.slice(0, idx) : line;
}

/**
 * 嘗試解析單一頂層陳述。當該列不是可識別的 `studio.*` 呼叫時回傳 `null`
 * （由呼叫方記錄為 RawCode）。
 */
function tryParseStatement(line: string, lang: SourceLang): IRNode | null {
  // 賦值：  name = <expr>   /   name = studio...   /   name = expr
  const assignMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (assignMatch) {
    const name = assignMatch[1]!;
    const rhs = assignMatch[2]!.trim();
    const value = tryParseStudioCall(rhs) ?? tryParseLiteralOrRef(rhs, lang);
    if (value) {
      const declare = !isKnownBuiltin(name);
      return { kind: 'VarAssign', name, value, declare };
    }
    return null;
  }

  // 裸 studio 呼叫作為陳述。
  return tryParseStudioCall(line);
}

/**
 * 將 `studio.<method>(...)` 呼叫解析為對應的 IR 節點。我們接受 codegen
 * 實際產出的精確拼寫（`studio.load`、`studio.filter`、
 * `studio.plot('scatter', …)` 等），使生成的程式碼能往返轉換回 IR，
 * 同時也接受手寫腳本使用的 snake/JS-camel 替代拼寫。
 */
function tryParseStudioCall(expr: string): IRNode | null {
  const m = expr.match(new RegExp(`^${STUDIO}\\.([A-Za-z0-9_]+)\\s*\\((.*)\\)$`));
  if (!m) return null;
  const method = m[1]!;
  const args = splitTopLevelArgs(m[2]!);

  // --- 資料來源 ---
  if (method === 'load') {
    const path = stringArg(args[0]);
    if (path == null) return null;
    // Codegen 對 LoadCSV 與 LoadXYZ 都產出 `studio.load`；單從呼叫無法區分
    // 檔案種類，因此除非副檔名為 `.xyz`/`.dat`，否則預設為 LoadCSV。
    const isXyz = /\.(xyz|dat)$/i.test(path);
    return isXyz ? { kind: 'LoadXYZ', path } : { kind: 'LoadCSV', path };
  }
  if (method === 'load_csv' || method === 'loadCSV') return loadCsv(args);
  if (method === 'load_xyz' || method === 'loadXYZ') return loadXyz(args);
  if (method === 'random' || method === 'generate_random' || method === 'generateRandom') return random(args);
  if (method === 'generate_grid' || method === 'generateGrid' || method === 'example_data' || method === 'exampleData') {
    return { kind: 'Random', count: { kind: 'Number', value: 100 } };
  }
  if (method === 'range') {
    const start = numArg(args[0]);
    const stop = numArg(args[1]);
    if (start == null || stop == null) return null;
    const step = args[2] != null ? numArg(args[2]) : undefined;
    return { kind: 'Range', start: { kind: 'Number', value: start }, stop: { kind: 'Number', value: stop }, ...(step != null ? { step: { kind: 'Number', value: step } } : {}) };
  }

  // --- 轉換 / 篩選 ---
  if (method === 'filter' || method === 'filter_range' || method === 'filterRange' || method === 'filter_value' || method === 'filterValue') {
    return filterCall(args);
  }
  if (method === 'select' || method === 'select_columns' || method === 'selectColumns') return selectCall(args);
  if (method === 'addColumn' || method === 'add_column') return addColumnCall(args);
  if (method === 'normalize') return normalizeCall(args);
  if (method === 'sort') return sortCall(args);

  // --- 統計 ---
  if (method === 'summary') return summaryCall(args);
  if (method === 'histogram') return histogramCall(args);

  // --- 視覺化（studio.plot('scatter', ...) 與 studio.scatter(...)） ---
  if (method === 'plot' || method === 'scatter' || method === 'line' || method === 'plot_histogram' || method === 'plotHistogram' || method === 'point_cloud' || method === 'pointCloud') {
    return plotCall(method, args);
  }

  // 未知的 studio 動詞——交由上層以 RawCode 處理。
  return null;
}

function loadCsv(args: string[]): IRNode | null {
  const path = stringArg(args[0]);
  if (path == null) return null;
  return { kind: 'LoadCSV', path };
}
function loadXyz(args: string[]): IRNode | null {
  const path = stringArg(args[0]);
  if (path == null) return null;
  return { kind: 'LoadXYZ', path };
}
function random(args: string[]): IRNode | null {
  const count = numArg(args[0]);
  if (count == null) return null;
  const seed = args[1] != null ? numArg(args[1]) : undefined;
  return { kind: 'Random', count: { kind: 'Number', value: count }, ...(seed != null ? { seed: { kind: 'Number', value: seed } } : {}) };
}
function filterCall(args: string[]): IRNode | null {
  // studio.filter(data, 'col', 'op', value)  或  filter_range(data, 'col', 'op', value)
  const [data, column, op, value] = args;
  const binOp = asBinaryOp(op);
  if (!data || !column || !binOp || value == null) return null;
  return { kind: 'Filter', data: refOrVar(data), column: stringArg(column) ?? '', op: binOp, value: literalOrExpr(value) };
}
function selectCall(args: string[]): IRNode | null {
  const [data, ...cols] = args;
  if (!data) return null;
  // 欄位可能以清單字面量 `[...]` 或位置字串的形式傳入。
  const listLiteral = tryParseListLiteral(args.slice(1).join(', '));
  if (listLiteral) return { kind: 'Select', data: refOrVar(data), columns: listLiteral };
  return { kind: 'Select', data: refOrVar(data), columns: cols.map((c) => stringArg(c) ?? '') };
}
function addColumnCall(args: string[]): IRNode | null {
  const [data, name, values] = args;
  if (!data || !name || values == null) return null;
  return { kind: 'AddColumn', data: refOrVar(data), name: stringArg(name) ?? '', values: literalOrExpr(values) };
}
function normalizeCall(args: string[]): IRNode | null {
  const [data, column, mode] = args;
  const normMode = normalizeMode(mode);
  if (!data || !column || !normMode) return null;
  return { kind: 'Normalize', data: refOrVar(data), column: stringArg(column) ?? '', mode: normMode };
}
function sortCall(args: string[]): IRNode | null {
  const [data, column, direction] = args;
  if (!data || !column) return null;
  const dir = stringArg(direction) === 'desc' ? 'desc' : 'asc';
  return { kind: 'Sort', data: refOrVar(data), column: stringArg(column) ?? '', direction: dir };
}
function summaryCall(args: string[]): IRNode | null {
  const [data, column] = args;
  if (!data) return null;
  return { kind: 'Summary', data: refOrVar(data), column: stringArg(column) ?? '' };
}
function histogramCall(args: string[]): IRNode | null {
  const [data, column, bins] = args;
  if (!data || !column) return null;
  const binsNode: IRNode = bins != null
    ? (numArg(bins) != null ? { kind: 'Number', value: numArg(bins)! } : literalOrExpr(bins))
    : { kind: 'Number', value: 20 };
  return { kind: 'Histogram', data: refOrVar(data), column: stringArg(column) ?? '', bins: binsNode };
}
/** 解析 studio.plot('scatter', data, { x, y, color }) 與 studio.scatter(data, x, y, color)。 */
function plotCall(method: string, args: string[]): IRNode | null {
  // 判定繪圖「類型」以及位置／物件引數。
  let kind: 'scatter' | 'line' | 'histogram' | 'pointcloud';
  let rest: string[];
  if (method === 'plot') {
    const k = stringArg(args[0]);
    if (k == null) return null;
    kind = k as typeof kind;
    rest = args.slice(1);
  } else {
    kind = method === 'scatter' ? 'scatter'
      : method === 'line' ? 'line'
      : method === 'plot_histogram' || method === 'plotHistogram' ? 'histogram'
      : 'pointcloud';
    rest = args;
  }
  if (kind === 'histogram') {
    const [data, column] = rest;
    if (!data || !column) return null;
    return { kind: 'PlotHistogram', data: refOrVar(data), column: stringArg(column) ?? '' };
  }
  if (kind === 'pointcloud') {
    const [data, x, y, z] = rest;
    if (!data || !x || !y || !z) return null;
    return { kind: 'PlotPointCloud', data: refOrVar(data), x: stringArg(x) ?? '', y: stringArg(y) ?? '', z: stringArg(z) ?? '' };
  }
  // scatter / line
  const [data, opts] = rest;
  if (!data) return null;
  const fields = parsePlotOpts(opts);
  if (kind === 'scatter') {
    if (!fields?.x || !fields?.y) return null;
    return { kind: 'PlotScatter', data: refOrVar(data), x: fields.x, y: fields.y, ...(fields.color ? { color: fields.color } : {}) };
  }
  if (!fields?.x || !fields?.y) return null;
  return { kind: 'PlotLine', data: refOrVar(data), x: fields.x, y: fields.y };
}

/** 解析 studio.plot 的 `{ x: 'a', y: 'b', color: 'c' }` 物件字面量。 */
function parsePlotOpts(s: string | undefined): { x?: string; y?: string; color?: string } | null {
  if (s == null) return null;
  const obj = s.trim();
  if (!obj.startsWith('{') || !obj.endsWith('}')) {
    // 退回處理：視為位置的 x、y、color 字串（studio.scatter 形式）。
    const parts = splitTopLevelArgs(obj);
    return { x: stringArg(parts[0]) ?? undefined, y: stringArg(parts[1]) ?? undefined, color: parts[2] != null ? stringArg(parts[2]) ?? undefined : undefined };
  }
  const inner = obj.slice(1, -1);
  const out: { x?: string; y?: string; color?: string } = {};
  for (const pair of splitTopLevelArgs(inner)) {
    const kv = pair.split(':');
    if (kv.length !== 2) continue;
    const key = kv[0]!.trim().replace(/^['"]|['"]$/g, '');
    const val = stringArg(kv[1]!.trim());
    if (val == null) continue;
    if (key === 'x') out.x = val;
    else if (key === 'y') out.y = val;
    else if (key === 'color') out.color = val;
  }
  return out;
}

/** 將 `[a, b, c]` 清單字面量解析為 string[]（用於選取欄位）。 */
function tryParseListLiteral(s: string): string[] | null {
  const t = s.trim();
  if (!t.startsWith('[') || !t.endsWith(']')) return null;
  const inner = t.slice(1, -1).trim();
  if (inner === '') return [];
  return splitTopLevelArgs(inner).map((c) => stringArg(c) ?? c.replace(/^['"]|['"]$/g, ''));
}

// ---- 輔助函式 -------------------------------------------------------------

/** 依據巢狀括號／引號分割以逗號分隔的引數清單。 */
function splitTopLevelArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr: string | null = null;
  let cur = '';
  for (const ch of s) {
    if (inStr) {
      cur += ch;
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = ch;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

function stringArg(a: string | undefined): string | null {
  if (a == null) return null;
  const t = a.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return null;
}

function numArg(a: string | undefined): number | null {
  if (a == null) return null;
  const n = Number(a.trim());
  return Number.isFinite(n) ? n : null;
}

function asBinaryOp(a: string | undefined): BinaryOperator | null {
  const v = a != null ? a.trim().replace(/^['"]|['"]$/g, '') : '';
  const ops: BinaryOperator[] = ['+', '-', '*', '/', '//', '%', '**', '==', '!=', '<', '<=', '>', '>=', 'and', 'or'];
  return (ops as string[]).includes(v) ? (v as BinaryOperator) : null;
}

function normalizeMode(a: string | undefined): NormalizeMode | null {
  const v = a != null ? a.trim().replace(/^['"]|['"]$/g, '') : '';
  return v === 'minmax' || v === 'zscore' ? v : null;
}

function isKnownBuiltin(name: string): boolean {
  return name === STUDIO || name === 'print' || name === 'np' || name === 'pd' || name === 'plt';
}

/** 裸變數參照或 studio 呼叫——用於 `data` 運算元。 */
function refOrVar(a: string): IRNode {
  const call = tryParseStudioCall(a.trim());
  if (call) return call;
  return { kind: 'VarRef', name: a.trim() };
}

/** 字面數值／字串／布林；否則為 VarRef（或巢狀 studio 呼叫）。 */
function literalOrExpr(a: string): IRNode {
  const t = a.trim();
  const num = numArg(t);
  if (num != null) return { kind: 'Number', value: num };
  const str = stringArg(t);
  if (str != null) return { kind: 'String', value: str };
  if (t === 'true' || t === 'True') return { kind: 'Boolean', value: true };
  if (t === 'false' || t === 'False') return { kind: 'Boolean', value: false };
  const call = tryParseStudioCall(t);
  if (call) return call;
  return { kind: 'VarRef', name: t };
}

/** 從右側非 studio 呼叫的運算式中解析字面量或變數參照。 */
function tryParseLiteralOrRef(expr: string, _lang: SourceLang): IRNode | null {
  const t = expr.trim();
  const num = numArg(t);
  if (num != null) return { kind: 'Number', value: num };
  const str = stringArg(t);
  if (str != null) return { kind: 'String', value: str };
  if (t === 'true' || t === 'True') return { kind: 'Boolean', value: true };
  if (t === 'false' || t === 'False') return { kind: 'Boolean', value: false };
  if (t === 'None' || t === 'null') return { kind: 'Null' };
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) return { kind: 'VarRef', name: t };
  return null;
}
