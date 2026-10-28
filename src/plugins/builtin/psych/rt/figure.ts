// ==========================================================================
// psych-rt — Figure Studio panels
//
// Turns the outlier-screened per-condition RT lists into publication-grade
// PlotSpec panels and streams them into the figure store's shared sheet via
// `pushPanelsToFigure`:
//   a. Pooled RT distribution histogram with the normal (mean, SD) overlay
//      scaled to expected per-bin counts.
//   b. Condition-mean RT bar chart (only when ≥ 2 conditions hold valid data).
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
import { summarize } from './kernel';

export interface RtFigureGroup {
  name: string;
  /** Outlier-screened reaction times (ms). */
  kept: number[];
}

export interface RtFigureInput {
  groups: RtFigureGroup[];
}

const HIST_BINS = 14;

/**
 * Build the full Figure Studio panel layout for one RT analysis. Rows are
 * filled row-major; tag letters a, b, c, … label each panel.
 */
export function rtFigurePanels(input: RtFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;
  const pooled = input.groups.flatMap((g) => g.kept).filter((v) => Number.isFinite(v));

  // --- panel a: pooled RT histogram + normal overlay -------------------------
  if (pooled.length >= 3) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of pooled) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (!(hi > lo)) {
      lo -= 25;
      hi += 25;
    }
    const bw = (hi - lo) / HIST_BINS;
    const counts = new Array<number>(HIST_BINS).fill(0);
    for (const v of pooled) {
      let b = Math.floor((v - lo) / bw);
      if (b < 0) b = 0;
      if (b >= HIST_BINS) b = HIST_BINS - 1;
      counts[b] = (counts[b] ?? 0) + 1;
    }
    const bars = counts.map((c, k) => ({ x0: lo + k * bw, x1: lo + (k + 1) * bw, y: c }));
    const series: PlotSeries[] = [
      { name: `RT (n=${pooled.length})`, kind: 'histogram', color: '#60a8ff', bars },
    ];
    const s = summarize(pooled);
    if (s && s.sd > 0) {
      // Normal overlay scaled to expected per-bin counts: n · binWidth · pdf(x).
      const overlay: Array<{ x: number; y: number }> = [];
      const steps = 120;
      for (let k = 0; k <= steps; k += 1) {
        const x = lo + ((hi - lo) * k) / steps;
        const z = (x - s.mean) / s.sd;
        const dens = Math.exp(-0.5 * z * z) / (s.sd * Math.sqrt(2 * Math.PI));
        overlay.push({ x, y: pooled.length * bw * dens });
      }
      series.push({ name: 'normal fit', kind: 'line', color: '#fab46e', points: overlay });
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'RT distribution',
        xLabel: 'RT / ms',
        yLabel: 'count',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;
  }

  // --- panel b: condition-mean RT bars (≥ 2 conditions) ----------------------
  const means: Array<{ name: string; mean: number }> = [];
  for (const g of input.groups) {
    const s = summarize(g.kept);
    if (s) means.push({ name: g.name, mean: s.mean });
  }
  if (means.length >= 2) {
    const bars = means.map((m, k) => ({ x0: k, x1: k + 0.8, y: m.mean }));
    const ticks = means.map((m, k) => ({ pos: k + 0.4, label: m.name }));
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Condition-mean RT',
        xLabel: 'condition',
        yLabel: 'mean RT / ms',
        xDomain: [-0.4, Math.max(0.6, means.length - 0.2)],
        xTicksOverride: ticks,
        grid: true,
        ticks: 5,
        series: [{ name: 'mean RT', kind: 'bar', color: '#5dd0a8', bars }],
      } as PlotSpec,
    });
  }

  return panels;
}
