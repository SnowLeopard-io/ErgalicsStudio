// ==========================================================================
// eng-truss — Figure Studio panels
//
// Turns a completed plane-truss FEM solve into publication-grade PlotSpec
// panels:
//   a. Axial force per member as a categorical bar chart, split into a
//      tension (+, cyan) and a compression (−, red) series.
//   b. Axial stress per member (σ = N/A) in MPa.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { TrussResult } from './kernel';

/** Categorical bar panel: bar i spans [i, i+0.8], its tick sits at i+0.4. */
function categoricalBarPanel(
  ordinal: number,
  title: string,
  xLabel: string,
  yLabel: string,
  labels: string[],
  series: PlotSeries[],
): FigurePanelSpec {
  return {
    ...panelPlace(ordinal),
    tag: panelTag(ordinal),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title,
      xLabel,
      yLabel,
      grid: true,
      series,
      xDomain: [-0.4, Math.max(0.6, labels.length - 0.2)],
      xTicksOverride: labels.map((label, i) => ({ pos: i + 0.4, label })),
    } as PlotSpec,
  };
}

/**
 * Build the Figure Studio panel layout for one truss solve. Rows are filled
 * row-major; tag letters a, b, c, … label each panel.
 */
export function trussFigurePanels(result: TrussResult): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  const els = result.elements;
  if (els.length === 0) return panels;
  const labels = els.map((el) => `M${el.index}`);
  let i = 0;

  // --- panel a: axial force per member (tension + / compression −) ---------
  const forceSeries: PlotSeries[] = [];
  const tensionBars = els
    .filter((el) => el.axialForce >= 0)
    .map((el) => ({ x0: el.index, x1: el.index + 0.8, y: el.axialForce }));
  const compressionBars = els
    .filter((el) => el.axialForce < 0)
    .map((el) => ({ x0: el.index, x1: el.index + 0.8, y: el.axialForce }));
  if (tensionBars.length > 0) {
    forceSeries.push({ name: 'tension (N > 0)', kind: 'bar', color: '#6ec8fa', bars: tensionBars });
  }
  if (compressionBars.length > 0) {
    forceSeries.push({ name: 'compression (N < 0)', kind: 'bar', color: '#fa786e', bars: compressionBars });
  }
  if (forceSeries.length > 0) {
    panels.push(categoricalBarPanel(i, 'Axial force per member', 'member', 'axial force N / N', labels, forceSeries));
    i += 1;
  }

  // --- panel b: axial stress per member (MPa) -------------------------------
  panels.push(
    categoricalBarPanel(i, 'Axial stress per member', 'member', 'stress σ / MPa', labels, [
      {
        name: 'σ = N/A',
        kind: 'bar',
        color: '#b48cff',
        bars: els.map((el) => ({ x0: el.index, x1: el.index + 0.8, y: el.stress / 1e6 })),
      },
    ]),
  );

  return panels;
}
