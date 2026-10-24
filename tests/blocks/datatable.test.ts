import { describe, it, expect } from 'vitest';
import {
  createDataTable,
  isDataTable,
  isDataset,
  isRenderedView,
  isScalar,
  datasetToTable,
} from '@/types/datatable';
import type { Dataset, Scalar, RenderedView } from '@/types/datatable';

describe('MemoryDataTable', () => {
  it('stores columnar data and reads columns/rows', () => {
    const t = createDataTable('t', [
      { name: 'x', type: 'f64', data: new Float64Array([1, 2, 3]) },
      { name: 'label', type: 'string', data: ['a', 'b', 'c'] },
    ]);
    expect(t.length).toBe(3);
    expect(t.columnNames()).toEqual(['x', 'label']);
    const x = t.getColumn('x');
    expect(x).toBeDefined();
    expect(Array.from(x as Float64Array)).toEqual([1, 2, 3]);
    expect(t.getRow(1)).toEqual({ x: 2, label: 'b' });
  });

  it('rejects mismatched column lengths', () => {
    expect(() =>
      createDataTable('t', [
        { name: 'x', type: 'f64', data: new Float64Array([1, 2, 3]) },
        { name: 'y', type: 'f64', data: new Float64Array([1, 2]) },
      ]),
    ).toThrow(/length/);
  });

  it('rejects duplicate column names', () => {
    expect(() =>
      createDataTable('t', [
        { name: 'x', type: 'f64', data: new Float64Array([1]) },
        { name: 'x', type: 'f64', data: new Float64Array([2]) },
      ]),
    ).toThrow(/duplicate/);
  });

  it('rejects an empty table', () => {
    expect(() => createDataTable('t', [])).toThrow(/at least one/);
  });

  it('returns undefined for unknown columns', () => {
    const t = createDataTable('t', [{ name: 'x', type: 'f64', data: new Float64Array([1]) }]);
    expect(t.getColumn('nope')).toBeUndefined();
  });
});

describe('type guards', () => {
  it('narrows tables vs. scalars vs. rendered views', () => {
    const table = createDataTable('t', [{ name: 'x', type: 'f64', data: new Float64Array([1]) }]);
    const scalar: Scalar = { kind: 'scalar', value: 1 };
    const view: RenderedView = { kind: 'rendered-view', id: 'v', viewType: 'scatter' };

    expect(isDataTable(table)).toBe(true);
    expect(isDataTable(scalar)).toBe(false);
    expect(isDataTable(view)).toBe(false);

    expect(isScalar(scalar)).toBe(true);
    expect(isScalar(table)).toBe(false);

    expect(isRenderedView(view)).toBe(true);
    expect(isRenderedView(table)).toBe(false);
  });
});

describe('Dataset', () => {
  const makeDs = (over: Partial<Dataset> = {}): Dataset => ({
    kind: 'dataset',
    id: 'ds',
    name: 'sample',
    dims: [3],
    data: new Float64Array([10, 20, 30]),
    axes: [{ name: 'x' }],
    attrs: {},
    provenance: 'test',
    ...over,
  });

  it('isDataset narrows a dataset away from tables/scalars/views', () => {
    const ds = makeDs();
    const table = createDataTable('t', [{ name: 'x', type: 'f64', data: new Float64Array([1]) }]);
    expect(isDataset(ds)).toBe(true);
    expect(isDataset(table)).toBe(false);
    expect(isDataset({ kind: 'scalar', value: 1 })).toBe(false);
  });

  it('flattens a 1-D dataset into a single column', () => {
    const t = datasetToTable(makeDs());
    expect(t.columnNames()).toEqual(['x']);
    expect(t.length).toBe(3);
    expect(Array.from(t.getColumn('x') as Float64Array)).toEqual([10, 20, 30]);
  });

  it('flattens a 2-D [M,N] dataset into N columns of length M', () => {
    // row-major buffer: row0 = [1,2,3], row1 = [4,5,6]  →  cols = [1,4],[2,5],[3,6]
    const ds = makeDs({
      dims: [2, 3],
      data: new Float64Array([1, 2, 3, 4, 5, 6]),
      axes: [{ name: 'row' }, { name: 'feat' }],
    });
    const t = datasetToTable(ds);
    expect(t.columnNames()).toEqual(['feat_0', 'feat_1', 'feat_2']);
    expect(t.length).toBe(2);
    expect(Array.from(t.getColumn('feat_0') as Float64Array)).toEqual([1, 4]);
    expect(Array.from(t.getColumn('feat_2') as Float64Array)).toEqual([3, 6]);
  });

  it('names columns from the second axis coordinates when present', () => {
    const ds = makeDs({
      dims: [2, 2],
      data: new Float64Array([1, 2, 3, 4]),
      axes: [{ name: 'time' }, { name: 'lat', values: new Float64Array([12.5, 30.0]) }],
    });
    const t = datasetToTable(ds);
    expect(t.columnNames()).toEqual(['12.5', '30']);
  });

  it('propagates the dataset unit onto flattened columns', () => {
    const t = datasetToTable(makeDs({ unit: 'kg' }));
    expect(t.columns[0]!.unit).toBe('kg');
  });

  it('refuses to flatten rank > 2 datasets', () => {
    const ds = makeDs({ dims: [2, 2, 2], data: new Float64Array(8) });
    expect(() => datasetToTable(ds)).toThrow(/[Dd]ataset/);
  });

  it('refuses to flatten non-numeric datasets', () => {
    const ds = makeDs({ dims: [1, 3], data: ['a', 'b', 'c'] as unknown as Float64Array });
    expect(() => datasetToTable(ds)).toThrow(/numeric/);
  });
});
