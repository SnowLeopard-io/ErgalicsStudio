// ==========================================================================
// tuning — Figure Studio panels
//   a. cent deviation from 12-TET per chromatic degree.
//   b. absolute frequency vs the equal-tempered reference.
//   c. mode step widths (seven-note scale).
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import {
  FIGURE_PANEL_HEIGHT,
  FIGURE_PANEL_WIDTH,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { ModeRow, TuningScale } from './kernel';

export interface TuningFigureInput {
  scale: TuningScale;
  modeRows: ModeRow[];
  modeLabel: string;
}

export function tuningFigurePanels(input: TuningFigureInput): FigurePanelSpec[] {
  const { scale, modeRows, modeLabel } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  const devRows = scale.rows.map((r) => ({ x: r.degree, y: r.devCents }));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Cent deviation — ${scale.tuning.labelEn}`,
      xLabel: 'degree',
      yLabel: 'cent',
      grid: true,
      ticks: 6,
      series: [
        {
          name: 'deviation',
          kind: 'bar',
          color: '#78c8ff',
          bars: devRows.map((p) => ({ x0: p.x - 0.4, x1: p.x + 0.4, y: p.y })),
        },
        { name: 'degree', kind: 'scatter', color: '#ffd166', points: devRows },
      ],
    } as PlotSpec,
  });
  i += 1;

  const freqs = scale.rows.map((r) => ({ x: r.degree, y: r.freq }));
  const tet = scale.rows.map((r) => ({
    x: r.degree,
    y: scale.tonicFreq * 2 ** (r.degree / 12),
  }));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Frequency — ${scale.tonicName} · A4=${scale.a4} Hz`,
      xLabel: 'degree',
      yLabel: 'Hz',
      grid: true,
      ticks: 6,
      series: [
        { name: scale.tuning.labelEn, kind: 'line', color: '#78c8ff', points: freqs },
        { name: '12-TET reference', kind: 'line', color: '#f0f4fa', dash: [5, 4], points: tet },
      ],
    } as PlotSpec,
  });
  i += 1;

  const steps = modeRows.map((r) => ({ x: r.step, y: r.stepCents }));
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Mode step widths — ${modeLabel}`,
      xLabel: 'scale step',
      yLabel: 'cent',
      grid: true,
      ticks: 7,
      series: [
        {
          name: 'step width',
          kind: 'bar',
          color: '#b48cff',
          bars: steps.map((p) => ({ x0: p.x - 0.4, x1: p.x + 0.4, y: p.y })),
        },
      ],
    } as PlotSpec,
  });

  return panels;
}
