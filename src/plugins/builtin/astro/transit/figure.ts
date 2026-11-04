// ==========================================================================
// astro-transit — Figure Studio panels
//
// Turns a loaded light curve (plus its BLS detection and optional LM fit)
// into publication-grade PlotSpec panels and streams them into the figure
// store's shared sheet via `pushPanelsToFigure`:
//   a. Raw light curve (relative flux vs time) with the trapezoid model
//      overlay when a fit exists.
//   b. Phase-folded view on (P, T0) with binned means and the model over
//      phase — the transit signature condensed to one orbit.
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
import {
  binFolded,
  phaseFold,
  trapezoidFlux,
  type PeriodDetection,
  type TransitFitResult,
  type TransitPoint,
} from './kernel';

export interface TransitFigureInput {
  data: TransitPoint[];
  detection: PeriodDetection | null;
  fit: TransitFitResult | null;
}

/**
 * Build the full Figure Studio panel layout for one transit analysis. Rows
 * are filled row-major; tag letters a, b, c, … label each panel.
 */
export function transitFigurePanels(input: TransitFigureInput): FigurePanelSpec[] {
  const { data, detection, fit } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: raw light curve + trapezoid model overlay --------------------
  if (data.length >= 2) {
    const series: PlotSeries[] = [
      {
        name: 'observed',
        kind: 'scatter',
        color: '#78c8ff',
        points: data.map((d) => ({ x: d.t, y: d.f })),
      },
    ];
    if (fit) {
      let tMin = Infinity;
      let tMax = -Infinity;
      for (const d of data) {
        if (d.t < tMin) tMin = d.t;
        if (d.t > tMax) tMax = d.t;
      }
      if (tMax > tMin) {
        const model: Array<{ x: number; y: number }> = [];
        const steps = 600;
        for (let k = 0; k <= steps; k += 1) {
          const t = tMin + ((tMax - tMin) * k) / steps;
          model.push({ x: t, y: trapezoidFlux(t, fit.params) });
        }
        series.push({ name: 'trapezoid model', kind: 'line', color: '#ff966e', points: model });
      }
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Transit light curve',
        xLabel: 'time / d',
        yLabel: 'relative flux',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: phase-folded view with binned means --------------------------
  const P = fit?.params.P ?? detection?.period;
  const T0 = fit?.params.T0 ?? detection?.epoch;
  if (data.length >= 2 && P !== undefined && T0 !== undefined && P > 0) {
    const folded = phaseFold(data, P, T0);
    const series: PlotSeries[] = [
      {
        name: 'folded points',
        kind: 'scatter',
        color: '#78c8ff',
        points: folded.map((p) => ({ x: p.phase, y: p.f })),
      },
    ];
    const bins = binFolded(folded, 30).filter((b) => b.n > 0 && Number.isFinite(b.mean));
    if (bins.length > 0) {
      series.push({
        name: 'binned means',
        kind: 'scatter',
        color: '#ffeb96',
        points: bins.map((b) => ({ x: b.phase, y: b.mean })),
      });
    }
    if (fit) {
      // Sample the model over one folded period; any reference epoch works
      // because the model is periodic (same convention as the canvas panel).
      const model: Array<{ x: number; y: number }> = [];
      for (let k = 0; k <= 300; k += 1) {
        const phase = -0.5 + k / 300;
        model.push({ x: phase, y: trapezoidFlux(T0 + phase * P, fit.params) });
      }
      series.push({ name: 'model', kind: 'line', color: '#ff966e', points: model });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `Phase-folded (P=${P.toFixed(4)} d)`,
        xLabel: 'phase',
        yLabel: 'relative flux',
        xDomain: [-0.5, 0.5],
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
  }

  return panels;
}
