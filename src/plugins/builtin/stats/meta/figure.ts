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
  const n = studies.length;
  // One CI segment per study, all unnamed so the legend stays compact; the
  // study points themselves form a single scatter series.
  const ciSeries: PlotSeries[] = studies.map((s, i) => ({
    name: '',
    kind: 'line',
    color: '#78c8ff',
    points: [
      { x: s.effect - 1.96 * s.se, y: n - i },
      { x: s.effect + 1.96 * s.se, y: n - i },
    ],
  }));
  const ciSeriesPooled: PlotSeries = {
    name: '',
    kind: 'line',
    color: '#ffd166',
    points: [
      { x: pooled.lo, y: 0.4 },
      { x: pooled.hi, y: 0.4 },
    ],
  };
  const series: PlotSeries[] = [
    ...ciSeries,
    ciSeriesPooled,
    {
      name: 'study effect',
      kind: 'scatter',
      color: '#78c8ff',
      points: studies.map((s, i) => ({ x: s.effect, y: n - i })),
    },
    {
      name: 'pooled estimate',
      kind: 'scatter',
      color: '#ffd166',
      points: [{ x: pooled.estimate, y: 0.4 }],
    },
  ];
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
      yDomain: [0, n + 0.8],
      yTicksOverride: [
        ...studies.map((s, i) => ({ pos: n - i, label: s.study })),
        { pos: 0.4, label: 'pooled' },
      ],
      series,
    } as PlotSpec,
  };
}

function funnelPanel(view: MetaViewResult): FigurePanelSpec {
  const { studies } = view.dataset;
  const pooled = view.result.fixed.estimate;
  const maxSe = Math.max(...studies.map((s) => s.se)) * 1.1;
  const bound = 1.96 * maxSe;
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
          name: '',
          kind: 'line',
          color: '#9aa7bb',
          dash: [4, 3],
          points: [
            { x: pooled, y: 0 },
            { x: pooled - bound, y: maxSe },
          ],
        },
        {
          name: '',
          kind: 'line',
          color: '#9aa7bb',
          dash: [4, 3],
          points: [
            { x: pooled, y: 0 },
            { x: pooled + bound, y: maxSe },
          ],
        },
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
