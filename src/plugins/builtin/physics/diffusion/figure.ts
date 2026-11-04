// ==========================================================================
// physics-diffusion — Figure Studio panels
//
// Pure builder: turns the current diffusion field + solver parameters into
// publication-grade PlotSpec panels (no DOM, no store access).
//
// Charts delivered (1-D):
//   a. Concentration profiles u(x, t): initial condition, a mid-run snapshot
//      (only for cheap re-integrations) and the current time, with the
//      analytic reference overlaid when the configuration admits one.
//   b. Probe time series u(L/2, t), re-integrated from the initial condition.
// Charts delivered (2-D):
//   a. The current field as a heatmap.
//   b. The centre-line slice u(x, y = L/2).
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import { advance, analytic1d, makeInitialField, type DiffusionParams, type Field } from './kernel';

export interface DiffusionFigureInput {
  params: DiffusionParams;
  field: Field;
}

/** Cap on re-integration steps per panel so sendToFigure stays interactive. */
const MAX_RERUN_STEPS = 12000;

export function diffusionFigurePanels(input: DiffusionFigureInput): FigurePanelSpec[] {
  const { params: p, field: f } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  if (f.dim === '1d' && f.nx > 1) {
    const dx = p.domain / (f.nx - 1);
    const xs: number[] = [];
    for (let k = 0; k < f.nx; k++) xs.push(k * dx);
    const at = (u: Float64Array): Array<{ x: number; y: number }> =>
      xs.map((x, k) => ({ x, y: u[k]! }));
    const total = Math.round(f.t / p.dt);

    // --- panel a: profiles at several times -----------------------------------
    const series: PlotSeries[] = [
      { name: 't = 0', kind: 'line', color: '#7ad7ff', points: at(makeInitialField(p).u) },
    ];
    if (f.t > 0) {
      if (total >= 4 && total <= MAX_RERUN_STEPS) {
        const fm = makeInitialField(p);
        advance(fm, p, Math.round(total / 2));
        series.push({ name: `t = ${fm.t.toFixed(4)} s`, kind: 'line', color: '#b48cff', points: at(fm.u) });
      }
      series.push({ name: `t = ${f.t.toFixed(4)} s`, kind: 'line', color: '#5dd0a8', points: at(f.u) });
      if (analytic1d(p, p.domain / 2, f.t) !== null) {
        series.push({
          name: 'analytic',
          kind: 'line',
          color: '#ffd166',
          dash: [5, 4],
          points: xs.map((x) => ({ x, y: analytic1d(p, x, f.t) ?? 0 })),
        });
      }
    }
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: 'Concentration profiles u(x, t)',
        xLabel: 'x',
        yLabel: 'u',
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;

    // --- panel b: probe time series at x = L/2 ---------------------------------
    if (total >= 1 && total <= MAX_RERUN_STEPS) {
      const fp = makeInitialField(p);
      const probe = Math.round((fp.nx - 1) / 2);
      const every = Math.max(1, Math.floor(total / 300));
      const pts: Array<{ x: number; y: number }> = [{ x: 0, y: fp.u[probe]! }];
      let done = 0;
      while (done < total) {
        const step = Math.min(every, total - done);
        advance(fp, p, step);
        done += step;
        pts.push({ x: fp.t, y: fp.u[probe]! });
      }
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Probe time series u(L/2, t)',
          xLabel: 't / s',
          yLabel: 'u',
          grid: true,
          ticks: 5,
          series: [{ name: 'u(L/2, t)', kind: 'line', color: '#6db4ff', points: pts }],
        } as PlotSpec,
      });
      i += 1;
    }
  } else if (f.dim === '2d') {
    // --- panel a: current field heatmap ----------------------------------------
    let maxU = 1e-12;
    for (let k = 0; k < f.u.length; k++) maxU = Math.max(maxU, f.u[k]!);
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title: `Field u(x, y) at t = ${f.t.toFixed(4)} s`,
        xLabel: 'x',
        yLabel: 'y',
        grid: false,
        series: [
          {
            name: 'u(x, y)',
            kind: 'field',
            color: '#5dd0a8',
            field: { values: Array.from(f.u), rows: f.ny, cols: f.nx, domain: [0, maxU] },
          },
        ],
      } as PlotSpec,
    });
    i += 1;

    // --- panel b: centre-line slice ---------------------------------------------
    if (f.nx > 1) {
      const dx = p.domain / (f.nx - 1);
      const row = Math.floor(f.ny / 2);
      const pts: Array<{ x: number; y: number }> = [];
      for (let k = 0; k < f.nx; k++) pts.push({ x: k * dx, y: f.u[row * f.nx + k]! });
      panels.push({
        ...panelPlace(i),
        tag: panelTag(i),
        spec: {
          width: FIGURE_PANEL_WIDTH,
          height: FIGURE_PANEL_HEIGHT,
          title: 'Centre-line slice u(x, L/2)',
          xLabel: 'x',
          yLabel: 'u',
          grid: true,
          ticks: 5,
          series: [{ name: 'y = L/2', kind: 'line', color: '#6db4ff', points: pts }],
        } as PlotSpec,
      });
      i += 1;
    }
  }

  return panels;
}
