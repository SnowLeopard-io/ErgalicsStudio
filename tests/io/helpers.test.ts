import { describe, it, expect } from 'vitest';
import { asFloat64, sanitizeName, dataTableToCSV, toDataset } from '@/core/io/types';
import { createDataTable } from '@/types/datatable';

describe('io shared helpers', () => {
  it('asFloat64 passes through Float64Array', () => {
    const a = new Float64Array([1, 2, 3]);
    expect(asFloat64(a)).toBe(a);
  });

  it('asFloat64 normalizes other numeric arrays', () => {
    const out = asFloat64(new Uint8Array([1, 2, 3]));
    expect(out).toBeInstanceOf(Float64Array);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it('sanitizeName strips unsafe characters and falls back', () => {
    expect(sanitizeName('/group/data@1')).toBe('group_data_1');
    expect(sanitizeName('  ')).toBe('var');
  });

  it('dataTableToCSV renders header, rows, and blanks NaN', () => {
    const table = createDataTable('t', [
      { name: 'x', type: 'f64', data: new Float64Array([1, 2, NaN]) },
      { name: 'label', type: 'string', data: ['a', 'b', 'c'] },
    ]);
    const csv = dataTableToCSV(table);
    expect(csv).toBe('x,label\n1,a\n2,b\n,c');
  });

  it('toDataset carries dims, axes, attrs and provenance', () => {
    const ds = toDataset(
      { name: 'v', data: new Float64Array([1, 2, 3]), shape: [3], labels: ['x'], unit: 'm', source: 'file.nc' },
      'file.nc',
    );
    expect(ds.kind).toBe('dataset');
    expect(ds.dims).toEqual([3]);
    expect(ds.axes[0]?.name).toBe('x');
    expect(ds.unit).toBe('m');
    expect(ds.attrs).toEqual({});
    expect(ds.provenance).toBe('loaded from file.nc');
  });
});
