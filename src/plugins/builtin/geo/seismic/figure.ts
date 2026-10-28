// ==========================================================================
// geo-seismic — Figure Studio panels
//   a. P/S travel-time curves with shadow-zone bands.
//   b. Synthetic vertical-component seismogram with phase picks.
//   c. Radiated energy vs magnitude (Gutenberg–Richter).
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
  cachedTravelTimeCurve,
  detectShadowZones,
  energyJoules,
  type Seismogram,
} from './kernel';

export interface SeismicFigureInput {
  seismogram: Seismogram;
}

export function seismicFigurePanels(input: SeismicFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- a. travel-time curves -------------------------------------------------
  const pPts = cachedTravelTimeCurve('P').map((b) => ({ x: b.deltaDeg, y: b.timeSec }));
  const sPts = cachedTravelTimeCurve('S').map((b) => ({ x: b.deltaDeg, y: b.timeSec }));
  const pShadow = detectShadowZones('P');
  const sShadow = detectShadowZones('S');
  if (pPts.length > 1) {
    const series: PlotSeries[] = [
      { name: 'P wave', kind: 'line', color: '#7ad7ff', points: pPts },
      { name: 'S wave', kind: 'line', color: '#ffb454', points: sPts },
    ];
    const xDomain: [number, number] = [0, 180];
    const yMax = Math.max(...pPts.map((p) => p.y), ...sPts.map((p) => p.y), 1) * 1.05;
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Travel-time curves & shadow zones',
        xLabel: 'epicentral distance / deg',
        yLabel: 'first-arrival time / s',
        xDomain,
        yDomain: [0, yMax],
        grid: true,
        legend: true,
        series,
      } as PlotSpec,
    });
    i += 1;

    // Shadow bands as thin field strips along the bottom.
    const band: number[] = new Array(360).fill(0);
    for (const z of pShadow) {
      for (let d = Math.round(z.fromDeg * 2); d <= Math.round(z.toDeg * 2) && d < 360; d += 1) band[d] = 1;
    }
    for (const z of sShadow) {
      for (let d = Math.round(z.fromDeg * 2); d <= Math.round(z.toDeg * 2) && d < 360; d += 1) band[d] = band[d] || 2;
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Direct-phase shadow zones (P / S)',
        xLabel: 'epicentral distance / deg',
        yLabel: 'phase',
        xDomain: [0, 180],
        yDomain: [0, 1],
        series: [
          {
            name: 'shadow',
            kind: 'field',
            color: '#ff6b6b',
            field: { values: band, rows: 2, cols: 360, domain: [0, 2] },
          },
        ],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- b. seismogram ---------------------------------------------------------
  const sg = input.seismogram;
  if (sg.times.length > 1) {
    const norm = Math.max(...sg.amplitude.map(Math.abs), 1e-9);
    const points = sg.times.map((t, k) => ({ x: t, y: sg.amplitude[k]! / norm }));
    const picks: PlotSeries[] = sg.phases.map((ph, idx) => ({
      name: `${ph.name} ${ph.arrivalSec.toFixed(1)} s`,
      kind: 'scatter' as const,
      color: idx === 0 ? '#7ad7ff' : idx === 1 ? '#ffb454' : '#c792ea',
      points: [{ x: ph.arrivalSec, y: 1.04 }],
    }));
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `Synthetic seismogram · Δ=${sg.distanceDeg.toFixed(1)}°, M${sg.magnitude.toFixed(1)}`,
        xLabel: 'time / s',
        yLabel: 'normalised velocity',
        grid: true,
        legend: true,
        yDomain: [-1.15, 1.15],
        series: [{ name: 'vertical component', kind: 'line', color: '#8ee6b0', points }, ...picks],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- c. energy vs magnitude ----------------------------------------------
  const energyPts: Array<{ x: number; y: number }> = [];
  for (let m = 2; m <= 9.001; m += 0.25) energyPts.push({ x: m, y: energyJoules(m) });
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Radiated energy (Gutenberg–Richter)',
      xLabel: 'magnitude M',
      yLabel: 'energy / J',
      yScale: 'log',
      grid: true,
      series: [{ name: 'E = 10^(4.8+1.5M)', kind: 'line', color: '#ffd166', points: energyPts }],
    } as PlotSpec,
  });

  return panels;
}
