// ==========================================================================
// socio-popforecast — Figure Studio panels
//
// Turns the current Leslie projection into publication-grade PlotSpec
// panels:
//   a. Final-year age distribution (bar series over 80/k-year bands).
//   b. Total population over the projection horizon.
//   c. Share aged 65+ over the projection horizon (UN aging indicator).
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';

export interface PopFigureInput {
  /** Number of age classes (class width = 80 / classes years). */
  classes: number;
  /** Age vectors per year; index 0 = initial state. */
  populations: number[][];
  /** Total population per year. */
  totals: number[];
  /** 65+ share (0-1) per year. */
  share65: number[];
  /** Projection horizon in years. */
  years: number;
}

/** Max points per drawn line — long horizons are strided for the figure. */
const MAX_LINE_POINTS = 1000;

/** Strided (x, y) samples of a series, keeping the exact final point. */
function stridedPoints(values: number[]): Array<{ x: number; y: number }> {
  const stride = Math.max(1, Math.ceil(values.length / MAX_LINE_POINTS));
  const pts: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < values.length; k += stride) pts.push({ x: k, y: values[k] ?? 0 });
  const last = values.length - 1;
  if (last >= 0 && last % stride !== 0) pts.push({ x: last, y: values[last] ?? 0 });
  return pts;
}

/**
 * Build the Figure Studio panel layout for the current projection.
 * Rows are filled row-major; tag letters a, b, c, … label each panel.
 */
export function popForecastFigurePanels(input: PopFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;
  const width = 80 / Math.max(1, input.classes);
  const final = input.populations[input.populations.length - 1] ?? [];

  // --- panel a: final age distribution (bar series over age bands) -----------
  if (final.length > 0) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `Age distribution (year ${input.years})`,
        xLabel: 'age (years)',
        yLabel: 'population',
        grid: true,
        ticks: 5,
        series: [
          {
            name: 'population',
            kind: 'bar',
            color: '#6c8eb0',
            bars: final.map((pop, c) => ({ x0: c * width, x1: (c + 1) * width, y: pop })),
          },
        ],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: total population over time ------------------------------------
  if (input.totals.length >= 2) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Total population',
        xLabel: 'year',
        yLabel: 'population',
        grid: true,
        ticks: 5,
        series: [{ name: 'total', kind: 'line', color: '#769ec4', points: stridedPoints(input.totals) }],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel c: share aged 65+ over time ---------------------------------------
  if (input.share65.length >= 2) {
    const sharePct = input.share65.map((v) => v * 100);
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Share aged 65+',
        xLabel: 'year',
        yLabel: '65+ share (%)',
        grid: true,
        ticks: 5,
        series: [{ name: '65+ share', kind: 'line', color: '#c69e70', points: stridedPoints(sharePct) }],
      } as PlotSpec,
    });
  }

  return panels;
}
