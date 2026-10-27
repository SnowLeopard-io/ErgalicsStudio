// ==========================================================================
// math-numerics — Figure Studio panels
//
// Pure builder: re-runs the kernel algorithms into publication-grade
// PlotSpec panels (no DOM, no store access).
//
// Charts delivered:
//   a. root-finding error decay: |x_k − root| per iteration for bisection,
//      Newton–Raphson and secant (log y — linear vs quadratic vs 1.618);
//   b. quadrature error vs panel count, log-log: trapezoidal / Simpson /
//      composite Gauss–Legendre against the closed-form integral, with the
//      measured convergence order in each legend entry;
//   c. finite-difference error vs step h, log-log: forward / backward /
//      central (truncation-dominated window, measured vs theoretical order);
//   d. interpolation: exact function curve, Lagrange polynomial, natural and
//      clamped cubic splines, with the equispaced nodes overlaid.
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
  FD_STEP_LADDER,
  PANEL_LADDER,
  backwardDiff,
  bisectRoot,
  centralDiff,
  compositeGauss,
  cubicSpline,
  equiNodes,
  fitLogLogOrder,
  forwardDiff,
  lagrangeInterp,
  newtonRoot,
  secantRoot,
  simpson,
  splineEval,
  trapezoidal,
  type SampleFunction,
} from './kernel';

export interface NumericsFigureInput {
  sample: SampleFunction;
  /** Root iterations drawn in the convergence panel. */
  iters: number;
  /** Base panel count for the quadrature panel (ladder ∪ {panels}). */
  panels: number;
  /** Interpolation node count. */
  nodes: number;
}

/** Chart colours shared with the canvas renderer. */
export const NUMERICS_COLORS = {
  blue: '#6db4ff',
  orange: '#ffb250',
  teal: '#4be1c3',
  amber: '#f5a623',
  red: '#ff7a7a',
  grey: '#c8d2e1',
} as const;

function positive(points: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  return points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y > 0);
}

export function numericsFigurePanels(input: NumericsFigureInput): FigurePanelSpec[] {
  const { sample, iters, panels, nodes } = input;
  const panelsOut: FigurePanelSpec[] = [];
  let i = 0;

  const push = (title: string, xLabel: string, yLabel: string, series: PlotSeries[], extra?: Partial<PlotSpec>): void => {
    // Drop series without at least two plottable points (e.g. a rule that is
    // exact for the sample, whose errors sit at machine precision).
    const usable = series.filter((s) => (s.points?.length ?? 0) >= 2);
    if (usable.length === 0) return;
    panelsOut.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title,
        xLabel,
        yLabel,
        grid: true,
        ticks: 4,
        legend: true,
        series: usable,
        ...extra,
      } as PlotSpec,
    });
    i += 1;
  };

  // --- panel a: root-finding error decay (log y) ---------------------------------
  const [ba, bb] = sample.bracket;
  const bis = bisectRoot(sample.f, ba, bb, Math.max(4, iters), sample.root);
  const newt = newtonRoot(sample.f, sample.df, ba + 0.3 * (bb - ba), Math.max(4, iters), sample.root);
  const sec = secantRoot(sample.f, ba, ba + 0.3 * (bb - ba), Math.max(4, iters), sample.root);
  const decay = (steps: Array<{ k: number; err: number }>): Array<{ x: number; y: number }> =>
    positive(steps.map((s) => ({ x: s.k, y: s.err })));
  push(
    'Root-finding error decay',
    'iteration k',
    '|x_k − root|',
    [
      { name: 'bisection', kind: 'line', color: NUMERICS_COLORS.blue, points: decay(bis.steps) },
      { name: 'Newton', kind: 'line', color: NUMERICS_COLORS.orange, points: decay(newt.steps) },
      { name: 'secant', kind: 'line', color: NUMERICS_COLORS.teal, points: decay(sec.steps) },
    ],
    { yScale: 'log' },
  );

  // --- panel b: quadrature error vs panel count (log-log) -------------------------
  const ladder = [...new Set([...PANEL_LADDER, Math.max(2, Math.min(64, Math.round(panels)))])].sort(
    (x, y) => x - y,
  );
  const ref = sample.integral.value;
  const trapPts: Array<{ x: number; y: number }> = [];
  const simpPts: Array<{ x: number; y: number }> = [];
  const gaussPts: Array<{ x: number; y: number }> = [];
  for (const n of ladder) {
    trapPts.push({ x: n, y: Math.abs(trapezoidal(sample.f, sample.integral.a, sample.integral.b, n) - ref) });
    simpPts.push({ x: n, y: Math.abs(simpson(sample.f, sample.integral.a, sample.integral.b, n) - ref) });
    gaussPts.push({ x: n, y: Math.abs(compositeGauss(sample.f, sample.integral.a, sample.integral.b, n, 3) - ref) });
  }
  const orderOf = (pts: Array<{ x: number; y: number }>): number =>
    fitLogLogOrder(
      pts.map((p) => p.x),
      pts.map((p) => p.y),
      1e-13,
    );
  const fmtOrder = (p: number, th: number): string => `p=${Number.isFinite(p) ? p.toFixed(2) : '–'}/${th}`;
  push('Quadrature error vs panels', 'panel count n', '|I_h − I|', [
    { name: `trapezoid (${fmtOrder(orderOf(trapPts), 2)})`, kind: 'line', color: NUMERICS_COLORS.blue, points: positive(trapPts) },
    { name: `Simpson (${fmtOrder(orderOf(simpPts), 4)})`, kind: 'line', color: NUMERICS_COLORS.orange, points: positive(simpPts) },
    { name: `Gauss-3 (${fmtOrder(orderOf(gaussPts), 6)})`, kind: 'line', color: NUMERICS_COLORS.amber, points: positive(gaussPts) },
  ], { xScale: 'log', yScale: 'log' });

  // --- panel c: finite-difference error vs step h (log-log) -----------------------
  const xDiff = sample.xDiff;
  const fwdPts: Array<{ x: number; y: number }> = [];
  const bwdPts: Array<{ x: number; y: number }> = [];
  const cenPts: Array<{ x: number; y: number }> = [];
  for (const h of FD_STEP_LADDER) {
    const exact = sample.df(xDiff);
    fwdPts.push({ x: h, y: Math.abs(forwardDiff(sample.f, xDiff, h) - exact) });
    bwdPts.push({ x: h, y: Math.abs(backwardDiff(sample.f, xDiff, h) - exact) });
    cenPts.push({ x: h, y: Math.abs(centralDiff(sample.f, xDiff, h) - exact) });
  }
  const fdOrder = (full: Array<{ x: number; y: number }>): number => {
    const win = full.filter((p) => p.x >= 1e-4);
    return fitLogLogOrder(
      win.map((p) => p.x),
      win.map((p) => p.y),
      1e-13,
    );
  };
  push('Finite-difference error vs step h', 'h', '|D_h − f′|', [
    { name: `forward (${fmtOrder(fdOrder(fwdPts), 1)})`, kind: 'line', color: NUMERICS_COLORS.blue, points: positive(fwdPts) },
    { name: `backward (${fmtOrder(fdOrder(bwdPts), 1)})`, kind: 'line', color: NUMERICS_COLORS.orange, points: positive(bwdPts) },
    { name: `central (${fmtOrder(fdOrder(cenPts), 2)})`, kind: 'line', color: NUMERICS_COLORS.teal, points: positive(cenPts) },
  ], { xScale: 'log', yScale: 'log' });

  // --- panel d: interpolation vs the exact function --------------------------------
  const xs = equiNodes(sample.range[0], sample.range[1], nodes);
  const ys = xs.map((x) => sample.f(x));
  const naturalSegs = cubicSpline(xs, ys, 'natural');
  const clampedSegs = cubicSpline(xs, ys, 'clamped', [sample.df(xs[0]!), sample.df(xs[xs.length - 1]!)]);
  const exactPts: Array<{ x: number; y: number }> = [];
  const lagPts: Array<{ x: number; y: number }> = [];
  const natPts: Array<{ x: number; y: number }> = [];
  const claPts: Array<{ x: number; y: number }> = [];
  const [r0, r1] = sample.range;
  const STEPS = 160;
  for (let s = 0; s <= STEPS; s += 1) {
    const x = r0 + ((r1 - r0) * s) / STEPS;
    exactPts.push({ x, y: sample.f(x) });
    lagPts.push({ x, y: lagrangeInterp(xs, ys, x) });
    natPts.push({ x, y: splineEval(naturalSegs, xs, x) });
    claPts.push({ x, y: splineEval(clampedSegs, xs, x) });
  }
  push('Interpolation vs exact function', 'x', 'f(x)', [
    { name: 'exact', kind: 'line', color: NUMERICS_COLORS.grey, points: exactPts.filter((p) => Number.isFinite(p.y)) },
    { name: `Lagrange n=${nodes}`, kind: 'line', color: NUMERICS_COLORS.orange, points: lagPts.filter((p) => Number.isFinite(p.y)) },
    { name: 'natural spline', kind: 'line', color: NUMERICS_COLORS.teal, points: natPts.filter((p) => Number.isFinite(p.y)) },
    { name: 'clamped spline', kind: 'line', color: NUMERICS_COLORS.amber, points: claPts.filter((p) => Number.isFinite(p.y)) },
    { name: 'nodes', kind: 'scatter', color: NUMERICS_COLORS.red, points: xs.map((x, k) => ({ x, y: ys[k]! })).filter((p) => Number.isFinite(p.y)) },
  ]);

  return panelsOut;
}
