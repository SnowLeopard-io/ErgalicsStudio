// ==========================================================================
// physics-ising — Figure Studio panels
//
// Pure builder: turns the recorded temperature sweep into publication-grade
// PlotSpec panels (no DOM, no store access).
//
// Charts delivered:
//   a. Mean magnetization ⟨|m|⟩ vs T with the exact Onsager spontaneous-
//      magnetization curve overlaid (H = 0 only).
//   b. Energy per spin E/N vs T.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { onsagerMagnetization } from './kernel';

/** One recorded sweep point (structural twin of the plugin's ScanPoint). */
export interface IsingScanPoint {
  T: number;
  chi: number;
  heat: number;
  binder: number;
  absM: number;
  energy: number;
  algorithm: 'metropolis' | 'wolff';
}

export interface IsingFigureInput {
  scan: IsingScanPoint[];
  J: number;
  /** External field; the Onsager overlay is exact only for H = 0. */
  H: number;
}

export function isingFigurePanels(input: IsingFigureInput): FigurePanelSpec[] {
  const { scan, J, H } = input;
  const panels: FigurePanelSpec[] = [];
  if (scan.length < 2) return panels;
  let i = 0;

  // --- panel a: magnetization curve with the Onsager reference ------------------
  const mSeries: PlotSeries[] = [
    {
      name: '⟨|m|⟩ (MC)',
      kind: 'line',
      color: '#78dcbe',
      points: scan.map((q) => ({ x: q.T, y: q.absM })),
    },
  ];
  if (H === 0) {
    const tMin = scan[0]!.T;
    const tMax = scan[scan.length - 1]!.T;
    const refPts: Array<{ x: number; y: number }> = [];
    const steps = 120;
    for (let k = 0; k <= steps; k++) {
      const T = tMin + ((tMax - tMin) * k) / steps;
      refPts.push({ x: T, y: onsagerMagnetization(T, J) });
    }
    mSeries.push({ name: 'Onsager exact', kind: 'line', color: '#ffd166', dash: [5, 4], points: refPts });
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Mean magnetization vs temperature',
      xLabel: 'T / (J/k_B)',
      yLabel: '⟨|m|⟩',
      grid: true,
      ticks: 5,
      series: mSeries,
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: energy per spin ---------------------------------------------------
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Energy per spin vs temperature',
      xLabel: 'T / (J/k_B)',
      yLabel: 'E / N',
      grid: true,
      ticks: 5,
      series: [
        {
          name: 'E/N (MC)',
          kind: 'line',
          color: '#b48cff',
          points: scan.map((q) => ({ x: q.T, y: q.energy })),
        },
      ],
    } as PlotSpec,
  });
  i += 1;

  return panels;
}
