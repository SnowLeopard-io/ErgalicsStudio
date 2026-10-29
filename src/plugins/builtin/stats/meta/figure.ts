// Meta-analysis — Figure Studio panels: a forest plot of study effects with
// the pooled diamond, and the funnel plot used to screen small-study effects.
import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_HEIGHT,
  FIGURE_PANEL_WIDTH,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { MetaViewResult } from './plugin';

function forestPanel(view: MetaViewResult, model: 'fixed' | 'random'): FigurePanelSpec {
  const { studies } = view.dataset;
  const pooled = model === 'fixed' ? view.result.fixed : view.result.random;
  const series: PlotSeries[] = studies.map((s, i) => ({
    name: s.study,
    kind: 'line',
    color: '#78c8ff',
    points: [
      { x: s.effect - 1.96 * s.se, y: studies.length - i },
      { x: s.effect + 1.96 * s.se, y: studies.length - i },
    ],
  }));
  series.push({
    name: 'pooled',
    kind: 'scatter',
    color: '#ffd166',
    points: studies.map((s, i) => ({ x: s.effect, y: studies.length - i })),
  });
  series.push({
    name: 'pooled estimate',
    kind: 'line',
    color: '#ffd166',
    dash: [5, 4],
    points: [
      { x: pooled.estimate, y: 0.4 },
      { x: pooled.estimate, y: studies.length + 0.6 },
    ],
  });
  return {
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Forest plot (${model} effects)`,
      xLabel: 'effect size',
      yLabel: 'study',
      grid: true,
      ticks: 4,
      legend: true,
      yDomain: [0, studies.length + 1],
      series,
    } as PlotSpec,
  };
}

function funnelPanel(view: MetaViewResult): FigurePanelSpec {
  const { studies } = view.dataset;
  const pooled = view.result.fixed.estimate;
  const maxSe = Math.max(...studies.map((s) => s.se)) * 1.1;
  return {
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Funnel plot',
      xLabel: 'effect size',
      yLabel: 'standard error',
      grid: true,
      ticks: 4,
      legend: true,
      series: [
        { name: 'study', kind: 'scatter', color: '#5ee6d0', points: studies.map((s) => ({ x: s.effect, y: s.se })) },
        {
          name: 'pooled',
          kind: 'line',
          color: '#ffd166',
          dash: [4, 3],
          points: [
            { x: pooled, y: 0 },
            { x: pooled, y: maxSe },
          ],
        },
      ],
    } as PlotSpec,
  };
}

/** All figure panels for one meta-analysis. */
export function metaFigurePanels(view: MetaViewResult, model: 'fixed' | 'random'): FigurePanelSpec[] {
  return [forestPanel(view, model), funnelPanel(view)];
}
