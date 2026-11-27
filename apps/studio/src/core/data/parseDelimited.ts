// ==========================================================================
// Ergalics Studio — canonical delimited-text parser (single source of truth)
//
// Workbench imports (blocks/fileData.ts), the Block/Code StudioApi, and the
// Python/Notebook `studio` module must agree on exactly what a CSV means.
// The Python side calls this parser through the `studio_bridge` JS module;
// the two JS entry points call it directly. No entry point keeps its own
// header/comment/empty-cell rules.
//
// The 120k-row chunked reader (core/bigdata/csv-stream.ts) is deliberately
// NOT a caller: it has its own streaming performance contract.
// ==========================================================================

import { splitLooseTokens } from '@ergalics/sci-kernels/io/delimited';
import { isNumericToken } from '@/core/io/numericToken';
import { stripBOM } from '@/core/io/text';

export type DelimitedNameScheme = 'default' | 'xyz';

export interface ParsedDelimitedColumn {
  name: string;
  type: 'f64' | 'string';
  data: Float64Array | string[];
}

export interface ParsedDelimitedTable {
  columns: ParsedDelimitedColumn[];
  rows: number;
}

/** Portable, JSON-safe form used by the Pyodide bridge. */
export interface PortableDelimitedColumn {
  name: string;
  type: 'f64' | 'string';
  data: (number | string | null)[];
}

export interface PortableDelimitedTable {
  columns: PortableDelimitedColumn[];
  rows: number;
}

/** Headerless scientific data: x, y, z, w, then c4… */
export function defaultDelimitedName(i: number): string {
  return ['x', 'y', 'z', 'w'][i] ?? `c${i}`;
}

/** Headerless coordinate data: x, y, z, then c3… */
export function xyzDelimitedName(i: number): string {
  return ['x', 'y', 'z'][i] ?? `c${i}`;
}

export function nameSchemeFunction(scheme: DelimitedNameScheme): (i: number) => string {
  return scheme === 'xyz' ? xyzDelimitedName : defaultDelimitedName;
}

/**
 * Parse whitespace/comma-delimited scientific data into typed columns.
 *
 * Rules (shared by all three entry points):
 * - A UTF-8 BOM is dropped; lines are trimmed before splitting.
 * - Blank lines, separator-only lines and lines starting with `#` or `//`
 *   are metadata, never data and never a header.
 * - The first data-bearing line is a header when it contains any non-empty
 *   non-numeric token. `NaN`, `±Infinity` and overflowing numeric literals
 *   count as numbers, so they never masquerade as a header.
 * - Table width is fixed by the first data row: a short row is padded with
 *   missing cells, a longer row is malformed and skipped.
 * - An empty token is a missing value: `NaN` in an f64 column, `''` in a
 *   string column.
 * - A column is f64 if at least one non-empty token is numeric; otherwise it
 *   keeps its strings (categorical labels are legitimate scientific data).
 * - Column names come from the header, padded with `defaultName`; a header
 *   wider than the data is ignored beyond the table width.
 * - A table with no rows, or with no numeric column, is rejected with
 *   `no numeric data found` — the same message on every entry point.
 */
export function parseDelimitedColumns(
  text: string,
  defaultName: (i: number) => string = defaultDelimitedName,
): ParsedDelimitedTable {
  const lines = stripBOM(text)
    .split(/\r?\n/)
    .map((line) => line.trim());

  let header: string[] | null = null;
  const raw: string[][] = [];

  for (const line of lines) {
    if (line.length === 0 || line.startsWith('#') || line.startsWith('//')) continue;
    const tokens = splitLooseTokens(line);
    if (tokens.length === 0 || tokens.every((token) => token === '')) continue;

    if (header === null && raw.length === 0 && tokens.some((t) => t !== '' && !isNumericToken(t))) {
      header = tokens;
      continue;
    }

    if (raw.length === 0) {
      for (let i = 0; i < tokens.length; i += 1) raw.push([]);
    }
    const width = raw.length;
    if (tokens.length > width) continue;
    for (let i = 0; i < width; i += 1) raw[i]!.push(i < tokens.length ? tokens[i]! : '');
  }

  if (raw.length === 0) throw new Error('no numeric data found');

  const rows = raw[0]!.length;
  const columns: ParsedDelimitedColumn[] = raw.map((cells, i) => {
    const name = header?.[i] ?? defaultName(i);
    const numeric = cells.filter((cell) => cell !== '' && isNumericToken(cell));
    if (numeric.length === 0) {
      return { name, type: 'string', data: [...cells] };
    }
    return {
      name,
      type: 'f64',
      data: Float64Array.from(cells.map((cell) => (cell !== '' && isNumericToken(cell) ? Number(cell) : NaN))),
    };
  });

  if (!columns.some((column) => column.type === 'f64')) {
    throw new Error('no numeric data found');
  }

  return { columns, rows };
}

/** JSON cannot represent NaN/Infinity, so encode them for the Python bridge. */
function portableNumber(value: number): number | string | null {
  if (Number.isNaN(value)) return null;
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  return value;
}

/** Convert a parsed table into plain arrays the Pyodide bridge can hand over. */
export function toPortableDelimitedTable(parsed: ParsedDelimitedTable): PortableDelimitedTable {
  return {
    rows: parsed.rows,
    columns: parsed.columns.map((column) => ({
      name: column.name,
      type: column.type,
      data:
        column.type === 'f64'
          ? Array.from(column.data as Float64Array, portableNumber)
          : [...(column.data as string[])],
    })),
  };
}
