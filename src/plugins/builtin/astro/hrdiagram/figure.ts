// ==========================================================================
// astro-hrdiagram — Figure Studio panels
//
// Turns the filtered star catalogue into publication-grade PlotSpec panels
// and streams them into the figure store's shared sheet via
// `pushPanelsToFigure`:
//   a. HR / colour–magnitude scatter (B−V vs magnitude) with the empirical
//      main-sequence reference and the solar anchor.
//   b. Main-sequence slope check (absolute mode only): the membership-
//      screened data fit against the class-V reference over the same colour
//      span.
// The SVG plot axis cannot host a reversed magnitude domain with tick
// labels, so panels plot −mag: larger values = brighter = higher, i.e. the
// canonical "bright up" HR orientation.
// Pure: no DOM, no store access — kernel calls only.
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
  SUN_ANCHOR,
  absoluteMagnitude,
  fitDataMainSequence,
  mainSequenceMagnitude,
  type StarRecord,
} from './kernel';

export interface HrFigureInput {
  /** Catalogue stars (already passed through the plugin's visibility filters). */
  stars: StarRecord[];
  mode: 'absolute' | 'apparent';
  showMs: boolean;
  showSun: boolean;
}

/**
 * Build the full Figure Studio panel layout for one catalogue. Rows are
 * filled row-major; tag letters a, b, c, … label each panel.
 */
export function hrFigurePanels(input: HrFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;
  const magOf = (s: StarRecord): number => {
    if (input.mode === 'apparent') return s.v;
    return s.parallax !== null && s.parallax > 0 ? absoluteMagnitude(s.v, s.parallax) : NaN;
  };

  interface HrPoint {
    bv: number;
    negMag: number;
    hasPlx: boolean;
  }
  const pts: HrPoint[] = [];
  for (const s of input.stars) {
    const mag = magOf(s);
    if (!Number.isFinite(mag)) continue;
    pts.push({ bv: s.bv, negMag: -mag, hasPlx: s.parallax !== null && s.parallax > 0 });
  }
  if (pts.length === 0) return panels;

  // Frame the colour axis like the canvas panel: at least the reference span.
  let bvMin = -0.35;
  let bvMax = 1.7;
  for (const p of pts) {
    if (p.bv < bvMin) bvMin = p.bv;
    if (p.bv > bvMax) bvMax = p.bv;
  }

  // --- panel a: HR / colour–magnitude scatter --------------------------------
  const series: PlotSeries[] = [];
  if (input.mode === 'absolute') {
    const withPlx = pts.filter((p) => p.hasPlx);
    const noPlx = pts.filter((p) => !p.hasPlx);
    if (noPlx.length > 0) {
      series.push({
        name: 'no parallax',
        kind: 'scatter',
        color: '#96a0af',
        points: noPlx.map((p) => ({ x: p.bv, y: p.negMag })),
      });
    }
    if (withPlx.length > 0) {
      series.push({
        name: 'with parallax',
        kind: 'scatter',
        color: '#78c8ff',
        points: withPlx.map((p) => ({ x: p.bv, y: p.negMag })),
      });
    }
  } else {
    series.push({
      name: 'stars',
      kind: 'scatter',
      color: '#78c8ff',
      points: pts.map((p) => ({ x: p.bv, y: p.negMag })),
    });
  }
  if (input.showMs) {
    const ms: Array<{ x: number; y: number }> = [];
    for (let k = 0; k <= 120; k += 1) {
      const bv = bvMin + ((bvMax - bvMin) * k) / 120;
      ms.push({ x: bv, y: -mainSequenceMagnitude(bv) });
    }
    series.push({ name: 'main sequence (class V)', kind: 'line', color: '#ffd282', dash: [6, 4], points: ms });
  }
  if (input.showSun) {
    series.push({
      name: 'Sun (0.65, 4.83)',
      kind: 'scatter',
      color: '#ffe07a',
      points: [{ x: SUN_ANCHOR.bv, y: -SUN_ANCHOR.mv }],
    });
  }
  const yLabel = input.mode === 'absolute' ? '−M_V / mag (brighter ↑)' : '−V / mag (brighter ↑)';
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: input.mode === 'absolute' ? 'Hertzsprung–Russell diagram (M_V)' : 'Colour–magnitude diagram (V)',
      xLabel: 'B − V',
      yLabel,
      xDomain: [bvMin, bvMax],
      grid: true,
      ticks: 5,
      series,
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: main-sequence slope check (absolute mode only) ---------------
  if (input.mode === 'absolute') {
    const fit = fitDataMainSequence(input.stars);
    if (fit && fit.bvMax > fit.bvMin) {
      const dataLine: Array<{ x: number; y: number }> = [];
      const refLine: Array<{ x: number; y: number }> = [];
      const span = fit.bvMax - fit.bvMin;
      for (let k = 0; k <= 100; k += 1) {
        const bv = fit.bvMin + (span * k) / 100;
        dataLine.push({ x: bv, y: -(fit.intercept + fit.slope * bv) });
        refLine.push({ x: bv, y: -mainSequenceMagnitude(bv) });
      }
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Main-sequence fit check',
          xLabel: 'B − V',
          yLabel,
          xDomain: [fit.bvMin, fit.bvMax],
          grid: true,
          ticks: 5,
          series: [
            { name: 'class-V reference', kind: 'line', color: '#ffd282', dash: [6, 4], points: refLine },
            { name: `data fit (n=${fit.n}, slope=${fit.slope.toFixed(2)})`, kind: 'line', color: '#5dd0a8', points: dataLine },
          ],
        } as PlotSpec,
      });
    }
  }

  return panels;
}
