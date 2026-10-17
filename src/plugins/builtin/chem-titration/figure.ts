// ==========================================================================
// chem-titration — Figure Studio panels
//
// Turns a completed titration-curve solve into publication-grade PlotSpec
// panels and streams them into the figure store's shared sheet via
// `pushPanelsToFigure` (see plugin.ts).
//
// Charts delivered:
//   a. pH vs titrant volume curve with the dashed equivalence-volume line
//      and the equivalence-point marker.
//   b. First derivative dpH/dV (central differences, computed here from the
//      pH curve) whose peak pinpoints the equivalence point.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { TitrationPoint } from './kernel';

export interface TitrationFigureInput {
  curve: TitrationPoint[];
  /** Equivalence volume (mL) for the dashed line + marker. */
  vEq: number;
  /** Numeric pH at the equivalence point. */
  pHeq: number;
}

/**
 * Build the full Figure Studio panel layout for one titration solve. Rows
 * are filled row-major; tag letters a, b, c, … label each panel.
 */
export function titrationFigurePanels(input: TitrationFigureInput): FigurePanelSpec[] {
  const { curve, vEq, pHeq } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  if (curve.length >= 2) {
    // --- panel a: pH(V) curve + equivalence marker --------------------------
    const series: PlotSeries[] = [
      { name: 'pH', kind: 'line', color: '#78beff', points: curve.map((p) => ({ x: p.vBase, y: p.ph })) },
    ];
    if (Number.isFinite(vEq) && vEq > 0) {
      series.push({
        name: 'Ve',
        kind: 'line',
        color: '#ffd26e',
        dash: [4, 4],
        points: [
          { x: vEq, y: 0 },
          { x: vEq, y: 14 },
        ],
      });
      series.push({ name: 'eq. point', kind: 'scatter', color: '#ffd26e', points: [{ x: vEq, y: pHeq }] });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Titration curve pH(V)',
        xLabel: 'V(NaOH) / mL',
        yLabel: 'pH',
        yDomain: [0, 14],
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;

    // --- panel b: first derivative dpH/dV -----------------------------------
    const deriv: Array<{ x: number; y: number }> = [];
    for (let k = 1; k < curve.length; k += 1) {
      const a = curve[k - 1]!;
      const b = curve[k]!;
      const dv = b.vBase - a.vBase;
      if (dv <= 0) continue;
      deriv.push({ x: (a.vBase + b.vBase) / 2, y: (b.ph - a.ph) / dv });
    }
    if (deriv.length >= 2) {
      const dSeries: PlotSeries[] = [
        { name: 'dpH/dV', kind: 'line', color: '#5dd0a8', points: deriv },
      ];
      let peak = deriv[0]!;
      for (const p of deriv) {
        if (p.y > peak.y) peak = p;
      }
      if (peak.y > 0) {
        dSeries.push({ name: 'peak (eq.)', kind: 'scatter', color: '#ff6b6b', points: [{ x: peak.x, y: peak.y }] });
      }
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'First derivative dpH/dV',
          xLabel: 'V(NaOH) / mL',
          yLabel: 'dpH/dV',
          grid: true,
          ticks: 5,
          series: dSeries,
        } as PlotSpec,
      });
    }
  }

  return panels;
}
