// ==========================================================================
// Ergalics Studio — shared data-file parsing (flow + block/code modes)
//
// A single place that turns raw file text into a DataTable, dispatching on
// the file extension. Both the flow-mode `source.file` block and the
// block/code-mode `studio.load()` route through here so their parsing stays
// perfectly consistent (editor architecture §3.1 invariant #2).
// ==========================================================================

import { createDataTable, type DataTable } from '@/types/datatable';

interface ParsedColumns {
  names: string[];
  columns: Float64Array[];
  rows: number;
}

function toFloat64(value: number[]): Float64Array {
  return Float64Array.from(value);
}

/** Drop a leading UTF-8 BOM so it can't poison the first header token. */
function stripBOM(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function splitTokens(line: string): string[] {
  return line
    .trim()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);
}

/**
 * Parse whitespace/comma-delimited numeric columns. A header line (any line
 * containing a non-numeric token) supplies column names. The column count is
 * taken from the first numeric data row, so a header that is narrower or
 * wider than the data does not silently drop every row: names are padded with
 * defaults (or truncated) to match the data width. Malformed rows are skipped.
 */
function parseDelimitedColumns(
  text: string,
  defaultName: (i: number) => string,
): ParsedColumns {
  const lines = stripBOM(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const headerNames: string[] = [];
  const columns: number[][] = [];
  let width = 0;
  let started = false;

  for (const line of lines) {
    const tokens = splitTokens(line);
    if (tokens.length === 0) continue;

    const isHeader = !started && tokens.some((t) => !Number.isFinite(Number(t)));
    if (isHeader) {
      headerNames.push(...tokens);
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
  // Names come from the header when its width matches the data; otherwise pad
  // or truncate so the header never silently discards valid rows.
  const names = columns.map((_, i) => headerNames[i] ?? defaultName(i));
  return {
    names,
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

/**
 * Build a DataTable from a JSON document. Accepts either an array of flat row
 * records (`[{ "x": 1, "y": 2 }, ...]`) or a columnar object
 * (`{ "columns": [{ "name": "x", "data": [...] }, ...] }`). Row-record fields
 * become f64 columns when every value in the column is numeric, otherwise
 * string columns.
 */
export function loadJSON(text: string): DataTable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBOM(text));
  } catch (err) {
    throw new Error(`invalid JSON dataset: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (Array.isArray(parsed) && parsed.every((r) => r !== null && typeof r === 'object' && !Array.isArray(r))) {
    const rows = parsed as Record<string, unknown>[];
    if (rows.length === 0) throw new Error('JSON dataset is empty');
    const names = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
    const specs = names.map((name) => {
      const values = rows.map((r) => r[name]);
      const allNumeric = values.every((v) => typeof v === 'number' && Number.isFinite(v));
      if (allNumeric) {
        return { name, type: 'f64' as const, data: Float64Array.from(values as number[]) };
      }
      return { name, type: 'string' as const, data: values.map((v) => (v == null ? '' : String(v))) };
    });
    return createDataTable('json', specs, { provenance: 'loadJSON' });
  }

  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as { columns?: unknown };
    if (Array.isArray(obj.columns)) {
      const cols = obj.columns as { name?: unknown; data?: unknown }[];
      const specs = cols.map((c) => {
        const name = String(c.name ?? '');
        const data = Array.isArray(c.data) ? c.data : [];
        const allNumeric = data.every((v) => typeof v === 'number' && Number.isFinite(v));
        if (allNumeric) {
          return { name, type: 'f64' as const, data: Float64Array.from(data as number[]) };
        }
        return { name, type: 'string' as const, data: data.map((v) => (v == null ? '' : String(v))) };
      });
      if (specs.length === 0) throw new Error('JSON dataset has no columns');
      return createDataTable('json', specs, { provenance: 'loadJSON' });
    }
  }

  throw new Error('unsupported JSON dataset shape (expected row records or { columns: [...] })');
}

/**
 * Parse raw file text into a DataTable, dispatching on the file extension.
 * `.csv` / `.xyz` / `.json` get dedicated parsers; everything else falls back
 * to whitespace/comma-delimited numeric columns.
 */
export function parseDataText(text: string, fileName: string): DataTable {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) {
    return tableFromParsed(parseDelimitedColumns(text, defaultColumnName), 'loadCSV');
  }
  if (lower.endsWith('.xyz')) {
    return tableFromParsed(parseDelimitedColumns(text, xyzColumnName), 'loadXYZ');
  }
  if (lower.endsWith('.json')) {
    return loadJSON(text);
  }
  return tableFromParsed(parseDelimitedColumns(text, defaultColumnName), `load:${fileName}`);
}
