// DOE — Figure Studio panels: Pareto of standardised effects and factor
// main-effect plots on the observed response scale.
import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_HEIGHT,
  FIGURE_PANEL_WIDTH,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { studentTInv } from '@/core/stats/special';
import { factorEffects, type DoeDataset, type DoeFit } from './kernel';

/** Build the Pareto panel: |t| per term with the 5 % critical reference. */
function paretoPanel(fit: DoeFit): FigurePanelSpec {
  const terms = [...fit.coefficients].sort((a, b) => Math.abs(b.t) - Math.abs(a.t)).slice(0, 9);
  const critical = studentTInv(0.975, Math.max(1, fit.n - fit.coefficients.length - 1));
  const bars = terms.map((t, i) => ({ x0: i - 0.38, x1: i + 0.38, y: Math.abs(t.t) }));
  const series: PlotSeries[] = [
    { name: '|t|', kind: 'bar', color: '#78c8ff', bars },
    {
      name: `t*.95 = ${critical.toFixed(2)}`,
      kind: 'line',
      color: '#ffd166',
      dash: [5, 4],
      points: [
        { x: -0.6, y: critical },
        { x: terms.length - 0.4, y: critical },
      ],
    },
  ];
  return {
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Standardised effects (Pareto)',
      xLabel: 'term',
      yLabel: '|t|',
      grid: true,
      ticks: 4,
      legend: true,
      xDomain: [-0.7, Math.max(1, terms.length - 0.3)],
      xTicksOverride: terms.map((t, i) => ({ pos: i, label: t.term })),
      series,
    } as PlotSpec,
  };
}

/** Main-effect panel: average response at each factor level. */
function effectsPanel(dataset: DoeDataset): FigurePanelSpec {
  const effects = factorEffects(dataset);
  const series: PlotSeries[] = effects.map((f, idx) => ({
    name: f.factor,
    kind: 'line',
    color: ['#78c8ff', '#5ee6d0', '#ffd166', '#b48cff', '#ff9ecd'][idx % 5]!,
    points: f.levels.map((l) => ({ x: l.level, y: l.mean })),
  }));
  return {
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Main-effect means',
      xLabel: 'factor level',
      yLabel: 'response mean',
      grid: true,
      ticks: 4,
      legend: true,
      series,
    } as PlotSpec,
  };
}

/** All figure panels for a fitted DOE model. */
export function doeFigurePanels(fit: DoeFit, dataset: DoeDataset): FigurePanelSpec[] {
  return [paretoPanel(fit), effectsPanel(dataset)];
}
