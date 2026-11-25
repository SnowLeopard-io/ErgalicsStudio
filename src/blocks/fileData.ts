// ==========================================================================
// Ergalics Studio — shared data-file parsing (flow + block/code modes)
//
// A single place that turns raw file text into a DataTable, dispatching on
// the file extension. Both the flow-mode `source.file` block and the
// block/code-mode `studio.load()` route through here so their parsing stays
// perfectly consistent (editor architecture §3.1 invariant #2).
// ==========================================================================

import { createDataTable, type DataTable } from '@/types/datatable';
import {
  defaultDelimitedName,
  parseDelimitedColumns,
  xyzDelimitedName,
  type ParsedDelimitedTable,
} from '@/core/data/parseDelimited';
import { stripBOM } from '@/core/io/text';

function tableFromParsed(parsed: ParsedDelimitedTable, provenance: string): DataTable {
  return createDataTable(
    provenance,
    parsed.columns.map((c) => ({ name: c.name, type: c.type, data: c.data })),
    { provenance },
  );
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
    return tableFromParsed(parseDelimitedColumns(text, defaultDelimitedName), 'loadCSV');
  }
  if (lower.endsWith('.xyz')) {
    return tableFromParsed(parseDelimitedColumns(text, xyzDelimitedName), 'loadXYZ');
  }
  if (lower.endsWith('.json')) {
    return loadJSON(text);
  }
  return tableFromParsed(parseDelimitedColumns(text, defaultDelimitedName), `load:${fileName}`);
}
