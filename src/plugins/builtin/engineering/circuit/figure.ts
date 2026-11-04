// ==========================================================================
// eng-circuit — Figure Studio panels
//
// Turns a completed MNA solve into publication-grade PlotSpec panels:
//   a. DC node voltages as a categorical bar chart (the ground datum is
//      excluded — it is 0 V by construction).
//   b. V-source branch currents as a signed categorical bar chart
//      (positive = current flowing into the "+" terminal).
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { MnaResult } from './kernel';

/** Categorical bar panel: bar i spans [i, i+0.8], its tick sits at i+0.4. */
function categoricalBarPanel(
  ordinal: number,
  title: string,
  xLabel: string,
  yLabel: string,
  labels: string[],
  values: number[],
  color: string,
): FigurePanelSpec | null {
  if (labels.length === 0 || labels.length !== values.length) return null;
  const series: PlotSeries[] = [
    { name: title, kind: 'bar', color, bars: values.map((y, i) => ({ x0: i, x1: i + 0.8, y })) },
  ];
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
 * Build the Figure Studio panel layout for one MNA solve. Rows are filled
 * row-major; tag letters a, b, c, … label each panel.
 */
export function circuitFigurePanels(result: MnaResult): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: node voltages (ground excluded; it is 0 V by definition) ---
  const vPanel = categoricalBarPanel(
    i,
    'DC node voltages',
    'node',
    'voltage / V',
    result.nodeVoltages.map((nv) => nv.node),
    result.nodeVoltages.map((nv) => nv.voltage),
    '#7ad7ff',
  );
  if (vPanel) {
    panels.push(vPanel);
    i += 1;
  }

  // --- panel b: V-source branch currents (signed) ---------------------------
  if (result.sourceCurrents.length > 0) {
    const iPanel = categoricalBarPanel(
      i,
      'V-source branch currents',
      'source',
      'current / A',
      result.sourceCurrents.map((sc) => sc.name),
      result.sourceCurrents.map((sc) => sc.current),
      '#ffd166',
    );
    if (iPanel) panels.push(iPanel);
  }

  return panels;
}
