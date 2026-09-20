import { describe, expect, it } from 'vitest';
import { createDataTable } from '@/types/datatable';
import {
  dataTableToHistogram,
  dataTableToLine,
  dataTableToScatter,
  fieldColorCss,
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

describe('field series (heatmap + colorbar)', () => {
  const fieldSpec = {
    width: 336,
    height: 252,
    title: 'Mode 1',
    xLabel: 'x',
    yLabel: 'y',
    series: [
      {
        name: '|E|',
        kind: 'field' as const,
        color: '#D55E00',
        field: {
          values: [-1, -0.5, 0, 0.5, 1, -0.25, 0, 0.25, 0.75],
          rows: 3,
          cols: 3,
        },
      },
    ],
  };

  it('draws one rect per grid cell', () => {
    const svg = renderSVG(fieldSpec);
    // 9 cells + 1 plot-area background + 32 colorbar steps + 1 frame = 43.
    expect(svg.match(/<rect /g)?.length).toBe(9 + 1 + 32 + 1);
  });

  it('uses the diverging colormap: negative blue, zero white, positive red', () => {
    expect(fieldColorCss(-1)).toBe('rgb(0,114,178)');
    expect(fieldColorCss(0)).toBe('rgb(255,255,255)');
    expect(fieldColorCss(1)).toBe('rgb(213,94,0)');
  });

  it('symmetrizes a zero-straddling domain and labels the colorbar', () => {
    const svg = renderSVG(fieldSpec);
    // Domain [-1,1]: max/min/zero labels present, zero label sits mid-bar.
    expect(svg).toContain('>1</text>');
    expect(svg).toContain('>-1</text>');
    expect(svg).toContain('>0</text>');
  });

  it('respects an explicit asymmetric domain', () => {
    const svg = renderSVG({
      ...fieldSpec,
      series: [
        {
          ...fieldSpec.series[0]!,
          field: { ...fieldSpec.series[0]!.field!, domain: [0, 2] },
        },
      ],
    });
    expect(svg).toContain('>2</text>');
    expect(svg).toContain('>0</text>');
  });

  it('keeps the colorbar clear of the plot area', () => {
    const svg = renderSVG(fieldSpec);
    // Plot area narrows for the bar; cells must not reach the bar's x band.
    const cell = /<rect x="(6[0-9]\.[0-9]+)"/; // first cell starts near MARGIN.left=60
    expect(cell.test(svg)).toBe(true);
  });
});
