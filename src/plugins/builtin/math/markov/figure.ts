// ==========================================================================
// stats-markov — Figure Studio panels
//
// Publication-grade views of one analysed chain:
//   a. Stationary distribution π as a bar chart with categorical state ticks.
//   b. Power-iteration convergence history (L1 fixed-point residual ‖π·P − π‖₁
//      per iterate, recomputed cheaply from the same P, log y-scale).
//   c. Seeded simulated trajectory as a staircase line (when one exists).
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { stepDistribution } from './kernel';

export interface MarkovFigureInput {
  /** Row-stochastic transition matrix (already normalised). */
  P: number[][];
  labels: string[];
  /** Stationary law from the plugin's power iteration. */
  pi: number[];
  iterations: number;
  /** Simulated state sequence (state indices), if one was generated. */
  trajectory?: number[] | null;
}

/** L1 distance between two distributions. */
function l1(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return s;
}

/** Build the full Figure Studio panel layout for one chain analysis. */
export function markovFigurePanels(input: MarkovFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  const n = input.P.length;
  let i = 0;

  // --- panel a: stationary distribution bars --------------------------------
  if (n >= 2 && input.pi.length === n) {
    const piMax = Math.max(...input.pi, 0.01);
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Stationary distribution π',
        xLabel: 'state',
        yLabel: 'π(i)',
        xDomain: [0.4, n + 0.6],
        yDomain: [0, piMax * 1.15],
        grid: true,
        ticks: 4,
        xTicksOverride: input.labels.map((label, j) => ({ pos: j + 1, label: label.slice(0, 8) })),
        series: [
          {
            name: 'π',
            kind: 'bar',
            color: '#5dd0a8',
            bars: input.pi.map((v, j) => ({ x0: j + 0.7, x1: j + 1.3, y: v })),
          },
        ],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: power-iteration convergence history ---------------------------
  if (n >= 2 && input.iterations >= 1) {
    const residuals: number[] = [];
    let pi = new Array<number>(n).fill(1 / n);
    const maxIter = Math.min(input.iterations, 20000);
    for (let k = 0; k < maxIter; k += 1) {
      pi = stepDistribution(pi, input.P);
      residuals.push(Math.max(l1(stepDistribution(pi, input.P), pi), 1e-16));
    }
    if (residuals.length >= 2) {
      // Stride so huge iteration counts stay SVG-friendly.
      const stride = Math.max(1, Math.ceil(residuals.length / 600));
      const points: Array<{ x: number; y: number }> = [];
      for (let k = 0; k < residuals.length; k += stride) {
        points.push({ x: k + 1, y: residuals[k]! });
      }
      const last = residuals.length - 1;
      if (points[points.length - 1]!.x !== last + 1) {
        points.push({ x: last + 1, y: residuals[last]! });
      }
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Power-iteration convergence',
          xLabel: 'iteration',
          yLabel: 'L1 residual ‖π·P − π‖₁',
          yScale: 'log',
          grid: true,
          ticks: 4,
          series: [{ name: 'residual', kind: 'line', color: '#7ad7ff', points }],
        } as PlotSpec,
      });
      i += 1;
    }
  }

  // --- panel c: simulated trajectory staircase --------------------------------
  const traj = input.trajectory;
  if (traj && traj.length >= 2) {
    const points: Array<{ x: number; y: number }> = [];
    for (let s = 0; s < traj.length; s += 1) {
      const st = traj[s] ?? 0;
      if (s === 0) points.push({ x: 0, y: st });
      else {
        points.push({ x: s, y: traj[s - 1] ?? st });
        points.push({ x: s, y: st });
      }
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Simulated trajectory',
        xLabel: 'step',
        yLabel: 'state',
        xDomain: [0, traj.length - 1],
        yDomain: [0, Math.max(1, n - 1)],
        grid: true,
        ticks: 4,
        series: [{ name: 'state(t)', kind: 'line', color: '#ffd166', points }],
      } as PlotSpec,
    });
  }

  return panels;
}
