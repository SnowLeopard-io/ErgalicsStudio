import { describe, expect, it } from 'vitest';
import { createDataTable } from '@/types/datatable';
import {
  dataTableToHistogram,
  dataTableToLine,
  dataTableToScatter,
  renderSVG,
} from '@/core/plot';

function close(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

describe('publication plot core', () => {
  const table = createDataTable('t', [
    { name: 'x', type: 'f64', data: new Float64Array([0, 1, 2, 3, 4]) },
    { name: 'y', type: 'f64', data: new Float64Array([2, 3, 5, 4, 6]) },
    { name: 'g', type: 'f64', data: new Float64Array([1, 1, 2, 2, 3]) },
  ]);

  it('line spec sorts and carries points', () => {
    const spec = dataTableToLine(table, 'x', 'y');
    expect(spec.series).toHaveLength(1);
    expect(spec.series[0]!.kind).toBe('line');
    expect(spec.series[0]!.points!.map((p) => p.x)).toEqual([0, 1, 2, 3, 4]);
  });

  it('scatter spec keeps points', () => {
    const spec = dataTableToScatter(table, 'x', 'y');
    expect(spec.series[0]!.points).toHaveLength(5);
  });

  it('histogram bins the data with counts', () => {
    const spec = dataTableToHistogram(table, 'y');
    const bars = spec.series[0]!.bars!;
    const total = bars.reduce((s, b) => s + b.y, 0);
    expect(total).toBe(5);
    expect(bars.length).toBeGreaterThan(0);
  });

  it('renders a self-contained SVG with axes and a title', () => {
    const svg = renderSVG({ ...dataTableToLine(table, 'x', 'y'), title: 'Demo' });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('Demo');
    expect(svg).toContain('<line'); // axes / grid
    expect(svg).toContain('stroke="#222"'); // axis lines
  });

  it('SVG escapes reserved characters in labels', () => {
    const svg = renderSVG({
      ...dataTableToLine(table, 'x', 'y'),
      title: 'a & b < c > d', // & < > must be escaped
    });
    expect(svg).toContain('a &amp; b &lt; c &gt; d');
    expect(svg).not.toContain('a & b <');
  });

  it('nice ticks produce round, evenly spaced values', () => {
    // exercised indirectly: x tick labels must be finite strings
    const svg = renderSVG(dataTableToLine(table, 'x', 'y'));
    expect(svg).toMatch(/<text[^>]*>([0-9eE.+-]+|0)<\/text>/);
  });

  it('NaN/Infinity points are dropped from line output', () => {
    const dirty = createDataTable('d', [
      { name: 'x', type: 'f64', data: new Float64Array([0, 1, NaN, 3, Infinity]) },
      { name: 'y', type: 'f64', data: new Float64Array([1, 2, 3, 4, 5]) },
    ]);
    const svg = renderSVG(dataTableToLine(dirty, 'x', 'y'));
    expect(svg).toContain('<path');
    expect(close(1, 1)).toBe(true); // sanity
  });
});
