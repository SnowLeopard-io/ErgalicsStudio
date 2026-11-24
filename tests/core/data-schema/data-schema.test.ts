import { describe, it, expect, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  col,
  defineTabularSchemaFromZod,
  defineJsonSchemaFromZod,
  zodToErgalicsJsonSchema,
  compileJsonSchemaToZod,
  compileTabularRowToZod,
  compileTabularCellToZod,
  coerceTabularCell,
  parseRawTabularText,
  suggestColumnMapping,
  serializeTabularRows,
  validatePluginDataText,
  deliverValidatedPayload,
  assessFileCompatibility,
  profileDataFileText,
  clearProfileCache,
  resolvePluginDataSchemas,
  SHARED_DATA_PRESETS,
  validateManifestDataSchema,
  assertSafeJsonSchema,
} from '@/core/data-schema';
import type { Plugin, PluginManifest, TabularDataSchema, JsonDataSchema } from '@/types/plugin';

describe('PluginDataSchema: Bidirectional JSON Schema <-> Zod', () => {
  it('converts Zod with col() metadata to JSON Schema and round-trips back to Zod cleanly', () => {
    const RowZod = z.object({
      time: col(z.number().positive(), {
        labelI18n: { 'zh-CN': '生存时间', 'en-US': 'Time' },
        aliases: ['t', 'days'],
        unit: 'd',
        role: 'time',
        order: 1,
      }),
      event: col(z.union([z.literal(0), z.literal(1)]), {
        labelI18n: { 'zh-CN': '事件', 'en-US': 'Event' },
        role: 'event',
        order: 2,
      }),
      group: col(z.string().min(1).optional(), {
        labelI18n: { 'zh-CN': '分组', 'en-US': 'Group' },
        role: 'group',
        order: 3,
      }),
    });

    const dataSchema = defineTabularSchemaFromZod({
      id: 'primary',
      title: 'Survival',
      extensions: ['.csv'],
      rowZod: RowZod,
      allowExtraColumns: true,
      minRows: 2,
      sampleRows: [{ time: 10, event: 1, group: 'A' }],
    });

    // Forward JSON Schema preserves x-ergalics metadata
    expect(dataSchema.rowSchema.type).toBe('object');
    expect(dataSchema.rowSchema.properties?.time?.['x-ergalics']?.unit).toBe('d');
    expect(dataSchema.rowSchema.properties?.time?.['x-ergalics']?.aliases).toEqual(['t', 'days']);
    expect(dataSchema.rowSchema.required).toEqual(['time', 'event']);

    // Reverse compile JSON Schema -> Zod and verify runtime validation
    const compiledRowZod = compileTabularRowToZod(dataSchema);
    expect(compiledRowZod.safeParse({ time: '12.5', event: '1', group: 'Treatment' }).success).toBe(true);
    expect(compiledRowZod.safeParse({ time: '12.5', event: '0', group: '' }).success).toBe(true);
    expect(compiledRowZod.safeParse({ time: '-3', event: '1' }).success).toBe(false);
    expect(compiledRowZod.safeParse({ time: '5', event: '2' }).success).toBe(false);

    // Round-trip: compiled JSON Schema -> Zod -> JSON Schema preserves x-ergalics
    const compiledPure = compileJsonSchemaToZod(dataSchema.rowSchema);
    const roundTripped = zodToErgalicsJsonSchema(compiledPure);
    expect(roundTripped.properties?.time?.['x-ergalics']?.unit).toBe('d');
    expect(roundTripped.properties?.time?.exclusiveMinimum).toBe(0);
    expect(roundTripped.required).toEqual(['time', 'event']);
  });

  it('throws on unrepresentable Zod transforms by default so non-serializable rules are caught', () => {
    const nonSerializable = z.object({
      x: z.string().transform((s) => s.length),
    });
    expect(() => zodToErgalicsJsonSchema(nonSerializable)).toThrow();
  });

  it('builds and validates JsonDataSchema bidirectionally', () => {
    const GraphZod = z.object({
      nodes: z.array(z.object({ id: z.string().min(1) })).min(1),
      links: z.array(z.object({ source: z.string().min(1), target: z.string().min(1), weight: z.number().positive() })),
    });
    const schema = defineJsonSchemaFromZod({
      id: 'graph',
      title: 'Graph',
      extensions: ['.json'],
      zod: GraphZod,
      sample: { nodes: [{ id: 'A' }], links: [] },
    });

    const resOk = validatePluginDataText(
      JSON.stringify({ nodes: [{ id: 'A' }, { id: 'B' }], links: [{ source: 'A', target: 'B', weight: 2.5 }] }),
      schema,
    );
    expect(resOk.status).toBe('ok');

    const resBad = validatePluginDataText(
      JSON.stringify({ nodes: [], links: [{ source: 'A', target: 'B', weight: -1 }] }),
      schema,
      { locale: 'zh-CN' },
    );
    expect(resBad.status).toBe('invalid');
    if (resBad.status === 'invalid') {
      expect(resBad.issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('Strict Scientific Tabular Coercion', () => {
  it('never turns blank, whitespace, or NA cells into 0', () => {
    const numCol = { type: 'number' as const };
    const nullableNumCol = { type: ['number', 'null'] as const };
    const imputedCol = {
      type: 'number' as const,
      default: 42,
      'x-ergalics': { missingPolicy: 'impute-default' as const },
    };

    expect(coerceTabularCell('', numCol)).toBeUndefined();
    expect(coerceTabularCell('   ', numCol)).toBeUndefined();
    expect(coerceTabularCell('NA', numCol)).toBeUndefined();
    expect(coerceTabularCell('NaN', numCol)).toBeUndefined();
    expect(coerceTabularCell('-', numCol)).toBeUndefined();

    expect(coerceTabularCell('', nullableNumCol)).toBeNull();
    expect(coerceTabularCell('NA', nullableNumCol)).toBeNull();
    expect(coerceTabularCell('', imputedCol)).toBe(42);

    // Valid scientific notation parses cleanly; hex/Infinity/garbage stay rejected
    expect(coerceTabularCell('-1.25e-4', numCol)).toBeCloseTo(-0.000125);
    expect(coerceTabularCell('0x10', numCol)).toBe('0x10');
    expect(coerceTabularCell('Infinity', numCol)).toBe('Infinity');

    const cellReq = compileTabularCellToZod(numCol, true);
    expect(cellReq.safeParse('').success).toBe(false);
    expect(cellReq.safeParse('NA').success).toBe(false);
    expect(cellReq.safeParse('0x10').success).toBe(false);
    expect(cellReq.safeParse('3.14').success).toBe(true);

    const cellOpt = compileTabularCellToZod(numCol, false);
    expect(cellOpt.safeParse('').success).toBe(true);
    expect(cellOpt.safeParse('abc').success).toBe(false);
  });
});

describe('Smart Column Mapping & Ingestion Pipeline', () => {
  const survivalSchema = SHARED_DATA_PRESETS['ergalics:tabular/survival-table'] as TabularDataSchema;
  const xySchema = SHARED_DATA_PRESETS['ergalics:tabular/xy-series'] as TabularDataSchema;
  const edgeSchema = SHARED_DATA_PRESETS['ergalics:tabular/edge-list'] as TabularDataSchema;

  it('auto-maps exact headers and alias headers with high confidence', () => {
    const exactParsed = parseRawTabularText('time,event,group\n12,1,A\n18,0,B');
    const exactSug = suggestColumnMapping(exactParsed, survivalSchema);
    expect(exactSug.isExactHeaderMatch).toBe(true);
    expect(exactSug.needsConfirmation).toBe(false);
    expect(exactSug.mapping).toEqual({ time: 'time', event: 'event', group: 'group' });

    const aliasParsed = parseRawTabularText('days,status,arm\n12,1,A\n18,0,B');
    const aliasSug = suggestColumnMapping(aliasParsed, survivalSchema);
    expect(aliasSug.isExactHeaderMatch).toBe(false);
    expect(aliasSug.needsConfirmation).toBe(false);
    expect(aliasSug.mapping).toEqual({ time: 'days', event: 'status', group: 'arm' });
  });

  it('requests user confirmation when headers are unknown or ambiguous', () => {
    const unknownParsed = parseRawTabularText('alpha,beta,gamma\n12,1,A\n18,0,B');
    const sug = suggestColumnMapping(unknownParsed, survivalSchema);
    expect(sug.needsConfirmation).toBe(true);

    const res = validatePluginDataText('alpha,beta,gamma\n12,1,A\n18,0,B', survivalSchema);
    expect(res.status).toBe('needs_mapping');

    // Once user confirms mapping explicitly, ingestion succeeds
    const confirmed = validatePluginDataText('alpha,beta,gamma\n12,1,A\n18,0,B', survivalSchema, {
      columnMapping: { time: 'alpha', event: 'beta', group: 'gamma' },
    });
    expect(confirmed.status).toBe('ok');
    if (confirmed.status === 'ok') {
      expect(confirmed.payload.data).toEqual([
        { time: 12, event: 1, group: 'A' },
        { time: 18, event: 0, group: 'B' },
      ]);
    }
  });

  it('maps headerless numeric .dat tables positionally for xy-series', () => {
    const datText = '# comment line\n0.0 1.5 0.2\n1.0 3.2 0.8\n2.0 5.1 1.0';
    const res = validatePluginDataText(datText, xySchema, { fileName: 'points.dat' });
    expect(res.status).toBe('ok');
    if (res.status === 'ok') {
      expect(res.payload.data).toEqual([
        { x: 0, y: 1.5, value: 0.2 },
        { x: 1, y: 3.2, value: 0.8 },
        { x: 2, y: 5.1, value: 1 },
      ]);
      const csvOut = serializeTabularRows(res.payload.data as Record<string, number>[], xySchema);
      expect(csvOut.split('\n')[0]).toBe('x,y,value');
    }
  });

  it('returns localized row/column errors instead of throwing and supports skipInvalidRows', () => {
    const badCsv = 'source,target,value\nA,B,10\nB,C,-5\nC,D,abc\nD,E,8';
    const res = validatePluginDataText(badCsv, edgeSchema, { locale: 'zh-CN' });
    expect(res.status).toBe('invalid');
    if (res.status === 'invalid') {
      expect(res.totalErrorCount).toBe(2);
      expect(res.issues[0]?.row).toBe(2);
      expect(res.issues[0]?.field).toBe('value');
      expect(res.issues[0]?.message).toContain('第 2 行');
      expect(res.issues[1]?.row).toBe(3);
      expect(res.issues[1]?.code).toBe('cell.type_number');
    }

    const skipped = validatePluginDataText(badCsv, edgeSchema, {
      locale: 'en-US',
      skipInvalidRows: true,
    });
    expect(skipped.status).toBe('ok');
    if (skipped.status === 'ok') {
      expect(skipped.skippedRows).toBe(2);
      expect((skipped.payload.data as unknown[]).length).toBe(2);
      expect(skipped.issues.every((i) => i.severity === 'warning')).toBe(true);
    }
  });

  it('delivers to loadValidatedData when present and falls back to legacy loadData(file)', async () => {
    const res = validatePluginDataText('x,y\n1,2\n3,4', xySchema);
    expect(res.status).toBe('ok');
    if (res.status !== 'ok') return;

    let validatedReceived: unknown = null;
    const modernPlugin: Plugin = {
      manifest: { id: 'test.modern', name: 'M', version: '1.0.0', author: 'T', description: '', entry: 'test.modern' },
      init() {},
      getParams: () => [],
      loadValidatedData(payload) {
        validatedReceived = payload.data;
      },
    };
    await deliverValidatedPayload(modernPlugin, res.payload);
    expect(validatedReceived).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);

    let legacyText = '';
    const legacyPlugin: Plugin = {
      manifest: { id: 'test.legacy', name: 'L', version: '1.0.0', author: 'T', description: '', entry: 'test.legacy' },
      init() {},
      getParams: () => [],
      async loadData(file) {
        legacyText = await file.text();
      },
    };
    await deliverValidatedPayload(legacyPlugin, res.payload);
    // `value` is an optional column absent from the input. serializeTabularRows
    // omits all-empty optional columns so trailing commas cannot turn a row
    // into a malformed one — the legacy CSV must carry only real columns.
    expect(legacyText.split('\n')[0]).toBe('x,y');
    expect(legacyText).toContain('1,2');
    expect(legacyText).not.toContain('value');
  });
});

describe('Preset Resolution, File Profile Cache & Compatibility Assessment', () => {
  beforeEach(() => clearProfileCache());

  it('resolves preset references with overrides from PluginManifest', () => {
    const manifest: Pick<PluginManifest, 'dataSchema'> = {
      dataSchema: [
        { preset: 'ergalics:tabular/edge-list', overrides: { minRows: 2 } },
        { preset: 'ergalics:json/node-link-graph' },
      ],
    };
    const resolved = resolvePluginDataSchemas(manifest);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]?.kind).toBe('tabular');
    expect((resolved[0] as TabularDataSchema).minRows).toBe(2);
    expect(resolved[1]?.kind).toBe('json');
  });

  it('caches profiles and accurately grades file compatibility', () => {
    const csv = 'source,target,value\nSolar,Grid,45\nWind,Grid,30';
    const p1 = profileDataFileText('flows.csv', csv);
    const p2 = profileDataFileText('flows.csv', csv);
    expect(p1).toBe(p2);
    expect(p1.headers).toEqual(['source', 'target', 'value']);

    const edgeSchema = SHARED_DATA_PRESETS['ergalics:tabular/edge-list'] as TabularDataSchema;
    const survivalSchema = SHARED_DATA_PRESETS['ergalics:tabular/survival-table'] as TabularDataSchema;
    const graphJsonSchema = SHARED_DATA_PRESETS['ergalics:json/node-link-graph'] as JsonDataSchema;

    expect(assessFileCompatibility('flows.csv', csv, edgeSchema).level).toBe('compatible');
    expect(assessFileCompatibility('flows.csv', csv, survivalSchema).level).toBe('incompatible');
    expect(assessFileCompatibility('flows.csv', csv, graphJsonSchema).level).toBe('incompatible');

    const unknownHeadersCsv = 'col_a,col_b,col_c\n12,1,A\n18,0,B';
    expect(assessFileCompatibility('clinical.csv', unknownHeadersCsv, survivalSchema).level).toBe('needs_mapping');
  });
});

describe('CSPkg / Untrusted Manifest Schema Safety Guard', () => {
  it('rejects external $ref, ReDoS nested quantifiers, deep nesting, and prototype pollution keys', () => {
    expect(() => assertSafeJsonSchema({ $ref: 'https://evil.example/schema.json' })).toThrow(/\$ref/);
    expect(() => assertSafeJsonSchema({ type: 'string', pattern: '(a+)+' })).toThrow(/nested quantifier/);
    expect(() =>
      assertSafeJsonSchema({
        type: 'object',
        properties: JSON.parse('{"__proto__": {"type": "string"}}') as Record<string, unknown>,
      }),
    ).toThrow(/forbidden property/);

    // Exceeds MAX_SCHEMA_DEPTH (12)
    let deep: Record<string, unknown> = { type: 'string' };
    for (let i = 0; i < 15; i += 1) deep = { type: 'array', items: deep };
    expect(() => assertSafeJsonSchema(deep)).toThrow(/nesting depth/);

    // Valid preset & inline declarations pass
    expect(() =>
      validateManifestDataSchema([
        { preset: 'ergalics:tabular/xy-series' },
        SHARED_DATA_PRESETS['ergalics:json/node-link-graph'],
      ]),
    ).not.toThrow();
  });
});
