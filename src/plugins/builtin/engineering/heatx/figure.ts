// ==========================================================================
// eng-heat — Figure Studio panels
//
// Pure builder: wraps already-computed heat-transfer series (temperature
// profiles, isotherm fields, Nu/Re curves, Planck spectra, ε-NTU families)
// into publication-grade PlotSpec panels. No DOM, no store access; the
// plugin supplies the series so kernel logic stays out of this module.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';

export interface HeatXLinePanel {
  title: string;
  xLabel: string;
  yLabel: string;
  logX?: boolean;
  series: PlotSeries[];
}

export interface HeatXFieldPanel {
  title: string;
  values: number[];
  rows: number;
  cols: number;
  /** [min, max] of the data domain. */
  domain: [number, number];
}

export interface HeatXFigureInput {
  mode: string;
  /** Line panels (profile / correlation / spectral / ε-NTU curves). */
  lines?: HeatXLinePanel[];
  /** Raster field panel (SOR isotherms / 2-D transient). */
  field?: HeatXFieldPanel;
}

function linePanel(ordinal: number, p: HeatXLinePanel): FigurePanelSpec {
  return {
    ...panelPlace(ordinal),
    tag: panelTag(ordinal),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: p.title,
      xLabel: p.xLabel,
      yLabel: p.yLabel,
      grid: true,
      ticks: 5,
      ...(p.logX ? { xScale: 'log' as const } : {}),
      series: p.series,
    } as PlotSpec,
  };
}

function fieldPanel(ordinal: number, p: HeatXFieldPanel): FigurePanelSpec {
  return {
    ...panelPlace(ordinal),
    tag: panelTag(ordinal),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: p.title,
      xLabel: 'x',
      yLabel: 'y',
      grid: false,
      series: [
        {
          name: 'T',
          kind: 'field',
          color: '#5dd0a8',
          field: { values: p.values, rows: p.rows, cols: p.cols, domain: p.domain },
        },
      ],
    } as PlotSpec,
  };
}

/** Build the Figure Studio panel layout for one heat-transfer analysis. */
export function heatxFigurePanels(input: HeatXFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;
  if (input.field) {
    panels.push(fieldPanel(i, input.field));
    i += 1;
  }
  for (const line of input.lines ?? []) {
    if (line.series.length === 0) continue;
    panels.push(linePanel(i, line));
    i += 1;
  }
  return panels;
}
