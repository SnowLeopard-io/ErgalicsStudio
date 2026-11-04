// ==========================================================================
// math-odefield — Figure Studio panels
//
// Pure builder: re-integrates the compiled vector field into publication-
// grade PlotSpec panels (no DOM, no store access).
//
// Charts delivered:
//   a. Phase portrait on the square window [−span, span]²: RK4 streamlines
//      from a 4×4 seed grid integrated in both time directions (stopped at
//      the view boundary), with the Newton equilibria overlaid as scatter
//      points colored by their Jacobian classification.
//   b. Component time series x(t), y(t) of the forward integration from the
//      seed nearest the origin (t = k·h; integrateStream carries no clock).
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { integrateStream, type EquilibriumKind, type Stability, type VectorField } from './kernel';

export interface OdefieldEquilibrium {
  x: number;
  y: number;
  kind: EquilibriumKind;
  stability: Stability;
}

export interface OdefieldFigureInput {
  f: VectorField;
  /** RK4 step size. */
  h: number;
  /** RK4 steps per direction. */
  steps: number;
  /** View half-span; panels use the square window [−span, span]². */
  span: number;
  equilibria: OdefieldEquilibrium[];
}

/** Seed-grid side for the figure phase portrait (kept small for readability). */
const SEED_GRID = 4;

/** Marker colors mirror the canvas classification glyphs. */
function equilibriumColor(eq: OdefieldEquilibrium): string {
  switch (eq.kind) {
    case 'saddle':
      return '#f5a623';
    case 'center':
      return '#4be1c3';
    case 'node':
    case 'spiral':
      return eq.stability === 'sink' ? '#6db4ff' : '#ff7a7a';
    default:
      return '#c8d2e1';
  }
}

function equilibriumLabel(eq: OdefieldEquilibrium): string {
  if (eq.kind === 'node' || eq.kind === 'spiral') {
    return `${eq.kind} (${eq.stability === 'sink' ? 'sink' : 'source'})`;
  }
  return eq.kind;
}

export function odefieldFigurePanels(input: OdefieldFigureInput): FigurePanelSpec[] {
  const { f, h, steps, span, equilibria } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- seed grid shared by both panels (sorted by distance from the origin) ----
  const seeds: Array<{ x: number; y: number }> = [];
  for (let a = 0; a < SEED_GRID; a += 1) {
    for (let b = 0; b < SEED_GRID; b += 1) {
      seeds.push({
        x: -span + ((a + 0.5) * 2 * span) / SEED_GRID,
        y: -span + ((b + 0.5) * 2 * span) / SEED_GRID,
      });
    }
  }
  seeds.sort((p, q) => Math.hypot(p.x, p.y) - Math.hypot(q.x, q.y));
  const usable = seeds.filter((s) => {
    const [vx, vy] = f(s.x, s.y);
    return Number.isFinite(vx) && Number.isFinite(vy) && Math.hypot(vx, vy) >= 1e-9;
  });

  // --- panel a: phase portrait -----------------------------------------------------
  const portrait: PlotSeries[] = [];
  let idx = 0;
  for (const s of usable) {
    // bound = span keeps every returned point inside the view window.
    const fwd = integrateStream(f, s.x, s.y, h, steps, span);
    if (fwd.length >= 2) {
      idx += 1;
      portrait.push({
        name: `streamline ${idx}`,
        kind: 'line',
        color: '#6db4ff',
        points: fwd.map((p) => ({ x: p.x, y: p.y })),
      });
    }
    const bwd = integrateStream(f, s.x, s.y, -h, steps, span);
    if (bwd.length >= 2) {
      idx += 1;
      portrait.push({
        name: `streamline ${idx}`,
        kind: 'line',
        color: '#b48cff',
        points: bwd.map((p) => ({ x: p.x, y: p.y })),
      });
    }
  }
  // Equilibria grouped by classification so each group gets one legend entry.
  const groups = new Map<string, { color: string; label: string; pts: Array<{ x: number; y: number }> }>();
  for (const eq of equilibria) {
    const key = `${eq.kind}:${eq.stability}`;
    let g = groups.get(key);
    if (!g) {
      g = { color: equilibriumColor(eq), label: equilibriumLabel(eq), pts: [] };
      groups.set(key, g);
    }
    g.pts.push({ x: eq.x, y: eq.y });
  }
  for (const g of groups.values()) {
    portrait.push({ name: g.label, kind: 'scatter', color: g.color, points: g.pts });
  }
  if (portrait.length > 0) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Phase portrait',
        xLabel: 'x',
        yLabel: 'y',
        xDomain: [-span, span],
        yDomain: [-span, span],
        legend: false,
        grid: true,
        ticks: 5,
        series: portrait,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: component time series from the seed nearest the origin -------------
  if (usable.length > 0) {
    const s0 = usable[0]!;
    const stream = integrateStream(f, s0.x, s0.y, h, steps);
    if (stream.length >= 2) {
      const xs: Array<{ x: number; y: number }> = [];
      const ys: Array<{ x: number; y: number }> = [];
      stream.forEach((p, k) => {
        xs.push({ x: k * h, y: p.x });
        ys.push({ x: k * h, y: p.y });
      });
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Component time series',
          xLabel: 't (k·h)',
          yLabel: 'x, y',
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

  return panels;
}
