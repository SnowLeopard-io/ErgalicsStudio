// ==========================================================================
// physics-schrodinger — Figure Studio panels
//
// Turns the 1-D stationary Schrödinger solve (and an optional Crank–Nicolson
// packet snapshot) into publication-grade PlotSpec panels and streams them
// into the figure store's shared sheet via `pushPanelsToFigure` (see
// plugin.ts).
//
// Charts delivered:
//   a. (optional) |ψ(x,t)|² packet snapshot from the dynamics mode.
//   b. Selected eigenstate ψ_n(x) (unit-max normalised) plus |ψ_n|² when the
//      density toggle is on.
//   c. Potential landscape V(x).
//   d. Energy-level diagram E_n vs state index with the analytic reference
//      levels (where closed forms exist) as a second scatter.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { analyticLevels, type PotentialKind, type PotentialParams, type StationaryResult } from './kernel';

/** Number of levels shown in the energy-level diagram. */
const SHOWN_LEVELS = 10;

export interface SchrodingerFigureInput {
  sol: StationaryResult;
  /** Selected level (0-based). */
  level: number;
  /** Also draw the probability density |ψ_n|² (normalised). */
  showDensity: boolean;
  kind: PotentialKind;
  params: PotentialParams;
  /** Optional Crank–Nicolson packet snapshot: |ψ(x,t)|² on the dynamics grid. */
  packet?: { t: number; x: Float64Array; density: number[] };
}

/**
 * Build the full Figure Studio panel layout for one solve. Rows are filled
 * row-major; tag letters a, b, c, … label each panel.
 */
export function schrodingerFigurePanels(input: SchrodingerFigureInput): FigurePanelSpec[] {
  const { sol, level, showDensity, kind, params, packet } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel: wave-packet snapshot (dynamics mode) ---------------------------
  if (packet && packet.x.length === packet.density.length && packet.density.length >= 2) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `|ψ(x,t)|² · t=${packet.t.toFixed(3)}`,
        xLabel: 'x',
        yLabel: '|ψ|²',
        grid: true,
        ticks: 5,
        series: [
          {
            name: '|ψ|²',
            kind: 'line',
            color: '#7ad7ff',
            points: packet.density.map((d, k) => ({ x: packet.x[k]!, y: d })),
          },
        ],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel: selected eigenstate ψ_n (and |ψ_n|²) -----------------------------
  const lv = Math.min(Math.max(level, 0), sol.psi.length - 1, sol.energies.length - 1);
  const psi = sol.psi[lv];
  if (psi && psi.length >= 2) {
    let psiMax = 1e-12;
    for (let k = 0; k < psi.length; k += 1) psiMax = Math.max(psiMax, Math.abs(psi[k]!));
    const series: PlotSeries[] = [
      {
        name: `ψ_${lv + 1} (norm.)`,
        kind: 'line',
        color: '#78dcbe',
        points: Array.from(sol.x, (xv, k) => ({ x: xv, y: psi[k]! / psiMax })),
      },
    ];
    if (showDensity) {
      const densMax = psiMax * psiMax;
      series.push({
        name: `|ψ_${lv + 1}|² (norm.)`,
        kind: 'line',
        color: '#b48cff',
        dash: [4, 3],
        points: Array.from(sol.x, (xv, k) => ({ x: xv, y: (psi[k]! * psi[k]!) / densMax })),
      });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `Eigenstate n=${lv + 1}`,
        xLabel: 'x',
        yLabel: 'ψ (norm.)',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel: potential landscape V(x) ------------------------------------------
  if (sol.x.length >= 2) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Potential V(x)',
        xLabel: 'x',
        yLabel: 'V (a.u.)',
        grid: true,
        ticks: 5,
        series: [
          {
            name: 'V(x)',
            kind: 'line',
            color: '#facd78',
            points: Array.from(sol.x, (xv, k) => ({ x: xv, y: sol.V[k]! })),
          },
        ],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel: energy-level diagram E_n vs n --------------------------------------
  const count = Math.min(SHOWN_LEVELS, sol.energies.length);
  if (count >= 2) {
    const numeric: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < count; k += 1) numeric.push({ x: k + 1, y: sol.energies[k]! });
    const series: PlotSeries[] = [
      { name: 'E_n (finite diff.)', kind: 'scatter', color: '#7ad7ff', points: numeric },
    ];
    const ref = analyticLevels(kind, params, count);
    const analytic: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < count; k += 1) {
      const r = ref[k];
      if (typeof r === 'number' && Number.isFinite(r)) analytic.push({ x: k + 1, y: r });
    }
    if (analytic.length > 0) {
      series.push({ name: 'E_n (analytic)', kind: 'scatter', color: '#ffd166', points: analytic });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Energy levels',
        xLabel: 'level n',
        yLabel: 'E (a.u.)',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
  }

  return panels;
}
