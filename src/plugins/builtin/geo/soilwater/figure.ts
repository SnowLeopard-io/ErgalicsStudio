// ==========================================================================
// geo-soilwater — Figure Studio panels
//
// Turns a van Genuchten retention analysis into publication-grade PlotSpec
// panels:
//   a. Soil water retention curve θ(ψ) on a log suction axis — fitted model
//      line plus the observed θ(h) points.
//   b. Specific moisture capacity C(h) = |dθ/dh| on log–log axes, computed
//      analytically from the fitted parameters (fit required).
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import {
  logSpacedHeads,
  vgCapacity,
  vgTheta,
  type RetentionPoint,
  type VGFitResult,
} from './kernel';

export interface SoilWaterFigureInput {
  data: RetentionPoint[];
  fit: VGFitResult | null;
}

/**
 * Build the full Figure Studio panel layout for one retention analysis.
 * Rows are filled row-major; tag letters a, b, c, … label each panel.
 */
export function soilWaterFigurePanels(input: SoilWaterFigureInput): FigurePanelSpec[] {
  const { data, fit } = input;
  const panels: FigurePanelSpec[] = [];
  if (data.length === 0) return panels;
  let i = 0;

  // Common semi-log suction grid spanning slightly beyond the data range.
  const hMin = Math.min(...data.map((d) => d.h));
  const hMax = Math.max(...data.map((d) => d.h));
  const grid = logSpacedHeads(Math.max(hMin * 0.7, 0.1), hMax * 1.4, 160);

  // --- panel a: retention curve θ(ψ) ------------------------------------------
  const series: PlotSeries[] = [];
  if (fit) {
    series.push({
      name: 'van Genuchten fit',
      kind: 'line',
      color: '#7ad7ff',
      points: grid.map((h) => ({ x: h, y: vgTheta(h, fit.params) })),
    });
  }
  series.push({
    name: 'observed θ(h)',
    kind: 'scatter',
    color: '#ebf0f7',
    points: data.map((d) => ({ x: d.h, y: d.theta })),
  });
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Soil water retention θ(ψ)',
      xLabel: 'suction |h| / cm',
      yLabel: 'θ / cm³·cm⁻³',
      xScale: 'log',
      grid: true,
      ticks: 5,
      legend: true,
      series,
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: specific moisture capacity C(h) (fit required) ----------------
  if (fit) {
    const capPts = grid
      .map((h) => ({ x: h, y: vgCapacity(h, fit.params) }))
      .filter((p) => Number.isFinite(p.y) && p.y > 0);
    if (capPts.length >= 2) {
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Specific moisture capacity C(h)',
          xLabel: 'suction |h| / cm',
          yLabel: 'C(h) / 1/cm',
          xScale: 'log',
          yScale: 'log',
          grid: true,
          ticks: 5,
          series: [{ name: 'C(h) = |dθ/dh|', kind: 'line', color: '#ffd166', points: capPts }],
        } as PlotSpec,
      });
    }
  }

  return panels;
}
