// Regression: schema-mapped CSV used to serialize a fully-empty optional
// column as trailing commas (`0.00,101.4,`), which the scatter parser then
// treated as malformed rows — every row was dropped and the chart reported
// "no numeric points" for perfectly valid data.
import { describe, expect, it } from 'vitest';
import { serializeTabularRows } from '@/core/data-schema/column-mapper';
import type { TabularDataSchema, TabularRow } from '@ergalics/plugin-sdk/types';

const schema: TabularDataSchema = {
  kind: 'tabular',
  id: 'primary',
  title: 'XY',
  extensions: ['.csv'],
  allowExtraColumns: true,
  rowSchema: {
    type: 'object',
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      value: { type: 'number' },
    },
    required: ['x', 'y'],
  },
  sampleRows: [],
};

describe('serializeTabularRows', () => {
  it('omits a schema column that is empty in every row', () => {
    const rows: TabularRow[] = [
      { x: 0, y: 101.4, value: '' },
      { x: 0.01, y: 101.1, value: '' },
    ];
    const csv = serializeTabularRows(rows, schema, 'csv');
    expect(csv.split('\n')[0]).toBe('x,y');
    expect(csv.split('\n')[1]).toBe('0,101.4');
    // No trailing commas anywhere.
    expect(csv).not.toMatch(/,\s*$/m);
  });

  it('keeps the optional column when at least one row uses it', () => {
    const rows: TabularRow[] = [
      { x: 0, y: 1, value: 2 },
      { x: 0.01, y: 1.1, value: '' },
    ];
    const csv = serializeTabularRows(rows, schema, 'csv');
    expect(csv.split('\n')[0]).toBe('x,y,value');
  });
});
