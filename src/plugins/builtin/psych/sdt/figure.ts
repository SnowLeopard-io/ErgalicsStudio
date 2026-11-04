// ==========================================================================
// psych-sdt — Figure Studio panels
//
// Turns the current SDT state (operating point + model parameters) into
// publication-grade PlotSpec panels and streams them into the figure store's
// shared sheet via `pushPanelsToFigure`:
//   a. Analytic ROC curve(s) with the chance diagonal and the empirical
//      (FAR, HR) operating point.
//   b. The underlying noise / signal Gaussian distributions with the decision
//      criterion marked.
// Pure: no DOM, no store access — kernel calls only.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { rocCurve, sdtMeasures, stdNormPdf, stdNormQuantile, safeRate } from './kernel';

export interface SdtFigureInput {
  hitRate: number;
  faRate: number;
  sigmaRatio: number;
}

/**
 * Build the full Figure Studio panel layout for the current SDT model. Rows
 * are filled row-major; tag letters a, b, c, … label each panel.
 */
export function sdtFigurePanels(input: SdtFigureInput): FigurePanelSpec[] {
  const { hitRate, faRate, sigmaRatio } = input;
  const d = sdtMeasures(hitRate, faRate).dprime;
  if (!Number.isFinite(d)) return [];
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: analytic ROC + chance diagonal + operating point ------------
  const rocSeries: PlotSeries[] = [
    {
      name: 'ROC (equal variance)',
      kind: 'line',
      color: '#6ebeff',
      points: rocCurve(d, 1).map((p) => ({ x: p.far, y: p.hr })),
    },
  ];
  if (sigmaRatio !== 1) {
    rocSeries.push({
      name: `ROC (s=${sigmaRatio.toFixed(2)})`,
      kind: 'line',
      color: '#be8cfa',
      points: rocCurve(d, sigmaRatio).map((p) => ({ x: p.far, y: p.hr })),
    });
  }
  rocSeries.push({
    name: 'chance',
    kind: 'line',
    color: '#9aa7b8',
    dash: [4, 4],
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
  });
  rocSeries.push({
    name: 'operating point (F, H)',
    kind: 'scatter',
    color: '#e05252',
    points: [{ x: faRate, y: hitRate }],
  });
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'ROC curve',
      xLabel: 'false-alarm rate F',
      yLabel: 'hit rate H',
      xDomain: [0, 1],
      yDomain: [0, 1],
      grid: true,
      ticks: 5,
      series: rocSeries,
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: noise / signal distributions with the criterion -------------
  const s = Math.max(0.1, sigmaRatio);
  const xLo = -4;
  const xHi = Math.max(d + 4 * s, 4);
  const n = 160;
  const noise: Array<{ x: number; y: number }> = [];
  const signal: Array<{ x: number; y: number }> = [];
  for (let k = 0; k <= n; k += 1) {
    const x = xLo + ((xHi - xLo) * k) / n;
    noise.push({ x, y: stdNormPdf(x) });
    signal.push({ x, y: stdNormPdf((x - d) / s) / s });
  }
  // Criterion location in noise-σ units (same convention as the canvas panel).
  const criterion = -stdNormQuantile(safeRate(faRate));
  const peak = stdNormPdf(0);
  const distSeries: PlotSeries[] = [
    { name: 'noise N(0,1)', kind: 'line', color: '#6ebeff', points: noise },
    { name: `signal N(${d.toFixed(2)}, ${s.toFixed(2)})`, kind: 'line', color: '#fab46e', points: signal },
    {
      name: 'criterion',
      kind: 'line',
      color: '#c9d4e4',
      dash: [4, 3],
      points: [
        { x: criterion, y: 0 },
        { x: criterion, y: peak },
      ],
    },
  ];
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Signal / noise distributions',
      xLabel: 'internal response',
      yLabel: 'density',
      xDomain: [xLo, xHi],
      yDomain: [0, peak * 1.1],
      grid: true,
      ticks: 5,
      series: distSeries,
    } as PlotSpec,
  });

  return panels;
}
