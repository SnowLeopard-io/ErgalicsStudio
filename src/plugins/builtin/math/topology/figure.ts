// ==========================================================================
// math-topology — Figure Studio panels
//
// Pure builder: re-derives the topology summaries into publication-grade
// PlotSpec panels (no DOM, no store access, no WebGL).
//
// Charts delivered:
//   a. Complexity of the triangulated genus-g surfaces: vertices, edges and
//      faces of the V − E + F count plotted against the genus selector.
//   b. Euler characteristic check: the numerically measured χ (scatter) on
//      top of the analytic line χ = 2 − 2g, so the classification identity
//      reads off directly.
//   c. Deformation retraction of the selected loop: polyline length against
//      the homotopy stage t ∈ [0, 1] (only when a loop is selected).
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
  loopLength,
  verifyGenusChi,
  type GenusVerification,
  type LoopSpec,
  type SurfaceId,
  type SurfaceShape,
} from './kernel';

export interface TopologyFigureInput {
  /** Genus selector upper bound (χ panel spans g = 0 … genusMax). */
  genusMax: number;
  /** Selected surface embedding shape (for the loop panel). */
  surface: SurfaceId;
  shape: SurfaceShape;
  /** Selected loop; null skips the deformation panel. */
  loop: LoopSpec | null;
}

/** Palette shared with the canvas rendering. */
const COLORS = {
  vertices: '#6db4ff',
  edges: '#ffb250',
  faces: '#4be1c3',
  analytic: '#f5a623',
  loop: '#ff7a7a',
} as const;

/** Homotopy stages sampled for the deformation curve. */
const DEFORM_SAMPLES = 24;

export function topologyFigurePanels(input: TopologyFigureInput): FigurePanelSpec[] {
  const { genusMax, surface, shape, loop } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;
  const gMax = Math.max(1, Math.min(6, Math.round(genusMax)));

  // Verified counts g = 0 … gMax (sphere / torus / glued polygon schema).
  const verified: GenusVerification[] = [];
  for (let g = 0; g <= gMax; g += 1) verified.push(verifyGenusChi(g));

  // --- panel a: triangulation complexity vs genus ---------------------------------
  const vSeries: Array<{ x: number; y: number }> = [];
  const eSeries: Array<{ x: number; y: number }> = [];
  const fSeries: Array<{ x: number; y: number }> = [];
  for (const v of verified) {
    vSeries.push({ x: v.g, y: v.counts.vertices });
    eSeries.push({ x: v.g, y: v.counts.edges });
    fSeries.push({ x: v.g, y: v.counts.faces });
  }
  const countsSeries: PlotSeries[] = [
    { name: 'V (vertices)', kind: 'line', color: COLORS.vertices, points: vSeries },
    { name: 'E (edges)', kind: 'line', color: COLORS.edges, points: eSeries },
    { name: 'F (faces)', kind: 'line', color: COLORS.faces, points: fSeries },
  ];
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Triangulation complexity vs genus',
      xLabel: 'genus g',
      yLabel: 'count',
      xDomain: [0, gMax],
      legend: true,
      grid: true,
      ticks: 5,
      series: countsSeries,
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: measured χ on top of the analytic χ = 2 − 2g line ------------------
  const measured: Array<{ x: number; y: number }> = [];
  const analytic: Array<{ x: number; y: number }> = [];
  for (const v of verified) {
    measured.push({ x: v.g, y: v.counts.chi });
    analytic.push({ x: v.g, y: v.expectedChi });
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Euler characteristic χ = V − E + F',
      xLabel: 'genus g',
      yLabel: 'χ',
      xDomain: [0, gMax],
      legend: true,
      grid: true,
      ticks: 5,
      series: [
        { name: 'measured χ', kind: 'scatter', color: COLORS.faces, points: measured },
        { name: 'analytic 2 − 2g', kind: 'line', color: COLORS.analytic, points: analytic },
      ],
    } as PlotSpec,
  });
  i += 1;

  // --- panel c: loop length along the deformation retraction ------------------------
  if (loop) {
    const pts: Array<{ x: number; y: number }> = [];
    for (let k = 0; k <= DEFORM_SAMPLES; k += 1) {
      const t = k / DEFORM_SAMPLES;
      pts.push({ x: t, y: loopLength(surface, shape, loop, t) });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Deformation retraction: loop length vs stage',
        xLabel: 'homotopy stage t',
        yLabel: 'loop length',
        xDomain: [0, 1],
        legend: false,
        grid: true,
        ticks: 5,
        series: [{ name: 'loop length', kind: 'line', color: COLORS.loop, points: pts }],
      } as PlotSpec,
    });
    i += 1;
  }

  return panels;
}
