// DataTable operation helpers: numeric kernels must degrade gracefully when a
// column is empty or all-NaN instead of emitting NaN/Infinity garbage.
import { describe, it, expect } from 'vitest';
import { createDataTable } from '@/types/datatable';
import { histogram, normalize, uniqueName } from '@/blocks/ops';

const NAN_COL = new Float64Array([NaN, NaN, NaN]);

describe('normalize', () => {
  it('z-scores a constant column to zeros', () => {
    const out = normalize(new Float64Array([5, 5, 5]), 'zscore');
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });

  it('z-scores an all-NaN column to zeros instead of NaN', () => {
    const out = normalize(NAN_COL, 'zscore');
    expect(Array.from(out)).toEqual([0, 0, 0]);
    expect(out.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('minmax on an all-NaN column to zeros instead of NaN', () => {
    const out = normalize(NAN_COL, 'minmax');
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });
});

describe('histogram', () => {
  it('produces zeroed bins for an all-NaN column', () => {
    const { centers, counts } = histogram(NAN_COL, 4);
    expect(Array.from(centers)).toEqual([0, 0, 0, 0]);
    expect(Array.from(counts)).toEqual([0, 0, 0, 0]);
  });

  it('counts sum to the input length for finite values', () => {
    const { counts } = histogram(new Float64Array([1, 2, 3, 4, 5]), 3);
    expect(Array.from(counts).reduce((a, b) => a + b, 0)).toBe(5);
  });
});

describe('uniqueName', () => {
  it('returns the base name when free', () => {
    const table = createDataTable('t', [{ name: 'x', type: 'f64', data: new Float64Array([1]) }]);
    expect(uniqueName(table, 'y')).toBe('y');
  });

  it('suffixes _2, _3, … on collisions', () => {
    const table = createDataTable('t', [
      { name: 'x', type: 'f64', data: new Float64Array([1]) },
      { name: 'x_2', type: 'f64', data: new Float64Array([2]) },
    ]);
    expect(uniqueName(table, 'x')).toBe('x_3');
  });
});