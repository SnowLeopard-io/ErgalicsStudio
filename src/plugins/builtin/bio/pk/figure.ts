// ==========================================================================
// bio-pk — Figure Studio panels
//
// Turns a completed pharmacokinetic simulation into publication-grade
// PlotSpec panels:
//   a. Plasma concentration–time curve (RK4 numeric) with the analytic
//      closed form overlaid as a dashed reference, optional semilog-y.
//   b. Oral route only: compartment amounts (gut / central / peripheral)
//      overlaid on one panel.
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
  macroRates,
  oneCompIvConc,
  oneCompOralConc,
  simulatePk,
  twoCompIvAmount,
  twoCompOralAmount,
  type PkParams,
} from './kernel';

export interface PkFigureInput {
  params: PkParams;
  /** Simulated span (h). */
  tMax: number;
  /** Render the plasma panel with a log y-axis. */
  logScale: boolean;
}

/** Closed-form reference concentration C(t), or null for degenerate parameters. */
function analyticRef(p: PkParams): ((t: number) => number) | null {
  if (p.model === 'one-compartment' && p.route === 'iv-bolus') {
    return (t) => oneCompIvConc(t, p.dose, p.volume, p.ke);
  }
  if (p.model === 'one-compartment' && p.route === 'oral') {
    return (t) => oneCompOralConc(t, p.dose, p.volume, p.ke, p.ka);
  }
  const { alpha, beta } = macroRates(p.ke, p.k12, p.k21);
  if (Math.abs(alpha - beta) < 1e-12) return null;
  if (p.route === 'iv-bolus') {
    return (t) => twoCompIvAmount(t, p.dose, p.ke, p.k12, p.k21) / p.volume;
  }
  return (t) => twoCompOralAmount(t, p.dose, p.ke, p.k12, p.k21, p.ka) / p.volume;
}

/**
 * Build the full Figure Studio panel layout for one PK simulation. Rows are
 * filled row-major; tag letters a, b, c, … label each panel.
 */
export function pkFigurePanels(input: PkFigureInput): FigurePanelSpec[] {
  const { params, tMax, logScale } = input;
  const panels: FigurePanelSpec[] = [];
  const s = simulatePk(params, tMax, tMax / 600);
  if (s.times.length < 2) return panels;
  let i = 0;

  // --- panel a: plasma concentration–time curve ------------------------------
  const useLog = logScale;
  const keep = (c: number): boolean => Number.isFinite(c) && (!useLog || c > 0);
  const numericPts = s.times
    .map((t, k) => ({ x: t, y: s.concentration[k]! }))
    .filter((p) => keep(p.y));
  if (numericPts.length >= 2) {
    const series: PlotSeries[] = [
      { name: 'RK4 numeric', kind: 'line', color: '#7ad7ff', points: numericPts },
    ];
    const ref = analyticRef(params);
    if (ref) {
      const refPts: Array<{ x: number; y: number }> = [];
      for (let k = 0; k <= 240; k += 1) {
        const t = (tMax * k) / 240;
        const c = ref(t);
        if (keep(c)) refPts.push({ x: t, y: c });
      }
      if (refPts.length >= 2) {
        series.push({ name: 'analytic', kind: 'line', color: '#f0aa6e', dash: [5, 4], points: refPts });
      }
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Plasma concentration–time',
        xLabel: 'time t / h',
        yLabel: 'C / mg/L',
        yScale: useLog ? 'log' : undefined,
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: oral compartment amounts overlay -----------------------------
  if (params.route === 'oral') {
    const series: PlotSeries[] = [
      {
        name: 'gut A_gi',
        kind: 'line',
        color: '#5dd0a8',
        points: s.times.map((t, k) => ({ x: t, y: s.gut[k]! })),
      },
      {
        name: 'central A1',
        kind: 'line',
        color: '#7ad7ff',
        points: s.times.map((t, k) => ({ x: t, y: s.concentration[k]! * params.volume })),
      },
    ];
    if (params.model === 'two-compartment') {
      series.push({
        name: 'peripheral A2',
        kind: 'line',
        color: '#f0aa6e',
        points: s.times.map((t, k) => ({ x: t, y: s.peripheral[k]! })),
      });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Compartment amounts (oral)',
        xLabel: 'time t / h',
        yLabel: 'amount / mg',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  return panels;
}
