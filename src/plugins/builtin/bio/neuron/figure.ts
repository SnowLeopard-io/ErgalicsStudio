// ==========================================================================
// bio-neuron — Figure Studio panels
//
// Turns a completed Hodgkin–Huxley simulation into publication-grade
// PlotSpec panels:
//   a. Membrane potential V(t) with dashed rest (−65 mV) and spike-threshold
//      (0 mV) reference lines.
//   b. Firing rate vs sustained stimulus current (F–I curve) computed by
//      sweeping the kernel's firingRate over a current grid.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { REST_V, firingRate, type HHParams, type HHSeries } from './kernel';

export interface NeuronFigureInput {
  series: HHSeries;
  params: HHParams;
}

/** Maximum points kept for one plotted line (the RK4 series can hold ~50k). */
const MAX_POINTS = 1500;

/**
 * Build the full Figure Studio panel layout for one HH simulation. Rows are
 * filled row-major; tag letters a, b, c, … label each panel.
 */
export function neuronFigurePanels(input: NeuronFigureInput): FigurePanelSpec[] {
  const { series, params } = input;
  const panels: FigurePanelSpec[] = [];
  if (series.times.length < 2) return panels;
  let i = 0;
  const tEnd = series.times[series.times.length - 1]!;

  // --- panel a: membrane potential V(t) ---------------------------------------
  const stride = Math.max(1, Math.floor(series.times.length / MAX_POINTS));
  const vPts: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < series.times.length; k += stride) {
    vPts.push({ x: series.times[k]!, y: series.v[k]! });
  }
  if (vPts.length >= 2) {
    const seriesList: PlotSeries[] = [
      { name: 'V(t)', kind: 'line', color: '#7ad7ff', points: vPts },
      {
        name: 'rest −65 mV',
        kind: 'line',
        color: '#aab6c8',
        dash: [4, 4],
        points: [
          { x: 0, y: REST_V },
          { x: tEnd, y: REST_V },
        ],
      },
      {
        name: 'threshold 0 mV',
        kind: 'line',
        color: '#ff6b6b',
        dash: [4, 3],
        points: [
          { x: 0, y: 0 },
          { x: tEnd, y: 0 },
        ],
      },
    ];
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Membrane potential V(t)',
        xLabel: 'time t / ms',
        yLabel: 'V / mV',
        grid: true,
        ticks: 5,
        legend: true,
        series: seriesList,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: firing rate vs sustained current (F–I curve) ------------------
  const fiPts: Array<{ x: number; y: number }> = [];
  for (let amp = 0; amp <= 60; amp += 5) {
    // Coarser dt keeps the 13-run sweep cheap while resolving firing rates.
    const rate = firingRate(params, amp, 200, 0.05);
    if (Number.isFinite(rate)) fiPts.push({ x: amp, y: rate });
  }
  if (fiPts.length >= 2) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Firing rate vs stimulus',
        xLabel: 'sustained I / µA·cm⁻²',
        yLabel: 'rate / Hz',
        grid: true,
        ticks: 5,
        series: [{ name: 'F–I', kind: 'line', color: '#5dd0a8', points: fiPts }],
      } as PlotSpec,
    });
  }

  return panels;
}
