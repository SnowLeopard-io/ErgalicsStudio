// ==========================================================================
// Ergalics Studio — Studio API (runtime bridge for block/code modes)
//
// `studio.*` is the global object injected into every execution runtime. It
// is the code-facing analogue of the flow-mode block executors: the same
// pure helpers in `@/blocks/ops` back both, and `studio.plot` reuses the
// `render.ts` RenderedView → plugin bridge, so downstream visualization is
// zero-cost to share (block-code-modes.md §8.2, §10.4).
//
// Transforms and statistics are **table-level** so they mirror the IR
// transform/stat nodes exactly (e.g. `Normalize {data,column,mode}` → a
// table). This keeps IR → JS/Python codegen and the IR interpreter perfectly
// consistent (block-code-modes.md §3.1 invariant #2).
// ==========================================================================

import {
  addColumn as addColumnOp,
  filterRows,
  histogram as histogramOp,
  normalize as normalizeOp,
  requireColumn,
  selectColumns,
  sortRows,
  summarize,
  toDelimited,
} from '@/blocks/ops';
import type { NormalizeMode, SortDirection } from '@/blocks/ops';
import {
  createDataTable,
  isDataTable,
  type DataTable,
  type DataValue,
  type RenderedView,
} from '@/types/datatable';
import type { VizPayload } from '@/blocks/catalog/visualize';

export type PlotType =
  | 'scatter'
  | 'line'
  | 'histogram'
  | 'pointcloud'
  | 'point-cloud';

export interface PlotOpts {
  x?: string;
  y?: string;
  z?: string;
  color?: string;
  column?: string;
  bins?: number;
}

/** Comparison operators a column filter may use. */
export type ComparisonOp = '==' | '!=' | '<' | '<=' | '>' | '>=';

export type NotifyKind = 'info' | 'success' | 'warning' | 'error';

/** Host services the Studio API depends on (side effects stay here). */
export interface StudioApiHost {
  /** Resolve a project file path to its text content. */
  loadText(path: string): Promise<string>;
  /** Render a RenderedView through the plugin bridge (render.ts). */
  renderView(view: RenderedView): Promise<void>;
  notify(kind: NotifyKind, message: string): void;
  print(text: string): void;
}

export interface StudioApi {
  // ---- data ----
  load(path: string): Promise<DataTable>;
  loadCSV(text: string): DataTable;
  loadXYZ(text: string): DataTable;
  random(n: number, seed?: number): DataTable;
  range(start: number, stop: number, step?: number): DataTable;
  // ---- transforms (table-level) ----
  normalize(df: DataTable, column: string, mode?: NormalizeMode): DataTable;
  sort(df: DataTable, column: string, direction?: SortDirection): DataTable;
  select(df: DataTable, columns: string[]): DataTable;
  addColumn(df: DataTable, name: string, values: number[]): DataTable;
  filter(df: DataTable, column: string, op: ComparisonOp, value: number): DataTable;
  // ---- statistics (table-level) ----
  summary(df: DataTable, column: string): DataTable;
  histogram(df: DataTable, column: string, bins: number): DataTable;
  // ---- visualization ----
  plot(type: PlotType, data: DataTable, opts?: PlotOpts): Promise<void>;
  // ---- host interaction ----
  notify(kind: NotifyKind, message: string): void;
  print(...args: unknown[]): void;
  // ---- project-scoped persistence ----
  getParam(key: string): unknown;
  setParam(key: string, value: unknown): void;
}

// ---- plot type → plugin id (kept in sync with @/blocks/catalog/visualize) ----

const PLOT_PLUGINS: Record<PlotType, string> = {
  scatter: 'example.scatter',
  line: 'example.timeseries',
  histogram: 'example.histogram',
  pointcloud: 'example.point-cloud',
  'point-cloud': 'example.point-cloud',
};

// ---- deterministic random (mirrors @/blocks/catalog/dataSource lcg) ----

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// ---- comparison helper (column filter) ----

function compare(a: unknown, op: ComparisonOp, b: number): boolean {
  const x = typeof a === 'number' ? a : Number(a);
  switch (op) {
    case '==': return x === b;
    case '!=': return x !== b;
    case '<': return x < b;
    case '<=': return x <= b;
    case '>': return x > b;
    case '>=': return x >= b;
  }
}

// ---- delimited text parsing ----

interface ParsedColumns {
  names: string[];
  columns: Float64Array[];
  rows: number;
}

function toFloat64(value: number[]): Float64Array {
  return Float64Array.from(value);
}

function splitTokens(line: string): string[] {
  return line
    .trim()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);
}

/**
 * Parse whitespace/comma-delimited numeric columns. A header line (any line
 * containing a non-numeric token) supplies column names; otherwise columns
 * are named via `defaultName(i)`. Malformed rows are skipped.
 */
function parseDelimitedColumns(
  text: string,
  defaultName: (i: number) => string,
): ParsedColumns {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const names: string[] = [];
  const columns: number[][] = [];
  let width = 0;
  let started = false;

  for (const line of lines) {
    const tokens = splitTokens(line);
    if (tokens.length === 0) continue;

    const isHeader = !started && tokens.some((t) => !Number.isFinite(Number(t)));
    if (isHeader) {
      // A header line fixes the column names *and* the width up front.
      names.push(...tokens);
      width = tokens.length;
      for (let i = 0; i < width; i += 1) columns.push([]);
      started = true;
      continue;
    }

    const values = tokens.map((t) => Number(t));
    if (values.some((v) => !Number.isFinite(v))) continue; // skip malformed rows
    if (!started) {
      width = values.length;
      for (let i = 0; i < width; i += 1) columns.push([]);
      started = true;
    }
    if (values.length !== width) continue; // skip ragged rows
    values.forEach((v, i) => columns[i]!.push(v));
  }

  if (!started) {
    throw new Error('no numeric data found');
  }
  const finalNames =
    names.length === width ? names : columns.map((_, i) => defaultName(i));
  return {
    names: finalNames,
    columns: columns.map((c) => toFloat64(c)),
    rows: columns[0]!.length,
  };
}

function tableFromParsed(parsed: ParsedColumns, provenance: string): DataTable {
  return createDataTable(
    provenance,
    parsed.columns.map((data, i) => ({ name: parsed.names[i]!, type: 'f64' as const, data })),
    { provenance },
  );
}

function defaultColumnName(i: number): string {
  // Headerless scientific data is conventionally x, y, z, w, then c4…, so the
  // canonical "load galaxy.dat → normalize column x" reads naturally.
  return ['x', 'y', 'z', 'w'][i] ?? `c${i}`;
}

function xyzColumnName(i: number): string {
  if (i === 0) return 'x';
  if (i === 1) return 'y';
  if (i === 2) return 'z';
  return `c${i}`;
}

// ---- Studio API implementation ----

export function createStudioApi(
  host: StudioApiHost,
  params: Map<string, unknown> = new Map(),
): StudioApi {
  const api: StudioApi = {
    async load(path) {
      const text = await host.loadText(path);
      const lower = path.toLowerCase();
      if (lower.endsWith('.csv')) return api.loadCSV(text);
      if (lower.endsWith('.xyz')) return api.loadXYZ(text);
      return tableFromParsed(parseDelimitedColumns(text, defaultColumnName), `load:${path}`);
    },

    loadCSV(text) {
      return tableFromParsed(parseDelimitedColumns(text, defaultColumnName), 'loadCSV');
    },

    loadXYZ(text) {
      return tableFromParsed(parseDelimitedColumns(text, xyzColumnName), 'loadXYZ');
    },

    random(n, seed = 1) {
      const count = Math.max(1, Math.floor(n));
      const rand = lcg(seed);
      const x = new Float64Array(count);
      for (let i = 0; i < count; i += 1) x[i] = rand();
      return createDataTable('random', [{ name: 'x', type: 'f64', data: x }], {
        provenance: 'studio.random',
      });
    },

    range(start, stop, step = 1) {
      const s = step === 0 ? 1 : step;
      const values: number[] = [];
      for (let v = start; s > 0 ? v < stop : v > stop; v += s) values.push(v);
      return createDataTable(
        'range',
        [{ name: 'value', type: 'f64', data: toFloat64(values) }],
        { provenance: 'studio.range' },
      );
    },

    normalize(df, column, mode = 'minmax') {
      const values = normalizeOp(requireColumn(df, column), mode);
      return addColumnOp(df, `${column}_${mode}`, 'f64', values);
    },

    sort(df, column, direction = 'asc') {
      return sortRows(df, column, direction);
    },

    select(df, columns) {
      return selectColumns(df, columns);
    },

    addColumn(df, name, values) {
      return addColumnOp(df, name, 'f64', toFloat64(values));
    },

    filter(df, column, op, value) {
      requireColumn(df, column);
      return filterRows(df, (row) => compare(row[column], op, value));
    },

    summary(df, column) {
      const s = summarize(requireColumn(df, column));
      return createDataTable(
        'summary',
        [
          { name: 'stat', type: 'string', data: ['mean', 'std', 'min', 'max', 'median'] },
          { name: column, type: 'f64', data: Float64Array.from([s.mean, s.std, s.min, s.max, s.median]) },
        ],
        { provenance: 'studio.summary' },
      );
    },

    histogram(df, column, bins) {
      const h = histogramOp(requireColumn(df, column), bins);
      return createDataTable(
        'hist',
        [
          { name: 'center', type: 'f64', data: h.centers },
          { name: 'count', type: 'f64', data: h.counts },
        ],
        { provenance: 'studio.histogram' },
      );
    },

    async plot(type, data, opts = {}) {
      const columns: string[] = [];
      let delimiter = ' ';
      if (type === 'histogram') {
        const col = opts.column ?? data.columnNames()[0];
        if (!col) throw new Error('histogram needs a numeric column');
        columns.push(col);
        delimiter = '\n';
      } else {
        const names = data.columnNames();
        const x = opts.x ?? names[0];
        const y = opts.y ?? names[1];
        if (!x || !y) throw new Error(`${type} needs at least two columns`);
        columns.push(x, y);
        if (type === 'scatter' && opts.color) columns.push(opts.color);
        if ((type === 'pointcloud' || type === 'point-cloud') && opts.z) columns.push(opts.z);
        if (type === 'line') delimiter = ',';
      }
      const pluginId = PLOT_PLUGINS[type];
      const payload: VizPayload = { pluginId, text: toDelimited(data, columns, delimiter) };
      const view: RenderedView = { kind: 'rendered-view', id: type, viewType: type, data: payload };
      await host.renderView(view);
    },

    notify(kind, message) {
      host.notify(kind, message);
    },

    print(...args) {
      host.print(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
    },

    getParam(key) {
      return params.get(key);
    },

    setParam(key, value) {
      params.set(key, value);
    },
  };

  return api;
}

/** Narrow a value flowing through the runtime to a DataTable. */
export function requireDataTable(value: unknown): DataTable {
  if (isDataTable(value as DataValue | undefined)) return value as DataTable;
  throw new Error('expected a DataTable');
}
