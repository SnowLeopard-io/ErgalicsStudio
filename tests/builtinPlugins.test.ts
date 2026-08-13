// Built-in plugin logic tests — Contour grid normalization & Scatter parsing
import { describe, it, expect } from 'vitest';
import { normalizeGrid } from '@/plugins/builtin/contour';
import { parseScatter } from '@/plugins/builtin/scatter';

describe('contour normalizeGrid', () => {
  it('accepts a bare numeric grid', () => {
    const grid = normalizeGrid([
      [0, 1, 2],
      [3, 4, 5],
    ]);
    expect(grid).toHaveLength(2);
    expect(grid[0]).toEqual([0, 1, 2]);
  });

  it('accepts { values: grid } wrappers', () => {
    expect(normalizeGrid({ values: [[1.5, 2.5]] })).toEqual([[1.5, 2.5]]);
    expect(normalizeGrid({ data: { values: [[7]] } })).toEqual([[7]]);
  });

  it('rejects non-arrays and ragged/NaN input', () => {
    expect(normalizeGrid(null)).toEqual([]);
    expect(normalizeGrid(42)).toEqual([]);
    expect(normalizeGrid([[1, 'x']])).toEqual([]);
    expect(normalizeGrid([[1], [2, 3]])).toEqual([]);
  });

  it('clamps oversized grids', () => {
    const big = Array.from({ length: 500 }, () => Array.from({ length: 500 }, () => 1));
    const grid = normalizeGrid(big);
    expect(grid).toHaveLength(320);
    expect(grid[0]).toHaveLength(320);
  });
});

describe('scatter parseScatter', () => {
  it('parses space/comma separated x y [c]', () => {
    const rows = parseScatter('1 2 0.5\n3,4\n5 6 0.9\n');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ x: 1, y: 2, c: 0.5 });
    expect(rows[1]).toEqual({ x: 3, y: 4, c: undefined });
  });

  it('skips header lines and non-numeric rows', () => {
    const rows = parseScatter('x y value\n1 2 3\nnot a number\n4 5\n');
    expect(rows).toHaveLength(2);
  });

  it('handles scientific notation and negatives', () => {
    const rows = parseScatter('-1.5e2 2.5e-1 1\n');
    expect(rows[0]?.x).toBeCloseTo(-150);
    expect(rows[0]?.y).toBeCloseTo(0.25);
  });
});
