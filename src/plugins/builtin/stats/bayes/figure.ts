// Bayesian inference — Figure Studio panels: the MCMC trace of μ and the
// posterior density with the 95 % credible interval and prior overlay.
import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_HEIGHT,
  FIGURE_PANEL_WIDTH,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { DEFAULT_PRIOR, kde } from './kernel';
import type { BayesViewResult } from './plugin';

function tracePanel(view: BayesViewResult): FigurePanelSpec {
  const samples = view.samples;
  const stride = Math.max(1, Math.floor(samples.length / 400));
  const points = samples.filter((_, i) => i % stride === 0).map((v, i) => ({ x: i * stride, y: v }));
  return {
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Trace plot of μ',
      xLabel: 'draw',
      yLabel: 'μ',
      grid: true,
      ticks: 4,
      legend: false,
      series: [{ name: 'μ', kind: 'line', color: '#78c8ff', points }],
    } as PlotSpec,
  };
}

function densityPanel(view: BayesViewResult): FigurePanelSpec {
  const samples = view.samples;
  const lo = Math.min(...samples);
  const hi = Math.max(...samples);
  const pad = (hi - lo) * 0.15 || 1;
  const grid = Array.from({ length: 90 }, (_, i) => lo - pad + ((hi - lo + 2 * pad) * i) / 89);
  const posterior = grid.map((x) => ({ x, y: kde(samples, x) }));
  const priorSd = 1 / Math.sqrt(DEFAULT_PRIOR.kappa);
  const prior = grid.map((x) => ({
    x,
    y: Math.exp(-((x - DEFAULT_PRIOR.mu0) ** 2) / (2 * priorSd * priorSd)) / (priorSd * Math.sqrt(2 * Math.PI)),
  }));
  const mu = view.result.muSummary;
  const series: PlotSeries[] = [
    { name: 'posterior', kind: 'line', color: '#78c8ff', points: posterior },
    { name: 'prior', kind: 'line', color: '#8b93a7', dash: [5, 4], points: prior },
    {
      name: '95% CI',
      kind: 'line',
      color: '#ffd166',
      dash: [4, 3],
      points: [
        { x: mu.lo, y: 0 },
        { x: mu.lo, y: Math.max(...posterior.map((p) => p.y)) * 0.9 },
      ],
    },
    {
      name: '',
      kind: 'line',
      color: '#ffd166',
      dash: [4, 3],
      points: [
        { x: mu.hi, y: 0 },
        { x: mu.hi, y: Math.max(...posterior.map((p) => p.y)) * 0.9 },
      ],
    },
  ];
  return {
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Posterior density of μ',
      xLabel: 'μ',
      yLabel: 'density',
      grid: true,
      ticks: 4,
      legend: true,
      series,
    } as PlotSpec,
  };
}

/** All figure panels for one Bayesian fit. */
export function bayesFigurePanels(view: BayesViewResult): FigurePanelSpec[] {
  return [tracePanel(view), densityPanel(view)];
}
