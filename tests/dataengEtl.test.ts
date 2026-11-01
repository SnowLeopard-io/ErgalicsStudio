// ==========================================================================
// Unit tests for the ETL Pipeline Builder plugin (data.etl):
// transform primitives (filter / map / reduce / join / groupBy / pivot /
// melt / impute / normalize / coerceType), column-type inference, CSV/JSON
// ingestion, the pandas / R / SQL code exporters and the flow-DAG export.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import type { PluginApi } from '@/types/plugin';
import {
  applyStep,
  etlCoerceType,
  etlFilter,
  etlGroupBy,
  etlImpute,
  etlJoin,
  etlMap,
  etlMelt,
  etlNormalize,
  etlPivot,
  etlReduce,
  inferColumnType,
  missingCellRate,
  parseCsvTable,
  parseJsonTable,
  runPipeline,
  stepsToFlowGraph,
  toPandasCode,
  toRCode,
  toSqlCode,
} from '@/plugins/builtin/dataeng/etl/kernel';
import type { EtlStep, EtTable } from '@/plugins/builtin/dataeng/etl/kernel';
import { etlManifest } from '@/plugins/builtin/dataeng/etl/manifest';
import createEtlPlugin from '@/plugins/builtin/dataeng/etl/plugin';

const SALES: EtTable = {
  columns: [
    { name: 'region', type: 'string' },
    { name: 'product', type: 'string' },
    { name: 'units', type: 'number' },
    { name: 'price', type: 'number' },
  ],
  rows: [
    { region: 'North', product: 'Alpha', units: 120, price: 9.5 },
    { region: 'North', product: 'Beta', units: 80, price: 12 },
    { region: 'South', product: 'Alpha', units: 60, price: 9.5 },
    { region: 'South', product: 'Beta', units: 140, price: 12 },
  ],
};

const REGION_META: EtTable = {
  columns: [
    { name: 'region', type: 'string' },
    { name: 'manager', type: 'string' },
  ],
  rows: [
    { region: 'North', manager: 'Ada' },
    { region: 'South', manager: 'Boole' },
  ],
};

describe('inferColumnType', () => {
  it('detects numbers, dates, booleans and strings', () => {
    expect(inferColumnType(['1.5', '2', '-3e1'])).toBe('number');
    expect(inferColumnType(['2025-01-15', '2025-02-20'])).toBe('date');
    expect(inferColumnType(['2025/01/15'])).toBe('date');
    expect(inferColumnType(['true', 'false', 'yes'])).toBe('boolean');
    expect(inferColumnType(['abc', '1x'])).toBe('string');
    expect(inferColumnType([1, '2'])).toBe('number');
  });

  it('returns unknown for all-missing columns', () => {
    expect(inferColumnType([null, '', undefined, Number.NaN])).toBe('unknown');
  });
});

describe('ingestion', () => {
  it('parses CSV with quoted cells and infers column types', () => {
    const table = parseCsvTable('region,units,launched\nNorth,120,2025-01-15\nSouth,,2025-02-20');
    expect(table.columns.map((c) => c.name)).toEqual(['region', 'units', 'launched']);
    expect(table.columns.map((c) => c.type)).toEqual(['string', 'number', 'date']);
    expect(table.rows[0]).toEqual({ region: 'North', units: 120, launched: '2025-01-15' });
    expect(table.rows[1]!.units).toBeNull();
  });

  it('honours double-quoted CSV cells', () => {
    const table = parseCsvTable('name,note\n"A, B","He said ""hi"""');
    expect(table.rows[0]).toEqual({ name: 'A, B', note: 'He said "hi"' });
  });

  it('parses JSON record arrays and {data: [...]} envelopes', () => {
    const direct = parseJsonTable('[{"a": 1, "b": "x"}, {"a": 2}]');
    expect(direct.rows).toHaveLength(2);
    expect(direct.columns.map((c) => c.type)).toEqual(['number', 'string']);
    const wrapped = parseJsonTable('{"data": [{"v": 5}]}');
    expect(wrapped.rows[0]!.v).toBe(5);
  });
});

describe('filter', () => {
  it('compares numerically against parsed literals', () => {
    const filtered = etlFilter(SALES, 'units', '>=', '100');
    expect(filtered.rows).toHaveLength(2);
    expect(filtered.rows.every((row) => (row.units as number) >= 100)).toBe(true);
  });

  it('supports expression columns as the left operand', () => {
    const filtered = etlFilter(SALES, 'units * price', '>', '1000');
    expect(filtered.rows.map((row) => row.region)).toEqual(['North', 'South']);
  });

  it('supports string and missing predicates', () => {
    expect(etlFilter(SALES, 'region', 'contains', 'o').rows).toHaveLength(4);
    expect(etlFilter(SALES, 'region', 'startsWith', 'N').rows).toHaveLength(2);
    const withMissing = parseCsvTable('k,v\na,1\nb,\nc,3');
    expect(etlFilter(withMissing, 'v', 'isMissing', '').rows.map((r) => r.k)).toEqual(['b']);
    expect(etlFilter(withMissing, 'v', 'notMissing', '').rows).toHaveLength(2);
  });
});

describe('map', () => {
  it('appends an expression-derived column and leaves the source intact', () => {
    const mapped = etlMap(SALES, 'revenue', 'units * price');
    expect(mapped.columns[mapped.columns.length - 1]).toEqual({ name: 'revenue', type: 'number' });
    expect(mapped.rows[0]!.revenue).toBeCloseTo(1140);
    expect(SALES.rows[0]!.revenue).toBeUndefined();
  });

  it('rejects missing output names and invalid expressions', () => {
    expect(() => etlMap(SALES, '  ', 'units')).toThrow();
    expect(() => etlMap(SALES, 'x', 'units ===')).toThrow();
  });
});

describe('reduce', () => {
  it('aggregates the whole table to one row', () => {
    expect(etlReduce(SALES, 'units', 'sum').rows[0]!.units).toBe(400);
    expect(etlReduce(SALES, 'units', 'mean').rows[0]!.units).toBe(100);
    expect(etlReduce(SALES, 'units', 'min').rows[0]!.units).toBe(60);
    expect(etlReduce(SALES, 'units', 'max').rows[0]!.units).toBe(140);
    expect(etlReduce(SALES, 'units', 'count').rows[0]!.units).toBe(4);
  });
});

describe('join', () => {
  it('inner-joins on the key column', () => {
    const joined = etlJoin(SALES, REGION_META, 'region', 'inner');
    expect(joined.columns.map((c) => c.name)).toEqual(['region', 'product', 'units', 'price', 'manager']);
    expect(joined.rows).toHaveLength(4);
    expect(joined.rows[0]!.manager).toBe('Ada');
  });

  it('left-joins keep unmatched rows with null fill and suffix collisions', () => {
    const left = { ...SALES, rows: [...SALES.rows, { region: 'West', product: 'Alpha', units: 10, price: 9 }] };
    const joined = etlJoin(left, REGION_META, 'region', 'left');
    expect(joined.rows).toHaveLength(5);
    expect(joined.rows[4]!.manager).toBeNull();

    const colliding = etlJoin(
      SALES,
      { columns: [{ name: 'region', type: 'string' }, { name: 'units', type: 'number' }], rows: [{ region: 'North', units: 999 }] },
      'region',
      'inner',
    );
    expect(colliding.columns.map((c) => c.name)).toContain('units_right');
    expect(colliding.rows[0]!.units_right).toBe(999);
  });
});

describe('groupBy', () => {
  it('groups by one key and aggregates (first-seen order)', () => {
    const grouped = etlGroupBy(SALES, ['region'], 'units', 'sum');
    expect(grouped.columns[grouped.columns.length - 1]!.name).toBe('sum_units');
    expect(grouped.rows).toEqual([
      { region: 'North', sum_units: 200 },
      { region: 'South', sum_units: 200 },
    ]);
  });

  it('groups by composite keys', () => {
    const grouped = etlGroupBy(SALES, ['region', 'product'], 'units', 'max');
    expect(grouped.rows).toHaveLength(4);
    expect(grouped.rows[0]).toEqual({ region: 'North', product: 'Alpha', max_units: 120 });
  });

  it('rejects empty keys and unknown columns', () => {
    expect(() => etlGroupBy(SALES, ['  '], 'units', 'sum')).toThrow();
    expect(() => etlGroupBy(SALES, ['nope'], 'units', 'sum')).toThrow();
  });
});

describe('pivot', () => {
  it('spreads a value column across distinct key values', () => {
    const pivoted = etlPivot(SALES, 'region', 'product', 'units', 'sum');
    expect(pivoted.columns.map((c) => c.name)).toEqual(['region', 'Alpha', 'Beta']);
    expect(pivoted.rows[0]).toEqual({ region: 'North', Alpha: 120, Beta: 80 });
    expect(pivoted.rows[1]).toEqual({ region: 'South', Alpha: 60, Beta: 140 });
  });

  it('fills missing combinations with null', () => {
    const sparse = parseCsvTable('r,c,v\nx,p1,1\ny,p2,2');
    const pivoted = etlPivot(sparse, 'r', 'c', 'v', 'sum');
    expect(pivoted.rows[0]!.p2).toBeNull();
    expect(pivoted.rows[1]!.p1).toBeNull();
  });
});

describe('melt', () => {
  it('turns wide tables into long format with variable/value columns', () => {
    const melted = etlMelt(SALES, ['region']);
    expect(melted.columns.map((c) => c.name)).toEqual(['region', 'variable', 'value']);
    expect(melted.rows).toHaveLength(SALES.rows.length * 3);
    expect(melted.rows[0]).toEqual({ region: 'North', variable: 'product', value: 'Alpha' });
    expect(melted.rows[1]).toEqual({ region: 'North', variable: 'units', value: 120 });
  });
});

describe('impute', () => {
  it('fills with mean, median, mode and constant values', () => {
    const t = parseCsvTable('k,v\na,1\nb,\nc,3');
    expect(etlImpute(t, 'v', 'mean', '').rows[1]!.v).toBe(2);
    expect(etlImpute(t, 'v', 'median', '').rows[1]!.v).toBe(2);
    expect(t.rows[1]!.v).toBeNull(); // source untouched

    const categorical = parseCsvTable('k,v\na,x\nb,\nc,y\nd,y');
    expect(etlImpute(categorical, 'v', 'mode', '').rows[1]!.v).toBe('y');

    const constant = parseCsvTable('k,v\na,\nb,5');
    expect(etlImpute(constant, 'v', 'constant', '7').rows[0]!.v).toBe(7);
  });
});

describe('normalize', () => {
  it('min-max scales into [0, 1]', () => {
    const normalized = etlNormalize(SALES, 'units', 'minmax');
    expect(normalized.rows[0]!.units).toBeCloseTo(0.75);
    expect(normalized.rows[2]!.units).toBe(0);
    expect(normalized.columns.find((c) => c.name === 'units')!.type).toBe('number');
  });

  it('z-scores with the sample standard deviation', () => {
    const normalized = etlNormalize(SALES, 'units', 'zscore');
    expect(normalized.rows[0]!.units).toBeCloseTo(0.5477, 3);
    const mean = normalized.rows.reduce((acc, row) => acc + (row.units as number), 0) / normalized.rows.length;
    expect(Math.abs(mean)).toBeLessThan(1e-9);
  });
});

describe('coerceType', () => {
  it('coerces values and reports unparseable cells as null', () => {
    const mixed = parseCsvTable('raw\n12\ntrue\n2025-01-02\nx');
    const numeric = etlCoerceType(mixed, 'raw', 'number');
    expect(numeric.columns[0]!.type).toBe('number');
    expect(numeric.rows.map((r) => r.raw)).toEqual([12, null, null, null]);

    const date = etlCoerceType(mixed, 'raw', 'date');
    expect(date.rows[2]!.raw).toBe('2025-01-02');

    const slashDate = etlCoerceType(parseCsvTable('raw\n2025/03/04'), 'raw', 'date');
    expect(slashDate.rows[0]!.raw).toBe('2025-03-04');

    const bool = etlCoerceType(mixed, 'raw', 'boolean');
    expect(bool.rows[1]!.raw).toBe(true);
  });
});

describe('pipeline runner', () => {
  it('chains steps and reports per-step stats', () => {
    const res = runPipeline(SALES, [
      { kind: 'filter', column: 'units', op: '>=', value: '80' },
      { kind: 'groupBy', keys: ['region'], column: 'units', fn: 'mean' },
    ]);
    expect(res.table.rows).toEqual([
      { region: 'North', mean_units: 100 },
      { region: 'South', mean_units: 140 },
    ]);
    expect(res.stats).toHaveLength(2);
    expect(res.stats[0]!.rows).toBe(3);
  });

  it('routes join steps through the context and fails without one', () => {
    const joined = applyStep(SALES, { kind: 'join', on: 'region', how: 'left' }, { joinTable: REGION_META });
    expect(joined.rows[0]!.manager).toBe('Ada');
    expect(() => applyStep(SALES, { kind: 'join', on: 'region', how: 'left' })).toThrow(/join/);
  });
});

describe('missingCellRate', () => {
  it('computes the share of missing cells', () => {
    expect(missingCellRate(parseCsvTable('a,b\n1,\n,2'))).toBeCloseTo(0.5);
    expect(missingCellRate(SALES)).toBe(0);
  });
});

describe('code exporters', () => {
  const steps: EtlStep[] = [
    { kind: 'filter', column: 'units', op: '>=', value: '80' },
    { kind: 'map', name: 'revenue', expression: 'units * price' },
    { kind: 'groupBy', keys: ['region'], column: 'units', fn: 'sum' },
    { kind: 'join', on: 'region', how: 'left' },
    { kind: 'pivot', index: 'region', columns: 'product', value: 'units', fn: 'sum' },
    { kind: 'melt', idColumns: ['region'] },
    { kind: 'impute', column: 'price', method: 'mean', value: '' },
    { kind: 'normalize', column: 'units', method: 'minmax' },
    { kind: 'coerceType', column: 'launched', type: 'date' },
  ];

  it('emits pandas statements for every step kind', () => {
    const code = toPandasCode(steps, { source: 'sales.csv' });
    expect(code).toContain('import pandas as pd');
    expect(code).toContain('df = pd.read_csv("sales.csv")');
    expect(code).toContain('df = df[df["units"] >= 80]');
    expect(code).toContain('df["revenue"] = units * price');
    expect(code).toContain('groupby(["region"], as_index=False)');
    expect(code).toContain('df = df.merge(df2, on="region", how="left")');
    expect(code).toContain('pivot_table(index="region"');
    expect(code).toContain('df = df.melt(id_vars=["region"]');
    expect(code).toContain('fillna(df["price"].mean())');
    expect(code).toContain('pd.to_datetime(df["launched"], errors=\'coerce\')');
  });

  it('emits R dplyr statements for every step kind', () => {
    const code = toRCode(steps, { source: 'sales.csv' });
    expect(code).toContain('library(dplyr)');
    expect(code).toContain('df <- read.csv("sales.csv")');
    expect(code).toContain('df <- df %>% filter(units >= 80)');
    expect(code).toContain('mutate(revenue = units * price)');
    expect(code).toContain('group_by(region)');
    expect(code).toContain('summarise(sum_units = sum(units, na.rm = TRUE)');
    expect(code).toContain('left_join(df2, by = "region")');
    expect(code).toContain('pivot_wider(names_from = product');
    expect(code).toContain('pivot_longer(');
    expect(code).toContain('ifelse(is.na(price), mean(price, na.rm = TRUE), price)');
    expect(code).toContain('mutate(launched = as.Date(launched))');
  });

  it('emits a SQL CTE chain for every step kind', () => {
    const code = toSqlCode(steps, { table: 'sales' });
    expect(code).toContain('WITH s0 AS');
    expect(code).toContain('SELECT * FROM sales');
    expect(code).toContain('WHERE units >= 80');
    expect(code).toContain('(units * price) AS revenue');
    expect(code).toContain('SUM(units) AS sum_units');
    expect(code).toContain('GROUP BY region');
    expect(code).toContain('LEFT JOIN source2');
    expect(code).toContain('UNION ALL');
    expect(code).toContain('COALESCE(price, AVG(price) OVER ())');
    expect(code).toContain('SELECT * FROM s9;');
  });
});

describe('flow-mode export', () => {
  it('maps the step chain onto a BlockGraphState-shaped DAG', () => {
    const graph = stepsToFlowGraph(
      [
        { kind: 'filter', column: 'units', op: '>=', value: '80' },
        { kind: 'groupBy', keys: ['region'], column: 'units', fn: 'sum' },
      ],
      { source: 'sales.csv' },
    );
    expect(graph.instances).toHaveLength(3);
    expect(graph.instances[0]).toMatchObject({ blockId: 'source.file', params: { fileName: 'sales.csv' } });
    expect(graph.instances[1]).toMatchObject({ blockId: 'etl.filter' });
    expect(graph.instances[2]).toMatchObject({ blockId: 'etl.groupBy' });
    expect(graph.connections).toHaveLength(2);
    expect(graph.connections[0]).toMatchObject({
      from: { nodeId: 'etl-source', portId: 'out' },
      to: { nodeId: 'etl-step-1', portId: 'data' },
    });
    expect(graph.connections[1]!.from.nodeId).toBe('etl-step-1');
  });
});

describe('manifest and plugin wiring', () => {
  it('declares the data.etl plugin contract', () => {
    expect(etlManifest.id).toBe('data.etl');
    expect(etlManifest.name).toBe('ETL Pipeline Builder');
    expect(etlManifest.nameI18n?.['zh-CN']).toBe('ETL 流水线');
    expect(etlManifest.category).toBe('scientific');
    expect(etlManifest.sandbox).toBe('trusted');
    expect(etlManifest.research?.tier).toBe('quasi-research');
    expect(etlManifest.research?.reproducible).toBe(true);
    expect(etlManifest.formats?.map((f) => f.extension)).toEqual(['.csv', '.json']);
  });

  it('restores persisted pipeline state and computes over CSV input', async () => {
    const saved: Record<string, unknown> = {
      pipeline: [{ kind: 'filter', column: 'units', op: '>=', value: '100' }] satisfies EtlStep[],
      apiUrl: 'https://example.org/data.json',
    };
    const api = {
      locale: 'en-US',
      onLocaleChange: () => () => {},
      getParam: (key: string) => saved[key],
      setParam: (key: string, value: unknown) => {
        saved[key] = value;
      },
      notify: () => {},
      setStatus: () => {},
      reportDataScale: () => {},
    } as unknown as PluginApi;

    const plugin = createEtlPlugin();
    await plugin.init(api);

    const urlParam = (await plugin.getParams()).find((p) => p.key === 'apiUrl');
    expect(urlParam && 'value' in urlParam ? urlParam.value : undefined).toBe('https://example.org/data.json');

    const progress: number[] = [];
    const res = await plugin.compute!('region,units\nNorth,120\nSouth,60\nEast,140', (p) => progress.push(p.done));
    expect(res.ok).toBe(true);
    const output = res.output as { rows: number };
    expect(output.rows).toBe(2);
    expect(progress).toEqual([0, 1]);
  });
});
