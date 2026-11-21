// Tests for the Arrow batch pipeline: CSV rows → typed vectors → IPC →
// round-trip, plus the DuckDB DDL generation (identifier escaping).

import { describe, expect, it } from 'vitest';
import {
  TYPE_SAMPLE_ROWS,
  createTableStatement,
  decodeArrowRowCount,
  duckTypeForKind,
  encodeArrowBatch,
  inferColumnKinds,
  rowsToArrowTable,
  tableFromIPC,
} from '@/core/bigdata/arrow-batch';
import type { ColumnKind } from '@/core/bigdata/stream-stats';

describe('inferColumnKinds', () => {
  it('majority-votes per column and leans numeric on ties', () => {
    const rows = [
      ['1', 'x', 'true'],
      ['2', 'y', 'false'],
      ['3.5', 'z', ''],
    ];
    expect(inferColumnKinds(rows, 3)).toEqual(['float', 'string', 'boolean'] as const);
  });

  it('returns string for empty samples', () => {
    expect(inferColumnKinds([['', ''], [' ', '']], 2)).toEqual(['string', 'string']);
  });

  it('skips ragged cells beyond the row width', () => {
    expect(inferColumnKinds([['1', '2', 'extra']], 2)).toEqual(['integer', 'integer'] as const);
  });
});

describe('createTableStatement', () => {
  it('quotes identifiers and escapes embedded quotes', () => {
    const sql = createTableStatement('weird "table"', ['na"me', 'v'], ['string', 'float']);
    expect(sql).toContain('"weird ""table"""');
    expect(sql).toContain('"na""me" VARCHAR');
    expect(sql).toContain('"v" DOUBLE');
  });

  it('names unnamed columns by position', () => {
    const sql = createTableStatement('t', ['', 'b'], ['integer', 'integer']);
    expect(sql).toContain('"(col 1)" DOUBLE');
  });
});

describe('duckTypeForKind', () => {
  it('maps kinds to DuckDB types', () => {
    expect(duckTypeForKind('integer')).toBe('DOUBLE');
    expect(duckTypeForKind('float')).toBe('DOUBLE');
    expect(duckTypeForKind('boolean')).toBe('BOOLEAN');
    expect(duckTypeForKind('string')).toBe('VARCHAR');
  });
});

describe('rowsToArrowTable + IPC round trip', () => {
  it('preserves row count and column values through encode/decode', () => {
    const header = ['n', 'label', 'flag'];
    const kinds: ColumnKind[] = ['float', 'string', 'boolean'];
    const rows = [
      ['1.5', 'a', 'true'],
      ['2', 'b', 'false'],
      ['', '', ''],
      ['4', '', 'true'],
    ];
    const table = rowsToArrowTable(rows, header, kinds);
    const ipc = encodeArrowBatch(table);
    const back = tableFromIPC(ipc);
    expect(back.numRows).toBe(4);
    expect(back.numCols).toBe(3);
    expect(decodeArrowRowCount(ipc)).toBe(4);
  });

  it('encodes an empty batch without crashing', () => {
    const table = rowsToArrowTable([], ['a'], ['string']);
    const back = tableFromIPC(encodeArrowBatch(table));
    expect(back.numRows).toBe(0);
  });

  it('handles a large batch (binary performance sanity)', () => {
    const rows = Array.from({ length: TYPE_SAMPLE_ROWS * 2 }, (_, i) => [String(i), `v${i}`]);
    const table = rowsToArrowTable(rows, ['n', 's'], ['integer', 'string']);
    const back = tableFromIPC(encodeArrowBatch(table));
    expect(back.numRows).toBe(rows.length);
  });
});
