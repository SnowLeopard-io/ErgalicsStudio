// ==========================================================================
// math-game — Figure Studio panels
//
// Pure builder: re-runs the kernel dynamics / auction simulation into
// publication-grade PlotSpec panels (no DOM, no store access).
//
// Charts delivered:
//   a. Replicator phase portrait on the unit square: two-population RK4
//      trajectories from a corner/edge seed grid, with the pure (green)
//      and mixed (amber) Nash equilibria overlaid as scatter points.
//   b. Replicator component time series x(t), y(t) from the user's
//      initial mixture (t = k·h).
//   c. Auction revenue distribution: grouped histograms of the first-price,
//      second-price (VCG) and English-clock revenues over one shared
//      seeded valuation sample.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { findNash, integrateReplicator, type NormalFormGame } from './kernel';

export interface GameFigureInput {
  game: NormalFormGame;
  /** Initial mixture + RK4 settings for the time-series panel. */
  replicator: { x0: number; y0: number; h: number; steps: number };
  /** Per-format auction revenues; omit to skip the distribution panel. */
  auction?: { first: number[]; second: number[]; english: number[] } | null;
}

/** Corner/edge seeds for the phase-portrait trajectories (kept sparse). */
const SEEDS: Array<[number, number]> = [
  [0.1, 0.1],
  [0.1, 0.9],
  [0.5, 0.1],
  [0.5, 0.9],
  [0.9, 0.1],
  [0.9, 0.9],
];

function is2x2(game: NormalFormGame): boolean {
  return game.rowPayoffs.length === 2 && game.rowPayoffs[0]?.length === 2;
}

export function gameFigurePanels(input: GameFigureInput): FigurePanelSpec[] {
  const { game, replicator, auction } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  if (is2x2(game)) {
    // --- panel a: replicator phase portrait -----------------------------------
    const portrait: PlotSeries[] = [];
    SEEDS.forEach(([sx, sy], k) => {
      // A 2×2 game has two strategies per population, so a seed is a full
      // distribution ([s, 1−s]) — passing a single number made the RK4 field
      // read a missing second frequency and diverge to NaN on the first step.
      const traj = integrateReplicator(game, [sx, 1 - sx], [sy, 1 - sy], replicator.h, replicator.steps);
      if (traj.length < 2) return;
      portrait.push({
        name: `trajectory ${k + 1}`,
        kind: 'line',
        color: k % 2 === 0 ? '#6db4ff' : '#b48cff',
        points: traj.map((p) => ({ x: p.x[0]!, y: p.y[0]! })),
      });
    });
    const purePts: Array<{ x: number; y: number }> = [];
    const mixedPts: Array<{ x: number; y: number }> = [];
    for (const eq of findNash(game)) {
      const pt = { x: eq.row[0]!, y: eq.col[0]! };
      if (eq.kind === 'pure') purePts.push(pt);
      else mixedPts.push(pt);
    }
    if (purePts.length > 0) portrait.push({ name: 'pure NE', kind: 'scatter', color: '#4be1c3', points: purePts });
    if (mixedPts.length > 0) portrait.push({ name: 'mixed NE', kind: 'scatter', color: '#ffb250', points: mixedPts });
    if (portrait.length > 0) {
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Replicator phase portrait',
          xLabel: 'x (row-1 frequency)',
          yLabel: 'y (col-1 frequency)',
          xDomain: [0, 1],
          yDomain: [0, 1],
          legend: false,
          grid: true,
          ticks: 5,
          series: portrait,
        } as PlotSpec,
      });
      i += 1;
    }

    // --- panel b: component time series from the user's initial mixture --------
    const stream = integrateReplicator(
      game,
      [replicator.x0, 1 - replicator.x0],
      [replicator.y0, 1 - replicator.y0],
      replicator.h,
      replicator.steps,
    );
    if (stream.length >= 2) {
      const xs: Array<{ x: number; y: number }> = [];
      const ys: Array<{ x: number; y: number }> = [];
      stream.forEach((p, k) => {
        xs.push({ x: k * replicator.h, y: p.x[0]! });
        ys.push({ x: k * replicator.h, y: p.y[0]! });
      });
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Replicator time series',
          xLabel: 't (k·h)',
          yLabel: 'strategy frequency',
          xDomain: [0, Math.max(1e-9, (stream.length - 1) * replicator.h)],
          yDomain: [0, 1],
          grid: true,
          ticks: 5,
          series: [
            { name: 'x(t)', kind: 'line', color: '#6db4ff', points: xs },
            { name: 'y(t)', kind: 'line', color: '#ffb250', points: ys },
          ],
        } as PlotSpec,
      });
      i += 1;
    }
  }

  // --- panel c: grouped auction revenue histograms -------------------------------
  if (auction && auction.first.length > 0) {
    const groups: Array<{ name: string; color: string; values: number[] }> = [
      { name: 'First-price', color: '#6db4ff', values: auction.first },
      { name: 'Second-price (VCG)', color: '#ffb250', values: auction.second },
      { name: 'English clock', color: '#4be1c3', values: auction.english },
    ];
    const all = groups.flatMap((g) => g.values).filter((v) => Number.isFinite(v));
    if (all.length >= 2) {
      const lo = Math.min(...all);
      const hi = Math.max(...all);
      const span = hi - lo;
      const bins = 12;
      const width = span > 1e-12 ? span / bins : 1;
      const base = span > 1e-12 ? lo : lo - 0.5;
      const series: PlotSeries[] = groups.map((g, gi) => {
        const sub = width / groups.length;
        const bars: Array<{ x0: number; x1: number; y: number }> = [];
        for (let b = 0; b < bins; b += 1) {
          let count = 0;
          for (const v of g.values) {
            const idx = span > 1e-12 ? Math.min(bins - 1, Math.floor(((v - lo) / span) * bins)) : 0;
            if (idx === b) count += 1;
          }
          const x0 = base + b * width + gi * sub;
          bars.push({ x0, x1: x0 + sub, y: count });
        }
        return { name: g.name, kind: 'bar' as const, color: g.color, bars, points: [] };
      });
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Auction revenue distribution',
          xLabel: 'revenue per auction',
          xDomain: [base, base + bins * width],
          legend: true,
          grid: true,
          ticks: 5,
          series,
        } as PlotSpec,
      });
    }
  }

  return panels;
}
