// ==========================================================================
// complexity — Figure Studio panels
//   a. measured runtime vs input size with the selected model overlay.
//   b. log-log scatter with the fitted power-law line.
//   c. residuals of the selected model.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import { FIGURE_PANEL_HEIGHT, FIGURE_PANEL_WIDTH, panelPlace, panelTag, type FigurePanelSpec } from '@/core/figure/sheet';
import { MODELS, fitModel, powerLaw, type Analysis, type Measurement, type ModelId } from './kernel';

export interface ComplexityFigureInput {
  data: Measurement[];
  analysis: Analysis;
  overlay: ModelId;
}

export function complexityFigurePanels(input: ComplexityFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  const fit = fitModel(input.overlay, input.data);
  panels.push({
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `${MODELS[input.overlay].latex} fit · R² ${fit.r2.toFixed(4)}`,
      xLabel: 'n',
      yLabel: 'time (ms)',
      grid: true,
      ticks: 6,
      legend: true,
      series: [
        { name: 'measured', kind: 'scatter', color: '#ffd166', points: input.data.map((d) => ({ x: d.n, y: d.time })) },
        {
          name: MODELS[input.overlay].latex,
          kind: 'line',
          color: '#5ee6d0',
          points: input.data.map((d, i) => ({ x: d.n, y: fit.predictions[i] ?? 0 })).sort((a, b) => a.x - b.x),
        },
      ],
    } as PlotSpec,
  });

  const power = powerLaw(input.data);
  const logPoints = input.data.filter((d) => d.n > 0 && d.time > 0).map((d) => ({ x: Math.log2(d.n), y: Math.log2(d.time) }));
  const xs = logPoints.map((p) => p.x);
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = xs.length ? Math.max(...xs) : 1;
  const logLine = [
    { x: minX, y: power.slope * minX + power.intercept },
    { x: maxX, y: power.slope * maxX + power.intercept },
  ];
  panels.push({
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `log-log slope ${power.slope.toFixed(3)} · R² ${power.r2.toFixed(4)}`,
      xLabel: 'log₂ n',
      yLabel: 'log₂ time',
      grid: true,
      ticks: 6,
      legend: true,
      series: [
        { name: 'measurements', kind: 'scatter', color: '#78c8ff', points: logPoints },
        { name: 'power law', kind: 'line', color: '#ffd166', dash: [5, 4], points: logLine },
      ],
    } as PlotSpec,
  });

  const residuals = input.data.map((d, i) => ({ x: d.n, y: d.time - (fit.predictions[i] ?? 0) }));
  panels.push({
    ...panelPlace(2),
    tag: panelTag(2),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Residuals',
      xLabel: 'n',
      yLabel: 'time − model',
      grid: true,
      ticks: 6,
      series: [{ name: 'residual', kind: 'bar', color: '#b48cff', bars: residuals.map((r) => ({ x0: r.x - 0.35, x1: r.x + 0.35, y: r.y })) }],
    } as PlotSpec,
  });
  return panels;
}
