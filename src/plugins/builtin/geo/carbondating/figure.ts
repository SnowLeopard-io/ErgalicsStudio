// ==========================================================================
// geo-carbondating — Figure Studio panels
//
// Turns a radiocarbon measurement (and, when loaded, its IntCal20
// calibration) into publication-grade PlotSpec panels:
//   a. ¹⁴C decay curve (fraction remaining F14C vs time) with the measured
//      sample marked at its Libby conventional age.
//   b. Calibration curve segment (F14C vs cal yr BP) with the measured F14C
//      band and the χ²-minimum best fit marked — only when a calibration
//      curve and result are available.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import {
  MEAN_LIFE_14C,
  libbyAgeFromF14C,
  type CalibrationPoint,
  type CalibrationResult,
} from './kernel';

export interface CarbonFigureInput {
  /** Measurement as F14C ± σ. */
  measurement: { f14c: number; sigma: number };
  /** Loaded atmospheric curve (IntCal20 excerpt), when available. */
  curve: CalibrationPoint[] | null;
  /** Likelihood-profile calibration result, when computed. */
  result: CalibrationResult | null;
}

/**
 * Build the full Figure Studio panel layout for one radiocarbon analysis.
 * Rows are filled row-major; tag letters a, b, c, … label each panel.
 */
export function carbonFigurePanels(input: CarbonFigureInput): FigurePanelSpec[] {
  const { measurement, curve, result } = input;
  const panels: FigurePanelSpec[] = [];
  if (!(measurement.f14c > 0) || !Number.isFinite(measurement.f14c)) return panels;
  let i = 0;

  // --- panel a: 14C decay curve with the measured sample marked ---------------
  const age = libbyAgeFromF14C(measurement.f14c);
  if (Number.isFinite(age) && age > 0) {
    const tEnd = Math.min(age * 1.25, 60000);
    const decayPts: Array<{ x: number; y: number }> = [];
    for (let k = 0; k <= 200; k += 1) {
      const t = (tEnd * k) / 200;
      decayPts.push({ x: t, y: Math.exp(-t / MEAN_LIFE_14C) });
    }
    const series: PlotSeries[] = [
      { name: 'F14C decay (Libby t½ 5568 yr)', kind: 'line', color: '#7ad7ff', points: decayPts },
      {
        name: 'measured sample',
        kind: 'scatter',
        color: '#ff6b6b',
        points: [{ x: age, y: measurement.f14c }],
      },
    ];
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Radiocarbon decay curve',
        xLabel: 'time t / yr BP',
        yLabel: 'F14C fraction remaining',
        grid: true,
        ticks: 5,
        legend: true,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: calibration curve + measurement band + best fit ---------------
  if (curve && curve.length >= 2 && result) {
    const curvePts = curve.map((p) => ({ x: p.calBP, y: p.f14c }));
    const series: PlotSeries[] = [
      { name: 'atmospheric curve', kind: 'line', color: '#7ad7ff', points: curvePts },
      {
        name: 'measured F14C ± σ',
        kind: 'line',
        color: '#ffd166',
        dash: [4, 3],
        points: [
          { x: curve[0]!.calBP, y: measurement.f14c },
          { x: curve[curve.length - 1]!.calBP, y: measurement.f14c },
        ],
      },
      {
        name: 'best fit',
        kind: 'scatter',
        color: '#ff6b6b',
        points: [{ x: result.bestFitCalBP, y: measurement.f14c }],
      },
    ];
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Calibration curve (IntCal20)',
        xLabel: 'cal yr BP',
        yLabel: 'F14C',
        grid: true,
        ticks: 5,
        legend: true,
        series,
      } as PlotSpec,
    });
  }

  return panels;
}
