// Time series — Figure Studio panels: series with forecast band, and the
// sample ACF with the asymptotic significance band.
import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_HEIGHT,
  FIGURE_PANEL_WIDTH,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { TsResult } from './plugin';

function seriesPanel(result: TsResult): FigurePanelSpec {
  const observed: PlotSeries = {
    name: 'observed',
    kind: 'line',
    color: '#78c8ff',
    points: result.series.values.map((v, i) => ({ x: result.series.time[i] ?? i + 1, y: v })),
  };
  const lastT = result.series.time.at(-1) ?? result.series.values.length;
  const forecast: PlotSeries = {
    name: 'ARIMA forecast',
    kind: 'line',
    color: '#ffd166',
    dash: [5, 4],
    points: [{ x: lastT, y: result.series.values.at(-1) ?? 0 }, ...result.forecast.map((p) => ({ x: lastT + p.step, y: p.mean }))],
  };
  return {
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Series + ${result.forecast.length}-step forecast`,
      xLabel: 'time',
      yLabel: result.series.valueName,
      grid: true,
      ticks: 4,
      legend: true,
      series: [observed, forecast],
    } as PlotSpec,
  };
}

function acfPanel(result: TsResult): FigurePanelSpec {
  const bars = result.acf.map((p) => ({ x0: p.lag - 0.36, x1: p.lag + 0.36, y: p.value }));
  const band = 1.96 / Math.sqrt(Math.max(1, result.series.values.length));
  return {
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Autocorrelation (ACF)',
      xLabel: 'lag',
      yLabel: 'ρ',
      grid: true,
      ticks: 4,
      legend: true,
      yDomain: [-1.05, 1.05],
      series: [
        { name: 'ACF', kind: 'bar', color: '#5ee6d0', bars },
        {
          name: `±1.96/√n = ${band.toFixed(3)}`,
          kind: 'line',
          color: '#ff8b86',
          dash: [4, 3],
          points: [
            { x: 0, y: band },
            { x: Math.max(1, result.acf.length - 1), y: band },
          ],
        },
        {
          name: '',
          kind: 'line',
          color: '#ff8b86',
          dash: [4, 3],
          points: [
            { x: 0, y: -band },
            { x: Math.max(1, result.acf.length - 1), y: -band },
          ],
        },
      ],
    } as PlotSpec,
  };
}

function trendPanel(result: TsResult): FigurePanelSpec {
  const decomp = result.decomp;
  const observed: PlotSeries = {
    name: 'observed',
    kind: 'line',
    color: '#78c8ff',
    points: result.series.values.map((v, i) => ({ x: result.series.time[i] ?? i + 1, y: v })),
  };
  const trend: PlotSeries = {
    name: 'trend',
    kind: 'line',
    color: '#ffd166',
    points: (decomp?.trend ?? [])
      .map((v, i) => ({ x: result.series.time[i] ?? i + 1, y: v }))
      .filter((p) => Number.isFinite(p.y)),
  };
  return {
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Observed series + trend',
      xLabel: 'time',
      yLabel: result.series.valueName,
      grid: true,
      ticks: 4,
      legend: true,
      series: [observed, trend],
    } as PlotSpec,
  };
}

function seasonalPanel(result: TsResult): FigurePanelSpec {
  const decomp = result.decomp;
  const seasonal: PlotSeries = {
    name: `seasonal (${decomp?.mode ?? 'additive'})`,
    kind: 'line',
    color: '#5ee6d0',
    points: (decomp?.seasonal ?? []).map((v, i) => ({ x: result.series.time[i] ?? i + 1, y: v })),
  };
  return {
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Seasonal component (period ${decomp?.period ?? 0})`,
      xLabel: 'time',
      yLabel: 'seasonal',
      grid: true,
      ticks: 4,
      legend: true,
      series: [
        seasonal,
        {
          name: '',
          kind: 'line',
          color: '#9aa7bb',
          dash: [4, 3],
          points: [
            { x: result.series.time[0] ?? 1, y: 0 },
            { x: result.series.time.at(-1) ?? result.series.values.length, y: 0 },
          ],
        },
      ],
    } as PlotSpec,
  };
}

/** All figure panels for one time-series analysis. */
export function timeseriesFigurePanels(result: TsResult, view: 'forecast' | 'decomposition' = 'forecast'): FigurePanelSpec[] {
  if (view === 'decomposition' && result.decomp) return [trendPanel(result), seasonalPanel(result)];
  return [seriesPanel(result), acfPanel(result)];
}
