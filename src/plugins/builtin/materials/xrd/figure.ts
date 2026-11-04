// ==========================================================================
// mats-xrd — Figure Studio panels
//
// Turns a completed XRD analysis (pattern + detected peaks + cubic lattice
// refinement + reference phase matches) into publication-grade PlotSpec
// panels and streams them into the figure store's shared sheet via
// `pushPanelsToFigure` — exactly like the other research labs.
//
// Charts delivered:
//   a. Powder pattern (2θ–intensity) with peak markers.
//   b. Peak stick diagram (relative intensity % vs 2θ).
//   c. Reference phase match counts (bar chart).
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { LatticeRefinement, PhaseMatch, XrdPeak, XrdPoint } from './kernel';

export interface XrdFigureInput {
  data: XrdPoint[];
  peaks: XrdPeak[];
  lattice: LatticeRefinement | null;
  matches: PhaseMatch[];
}

/**
 * Build the full Figure Studio panel layout for one XRD analysis. Rows are
 * filled row-major with fixed panel spacing; tag letters a, b, c, … label
 * each panel.
 */
export function xrdFigurePanels(input: XrdFigureInput): FigurePanelSpec[] {
  const { data, peaks, matches } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: powder pattern + peak markers -------------------------------
  if (data.length > 1) {
    const series: PlotSeries[] = [
      { name: 'pattern', kind: 'line', color: '#5dd0a8', points: data.map((p) => ({ x: p.twoTheta, y: p.intensity })) },
    ];
    if (peaks.length > 0) {
      series.push({ name: 'peaks', kind: 'scatter', color: '#ffd166', points: peaks.map((p) => ({ x: p.twoTheta, y: p.intensity })) });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Powder pattern (2θ–I)',
        xLabel: '2θ / °',
        yLabel: 'Intensity',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: peak stick diagram (relative intensity %) -------------------
  if (peaks.length > 0) {
    const iMax = Math.max(...peaks.map((p) => p.intensity)) || 1;
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Peak stick diagram',
        xLabel: '2θ / °',
        yLabel: 'Relative intensity / %',
        grid: true,
        ticks: 5,
        series: [
          {
            name: 'peaks',
            kind: 'bar',
            color: '#7ad7ff',
            bars: peaks.map((p) => ({ x0: p.twoTheta - 0.12, x1: p.twoTheta + 0.12, y: (p.intensity / iMax) * 100 })),
          },
        ],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel c: reference phase matches -------------------------------------
  if (matches.length > 0) {
    const top = matches.slice(0, 6);
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Reference phase matches',
        xLabel: 'phase',
        yLabel: 'matched reflections',
        grid: true,
        ticks: 5,
        series: [
          {
            name: 'matches',
            kind: 'bar',
            color: '#b48cff',
            bars: top.map((m, j) => ({ x0: j + 0.7, x1: j + 1.3, y: m.matches })),
          },
        ],
        xTicksOverride: top.map((m, j) => ({ pos: j + 1, label: m.phase.formula })),
      } as PlotSpec,
    });
    i += 1;
  }

  return panels;
}
