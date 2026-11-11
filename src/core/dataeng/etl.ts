// ==========================================================================
// ETL kernel — pure tabular transform primitives for the ETL pipeline
// research tool (`/studio/etl`).
//
// No DOM / React / store imports: every function is a deterministic
// (table, params) -> table mapping, so a pipeline is reproducible and
// unit-testable without the host. All primitives are immutable — they
// return new tables and never mutate their inputs.
//
// Contents:
//   - EtTable model (column metadata + row records)
//   - CSV / JSON ingestion with column-type inference (number / date /
//     boolean heuristics; missing-value checker reused from core
//     data-quality profiling)
//   - transform primitives: filter, map, reduce, join, groupBy, pivot,
//     melt, impute, normalize, coerceType
//   - pipeline runner with per-step row-count / wall-clock stats
//   - code exporters: pandas / R (dplyr) / SQL from a step list
//   - flow-mode DAG export (BlockGraphState-shaped generic nodes)
// ==========================================================================

import type { BlockConnection, BlockGraphState, BlockInstance } from '@/types/block';
import type { Row } from '@/core/data-quality/types';
import { collectColumnNames, makeMissingChecker } from '@/core/data-quality/profile';

/** Storage type declared for a column (drives parsing, coercion, display). */
type EtColumnType = 'number' | 'string' | 'boolean' | 'date' | 'unknown';

export interface ColumnMeta {
  name: string;
  type: EtColumnType;
}

/** The kernel's in-memory table: column metadata plus row records. */
export interface EtTable {
  columns: ColumnMeta[];
  rows: Row[];
}

export type FilterOp =
  | '=='
  | '!='
  | '>'
  | '>='
  | '<'
  | '<='
  | 'contains'
  | 'startsWith'
  | 'isMissing'
  | 'notMissing';

export type AggFn = 'sum' | 'mean' | 'min' | 'max' | 'count';
type JoinHow = 'inner' | 'left';
export type ImputeMethod = 'mean' | 'median' | 'mode' | 'constant';
export type NormalizeMethod = 'minmax' | 'zscore';

/** One serializable pipeline step (persisted in the tool's project state). */
export type EtlStep =
  | { kind: 'filter'; column: string; op: FilterOp; value: string }
  | { kind: 'map'; name: string; expression: string }
  | { kind: 'reduce'; column: string; fn: AggFn }
  | { kind: 'join'; on: string; how: JoinHow }
  | { kind: 'groupBy'; keys: string[]; column: string; fn: AggFn }
  | { kind: 'pivot'; index: string; columns: string; value: string; fn: AggFn }
  | { kind: 'melt'; idColumns: string[] }
  | { kind: 'impute'; column: string; method: ImputeMethod; value: string }
  | { kind: 'normalize'; column: string; method: NormalizeMethod }
  | { kind: 'coerceType'; column: string; type: EtColumnType };

export type EtlStepKind = EtlStep['kind'];

/** External tables a pipeline may reference (currently: the join source). */
interface PipelineContext {
  joinTable?: EtTable;
}

/** Rows / wall-clock cost of one executed step (for the UI step badges). */
export interface StepStat {
  rows: number;
  ms: number;
}

interface PipelineResult {
  table: EtTable;
  stats: StepStat[];
}

/** Missing tokens shared with the core data-quality engine (null/NaN/''). */
const isMissingValue = makeMissingChecker();

// ---- column typing ---------------------------------------------------------

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const RESERVED_WORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for', 'function',
  'if', 'import', 'in', 'instanceof', 'new', 'null', 'return', 'super', 'switch', 'this',
  'throw', 'true', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield',
]);

const DATE_ISO_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;
const DATE_SLASH_RE = /^\d{4}\/\d{2}\/\d{2}$/;
const BOOL_TRUE = new Set(['true', 'yes', 'y', 't', '1']);
const BOOL_FALSE = new Set(['false', 'no', 'n', 'f', '0']);

/**
 * Infer a column's storage type from observed values (numeric / boolean /
 * ISO-date heuristics; missing cells are skipped; an all-missing column is
 * 'unknown'). Works on raw CSV strings and on typed JSON values alike.
 */
export function inferColumnType(values: ReadonlyArray<unknown>): EtColumnType {
  let present = 0;
  let numbers = 0;
  let booleans = 0;
  let dates = 0;
  for (const value of values) {
    if (isMissingValue(value)) continue;
    present += 1;
    if (typeof value === 'boolean') {
      booleans += 1;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      numbers += 1;
      continue;
    }
    if (typeof value === 'string') {
      const s = value.trim();
      if (BOOL_TRUE.has(s.toLowerCase()) || BOOL_FALSE.has(s.toLowerCase())) booleans += 1;
      else if (s !== '' && Number.isFinite(Number(s))) numbers += 1;
      else if (DATE_ISO_RE.test(s) || DATE_SLASH_RE.test(s)) dates += 1;
    }
  }
  if (present === 0) return 'unknown';
  if (booleans === present) return 'boolean';
  if (numbers === present) return 'number';
  if (dates === present) return 'date';
  return 'string';
}

/** Coerce a raw cell to the declared column type (unparseable -> null). */
function coerceValue(value: unknown, type: EtColumnType): unknown {
  if (isMissingValue(value)) return null;
  switch (type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim());
      return Number.isFinite(n) ? n : null;
    }
    case 'boolean':
      return parseBool(value);
    case 'date':
      return toDateIso(value);
    case 'string':
      return String(value);
    default:
      return value;
  }
}

function parseBool(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1 ? true : value === 0 ? false : null;
  const s = String(value).trim().toLowerCase();
  if (BOOL_TRUE.has(s)) return true;
  if (BOOL_FALSE.has(s)) return false;
  return null;
}

/** Normalize dates to ISO `YYYY-MM-DD`; unparseable input -> null. */
function toDateIso(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (s === '') return null;
  if (DATE_ISO_RE.test(s)) return s.slice(0, 10);
  if (DATE_SLASH_RE.test(s)) return s.replaceAll('/', '-');
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** Numeric view of a cell; missing / non-parseable -> null. */
function coerceNumber(value: unknown): number | null {
  if (isMissingValue(value)) return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

/** Build a table from row records: columns are first-seen ordered and typed. */
function tableFromRows(rows: ReadonlyArray<Row>): EtTable {
  const names = collectColumnNames(rows);
  const columns: ColumnMeta[] = names.map((name) => ({
    name,
    type: inferColumnType(rows.map((row) => row[name])),
  }));
  return { columns, rows: rows.map((row) => ({ ...row })) };
}

// ---- ingestion ---------------------------------------------------------------

/** Split CSV text honouring double-quoted cells (RFC-4180-lite). */
function splitCsvRecords(text: string, delimiter: string): string[][] {
  const src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      record.push(cell);
      cell = '';
    } else if (ch === '\n') {
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || record.length > 0) {
    record.push(cell);
    records.push(record);
  }
  // Drop blank lines.
  return records.filter((r) => !(r.length === 1 && r[0]!.trim() === ''));
}

/** Parse CSV text into a typed EtTable (first record is the header). */
export function parseCsvTable(text: string, delimiter = ','): EtTable {
  const records = splitCsvRecords(text, delimiter);
  if (records.length === 0) return { columns: [], rows: [] };
  const header = records[0]!.map((h, i) => {
    const name = h.trim();
    return name === '' ? `col${i + 1}` : name;
  });
  const seen = new Map<string, number>();
  const names = header.map((name) => {
    const count = seen.get(name) ?? 0;
    seen.set(name, count + 1);
    return count === 0 ? name : `${name}_${count + 1}`;
  });
  const dataRecords = records.slice(1);
  const rawRows: Row[] = dataRecords.map((cells) => {
    const row: Row = {};
    names.forEach((name, i) => {
      row[name] = i < cells.length ? cells[i] : null;
    });
    return row;
  });
  const columns: ColumnMeta[] = names.map((name) => ({
    name,
    type: inferColumnType(rawRows.map((row) => row[name])),
  }));
  const rows: Row[] = rawRows.map((raw) => {
    const row: Row = {};
    columns.forEach((col) => {
      row[col.name] = coerceValue(raw[col.name], col.type);
    });
    return row;
  });
  return { columns, rows };
}

/** Parse JSON text into a typed EtTable (array of records, or {data|rows}). */
export function parseJsonTable(text: string): EtTable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    parsed = obj.data ?? obj.rows ?? obj.records;
  }
  if (!Array.isArray(parsed)) {
    throw new Error('expected a JSON array of records (or an object with a data/rows array)');
  }
  const records = parsed.filter(
    (entry): entry is Row => entry !== null && typeof entry === 'object' && !Array.isArray(entry),
  );
  return tableFromRows(records);
}

/** Route CSV vs JSON by content shape (JSON object/array prefix wins). */
export function parseTableAuto(text: string): EtTable {
  const trimmed = text.trim();
  return trimmed.startsWith('[') || trimmed.startsWith('{') ? parseJsonTable(trimmed) : parseCsvTable(trimmed);
}

// ---- expression sandbox ------------------------------------------------------

/**
 * Compile a JS expression over the table's columns. Only valid-identifier
 * column names are exposed as variables (via `new Function` destructuring),
 * so expressions cannot reach the host's internals — reserved words and
 * odd identifiers are intentionally not bound.
 */
export function compileExpression(columns: ReadonlyArray<string>, expression: string): (row: Row) => unknown {
  const expr = expression.trim();
  if (expr === '') throw new Error('empty expression');
  const vars = columns.filter((c) => IDENT_RE.test(c) && !RESERVED_WORDS.has(c));
  const body = `"use strict"; const {${vars.join(', ')}} = row; return (${expr});`;
  let fn: (row: Row) => unknown;
  try {
    fn = new Function('row', body) as (row: Row) => unknown;
  } catch (err) {
    throw new Error(`invalid expression "${expression}": ${err instanceof Error ? err.message : String(err)}`);
  }
  return (row: Row) => fn(row);
}

// ---- shared helpers ------------------------------------------------------------

function requireColumn(table: EtTable, name: string): ColumnMeta {
  const meta = table.columns.find((c) => c.name === name);
  if (!meta) {
    throw new Error(`unknown column "${name}" (available: ${table.columns.map((c) => c.name).join(', ') || 'none'})`);
  }
  return meta;
}

function keyString(value: unknown): string {
  if (value === null || value === undefined) return '\u0000missing';
  if (typeof value === 'number') return `n:${value}`;
  if (typeof value === 'boolean') return value ? 'b:true' : 'b:false';
  return `s:${String(value)}`;
}

/** Parse a literal filter / constant value using the column type as hint. */
function parseLiteral(raw: string, type: EtColumnType): unknown {
  const v = raw.trim();
  if (v === '') return null;
  if (type === 'number') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (type === 'boolean') return parseBool(v);
  if (type === 'string' || type === 'date') return v;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  if (v.toLowerCase() === 'true') return true;
  if (v.toLowerCase() === 'false') return false;
  return v;
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    const na = coerceNumber(a);
    const nb = coerceNumber(b);
    return na !== null && nb !== null && na === nb;
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return String(a) === String(b);
  return false;
}

type CompareOp = '==' | '!=' | '>' | '>=' | '<' | '<=';

function compareValues(left: unknown, op: CompareOp, right: unknown): boolean {
  if (op === '==') return looseEquals(left, right);
  if (op === '!=') return !looseEquals(left, right);
  // Relational comparisons: numeric when both sides are numeric, otherwise
  // lexicographic on strings (which is correct for ISO dates).
  if (typeof left === 'number' && typeof right === 'number') {
    return applyRelational(left, op, right);
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return applyRelational(left, op, right);
  }
  return false;
}

function applyRelational<T extends number | string>(a: T, op: CompareOp, b: T): boolean {
  switch (op) {
    case '>':
      return a > b;
    case '>=':
      return a >= b;
    case '<':
      return a < b;
    case '<=':
      return a <= b;
    default:
      return false;
  }
}

function aggregate(values: ReadonlyArray<unknown>, fn: AggFn): number | null {
  if (fn === 'count') return values.filter((v) => !isMissingValue(v)).length;
  const nums: number[] = [];
  for (const value of values) {
    const n = coerceNumber(value);
    if (n !== null) nums.push(n);
  }
  if (nums.length === 0) return null;
  switch (fn) {
    case 'sum':
      return nums.reduce((a, b) => a + b, 0);
    case 'mean':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min': {
      let m = nums[0]!;
      for (const v of nums) if (v < m) m = v;
      return m;
    }
    case 'max': {
      let m = nums[0]!;
      for (const v of nums) if (v > m) m = v;
      return m;
    }
    default:
      return null;
  }
}

function medianOf(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function modeOf(values: ReadonlyArray<unknown>): unknown {
  const counts = new Map<string, { count: number; value: unknown }>();
  for (const value of values) {
    const key = keyString(value);
    const entry = counts.get(key);
    if (entry) entry.count += 1;
    else counts.set(key, { count: 1, value });
  }
  let best: { count: number; value: unknown } | null = null;
  for (const entry of counts.values()) {
    if (!best || entry.count > best.count) best = entry;
  }
  return best ? best.value : null;
}

function sampleStd(nums: ReadonlyArray<number>, mean: number): number {
  if (nums.length < 2) return 0;
  let ss = 0;
  for (const v of nums) ss += (v - mean) ** 2;
  return Math.sqrt(ss / (nums.length - 1));
}

/** Fraction of missing cells over the whole table (0 for an empty table). */
export function missingCellRate(table: EtTable): number {
  const cells = table.rows.length * table.columns.length;
  if (cells === 0) return 0;
  let missing = 0;
  for (const row of table.rows) {
    for (const col of table.columns) {
      if (isMissingValue(row[col.name])) missing += 1;
    }
  }
  return missing / cells;
}

// ---- transform primitives (all immutable) ----------------------------------------

/**
 * Filter rows. The left operand is a column name, or — when no such column
 * exists — a JS expression over the row's columns ("expression column").
 */
export function etlFilter(table: EtTable, column: string, op: FilterOp, value: string): EtTable {
  const isColumn = table.columns.some((c) => c.name === column);
  const evalLeft = isColumn
    ? (row: Row) => row[column]
    : compileExpression(table.columns.map((c) => c.name), column);
  const meta = table.columns.find((c) => c.name === column);
  const right = parseLiteral(value, meta?.type ?? 'unknown');
  const rows = table.rows.filter((row) => {
    const left = evalLeft(row);
    switch (op) {
      case 'contains':
        return left !== null && left !== undefined && String(left).includes(value);
      case 'startsWith':
        return left !== null && left !== undefined && String(left).startsWith(value);
      case 'isMissing':
        return isMissingValue(left);
      case 'notMissing':
        return !isMissingValue(left);
      default:
        return compareValues(left, op, right);
    }
  });
  return { columns: table.columns, rows };
}

/** Add (or replace) a column computed by a JS expression over row columns. */
export function etlMap(table: EtTable, name: string, expression: string): EtTable {
  const columnName = name.trim();
  if (columnName === '') throw new Error('map step requires an output column name');
  const evalExpr = compileExpression(table.columns.map((c) => c.name), expression);
  const results = table.rows.map((row) => evalExpr(row));
  const type = inferColumnType(results);
  const exists = table.columns.some((c) => c.name === columnName);
  const columns: ColumnMeta[] = exists
    ? table.columns.map((c) => (c.name === columnName ? { name: columnName, type } : c))
    : [...table.columns, { name: columnName, type }];
  const rows = table.rows.map((row, i) => ({ ...row, [columnName]: results[i] }));
  return { columns, rows };
}

/** Aggregate the whole table to a single row (global reduce). */
export function etlReduce(table: EtTable, column: string, fn: AggFn): EtTable {
  requireColumn(table, column);
  const values = table.rows.map((row) => row[column]);
  return { columns: [{ name: column, type: 'number' }], rows: [{ [column]: aggregate(values, fn) }] };
}

/** Hash-join a second table on a key column (inner or left). */
export function etlJoin(left: EtTable, right: EtTable, on: string, how: JoinHow): EtTable {
  requireColumn(left, on);
  requireColumn(right, on);
  const rightValueCols = right.columns.filter((c) => c.name !== on);
  const leftNames = new Set(left.columns.map((c) => c.name));
  const joined: ColumnMeta[] = rightValueCols.map((c) => ({
    name: leftNames.has(c.name) ? `${c.name}_right` : c.name,
    type: c.type,
  }));
  const columns: ColumnMeta[] = [...left.columns, ...joined];

  const index = new Map<string, Row[]>();
  for (const row of right.rows) {
    const key = row[on];
    if (isMissingValue(key)) continue;
    const k = keyString(key);
    const bucket = index.get(k);
    if (bucket) bucket.push(row);
    else index.set(k, [row]);
  }

  const rows: Row[] = [];
  for (const row of left.rows) {
    const key = row[on];
    const matches = isMissingValue(key) ? undefined : index.get(keyString(key));
    if (!matches || matches.length === 0) {
      if (how === 'left') {
        const out: Row = { ...row };
        for (const col of joined) out[col.name] = null;
        rows.push(out);
      }
      continue;
    }
    for (const match of matches) {
      const out: Row = { ...row };
      rightValueCols.forEach((col, i) => {
        out[joined[i]!.name] = match[col.name];
      });
      rows.push(out);
    }
  }
  return { columns, rows };
}

/** Group by key columns and aggregate one value column (first-seen order). */
export function etlGroupBy(table: EtTable, keys: ReadonlyArray<string>, column: string, fn: AggFn): EtTable {
  const keyCols = keys.map((k) => k.trim()).filter((k) => k !== '');
  if (keyCols.length === 0) throw new Error('groupBy requires at least one key column');
  keyCols.forEach((k) => requireColumn(table, k));
  requireColumn(table, column);

  const groups = new Map<string, { keyRow: Row; values: unknown[] }>();
  for (const row of table.rows) {
    const keyRow: Row = {};
    keyCols.forEach((k) => {
      keyRow[k] = row[k];
    });
    const groupKey = keyCols.map((k) => keyString(row[k])).join('\u0001');
    const group = groups.get(groupKey);
    if (group) group.values.push(row[column]);
    else groups.set(groupKey, { keyRow, values: [row[column]] });
  }

  const aggName = `${fn}_${column}`;
  const columns: ColumnMeta[] = [
    ...keyCols.map((k) => requireColumn(table, k)),
    { name: aggName, type: 'number' },
  ];
  const rows: Row[] = [...groups.values()].map((group) => ({
    ...group.keyRow,
    [aggName]: aggregate(group.values, fn),
  }));
  return { columns, rows };
}

/** Pivot: rows x distinct column values, cells aggregated (sum/mean/...). */
export function etlPivot(table: EtTable, index: string, columns: string, value: string, fn: AggFn): EtTable {
  requireColumn(table, index);
  requireColumn(table, columns);
  requireColumn(table, value);

  const indexMeta = requireColumn(table, index);
  const columnOrder: string[] = [];
  const indexRows = new Map<string, Row>();
  const cells = new Map<string, unknown[]>();
  for (const row of table.rows) {
    const iv = row[index];
    const cv = row[columns];
    if (isMissingValue(iv) || isMissingValue(cv)) continue;
    const colName = String(cv);
    if (!columnOrder.includes(colName)) columnOrder.push(colName);
    const ik = keyString(iv);
    if (!indexRows.has(ik)) indexRows.set(ik, { [index]: iv });
    const cellKey = `${ik}\u0001${keyString(cv)}`;
    const bucket = cells.get(cellKey);
    if (bucket) bucket.push(row[value]);
    else cells.set(cellKey, [row[value]]);
  }

  const outColumns: ColumnMeta[] = [
    indexMeta,
    ...columnOrder.map((name) => ({ name, type: 'number' as const })),
  ];
  const rows: Row[] = [...indexRows.values()].map((base) => {
    const out: Row = { ...base };
    const ik = keyString(base[index]);
    for (const colName of columnOrder) {
      const values = cells.get(`${ik}\u0001${keyString(colName)}`);
      out[colName] = values ? aggregate(values, fn) : null;
    }
    return out;
  });
  return { columns: outColumns, rows };
}

/** Melt to long format: id columns stay, every other column becomes a row. */
export function etlMelt(table: EtTable, idColumns: ReadonlyArray<string>): EtTable {
  const ids = idColumns.map((s) => s.trim()).filter((s) => s !== '');
  ids.forEach((k) => requireColumn(table, k));
  const idSet = new Set(ids);
  const valueCols = table.columns.filter((c) => !idSet.has(c.name));
  const melted = table.rows.flatMap((row) =>
    valueCols.map((col) => {
      const out: Row = {};
      ids.forEach((k) => {
        out[k] = row[k];
      });
      out.variable = col.name;
      out.value = row[col.name];
      return out;
    }),
  );
  const columns: ColumnMeta[] = [
    ...ids.map((k) => requireColumn(table, k)),
    { name: 'variable', type: 'string' },
    { name: 'value', type: inferColumnType(melted.map((row) => row.value)) },
  ];
  return { columns, rows: melted };
}

/** Fill missing cells of one column (mean / median / mode / constant). */
export function etlImpute(table: EtTable, column: string, method: ImputeMethod, constant: string): EtTable {
  const meta = requireColumn(table, column);
  const values = table.rows.map((row) => row[column]);
  let fill: unknown;
  if (method === 'constant') {
    fill = parseLiteral(constant, meta.type);
  } else if (method === 'mode') {
    fill = modeOf(values.filter((v) => !isMissingValue(v)));
  } else {
    const nums: number[] = [];
    for (const v of values) {
      const n = coerceNumber(v);
      if (n !== null) nums.push(n);
    }
    if (nums.length === 0) fill = null;
    else if (method === 'mean') fill = nums.reduce((a, b) => a + b, 0) / nums.length;
    else fill = medianOf(nums);
  }
  const rows = table.rows.map((row) =>
    isMissingValue(row[column]) ? { ...row, [column]: fill } : { ...row },
  );
  return { columns: table.columns, rows };
}

/** Scale a numeric column with min-max or z-score (missing stays missing). */
export function etlNormalize(table: EtTable, column: string, method: NormalizeMethod): EtTable {
  requireColumn(table, column);
  const nums: number[] = [];
  for (const row of table.rows) {
    const n = coerceNumber(row[column]);
    if (n !== null) nums.push(n);
  }
  let transform: (v: number) => number;
  if (method === 'minmax') {
    if (nums.length === 0) transform = () => null as unknown as number;
    else {
      let min = nums[0]!;
      let max = nums[0]!;
      for (const v of nums) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const span = max - min;
      transform = (v) => (span === 0 ? 0 : (v - min) / span);
    }
  } else {
    if (nums.length === 0) transform = () => null as unknown as number;
    else {
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      const std = sampleStd(nums, mean);
      transform = (v) => (std === 0 ? 0 : (v - mean) / std);
    }
  }
  const rows = table.rows.map((row) => {
    const n = coerceNumber(row[column]);
    return { ...row, [column]: n === null ? null : transform(n) };
  });
  const columns = table.columns.map((c) => (c.name === column ? { ...c, type: 'number' as const } : c));
  return { columns, rows };
}

/** Coerce one column to a declared storage type (unparseable -> null). */
export function etlCoerceType(table: EtTable, column: string, type: EtColumnType): EtTable {
  requireColumn(table, column);
  if (type === 'unknown') {
    return { columns: table.columns.map((c) => ({ ...c })), rows: table.rows.map((row) => ({ ...row })) };
  }
  const rows = table.rows.map((row) => ({ ...row, [column]: coerceValue(row[column], type) }));
  const columns = table.columns.map((c) => (c.name === column ? { ...c, type } : { ...c }));
  return { columns, rows };
}

/** Apply one step. Unknown kinds and missing join sources raise. */
export function applyStep(table: EtTable, step: EtlStep, ctx: PipelineContext = {}): EtTable {
  switch (step.kind) {
    case 'filter':
      return etlFilter(table, step.column, step.op, step.value);
    case 'map':
      return etlMap(table, step.name, step.expression);
    case 'reduce':
      return etlReduce(table, step.column, step.fn);
    case 'join': {
      if (!ctx.joinTable) throw new Error('join step requires a second (join) data source');
      return etlJoin(table, ctx.joinTable, step.on, step.how);
    }
    case 'groupBy':
      return etlGroupBy(table, step.keys, step.column, step.fn);
    case 'pivot':
      return etlPivot(table, step.index, step.columns, step.value, step.fn);
    case 'melt':
      return etlMelt(table, step.idColumns);
    case 'impute':
      return etlImpute(table, step.column, step.method, step.value);
    case 'normalize':
      return etlNormalize(table, step.column, step.method);
    case 'coerceType':
      return etlCoerceType(table, step.column, step.type);
    default: {
      const unknown = step as { kind?: string };
      throw new Error(`unknown step kind: ${unknown.kind ?? String(step)}`);
    }
  }
}

/** Run a full pipeline, collecting per-step row counts and wall-clock ms. */
export function runPipeline(source: EtTable, steps: ReadonlyArray<EtlStep>, ctx: PipelineContext = {}): PipelineResult {
  let table = source;
  const stats: StepStat[] = [];
  for (const step of steps) {
    const started = performance.now();
    table = applyStep(table, step, ctx);
    stats.push({ rows: table.rows.length, ms: performance.now() - started });
  }
  return { table, stats };
}

// ---- code exporters ---------------------------------------------------------------
//
// The exporters turn the step list into reference code for pandas, R (dplyr)
// and generic SQL. Map expressions are emitted verbatim (JS is close enough
// for arithmetic; the doc header says so).

interface ExportOptions {
  source?: string;
  joinSource?: string;
  table?: string;
  joinTable?: string;
}

function q(value: string): string {
  return JSON.stringify(value);
}

function sq(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function pyLiteral(value: string): string {
  const v = value.trim();
  if (v === '' || v.toLowerCase() === 'null') return 'None';
  if (v.toLowerCase() === 'true') return 'True';
  if (v.toLowerCase() === 'false') return 'False';
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  return q(value);
}

function rLiteral(value: string): string {
  const v = value.trim();
  if (v === '' || v.toLowerCase() === 'null') return 'NA';
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (v.toLowerCase() === 'true') return 'TRUE';
  if (v.toLowerCase() === 'false') return 'FALSE';
  return q(value);
}

function sqlLiteral(value: string): string {
  const v = value.trim();
  if (v === '' || v.toLowerCase() === 'null') return 'NULL';
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (v.toLowerCase() === 'true') return 'TRUE';
  if (v.toLowerCase() === 'false') return 'FALSE';
  return sq(value);
}

const PY_AGG: Record<AggFn, string> = { sum: 'sum', mean: 'mean', min: 'min', max: 'max', count: 'count' };
const SQL_AGG: Record<AggFn, string> = { sum: 'SUM', mean: 'AVG', min: 'MIN', max: 'MAX', count: 'COUNT' };
const R_AGG: Record<AggFn, string> = { sum: 'sum', mean: 'mean', min: 'min', max: 'max', count: 'sum' };

function hasJoin(steps: ReadonlyArray<EtlStep>): boolean {
  return steps.some((s) => s.kind === 'join');
}

function filterConditionPandas(column: string, op: FilterOp, value: string): string {
  const col = `df[${q(column)}]`;
  switch (op) {
    case '==':
      return `${col} == ${pyLiteral(value)}`;
    case '!=':
      return `${col} != ${pyLiteral(value)}`;
    case '>':
    case '>=':
    case '<':
    case '<=':
      return `${col} ${op} ${pyLiteral(value)}`;
    case 'contains':
      return `${col}.str.contains(${q(value)}, na=False)`;
    case 'startsWith':
      return `${col}.str.startswith(${q(value)}, na=False)`;
    case 'isMissing':
      return `${col}.isna()`;
    case 'notMissing':
      return `${col}.notna()`;
    default:
      return 'True';
  }
}

function filterConditionR(column: string, op: FilterOp, value: string): string {
  const col = column;
  switch (op) {
    case '==':
      return `${col} == ${rLiteral(value)}`;
    case '!=':
      return `${col} != ${rLiteral(value)}`;
    case '>':
    case '>=':
    case '<':
    case '<=':
      return `${col} ${op} ${rLiteral(value)}`;
    case 'contains':
      return `grepl(${q(value)}, ${col}, fixed = TRUE)`;
    case 'startsWith':
      return `startsWith(${col}, ${q(value)})`;
    case 'isMissing':
      return `is.na(${col})`;
    case 'notMissing':
      return `!is.na(${col})`;
    default:
      return 'TRUE';
  }
}

function filterConditionSql(column: string, op: FilterOp, value: string): string {
  const col = sqlIdent(column);
  switch (op) {
    case '==':
      return `${col} = ${sqlLiteral(value)}`;
    case '!=':
      return `${col} <> ${sqlLiteral(value)}`;
    case '>':
    case '>=':
    case '<':
    case '<=':
      return `${col} ${op} ${sqlLiteral(value)}`;
    case 'contains':
      return `${col} LIKE ${sq(`%${value}%`)}`;
    case 'startsWith':
      return `${col} LIKE ${sq(`${value}%`)}`;
    case 'isMissing':
      return `${col} IS NULL`;
    case 'notMissing':
      return `${col} IS NOT NULL`;
    default:
      return 'TRUE';
  }
}

function sqlIdent(name: string): string {
  const ident = name.replace(/[^\w]/g, '_');
  return /^[A-Za-z_]/.test(ident) ? ident : `c_${ident}`;
}

function sqlValueExpr(fn: AggFn, column: string): string {
  const agg = SQL_AGG[fn];
  return `${agg}(${sqlIdent(column)})`;
}

/** Generate reference pandas code for the step list. */
export function toPandasCode(steps: ReadonlyArray<EtlStep>, opts: ExportOptions = {}): string {
  const source = opts.source ?? 'data.csv';
  const joinSource = opts.joinSource ?? 'join.csv';
  const lines: string[] = [
    '# Generated by Ergalics Studio — ETL pipeline tool.',
    '# Map expressions are emitted verbatim from the pipeline editor.',
    'import pandas as pd',
    '',
    `df = pd.read_csv(${q(source)})`,
  ];
  if (hasJoin(steps)) lines.push(`df2 = pd.read_csv(${q(joinSource)})`, '');
  for (const step of steps) {
    switch (step.kind) {
      case 'filter':
        lines.push(`df = df[${filterConditionPandas(step.column, step.op, step.value)}]`);
        break;
      case 'map':
        lines.push(`df[${q(step.name)}] = ${step.expression}`);
        break;
      case 'reduce':
        lines.push(`df = pd.DataFrame({${q(step.column)}: [df[${q(step.column)}].${PY_AGG[step.fn]}()]})`);
        break;
      case 'join':
        lines.push(`df = df.merge(df2, on=${q(step.on)}, how=${q(step.how)})`);
        break;
      case 'groupBy': {
        const keys = step.keys.map((k) => q(k)).join(', ');
        lines.push(
          `df = df.groupby([${keys}], as_index=False).agg(${sqlIdent(`${step.fn}_${step.column}`)}=(${q(step.column)}, ${q(PY_AGG[step.fn])}))`,
        );
        break;
      }
      case 'pivot':
        lines.push(
          `df = df.pivot_table(index=${q(step.index)}, columns=${q(step.columns)}, values=${q(step.value)}, aggfunc=${q(PY_AGG[step.fn])}, fill_value=0).reset_index()`,
        );
        break;
      case 'melt':
        lines.push(
          `df = df.melt(id_vars=[${step.idColumns.map((k) => q(k)).join(', ')}], var_name='variable', value_name='value')`,
        );
        break;
      case 'impute': {
        const col = `df[${q(step.column)}]`;
        const filler =
          step.method === 'mean'
            ? `${col}.mean()`
            : step.method === 'median'
              ? `${col}.median()`
              : step.method === 'mode'
                ? `${col}.mode(dropna=True).iloc[0]`
                : pyLiteral(step.value);
        lines.push(`df[${q(step.column)}] = ${col}.fillna(${filler})`);
        break;
      }
      case 'normalize':
        lines.push(
          step.method === 'minmax'
            ? `df[${q(step.column)}] = (df[${q(step.column)}] - df[${q(step.column)}].min()) / (df[${q(step.column)}].max() - df[${q(step.column)}].min())`
            : `df[${q(step.column)}] = (df[${q(step.column)}] - df[${q(step.column)}].mean()) / df[${q(step.column)}].std()`,
        );
        break;
      case 'coerceType': {
        const col = `df[${q(step.column)}]`;
        const cast =
          step.type === 'number'
            ? `pd.to_numeric(${col}, errors='coerce')`
            : step.type === 'date'
              ? `pd.to_datetime(${col}, errors='coerce')`
              : step.type === 'boolean'
                ? `${col}.astype('boolean')`
                : step.type === 'string'
                  ? `${col}.astype('string')`
                  : col;
        lines.push(`df[${q(step.column)}] = ${cast}`);
        break;
      }
      default:
        break;
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Generate reference R (dplyr) code for the step list. */
export function toRCode(steps: ReadonlyArray<EtlStep>, opts: ExportOptions = {}): string {
  const source = opts.source ?? 'data.csv';
  const joinSource = opts.joinSource ?? 'join.csv';
  const lines: string[] = [
    '# Generated by Ergalics Studio — ETL pipeline tool.',
    'library(dplyr)',
    '',
    `df <- read.csv(${q(source)})`,
  ];
  if (hasJoin(steps)) lines.push(`df2 <- read.csv(${q(joinSource)})`, '');
  for (const step of steps) {
    switch (step.kind) {
      case 'filter':
        lines.push(`df <- df %>% filter(${filterConditionR(step.column, step.op, step.value)})`);
        break;
      case 'map':
        lines.push(`df <- df %>% mutate(${step.name} = ${step.expression})`);
        break;
      case 'reduce': {
        const call =
          step.fn === 'count'
            ? `sum(!is.na(${step.column}))`
            : `${R_AGG[step.fn]}(${step.column}, na.rm = TRUE)`;
        lines.push(`df <- df %>% summarise(${sqlIdent(step.column)} = ${call})`);
        break;
      }
      case 'join':
        lines.push(`df <- df %>% ${step.how}_join(df2, by = ${q(step.on)})`);
        break;
      case 'groupBy': {
        const keys = step.keys.map((k) => sqlIdent(k)).join(', ');
        const call =
          step.fn === 'count'
            ? `sum(!is.na(${step.column}))`
            : `${R_AGG[step.fn]}(${step.column}, na.rm = TRUE)`;
        lines.push(
          `df <- df %>% group_by(${keys}) %>% summarise(${sqlIdent(`${step.fn}_${step.column}`)} = ${call}, .groups = 'drop')`,
        );
        break;
      }
      case 'pivot':
        lines.push(
          `df <- df %>% pivot_wider(names_from = ${sqlIdent(step.columns)}, values_from = ${sqlIdent(step.value)}, values_fn = ~ ${PY_AGG[step.fn]}(.x, na.rm = TRUE), values_fill = NA)`,
        );
        break;
      case 'melt': {
        const cols = step.idColumns.length > 0 ? `-c(${step.idColumns.map((k) => sqlIdent(k)).join(', ')})` : 'everything()';
        lines.push(
          `df <- df %>% pivot_longer(cols = ${cols}, names_to = 'variable', values_to = 'value')`,
        );
        break;
      }
      case 'impute': {
        const filler =
          step.method === 'mean'
            ? `mean(${step.column}, na.rm = TRUE)`
            : step.method === 'median'
              ? `median(${step.column}, na.rm = TRUE)`
              : step.method === 'mode'
                ? `names(which.max(table(${step.column})))`
                : rLiteral(step.value);
        lines.push(`df <- df %>% mutate(${step.column} = ifelse(is.na(${step.column}), ${filler}, ${step.column}))`);
        break;
      }
      case 'normalize':
        lines.push(
          step.method === 'minmax'
            ? `df <- df %>% mutate(${step.column} = (${step.column} - min(${step.column}, na.rm = TRUE)) / (max(${step.column}, na.rm = TRUE) - min(${step.column}, na.rm = TRUE)))`
            : `df <- df %>% mutate(${step.column} = (${step.column} - mean(${step.column}, na.rm = TRUE)) / sd(${step.column}, na.rm = TRUE))`,
        );
        break;
      case 'coerceType': {
        const cast =
          step.type === 'number'
            ? 'as.numeric'
            : step.type === 'date'
              ? 'as.Date'
              : step.type === 'boolean'
                ? 'as.logical'
                : step.type === 'string'
                  ? 'as.character'
                  : null;
        if (cast) lines.push(`df <- df %>% mutate(${step.column} = ${cast}(${step.column}))`);
        break;
      }
      default:
        break;
    }
  }
  return `${lines.join('\n')}\n`;
}

/** Generate generic SQL (CTE chain with window-function dialect) for the steps. */
export function toSqlCode(steps: ReadonlyArray<EtlStep>, opts: ExportOptions = {}): string {
  const table = sqlIdent(opts.table ?? 'source');
  const joinTable = sqlIdent(opts.joinTable ?? 'source2');
  const lines: string[] = [
    '-- Generated by Ergalics Studio — ETL pipeline tool.',
    '-- Generic SQL (CTE chain, window-function dialect); table names are placeholders.',
  ];
  const ctes: string[] = [`s0 AS (\n  SELECT * FROM ${table}\n)`];
  const last = (i: number) => `s${i}`;
  steps.forEach((step, i) => {
    const prev = last(i);
    const cteName = `s${i + 1}`;
    let stmt: string;
    switch (step.kind) {
      case 'filter':
        stmt = `SELECT * FROM ${prev} WHERE ${filterConditionSql(step.column, step.op, step.value)}`;
        break;
      case 'map':
        stmt = `SELECT *, (${step.expression}) AS ${sqlIdent(step.name)} FROM ${prev}`;
        break;
      case 'reduce':
        stmt = `SELECT ${sqlValueExpr(step.fn, step.column)} AS ${sqlIdent(step.column)} FROM ${prev}`;
        break;
      case 'join':
        stmt = `SELECT l.*, r.* FROM ${prev} l ${step.how === 'left' ? 'LEFT JOIN' : 'JOIN'} ${joinTable} r ON l.${sqlIdent(step.on)} = r.${sqlIdent(step.on)}`;
        break;
      case 'groupBy': {
        const keys = step.keys.map((k) => sqlIdent(k));
        stmt = `SELECT ${[...keys, `${sqlValueExpr(step.fn, step.column)} AS ${sqlIdent(`${step.fn}_${step.column}`)}`].join(', ')} FROM ${prev} GROUP BY ${keys.join(', ')}`;
        break;
      }
      case 'pivot': {
        // Distinct column values are not known statically; emit a template the
        // reader fills per value (kept valid by using the placeholder <value>).
        const aggCall = (v: string) =>
          step.fn === 'count'
              ? `SUM(CASE WHEN ${sqlIdent(step.columns)} = ${sq(v)} THEN 1 ELSE 0 END)`
              : step.fn === 'mean'
                ? `AVG(CASE WHEN ${sqlIdent(step.columns)} = ${sq(v)} THEN ${sqlIdent(step.value)} END)`
                : `${SQL_AGG[step.fn]}(CASE WHEN ${sqlIdent(step.columns)} = ${sq(v)} THEN ${sqlIdent(step.value)} ELSE 0 END)`;
        stmt = [
          `SELECT ${sqlIdent(step.index)},`,
          `  ${aggCall('<value>')} AS <value_column>  -- repeat per distinct ${step.columns} value`,
          `FROM ${prev}`,
          `GROUP BY ${sqlIdent(step.index)}`,
        ].join('\n');
        break;
      }
      case 'melt': {
        // UNION ALL per value column; value columns are the non-id columns.
        const ids = step.idColumns.map((k) => sqlIdent(k));
        stmt = [
          `-- melt: one UNION ALL branch per non-id column, e.g.`,
          `SELECT ${[...ids, sq('column_name'), sqlIdent('column_name')].join(', ')}`,
          `FROM ${prev}`,
          `UNION ALL`,
          `SELECT ${[...ids, sq('other_column'), sqlIdent('other_column')].join(', ')}`,
          `FROM ${prev}`,
        ].join('\n');
        break;
      }
      case 'impute': {
        const col = sqlIdent(step.column);
        const filler =
          step.method === 'mean'
            ? `AVG(${col}) OVER ()`
            : step.method === 'median'
              ? `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ${col}) OVER ()`
              : step.method === 'mode'
                ? `(SELECT ${col} FROM ${prev} WHERE ${col} IS NOT NULL GROUP BY ${col} ORDER BY COUNT(*) DESC LIMIT 1)`
                : sqlLiteral(step.value);
        stmt = `SELECT *, COALESCE(${col}, ${filler}) AS ${col} FROM ${prev}`;
        break;
      }
      case 'normalize': {
        const col = sqlIdent(step.column);
        stmt =
          step.method === 'minmax'
            ? `SELECT *, (${col} - MIN(${col}) OVER ()) / NULLIF(MAX(${col}) OVER () - MIN(${col}) OVER (), 0) AS ${col} FROM ${prev}`
            : `SELECT *, (${col} - AVG(${col}) OVER ()) / NULLIF(STDDEV_SAMP(${col}) OVER (), 0) AS ${col} FROM ${prev}`;
        break;
      }
      case 'coerceType': {
        const col = sqlIdent(step.column);
        const sqlType =
          step.type === 'number'
            ? 'NUMERIC'
            : step.type === 'date'
              ? 'DATE'
              : step.type === 'boolean'
                ? 'BOOLEAN'
                : step.type === 'string'
                  ? 'VARCHAR'
                  : null;
        stmt = sqlType
          ? `SELECT *, CAST(${col} AS ${sqlType}) AS ${col} FROM ${prev}`
          : `SELECT * FROM ${prev}`;
        break;
      }
      default:
        stmt = `SELECT * FROM ${prev}`;
        break;
    }
    ctes.push(`${cteName} AS (\n  ${stmt}\n)`);
  });
  lines.push(`WITH ${ctes.join(',\n')}`, `SELECT * FROM s${steps.length};`);
  return `${lines.join('\n')}\n`;
}

// ---- flow-mode DAG export ---------------------------------------------------------

/**
 * Map the step chain onto a flow-mode DAG (BlockGraphState shape). The block
 * catalog cannot express every ETL primitive, so transforms are exported as
 * generic typed nodes (`etl.<kind>`); only the source uses a catalog block.
 */
export function stepsToFlowGraph(steps: ReadonlyArray<EtlStep>, opts: { source?: string } = {}): BlockGraphState {
  const instances: BlockInstance[] = [];
  const connections: BlockConnection[] = [];
  instances.push({
    id: 'etl-source',
    blockId: 'source.file',
    position: { x: 40, y: 40 },
    params: { fileName: opts.source ?? 'data.csv' },
  });
  let x = 40;
  let y = 200;
  steps.forEach((step, i) => {
    const id = `etl-step-${i + 1}`;
    const params: Record<string, unknown> = { ...step } as Record<string, unknown>;
    delete params.kind;
    instances.push({ id, blockId: `etl.${step.kind}`, position: { x, y }, params });
    connections.push({
      id: `etl-conn-${i + 1}`,
      from: { nodeId: i === 0 ? 'etl-source' : `etl-step-${i}`, portId: 'out' },
      to: { nodeId: id, portId: 'data' },
    });
    x += 220;
    if (x > 40 + 220 * 5) {
      x = 40;
      y += 150;
    }
  });
  return { instances, connections, viewport: { x: 0, y: 0, zoom: 1 } };
}
