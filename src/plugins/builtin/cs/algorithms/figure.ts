// ==========================================================================
// algorithms — Figure Studio panels
//   a. comparisons and swaps for each sort on the active input.
//   b. BFS / Dijkstra distance profile from the start node.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import { FIGURE_PANEL_HEIGHT, FIGURE_PANEL_WIDTH, panelPlace, panelTag, type FigurePanelSpec } from '@/core/figure/sheet';
import type { GraphTrace } from './kernel';

export interface AlgorithmsFigureInput {
  input: number[];
  comparison: Array<{ id: string; label: string; comparisons: number; swaps: number }>;
  graph: GraphTrace;
  graphLabel: string;
  graphNodes: string[];
}

export function algorithmsFigurePanels(input: AlgorithmsFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  const cw = Math.max(1, ...input.comparison.map((c) => c.comparisons));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Sort work on n=${input.input.length}`,
      xLabel: 'algorithm',
      yLabel: 'count',
      grid: true,
      ticks: 6,
      xTicksOverride: input.comparison.map((c, j) => ({ pos: j + 0.4, label: c.label })),
      xDomain: [-0.2, input.comparison.length],
      series: [
        {
          name: 'comparisons',
          kind: 'bar',
          color: '#78c8ff',
          bars: input.comparison.map((c, j) => ({ x0: j, x1: j + 0.38, y: c.comparisons })),
        },
        {
          name: 'swaps / writes',
          kind: 'bar',
          color: '#ffd166',
          bars: input.comparison.map((c, j) => ({ x0: j + 0.42, x1: j + 0.8, y: c.swaps })),
        },
      ],
    } as PlotSpec,
  });
  i += 1;

  const distances = input.graphNodes.map((node, j) => ({
    x: j,
    y: Number.isFinite(input.graph.distances[node]!) ? input.graph.distances[node]! : cw,
  }));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `${input.graphLabel} distances from A`,
      xLabel: 'node',
      yLabel: 'distance',
      grid: true,
      ticks: 6,
      xTicksOverride: input.graphNodes.map((node, j) => ({ pos: j, label: node })),
      xDomain: [-0.5, input.graphNodes.length - 0.5],
      series: [{ name: input.graphLabel, kind: 'line', color: '#5ee6d0', points: distances }],
    } as PlotSpec,
  });
  return panels;
}
