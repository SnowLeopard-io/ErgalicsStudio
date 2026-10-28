// ==========================================================================
// math-linalg — Figure Studio panels
//
// Pure builder: re-derives the matrix action, eigenpairs, SVD chain and
// span projection into publication-grade PlotSpec panels (no DOM, no store
// access).
//
// Charts delivered:
//   a. Unit grid before / after the action of A — the same grid lines drawn
//      on both panels, so the affine map reads off directly, with the unit
//      square (the area |det| scales) highlighted in each frame.
//   b. Eigendirections: transformed unit square plus the unit directions vᵢ
//      and their images A·vᵢ = λᵢ vᵢ; complex pairs show the image ellipse
//      of the unit circle instead (no real eigen-directions exist).
//   c. SVD chain A = UΣVᵀ: unit circle → Vᵀ rotation → Σ axis stretch → U
//      rotation into the final ellipse, four curves on shared axes.
//   d. Span & projection: span line / plane, query vector w, its orthogonal
//      projection p and residual w − p (drawn isometrically for 3D input).
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
  eigenvalues2x2,
  eigenvector2x2,
  projectOntoSpan,
  svdJacobi,
  type Matrix,
} from './kernel';

export interface LinalgFigureInput {
  /** Row-major 2×2 matrix driving every panel. */
  matrix: Matrix;
  /** Basis vectors spanning the subspace (1 = line, 2 = plane). */
  basis: number[][];
  /** Query vector projected onto the span. */
  query: number[];
}

/** Grid line coordinates of the figure unit grid (three lines per axis). */
const GRID = [-2, 0, 2];

type Pt = { x: number; y: number };

function applyMat(m: Matrix, p: Pt): Pt {
  return { x: m[0]![0]! * p.x + m[0]![1]! * p.y, y: m[1]![0]! * p.x + m[1]![1]! * p.y };
}

function unitSquare(): Pt[] {
  return [
    { x: -1, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
  ];
}

/** Horizontal / vertical grid lines over [−2, 2]² plus the closed unit square. */
function gridPaths(): Pt[][] {
  const paths: Pt[][] = [];
  for (const c of GRID) {
    paths.push([
      { x: -2, y: c },
      { x: 2, y: c },
    ]);
    paths.push([
      { x: c, y: -2 },
      { x: c, y: 2 },
    ]);
  }
  paths.push(unitSquare());
  return paths;
}

function mapPaths(paths: Pt[][], f: (p: Pt) => Pt): Pt[][] {
  return paths.map((path) => path.map(f));
}

function lineSeries(name: string, color: string, pts: Pt[], dash?: number[]): PlotSeries {
  return dash ? { name, kind: 'line', color, points: pts, dash } : { name, kind: 'line', color, points: pts };
}

/** Symmetric square data window covering every point of the given series. */
function squareDomain(series: PlotSeries[], pad = 1.12): [number, number] {
  let m = 1e-6;
  for (const s of series) {
    for (const p of s.points ?? []) m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
  }
  const h = m * pad;
  return [-h, h];
}

/** Isometric embedding of a 3D point for the projection panel. */
function iso(v: number[]): Pt {
  const x = v[0] ?? 0;
  const y = v[1] ?? 0;
  const z = v[2] ?? 0;
  return { x: (x - y) * 0.866, y: (x + y) * 0.5 - z };
}

function norm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

export function linalgFigurePanels(input: LinalgFigureInput): FigurePanelSpec[] {
  const { matrix, basis, query } = input;
  const panels: FigurePanelSpec[] = [];
  let i = 0;
  const paths = gridPaths();

  const push = (title: string, xLabel: string, yLabel: string, series: PlotSeries[], legend: boolean, domain?: [number, number]): void => {
    if (series.length === 0) return;
    const dom = domain ?? squareDomain(series);
    panels.push({
      ...panelPlace(i),
      tag: panelTag(i),
      spec: {
        width: FIGURE_PANEL_WIDTH,
        height: FIGURE_PANEL_HEIGHT,
        title,
        xLabel,
        yLabel,
        xDomain: dom,
        yDomain: dom,
        legend,
        grid: true,
        ticks: 5,
        series,
      } as PlotSpec,
    });
    i += 1;
  };

  // --- panel a: unit grid before / after A --------------------------------------
  const gridA: PlotSeries[] = [];
  paths.forEach((path, k) => {
    const isSquare = k === paths.length - 1;
    gridA.push(lineSeries(isSquare ? 'unit square (before)' : `grid ${k + 1} (before)`, isSquare ? '#4be1c3' : '#6db4ff', path));
    gridA.push(lineSeries(isSquare ? 'unit square (after A)' : `grid ${k + 1} (after A)`, isSquare ? '#f5a623' : '#ffb250', mapPaths([path], (p) => applyMat(matrix, p))[0]!));
  });
  push('Unit grid before / after the action of A', 'x', 'y', gridA, false);

  // --- panel b: eigendirections and their images --------------------------------
  const [l1, l2] = eigenvalues2x2(matrix[0]![0]!, matrix[0]![1]!, matrix[1]![0]!, matrix[1]![1]!);
  const eigSeries: PlotSeries[] = [
    lineSeries('A · unit square', '#6db4ff', mapPaths([unitSquare()], (p) => applyMat(matrix, p))[0]!),
  ];
  const realPair = Math.abs(l1.im) < 1e-12 && Math.abs(l2.im) < 1e-12;
  if (realPair) {
    const v1 = eigenvector2x2(matrix[0]![0]!, matrix[0]![1]!, matrix[1]![0]!, matrix[1]![1]!, l1);
    const v2 = eigenvector2x2(matrix[0]![0]!, matrix[0]![1]!, matrix[1]![0]!, matrix[1]![1]!, l2);
    const seg = (dx: number, dy: number): Pt[] => [{ x: 0, y: 0 }, { x: dx, y: dy }];
    const s1 = seg(v1[0].re, v1[1].re);
    const s2 = seg(v2[0].re, v2[1].re);
    const i1 = seg(l1.re * v1[0].re, l1.re * v1[1].re);
    const i2 = seg(l2.re * v2[0].re, l2.re * v2[1].re);
    eigSeries.push(lineSeries('v₁ (unit)', '#4be1c3', s1));
    eigSeries.push(lineSeries('A·v₁ = λ₁ v₁', '#ff7a7a', i1));
    eigSeries.push(lineSeries('v₂ (unit)', '#f5a623', s2));
    eigSeries.push(lineSeries('A·v₂ = λ₂ v₂', '#ffb250', i2));
    push('Eigendirections and their images (real pair)', 'x', 'y', eigSeries, true);
  } else {
    const circle: Pt[] = [];
    for (let k = 0; k <= 72; k += 1) {
      const t = (2 * Math.PI * k) / 72;
      circle.push(applyMat(matrix, { x: Math.cos(t), y: Math.sin(t) }));
    }
    eigSeries.push(lineSeries('A · unit circle (complex pair)', '#ff7a7a', circle));
    push('Eigendirections: complex pair (image ellipse)', 'x', 'y', eigSeries, true);
  }

  // --- panel c: SVD chain A = UΣVᵀ ----------------------------------------------
  const { U, sigma, V } = svdJacobi(matrix);
  const stage2: Pt[] = [];
  const stage3: Pt[] = [];
  const stage4: Pt[] = [];
  for (let k = 0; k <= 72; k += 1) {
    const t = (2 * Math.PI * k) / 72;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const rx = V[0]![0]! * c + V[1]![0]! * s;
    const ry = V[0]![1]! * c + V[1]![1]! * s;
    stage2.push({ x: rx, y: ry });
    const sx = (sigma[0] ?? 0) * rx;
    const sy = (sigma[1] ?? 0) * ry;
    stage3.push({ x: sx, y: sy });
    stage4.push({
      x: U[0]![0]! * sx + U[0]![1]! * sy,
      y: U[1]![0]! * sx + U[1]![1]! * sy,
    });
  }
  const circle0: Pt[] = [];
  for (let k = 0; k <= 72; k += 1) {
    const t = (2 * Math.PI * k) / 72;
    circle0.push({ x: Math.cos(t), y: Math.sin(t) });
  }
  push(
    'SVD chain A = U·Σ·Vᵀ',
    'x',
    'y',
    [
      lineSeries('1 unit circle', '#4be1c3', circle0),
      lineSeries('2 after Vᵀ', '#6db4ff', stage2),
      lineSeries('3 after Σ', '#ffb250', stage3),
      lineSeries('4 after U (A·circle)', '#ff7a7a', stage4),
    ],
    true,
  );

  // --- panel d: span and projection ----------------------------------------------
  const proj = projectOntoSpan(query, basis);
  const threeD = query.length >= 3;
  const toPt = (v: number[]): Pt => (threeD ? iso(v) : { x: v[0] ?? 0, y: v[1] ?? 0 });
  const spanSeries: PlotSeries[] = [];
  const lens = basis.map((b) => Math.max(norm(b), 1e-9));
  const maxLen = Math.max(...lens, 1e-9);
  if (basis.length >= 2 && proj.dimension >= 2) {
    const t1 = 1.6 / lens[0]!;
    const t2 = 1.6 / lens[1]!;
    const u1 = basis[0]!.map((x) => x * t1);
    const u2 = basis[1]!.map((x) => x * t2);
    const corner = (a: number, b: number): Pt => toPt([0, 1, 2].map((k) => a * (u1[k] ?? 0) + b * (u2[k] ?? 0)));
    spanSeries.push(
      lineSeries('span plane', '#4be1c3', [
        corner(-1, -1),
        corner(1, -1),
        corner(1, 1),
        corner(-1, 1),
        corner(-1, -1),
      ]),
    );
  } else {
    const t = 3 / maxLen;
    const tip = basis[0]!.map((x) => x * t);
    spanSeries.push(lineSeries('span line', '#4be1c3', [toPt(tip.map((x) => -x)), toPt(tip)]));
  }
  if (basis[0]) spanSeries.push(lineSeries('u₁', '#6db4ff', [{ x: 0, y: 0 }, toPt(basis[0])]));
  if (basis[1] && proj.dimension >= 2) spanSeries.push(lineSeries('u₂', '#ffb250', [{ x: 0, y: 0 }, toPt(basis[1])]));
  spanSeries.push(lineSeries('w (query)', '#f5a623', [{ x: 0, y: 0 }, toPt(query)]));
  spanSeries.push(lineSeries('p = projection(w)', '#ff7a7a', [{ x: 0, y: 0 }, toPt(proj.projection)]));
  spanSeries.push(
    lineSeries('w − p (orthogonal)', '#ff7a7a', [toPt(proj.projection), toPt(query)], [4, 3]),
  );
  push(
    threeD ? 'Span and projection (isometric 3D)' : 'Span and projection (2D)',
    threeD ? 'iso u' : 'x',
    threeD ? 'iso v' : 'y',
    spanSeries,
    true,
  );

  return panels;
}
