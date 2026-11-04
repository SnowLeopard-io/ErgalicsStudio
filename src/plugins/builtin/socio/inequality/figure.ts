// ==========================================================================
// socio-inequality — Figure Studio panels
//
// Turns the current inequality state into publication-grade PlotSpec panels:
//   a. Lorenz curve with the equality diagonal.
//   b. Income histogram on a log10 income axis.
//   c. Intergenerational rank scatter (parent rank vs child rank).
// Only kinds supported by the core plot engine are used (line / scatter /
// histogram); log bins are encoded as log10(income) so the histogram stays
// on a linear axis.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { LorenzPoint, MobilityPair } from './kernel';

export interface InequalityFigureInput {
  /** Lorenz curve of the (pre-tax) sample, including (0,0) and (1,1). */
  lorenz: LorenzPoint[];
  /** Post-tax Lorenz curve when a tax regime is active, else null. */
  lorenzPostTax: LorenzPoint[] | null;
  /** incomes for the histogram (pre-tax sample). */
  incomes: number[];
  /** Parent-child rank pairs from the mobility simulation, else null. */
  mobilityPairs: MobilityPair[] | null;
}

/** Low-saturation academic palette. */
const LORENZ_COLOR = '#60a8ff';
const POST_TAX_COLOR = '#5dd0a8';
const EQUALITY_COLOR = '#9aa5b5';
const SCATTER_COLOR = '#b89ae0';

/** Number of log bins for the income histogram. */
const HISTO_BINS = 24;

/**
 * Log10-spaced histogram bars of the positive incomes (shared by the canvas
 * workbench and the Figure Studio panels so both show identical binning).
 */
export function incomeHistogramBars(incomes: number[]): Array<{ x0: number; x1: number; y: number }> {
  const positive = incomes.filter((v) => v > 0);
  if (positive.length < 2) return [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of positive) {
    const l = Math.log10(v);
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  if (!(hi > lo)) {
    lo -= 0.5;
    hi += 0.5;
  }
  const w = (hi - lo) / HISTO_BINS;
  const counts = new Array<number>(HISTO_BINS).fill(0);
  for (const v of positive) {
    const k = Math.min(HISTO_BINS - 1, Math.max(0, Math.floor((Math.log10(v) - lo) / w)));
    counts[k]! += 1;
  }
  return counts.map((c, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, y: c }));
}

/**
 * Build the Figure Studio panel layout for the current inequality state.
 * Rows are filled row-major; tag letters a, b, c, … label each panel.
 */
export function inequalityFigurePanels(input: InequalityFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: Lorenz curve with the equality diagonal ----------------------
  if (input.lorenz.length >= 2) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Lorenz curve',
        xLabel: 'cumulative population share',
        yLabel: 'cumulative income share',
        grid: true,
        ticks: 5,
        xDomain: [0, 1],
        yDomain: [0, 1],
        legend: true,
        series: [
          { name: 'equality', kind: 'line', color: EQUALITY_COLOR, dash: [4, 3], points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
          { name: input.lorenzPostTax ? 'pre-tax Lorenz' : 'Lorenz curve', kind: 'line', color: LORENZ_COLOR, points: input.lorenz.map((p) => ({ x: p.p, y: p.l })) },
          ...(input.lorenzPostTax
            ? [{ name: 'post-tax Lorenz', kind: 'line', color: POST_TAX_COLOR, points: input.lorenzPostTax.map((p) => ({ x: p.p, y: p.l })) }]
            : []),
        ],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: income histogram on a log10 axis ------------------------------
  const bars = incomeHistogramBars(input.incomes);
  if (bars.length > 0) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Income distribution (log bins)',
        xLabel: 'log10(income)',
        yLabel: 'count',
        grid: true,
        ticks: 5,
        series: [{ name: 'frequency', kind: 'histogram', color: LORENZ_COLOR, bars }],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel c: intergenerational rank scatter ---------------------------------
  if (input.mobilityPairs && input.mobilityPairs.length >= 2) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Intergenerational rank mobility',
        xLabel: 'parent percentile rank',
        yLabel: 'child percentile rank',
        grid: true,
        ticks: 5,
        xDomain: [0, 1],
        yDomain: [0, 1],
        series: [
          { name: 'equality', kind: 'line', color: EQUALITY_COLOR, dash: [4, 3], points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
          { name: 'parent-child pairs', kind: 'scatter', color: SCATTER_COLOR, points: input.mobilityPairs.map((p) => ({ x: p.parentRank, y: p.childRank })) },
        ],
      } as PlotSpec,
    });
  }

  return panels;
}
