// ==========================================================================
// math-domaincolor — Figure Studio panels
//
// The kernel draws domain coloring straight onto a canvas, so this builder
// re-samples the compiled f(z) on a modest numeric grid (pure, no DOM) and
// turns the samples into publication-grade field panels:
//   a. Re f(z) heatmap (diverging colormap around 0).
//   b. log₂|f(z)| heatmap (poles/zeros appear as ±∞ gaps, skipped pixels).
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { compileComplex, cx } from './kernel';

export interface DomaincolorFigureInput {
  expr: string;
  centerRe: number;
  centerIm: number;
  /** Full view height along the imaginary axis. */
  spanY: number;
}

/** Sample grid of the exported heatmaps (4:3 to match the panel aspect). */
const GRID_COLS = 120;
const GRID_ROWS = 90;

/**
 * Sample f(z) over the current view and build the Re / log₂|f| field panels.
 * Returns an empty array when the expression does not parse (the caller is
 * expected to warn the user in that case).
 */
export function domaincolorFigurePanels(input: DomaincolorFigureInput): FigurePanelSpec[] {
  const compiled = compileComplex(input.expr);
  if (!compiled.ok) return [];
  const f = compiled.fn;
  const spanX = (input.spanY * GRID_COLS) / GRID_ROWS;

  const reValues: number[] = [];
  const logModValues: number[] = [];
  for (let py = 0; py < GRID_ROWS; py += 1) {
    const im = input.centerIm - ((py + 0.5) / GRID_ROWS - 0.5) * input.spanY;
    for (let px = 0; px < GRID_COLS; px += 1) {
      const re = input.centerRe + ((px + 0.5) / GRID_COLS - 0.5) * spanX;
      const v = f(cx(re, im));
      // Non-finite samples (poles / essential blow-up) are pushed as NaN and
      // skipped by the field renderer.
      reValues.push(Number.isFinite(v.re) ? v.re : Number.NaN);
      const mag = Math.hypot(v.re, v.im);
      logModValues.push(mag > 0 && Number.isFinite(mag) ? Math.log2(mag) : Number.NaN);
    }
  }

  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: real part heatmap -------------------------------------------
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Re f(z)',
      xLabel: 'Re z',
      yLabel: 'Im z',
      grid: false,
      series: [
        {
          name: 'Re f',
          kind: 'field',
          color: '#5dd0a8',
          field: { values: reValues, rows: GRID_ROWS, cols: GRID_COLS },
        },
      ],
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: log-modulus heatmap -------------------------------------------
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'log₂ |f(z)|',
      xLabel: 'Re z',
      yLabel: 'Im z',
      grid: false,
      series: [
        {
          name: 'log₂|f|',
          kind: 'field',
          color: '#7ad7ff',
          field: { values: logModValues, rows: GRID_ROWS, cols: GRID_COLS },
        },
      ],
    } as PlotSpec,
  });

  return panels;
}
