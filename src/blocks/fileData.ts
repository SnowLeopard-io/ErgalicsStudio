// ==========================================================================
// Ergalics Studio — shared data-file parsing (flow + block/code modes)
//
// A single place that turns raw file text into a DataTable, dispatching on
// the file extension. Both the flow-mode `source.file` block and the
// block/code-mode `studio.load()` route through here so their parsing stays
// perfectly consistent (editor architecture §3.1 invariant #2).
// ==========================================================================

import { createDataTable, type DataTable } from '@/types/datatable';

interface ParsedColumn {
  name: string;
  type: 'f64' | 'string';
  data: Float64Array | string[];
}

interface ParsedColumns {
  columns: ParsedColumn[];
  rows: number;
}

function toFloat64(value: number[]): Float64Array {
  return Float64Array.from(value);
}

/** Drop a leading UTF-8 BOM so it can't poison the first header token. */
function stripBOM(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Split a delimited line into tokens.
 *
 * Supports RFC4180-style double-quoted fields (`"a,b"` stays one token and
 * `""` is an escaped quote) alongside the comma / whitespace separation used by
 * plain numeric data. A comma always closes a field — so `1,,3` yields an
 * explicit empty middle field — while runs of whitespace collapse into a single
 * separator (so `1   2` is two fields, not three).
 */
function splitTokens(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inQuotes = false;
  let quoted = false;
  /** A comma just closed a field, so a trailing comma still promises one more. */
  let afterComma = false;

  const flush = (force: boolean) => {
    if (force || quoted || cur.length > 0) tokens.push(cur);
    cur = '';
    quoted = false;
    afterComma = false;
  };

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (ch === ',') {
      flush(true);
      afterComma = true;
      continue;
    }
    if (/\s/.test(ch)) {
      // Collapse whitespace runs: only close a field that actually has content.
      if (cur.length > 0 || quoted) flush(false);
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || quoted || afterComma) tokens.push(cur);
  return tokens;
}

/**
 * Parse whitespace/comma-delimited data into typed columns.
 *
 * A header line (any line containing a non-numeric token) supplies column
 * names. Column count comes from the first data row; a header narrower or wider
 * than the data is padded/truncated so valid rows are never silently dropped.
 *
 * Column *types* are inferred per column, not per row: a column whose tokens
 * are all numeric becomes `f64`; a column with any numeric token keeps its
 * numbers and demotes unparseable cells to NaN (missing); a column with no
 * numeric token at all (e.g. a categorical `group` / `sample` label) becomes a
 * `string` column. Rows are only dropped when they are longer than the table
 * width. This is what lets a two-column categorical + numeric study CSV like
 * `sample,group,activity` load into a table instead of throwing
 * "no numeric data found" just because it carries a label column.
 */
function parseDelimitedColumns(
  text: string,
  defaultName: (i: number) => string,
): ParsedColumns {
  const lines = stripBOM(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let headerArr: string[] | null = null;
  const raw: string[][] = [];

  for (const line of lines) {
    const tokens = splitTokens(line);
    // Separator-only lines (`,,` / blank runs) carry no data.
    if (tokens.length === 0 || tokens.every((t) => t === '')) continue;

    // The first data-bearing line is a header when it contains any non-numeric
    // token. Once data rows exist the table width is fixed, so a later header
    // can no longer be detected — matching the old behaviour.
    if (headerArr === null && raw.length === 0 && tokens.some((t) => t !== '' && !Number.isFinite(Number(t)))) {
      headerArr = tokens;
      continue;
    }

    if (raw.length === 0) {
      for (let i = 0; i < tokens.length; i += 1) raw.push([]);
    }
    const width = raw.length;
    // Only genuinely over-long rows are malformed and dropped; a short row
    // keeps the cells it has and pads the remainder with missing values.
    if (tokens.length > width) continue;
    for (let i = 0; i < width; i += 1) {
      raw[i]!.push(i < tokens.length ? tokens[i]! : '');
    }
  }

  if (raw.length === 0) {
    throw new Error('no numeric data found');
  }

  const rows = raw[0]!.length;
  const columns: ParsedColumn[] = raw.map((cells, i) => {
    const name = headerArr?.[i] ?? defaultName(i);
    const finite = cells.filter((c) => c !== '' && Number.isFinite(Number(c)));
    if (finite.length === 0) {
      // Categorical / label column — keep its strings.
      return { name, type: 'string' as const, data: [...cells] };
    }
    // Numeric column (missing / stray tokens become NaN).
    return {
      name,
      type: 'f64' as const,
      data: toFloat64(cells.map((c) => (c !== '' && Number.isFinite(Number(c)) ? Number(c) : NaN))),
    };
  });

  // A result with only categorical columns has nothing numeric to analyze.
  if (!columns.some((c) => c.type === 'f64')) {
    throw new Error('no numeric data found');
  }

  return { columns, rows };
}

function tableFromParsed(parsed: ParsedColumns, provenance: string): DataTable {
  return createDataTable(
    provenance,
    parsed.columns.map((c) => ({ name: c.name, type: c.type, data: c.data })),
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
 * Build a DataTable from an array of flat row records. Row-record fields
 * become f64 columns when every value in the column is numeric, otherwise
 * string columns.
 */
function tableFromRowRecords(rows: Record<string, unknown>[]): DataTable {
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

/**
 * Build a DataTable from a JSON document. Accepts an array of flat row
 * records (`[{ "x": 1, "y": 2 }, ...]`), a columnar object
 * (`{ "columns": [{ "name": "x", "data": [...] }, ...] }`), or a dataset
 * envelope that carries its records in exactly one object-array field
 * (`{ meta..., "observations": [{...}, ...] }` — the bundled dataset.json
 * shape). Envelope unwrapping requires the array to be unambiguous: objects
 * carrying two or more object arrays (e.g. simulation configs with several
 * entity lists) are rejected.
 */
export function loadJSON(text: string): DataTable {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripBOM(text));
  } catch (err) {
    throw new Error(`invalid JSON dataset: ${err instanceof Error ? err.message : String(err)}`);
  }

  const isRecord = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === 'object' && !Array.isArray(v);

  if (Array.isArray(parsed) && parsed.every(isRecord)) {
    if (parsed.length === 0) throw new Error('JSON dataset is empty');
    return tableFromRowRecords(parsed as Record<string, unknown>[]);
  }

  if (isRecord(parsed)) {
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

    const recordArrays = Object.values(obj).filter(
      (v) => Array.isArray(v) && v.length > 0 && v.every(isRecord),
    );
    if (recordArrays.length === 1) {
      return tableFromRowRecords(recordArrays[0] as Record<string, unknown>[]);
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
