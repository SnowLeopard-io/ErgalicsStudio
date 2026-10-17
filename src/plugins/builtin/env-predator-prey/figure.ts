// ==========================================================================
// env-predator-prey — Figure Studio panels
//
// Turns a completed Lotka–Volterra simulation into publication-grade
// PlotSpec panels:
//   a. Prey and predator populations vs time (model lines, optional
//      observed data overlay).
//   b. Phase-plane orbit (predator y vs prey x) with the coexistence
//      equilibrium marked.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { lvEquilibrium, type LvData, type LvParams, type LvSeries } from './kernel';

export interface LvFigureInput {
  series: LvSeries;
  params: LvParams;
  /** Optional observed prey/predator overlay. */
  data?: LvData | null;
}

/** Maximum points kept for one plotted line. */
const MAX_POINTS = 1200;

function decimate(times: number[], values: number[]): Array<{ x: number; y: number }> {
  const stride = Math.max(1, Math.floor(times.length / MAX_POINTS));
  const pts: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < times.length; k += stride) {
    pts.push({ x: times[k]!, y: values[k]! });
  }
  return pts;
}

/**
 * Build the full Figure Studio panel layout for one LV simulation. Rows are
 * filled row-major; tag letters a, b, c, … label each panel.
 */
export function lvFigurePanels(input: LvFigureInput): FigurePanelSpec[] {
  const { series, params, data } = input;
  const panels: FigurePanelSpec[] = [];
  if (series.times.length < 2) return panels;
  let i = 0;

  // --- panel a: populations vs time ------------------------------------------
  const timeSeries: PlotSeries[] = [
    { name: 'prey x(t)', kind: 'line', color: '#f0aa6e', points: decimate(series.times, series.x) },
    { name: 'predator y(t)', kind: 'line', color: '#7ad7ff', points: decimate(series.times, series.y) },
  ];
  if (data && data.times.length >= 2) {
    timeSeries.push({
      name: 'observed prey',
      kind: 'line',
      color: '#c8785a',
      dash: [3, 3],
      points: decimate(data.times, data.x),
    });
    timeSeries.push({
      name: 'observed predator',
      kind: 'line',
      color: '#5aa8d8',
      dash: [3, 3],
      points: decimate(data.times, data.y),
    });
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Predator–prey time series',
      xLabel: 'time t',
      yLabel: 'population',
      grid: true,
      ticks: 5,
      legend: true,
      series: timeSeries,
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: phase-plane orbit ---------------------------------------------
  const xPts = decimate(series.times, series.x);
  const yPts = decimate(series.times, series.y);
  const orbitPts = xPts.map((p, k) => ({ x: p.y, y: yPts[k]!.y }));
  const phaseSeries: PlotSeries[] = [
    { name: 'model orbit', kind: 'line', color: '#7ad7ff', points: orbitPts },
  ];
  const eq = lvEquilibrium(params);
  if (Number.isFinite(eq.xStar) && Number.isFinite(eq.yStar)) {
    phaseSeries.push({
      name: 'equilibrium (γ/δ, α/β)',
      kind: 'scatter',
      color: '#ffd166',
      points: [{ x: eq.xStar, y: eq.yStar }],
    });
  }
  if (data && data.times.length >= 2) {
    const stride = Math.max(1, Math.floor(data.times.length / 120));
    const dataPts: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < data.times.length; k += stride) {
      dataPts.push({ x: data.x[k]!, y: data.y[k]! });
    }
    if (dataPts.length > 0) {
      phaseSeries.push({ name: 'observed', kind: 'scatter', color: '#f0aa6e', points: dataPts });
    }
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Phase-plane orbit',
      xLabel: 'prey x',
      yLabel: 'predator y',
      grid: true,
      ticks: 5,
      legend: true,
      series: phaseSeries,
    } as PlotSpec,
  });

  return panels;
}
