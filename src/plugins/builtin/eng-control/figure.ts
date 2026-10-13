// ==========================================================================
// eng-control — Figure Studio panels
//
// Turns a completed step/Bode analysis into publication-grade PlotSpec
// panels:
//   a. RK4 step response y(t) with the unit-step setpoint r = 1 (dashed)
//      and the DC final value (dotted) when it differs from the setpoint.
//   b. Closed-loop Bode magnitude |T(jω)| on a log-ω axis with the −3 dB
//      (half-power) line and the interpolated bandwidth marker ω_b.
//   c. Closed-loop Bode phase ∠T(jω) on a log-ω axis.
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { BodePoint, ControlParams, StepSim } from './kernel';

/** Max points per drawn line — long RK4 traces are strided for the figure. */
const MAX_LINE_POINTS = 800;

function linePanel(
  ordinal: number,
  title: string,
  xLabel: string,
  yLabel: string,
  series: PlotSeries[],
  xScale?: 'linear' | 'log',
): FigurePanelSpec {
  return {
    ...panelPlace(ordinal),
    tag: panelTag(ordinal),
    spec: {
      width: FIGURE_PANEL_WIDTH,
      height: FIGURE_PANEL_HEIGHT,
      title,
      xLabel,
      yLabel,
      grid: true,
      ticks: 5,
      ...(xScale ? { xScale } : {}),
      series,
    } as PlotSpec,
  };
}

/**
 * Build the Figure Studio panel layout for one step/Bode analysis. Rows are
 * filled row-major; tag letters a, b, c, … label each panel.
 */
export function controlFigurePanels(
  p: ControlParams,
  sim: StepSim,
  bode: BodePoint[],
  bandwidth: number,
): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;
  const ydc = sim.dcGain;

  // --- panel a: step response + setpoint ------------------------------------
  const n = sim.t.length;
  const stride = Math.max(1, Math.ceil(n / MAX_LINE_POINTS));
  const resp: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < n; k += stride) resp.push({ x: sim.t[k]!, y: sim.y[k]! });
  if (n > 0 && (n - 1) % stride !== 0) resp.push({ x: sim.t[n - 1]!, y: sim.y[n - 1]! });
  if (resp.length >= 2) {
    const series: PlotSeries[] = [{ name: 'y(t) RK4', kind: 'line', color: '#5abfff', points: resp }];
    series.push({
      name: 'setpoint r = 1',
      kind: 'line',
      color: '#ffd166',
      dash: [5, 4],
      points: [
        { x: 0, y: 1 },
        { x: p.tEnd, y: 1 },
      ],
    });
    if (ydc > 0 && Math.abs(ydc - 1) > 1e-9) {
      series.push({
        name: 'DC final value',
        kind: 'line',
        color: '#aab6c8',
        dash: [3, 3],
        points: [
          { x: 0, y: ydc },
          { x: p.tEnd, y: ydc },
        ],
      });
    }
    panels.push(linePanel(i, 'Step response (RK4)', 't / s', 'y', series));
    i += 1;
  }

  // --- panel b: Bode magnitude with the −3 dB half-power line ---------------
  const magPts = bode.filter((pt) => Number.isFinite(pt.magDb)).map((pt) => ({ x: pt.w, y: pt.magDb }));
  if (magPts.length >= 2) {
    const series: PlotSeries[] = [{ name: '|T(jω)|', kind: 'line', color: '#5abfff', points: magPts }];
    if (ydc > 0) {
      const threshold = 20 * Math.log10(ydc) - 10 * Math.log10(2);
      series.push({
        name: '−3 dB',
        kind: 'line',
        color: '#ffd166',
        dash: [4, 3],
        points: [
          { x: magPts[0]!.x, y: threshold },
          { x: magPts[magPts.length - 1]!.x, y: threshold },
        ],
      });
      if (Number.isFinite(bandwidth)) {
        series.push({ name: 'ω_b', kind: 'scatter', color: '#ffd166', points: [{ x: bandwidth, y: threshold }] });
      }
    }
    panels.push(linePanel(i, 'Closed-loop Bode magnitude', 'ω / rad·s⁻¹ (log)', '|T| / dB', series, 'log'));
    i += 1;
  }

  // --- panel c: Bode phase ---------------------------------------------------
  const phPts = bode.filter((pt) => Number.isFinite(pt.phaseDeg)).map((pt) => ({ x: pt.w, y: pt.phaseDeg }));
  if (phPts.length >= 2) {
    panels.push(
      linePanel(i, 'Closed-loop Bode phase', 'ω / rad·s⁻¹ (log)', '∠T / °', [
        { name: '∠T(jω)', kind: 'line', color: '#5dd0a8', points: phPts },
      ], 'log'),
    );
  }

  return panels;
}
