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
export type DataValue = DataTable | Scalar | RenderedView;

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
  return value !== undefined && !('kind' in value);
}

export function isScalar(value: DataValue | undefined): value is Scalar {
  return value !== undefined && 'kind' in value && value.kind === 'scalar';
}

export function isRenderedView(value: DataValue | undefined): value is RenderedView {
  return value !== undefined && 'kind' in value && value.kind === 'rendered-view';
}
