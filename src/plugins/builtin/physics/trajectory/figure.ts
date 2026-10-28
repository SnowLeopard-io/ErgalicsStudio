// ==========================================================================
// physics-trajectory — Figure Studio panels
//
// Pure builder: turns the loaded trajectory, its linearized projectile fit
// and the mechanical-energy decomposition into publication-grade PlotSpec
// panels (no DOM, no store access).
//
// Charts delivered:
//   a. Trajectory y(x) (or the 1-D track x(t)) with the fitted parabola
//      (or linear fit) overlaid as a dashed reference.
//   b. Mechanical-energy decomposition KE / PE / total vs time.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { EnergySeries, ProjectileFit, Trajectory } from './kernel';

export interface TrajectoryFigureInput {
  traj: Trajectory;
  fit: ProjectileFit;
  energy: EnergySeries;
  /** Gravity used by the fit (m/s²). */
  g: number;
}

export function trajectoryFigurePanels(input: TrajectoryFigureInput): FigurePanelSpec[] {
  const { traj, fit, energy, g } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;
  const T = traj.t[traj.t.length - 1]!;
  const hasY = traj.y !== null;

  // --- panel a: trajectory with the linearized projectile fit overlay -----------
  const trajSeries: PlotSeries[] = [];
  if (hasY) {
    trajSeries.push({
      name: 'y(x)',
      kind: 'line',
      color: '#6db4ff',
      points: traj.x.map((x, k) => ({ x, y: traj.y![k]! })),
    });
    const fitPts: Array<{ x: number; y: number }> = [];
    for (let k = 0; k <= 100; k++) {
      const tt = (T * k) / 100;
      fitPts.push({ x: fit.vx * tt + fit.x0, y: fit.vy! * tt + fit.y0! - 0.5 * g * tt * tt });
    }
    trajSeries.push({ name: 'fitted parabola', kind: 'line', color: '#ffd166', dash: [5, 4], points: fitPts });
  } else {
    trajSeries.push({
      name: 'x(t)',
      kind: 'line',
      color: '#6db4ff',
      points: traj.t.map((t, k) => ({ x: t, y: traj.x[k]! })),
    });
    trajSeries.push({
      name: 'linear fit',
      kind: 'line',
      color: '#ffd166',
      dash: [5, 4],
      points: [
        { x: 0, y: fit.x0 },
        { x: T, y: fit.vx * T + fit.x0 },
      ],
    });
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: hasY ? 'Trajectory y(x) with projectile fit' : 'Track x(t) with linear fit',
      xLabel: hasY ? 'x / m' : 't / s',
      yLabel: hasY ? 'y / m' : 'x / m',
      grid: true,
      ticks: 5,
      series: trajSeries,
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: mechanical-energy decomposition vs time --------------------------
  const enSeries: PlotSeries[] = [
    { name: 'KE', kind: 'line', color: '#6db4ff', points: traj.t.map((t, k) => ({ x: t, y: energy.ke[k]! })) },
  ];
  if (energy.pe) {
    enSeries.push({
      name: 'PE',
      kind: 'line',
      color: '#ffb250',
      points: traj.t.map((t, k) => ({ x: t, y: energy.pe![k]! })),
    });
  }
  if (energy.total) {
    enSeries.push({
      name: 'total E',
      kind: 'line',
      color: '#5dd0a8',
      points: traj.t.map((t, k) => ({ x: t, y: energy.total![k]! })),
    });
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Mechanical energy vs time',
      xLabel: 't / s',
      yLabel: 'E / J',
      grid: true,
      ticks: 5,
      series: enSeries,
    } as PlotSpec,
  });
  i += 1;

  return panels;
}
