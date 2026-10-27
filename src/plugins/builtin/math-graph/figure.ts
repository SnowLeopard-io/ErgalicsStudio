// ==========================================================================
// math-graph — Figure Studio panels
//
// Pure builder: turns a graph plus the current algorithm results into
// publication-grade PlotSpec panels (no DOM, no store access).
//
// Charts delivered:
//   a. Shortest distances from the source (categorical bars per node).
//   b. Distance convergence: the settled distance against the Dijkstra
//      extraction index (non-decreasing by construction).
//   c. Flow per edge when a maximum-flow algorithm is active.
//   d. Minimum-spanning-tree edge weights when an MST algorithm is active.
//   e. Baseline edge-weight profile of the loaded graph.
// ==========================================================================

import type { PlotSeries, PlotSpec, CategoricalTicks } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { Graph } from './kernel';

export interface GraphFigureInput {
  graph: Graph;
  /** Source node index used for the distance panels. */
  source: number;
  /** Distances from `source` (Infinity = unreachable; skipped in bars). */
  distances?: number[];
  /** Nodes in Dijkstra extraction order (distance-convergence curve). */
  settle?: number[];
  /** Net flow per edge (parallel to `graph.edges`) for the flow panel. */
  flows?: number[];
  /** Edge indices selected by the minimum spanning tree. */
  mstEdges?: number[];
}

function edgeName(graph: Graph, index: number, directed: boolean): string {
  const e = graph.edges[index]!;
  const a = graph.labels[e.u] ?? String(e.u);
  const b = graph.labels[e.v] ?? String(e.v);
  return directed ? `${a}\u2192${b}` : `${a}\u2013${b}`;
}

/** Categorical bar panel: one bar per item, rotated-free short tick labels. */
function barPanel(
  i: number,
  title: string,
  xLabel: string,
  yLabel: string,
  items: Array<{ label: string; y: number }>,
  color: string,
): FigurePanelSpec {
  const bars = items.map((it, k) => ({ x0: k, x1: k + 0.8, y: it.y }));
  const ticks: CategoricalTicks[] = items.map((it, k) => ({ pos: k + 0.4, label: it.label }));
  const series: PlotSeries[] = [{ name: title, kind: 'bar', color, bars }];
  return {
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title,
      xLabel,
      yLabel,
      grid: true,
      ticks: 5,
      legend: false,
      series,
      xDomain: [-0.4, Math.max(0.6, items.length - 0.2)],
      xTicksOverride: ticks,
    } as PlotSpec,
  };
}

export function graphFigurePanels(input: GraphFigureInput): FigurePanelSpec[] {
  const { graph, source, distances, settle, flows, mstEdges } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;
  const nodeName = (idx: number): string => graph.labels[idx] ?? String(idx);

  // --- panel a: shortest distances from the source -------------------------------
  if (distances) {
    const items: Array<{ label: string; y: number }> = [];
    distances.forEach((d, idx) => {
      if (Number.isFinite(d)) items.push({ label: nodeName(idx), y: d });
    });
    if (items.length > 0) {
      panels.push(barPanel(i, `Shortest distances from ${nodeName(source)}`, 'target node', 'distance', items, '#6db4ff'));
      i += 1;
    }
  }

  // --- panel b: Dijkstra settle-order convergence curve --------------------------
  if (settle && distances && settle.length >= 2) {
    const pts: Array<{ x: number; y: number }> = [];
    settle.forEach((node, k) => {
      const d = distances[node]!;
      if (Number.isFinite(d)) pts.push({ x: k, y: d });
    });
    if (pts.length >= 2) {
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Distance convergence (settle order)',
          xLabel: 'extraction index k',
          yLabel: 'settled distance',
          grid: true,
          ticks: 5,
          legend: false,
          series: [{ name: 'settled distance', kind: 'line', color: '#ffb250', points: pts }],
        } as PlotSpec,
      });
      i += 1;
    }
  }

  // --- panel c: flow per edge (maximum-flow algorithms) --------------------------
  if (flows && flows.length === graph.edges.length && flows.length > 0) {
    const items = flows.map((f, idx) => ({ label: edgeName(graph, idx, graph.directed), y: Math.abs(f) }));
    panels.push(barPanel(i, 'Flow per edge', 'edge', 'flow', items, '#4be1c3'));
    i += 1;
  }

  // --- panel d: MST edge weights --------------------------------------------------
  if (mstEdges && mstEdges.length > 0) {
    const items = mstEdges.map((idx) => ({ label: edgeName(graph, idx, false), y: graph.edges[idx]!.w }));
    panels.push(barPanel(i, 'MST edge weights', 'tree edge', 'weight', items, '#f5a623'));
    i += 1;
  }

  // --- panel e: baseline edge-weight profile --------------------------------------
  if (graph.edges.length > 0) {
    const items = graph.edges.map((e, idx) => ({ label: edgeName(graph, idx, graph.directed), y: e.w }));
    panels.push(barPanel(i, 'Edge weights', 'edge', 'weight', items, '#ff7a7a'));
  }

  return panels;
}
