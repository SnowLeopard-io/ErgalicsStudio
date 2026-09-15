// ==========================================================================
// Ergalics Studio — figure composition tests (core)
//
// Panel placement/tags, journal template application (cell sizes, double
// column split), caption rendering/escaping, and export helpers.
// ==========================================================================

import { describe, it, expect } from 'vitest';
import {
  composeFigure,
  templateById,
  JOURNAL_TEMPLATES,
  pxToMm,
} from '@/core/figure/compose';
import type { FigureSpec } from '@/core/figure/compose';
import { computeRasterSize, exportPNG } from '@/core/plot/export';
import type { PlotSpec } from '@/core/plot';

function lineSpec(title?: string): PlotSpec {
  return {
    width: 640,
    height: 420,
    title,
    series: [
      {
        name: 'y',
        kind: 'line',
        color: '#0072B2',
        points: [
          { x: 0, y: 1 },
          { x: 1, y: 3 },
        ],
      },
    ],
  };
}

function specOf(overrides: Partial<FigureSpec>): FigureSpec {
  return {
    panels: [{ row: 0, col: 0, spec: lineSpec() }],
    templateId: 'ieee_single',
    ...overrides,
  };
}

describe('composeFigure — placement & tags', () => {
  it('assigns tags a, b, c in row-major compose order', () => {
    const fs = specOf({
      panels: [
        { row: 0, col: 1, spec: lineSpec() },
        { row: 0, col: 0, spec: lineSpec() },
        { row: 1, col: 0, spec: lineSpec() },
      ],
    });
    const fig = composeFigure(fs);
    expect(fig.placed.map((p) => p.tag)).toEqual(['a', 'b', 'c']);
    // Sorted row-major: (0,0) → x=0; (0,1) → shifted right by one cell + gap.
    const a = fig.placed[0]!;
    const b = fig.placed[1]!;
    expect(a.x).toBeLessThan(b.x);
    expect(a.y).toBe(b.y);
    expect(fig.placed[2]!.y).toBeGreaterThan(a.y);
  });

  it('honours explicit tags', () => {
    const fig = composeFigure(
      specOf({ panels: [{ row: 0, col: 0, tag: 'A1', spec: lineSpec() }] }),
    );
    expect(fig.placed[0]!.tag).toBe('A1');
  });

  it('marks grid tags a..z then falls back to AA-style after 26 panels', () => {
    const panels = Array.from({ length: 27 }, (_, i) => ({
      row: Math.floor(i / 2),
      col: i % 2,
      spec: lineSpec(),
    }));
    const fig = composeFigure(specOf({ panels }));
    expect(fig.placed[25]!.tag).toBe('z');
    expect(fig.placed[26]!.tag).toBe('aa');
  });
});

describe('composeFigure — template application', () => {
  it('renders panels at the template single-column cell size', () => {
    const tpl = templateById('ieee_single');
    const fig = composeFigure(specOf({}));
    expect(fig.width).toBe(tpl.panelWidth);
    expect(fig.height).toBe(tpl.panelHeight);
    // Nested panel viewport is re-sized to the cell.
    expect(fig.markup).toMatch(new RegExp(`<svg x="0" y="0"[^>]*width="${tpl.panelWidth}"`));
  });

  it('splits the double-column width across two cells', () => {
    const tpl = templateById('ieee_double');
    const fig = composeFigure(
      specOf({
        templateId: 'ieee_double',
        panels: [
          { row: 0, col: 0, spec: lineSpec() },
          { row: 0, col: 1, spec: lineSpec() },
        ],
      }),
    );
    const cellW = Math.round((tpl.columnWidthMm / 2) * (96 / 25.4));
    expect(fig.width).toBe(2 * cellW + tpl.gap);
    // The whole figure spans one physical double-column width (± the gap).
    expect(pxToMm(fig.width)).toBeGreaterThan(tpl.columnWidthMm);
    expect(pxToMm(fig.width)).toBeLessThan(tpl.columnWidthMm + 5);
  });

  it('2-column single template spans cols × column width', () => {
    const tpl = templateById('elsevier_single');
    const fig = composeFigure(
      specOf({
        templateId: 'elsevier_single',
        panels: [
          { row: 0, col: 0, spec: lineSpec() },
          { row: 0, col: 1, spec: lineSpec() },
        ],
      }),
    );
    expect(fig.width).toBe(2 * tpl.panelWidth + tpl.gap);
    expect(pxToMm(fig.width)).toBeGreaterThan(2 * tpl.columnWidthMm - 5);
    expect(pxToMm(fig.width)).toBeLessThan(2 * tpl.columnWidthMm + 5);
  });
});

describe('composeFigure — caption & markup hygiene', () => {
  it('renders each caption line as its own text element', () => {
    const fig = composeFigure(
      specOf({ caption: 'Figure 1. Growth curve.\nShaded band = 95% CI.' }),
    );
    expect(fig.height).toBeGreaterThan(templateById('ieee_single').panelHeight);
    expect(fig.markup).toContain('Figure 1. Growth curve.');
    expect(fig.markup).toContain('Shaded band = 95% CI.');
  });

  it('escapes XML-sensitive characters in captions', () => {
    const fig = composeFigure(specOf({ caption: 'a < b & c > "d"' }));
    expect(fig.markup).toContain('a &lt; b &amp; c &gt; &quot;d&quot;');
    expect(fig.markup).not.toContain('a < b');
  });

  it('produces a standalone svg root with a white background', () => {
    const fig = composeFigure(specOf({}));
    expect(fig.markup.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(fig.markup).toContain('fill="#ffffff"');
  });

  it('handles an empty sheet (no panels) without crashing', () => {
    const fig = composeFigure(specOf({ panels: [] }));
    expect(fig.placed).toEqual([]);
    expect(fig.width).toBeGreaterThan(0);
    expect(fig.height).toBeGreaterThan(0);
  });
});

describe('export helpers', () => {
  it('computeRasterSize scales svg dimensions for 600dpi print', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="340" height="272"></svg>';
    expect(computeRasterSize(svg, 600 / 96)).toEqual({ width: 2125, height: 1700 });
    // Defaults when the root has no explicit size.
    expect(computeRasterSize('<svg></svg>', 1)).toEqual({ width: 640, height: 420 });
  });

  it('exportPNG is browser-only', () => {
    expect(() => exportPNG('<svg></svg>', 'x.png')).toThrow(/browser/i);
  });

  it('every journal template is self-consistent', () => {
    expect(JOURNAL_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    for (const tpl of JOURNAL_TEMPLATES) {
      expect(tpl.panelWidth).toBeGreaterThan(0);
      expect(tpl.panelHeight).toBeGreaterThan(0);
      expect(tpl.palette.length).toBeGreaterThanOrEqual(4);
      expect(templateById(tpl.id)).toBe(tpl);
    }
    // Unknown ids fall back to the first template instead of crashing.
    expect(templateById('nope')).toBe(JOURNAL_TEMPLATES[0]);
  });
});
