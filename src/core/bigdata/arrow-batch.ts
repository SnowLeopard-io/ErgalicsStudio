// ==========================================================================
// Ergalics Studio — CSV row batches → Apache Arrow IPC (DuckDB ingestion)
//
// The GB-scale fallback path for browsers without a streamable file handle:
// incremental CSV batches are converted to columnar Arrow tables and pushed
// into DuckDB via `insertArrowFromIPCStream`. Column types are inferred once
// from a warm-up sample (majority vote) and then frozen for the whole file,
// so arrow vectors are built with plain typed arrays (no per-cell boxing).
// Empty cells become nulls (validity bitmaps), not empty strings.
// ==========================================================================

import {
  Bool,
  Float64,
  Utf8,
  type Table,
  tableFromArrays,
  tableFromIPC,
  tableToIPC,
  vectorFromArray,
} from 'apache-arrow';
import { classifyCell, type ColumnKind } from './stream-stats';

export { tableFromIPC };

/** Warm-up rows used to infer column types before the first Arrow batch. */
export const TYPE_SAMPLE_ROWS = 500;

/**
 * Majority-vote column kinds from a warm-up sample of raw rows. Ties lean
 * numeric: a column that is numeric in the sample but might grow strings
 * later would already be VARCHAR in DuckDB anyway — the inverse (numeric
 * suffix in a DOUBLE column) is the common real-world shape (sentinels).
 */
export function inferColumnKinds(sampleRows: string[][], columnCount: number): ColumnKind[] {
  const kinds: ColumnKind[] = [];
  for (let c = 0; c < columnCount; c += 1) {
    let numeric = 0;
    let floats = 0;
    let booleans = 0;
    let strings = 0;
    for (const row of sampleRows) {
      const cell = classifyCell(row[c] ?? '');
      switch (cell.kind) {
        case 'empty':
          break; // missing cells don't vote
        case 'integer':
          numeric += 1;
          break;
        case 'float':
          numeric += 1;
          floats += 1;
          break;
        case 'boolean':
          booleans += 1;
          break;
        default:
          strings += 1;
      }
    }
    // Integer and float are one numeric family (a later decimal must not
    // flip the whole column to VARCHAR); float wins inside the family.
    if (numeric === 0 && booleans === 0) kinds.push('string');
    else if (numeric >= booleans && numeric >= strings) kinds.push(floats > 0 ? 'float' : 'integer');
    else if (booleans >= strings) kinds.push('boolean');
    else kinds.push('string');
  }
  return kinds;
}

/** DuckDB type for a scanned column kind (arrow vectors must agree). */
export function duckTypeForKind(kind: ColumnKind): string {
  switch (kind) {
    case 'integer':
    case 'float':
      return 'DOUBLE';
    case 'boolean':
      return 'BOOLEAN';
    default:
      return 'VARCHAR';
  }
}

/** CREATE TABLE matching `inferColumnKinds` output (header supplies names). */
export function createTableStatement(tableName: string, header: string[], kinds: ColumnKind[]): string {
  const cols = header
    .map((name, i) => `"${(name || `(col ${i + 1})`).replace(/"/g, '""')}" ${duckTypeForKind(kinds[i] ?? 'string')}`)
    .join(', ');
  return `CREATE OR REPLACE TABLE "${tableName.replace(/"/g, '""')}" (${cols})`;
}

/** One raw CSV row batch converted to a columnar Arrow table. */
export function rowsToArrowTable(rows: string[][], header: string[], kinds: ColumnKind[]): Table {
  const columns = new Map<string, ReturnType<typeof buildVector>>();
  for (let c = 0; c < header.length; c += 1) {
    const name = header[c] || `(col ${c + 1})`;
    const kind = kinds[c] ?? 'string';
    const values: unknown[] = [];
    for (const row of rows) {
      const raw = row[c];
      if (raw === undefined || raw === '') {
        values.push(null);
        continue;
      }
      const cell = classifyCell(raw);
      switch (kind) {
        case 'integer':
        case 'float':
          values.push(cell.numeric ?? null);
          break;
        case 'boolean':
          values.push(raw.trim().toLowerCase() === 'true' ? true : raw.trim().toLowerCase() === 'false' ? false : null);
          break;
        default:
          values.push(raw);
      }
    }
    columns.set(name, buildVector(kind, values));
  }
  // tableFromArrays wants a field-name → vector record; Map preserves
  // column order and satisfies its structural constraints once built.
  const record: Record<string, ReturnType<typeof buildVector>> = {};
  for (const [k, v] of columns) record[k] = v;
  return tableFromArrays(record as unknown as Parameters<typeof tableFromArrays>[0]);
}

function buildVector(kind: ColumnKind, values: unknown[]) {
  switch (kind) {
    case 'integer':
    case 'float':
      return vectorFromArray(values, new Float64());
    case 'boolean':
      return vectorFromArray(values, new Bool());
    default:
      return vectorFromArray(values, new Utf8());
  }
}

/** Serialize a batch for `conn.insertArrowFromIPCStream`. */
export function encodeArrowBatch(table: Table): Uint8Array {
  return tableToIPC(table, 'stream');
}

/** Sanity round-trip helper (used by tests and debug tooling). */
export function decodeArrowRowCount(ipc: Uint8Array): number {
  return tableFromIPC(ipc).numRows;
}
