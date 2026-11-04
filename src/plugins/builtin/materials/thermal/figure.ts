// ==========================================================================
// mats-thermal — Figure Studio panels
//
// Turns a completed thermal analysis (DSC / TGA curve + baseline + detected
// transitions) into publication-grade PlotSpec panels and streams them into
// the figure store's shared sheet via `pushPanelsToFigure`.
//
// Charts delivered:
//   a. Thermal curve (T vs signal) with the estimated baseline and transition
//      onset / peak markers.
//   b. Derivative curve (DTG for TGA, d(signal)/dT for DSC).
//   c. Transition integrals bar chart (ΔH for DSC, mass loss for TGA).
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { derivative, type ThermalAnalysis, type ThermalMode, type ThermalPoint } from './kernel';

export interface ThermalFigureInput {
  data: ThermalPoint[];
  baseline: number[];
  analysis: ThermalAnalysis;
  mode: ThermalMode;
}

/** Find the data point whose temperature is nearest to the target. */
function nearestPoint(data: ThermalPoint[], target: number): ThermalPoint | null {
  if (data.length === 0) return null;
  let best = data[0]!;
  for (const d of data) {
    if (Math.abs(d.temperature - target) < Math.abs(best.temperature - target)) best = d;
  }
  return best;
}

/**
 * Build the full Figure Studio panel layout for one thermal analysis. Rows
 * are filled row-major; tag letters a, b, c, … label each panel.
 */
export function thermalFigurePanels(input: ThermalFigureInput): FigurePanelSpec[] {
  const { data, baseline, analysis, mode } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- panel a: thermal curve + baseline + transition markers ---------------
  if (data.length > 1) {
    const series: PlotSeries[] = [
      {
        name: mode === 'dsc' ? 'heat flow' : 'mass',
        kind: 'line',
        color: '#5dd0a8',
        points: data.map((p) => ({ x: p.temperature, y: p.signal })),
      },
    ];
    if (baseline.length === data.length) {
      series.push({
        name: 'baseline',
        kind: 'line',
        color: '#7ad7ff',
        dash: [4, 3],
        points: data.map((p, j) => ({ x: p.temperature, y: baseline[j]! })),
      });
    }
    if (analysis.peaks.length > 0) {
      const onsetPts: Array<{ x: number; y: number }> = [];
      const peakPts: Array<{ x: number; y: number }> = [];
      for (const p of analysis.peaks) {
        const dp = nearestPoint(data, p.onsetTemp);
        if (dp) onsetPts.push({ x: p.onsetTemp, y: dp.signal });
        const pp = nearestPoint(data, p.peakTemp);
        if (pp) peakPts.push({ x: p.peakTemp, y: pp.signal });
      }
      if (onsetPts.length > 0) series.push({ name: 'onset', kind: 'scatter', color: '#ffd166', points: onsetPts });
      if (peakPts.length > 0) series.push({ name: 'peak', kind: 'scatter', color: '#ff6b6b', points: peakPts });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: mode === 'dsc' ? 'DSC curve' : 'TGA curve',
        xLabel: 'T / °C',
        yLabel: mode === 'dsc' ? 'heat flow / mW' : 'mass / %',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: derivative (DTG / dSignal) -----------------------------------
  if (data.length > 3) {
    const dtg = derivative(data);
    if (dtg.length > 2) {
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: mode === 'tga' ? 'DTG derivative' : 'Derivative',
          xLabel: 'T / °C',
          yLabel: mode === 'tga' ? 'd(mass)/dT' : 'd(signal)/dT',
          grid: true,
          ticks: 5,
          series: [
            { name: 'derivative', kind: 'line', color: '#ff6b6b', points: dtg.map((p) => ({ x: p.temperature, y: p.signal })) },
          ],
        } as PlotSpec,
      });
      i += 1;
    }
  }

  // --- panel c: transition integrals ----------------------------------------
  if (analysis.peaks.length > 0) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Transition integrals',
        xLabel: 'transition',
        yLabel: mode === 'dsc' ? 'ΔH / mW·°C' : 'mass loss / %',
        grid: true,
        ticks: 5,
        series: [
          {
            name: mode === 'dsc' ? 'ΔH' : 'mass loss',
            kind: 'bar',
            color: '#b48cff',
            bars: analysis.peaks.map((p, j) => ({ x0: j + 0.7, x1: j + 1.3, y: p.integral })),
          },
        ],
        xTicksOverride: analysis.peaks.map((p, j) => ({ pos: j + 1, label: `${p.peakTemp.toFixed(0)}°C` })),
      } as PlotSpec,
    });
    i += 1;
  }

  return panels;
}
