// ==========================================================================
// chem-turing — Figure Studio panels
//
// Turns the current Gray–Scott reactor state into publication-grade PlotSpec
// panels and streams them into the figure store's shared sheet via
// `pushPanelsToFigure` (see plugin.ts).
//
// Charts delivered:
//   a. Catalyst concentration field v as a heatmap (domain 0–0.4, matching
//      the on-canvas colour mapping).
//   b. Substrate concentration field u as a heatmap (domain 0–1).
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { GrayScottState } from './kernel';

export interface TuringFigureInput {
  state: GrayScottState;
}

/**
 * Build the full Figure Studio panel layout for one reactor snapshot. Rows
 * are filled row-major; tag letters a, b, c, … label each panel.
 */
export function turingFigurePanels(input: TuringFigureInput): FigurePanelSpec[] {
  const { state } = input;
  const panels: FigurePanelSpec[] = [];
  if (state.n <= 0) return panels;

  // Snapshots (Array.from copies, so later buffer swaps cannot alias).
  const fields: Array<{ name: string; values: number[]; domain: [number, number]; color: string }> = [
    { name: 'v (catalyst)', values: Array.from(state.v), domain: [0, 0.4], color: '#7ad7ff' },
    { name: 'u (substrate)', values: Array.from(state.u), domain: [0, 1], color: '#5dd0a8' },
  ];

  let i = 0;
  for (const f of fields) {
    if (f.values.length !== state.n * state.n) continue;
    const series: PlotSeries[] = [
      {
        name: f.name,
        kind: 'field',
        color: f.color,
        field: { values: f.values, rows: state.n, cols: state.n, domain: f.domain },
      },
    ];
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `${f.name} · ${state.n}×${state.n} · step ${state.steps}`,
        xLabel: 'x (grid)',
        yLabel: 'y (grid)',
        ticks: 4,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  return panels;
}
