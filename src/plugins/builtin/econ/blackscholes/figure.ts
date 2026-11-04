// ==========================================================================
// econ-blackscholes — Figure Studio panels
//
// Turns one BSM pricing run into publication-grade PlotSpec panels:
//   a. Analytic call/put price curves vs spot over the plugin's default
//      spot window, with the current spot marked on both curves.
//   b. Monte Carlo convergence trace (cumulative mean call price vs path
//      count) with the analytic price as a dashed reference line.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { BsPrices, BSParams, McOutput, SpotCurvePoint } from './kernel';

export interface BSFigureInput {
  /** Contract / market parameters (current spot marked on the curves). */
  params: BSParams;
  /** Analytic price curve over the spot window (kernel `spotCurve`). */
  curve: SpotCurvePoint[];
  /** Analytic prices at the current spot. */
  analytic: BsPrices;
  /** Monte Carlo output with the cumulative-mean trace (kernel `mcPrices`). */
  mc: McOutput;
}

/**
 * Build the Figure Studio panel layout for one pricing run. Rows are filled
 * row-major; tag letters a, b, c, … label each panel.
 */
export function blackscholesFigurePanels(input: BSFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: analytic price curves vs spot --------------------------------
  if (input.curve.length >= 2) {
    const series: PlotSeries[] = [
      { name: 'call C(S)', kind: 'line', color: '#6ebeff', points: input.curve.map((pt) => ({ x: pt.s, y: pt.call })) },
      { name: 'put P(S)', kind: 'line', color: '#fab46e', points: input.curve.map((pt) => ({ x: pt.s, y: pt.put })) },
      {
        name: 'current S',
        kind: 'scatter',
        color: '#ffffff',
        points: [
          { x: input.params.S, y: input.analytic.call },
          { x: input.params.S, y: input.analytic.put },
        ],
      },
    ];
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'BSM price vs spot (analytic)',
        xLabel: 'spot S',
        yLabel: 'price',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: MC convergence trace vs the analytic price -------------------
  if (input.mc.trace.length >= 2) {
    const an = input.analytic.call;
    const n = input.mc.result.paths;
    const series: PlotSeries[] = [
      {
        name: 'MC cumulative mean',
        kind: 'line',
        color: '#6ebeff',
        points: input.mc.trace.map((t) => ({ x: t.n, y: t.callMean })),
      },
      {
        name: 'analytic price',
        kind: 'line',
        color: '#aab6c8',
        dash: [5, 4],
        points: [
          { x: 0, y: an },
          { x: n, y: an },
        ],
      },
    ];
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Monte Carlo convergence (call)',
        xLabel: 'paths n',
        yLabel: 'discounted call price',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
  }

  return panels;
}
