// ==========================================================================
// math-dist — Figure Studio panels
//
// Pure builder: evaluates the selected family (and optionally the MLE fit
// of a built-in dataset) into publication-grade PlotSpec panels (no DOM,
// no store access).
//
// Charts delivered:
//   a. Density panel: pdf / pmf curve of the slider parameters, a density
//      histogram of the sample (seeded Monte-Carlo or dataset), and the
//      MLE fit curve of the dataset when one is selected.
//   b. CDF panel: cdf curve of the slider parameters, the step ECDF of the
//      data, and the fitted CDF overlay.
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
  distPdf,
  distCdf,
  getDist,
  histogramBars,
  plotXRange,
  PLOT_TAIL,
  distQuantile,
  type DistId,
} from './kernel';

export interface DistFigureFit {
  /** Family the fit belongs to (equals the panel family in practice). */
  dist: DistId;
  params: Record<string, number>;
}

export interface DistFigureInput {
  dist: DistId;
  params: Record<string, number>;
  /** Sample or dataset values for the histogram / ECDF overlays. */
  samples?: number[];
  /** MLE fit overlay (null in pure sampling mode). */
  fit?: DistFigureFit | null;
}

/** Curve resolution of the continuous pdf/cdf lines. */
const CURVE_POINTS = 160;

/** Density histogram bin count of the overlay. */
const HIST_BINS = 32;

/** Sample values inside the window are required for the histogram overlay. */
function inWindow(values: number[], lo: number, hi: number): number[] {
  return values.filter((v) => Number.isFinite(v) && v >= lo && v <= hi);
}

export function distFigurePanels(input: DistFigureInput): FigurePanelSpec[] {
  const { dist, params, fit } = input;
  const def = getDist(dist);
  const samples = input.samples ?? [];
  const hasData = samples.length > 0;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  const [xlo, xhi] = plotXRange(dist, params, hasData ? samples : undefined);
  const discrete = def.kind === 'discrete';

  // --- panel a: density (pdf / pmf) + histogram + fit ----------------------------
  const density: PlotSeries[] = [];
  let yMax = 0;

  // Sample / dataset histogram (density-scaled so the pdf overlays directly).
  if (hasData) {
    const hlo = discrete ? Math.floor(xlo) - 0.5 : xlo;
    const hhi = discrete ? Math.ceil(xhi) + 0.5 : xhi;
    const bins = discrete ? Math.max(1, Math.round(hhi - hlo)) : HIST_BINS;
    const bars = histogramBars(samples, hlo, hhi, bins);
    for (const b of bars) yMax = Math.max(yMax, b.y);
    density.push({ name: `sample (n=${samples.length})`, kind: 'histogram', color: '#4be1c3', bars });
  }

  // Slider-density curve of the selected family.
  if (discrete) {
    const k0 = Math.ceil(xlo);
    const k1 = Math.floor(xhi);
    const bars: Array<{ x0: number; x1: number; y: number }> = [];
    for (let k = k0; k <= k1; k += 1) {
      const v = distPdf(dist, params, k);
      if (Number.isFinite(v)) yMax = Math.max(yMax, v);
      bars.push({ x0: k - 0.35, x1: k + 0.35, y: Number.isFinite(v) ? v : 0 });
    }
    density.push({ name: 'PMF', kind: 'bar', color: '#6db4ff', bars });
  } else {
    const pts: Array<{ x: number; y: number }> = [];
    for (let s = 0; s <= CURVE_POINTS; s += 1) {
      const x = xlo + ((xhi - xlo) * s) / CURVE_POINTS;
      const y = distPdf(dist, params, x);
      if (Number.isFinite(y) && y >= 0) {
        pts.push({ x, y });
        yMax = Math.max(yMax, y);
      }
    }
    density.push({ name: 'pdf', kind: 'line', color: '#6db4ff', points: pts });
  }

  // MLE fit curve of the selected dataset.
  if (fit) {
    const fd = getDist(fit.dist);
    if (fd.kind === 'discrete') {
      const k0 = Math.ceil(xlo);
      const k1 = Math.floor(xhi);
      const bars: Array<{ x0: number; x1: number; y: number }> = [];
      for (let k = k0; k <= k1; k += 1) {
        const v = distPdf(fit.dist, fit.params, k);
        if (Number.isFinite(v)) yMax = Math.max(yMax, v);
        bars.push({ x0: k - 0.35, x1: k + 0.35, y: Number.isFinite(v) ? v : 0 });
      }
      density.push({ name: 'MLE fit', kind: 'bar', color: '#f5a623', bars });
    } else {
      const pts: Array<{ x: number; y: number }> = [];
      const lo = fd.id === 'beta' ? 0 : Math.min(0, xlo);
      const hi = fd.id === 'beta' ? 1 : xhi;
      for (let s = 0; s <= CURVE_POINTS; s += 1) {
        const x = lo + ((hi - lo) * s) / CURVE_POINTS;
        const y = distPdf(fit.dist, fit.params, x);
        if (Number.isFinite(y) && y >= 0) {
          pts.push({ x, y });
          yMax = Math.max(yMax, y);
        }
      }
      density.push({ name: 'MLE fit', kind: 'line', color: '#f5a623', points: pts });
    }
  }

  if (density.length > 0) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: discrete ? 'PMF + density histogram' : 'PDF + density histogram',
        xLabel: 'x',
        yLabel: discrete ? 'pmf' : 'density',
        xDomain: [xlo, xhi],
        yDomain: [0, Math.max(yMax * 1.1, 1e-9)],
        grid: true,
        ticks: 5,
        series: density,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: CDF + empirical step CDF + fit overlay ---------------------------
  const cumul: PlotSeries[] = [];
  const clo = distQuantile(dist, params, PLOT_TAIL);
  const chi = distQuantile(dist, params, 1 - PLOT_TAIL);

  if (discrete) {
    const bars: Array<{ x0: number; x1: number; y: number }> = [];
    for (let k = Math.ceil(xlo); k <= Math.floor(xhi); k += 1) {
      const v = distCdf(dist, params, k);
      bars.push({ x0: k - 0.35, x1: k + 0.35, y: Number.isFinite(v) ? v : 0 });
    }
    cumul.push({ name: 'CDF', kind: 'bar', color: '#ffb250', bars });
  } else {
    const pts: Array<{ x: number; y: number }> = [];
    for (let s = 0; s <= CURVE_POINTS; s += 1) {
      const x = clo + ((chi - clo) * s) / CURVE_POINTS;
      pts.push({ x, y: distCdf(dist, params, x) });
    }
    cumul.push({ name: 'CDF', kind: 'line', color: '#ffb250', points: pts });
  }

  // Empirical step ECDF of the sample / dataset.
  if (hasData) {
    const clean = inWindow(samples, xlo, xhi).sort((a, b) => a - b);
    const pts: Array<{ x: number; y: number }> = [];
    const n = clean.length;
    for (let k = 0; k < n; k += 1) {
      const v = clean[k]!;
      pts.push({ x: v, y: k / n });
      pts.push({ x: v, y: (k + 1) / n });
    }
    if (n > 0) pts.push({ x: clean[n - 1]!, y: 1 });
    cumul.push({ name: 'ECDF', kind: 'line', color: '#4be1c3', points: pts });
  }

  if (fit) {
    const pts: Array<{ x: number; y: number }> = [];
    for (let s = 0; s <= CURVE_POINTS; s += 1) {
      const x = clo + ((chi - clo) * s) / CURVE_POINTS;
      pts.push({ x, y: distCdf(fit.dist, fit.params, x) });
    }
    cumul.push({ name: 'MLE fit CDF', kind: 'line', color: '#f5a623', points: pts, dash: [6, 4] });
  }

  if (cumul.length > 0) {
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Cumulative distribution',
        xLabel: 'x',
        yLabel: 'F(x)',
        xDomain: [xlo, xhi],
        yDomain: [0, 1],
        grid: true,
        ticks: 5,
        series: cumul,
      } as PlotSpec,
    });
    i += 1;
  }

  return panels;
}
