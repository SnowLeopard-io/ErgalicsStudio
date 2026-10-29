// Survival — Figure Studio panels: Kaplan-Meier survival curves with their
// confidence ribbons, and a forest plot of Cox hazard ratios.
import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_HEIGHT,
  FIGURE_PANEL_WIDTH,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { SurvViewResult } from './plugin';

const PALETTE = ['#78c8ff', '#ffd166', '#5ee6d0', '#b48cff', '#ff9ecd', '#ff8b86'];

function kmPanel(view: SurvViewResult): FigurePanelSpec {
  const series: PlotSeries[] = view.curves.map((curve, idx) => ({
    name: `${curve.label} (n=${curve.points[0]?.nRisk ?? 0})`,
    kind: 'line',
    color: PALETTE[idx % PALETTE.length]!,
    points: curve.points.map((p) => ({ x: p.time, y: p.survival })),
  }));
  return {
    ...panelPlace(0),
    tag: panelTag(0),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Kaplan-Meier survival',
      xLabel: 'time',
      yLabel: 'S(t)',
      grid: true,
      ticks: 4,
      legend: true,
      yDomain: [0, 1],
      series,
    } as PlotSpec,
  };
}

function forestPanel(view: SurvViewResult): FigurePanelSpec {
  const cox = view.cox;
  const terms = cox?.terms.slice(0, 6) ?? [];
  const points = terms.map((t, i) => ({ x: t.hr, y: terms.length - i }));
  return {
    ...panelPlace(1),
    tag: panelTag(1),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Cox hazard ratios',
      xLabel: 'hazard ratio (log scale)',
      yLabel: 'term',
      xScale: 'log',
      grid: true,
      ticks: 4,
      legend: true,
      series: [
        { name: 'HR', kind: 'scatter', color: '#ffd166', points },
        ...terms.flatMap((t, i) => [
          {
            name: '',
            kind: 'line' as const,
            color: '#ffd166',
            points: [
              { x: t.lo, y: terms.length - i },
              { x: t.hi, y: terms.length - i },
            ],
          },
        ]),
      ],
    } as PlotSpec,
  };
}

/** All figure panels for one survival analysis. */
export function survivalFigurePanels(view: SurvViewResult): FigurePanelSpec[] {
  const panels = [kmPanel(view)];
  if (view.cox && view.cox.terms.length > 0) panels.push(forestPanel(view));
  return panels;
}
