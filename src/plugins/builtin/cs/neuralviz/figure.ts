// ==========================================================================
// neuralviz — Figure Studio panels
//   a. training loss curve.
//   b. dataset scatter coloured by class.
//   c. mean absolute gradient per layer for the selected sample.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import { FIGURE_PANEL_HEIGHT, FIGURE_PANEL_WIDTH, panelPlace, panelTag, type FigurePanelSpec } from '@/core/figure/sheet';
import { backward, type Mlp, type Sample, type TrainResult } from './kernel';

export interface NeuralFigureInput {
  model: Mlp;
  result: TrainResult;
  data: Sample[];
  sample: Sample;
}

export function neuralVizFigurePanels(input: NeuralFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  const losses = input.result.losses;
  panels.push({
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Training loss',
      xLabel: 'epoch',
      yLabel: 'loss',
      grid: true,
      ticks: 6,
      series: [
        {
          name: 'loss',
          kind: 'line',
          color: '#5ee6d0',
          points: losses.map((v, i) => ({ x: i + 1, y: v })),
        },
      ],
    } as PlotSpec,
  });

  panels.push({
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Dataset · amber = class 1, blue = class 0',
      xLabel: 'x₁',
      yLabel: 'x₂',
      grid: true,
      ticks: 6,
      legend: true,
      series: [
        {
          name: 'class 0',
          kind: 'scatter',
          color: '#78c8ff',
          points: input.data.filter((s) => s.y === 0).map((s) => ({ x: s.x[0], y: s.x[1] })),
        },
        {
          name: 'class 1',
          kind: 'scatter',
          color: '#ffd166',
          points: input.data.filter((s) => s.y === 1).map((s) => ({ x: s.x[0], y: s.x[1] })),
        },
      ],
    } as PlotSpec,
  });

  const grad = backward(input.model, input.sample);
  const bars = grad.weights.map((layer, l) => {
    const flat = layer.flat();
    const mean = flat.reduce((s, v) => s + Math.abs(v), 0) / Math.max(1, flat.length);
    return { x0: l, x1: l + 0.8, y: mean };
  });
  panels.push({
    ...panelPlace(2),
    tag: panelTag(2),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Mean |∂L/∂w| per layer',
      xLabel: 'layer',
      yLabel: 'gradient',
      grid: true,
      ticks: 6,
      series: [{ name: 'gradient', kind: 'bar', color: '#b48cff', bars }],
    } as PlotSpec,
  });
  return panels;
}
