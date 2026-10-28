// ==========================================================================
// datastructures — Figure Studio panels
//   a. tree node layout (x = in-order slot, y = depth).
//   b. height after each operation.
//   c. heap array values or hash-bucket chain lengths.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import { FIGURE_PANEL_HEIGHT, FIGURE_PANEL_WIDTH, panelPlace, panelTag, type FigurePanelSpec } from '@/core/figure/sheet';
import { layoutTree, type HashResult, type TreeStep, type TreeNode } from './kernel';

export interface DataStructureFigureInput {
  kind: 'bst' | 'avl' | 'heap' | 'hash';
  steps: TreeStep[];
  tree: TreeNode | null;
  heap: number[];
  hash: HashResult;
}

export function dataStructureFigurePanels(input: DataStructureFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  const layout = layoutTree(input.tree);
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: input.tree ? `${input.kind.toUpperCase()} layout (${layout.nodes.length} nodes)` : `${input.kind.toUpperCase()} (empty)`,
      xLabel: 'in-order slot',
      yLabel: 'depth',
      grid: true,
      ticks: 5,
      legend: false,
      series: [
        {
          name: 'nodes',
          kind: 'scatter',
          color: '#78c8ff',
          points: layout.nodes.map((n) => ({ x: n.x, y: -n.y })),
        },
      ],
    } as PlotSpec,
  });
  i += 1;

  const heights = input.steps.map((s) => ({ x: s.index + 1, y: s.height }));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Height after each operation',
      xLabel: 'operation',
      yLabel: 'height',
      grid: true,
      ticks: 6,
      series: [{ name: 'height', kind: 'line', color: '#5ee6d0', points: heights }],
    } as PlotSpec,
  });
  i += 1;

  const bars =
    input.kind === 'hash'
      ? input.hash.buckets.map((b, j) => ({ x0: j, x1: j + 0.8, y: b.length }))
      : input.heap.map((_, j) => ({ x0: j, x1: j + 0.8, y: input.heap[j]! }));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: input.kind === 'hash' ? 'Hash bucket chain lengths' : 'Heap array values',
      xLabel: input.kind === 'hash' ? 'bucket' : 'index',
      yLabel: input.kind === 'hash' ? 'chain' : 'value',
      grid: true,
      ticks: 6,
      series: [{ name: input.kind, kind: 'bar', color: '#ffd166', bars }],
    } as PlotSpec,
  });
  return panels;
}
