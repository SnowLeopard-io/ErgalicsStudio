// ==========================================================================
// geo-minerals — Figure Studio panels
//   a. Hardness vs specific gravity for the reference database.
//   b. Identification score ranking for the current criteria.
//   c. Retardation / interference-colour sequence of the selected mineral.
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
  MINERALS,
  interferenceColor,
  retardationNm,
  type IdentifyMatch,
  type Mineral,
} from './kernel';

export interface MineralFigureInput {
  selected: Mineral;
  matches: IdentifyMatch[];
  thicknessUm: number;
}

export function mineralFigurePanels(input: MineralFigureInput): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  // --- a. property scatter ---------------------------------------------------
  const groups = new Map<string, Array<{ x: number; y: number }>>();
  for (const m of MINERALS) {
    const key = m.class;
    const arr = groups.get(key) ?? [];
    arr.push({ x: m.sg, y: m.hardness });
    groups.set(key, arr);
  }
  const palette = ['#7ad7ff', '#ffd166', '#8ee6b0', '#ff8fab', '#c792ea', '#ffa94d', '#94b8ff', '#d0f4de'];
  const series: PlotSeries[] = [...groups.entries()].map(([name, points], k) => ({
    name,
    kind: 'scatter' as const,
    color: palette[k % palette.length]!,
    points,
  }));
  series.push({
    name: input.selected.name,
    kind: 'scatter',
    color: '#ffffff',
    points: [{ x: input.selected.sg, y: input.selected.hardness }],
  });
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: 'Hardness vs specific gravity',
      xLabel: 'specific gravity / g·cm⁻³',
      yLabel: 'Mohs hardness',
      grid: true,
      legend: true,
      series,
    } as PlotSpec,
  });
  i += 1;

  // --- b. identification ranking --------------------------------------------
  const top = input.matches.slice(0, 8).reverse();
  if (top.length > 0) {
    const bars = top.map((m, k) => ({ x0: 0, x1: m.score, y: k + 0.3 }));
    const labels = top.map((m, k) => ({ x: Math.min(m.score + 2, 98), y: k + 0.75 }));
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Identification score ranking',
        xLabel: 'weighted score / %',
        yLabel: 'candidate',
        xDomain: [0, 100],
        yDomain: [0, top.length + 0.5],
        grid: true,
        series: [
          { name: 'score', kind: 'bar', color: '#7ad7ff', bars },
          { name: 'candidates', kind: 'scatter', color: '#ffd166', points: labels },
        ],
      } as PlotSpec,
    });
    i += 1;
  }

  // --- c. retardation / interference colours --------------------------------
  const target = retardationNm(input.selected.birefringence, input.thicknessUm);
  const pts: Array<{ x: number; y: number }> = [];
  for (let g = 0; g <= Math.max(1600, target * 1.1); g += 20) {
    const c = interferenceColor(g);
    pts.push({ x: g, y: (c.r + c.g + c.b) / 3 });
  }
  panels.push({
    ...panelPlace(i),
    tag: panelTag(i),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title: `Michel-Lévy sequence · ${input.selected.name}`,
      xLabel: 'retardation Γ / nm',
      yLabel: 'mean RGB luminance',
      xDomain: [0, Math.max(1600, target * 1.1)],
      yDomain: [0, 255],
      grid: true,
      series: [
        { name: 'interference colour', kind: 'line', color: '#c792ea', points: pts },
        {
          name: `Γ = ${target.toFixed(0)} nm`,
          kind: 'scatter',
          color: '#ffffff',
          points: [{ x: target, y: 200 }],
        },
      ],
    } as PlotSpec,
  });

  return panels;
}
