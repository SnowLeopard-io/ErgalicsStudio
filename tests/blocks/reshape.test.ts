// ==========================================================================
// Ergalics Studio — pivot block tests (block system)
// ==========================================================================

import { describe, it, expect } from 'vitest';
import { createDataTable } from '@/types/datatable';
import type { DataTable } from '@/types/datatable';
import type { BlockDefinition } from '@/blocks/catalog/types';
import type { DagExecutionContext } from '@/types/dag';
import { pivotLongerBlock, pivotWiderBlock } from '@/blocks/catalog/transform';

function ctx(input: DataTable, params: Record<string, unknown>): DagExecutionContext {
  return {
    nodeId: 'n',
    getInput: () => input,
    getParam: (k) => params[k],
    markDirty: () => {},
    storage: { save: async () => {}, load: async () => undefined },
    onProgress: () => {},
  };
}

async function run(block: BlockDefinition, input: DataTable, params: Record<string, unknown>) {
  return (await block.executor!(ctx(input, params))) as DataTable;
}

function wideTable(): DataTable {
  return createDataTable('wide', [
    { name: 'id', type: 'i32', data: new Int32Array([1, 2]) },
    { name: 'group', type: 'string', data: ['a', 'b'] },
    { name: 't0', type: 'f64', data: new Float64Array([10, 20]) },
    { name: 't1', type: 'f64', data: new Float64Array([11, 21]) },
  ]);
}

describe('transform blocks — pivoting', () => {
  it('pivot longer stacks the selected measure columns', async () => {
    const out = await run(pivotLongerBlock, wideTable(), {
      idColumns: ['id', 'group'],
      measureColumns: ['t0', 't1'],
      namesTo: 'time',
      valuesTo: 'score',
    });
    expect(out.length).toBe(4);
    expect(out.columnNames()).toEqual(['id', 'group', 'time', 'score']);
    expect(Array.from(out.getColumn('score') as Float64Array)).toEqual([10, 11, 20, 21]);
  });

  it('pivot wider round-trips the long table', async () => {
    const long = await run(pivotLongerBlock, wideTable(), {
      idColumns: ['id', 'group'],
      measureColumns: ['t0', 't1'],
      namesTo: 'time',
      valuesTo: 'score',
    });
    const back = await run(pivotWiderBlock, long, {
      idColumns: ['id', 'group'],
      namesFrom: 'time',
      valuesFrom: 'score',
      namesPrefix: '',
    });
    expect(back.length).toBe(2);
    expect(back.columnNames()).toEqual(['id', 'group', 't0', 't1']);
    expect(Array.from(back.getColumn('t0') as Float64Array)).toEqual([10, 20]);
    expect(Array.from(back.getColumn('t1') as Float64Array)).toEqual([11, 21]);
  });

  it('pivot wider validates its configuration', async () => {
    await expect(
      run(pivotWiderBlock, wideTable(), { idColumns: [], namesFrom: 't0', valuesFrom: 't1' }),
    ).rejects.toThrow();
    await expect(
      run(pivotWiderBlock, wideTable(), { idColumns: ['id'], namesFrom: '', valuesFrom: 't1' }),
    ).rejects.toThrow();
  });
});
