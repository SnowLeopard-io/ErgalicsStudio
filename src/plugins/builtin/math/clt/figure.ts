// ==========================================================================
// stats-clt — Figure Studio panels
//
// Turns one seeded sampling experiment into publication-grade panels:
//   a. Histogram of the m sample means with the analytic N(μ, σ²/n) overlay
//      (expected count per bin = m · binWidth · pdf).
//   b. Histogram of the standardized means z = (x̄ − μ)/(σ/√n) against the
//      standard normal N(0, 1) — the CLT's "approach to normality" view.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { histogram, normalPdf, standardized, type CltResult, type Histogram } from './kernel';

/** Bars of one kernel Histogram on its natural bin edges. */
function histBars(h: Histogram, color: string, name: string): PlotSeries {
  return {
    name,
    kind: 'histogram',
    color,
    bars: h.centers.map((c, i) => ({
      x0: c - h.binWidth / 2,
      x1: c + h.binWidth / 2,
      y: h.counts[i] ?? 0,
    })),
  };
}

/** Analytic normal overlay on a histogram's count scale. */
function normalOverlay(h: Histogram, m: number, mu: number, sd: number, color: string, name: string): PlotSeries {
  const steps = 240;
  const points: Array<{ x: number; y: number }> = [];
  for (let k = 0; k <= steps; k += 1) {
    const x = h.min + ((h.max - h.min) * k) / steps;
    points.push({ x, y: m * h.binWidth * normalPdf(x, mu, sd) });
  }
  return { name, kind: 'line', color, points };
}

/** Build the full Figure Studio panel layout for one CLT experiment. */
export function cltFigurePanels(res: CltResult): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: sample-mean histogram + N(mu, sigma^2/n) overlay -------------
  if (res.hist.centers.length > 0) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `Sample means (n=${res.n}, m=${res.m})`,
        xLabel: 'sample mean',
        yLabel: 'count',
        grid: true,
        ticks: 5,
        legend: true,
        series: [
          histBars(res.hist, '#78aaf0', 'histogram of means'),
          normalOverlay(res.hist, res.m, res.theory.mean, res.sdOfMean, '#f5c464', 'N(μ, σ²/n)'),
        ],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: standardized means vs N(0, 1) --------------------------------
  const std = standardized(res.means, res.theory.mean, Math.sqrt(Math.max(res.theory.variance, 0)), res.n);
  if (std.length > 0) {
    const stdHist = histogram(std, 40);
    if (stdHist.centers.length > 0) {
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Standardized means vs N(0, 1)',
          xLabel: '(x̄ − μ)/(σ/√n)',
          yLabel: 'count',
          grid: true,
          ticks: 5,
          legend: true,
          series: [
            histBars(stdHist, '#5dd0a8', 'standardized means'),
            normalOverlay(stdHist, res.m, 0, 1, '#ff9f6b', 'N(0, 1)'),
          ],
        } as PlotSpec,
      });
    }
  }

  return panels;
}
