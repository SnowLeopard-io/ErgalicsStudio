// ==========================================================================
// SQL Workbench engine tests (F7)
//
// DuckDB-WASM cannot be instantiated under Node (no worker/webgpu stack in
// jsdom / vitest node pool), so these cover the pure engine layer: table
// naming, registration SQL, history trimming, and Arrow result conversion
// (against a real apache-arrow table). The browser wiring itself is covered
// by E2E.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { tableFromArrays } from 'apache-arrow';
import {
  sanitizeTableName,
  uniqueTableNames,
  registerStatement,
  trimHistory,
  normalizeSqlValue,
  arrowTableToResult,
  SQL_MAX_HISTORY,
  type ArrowTableLike,
} from '@/core/sql/engine';

describe('sanitizeTableName', () => {
  it('strips the extension and keeps identifier characters', () => {
    expect(sanitizeTableName('orders.csv')).toBe('orders');
    expect(sanitizeTableName(' measurements_2024.tsv ')).toBe('measurements_2024');
  });

  it('folds spaces, punctuation and unicode to underscores', () => {
    expect(sanitizeTableName('my data (v2).csv')).toBe('my_data_v2');
    expect(sanitizeTableName('run-1/results.txt')).toBe('run_1_results');
  });

  it('prefixes a leading digit (reserved) and never returns empty', () => {
    expect(sanitizeTableName('2024.csv')).toBe('_2024');
    expect(sanitizeTableName('数据.csv')).toBe('data');
  });
});

describe('uniqueTableNames', () => {
  it('dedupes colliding base names with numeric suffixes', () => {
    const map = uniqueTableNames(['data.csv', 'data.json', 'data.csv']);
    expect(map.get('data.csv')).toBe('data');
    expect(map.get('data.json')).toBe('data_2');
    // Duplicate file name (same virtual file re-listed) still maps to one table.
    expect(map.get('data.csv')).toBe('data');
  });

  it('keeps sanitized names distinct and deterministic', () => {
    const map = uniqueTableNames(['2024 report.csv', '2024-report.csv']);
    expect(map.get('2024 report.csv')).toBe('_2024_report');
    expect(map.get('2024-report.csv')).toBe('_2024_report_2');
  });
});

describe('registerStatement', () => {
  it('uses read_csv_auto for tabular files and quotes the table name', () => {
    expect(registerStatement('orders', 'orders.csv')).toBe(
      `CREATE OR REPLACE TABLE "orders" AS SELECT * FROM read_csv_auto('orders.csv')`,
    );
  });

  it('uses read_json_auto for .json and escapes single quotes in file names', () => {
    expect(registerStatement('cfg', 'cfg.json')).toContain('read_json_auto');
    expect(registerStatement('t', "it's data.csv")).toContain("'it''s data.csv'");
  });
});

describe('trimHistory', () => {
  it('moves repeated SQL to the front instead of duplicating it', () => {
    const h = trimHistory([], 'SELECT 1');
    const h2 = trimHistory(h, 'SELECT 2');
    const h3 = trimHistory(h2, 'SELECT 1');
    expect(h3.map((e) => e.sql)).toEqual(['SELECT 1', 'SELECT 2']);
    expect(h3).toHaveLength(2);
  });

  it('caps the history length', () => {
    let h: ReturnType<typeof trimHistory> = [];
    for (let i = 0; i < SQL_MAX_HISTORY + 5; i += 1) {
      h = trimHistory(h, `SELECT ${i}`);
    }
    expect(h).toHaveLength(SQL_MAX_HISTORY);
    expect(h[0]!.sql).toBe(`SELECT ${SQL_MAX_HISTORY + 4}`);
  });
});

describe('normalizeSqlValue', () => {
  it('maps null/undefined to null and safe BigInts to numbers', () => {
    expect(normalizeSqlValue(null)).toBeNull();
    expect(normalizeSqlValue(undefined)).toBeNull();
    expect(normalizeSqlValue(42n)).toBe(42);
  });

  it('keeps oversized BigInts exact and describes blobs', () => {
    expect(normalizeSqlValue(9007199254740993n)).toBe('9007199254740993');
    expect(normalizeSqlValue(new Uint8Array(4))).toBe('[blob 4B]');
  });
});

describe('arrowTableToResult', () => {
  it('converts an apache-arrow table to columns and row arrays', () => {
    const table = tableFromArrays({
      id: Int32Array.from([1, 2, 3]),
      score: Float64Array.from([1.5, 2.5, 3.5]),
    });
    const r = arrowTableToResult(table as unknown as ArrowTableLike);
    expect(r.columns.map((c) => c.name)).toEqual(['id', 'score']);
    expect(r.rowCount).toBe(3);
    expect(r.rows[0]).toEqual([1, 1.5]);
    expect(r.rows[2]).toEqual([3, 3.5]);
  });

  it('preserves nulls and unwraps BigInt int64 columns', () => {
    const table = tableFromArrays({ n: [1n, null, 3n] });
    const r = arrowTableToResult(table as unknown as ArrowTableLike);
    expect(r.columns[0]!.type).toContain('64');
    expect(r.rows[0]).toEqual([1]);
    expect(r.rows[1]).toEqual([null]);
    expect(r.rows[2]).toEqual([3]);
  });
});
