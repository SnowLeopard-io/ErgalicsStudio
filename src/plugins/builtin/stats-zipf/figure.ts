// ==========================================================================
// stats-zipf — Figure Studio panels
//
// Publication-grade views of one corpus analysis:
//   a. Rank–frequency scatter on log–log axes with the OLS fit line
//      f = a·r^(−s) across the fitted window.
//   b. Per-rank fit residuals log f − ŷ over the fitted window (log x-scale).
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { ZipfAnalysis } from './kernel';

/** Build the full Figure Studio panel layout for one Zipf analysis. */
export function zipfFigurePanels(a: ZipfAnalysis): FigurePanelSpec[] {
  if (a.ranked.length === 0) return [];
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: rank–frequency log-log scatter + fit line --------------------
  {
    const series: PlotSeries[] = [];
    // Stride so huge vocabularies stay SVG-friendly (same rule as the canvas).
    const stride = a.vocab > 4000 ? Math.ceil(a.vocab / 4000) : 1;
    const points: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < a.ranked.length; k += stride) {
      const entry = a.ranked[k];
      if (!entry || entry.count <= 0) continue;
      points.push({ x: k + 1, y: entry.count });
    }
    if (points.length > 0) {
      series.push({ name: 'observed f(r)', kind: 'scatter', color: '#7ab8f0', points });
    }
    const fit = a.fit;
    if (fit && fit.fittedLogCounts.length >= 2) {
      const y0 = Math.exp(fit.fittedLogCounts[0] ?? Math.log(fit.a));
      const y1 = Math.exp(fit.fittedLogCounts[fit.fittedLogCounts.length - 1] ?? Math.log(fit.a));
      series.push({
        name: `s=${fit.s.toFixed(3)}±${fit.sigma.toFixed(3)}`,
        kind: 'line',
        color: '#f5c464',
        points: [
          { x: fit.rankStart, y: y0 },
          { x: fit.rankEnd, y: y1 },
        ],
      });
    }
    if (series.length > 0) {
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Frequency vs rank (log–log)',
          xLabel: 'rank r',
          yLabel: 'frequency f(r)',
          xScale: 'log',
          yScale: 'log',
          grid: true,
          ticks: 4,
          legend: series.length > 1,
          series,
        } as PlotSpec,
      });
      i += 1;
    }
  }

  // --- panel b: fit residuals over the fitted window --------------------------
  const fit = a.fit;
  if (fit && fit.residuals.length >= 2) {
    const points: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < fit.residuals.length; k += 1) {
      const rank = fit.fittedRanks[k] ?? fit.rankStart + k;
      points.push({ x: rank, y: fit.residuals[k] ?? 0 });
    }
    const series: PlotSeries[] = [
      { name: 'log f − ŷ', kind: 'scatter', color: '#5dd0a8', points },
      {
        name: 'zero',
        kind: 'line',
        color: '#8a97ab',
        dash: [4, 3],
        points: [
          { x: fit.rankStart, y: 0 },
          { x: fit.rankEnd, y: 0 },
        ],
      },
    ];
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `Fit residuals (window r=${fit.rankStart}–${fit.rankEnd}, R²=${fit.r2.toFixed(4)})`,
        xLabel: 'rank r',
        yLabel: 'log f − ŷ',
        xScale: 'log',
        grid: true,
        ticks: 4,
        series,
      } as PlotSpec,
    });
  }

  return panels;
}
