// ==========================================================================
// Data quality engine — profiling, expectation evaluation, row quarantine,
// schema suggestion and the DataTable adapter.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import {
  profileTable,
  profileColumn,
  suggestExpectations,
  evaluateQuality,
  splitRows,
  tableToRows,
  makeMissingChecker,
} from '@/core/data-quality';
import type { Row, TableExpectations } from '@/core/data-quality';
import { createDataTable } from '@/types/datatable';

const rows: Row[] = [
  { id: 1, age: 25, city: 'A', score: 0.5 },
  { id: 2, age: -3, city: 'B', score: Number.NaN },
  { id: 2, age: 200, city: 'A', score: 0.9 }, // duplicate id + out-of-range age
  { id: 4, age: 30, city: 'X', score: 'bad' }, // unknown category + type mismatch
];

const schema: TableExpectations = {
  minRows: 2,
  maxRows: 100,
  requiredColumns: ['id'],
  allowUnknownColumns: false,
  uniqueKeys: [['id']],
  columns: [
    { name: 'id', type: 'integer', required: true },
    { name: 'age', type: 'integer', min: 0, max: 150, required: true },
    { name: 'city', type: 'category', allowedValues: ['A', 'B'] },
    { name: 'score', type: 'number' },
  ],
};

describe('profiling', () => {
  it('infers column types and gathers numeric statistics', () => {
    const profile = profileTable(rows);
    const byName = new Map(profile.columns.map((c) => [c.name, c]));
    expect(byName.get('id')?.inferredType).toBe('integer');
    expect(byName.get('age')?.inferredType).toBe('integer');
    expect(byName.get('city')?.inferredType).toBe('category');
    // numbers + NaN + one string → mixed
    expect(byName.get('score')?.inferredType).toBe('mixed');

    const age = byName.get('age')!.numeric!;
    expect(age.min).toBe(-3);
    expect(age.max).toBe(200);
    expect(age.count).toBe(4);
  });

  it('flags IQR outliers and counts missing values', () => {
    const outlierRows: Row[] = [10, 11, 10, 12, 11, 10, 500].map((v, i) => ({ i, v }));
    const profile = profileColumn('v', outlierRows);
    expect(profile.numeric?.outlierCount).toBeGreaterThanOrEqual(1);
    expect(profile.numeric?.outlierIndices).toContain(6);

    const isMissing = makeMissingChecker();
    expect(isMissing('')).toBe(true);
    expect(isMissing(null)).toBe(true);
    expect(isMissing(Number.NaN)).toBe(true);
    expect(isMissing(0)).toBe(false);
    expect(isMissing(false)).toBe(false);

    const withMissing: Row[] = [{ x: 1 }, { x: '' }, { x: 3 }];
    const profiled = profileColumn('x', withMissing);
    expect(profiled.missing).toBe(1);
    expect(profiled.present).toBe(2);
  });
});

describe('expectation evaluation', () => {
  it('collects every violation with row-level evidence', () => {
    // NaN is treated as an explicit value here (not a missing token) so the
    // column.nan expectation path is exercised.
    const report = evaluateQuality(schema, rows, { missingTokens: [null, undefined, ''] });
    expect(report.ok).toBe(false);
    const codes = report.issues.map((issue) => issue.code);
    expect(codes).toContain('table.duplicate_key');
    expect(codes).toContain('column.min');
    expect(codes).toContain('column.max');
    expect(codes).toContain('column.allowed_values');
    expect(codes).toContain('column.type_mismatch');
    expect(codes).toContain('column.nan');

    const ageMin = report.issues.find((issue) => issue.code === 'column.min')!;
    expect(ageMin.column).toBe('age');
    expect(ageMin.rowIndices).toContain(1);

    const cityIssue = report.issues.find((issue) => issue.code === 'column.allowed_values')!;
    expect(cityIssue.rowIndices).toEqual([3]);
    expect(cityIssue.rowCount).toBe(1);

    expect(report.summary.errors).toBeGreaterThan(0);
    expect(report.summary.checks).toBeGreaterThan(0);
  });

  it('reports missing and unknown columns at table level', () => {
    const report = evaluateQuality(
      { requiredColumns: ['nope'], columns: [{ name: 'ghost', type: 'number' }] },
      rows,
    );
    const codes = report.issues.map((issue) => issue.code);
    expect(codes.filter((c) => c === 'table.missing_column')).toHaveLength(2);
  });

  it('enforces row-count bounds', () => {
    const tooFew = evaluateQuality({ minRows: 100 }, rows);
    expect(tooFew.issues[0]?.code).toBe('table.min_rows');
    const tooMany = evaluateQuality({ maxRows: 2 }, rows);
    expect(tooMany.issues[0]?.code).toBe('table.max_rows');
  });

  it('enforces scalar uniqueness and regex patterns', () => {
    const duplicateRows: Row[] = [{ k: 'a' }, { k: 'a' }, { k: 'b' }];
    const uniqueReport = evaluateQuality(
      { columns: [{ name: 'k', type: 'string', unique: true }] },
      duplicateRows,
    );
    const duplicate = uniqueReport.issues.find((issue) => issue.code === 'column.duplicate')!;
    expect(duplicate.rowIndices).toEqual([0, 1]);

    const patternReport = evaluateQuality(
      { columns: [{ name: 'k', type: 'string', pattern: '^v\\d+$' }] },
      [{ k: 'v1' }, { k: 'nope' }],
    );
    expect(patternReport.issues[0]?.code).toBe('column.pattern');
  });

  it('caps attached row indices but keeps the true total', () => {
    const badRows: Row[] = Array.from({ length: 80 }, (_, i) => ({ x: -1 - i }));
    const report = evaluateQuality(
      { columns: [{ name: 'x', type: 'number', min: 0 }] },
      badRows,
      { rowIndexCap: 20 },
    );
    const issue = report.issues.find((i) => i.code === 'column.min')!;
    expect(issue.rowIndices).toHaveLength(20);
    expect(issue.rowCount).toBe(80);
  });

  it('passes clean data', () => {
    const clean: Row[] = [
      { id: 1, age: 25, city: 'A' },
      { id: 2, age: 40, city: 'B' },
    ];
    const report = evaluateQuality(
      {
        columns: [
          { name: 'id', type: 'integer', required: true, unique: true },
          { name: 'age', type: 'integer', min: 0, max: 150 },
          { name: 'city', type: 'category', allowedValues: ['A', 'B'] },
        ],
      },
      clean,
    );
    expect(report.ok).toBe(true);
    expect(report.summary.errors).toBe(0);
  });
});

describe('schema suggestion', () => {
  it('derives a contract from a profile that re-validates the same data', () => {
    const clean: Row[] = [
      { id: 1, label: 'x', flag: true, score: 0.1 },
      { id: 2, label: 'y', flag: false, score: 0.2 },
    ];
    const profile = profileTable(clean);
    const suggested = suggestExpectations(profile);
    const byName = new Map((suggested.columns ?? []).map((c) => [c.name, c]));
    expect(byName.get('id')?.type).toBe('integer');
    expect(byName.get('label')?.type).toBe('category');
    expect(byName.get('flag')?.type).toBe('boolean');
    expect(byName.get('score')?.type).toBe('number');

    const report = evaluateQuality(suggested, clean);
    expect(report.ok).toBe(true);
  });

  it('preserves observed NaN/Infinity as allowed in the suggested contract', () => {
    const data: Row[] = [{ x: 1 }, { x: Number.NaN }];
    const options = { missingTokens: [null, undefined, ''] };
    const suggested = suggestExpectations(profileTable(data, options));
    const column = suggested.columns?.find((c) => c.name === 'x');
    expect(column?.allowNaN).toBe(true);
    expect(evaluateQuality(suggested, data, options).ok).toBe(true);
  });
});

describe('row quarantine', () => {
  it('splits accepted rows from rejected rows with reasons', () => {
    const report = evaluateQuality(schema, rows);
    const { accepted, rejected } = splitRows(rows, report);
    expect(accepted).toHaveLength(1);
    expect(rejected).toHaveLength(3);
    expect(rejected.map((r) => r.index)).toEqual([1, 2, 3]);
    expect(rejected[0]!.reasons.length).toBeGreaterThan(0);
    expect(rejected[0]!.reasons.every((issue) => issue.severity === 'error')).toBe(true);
  });
});

describe('DataTable adapter', () => {
  it('materialises columnar storage into rows', () => {
    const table = createDataTable('t1', [
      { name: 'a', type: 'f64', data: Float64Array.from([1, 2]) },
      { name: 'b', type: 'string', data: ['x', 'y'] },
    ]);
    const materialised = tableToRows(table);
    expect(materialised).toEqual([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ]);

    const report = evaluateQuality(
      { columns: [{ name: 'a', type: 'integer', min: 0 }] },
      materialised,
    );
    expect(report.ok).toBe(true);
  });
});
