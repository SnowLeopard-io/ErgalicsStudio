// ==========================================================================
// physics-diffraction — Figure Studio panels
//
// Pure builder: turns the sampled diffraction profile into publication-grade
// PlotSpec panels (no DOM, no store access).
//
// Charts delivered:
//   a. Fresnel–Kirchhoff intensity I(x) (or I(r) for the circular hole) with
//      the Fraunhofer far-field reference overlaid when enabled.
//   b. Double slit / grating: the pattern against the single-slit envelope
//      scaled by N². Single slit / circular hole: the same profile on a log
//      intensity axis to expose the weak secondary structure.
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
  fraunhofer1d,
  fraunhoferAiry,
  sampleSlitIntensity,
  type DiffractionParams,
  type Profile1D,
} from './kernel';

export interface DiffractionFigureInput {
  params: DiffractionParams;
  profile: Profile1D;
  /** Include the Fraunhofer far-field overlay (mirrors the UI toggle). */
  overlay: boolean;
}

export function diffractionFigurePanels(input: DiffractionFigureInput): FigurePanelSpec[] {
  const { params: p, profile } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;
  const isCircle = p.aperture === 'circle';
  const xLabel = isCircle ? 'r / λ' : 'x / λ';
  const numericPts: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < profile.xs.length; k++) numericPts.push({ x: profile.xs[k]!, y: profile.ys[k]! });

  // --- panel a: intensity profile + far-field reference -----------------------
  const series: PlotSeries[] = [
    { name: 'Fresnel–Kirchhoff', kind: 'line', color: '#6db4ff', points: numericPts },
  ];
  const refAt = (x: number): number | null => (isCircle ? fraunhoferAiry(x, p) : fraunhofer1d(x, p));
  if (input.overlay && refAt(0) !== null) {
    series.push({
      name: 'Fraunhofer ref',
      kind: 'line',
      color: '#ffd166',
      dash: [5, 4],
      points: numericPts.map((q) => ({ x: q.x, y: refAt(q.x) ?? 0 })),
    });
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Intensity profile I(x)',
      xLabel,
      yLabel: 'I (a.u.)',
      grid: true,
      ticks: 5,
      series,
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: envelope comparison / log-intensity view ----------------------
  if (p.aperture === 'double' || p.aperture === 'grating') {
    // Single-slit envelope at the same a, L; interference maxima reach N²·I₁.
    const envP: DiffractionParams = { ...p, aperture: 'slit' };
    const env = sampleSlitIntensity(envP, 401);
    const scale = p.aperture === 'double' ? 4 : p.nSlits * p.nSlits;
    const envPts: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < env.xs.length; k++) envPts.push({ x: env.xs[k]!, y: env.ys[k]! * scale });
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Pattern vs single-slit envelope',
        xLabel,
        yLabel: 'I (a.u.)',
        grid: true,
        ticks: 5,
        series: [
          { name: 'Fresnel–Kirchhoff', kind: 'line', color: '#6db4ff', points: numericPts },
          { name: 'envelope ×N²', kind: 'line', color: '#ffd166', dash: [5, 4], points: envPts },
        ],
      } as PlotSpec,
    });
  } else {
    let vMax = 1e-12;
    for (let k = 0; k < profile.ys.length; k++) vMax = Math.max(vMax, profile.ys[k]!);
    const floor = vMax * 1e-9;
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Log-intensity view',
        xLabel,
        yLabel: 'I (log)',
        yScale: 'log',
        grid: true,
        ticks: 5,
        series: [
          {
            name: 'I',
            kind: 'line',
            color: '#b48cff',
            points: numericPts.map((q) => ({ x: q.x, y: Math.max(q.y, floor) })),
          },
        ],
      } as PlotSpec,
    });
  }
  i += 1;

  return panels;
}
