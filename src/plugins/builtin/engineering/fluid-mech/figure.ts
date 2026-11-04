// ==========================================================================
// eng-fluid — Figure Studio panels
//
// Turns a completed fluid-mechanics analysis into publication-grade PlotSpec
// panels, mirroring the eng-control layout convention (row-major panels with
// tag letters):
//   pipe      — Moody chart (log–log) with laminar branch, Colebrook–White
//               curves, the Blasius correlation and the operating point.
//   bernoulli — duct velocity/diameter profile and the HGL/EGL head lines.
//   bl        — boundary-layer thickness growth, skin-friction coefficient
//               and the similarity profiles (Blasius vs Pohlhausen).
//   stream    — surface speed ratio of the analytic body (sphere/cylinder).
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
  type BodyKind,
  type DuctParams,
  type DuctStation,
  type MoodyPoint,
} from './kernel';

/** Max points per drawn line — dense curves are strided for the figure. */
const MAX_LINE_POINTS = 800;

function linePanel(
  ordinal: number,
  title: string,
  xLabel: string,
  yLabel: string,
  series: PlotSeries[],
  xScale?: 'linear' | 'log',
  yScale?: 'linear' | 'log',
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
      ...(yScale ? { yScale } : {}),
      series,
    } as PlotSpec,
  };
}

function stridePoints(xs: number[], ys: number[]): Array<{ x: number; y: number }> {
  const n = Math.min(xs.length, ys.length);
  const stride = Math.max(1, Math.ceil(n / MAX_LINE_POINTS));
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i += stride) pts.push({ x: xs[i]!, y: ys[i]! });
  const last = n - 1;
  if (n > 0 && (n - 1) % stride !== 0) pts.push({ x: xs[last]!, y: ys[last]! });
  return pts;
}

// ---- per-mode payloads -------------------------------------------------------

export interface MoodyCurve {
  epsOverD: number;
  points: MoodyPoint[];
}

export interface MoodyPayload {
  curves: MoodyCurve[];
  laminar: MoodyPoint[];
  blasius: MoodyPoint[];
  op: MoodyPoint;
}

export interface DuctPayload {
  params: DuctParams;
  stations: DuctStation[];
}

export interface BlPayload {
  xs: number[];
  delta: number[];
  deltaStar: number[];
  theta: number[];
  cf: number[];
  /** Similarity profiles: Blasius f'(η) and Pohlhausen u/U(η; λ). */
  eta: number[];
  blasiusProfile: number[];
  pohlhausenProfile: number[];
  lambda: number;
  separated: boolean;
}

export interface StreamPayload {
  body: BodyKind;
  /** Circumferential coordinate (degrees) and surface speed ratio |v|/U. */
  thetaDeg: number[];
  speedRatio: number[];
  cl: number;
}

export interface FigurePayload {
  moody?: MoodyPayload;
  duct?: DuctPayload;
  bl?: BlPayload;
  stream?: StreamPayload;
}

export type FluidMode = 'pipe' | 'bernoulli' | 'bl' | 'stream';

/**
 * Build the Figure Studio panel layout for one fluid-mechanics analysis.
 * Rows are filled row-major; tag letters a, b, c, … label each panel.
 */
export function fluidFigurePanels(mode: FluidMode, data: FigurePayload): FigurePanelSpec[] {
  if (mode === 'pipe' && data.moody) return pipePanels(data.moody);
  if (mode === 'bernoulli' && data.duct) return ductPanels(data.duct);
  if (mode === 'bl' && data.bl) return blPanels(data.bl);
  if (mode === 'stream' && data.stream) return streamPanels(data.stream);
  return [];
}

// ---- pipe: Moody chart --------------------------------------------------------

function pipePanels(m: MoodyPayload): FigurePanelSpec[] {
  const series: PlotSeries[] = [];
  for (const c of m.curves) {
    series.push({
      name: `ε/d = ${c.epsOverD === 0 ? '0' : c.epsOverD.toExponential(0)}`,
      kind: 'line',
      color: '#5abfff',
      points: stridePoints(c.points.map((p) => p.re), c.points.map((p) => p.f)),
    });
  }
  series.push({
    name: 'laminar 64/Re',
    kind: 'line',
    color: '#5dd0a8',
    dash: [4, 3],
    points: stridePoints(m.laminar.map((p) => p.re), m.laminar.map((p) => p.f)),
  });
  series.push({
    name: 'Blasius 0.3164/Re^0.25',
    kind: 'line',
    color: '#ffd166',
    dash: [2, 3],
    points: stridePoints(m.blasius.map((p) => p.re), m.blasius.map((p) => p.f)),
  });
  series.push({
    name: 'operating point',
    kind: 'scatter',
    color: '#e88f6a',
    points: [{ x: m.op.re, y: m.op.f }],
  });
  return [linePanel(0, 'Moody chart (Colebrook–White)', 'Re', 'Darcy f', series, 'log', 'log')];
}

// ---- bernoulli: duct profile + head lines --------------------------------------

function ductPanels(d: DuctPayload): FigurePanelSpec[] {
  const xs = d.stations.map((s) => s.x);
  const panels: FigurePanelSpec[] = [];
  panels.push(
    linePanel(panels.length, 'Duct geometry + velocity (continuity)', 'x / m', 'd, v / m·s⁻¹', [
      { name: 'diameter d(x) ×5', kind: 'line', color: '#aab6c8', dash: [4, 3], points: stridePoints(xs, d.stations.map((s) => s.d * 5)) },
      { name: 'v(x)', kind: 'line', color: '#5abfff', points: stridePoints(xs, d.stations.map((s) => s.v)) },
    ]),
  );
  panels.push(
    linePanel(panels.length, 'Head lines (ideal flow)', 'x / m', 'head / m', [
      { name: 'HGL p/(ρg)', kind: 'line', color: '#5dd0a8', points: stridePoints(xs, d.stations.map((s) => s.hgl)) },
      { name: 'EGL p/(ρg)+v²/(2g)', kind: 'line', color: '#ffd166', dash: [5, 4], points: stridePoints(xs, d.stations.map((s) => s.egl)) },
    ]),
  );
  return panels;
}

// ---- boundary layer: growth + profiles -----------------------------------------

function blPanels(b: BlPayload): FigurePanelSpec[] {
  const panels: FigurePanelSpec[] = [];
  panels.push(
    linePanel(panels.length, 'Blasius boundary-layer growth', 'x / m', 'thickness / m', [
      { name: 'δ99', kind: 'line', color: '#5abfff', points: stridePoints(b.xs, b.delta) },
      { name: 'δ*', kind: 'line', color: '#5dd0a8', dash: [4, 3], points: stridePoints(b.xs, b.deltaStar) },
      { name: 'θ', kind: 'line', color: '#ffd166', dash: [2, 3], points: stridePoints(b.xs, b.theta) },
    ]),
  );
  panels.push(
    linePanel(panels.length, 'Local skin-friction coefficient', 'x / m', 'cf', [
      { name: 'cf = 2f″(0)/√Rex', kind: 'line', color: '#e88f6a', points: stridePoints(b.xs, b.cf) },
    ]),
  );
  panels.push(
    linePanel(panels.length, `Similarity profiles (λ = ${b.lambda})`, 'u/U', 'η', [
      { name: 'Blasius f′(η)', kind: 'line', color: '#5abfff', points: stridePoints(b.blasiusProfile, b.eta) },
      { name: `Pohlhausen λ=${b.lambda}`, kind: 'line', color: '#5dd0a8', dash: [4, 3], points: stridePoints(b.pohlhausenProfile, b.eta) },
      ...(b.separated
        ? [{ name: 'separated (λ ≤ −12)', kind: 'scatter' as const, color: '#e06c75', points: [{ x: 0, y: 0 }] }]
        : []),
    ]),
  );
  return panels;
}

// ---- stream: surface speed -------------------------------------------------------

function streamPanels(s: StreamPayload): FigurePanelSpec[] {
  const bodyName = s.body === 'sphere' ? 'sphere' : 'cylinder';
  const series: PlotSeries[] = [
    { name: `|v_surface|/U (${bodyName})`, kind: 'line', color: '#5abfff', points: stridePoints(s.thetaDeg, s.speedRatio) },
  ];
  if (s.body === 'cylinder' && s.cl !== 0) {
    series.push({ name: `Cl = ${s.cl.toFixed(3)}`, kind: 'scatter', color: '#e88f6a', points: [] });
  }
  return [linePanel(0, 'Surface speed ratio vs angle', 'θ / deg', '|v|/U', series)];
}
