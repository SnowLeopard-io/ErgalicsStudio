// Unit tests for the new data plugins' pure parsing helpers:
// error-band rows, treemap hierarchy, QQ numeric column + probit.
import { describe, it, expect } from 'vitest';
import { parseBandData } from '@/plugins/builtin/errorband';
import { parseTreemapData } from '@/plugins/builtin/treemap';
import { parseNumericColumn, probit } from '@/plugins/builtin/qqplot';

describe('parseBandData', () => {
  it('parses symmetric x,y,err rows', () => {
    const rows = parseBandData('x,y,err\n0,1,0.2\n1,2,0.3\n');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ x: 0, y: 1, lo: 0.8, hi: 1.2 });
    expect(rows[1]).toEqual({ x: 1, y: 2, lo: 1.7, hi: 2.3 });
  });

  it('parses explicit x,y,ymin,ymax rows', () => {
    const rows = parseBandData('x,y,lo,hi\n5,10,8,12\n');
    expect(rows[0]).toEqual({ x: 5, y: 10, lo: 8, hi: 12 });
  });

  it('sorts by x and skips malformed lines', () => {
    const rows = parseBandData('3,30,1\n2,20,1\ngarbage\n1,10,1\n');
    expect(rows.map((r) => r.x)).toEqual([1, 2, 3]);
  });

  it('accepts whitespace-separated data', () => {
    const rows = parseBandData('0 1 0.1\n1 2 0.2\n');
    expect(rows).toHaveLength(2);
  });

  it('returns [] for empty input', () => {
    expect(parseBandData('')).toEqual([]);
  });
});

describe('parseTreemapData', () => {
  it('builds a flat hierarchy from label,size', () => {
    const root = parseTreemapData('label,size\na,10\nb,20\n');
    expect(root).not.toBeNull();
    expect(root!.children).toHaveLength(2);
    expect(root!.children[0]!.name).toBe('a');
    expect(root!.children[0]!.size).toBe(10);
  });

  it('builds nested hierarchy from label,parent,size', () => {
    const root = parseTreemapData('label,parent,size\nsrc,,\ncore,src,120\nplugins,src,180\n');
    expect(root).not.toBeNull();
    expect(root!.children).toHaveLength(1);
    const src = root!.children[0]!;
    expect(src.name).toBe('src');
    expect(src.children).toHaveLength(2);
    expect(src.children[0]!.depth).toBe(2);
    expect(src.children[0]!.name).toBe('core');
  });

  it('accumulates repeated labels', () => {
    const root = parseTreemapData('label,size\na,10\na,5\n');
    expect(root!.children[0]!.size).toBe(15);
  });

  it('returns null when there is no data', () => {
    expect(parseTreemapData('label,size\n')).toBeNull();
  });
});

describe('parseNumericColumn', () => {
  it('reads single-column data with header tolerance', () => {
    const vals = parseNumericColumn('value\n1\n2\n3\n');
    expect(vals).toEqual([1, 2, 3]);
  });

  it('reads whitespace and comma separated values', () => {
    expect(parseNumericColumn('1 2\n3,4\n')).toEqual([1, 2, 3, 4]);
  });
});

describe('probit', () => {
  it('is approximately inverse-normal around key quantiles', () => {
    expect(probit(0.5)).toBeCloseTo(0, 2);
    expect(probit(0.841344746)).toBeCloseTo(1, 2);
    expect(probit(0.158655254)).toBeCloseTo(-1, 2);
    expect(probit(0.977249868)).toBeCloseTo(2, 2);
  });

  it('handles extreme tails without NaN', () => {
    expect(Number.isFinite(probit(1e-6))).toBe(true);
    expect(Number.isFinite(probit(1 - 1e-6))).toBe(true);
    expect(probit(1e-6)).toBeLessThan(probit(0.5));
  });
});
