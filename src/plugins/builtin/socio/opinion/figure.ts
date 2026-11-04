// ==========================================================================
// socio-opinion — Figure Studio panels
//
// Turns the current opinion-diffusion state into publication-grade PlotSpec
// panels:
//   a. Adoption curve (adopted / corrected fraction per cascade step).
//   b. Final opinion distribution as a bar histogram.
//   c. Echo-chamber homophily index over time.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';

export interface OpinionFigureInput {
  /** Adopted fraction per step, index 0 = initial state. */
  adopted: number[];
  /** Corrected fraction per step (competing cascades; zeros otherwise). */
  corrected: number[];
  /** Mean opinion per step. */
  meanOpinion: number[];
  /** Homophily index per step. */
  homophily: number[];
  /** Final per-node opinions for the distribution panel. */
  opinions: number[];
  /** True when the competing-cascades mode is active. */
  competing: boolean;
}

/** Max points per drawn line — long runs are strided for the figure. */
const MAX_LINE_POINTS = 1000;

/** Low-saturation academic palette. */
const ADOPT_COLOR = '#c07a72';
const CORRECT_COLOR = '#5fae97';
const OPINION_COLOR = '#7d8fc9';
const HOMOPHILY_COLOR = '#a98d66';
const BAR_COLOR = '#8a93a8';

/** Strided (x, y) samples of a series, keeping the exact final point. */
function stridedPoints(values: number[]): Array<{ x: number; y: number }> {
  const stride = Math.max(1, Math.ceil(values.length / MAX_LINE_POINTS));
  const pts: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < values.length; k += stride) pts.push({ x: k, y: values[k]! });
  const last = values.length - 1;
  if (last >= 0 && last % stride !== 0) pts.push({ x: last, y: values[last]! });
  return pts;
}

/** Histogram bins (10 equal intervals over [0, 1]) of the final opinions. */
function opinionBars(opinions: number[], bins = 10): Array<{ x0: number; x1: number; y: number }> {
  const counts = new Array<number>(bins).fill(0);
  for (const v of opinions) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor(v * bins)));
    counts[b]! += 1;
  }
  const n = Math.max(1, opinions.length);
  return counts.map((c, i) => ({ x0: i / bins, x1: (i + 1) / bins, y: c / n }));
}

/**
 * Build the Figure Studio panel layout for the current diffusion state.
 * Rows are filled row-major; tag letters a, b, c label each panel.
 */
export function opinionFigurePanels(input: OpinionFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: adoption curve -------------------------------------------------
  if (input.adopted.length >= 2) {
    const series: Array<{ name: string; kind: 'line'; color: string; points: Array<{ x: number; y: number }>; dash?: number[] }> = [
      { name: 'adopted', kind: 'line', color: ADOPT_COLOR, points: stridedPoints(input.adopted) },
    ];
    if (input.competing && input.corrected.length >= 2) {
      series.push({ name: 'corrected', kind: 'line', color: CORRECT_COLOR, points: stridedPoints(input.corrected) });
    }
    if (input.meanOpinion.length >= 2) {
      series.push({ name: 'mean opinion', kind: 'line', color: OPINION_COLOR, points: stridedPoints(input.meanOpinion), dash: [4, 2] });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Adoption curve',
        xLabel: 'cascade step',
        yLabel: 'fraction',
        grid: true,
        ticks: 5,
        yDomain: [0, 1],
        legend: true,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: final opinion distribution (bar) --------------------------------
  if (input.opinions.length > 0) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Opinion distribution (final)',
        xLabel: 'opinion',
        yLabel: 'fraction of nodes',
        grid: true,
        ticks: 5,
        xDomain: [0, 1],
        yDomain: [0, 1],
        series: [{ name: 'nodes', kind: 'bar', color: BAR_COLOR, bars: opinionBars(input.opinions) }],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel c: homophily over time ----------------------------------------------
  if (input.homophily.length >= 2) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Echo-chamber homophily over time',
        xLabel: 'cascade step',
        yLabel: 'homophily index',
        grid: true,
        ticks: 5,
        yDomain: [0, 1],
        series: [{ name: 'homophily', kind: 'line', color: HOMOPHILY_COLOR, points: stridedPoints(input.homophily) }],
      } as PlotSpec,
    });
  }

  return panels;
}
