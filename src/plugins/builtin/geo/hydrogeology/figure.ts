// ==========================================================================
// geo-hydrogeology — Figure Studio panels
//   a. Theis / Cooper–Jacob time–drawdown curves.
//   b. Radial cone of depression.
//   c. Ogata–Banks contaminant plume.
//   d. Tidal water-level response.
// ==========================================================================

import type { PlotSeries, PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_HEIGHT,
  FIGURE_PANEL_WIDTH,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import {
  coneOfDepression,
  jacobDrawdown,
  plumeProfile,
  theisCurve,
  tidalResponse,
  tidalSeries,
  type PlumeInput,
  type Well,
} from './kernel';

export interface HydroFigureInput {
  well: Well;
  transmissivity: number;
  storativity: number;
  timeDays: number;
  plume: PlumeInput;
  tidal: { amplitude: number; omega: number; diffusivity: number; depth: number };
}

export function hydroFigurePanels(input: HydroFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  const times: number[] = [];
  for (let k = 0; k <= 60; k += 1) times.push(10 ** (-3 + (k / 60) * 5));
  const curve = theisCurve({ q: input.well.q, t: input.transmissivity, s: input.storativity, r: 50 }, times);
  const exactPts = curve.map((p) => ({ x: p.timeDays, y: p.drawdownM }));
  const approxPts = times.map((time) => ({
    x: time,
    y: jacobDrawdown({ q: input.well.q, t: input.transmissivity, s: input.storativity, r: 50, time }),
  }));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Theis vs Cooper–Jacob drawdown',
      xLabel: 'time / d',
      yLabel: 'drawdown / m',
      xScale: 'log',
      grid: true,
      legend: true,
      series: [
        { name: 'Theis', kind: 'line', color: '#7ad7ff', points: exactPts },
        { name: 'Cooper–Jacob', kind: 'line', color: '#ffd166', points: approxPts },
      ],
    } as PlotSpec,
  });
  i += 1;

  const cone = coneOfDepression(input.well, input.transmissivity, input.storativity, input.timeDays);
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Cone of depression',
      xLabel: 'radial distance / m',
      yLabel: 'drawdown / m',
      grid: true,
      series: [{ name: 's(r)', kind: 'line', color: '#8ee6b0', points: cone.map((p) => ({ x: p.distanceM, y: p.drawdownM })) }],
    } as PlotSpec,
  });
  i += 1;

  const plume = plumeProfile(input.plume);
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Contaminant plume (Ogata–Banks)',
      xLabel: 'distance / m',
      yLabel: 'concentration / mg·L⁻¹',
      grid: true,
      series: [{ name: 'C(x,t)', kind: 'line', color: '#ff8fab', points: plume.map((p) => ({ x: p.x, y: p.concentration })) }],
    } as PlotSpec,
  });
  i += 1;

  const resp = tidalResponse({ ...input.tidal, amplitude: input.tidal.amplitude });
  const series = tidalSeries(input.tidal, 3, 180);
  const plots: PlotSeries[] = [
    { name: 'sea level', kind: 'line', color: '#7ad7ff', points: series.map((p) => ({ x: p.timeDays, y: p.seaLevelM })) },
    { name: 'well level', kind: 'line', color: '#ffd166', points: series.map((p) => ({ x: p.timeDays, y: p.wellLevelM })) },
  ];
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Tidal response · lag ${resp.phaseLagHours.toFixed(1)} h`,
      xLabel: 'time / d',
      yLabel: 'water level / m',
      grid: true,
      legend: true,
      series: plots,
    } as PlotSpec,
  });
  return panels;
}
