// ==========================================================================
// geo-hydrology — Figure Studio panels
//
// Turns a completed SCS-CN rainfall–runoff event into publication-grade
// PlotSpec panels:
//   a. Storm hyetograph — rainfall increments per time bin as bars with the
//      excess-rainfall increments overlaid.
//   b. Direct runoff hydrograph with the peak discharge marked.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { ScsEventResult } from './kernel';

export interface HydrologyFigureInput {
  event: ScsEventResult;
}

/**
 * Build the full Figure Studio panel layout for one SCS event. Rows are
 * filled row-major; tag letters a, b, c, … label each panel.
 */
export function hydrologyFigurePanels(input: HydrologyFigureInput): FigurePanelSpec[] {
  const { event: ev } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: hyetograph bars (rainfall + excess per bin) -------------------
  if (ev.precipMm.length > 0) {
    const rainBars = ev.precipMm.map((y, k) => ({ x0: k * ev.dtHours, x1: (k + 1) * ev.dtHours, y }));
    const excessBars = ev.excessMm.map((y, k) => ({
      x0: k * ev.dtHours + ev.dtHours * 0.18,
      x1: (k + 1) * ev.dtHours - ev.dtHours * 0.18,
      y,
    }));
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Design-storm hyetograph',
        xLabel: 'time / h',
        yLabel: 'rainfall / mm per bin',
        grid: true,
        legend: true,
        series: [
          { name: 'precipitation', kind: 'bar', color: '#7ab8fa', bars: rainBars },
          { name: 'excess (SCS-CN)', kind: 'bar', color: '#ffd166', bars: excessBars },
        ],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: direct runoff hydrograph + peak marker -------------------------
  if (ev.directRunoff.length >= 2) {
    const runoffPts = ev.timesHours.map((t, k) => ({ x: t, y: ev.directRunoff[k]! }));
    const series: PlotSeries[] = [
      { name: 'direct runoff', kind: 'line', color: '#7ad7ff', points: runoffPts },
    ];
    if (ev.peakFlowM3s > 0) {
      series.push({
        name: 'peak',
        kind: 'scatter',
        color: '#ffd166',
        points: [{ x: ev.timeToPeakHours, y: ev.peakFlowM3s }],
      });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Direct runoff hydrograph',
        xLabel: 'time / h',
        yLabel: 'Q / m³·s⁻¹',
        grid: true,
        ticks: 5,
        legend: true,
        series,
      } as PlotSpec,
    });
  }

  return panels;
}
