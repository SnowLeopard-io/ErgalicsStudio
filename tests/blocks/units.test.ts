// ==========================================================================
// Ergalics Studio — units block tests (block system)
//
// Each block's executor is invoked with a mock context (same pattern as the
// statistics block tests) and outputs are checked against known factors.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { createDataTable } from '@/types/datatable';
import type { ColumnSpec, DataTable } from '@/types/datatable';
import type { BlockDefinition } from '@/blocks/catalog/types';
import type { DagExecutionContext } from '@/types/dag';
import { unitConvertBlock, unitCheckBlock } from '@/blocks/catalog/units';
import { registerBuiltinBlocks } from '@/blocks/catalog';
import { createBlockRegistry } from '@/blocks/registry';

function tbl(columns: ColumnSpec[]): DataTable {
  return createDataTable('in', columns, { provenance: 'test' });
}

function ctx(input: DataTable | undefined, params: Record<string, unknown>): DagExecutionContext {
  return {
    nodeId: 'n',
    getInput: () => input,
    getParam: (k) => params[k],
    markDirty: () => {},
    storage: { save: async () => {}, load: async () => undefined },
    onProgress: () => {},
  };
}

async function run(
  block: BlockDefinition,
  input: DataTable | undefined,
  params: Record<string, unknown>,
): Promise<DataTable> {
  const out = await block.executor!(ctx(input, params));
  expect(out).toBeDefined();
  return out as DataTable;
}

function metricOf(out: DataTable, metric: string): number {
  const m = out.getColumn('metric') as string[];
  const v = out.getColumn('value') as Float64Array;
  const i = m.indexOf(metric);
  expect(i).toBeGreaterThanOrEqual(0);
  return v[i]!;
}

describe('units.convert block', () => {
  const speed = tbl([
    { name: 'site', type: 'string', data: ['a', 'b'] },
    { name: 'speed', type: 'f64', data: new Float64Array([1, 3.6]) },
  ]);

  it('converts m/s → km/h with factor 3.6 and annotates the new column', async () => {
    const out = await run(unitConvertBlock, speed, { column: 'speed', from: 'm/s', to: 'km/h' });
    const col = out.getColumn('speed_km_per_h') as Float64Array;
    expect(col[0]).toBeCloseTo(3.6, 10);
    expect(col[1]).toBeCloseTo(12.96, 10);
    const meta = out.columns.find((c) => c.name === 'speed_km_per_h');
    expect(meta?.unit).toBe('km/h');
    // original column untouched
    const orig = out.getColumn('speed') as Float64Array;
    expect(orig[0]).toBe(1);
  });

  it('prefix handling works end to end (MPa → Pa)', async () => {
    const pressure = tbl([{ name: 'p', type: 'f64', data: new Float64Array([0.101325]) }]);
    const out = await run(unitConvertBlock, pressure, { column: 'p', from: 'MPa', to: 'atm' });
    const col = out.getColumn('p_atm') as Float64Array;
    expect(col[0]).toBeCloseTo(1, 6);
  });

  it('rejects dimension mismatches', async () => {
    await expect(
      run(unitConvertBlock, speed, { column: 'speed', from: 'm/s', to: 'kg' }),
    ).rejects.toThrow(/incompatible/);
  });

  it('rejects missing configuration', async () => {
    await expect(run(unitConvertBlock, speed, { column: 'speed', from: '', to: 'km/h' })).rejects.toThrow(
      /source unit/,
    );
    await expect(run(unitConvertBlock, speed, { column: 'speed', from: 'm/s', to: '' })).rejects.toThrow(
      /target unit/,
    );
  });
});

describe('units.check block', () => {
  it('reports compatible units with the SI ratio', async () => {
    const out = await run(unitCheckBlock, undefined, { unitA: 'km', unitB: 'cm' });
    expect(metricOf(out, 'compatible')).toBe(1);
    expect(metricOf(out, 'si_factor_a')).toBe(1000);
    expect(metricOf(out, 'si_factor_b')).toBeCloseTo(0.01, 10);
    expect(metricOf(out, 'si_ratio')).toBeCloseTo(1e5, 6);
  });

  it('reports incompatible units as 0', async () => {
    const out = await run(unitCheckBlock, undefined, { unitA: 'm', unitB: 's' });
    expect(metricOf(out, 'compatible')).toBe(0);
  });

  it('rejects missing unit params', async () => {
    await expect(run(unitCheckBlock, undefined, { unitA: '', unitB: 's' })).rejects.toThrow(
      /two units/,
    );
  });
});

describe('units blocks registration', () => {
  it('registers both blocks into the builtin registry', () => {
    const r = createBlockRegistry();
    registerBuiltinBlocks(r);
    expect(r.get('units.convert')).toBeDefined();
    expect(r.get('units.check')).toBeDefined();
    expect(r.getExecutor('units.convert')).toBeDefined();
    expect(r.getExecutor('units.check')).toBeDefined();
  });
});
