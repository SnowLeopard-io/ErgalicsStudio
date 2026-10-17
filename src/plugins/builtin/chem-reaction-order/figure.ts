// ==========================================================================
// chem-reaction-order — Figure Studio panels
//
// Turns a completed kinetics / Arrhenius analysis into publication-grade
// PlotSpec panels and streams them into the figure store's shared sheet via
// `pushPanelsToFigure` (see plugin.ts).
//
// Charts delivered (kinetics mode):
//   a. [A]–t decay curve.
//   b. The kernel-determined winning linearisation ([A] / ln[A] / 1/[A] vs t)
//      with its OLS fit line and R².
// Charts delivered (Arrhenius mode):
//   a. k vs T scatter.
//   b. ln k vs 1/T with the Arrhenius regression line (slope = −Ea/R).
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import {
  ORDER_TRANSFORMS,
  R_GAS,
  transformY,
  type ArrheniusFit,
  type ArrheniusPoint,
  type OrderAnalysis,
  type SeriesPoint,
  type TableKind,
} from './kernel';

export interface ReactionOrderFigureInput {
  mode: TableKind;
  /** Kinetics report subset (kernel types only). */
  kinetics: { data: SeriesPoint[]; analysis: OrderAnalysis; timeUnit: string } | null;
  /** Arrhenius report subset (kernel types only). */
  arrhenius: { data: ArrheniusPoint[]; fit: ArrheniusFit } | null;
}

/**
 * Build the full Figure Studio panel layout for one analysis. Rows are
 * filled row-major; tag letters a, b, c, … label each panel.
 */
export function reactionOrderFigurePanels(input: ReactionOrderFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  if (input.mode === 'kinetics' && input.kinetics) {
    const { data, analysis, timeUnit } = input.kinetics;
    const pts = data.filter((d) => Number.isFinite(d.t) && Number.isFinite(d.c) && d.c > 0);

    // --- panel a: [A]–t decay ------------------------------------------------
    if (pts.length >= 2) {
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Concentration decay',
          xLabel: `t (${timeUnit})`,
          yLabel: '[A]',
          grid: true,
          ticks: 5,
          series: [
            { name: '[A]', kind: 'line', color: '#78beff', points: pts.map((d) => ({ x: d.t, y: d.c })) },
          ],
        } as PlotSpec,
      });
      i += 1;
    }

    // --- panel b: winning linearisation + OLS fit -----------------------------
    const info = ORDER_TRANSFORMS.find((t) => t.order === analysis.best);
    const fit = analysis.fits[analysis.best];
    if (info && fit && Number.isFinite(fit.slope) && pts.length >= 2) {
      const t0 = pts[0]!.t;
      const t1 = pts[pts.length - 1]!.t;
      const series: PlotSeries[] = [
        {
          name: info.yLabel,
          kind: 'scatter',
          color: '#dce8f6',
          points: pts.map((d) => ({ x: d.t, y: transformY(analysis.best, d.c) })),
        },
      ];
      if (t1 > t0) {
        series.push({
          name: `OLS fit (R²=${fit.r2.toFixed(4)})`,
          kind: 'line',
          color: '#ffd166',
          points: [
            { x: t0, y: fit.intercept + fit.slope * t0 },
            { x: t1, y: fit.intercept + fit.slope * t1 },
          ],
        });
      }
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: `Order-${analysis.best} linearisation`,
          xLabel: `t (${timeUnit})`,
          yLabel: info.yLabel,
          grid: true,
          ticks: 5,
          series,
        } as PlotSpec,
      });
      i += 1;
    }
  } else if (input.mode === 'arrhenius' && input.arrhenius) {
    const { data, fit } = input.arrhenius;
    const pts = data.filter((d) => Number.isFinite(d.T) && Number.isFinite(d.k) && d.T > 0 && d.k > 0);

    // --- panel a: k vs T -------------------------------------------------------
    if (pts.length >= 2) {
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Rate constant vs temperature',
          xLabel: 'T (K)',
          yLabel: 'k',
          grid: true,
          ticks: 5,
          series: [
            { name: 'k(T)', kind: 'scatter', color: '#78beff', points: pts.map((d) => ({ x: d.T, y: d.k })) },
          ],
        } as PlotSpec,
      });
      i += 1;
    }

    // --- panel b: Arrhenius ln k vs 1/T + regression ---------------------------
    if (pts.length >= 2) {
      const xs = pts.map((d) => 1 / d.T);
      const xMin = Math.min(...xs);
      const xMax = Math.max(...xs);
      const slope = (-fit.ea * 1000) / R_GAS;
      const series: PlotSeries[] = [
        {
          name: 'ln k data',
          kind: 'scatter',
          color: '#dce8f6',
          points: pts.map((d) => ({ x: 1 / d.T, y: Math.log(d.k) })),
        },
      ];
      if (xMax > xMin) {
        series.push({
          name: `fit (R²=${fit.r2.toFixed(4)})`,
          kind: 'line',
          color: '#ffb46e',
          points: [
            { x: xMin, y: fit.lnA + slope * xMin },
            { x: xMax, y: fit.lnA + slope * xMax },
          ],
        });
      }
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Arrhenius linearisation',
          xLabel: '1/T (K⁻¹)',
          yLabel: 'ln k',
          grid: true,
          ticks: 5,
          series,
        } as PlotSpec,
      });
      i += 1;
    }
  }

  return panels;
}
