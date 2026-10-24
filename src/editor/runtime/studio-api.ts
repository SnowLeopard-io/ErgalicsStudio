// ==========================================================================
// Ergalics Studio — Studio API (runtime bridge for block/code modes)
//
// `studio.*` is the global object injected into every execution runtime. It
// is the code-facing analogue of the flow-mode block executors: the same
// pure helpers in `@/blocks/ops` back both, and `studio.plot` reuses the
// `render.ts` RenderedView → plugin bridge, so downstream visualization is
// zero-cost to share (editor architecture §8.2, §10.4).
//
// Transforms and statistics are **table-level** so they mirror the IR
// transform/stat nodes exactly (e.g. `Normalize {data,column,mode}` → a
// table). This keeps IR → JS/Python codegen and the IR interpreter perfectly
// consistent (editor architecture §3.1 invariant #2).
// ==========================================================================

import {
  addColumn as addColumnOp,
  filterRows,
  histogram as histogramOp,
  normalize as normalizeOp,
  renameColumn as renameColumnOp,
  requireColumn,
  selectColumns,
  sortRows,
  summarize,
  toDelimited,
  uniqueName,
} from '@/blocks/ops';
import type { NormalizeMode, SortDirection } from '@/blocks/ops';
import { parseDataText } from '@/blocks/fileData';
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
  /** Sine + noise sample table (t, x) — mirrors flow's source.example_data. */
  exampleData(count: number, seed?: number): DataTable;
  /** size×size coordinate grid (x, y) — mirrors flow's source.generate_grid. */
  grid(size: number): DataTable;
  range(start: number, stop: number, step?: number): DataTable;
  // ---- transforms (table-level) ----
  normalize(df: DataTable, column: string, mode?: NormalizeMode): DataTable;
  sort(df: DataTable, column: string, direction?: SortDirection): DataTable;
  select(df: DataTable, columns: string[]): DataTable;
  addColumn(df: DataTable, name: string, values: number[]): DataTable;
  /** Append a constant-valued column (flow's transform.add_column block). */
  addConstantColumn(df: DataTable, name: string, value: number): DataTable;
  filter(df: DataTable, column: string, op: ComparisonOp, value: number): DataTable;
  /** Inclusive numeric-range filter (flow's filter.range block). */
  filterRange(df: DataTable, column: string, min: number, max: number): DataTable;
  /** First K rows by column, 'largest' (default) or 'smallest' (filter.top_k). */
  topK(df: DataTable, column: string, k: number, direction?: 'largest' | 'smallest'): DataTable;
  /** Rename a column (flow's transform.rename_column block). */
  renameColumn(df: DataTable, from: string, to: string): DataTable;
  // ---- statistics (table-level) ----
  summary(df: DataTable, column: string): DataTable;
  histogram(df: DataTable, column: string, bins: number): DataTable;
  // ---- visualization ----
  plot(type: PlotType, data: DataTable, opts?: PlotOpts): Promise<void>;
  // ---- host interaction ----
  notify(kind: NotifyKind, message: string): void;
  print(...args: unknown[]): void;
  // ---- deterministic scalar RNG (python random.seed / R set.seed) ----
  /** Seed the shared scalar RNG; converted `random.seed`/`set.seed` calls. */
  seedRandom(seed: number): void;
  /** One uniform [0, 1) draw from the shared scalar RNG. */
  random01(): number;
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

/** Numeric value of a cell, or NaN when blank / not numerically comparable. */
function cellNumber(a: unknown): number {
  if (typeof a === 'number') return a;
  if (typeof a === 'boolean') return a ? 1 : 0;
  // `Number('')` is 0, so a blank cell must be turned into NaN explicitly.
  if (typeof a === 'string' && a.trim() !== '') return Number(a);
  return NaN;
}

function compare(a: unknown, op: ComparisonOp, b: number): boolean {
  const x = cellNumber(a);
  // A non-numeric cell never satisfies a numeric comparison — including `!=`,
  // where `NaN !== b` was `true` and silently kept EVERY non-numeric row.
  // This now matches the block-mode filter, which reads a numeric column.
  if (!Number.isFinite(x)) return false;
  switch (op) {
    case '==': return x === b;
    case '!=': return x !== b;
    case '<': return x < b;
    case '<=': return x <= b;
    case '>': return x > b;
    case '>=': return x >= b;
  }
}

// ---- delimited text parsing moved to @/blocks/fileData (parseDataText) ----

function toFloat64(value: number[]): Float64Array {
  return Float64Array.from(value);
}

// ---- Studio API implementation ----

export function createStudioApi(
  host: StudioApiHost,
  params: Map<string, unknown> = new Map(),
): StudioApi {
  // Shared scalar RNG for converted python/R random code. Seeded lazily so a
  // program that never draws still gets reproducible output if it does.
  let scalarRng: (() => number) | null = null;
  const api: StudioApi = {
    async load(path) {
      const text = await host.loadText(path);
      return parseDataText(text, path);
    },

    loadCSV(text) {
      return parseDataText(text, 'data.csv');
    },

    loadXYZ(text) {
      return parseDataText(text, 'data.xyz');
    },

    random(n, seed = 1) {
      const raw = Math.floor(n);
      const count = Number.isFinite(raw) ? Math.max(1, raw) : 1;
      const rand = lcg(seed);
      const x = new Float64Array(count);
      for (let i = 0; i < count; i += 1) x[i] = rand();
      return createDataTable('random', [{ name: 'x', type: 'f64', data: x }], {
        provenance: 'studio.random',
      });
    },

    exampleData(count, seed = 1) {
      // Identical generator to @/blocks/catalog/dataSource.exampleData:
      // t sweeps one turn, x = sin(t) + small LCG noise.
      const n = Math.max(1, Math.floor(Number.isFinite(count) ? count : 100));
      const rand = lcg(seed);
      const t = new Float64Array(n);
      const x = new Float64Array(n);
      for (let i = 0; i < n; i += 1) {
        t[i] = (i / n) * Math.PI * 2;
        x[i] = Math.sin(t[i]!) + (rand() - 0.5) * 0.2;
      }
      return createDataTable(
        'example',
        [
          { name: 't', type: 'f64', data: t },
          { name: 'x', type: 'f64', data: x },
        ],
        { provenance: 'studio.exampleData' },
      );
    },

    grid(size) {
      const s = Math.max(1, Math.floor(Number.isFinite(size) ? size : 10));
      const n = s * s;
      const x = new Float64Array(n);
      const y = new Float64Array(n);
      for (let i = 0; i < s; i += 1) {
        for (let j = 0; j < s; j += 1) {
          x[i * s + j] = i;
          y[i * s + j] = j;
        }
      }
      return createDataTable(
        'grid',
        [
          { name: 'x', type: 'f64', data: x },
          { name: 'y', type: 'f64', data: y },
        ],
        { provenance: 'studio.grid' },
      );
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

    addConstantColumn(df, name, value) {
      // Mirrors @/blocks/catalog/transform.add_column: broadcast a scalar
      // and de-duplicate the column name (x → x_2).
      const v = Number(value);
      if (!Number.isFinite(v)) throw new Error('addConstantColumn: value must be a number');
      const data = new Float64Array(df.length).fill(v);
      return addColumnOp(df, uniqueName(df, String(name)), 'f64', data);
    },

    filter(df, column, op, value) {
      requireColumn(df, column);
      return filterRows(df, (row) => compare(row[column], op, value));
    },

    filterRange(df, column, min, max) {
      const lo = Number(min);
      const hi = Number(max);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        throw new Error('filterRange: min/max must be numbers');
      }
      const values = requireColumn(df, column);
      return filterRows(df, (_row, i) => {
        const v = values[i]!;
        return v >= lo && v <= hi;
      });
    },

    topK(df, column, k, direction = 'largest') {
      requireColumn(df, column);
      const limit = Math.max(0, Math.floor(Number(k)));
      // Mirrors @/blocks/catalog/filter.topK: largest → desc, then first K.
      const sorted = sortRows(df, column, direction === 'smallest' ? 'asc' : 'desc');
      return filterRows(sorted, (_row, i) => i < limit);
    },

    renameColumn(df, from, to) {
      return renameColumnOp(df, String(from), String(to));
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

    seedRandom(seed) {
      scalarRng = lcg(Number(seed));
    },

    random01() {
      if (!scalarRng) scalarRng = lcg(1);
      return scalarRng();
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
