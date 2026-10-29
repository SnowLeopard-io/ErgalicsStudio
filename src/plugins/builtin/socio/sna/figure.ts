// ==========================================================================
// socio-sna — Figure Studio panels
//
// Turns the current social-network state into publication-grade PlotSpec
// panels:
//   a. Top-N centrality ranking (bar chart).
//   b. Cascade adoption curve (adopted fraction per step).
//   c. Adjacency matrix field, nodes ordered by community when available.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';

export interface SnaFigureInput {
  /** Node labels, index = node id. */
  labels: string[];
  /** Row-major n x n adjacency (0 / weight), same node order as labels. */
  adjacency: number[];
  n: number;
  /** Community id per node, or null when not computed. */
  communityOf: ArrayLike<number> | null;
  /** Centrality values of the ranked top-N nodes (already sorted desc). */
  ranked: Array<{ id: number; value: number }>;
  /** Adopted count per cascade step, or null when no cascade ran. */
  cascadeSeries: number[] | null;
}

/** Low-saturation academic palette. */
const ACCENT = '#7da7d9';
const SAGE = '#8fbf9f';

/** Max nodes for a legible matrix panel; larger networks are strided. */
const MAX_MATRIX_NODES = 120;

/**
 * Build the Figure Studio panel layout for the current network state.
 * Rows are filled row-major; tag letters a, b, c, … label each panel.
 */
export function snaFigurePanels(input: SnaFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: top-N centrality ranking (bar chart) --------------------------
  if (input.ranked.length > 0) {
    const maxV = Math.max(...input.ranked.map((r) => r.value), 1e-12);
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Centrality ranking (top-N)',
        xLabel: 'node',
        yLabel: 'centrality',
        grid: true,
        ticks: 4,
        xDomain: [-0.5, input.ranked.length - 0.5],
        yDomain: [0, maxV * 1.08],
        xTicksOverride: input.ranked.map((r, k) => ({ pos: k, label: input.labels[r.id] ?? String(r.id) })),
        series: [
          {
            name: 'centrality',
            kind: 'bar',
            color: ACCENT,
            bars: input.ranked.map((r, k) => ({ x0: k - 0.4, x1: k + 0.4, y: r.value })),
          },
        ],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: cascade adoption curve ----------------------------------------
  if (input.cascadeSeries && input.cascadeSeries.length >= 2) {
    const total = Math.max(1, input.n);
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Cascade adoption curve',
        xLabel: 'step',
        yLabel: 'adopted fraction',
        grid: true,
        ticks: 5,
        yDomain: [0, 1],
        series: [
          {
            name: 'adopted / n',
            kind: 'line',
            color: SAGE,
            points: input.cascadeSeries.map((v, t) => ({ x: t, y: Math.min(1, v / total) })),
          },
        ],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel c: adjacency / community matrix field ------------------------------
  if (input.n >= 2) {
    const stride = Math.max(1, Math.ceil(input.n / MAX_MATRIX_NODES));
    const idx: number[] = [];
    if (input.communityOf) {
      // Order nodes by community id (ties keep node order) for a block-diagonal look.
      const order = Array.from({ length: input.n }, (_, v) => v).sort(
        (a, b) => input.communityOf![a]! - input.communityOf![b]! || a - b,
      );
      for (let v = 0; v < order.length; v += stride) idx.push(order[v]!);
    } else {
      for (let v = 0; v < input.n; v += stride) idx.push(v);
    }
    const k = idx.length;
    const values = new Array<number>(k * k).fill(0);
    const pos = new Map<number, number>();
    idx.forEach((v, r) => pos.set(v, r));
    for (let r = 0; r < k; r += 1) {
      for (let c = 0; c < k; c += 1) {
        values[r * k + c] = input.adjacency[idx[r]! * input.n + idx[c]!] ?? 0;
      }
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: input.communityOf ? 'Adjacency matrix (community-ordered)' : 'Adjacency matrix',
        xLabel: 'node',
        yLabel: 'node',
        series: [
          {
            name: 'A_ij',
            kind: 'field',
            color: ACCENT,
            field: {
              values,
              rows: k,
              cols: k,
              domain: [0, 1],
            },
          },
        ],
      } as PlotSpec,
    });
  }

  return panels;
}
