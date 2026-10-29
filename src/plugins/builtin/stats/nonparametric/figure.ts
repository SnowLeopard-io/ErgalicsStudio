// Nonparametric — Figure Studio panels: empirical CDFs per group and a bar
// panel of group means (the visual companion to the rank tests).
import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_HEIGHT,
  FIGURE_PANEL_WIDTH,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { NpViewResult } from './plugin';

const PALETTE = ['#78c8ff', '#ffd166', '#5ee6d0', '#b48cff', '#ff9ecd', '#ff8b86', '#6ee7ff'];

function ecdfPanel(view: NpViewResult): FigurePanelSpec {
  const series: PlotSeries[] = view.dataset.groups.map((gr, idx) => {
    const sorted = [...gr.values].sort((a, b) => a - b);
    const points: Array<{ x: number; y: number }> = [];
    sorted.forEach((v, i) => {
      points.push({ x: v, y: i / sorted.length });
      points.push({ x: v, y: (i + 1) / sorted.length });
    });
    return { name: `${gr.label} (n=${gr.values.length})`, kind: 'line', color: PALETTE[idx % PALETTE.length]!, points };
  });
  return {
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Empirical CDFs',
      xLabel: view.dataset.valueName,
      yLabel: 'F(x)',
      grid: true,
      ticks: 4,
      legend: true,
      yDomain: [0, 1],
      series,
    } as PlotSpec,
  };
}

function meansPanel(view: NpViewResult): FigurePanelSpec {
  const bars = view.dataset.groups.map((gr, i) => ({
    x0: i + 0.15,
    x1: i + 0.85,
    y: gr.values.reduce((s, v) => s + v, 0) / Math.max(1, gr.values.length),
  }));
  return {
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Group means',
      xLabel: 'group',
      yLabel: 'mean',
      grid: true,
      ticks: 4,
      legend: false,
      xDomain: [0, Math.max(1, bars.length)],
      xTicksOverride: view.dataset.groups.map((g, i) => ({ pos: i + 0.5, label: g.label })),
      series: [{ name: 'mean', kind: 'bar', color: '#5ee6d0', bars }],
    } as PlotSpec,
  };
}

/** All figure panels for one nonparametric analysis. */
export function nonparametricFigurePanels(view: NpViewResult): FigurePanelSpec[] {
  return [ecdfPanel(view), meansPanel(view)];
}
