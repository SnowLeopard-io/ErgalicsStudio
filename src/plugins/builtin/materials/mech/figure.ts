// ==========================================================================
// mats-mech — Figure Studio panels
//
// Turns a completed tensile analysis (stress-strain curve + extracted
// properties) into publication-grade PlotSpec panels and streams them into
// the figure store's shared sheet via `pushPanelsToFigure`.
//
// Charts delivered:
//   a. Engineering stress-strain curve with elastic line, 0.2% offset, and
//      yield / UTS / fracture markers.
//   b. Hollomon log-log view (plastic strain vs stress) with the n-exponent
//      least-squares fit line.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { linreg, type SSPoint, type TensileResult } from './kernel';

export interface MechFigureInput {
  data: SSPoint[];
  result: TensileResult;
}

/**
 * Build the full Figure Studio panel layout for one tensile analysis. Rows
 * are filled row-major; tag letters a, b, c, … label each panel.
 */
export function mechFigurePanels(input: MechFigureInput): FigurePanelSpec[] {
  const { data, result } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: stress-strain curve + elastic / offset lines + markers -----
  if (data.length > 1) {
    const series: PlotSeries[] = [
      { name: 'σ–ε', kind: 'line', color: '#5dd0a8', points: data.map((p) => ({ x: p.strain, y: p.stress })) },
    ];
    const seg = data.slice(result.elasticStart, result.elasticEnd);
    if (seg.length >= 2) {
      const { slope, intercept } = linreg(seg.map((p) => ({ x: p.strain, y: p.stress })));
      if (Number.isFinite(slope)) {
        const e0 = seg[0]!.strain;
        const e1 = seg[seg.length - 1]!.strain;
        series.push({
          name: 'elastic',
          kind: 'line',
          color: '#7ad7ff',
          dash: [5, 4],
          points: [{ x: e0, y: intercept + slope * e0 }, { x: e1, y: intercept + slope * e1 }],
        });
        series.push({
          name: 'σ₀.₂ offset',
          kind: 'line',
          color: '#ffd166',
          dash: [4, 3],
          points: [
            { x: e0 + 0.002, y: intercept + slope * (e0 + 0.002) },
            { x: e1 + 0.002, y: intercept + slope * (e1 + 0.002) },
          ],
        });
      }
    }
    const markers: Array<{ x: number; y: number }> = [];
    if (result.yieldIdx >= 0 && result.yieldIdx < data.length) {
      const p = data[result.yieldIdx]!;
      markers.push({ x: p.strain, y: p.stress });
    }
    if (result.utsIdx >= 0 && result.utsIdx < data.length) {
      const p = data[result.utsIdx]!;
      markers.push({ x: p.strain, y: p.stress });
    }
    if (data.length > 0) {
      const p = data[data.length - 1]!;
      markers.push({ x: p.strain, y: p.stress });
    }
    if (markers.length > 0) {
      series.push({ name: 'yield / UTS / fracture', kind: 'scatter', color: '#ff6b6b', points: markers });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Stress–strain curve',
        xLabel: 'strain ε',
        yLabel: 'stress σ / MPa',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: Hollomon log-log --------------------------------------------
  if (result.yieldIdx >= 0 && result.utsIdx > result.yieldIdx) {
    const pts: Array<{ x: number; y: number }> = [];
    for (let k = result.yieldIdx; k <= result.utsIdx && k < data.length; k += 1) {
      const p = data[k]!;
      const ep = p.strain - p.stress / (result.youngsModulus * 1000 || 1);
      if (ep > 1e-6 && p.stress > 0) pts.push({ x: Math.log(ep), y: Math.log(p.stress) });
    }
    if (pts.length >= 3) {
      const { slope, intercept } = linreg(pts);
      const series: PlotSeries[] = [
        { name: 'plastic', kind: 'scatter', color: '#5dd0a8', points: pts },
      ];
      if (Number.isFinite(slope)) {
        const xMin = Math.min(...pts.map((p) => p.x));
        const xMax = Math.max(...pts.map((p) => p.x));
        series.push({
          name: `n=${slope.toFixed(3)}`,
          kind: 'line',
          color: '#ffd166',
          points: [{ x: xMin, y: intercept + slope * xMin }, { x: xMax, y: intercept + slope * xMax }],
        });
      }
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Hollomon log–log',
          xLabel: 'log(ε_p)',
          yLabel: 'log(σ / MPa)',
          grid: true,
          ticks: 5,
          series,
        } as PlotSpec,
      });
      i += 1;
    }
  }

  return panels;
}
