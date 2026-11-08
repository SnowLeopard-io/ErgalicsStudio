// ==========================================================================
// eng-mechanism — Figure Studio panels
//
// Turns a completed mechanism analysis into publication-grade PlotSpec
// panels:
//   a. Four-bar coupler-point path P(theta2) (equal-aspect x/y trace).
//   b. Transmission angle mu(theta2) with the 40 deg recommended minimum.
//   c. Coupler-point speed |vP|(theta2) for the input crank speed.
//   d. Cam follower displacement s(theta) with segment boundaries.
//   e. Cam pressure angle alpha(theta) with the 30 deg recommended maximum.
//   f. Cam follower acceleration d2s/dtheta2(theta).
// Gear-train modes produce no panels (schematic only).
// ==========================================================================

import type { PlotSpec, PlotSeries } from '@/core/plot';
import {
  FIGURE_PANEL_WIDTH,
  FIGURE_PANEL_HEIGHT,
  panelPlace,
  panelTag,
  type FigurePanelSpec,
} from '@/core/figure/sheet';
import type { CamResult, FourBarSweep } from './kernel';

/** Academic low-saturation palette. */
const COLOR_BLUE = '#6f94b8';
const COLOR_SAGE = '#8aa87f';
const COLOR_TAN = '#b3925e';
const COLOR_ROSE = '#b8736f';

/** Max points per drawn line — sweeps are strided for the figure. */
const MAX_LINE_POINTS = 720;

function linePanel(ordinal: number, title: string, xLabel: string, yLabel: string, series: PlotSeries[]): FigurePanelSpec {
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
      series,
    } as PlotSpec,
  };
}

/** Stride a (possibly NaN-carrying) y-array against its x-array. */
function stridePairs(xs: number[], ys: number[]): Array<{ x: number; y: number }> {
  const n = Math.min(xs.length, ys.length);
  const step = Math.max(1, Math.ceil(n / MAX_LINE_POINTS));
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i += step) {
    const y = ys[i]!;
    if (Number.isFinite(y)) pts.push({ x: xs[i]!, y });
  }
  return pts;
}

/**
 * Build the Figure Studio panel layout for one mechanism analysis. Rows are
 * filled row-major; tag letters a, b, c, ... label each panel.
 */
export function mechanismFigurePanels(input: {
  mode: 'fourbar' | 'velocity' | 'cam' | 'gear';
  sweep: FourBarSweep | null;
  cam: CamResult | null;
}): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  let i = 0;

  if ((input.mode === 'fourbar' || input.mode === 'velocity') && input.sweep) {
    const s = input.sweep;
    // Panel a: coupler curve (x/y path).
    const path: Array<{ x: number; y: number }> = [];
    for (let k = 0; k < s.couplerX.length; k += 1) {
      if (Number.isFinite(s.couplerX[k]!) && Number.isFinite(s.couplerY[k]!)) {
        path.push({ x: s.couplerX[k]!, y: s.couplerY[k]! });
      }
    }
    if (path.length >= 2) {
      panels.push(
        linePanel(i, 'Coupler-point path', 'x / length', 'y / length', [
          { name: 'coupler curve', kind: 'line', color: COLOR_BLUE, points: path },
        ]),
      );
      i += 1;
    }
    // Panel b: transmission angle vs crank angle.
    const muPts = stridePairs(s.theta2Deg, s.muDeg);
    if (muPts.length >= 2) {
      const series: PlotSeries[] = [{ name: 'mu', kind: 'line', color: COLOR_BLUE, points: muPts }];
      if (s.minTransmissionDeg < 40 && s.maxTransmissionDeg > 40) {
        series.push({
          name: '40 deg guideline',
          kind: 'line',
          color: COLOR_TAN,
          dash: [4, 3],
          points: [
            { x: 0, y: 40 },
            { x: 360, y: 40 },
          ],
        });
      }
      panels.push(linePanel(i, 'Transmission angle', 'crank angle / deg', 'mu / deg', series));
      i += 1;
    }
    // Panel c: coupler-point speed vs crank angle.
    if (input.mode === 'velocity') {
      const vPts = stridePairs(s.theta2Deg, s.vPmag);
      if (vPts.length >= 2) {
        panels.push(
          linePanel(i, 'Coupler-point speed', 'crank angle / deg', '|vP| / length·s⁻¹', [
            { name: '|vP|', kind: 'line', color: COLOR_SAGE, points: vPts },
          ]),
        );
      }
    }
  }

  if (input.mode === 'cam' && input.cam) {
    const cam = input.cam;
    const thetas = cam.samples.map((smp) => smp.thetaDeg);
    // Panel: follower displacement with segment boundaries.
    const sPts = stridePairs(thetas, cam.samples.map((smp) => smp.s));
    if (sPts.length >= 2) {
      panels.push(
        linePanel(i, 'Follower displacement', 'cam angle / deg', 's / length', [
          { name: 's', kind: 'line', color: COLOR_BLUE, points: sPts },
        ]),
      );
      i += 1;
    }
    // Panel: pressure angle with the 30 deg guideline.
    const aPts = stridePairs(thetas, cam.samples.map((smp) => smp.pressureDeg));
    if (aPts.length >= 2) {
      panels.push(
        linePanel(i, 'Pressure angle', 'cam angle / deg', 'alpha / deg', [
          { name: 'alpha', kind: 'line', color: COLOR_ROSE, points: aPts },
          {
            name: '30 deg guideline',
            kind: 'line',
            color: COLOR_TAN,
            dash: [4, 3],
            points: [
              { x: 0, y: 30 },
              { x: 360, y: 30 },
            ],
          },
        ]),
      );
      i += 1;
    }
    // Panel: follower acceleration.
    const accPts = stridePairs(thetas, cam.samples.map((smp) => smp.dds));
    if (accPts.length >= 2) {
      panels.push(
        linePanel(i, 'Follower acceleration', 'cam angle / deg', 'd²s/dθ² / length·rad⁻²', [
          { name: 'd2s/dθ2', kind: 'line', color: COLOR_SAGE, points: accPts },
        ]),
      );
    }
  }

  return panels;
}
