// ==========================================================================
// Ergalics Studio — DataTable & data-flow value types (block system)
//
// DataTable is the single data type that flows between blocks. It is a pure
// in-memory, columnar table: each column is a typed array (or string/boolean
// array) so it can be uploaded to the GPU or iterated row-wise for rendering.
// ==========================================================================

export type ColumnType = 'f32' | 'f64' | 'i32' | 'u32' | 'string' | 'boolean';

/** Columnar storage for a single column. */
export type ColumnData =
  | Float64Array
  | Float32Array
  | Int32Array
  | Uint32Array
  | string[]
  | boolean[];

export interface ColumnMeta {
  name: string;
  type: ColumnType;
  /** Physical unit (e.g. "kg", "m/s", "K"), optional. */
  unit?: string;
  /** Described numeric range, optional. */
  range?: { min: number; max: number };
}

export interface DataTable {
  readonly id: string;
  readonly columns: ColumnMeta[];
  /** Number of rows (all columns share this length). */
  readonly length: number;
  /** Access a column by name; undefined when the column does not exist. */
  getColumn(name: string): ColumnData | undefined;
  /** Read one row as a name → value record. */
  getRow(index: number): Record<string, unknown>;
  columnNames(): string[];
  tags: string[];
  /** Human-readable provenance string for traceability. */
  provenance: string;
}

/**
 * A scalar value flowing through a port. Produced by reduction blocks
 * (e.g. `math.vector_dot`) and consumed by control-flow selectors.
 */
export interface Scalar {
  readonly kind: 'scalar';
  readonly value: number | string | boolean;
}

/**
 * A handle to a rendered visualization. Produced by `viz.*` blocks and
 * rendered by an existing plugin; the block system itself never draws.
 */
export interface RenderedView {
  readonly kind: 'rendered-view';
  readonly id: string;
  /** Which plugin/kind rendered this view (e.g. 'scatter'). */
  readonly viewType: string;
  readonly data?: unknown;
}

/** The union of values that may flow between ports. */
export type DataValue = DataTable | Dataset | Scalar | RenderedView;

// ---- research-grade ND data ------------------------------------------------
//
// `DataTable` is a strict 2D columnar table, but real scientific data is
// N-dimensional (FITS images, HDF5 datasets, NetCDF variables with coordinate
// axes). `Dataset` is the first-class research container that carries that
// shape. The two live side by side in `DataValue`: legacy blocks keep
// consuming `DataTable`, while `datasetToTable()` flattens a `Dataset` for
// them when a 2D view is all they can take.

/** One dimension of a `Dataset`, optionally carrying a physical coordinate. */
export interface DatasetAxis {
  name: string;
  /** Physical unit of the coordinate along this axis (e.g. "nm", "deg"). */
  unit?: string;
  /**
   * Explicit coordinate values (length === `dims[i]`). When absent the axis
   * is an implicit 0-based index. A coordinate axis is what makes a NetCDF
   * "time" dimension actually mean seconds since 2000-01-01, not row 0..N.
   */
  values?: Float64Array | number[];
}

export interface Dataset {
  readonly kind: 'dataset';
  readonly id: string;
  readonly name: string;
  /** Shape, row-major (e.g. [28, 28] for an image, [samples, features] for a matrix). */
  readonly dims: number[];
  /** Flattened, row-major payload. Typed array for numerics. */
  readonly data: ColumnData;
  /** One axis per entry in `dims`. */
  readonly axes: DatasetAxis[];
  /** Physical unit of the *values* (distinct from axis units). */
  readonly unit?: string;
  /** Format-specific metadata: FITS header cards, HDF5 attributes, etc. */
  readonly attrs: Record<string, unknown>;
  readonly provenance: string;
}

// ---- implementation ----

export interface ColumnSpec {
  name: string;
  type: ColumnType;
  data: ColumnData;
  unit?: string;
  range?: { min: number; max: number };
}

interface Column {
  meta: ColumnMeta;
  data: ColumnData;
}

export class MemoryDataTable implements DataTable {
  readonly id: string;
  readonly columns: ColumnMeta[];
  readonly length: number;
  tags: string[];
  provenance: string;

  private readonly byName = new Map<string, ColumnData>();
  private readonly list: Column[];

  constructor(
    id: string,
    columns: ColumnSpec[],
    opts?: { tags?: string[]; provenance?: string },
  ) {
    this.id = id;
    this.tags = opts?.tags ?? [];
    this.provenance = opts?.provenance ?? '';

    if (columns.length === 0) {
      throw new Error('DataTable requires at least one column');
    }

    const length = columns[0]!.data.length;
    const list: Column[] = [];
    const metas: ColumnMeta[] = [];

    for (const spec of columns) {
      if (spec.data.length !== length) {
        throw new Error(
          `column "${spec.name}" has length ${spec.data.length}, expected ${length}`,
        );
      }
      if (this.byName.has(spec.name)) {
        throw new Error(`duplicate column name "${spec.name}"`);
      }
      const meta: ColumnMeta = {
        name: spec.name,
        type: spec.type,
        unit: spec.unit,
        range: spec.range,
      };
      metas.push(meta);
      list.push({ meta, data: spec.data });
      this.byName.set(spec.name, spec.data);
    }

    this.columns = metas;
    this.list = list;
    this.length = length;
  }

  getColumn(name: string): ColumnData | undefined {
    return this.byName.get(name);
  }

  getRow(index: number): Record<string, unknown> {
    if (index < 0 || index >= this.length) {
      throw new Error(`row index ${index} out of range [0, ${this.length})`);
    }
    const row: Record<string, unknown> = {};
    for (const col of this.list) {
      row[col.meta.name] = col.data[index];
    }
    return row;
  }

  columnNames(): string[] {
    return this.columns.map((c) => c.name);
  }
}

export function createDataTable(
  id: string,
  columns: ColumnSpec[],
  opts?: { tags?: string[]; provenance?: string },
): MemoryDataTable {
  return new MemoryDataTable(id, columns, opts);
}

/** Runtime type guards for narrowing `DataValue`. */
export function isDataTable(value: DataValue | undefined): value is DataTable {
  // Structural check, not just "has no kind": a plain dict (e.g. a runtime
  // `{x: 1}` object) also lacks a `kind` but is not a table — treating it as
  // one previously let a non-table flow into column accessors and crash.
  return (
    value !== undefined &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !('kind' in value) &&
    typeof (value as DataTable).columnNames === 'function' &&
    typeof (value as DataTable).getColumn === 'function' &&
    Array.isArray((value as DataTable).columns) &&
    typeof (value as DataTable).length === 'number'
  );
}

export function isScalar(value: DataValue | undefined): value is Scalar {
  return value !== undefined && 'kind' in value && value.kind === 'scalar';
}

export function isRenderedView(value: DataValue | undefined): value is RenderedView {
  return value !== undefined && 'kind' in value && value.kind === 'rendered-view';
}

export function isDataset(value: DataValue | undefined): value is Dataset {
  return value !== undefined && 'kind' in value && value.kind === 'dataset';
}

/**
 * Flatten a `Dataset` into a 2D `DataTable` so legacy blocks/plugins that only
 * understand tables can still consume it. A 1-D dataset becomes a single
 * column; a 2-D `[M, N]` dataset becomes `N` columns of length `M` (each
 * column is one feature / band). Higher-rank datasets are not flattenable
 * here — they must be handled by dataset-aware viewers directly.
 *
 * Column names come from the second axis' coordinate values when present
 * (e.g. a NetCDF `lat` axis), falling back to `c{index}` otherwise. The
 * dataset's value `unit` is propagated onto every column.
 */
export function datasetToTable(ds: Dataset, id = `${ds.id}__table`): MemoryDataTable {
  if (ds.dims.length === 0) {
    throw new Error('cannot flatten a 0-dimensional dataset');
  }
  if (ds.dims.length > 2) {
    throw new Error(
      `cannot flatten a ${ds.dims.length}-D dataset to a table; use a dataset-aware viewer`,
    );
  }

  const data = ds.data;
  // Only numeric datasets flatten to a table; string/boolean datasets have no
  // strided column semantics and must be handled by dataset-aware viewers.
  if (
    !(data instanceof Float64Array || data instanceof Float32Array ||
      data instanceof Int32Array || data instanceof Uint32Array)
  ) {
    throw new Error('only numeric datasets can be flattened to a table');
  }
  if (ds.dims.length === 1) {
    const name = ds.axes[0]?.name || 'value';
    return createDataTable(id, [{ name, type: columnTypeOf(data), data, unit: ds.unit }]);
  }

  const cols = ds.dims[1]!;
  const axis1 = ds.axes[1];
  const columns: ColumnSpec[] = [];
  for (let j = 0; j < cols; j += 1) {
    const name =
      axis1?.values && axis1.values.length === cols
        ? String(axis1.values[j])
        : axis1?.name
          ? `${axis1.name}_${j}`
          : `c${j}`;
    const col = makeColumn(data, j, cols);
    columns.push({ name, type: columnTypeOf(col), data: col, unit: ds.unit });
  }
  return createDataTable(id, columns);
}

function columnTypeOf(data: ColumnData): ColumnType {
  if (data instanceof Float64Array) return 'f64';
  if (data instanceof Float32Array) return 'f32';
  if (data instanceof Int32Array) return 'i32';
  if (data instanceof Uint32Array) return 'u32';
  if (Array.isArray(data)) return typeof data[0] === 'boolean' ? 'boolean' : 'string';
  return 'f64';
}

/** Extract column `j` (stride `cols`) from a flattened row-major buffer. */
function makeColumn(
  data: ColumnData,
  j: number,
  cols: number,
): ColumnData {
  if (data instanceof Float64Array) return data.filter((_, i) => i % cols === j);
  if (data instanceof Float32Array) return data.filter((_, i) => i % cols === j);
  if (data instanceof Int32Array) return data.filter((_, i) => i % cols === j);
  if (data instanceof Uint32Array) return data.filter((_, i) => i % cols === j);
  // Unreachable: datasetToTable throws before calling makeColumn for
  // non-numeric data.
  throw new Error('only numeric datasets can be flattened to a table');
}
