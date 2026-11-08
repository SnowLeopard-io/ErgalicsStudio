// ==========================================================================
// eng-heat — Figure Studio panels
//
// Turns the current workbench analysis into publication-grade PlotSpec
// panels, one layout per mode:
//   conduction  — centerline temperature profiles (x at mid-height, y at
//                 mid-width) of the solved FD field;
//   convection  — h vs characteristic length sweep with the operating point;
//   radiation   — Planck spectral emissive power with the Wien peak marker;
//   exchanger   — hot / cold axial temperature profiles;
//   resistance  — node temperature ladder over the cumulative resistance.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type {
  ConductionResult,
  ConvectionResult,
  ExchangerResult,
  ProfilePoint,
  ResistanceResult,
  SpectralPoint,
} from './kernel';

export type HeatFigurePayload =
  | { mode: 'conduction'; result: ConductionResult; W: number; H: number }
  | { mode: 'convection'; sweep: Array<{ L: number; h: number }>; current: ConvectionResult }
  | { mode: 'radiation'; spectrum: SpectralPoint[]; lambdaMaxUm: number; specT: number }
  | { mode: 'exchanger'; profiles: ProfilePoint[]; result: ExchangerResult }
  | { mode: 'resistance'; result: ResistanceResult };

const A_BLUE = '#6ea8d8';
const A_GREEN = '#7fbf9e';
const A_AMBER = '#d8b46a';
const A_RED = '#c98a7a';

function linePanel(ordinal: number, title: string, xLabel: string, yLabel: string, series: PlotSeries[], xScale?: 'linear' | 'log'): FigurePanelSpec {
  return {
    ...panelPlace(ordinal),
    tag: panelTag(ordinal),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title,
      xLabel,
      yLabel,
      grid: true,
      ticks: 5,
      ...(xScale ? { xScale } : {}),
      series,
    } as PlotSpec,
  };
}

/** Build the Figure Studio panel set for one mode's analysis products. */
export function heatFigurePanels(payload: HeatFigurePayload): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  if (payload.mode === 'conduction') {
    const { result: r, W, H } = payload;
    const { nx, ny, T } = r;
    // Horizontal centerline: y = H/2.
    const jMid = Math.floor(ny / 2);
    const alongX: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < nx; k += 1) alongX.push({ x: (k / (nx - 1)) * W, y: T[jMid * nx + k]! });
    panels.push(linePanel(i, 'Temperature along x (y = H/2)', 'x / m', 'T / K', [
      { name: 'T(x)', kind: 'line', color: A_BLUE, points: alongX },
    ]));
    i += 1;
    // Vertical centerline: x = W/2.
    const iMid = Math.floor(nx / 2);
    const alongY: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < ny; k += 1) alongY.push({ x: (k / (ny - 1)) * H, y: T[k * nx + iMid]! });
    panels.push(linePanel(i, 'Temperature along y (x = W/2)', 'y / m', 'T / K', [
      { name: 'T(y)', kind: 'line', color: A_GREEN, points: alongY },
    ]));
  } else if (payload.mode === 'convection') {
    const pts = payload.sweep.map((s) => ({ x: s.L, y: s.h }));
    const series: PlotSeries[] = [{ name: 'h(L)', kind: 'line', color: A_BLUE, points: pts }];
    series.push({
      name: 'operating point',
      kind: 'scatter',
      color: A_AMBER,
      points: [{ x: payload.current.length, y: payload.current.h }],
    });
    panels.push(linePanel(i, 'Convective coefficient vs length', 'L / m (log)', 'h / W·m⁻²·K⁻¹', series, 'log'));
  } else if (payload.mode === 'radiation') {
    const pts = payload.spectrum.map((s) => ({ x: s.lambda * 1e6, y: s.e * 1e-6 }));
    const peak = payload.spectrum.reduce((best, s) => (s.e > best.e ? s : best), payload.spectrum[0]!);
    const series: PlotSeries[] = [
      { name: `E_b,l (T = ${payload.specT} K)`, kind: 'line', color: A_RED, points: pts },
      { name: 'Wien peak', kind: 'scatter', color: A_AMBER, points: [{ x: peak.lambda * 1e6, y: peak.e * 1e-6 }] },
    ];
    panels.push(linePanel(i, 'Planck spectral emission', 'lambda / um (log)', 'E_b,l / kW·m⁻²·um⁻¹', series, 'log'));
  } else if (payload.mode === 'exchanger') {
    const th = payload.profiles.map((p) => ({ x: p.x, y: p.th }));
    const tc = payload.profiles.map((p) => ({ x: p.x, y: p.tc }));
    panels.push(
      linePanel(i, 'Axial temperature profiles', 'x / L', 'T / K', [
        { name: 'T_hot', kind: 'line', color: A_RED, points: th },
        { name: 'T_cold', kind: 'line', color: A_BLUE, points: tc },
      ]),
    );
  } else {
    const r = payload.result;
    // Node ladder: cumulative resistance (K/W) vs node temperature.
    const chain = [r.rOut, ...r.rLayers, r.rIn];
    const pts: Array<{ x: number; y: number }> = [];
    let cum = 0;
    for (let k = 0; k < r.nodeTs.length; k += 1) {
      pts.push({ x: cum, y: r.nodeTs[k]! });
      if (k < chain.length) cum += chain[k]!;
    }
    panels.push(
      linePanel(i, 'Resistance ladder node temperatures', 'cumulative R / K·W⁻¹', 'T / K', [
        { name: 'node T', kind: 'line', color: A_AMBER, points: pts },
      ]),
    );
  }
  return panels;
}
