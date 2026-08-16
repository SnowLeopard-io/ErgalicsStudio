import { describe, it, expect } from 'vitest';
import {
  createDataTable,
  isDataTable,
  isRenderedView,
  isScalar,
} from '@/types/datatable';
import type { Scalar, RenderedView } from '@/types/datatable';

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
