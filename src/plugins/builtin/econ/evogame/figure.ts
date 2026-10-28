// ==========================================================================
// econ-evogame — Figure Studio panels
//
// Turns the current spatial-prisoner's-dilemma state into publication-grade
// PlotSpec panels:
//   a. Final strategy lattice as a heatmap field (cooperation = 1).
//   b. Cooperation-fraction evolution f_C(t).
//   c. Mean payoff score per generation.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { Grid } from './kernel';

export interface EvoFigureInput {
  /** Current lattice (row-major 0/1 cells). */
  grid: Grid;
  /** Cooperation fraction per generation, index 0 = initial state. */
  fc: number[];
  /** Mean score per generation, index 0 = initial state. */
  scores: number[];
}

/** Max points per drawn line — long evolutions are strided for the figure. */
const MAX_LINE_POINTS = 1000;

/** Strided (x, y) samples of a series, keeping the exact final point. */
function stridedPoints(values: number[]): Array<{ x: number; y: number }> {
  const stride = Math.max(1, Math.ceil(values.length / MAX_LINE_POINTS));
  const pts: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < values.length; k += stride) pts.push({ x: k, y: values[k]! });
  const last = values.length - 1;
  if (last >= 0 && last % stride !== 0) pts.push({ x: last, y: values[last]! });
  return pts;
}

/**
 * Build the Figure Studio panel layout for the current evolution state.
 * Rows are filled row-major; tag letters a, b, c, … label each panel.
 */
export function evogameFigurePanels(input: EvoFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: final strategy lattice (heatmap field) -----------------------
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Strategy lattice (final)',
      xLabel: 'lattice x',
      yLabel: 'lattice y',
      series: [
        {
          name: 'C = 1 / D = 0',
          kind: 'field',
          color: '#60a8ff',
          field: {
            values: Array.from(input.grid.cells),
            rows: input.grid.h,
            cols: input.grid.w,
            domain: [0, 1],
          },
        },
      ],
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: cooperation fraction f_C(t) ----------------------------------
  if (input.fc.length >= 2) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Cooperation fraction f_C(t)',
        xLabel: 'generation',
        yLabel: 'f_C',
        grid: true,
        ticks: 5,
        yDomain: [0, 1],
        series: [{ name: 'f_C', kind: 'line', color: '#60a8ff', points: stridedPoints(input.fc) }],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel c: mean score per generation ------------------------------------
  if (input.scores.length >= 2) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Mean score per generation',
        xLabel: 'generation',
        yLabel: 'mean score',
        grid: true,
        ticks: 5,
        series: [{ name: 'mean score', kind: 'line', color: '#5dd0a8', points: stridedPoints(input.scores) }],
      } as PlotSpec,
    });
  }

  return panels;
}
