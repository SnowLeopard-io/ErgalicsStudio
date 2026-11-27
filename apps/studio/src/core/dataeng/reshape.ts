// ==========================================================================
// Ergalics Studio — table reshaping over `DataTable` (pure TS, no DOM)
//
// The ETL kernel already reshapes row-oriented `EtTable`s (`etlMelt` /
// `etlPivot`), but blocks and plugins carry the columnar `DataTable`. These
// helpers are the tidyr-style layer for that type:
//
//   pivotLonger  ~ tidyr::pivot_longer / pandas.melt
//   pivotWider   ~ tidyr::pivot_wider  / pandas.DataFrame.pivot
//
// Both preserve id-column types, keep first-seen level order (so plots stay
// stable), and refuse ambiguous shapes (mixed measure types, duplicate keys)
// instead of silently coercing data.
// ==========================================================================

import {
  createDataTable,
  type ColumnData,
  type ColumnSpec,
  type ColumnType,
  type DataTable,
} from '@ergalics/plugin-sdk/types';

export interface PivotLongerOptions {
  /** Columns that identify a row across the stack (e.g. subject, group). */
  idCols: string[];
  /** Columns to stack; defaults to every non-id column. */
  measureCols?: string[];
  /** Name of the new column holding the old column name (default `variable`). */
  namesTo?: string;
  /** Name of the new column holding the values (default `value`). */
  valuesTo?: string;
  /** Drop stacked rows whose value is NaN / empty (default false). */
  dropNA?: boolean;
  /** Optional new table id. */
  id?: string;
}

export interface PivotWiderOptions {
  /** Columns that identify one output row. */
  idCols: string[];
  /** Column whose levels become new columns. */
  namesFrom: string;
  /** Column holding the values for the new columns. */
  valuesFrom: string;
  /** Optional prefix for generated value column names (default none). */
  namesPrefix?: string;
  /** Optional new table id. */
  id?: string;
}

type Cell = number | string | boolean;

const NUMERIC_TYPES: ReadonlySet<ColumnType> = new Set(['f64', 'f32', 'i32', 'u32']);

function requireColumn(table: DataTable, name: string): ColumnData {
  const col = table.getColumn(name);
  if (!col) throw new Error(`reshape: column "${name}" does not exist`);
  return col;
}

function columnType(table: DataTable, name: string): ColumnType {
  const meta = table.columns.find((c) => c.name === name);
  if (!meta) throw new Error(`reshape: column "${name}" does not exist`);
  return meta.type;
}

function isNumericColumn(table: DataTable, name: string): boolean {
  return NUMERIC_TYPES.has(columnType(table, name));
}

function toArray(col: ColumnData): Cell[] {
  return Array.from(col as ArrayLike<Cell>);
}

function isMissingValue(v: Cell): boolean {
  if (typeof v === 'number') return !Number.isFinite(v);
  if (typeof v === 'string') return v.trim() === '';
  return false;
}

function numericValue(v: Cell): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Rebuild a typed column from loose cells, preserving the source type. */
function typedColumn(name: string, type: ColumnType, cells: Cell[]): ColumnSpec {
  switch (type) {
    case 'f64':
      return { name, type, data: Float64Array.from(cells as number[]) };
    case 'f32':
      return { name, type, data: Float32Array.from(cells as number[]) };
    case 'i32':
      return { name, type, data: Int32Array.from(cells as number[]) };
    case 'u32':
      return { name, type, data: Uint32Array.from(cells as number[]) };
    case 'boolean':
      return { name, type, data: cells as boolean[] };
    default:
      return { name, type: 'string', data: cells.map(String) };
  }
}

/**
 * Wide → long. Every input row is replicated once per measure column, with
 * the measure column's name and value appended.
 */
export function pivotLonger(table: DataTable, opts: PivotLongerOptions): DataTable {
  const namesTo = opts.namesTo ?? 'variable';
  const valuesTo = opts.valuesTo ?? 'value';
  if (namesTo === valuesTo) throw new Error('reshape: namesTo and valuesTo must differ');
  const all = table.columnNames();
  const idCols = opts.idCols;
  if (idCols.length === 0) throw new Error('reshape: at least one id column is required');
  for (const name of idCols) requireColumn(table, name);
  const measureCols = opts.measureCols ?? all.filter((c) => !idCols.includes(c));
  if (measureCols.length === 0) throw new Error('reshape: no measure columns to stack');
  for (const name of measureCols) requireColumn(table, name);
  if (measureCols.some((c) => idCols.includes(c))) {
    throw new Error('reshape: a column cannot be both an id and a measure column');
  }
  if (idCols.includes(namesTo) || idCols.includes(valuesTo)) {
    throw new Error('reshape: namesTo / valuesTo collide with an id column');
  }
  if (measureCols.includes(namesTo) || measureCols.includes(valuesTo)) {
    throw new Error('reshape: namesTo / valuesTo collide with a measure column');
  }

  const measureNumeric = measureCols.map((c) => isNumericColumn(table, c));
  const allNumeric = measureNumeric.every(Boolean);
  const noneNumeric = measureNumeric.every((v) => !v);
  if (!allNumeric && !noneNumeric) {
    throw new Error(
      'reshape: measure columns mix numeric and text types; select compatible columns first',
    );
  }

  const idData = idCols.map((name) => ({
    name,
    type: columnType(table, name),
    data: toArray(requireColumn(table, name)),
  }));
  const measures = measureCols.map((name) => ({
    name,
    data: toArray(requireColumn(table, name)),
  }));

  const namesOut: string[] = [];
  const valuesNumeric: number[] = [];
  const valuesText: string[] = [];
  const idOut: Cell[][] = idCols.map(() => []);

  for (let i = 0; i < table.length; i += 1) {
    for (const measure of measures) {
      const v = measure.data[i]!;
      if (opts.dropNA && isMissingValue(v)) continue;
      namesOut.push(measure.name);
      if (allNumeric) valuesNumeric.push(numericValue(v));
      else valuesText.push(typeof v === 'string' ? v : String(v));
      for (let j = 0; j < idData.length; j += 1) idOut[j]!.push(idData[j]!.data[i]!);
    }
  }

  const columns: ColumnSpec[] = idData.map((id, j) =>
    typedColumn(id.name, id.type, idOut[j]!),
  );
  columns.push(
    { name: namesTo, type: 'string', data: namesOut },
    allNumeric
      ? { name: valuesTo, type: 'f64', data: Float64Array.from(valuesNumeric) }
      : { name: valuesTo, type: 'string', data: valuesText },
  );

  return createDataTable(opts.id ?? `${table.id}__long`, columns, {
    tags: [...table.tags, 'reshaped', 'long'],
    provenance: `${table.provenance}; pivot_longer(${measureCols.join(', ')})`,
  });
}

/**
 * Long → wide. Each distinct value of `namesFrom` becomes a column; missing
 * (id, level) combinations are NaN for numeric values and "" for text.
 */
export function pivotWider(table: DataTable, opts: PivotWiderOptions): DataTable {
  const { idCols, namesFrom, valuesFrom } = opts;
  if (idCols.length === 0) throw new Error('reshape: at least one id column is required');
  for (const name of idCols) requireColumn(table, name);
  if (idCols.includes(namesFrom) || idCols.includes(valuesFrom)) {
    throw new Error('reshape: id columns cannot be the names / values source');
  }
  if (namesFrom === valuesFrom) throw new Error('reshape: namesFrom and valuesFrom must differ');
  const nameData = toArray(requireColumn(table, namesFrom));
  const valueData = toArray(requireColumn(table, valuesFrom));
  const valueNumeric = isNumericColumn(table, valuesFrom);
  const idData = idCols.map((name) => ({
    name,
    type: columnType(table, name),
    data: toArray(requireColumn(table, name)),
  }));

  // Levels in first-seen order.
  const levels: string[] = [];
  const levelIndex = new Map<string, number>();
  for (const raw of nameData) {
    if (isMissingValue(raw)) throw new Error('reshape: namesFrom contains a missing value');
    const key = String(raw);
    if (!levelIndex.has(key)) {
      levelIndex.set(key, levels.length);
      levels.push(key);
    }
  }
  const prefix = opts.namesPrefix ?? '';
  const outNames = levels.map((level) => `${prefix}${level}`);
  if (outNames.some((n) => idCols.includes(n))) {
    throw new Error('reshape: a generated column collides with an id column');
  }
  if (new Set(outNames).size !== outNames.length) {
    throw new Error('reshape: levels collapse to duplicate column names');
  }

  // One output row per distinct id combination, in first-seen order.
  const idRowIndex = new Map<string, number>();
  const idRows: Cell[][] = [];
  const seen = new Set<string>();
  const numericCells: number[][] = levels.map(() => []);
  const textCells: string[][] = levels.map(() => []);

  for (let i = 0; i < table.length; i += 1) {
    const idKey = idData.map((id) => JSON.stringify(id.data[i]!)).join('\u0001');
    const level = String(nameData[i]);
    const cellKey = `${idKey}\u0002${level}`;
    if (seen.has(cellKey)) {
      throw new Error(
        'reshape: duplicate (id, level) combination — wide output would be ambiguous; aggregate first',
      );
    }
    seen.add(cellKey);

    let outputRow = idRowIndex.get(idKey);
    if (outputRow === undefined) {
      outputRow = idRows.length;
      idRowIndex.set(idKey, outputRow);
      idRows.push(idData.map((id) => id.data[i]!));
      for (const cells of numericCells) cells.push(NaN);
      for (const cells of textCells) cells.push('');
    }
    const levelIdx = levelIndex.get(level)!;
    const raw = valueData[i]!;
    numericCells[levelIdx]![outputRow] = numericValue(raw);
    textCells[levelIdx]![outputRow] =
      typeof raw === 'string' ? raw : String(raw);
  }

  const columns: ColumnSpec[] = idData.map((id, j) =>
    typedColumn(
      id.name,
      id.type,
      idRows.map((row) => row[j]!),
    ),
  );
  levels.forEach((_, j) => {
    columns.push(
      valueNumeric
        ? { name: outNames[j]!, type: 'f64', data: Float64Array.from(numericCells[j]!) }
        : { name: outNames[j]!, type: 'string', data: textCells[j]! },
    );
  });

  return createDataTable(opts.id ?? `${table.id}__wide`, columns, {
    tags: [...table.tags, 'reshaped', 'wide'],
    provenance: `${table.provenance}; pivot_wider(${namesFrom} → ${levels.length} columns)`,
  });
}
