// Tests for the Schema Inference & Validator plugin (dataeng/schema):
// type inference + nullability, functional dependencies, JSON Schema
// emission, violation detection, schema drift and the data contract
// serialisation round trip.
import { describe, it, expect } from 'vitest';
import type { Row } from '@/core/data-quality';
import {
  classifyCell,
  deserializeContract,
  diffSchemas,
  fingerprintOf,
  inferSchema,
  parseDataRows,
  serializeContract,
  suggestContract,
  toJsonSchema,
  validateAgainstSchema,
  validateContract,
} from '@/plugins/builtin/dataeng/schema/kernel';
import { schemaManifest } from '@/plugins/builtin/dataeng/schema/manifest';
import createSchemaPlugin from '@/plugins/builtin/dataeng/schema/plugin';

// ---- fixtures -----------------------------------------------------------------

/** Covers integer / number / boolean / date / categorical + one nullable column. */
const baseRows: Row[] = [
  { id: 1, name: 'alpha', score: 1.5, active: true, day: '2026-01-01', site: 'A' },
  { id: 2, name: 'beta', score: 2.5, active: false, day: '2026-01-02', site: 'B' },
  { id: 3, name: 'gamma', score: 3.5, active: true, day: '2026-01-03', site: 'A' },
  { id: 4, name: 'delta', score: 4.5, active: false, day: '2026-01-04', site: 'B' },
  { id: 5, name: 'epsilon', score: null, active: true, day: '2026-01-05', site: 'A' },
];

/** Reference strings with a fixed 'dddd-dd-dd' shape but invalid month (13),
 *  so the column stays `string` (> 20 distinct values) and exposes the regex
 *  fingerprint. */
const refRows: Row[] = Array.from({ length: 25 }, (_, i) => ({
  ref: `2024-13-${String(i + 1).padStart(2, '0')}`,
  kind: 'memo',
}));

const fdRows: Row[] = [
  { city: 'Paris', country: 'France', pop: 1 },
  { city: 'Lyon', country: 'France', pop: 2 },
  { city: 'Rome', country: 'Italy', pop: 3 },
  { city: 'Milan', country: 'Italy', pop: 4 },
  { city: 'Paris', country: 'France', pop: 9 },
];

const corrRows: Row[] = [
  { depth: 10, pressure: 1.0, noise: 5 },
  { depth: 20, pressure: 2.1, noise: 3 },
  { depth: 30, pressure: 2.9, noise: 8 },
  { depth: 40, pressure: 4.2, noise: 2 },
  { depth: 50, pressure: 5.1, noise: 9 },
];

// ---- type inference -------------------------------------------------------------

describe('inferSchema type inference', () => {
  const schema = inferSchema(baseRows);
  const byName = new Map(schema.columns.map((c) => [c.name, c]));

  it('infers integer, number, boolean, date and categorical columns', () => {
    expect(byName.get('id')?.type).toBe('integer');
    expect(byName.get('score')?.type).toBe('number');
    expect(byName.get('active')?.type).toBe('boolean');
    expect(byName.get('day')?.type).toBe('date');
    expect(byName.get('site')?.type).toBe('categorical');
    expect(byName.get('name')?.type).toBe('categorical'); // 5 distinct <= 20
  });

  it('reports nullability, missing ratio and numeric/date ranges', () => {
    const score = byName.get('score')!;
    expect(score.nullable).toBe(true);
    expect(score.missingRatio).toBeCloseTo(0.2, 5);
    const id = byName.get('id')!;
    expect(id.nullable).toBe(false);
    expect(id.missingRatio).toBe(0);
    expect(id.min).toBe(1);
    expect(id.max).toBe(5);
    expect(score.min).toBe(1.5);
    expect(score.max).toBe(4.5);
    expect(score.mean).toBeCloseTo(3, 5);
    const day = byName.get('day')!;
    expect(day.min).toBe('2026-01-01');
    expect(day.max).toBe('2026-01-05');
  });

  it('flags unique complete columns as primary-key candidates with category counts', () => {
    expect(byName.get('id')?.primaryKeyCandidate).toBe(true);
    expect(byName.get('name')?.primaryKeyCandidate).toBe(true);
    expect(byName.get('site')?.primaryKeyCandidate).toBe(false);
    const site = byName.get('site')!;
    expect(site.categories?.map((c) => c.value).sort()).toEqual(['A', 'B']);
    expect(site.categories?.reduce((s, c) => s + c.count, 0)).toBe(5);
    expect(byName.get('id')?.uniqueRatio).toBe(1);
  });

  it('keeps fixed-format string columns as string with a date-like fingerprint', () => {
    const schema2 = inferSchema(refRows);
    const ref = schema2.columns.find((c) => c.name === 'ref')!;
    expect(ref.type).toBe('string');
    expect(ref.pattern).toBe('\\d{4}-\\d{2}-\\d{2}');
    expect(fingerprintOf('AB-1234')).toBe('[A-Z]{2}-\\d{4}');
  });

  it('treats CSV numbers / booleans / empty cells correctly end to end', () => {
    const rows = parseDataRows('a,b,c,d\n1,2.5,true,x\n,,false,\n3,,true,\n', 'csv');
    const schema2 = inferSchema(rows);
    const byName2 = new Map(schema2.columns.map((c) => [c.name, c]));
    expect(byName2.get('a')?.type).toBe('integer');
    expect(byName2.get('b')?.type).toBe('number');
    expect(byName2.get('b')?.nullable).toBe(true);
    expect(byName2.get('c')?.type).toBe('boolean');
    expect(byName2.get('d')?.type).toBe('categorical'); // 'x' only distinct string
    expect(classifyCell('')).toBeNull();
    expect(classifyCell(null)).toBeNull();
  });

  it('parses JSON record arrays', () => {
    const rows = parseDataRows('[{"x": 1, "s": "a"}, {"x": 2, "s": "b"}]', 'json');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ x: 1, s: 'a' });
    expect(() => parseDataRows('{"x": 1}', 'json')).toThrow();
  });
});

// ---- functional dependencies & correlations ---------------------------------------

describe('functional dependency detection', () => {
  it('finds city → country but not the reverse', () => {
    const schema = inferSchema(fdRows);
    expect(schema.functionalDependencies).toContainEqual({ determinant: 'city', dependent: 'country' });
    expect(schema.functionalDependencies).not.toContainEqual({ determinant: 'country', dependent: 'city' });
    expect(schema.functionalDependencies).toHaveLength(1); // pop is a key: trivial FDs excluded
  });

  it('reports strongly correlated numeric pairs only', () => {
    const schema = inferSchema(corrRows);
    const pair = schema.correlations.find(
      (c) => (c.a === 'depth' && c.b === 'pressure') || (c.a === 'pressure' && c.b === 'depth'),
    );
    expect(pair).toBeDefined();
    expect(pair!.r).toBeGreaterThan(0.95);
    expect(schema.correlations.some((c) => c.a === 'noise' || c.b === 'noise')).toBe(false);
  });
});

// ---- JSON Schema ------------------------------------------------------------------

describe('toJsonSchema (draft-07)', () => {
  const schema = inferSchema(baseRows);
  const jsonSchema = toJsonSchema(schema) as Record<string, unknown>;
  const props = jsonSchema.properties as Record<string, Record<string, unknown>>;

  it('declares the dialect, object type and required non-nullable columns', () => {
    expect(jsonSchema.$schema).toBe('http://json-schema.org/draft-07/schema#');
    expect(jsonSchema.type).toBe('object');
    expect(jsonSchema.required).toContain('id');
    expect(jsonSchema.required).not.toContain('score'); // nullable column
  });

  it('maps categorical columns to enum and dates to format', () => {
    expect(props.site!.enum).toEqual(['A', 'B']);
    expect(props.day!.type).toBe('string');
    expect(props.day!.format).toBe('date');
    expect(props.id!.type).toBe('integer');
    expect(props.id!.minimum).toBe(1);
    expect(props.id!.maximum).toBe(5);
  });

  it('marks nullable columns with the null union', () => {
    expect(props.score!.type).toEqual(['number', 'null']);
  });
});

// ---- validation ---------------------------------------------------------------------

describe('validateAgainstSchema', () => {
  const schema = inferSchema(baseRows);

  it('detects type errors, range breaches and missing required values', () => {
    const badRows: Row[] = [
      { id: 1, name: 'alpha', score: 2.0, active: true, day: '2026-01-02', site: 'A' },
      { id: null, name: 'beta', score: 2.5, active: false, day: '2026-01-02', site: 'B' }, // missing id
      { id: 3, name: 'gamma', score: 'oops', active: true, day: '2026-01-03', site: 'A' }, // type error
      { id: 4, name: 'delta', score: 99.9, active: false, day: '2026-01-04', site: 'B' }, // out of range
      { id: 5, name: 'epsilon', score: 3.0, active: true, day: '2025-12-01', site: 'A' }, // date out of range
      { id: 6, name: 'zeta', score: 3.0, active: true, day: '2026-01-06', site: 'Z' }, // bad category
    ];
    const result = validateAgainstSchema(badRows, schema);
    const codes = new Set(result.violations.map((v) => v.code));
    expect(codes.has('MISSING_REQUIRED')).toBe(true);
    expect(codes.has('TYPE_MISMATCH')).toBe(true);
    expect(codes.has('OUT_OF_RANGE')).toBe(true);
    expect(codes.has('INVALID_CATEGORY')).toBe(true);
    expect(result.errorCount).toBeGreaterThan(0);
    expect(result.violatingRowRatio).toBeCloseTo(5 / 6, 5);
    // every violation carries row, column, reason and actual value
    for (const v of result.violations) {
      expect(typeof v.row).toBe('number');
      expect(v.column.length).toBeGreaterThan(0);
      expect(v.reason.length).toBeGreaterThan(0);
      expect('actual' in v).toBe(true);
    }
  });

  it('accepts conforming data and grades 3-sigma outliers as warnings', () => {
    const good: Row[] = baseRows.map((r) => ({ ...r, score: typeof r.score === 'number' ? r.score : 3.0 }));
    const ok = validateAgainstSchema(good, schema);
    expect(ok.errorCount).toBe(0);
    // 3-sigma warnings need enough rows (Samuelson bound: n >= 10). One value
    // at 5.0 among eleven 2.0s deviates ~3.2 sd while staying inside [min, max].
    const odRows: Row[] = [];
    for (let i = 1; i <= 11; i += 1) odRows.push({ id: i, v: 2.0 });
    odRows.push({ id: 12, v: 5.0 });
    const odSchema = inferSchema(odRows);
    const result = validateAgainstSchema(odRows, odSchema);
    const outlier = result.violations.find((v) => v.code === 'OUTLIER_3SIGMA');
    expect(outlier?.severity).toBe('warning');
    expect(outlier?.row).toBe(11);
    expect(result.errorCount).toBe(0);
  });

  it('flags unknown columns as column-level warnings', () => {
    const rows: Row[] = [{ id: 1, name: 'x', score: 2, active: true, day: '2026-01-01', site: 'A', brand_new: 1 }];
    const result = validateAgainstSchema(rows, schema);
    const unknown = result.violations.find((v) => v.code === 'UNKNOWN_COLUMN');
    expect(unknown?.row).toBe(-1);
    expect(unknown?.column).toBe('brand_new');
    expect(unknown?.severity).toBe('warning');
  });
});

// ---- drift ------------------------------------------------------------------------

describe('diffSchemas', () => {
  const oldSchema = inferSchema(baseRows);

  it('detects added / removed columns, type changes and category expansion', () => {
    const driftRows: Row[] = [
      { id: 1, name: 'alpha', score: 1.5, active: 1, site: 'A', extra: 10 },
      { id: 2, name: 'beta', score: 2.5, active: 0, site: 'C', extra: 20 },
      { id: 3, name: 'alpha', score: 30, active: 1, site: 'A', extra: 30 },
    ];
    const newSchema = inferSchema(driftRows);
    const drift = diffSchemas(oldSchema, newSchema, { rangeTolerance: 0.05 });
    const byKind = new Map<string, Array<(typeof drift)[number]>>();
    for (const item of drift) {
      byKind.set(item.kind, [...(byKind.get(item.kind) ?? []), item]);
    }
    // day dropped entirely
    expect(byKind.get('removed-column')?.some((d) => d.column === 'day' && d.severity === 'error')).toBe(true);
    // extra is new
    expect(byKind.get('added-column')?.some((d) => d.column === 'extra' && d.severity === 'info')).toBe(true);
    // active: boolean → integer
    expect(byKind.get('type-changed')?.some((d) => d.column === 'active' && d.severity === 'error')).toBe(true);
    // site: B gone, C added
    expect(byKind.get('category-expanded')?.some((d) => d.column === 'site' && d.severity === 'warning')).toBe(true);
    expect(byKind.get('category-contracted')?.some((d) => d.column === 'site')).toBe(true);
  });

  it('reports numeric range drift beyond tolerance and stays silent within it', () => {
    const narrow: Row[] = [
      { v: 1 }, { v: 2 }, { v: 1.5 }, { v: 2 },
    ];
    const wide: Row[] = [
      { v: 1 }, { v: 2.1 }, { v: 1.5 }, { v: 2 },
    ];
    const drifted: Row[] = [
      { v: 1 }, { v: 3 }, { v: 1.5 }, { v: 2 },
    ];
    const old = inferSchema(narrow);
    expect(diffSchemas(old, inferSchema(wide), { rangeTolerance: 0.2 })).toHaveLength(0);
    const items = diffSchemas(old, inferSchema(drifted), { rangeTolerance: 0.2 });
    expect(items.some((d) => d.kind === 'range-drift' && d.column === 'v' && d.severity === 'warning')).toBe(true);
  });

  it('flags tightened nullability as a breaking change', () => {
    const tightened: Row[] = [
      { id: 1, name: 'alpha', score: 1.5, active: true, day: '2026-01-01', site: 'A' },
      { id: 2, name: 'beta', score: 2.5, active: false, day: '2026-01-02', site: 'B' },
    ];
    const drift = diffSchemas(oldSchema, inferSchema(tightened));
    const item = drift.find((d) => d.kind === 'nullable-changed' && d.column === 'score');
    expect(item?.severity).toBe('error'); // true → false: new batches must supply values
  });
});

// ---- data contract ------------------------------------------------------------------

describe('data contract', () => {
  const schema = inferSchema(baseRows);

  it('round-trips through serialise / deserialise', () => {
    const contract = suggestContract(schema, { rangeTolerance: 0.05 });
    const text = serializeContract(contract);
    expect(JSON.parse(text)).toBeTruthy();
    const restored = deserializeContract(text);
    expect(restored).toEqual(contract);
    expect(restored.constraints.uniqueKeys).toContainEqual(['id']);
    expect(restored.constraints.nonNullColumns).toContain('id');
    expect(restored.tolerances.rangeTolerance).toBe(0.05);
  });

  it('rejects malformed contracts with a clear error', () => {
    expect(() => deserializeContract('not json')).toThrow();
    expect(() => deserializeContract('{"contractVersion": 2}')).toThrow(/malformed/);
  });

  it('enforces unique keys and non-null constraints', () => {
    const contract = suggestContract(schema);
    const rows: Row[] = [
      { id: 1, name: 'alpha', score: 1.5, active: true, day: '2026-01-01', site: 'A' },
      { id: 1, name: 'alpha2', score: 1.6, active: true, day: '2026-01-02', site: 'B' }, // duplicate key
      { id: 3, name: null, score: 3.5, active: true, day: '2026-01-03', site: 'A' }, // non-null violated
    ];
    const result = validateContract(rows, contract);
    expect(result.violations.some((v) => v.code === 'UNIQUE_KEY_VIOLATION' && v.row === 1)).toBe(true);
    expect(
      result.violations.some((v) => v.code === 'MISSING_REQUIRED' && v.column === 'name' && v.row === 2),
    ).toBe(true);
  });

  it('tolerates extra columns when the contract allows them', () => {
    const contract = suggestContract(schema, { allowExtraColumns: true });
    const rows: Row[] = [
      { id: 1, name: 'alpha', score: 1.5, active: true, day: '2026-01-01', site: 'A', bonus: 1 },
    ];
    const result = validateContract(rows, contract);
    expect(result.violations.some((v) => v.code === 'UNKNOWN_COLUMN')).toBe(false);
    expect(result.errorCount).toBe(0);
  });
});

// ---- manifest / factory smoke ----------------------------------------------------------

describe('schema plugin surface', () => {
  it('declares the required manifest fields', () => {
    expect(schemaManifest.id).toBe('data.schema');
    expect(schemaManifest.name).toBe('Schema Inference & Validator');
    expect(schemaManifest.nameI18n?.['zh-CN']).toBe('Schema 推断与校验');
    expect(schemaManifest.category).toBe('scientific');
    expect(schemaManifest.sandbox).toBe('trusted');
    expect(schemaManifest.research?.tier).toBe('quasi-research');
    expect(schemaManifest.research?.reproducible).toBe(true);
    expect(schemaManifest.formats?.map((f) => f.extension).sort()).toEqual(['.csv', '.json']);
    expect(schemaManifest.descriptionI18n?.['zh-CN']).toBeTruthy();
    expect(schemaManifest.descriptionI18n?.['en-US']).toBeTruthy();
  });

  it('exposes a default factory producing a Plugin instance', () => {
    const plugin = createSchemaPlugin();
    expect(plugin.manifest.id).toBe('data.schema');
    expect(typeof plugin.init).toBe('function');
    expect(typeof plugin.getParams).toBe('function');
  });
});
