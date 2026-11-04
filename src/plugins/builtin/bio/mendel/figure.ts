// ==========================================================================
// bio-mendel — Figure Studio panels
//
// Turns the loaded χ² goodness-of-fit dataset into publication-grade
// PlotSpec panels:
//   a. Observed vs expected counts per phenotype category (grouped bars
//      with categorical ticks).
//   b. Observed/expected ratio per category with a 1:1 reference line —
//      ratios near 1 indicate agreement with the segregation hypothesis.
// ==========================================================================

import type { CategoricalTicks, PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { groupTraits, type TraitRow } from './kernel';

export interface MendelFigureInput {
  rows: TraitRow[];
}

/** Truncate long category labels so the categorical axis stays readable. */
function shortLabel(s: string): string {
  return s.length > 12 ? `${s.slice(0, 11)}…` : s;
}

/**
 * Build the full Figure Studio panel layout for one Mendel χ² analysis.
 * Rows are filled row-major; tag letters a, b, c, … label each panel.
 */
export function mendelFigurePanels(input: MendelFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  const tests = groupTraits(input.rows);
  const labels: string[] = [];
  const observed: number[] = [];
  const expected: number[] = [];
  for (const t of tests) {
    for (let i = 0; i < t.observed.length; i += 1) {
      labels.push(shortLabel(t.categories[i] ?? `cat${labels.length}`));
      observed.push(t.observed[i]!);
      expected.push(Math.max(t.result.expected[i] ?? 0, 0));
    }
  }
  if (labels.length === 0) return panels;
  let i = 0;

  // --- panel a: observed vs expected counts (grouped categorical bars) -------
  const obsBars = observed.map((y, k) => ({ x0: k, x1: k + 0.38, y }));
  const expBars = expected.map((y, k) => ({ x0: k + 0.42, x1: k + 0.8, y }));
  const ticks: CategoricalTicks[] = labels.map((label, k) => ({ pos: k + 0.4, label }));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'F2 phenotype counts',
      xLabel: 'phenotype',
      yLabel: 'count',
      xDomain: [-0.4, Math.max(0.6, labels.length - 0.2)],
      xTicksOverride: ticks,
      grid: true,
      legend: true,
      series: [
        { name: 'observed O', kind: 'bar', color: '#7ad7ff', bars: obsBars },
        { name: 'expected E', kind: 'bar', color: '#f0aa6e', bars: expBars },
      ],
    } as PlotSpec,
  });
  i += 1;

  // --- panel b: observed/expected ratio + 1:1 line ---------------------------
  const ratioPts = observed.map((o, k) => ({
    x: k + 0.4,
    y: expected[k]! > 0 ? o / expected[k]! : 0,
  }));
  const series: PlotSeries[] = [
    { name: 'O / E', kind: 'bar', color: '#5dd0a8', bars: ratioPts.map((p) => ({ x0: p.x - 0.3, x1: p.x + 0.3, y: p.y })) },
    {
      name: '1:1 agreement',
      kind: 'line',
      color: '#ffd166',
      dash: [4, 3],
      points: [
        { x: -0.2, y: 1 },
        { x: labels.length - 0.2 + 0.4, y: 1 },
      ],
    },
  ];
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Observed / expected ratio',
      xLabel: 'phenotype',
      yLabel: 'O / E',
      xDomain: [-0.4, Math.max(0.6, labels.length - 0.2)],
      xTicksOverride: ticks,
      grid: true,
      legend: true,
      series,
    } as PlotSpec,
  });

  return panels;
}
