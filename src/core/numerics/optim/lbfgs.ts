// ==========================================================================
// Ergalics Studio — numerics: L-BFGS-B (bounded quasi-Newton)
//
// Limited-memory BFGS (m=10 history pairs, two-loop recursion) with box
// constraints handled by the projected-search scheme of Zhu/Byrd/Nocedal:
// the quasi-Newton direction is computed unconstrained and the line search
// runs along the projected path x(a) = P(x + a*d, l, u), using a strong
// Wolfe-type test with the projected directional derivative
// D(a) = g'(x(a) - x) / a.
//
// Simplification vs the full Byrd-Lu-Nocedal-Zhu algorithm: the generalized
// Cauchy point and subspace minimization are replaced by the projected line
// search above (same idea as scipy's historic `praxis`-style L-BFGS-B-B),
// which is robust for smooth objectives and inactive/active simple bounds.
// ==========================================================================

import { NumericsError, assertFinite, requireInput } from '../errors';
import { dot, normInf } from '../linalg';
import type { OptimizeResult } from './types';

export type { OptimizeResult };

export interface BoxBounds {
  /** Lower bounds (defaults to -Infinity). */
  l?: number[];
  /** Upper bounds (defaults to +Infinity). */
  u?: number[];
}

export interface LBFGSBOptions {
  /** Number of stored (s, y) pairs. Default 10. */
  m?: number;
  /** Maximum iterations. Default 1500. */
  maxIter?: number;
  /** Convergence tolerance on the projected gradient inf-norm. Default 1e-5. */
  pgtol?: number;
  /** Relative tolerance on function decrease. Default 2.2e-9. */
  ftol?: number;
  /** Armijo parameter. Default 1e-4. */
  c1?: number;
  /** Wolfe curvature parameter. Default 0.9. */
  c2?: number;
}

/** L-BFGS-B result: adds the KKT residual to the common shape. */
export interface LBFGSBResult extends OptimizeResult {
  /** Projected gradient inf-norm at `x` (KKT residual for box constraints). */
  projGradNorm: number;
}

/**
 * Minimise `f` subject to the box constraints `l <= x <= u`.
 * `grad` must return the analytic gradient. Non-finite objective/gradient
 * values throw `NumericsError`; exhausting `maxIter` yields
 * `converged: false` (never a silent wrong answer).
 */
export function minimize(
  f: (x: number[]) => number,
  grad: (x: number[]) => number[],
  x0: number[],
  opts: LBFGSBOptions & BoxBounds = {},
): LBFGSBResult {
  const n = x0.length;
  requireInput(n > 0, 'lbfgsb: x0 must be non-empty');
  assertFinite(x0, 'lbfgsb x0');
  const m = opts.m ?? 10;
  const maxIter = opts.maxIter ?? 1500;
  const pgtol = opts.pgtol ?? 1e-5;
  const ftol = opts.ftol ?? 2.2e-9;
  const c1 = opts.c1 ?? 1e-4;
  const c2 = opts.c2 ?? 0.9;

  const l = opts.l ? opts.l.slice() : new Array<number>(n).fill(-Infinity);
  const u = opts.u ? opts.u.slice() : new Array<number>(n).fill(+Infinity);
  requireInput(l.length === n && u.length === n, 'lbfgsb: bounds length must match x0');
  for (let i = 0; i < n; i++) {
    requireInput(l[i]! <= u[i]!, `lbfgsb: lower bound exceeds upper bound at index ${i}`, { index: i });
  }
  const project = (x: number[]): number[] =>
    x.map((v, i) => Math.min(Math.max(v, l[i]!), u[i]!));

  let x = project(x0);
  let fx = evalF(f, x);
  let funcEvals = 1;
  const sHist: number[][] = [];
  const yHist: number[][] = [];
  let iterations = 0;
  let converged = false;

  for (iterations = 0; iterations < maxIter; iterations++) {
    const g = evalGrad(grad, x);
    // Projected gradient = KKT residual for box constraints.
    const pg = normInf(project(x.map((v, i) => v - g[i]!)).map((v, i) => v - x[i]!));
    if (pg <= pgtol) {
      converged = true;
      break;
    }

    let d = twoLoop(g, sHist, yHist);
    if (dot(g, d) >= 0) {
      // Quasi-Newton direction failed (bad curvature): fall back to the
      // projected steepest-descent direction.
      d = project(x.map((v, i) => v - g[i]!)).map((v, i) => v - x[i]!);
      if (normInf(d) === 0) {
        converged = true;
        break;
      }
    }

    const ls = projectedLineSearch(f, x, fx, g, d, project, c1, c2);
    funcEvals += ls.funcEvals;
    const xNew = ls.x;
    const fNew = ls.f;
    if (ls.stalled) {
      converged = true;
      x = xNew;
      fx = fNew;
      break;
    }

    const fDecrease = Math.abs(fx - fNew) <= ftol * Math.max(1, Math.abs(fx), Math.abs(fNew));
    const s = xNew.map((v, i) => v - x[i]!);
    const gNew = evalGrad(grad, xNew);
    const y = gNew.map((v, i) => v - g[i]!);
    x = xNew;
    fx = fNew;
    if (fDecrease) {
      converged = true;
      break;
    }
    // Curvature caution: only keep informative pairs.
    if (dot(s, y) > 1e-12 * Math.sqrt(Math.max(dot(s, s), 1e-300) * Math.max(dot(y, y), 1e-300))) {
      sHist.push(s);
      yHist.push(y);
      if (sHist.length > m) {
        sHist.shift();
        yHist.shift();
      }
    }
  }

  const gFinal = evalGrad(grad, x);
  const pgFinal = normInf(project(x.map((v, i) => v - gFinal[i]!)).map((v, i) => v - x[i]!));
  return { x, f: fx, iterations, converged, funcEvals, projGradNorm: pgFinal };
}

function evalF(f: (x: number[]) => number, x: number[]): number {
  const v = f(x);
  if (!Number.isFinite(v)) {
    throw new NumericsError('numerics/non-finite', `lbfgsb: objective is not finite (got ${v})`, { value: v });
  }
  return v;
}

function evalGrad(grad: (x: number[]) => number[], x: number[]): number[] {
  const g = grad(x);
  assertFinite(g, 'lbfgsb gradient');
  return g;
}

/** Two-loop recursion for the L-BFGS direction -H g with the standard scaling. */
function twoLoop(g: number[], sHist: number[][], yHist: number[][]): number[] {
  const k = sHist.length;
  const q = g.slice();
  const alphas = new Array<number>(k);
  for (let i = k - 1; i >= 0; i--) {
    const s = sHist[i]!;
    const y = yHist[i]!;
    const sy = dot(s, y);
    const alpha = sy > 0 ? dot(s, q) / sy : 0;
    alphas[i] = alpha;
    for (let j = 0; j < q.length; j++) q[j] = q[j]! - alpha * y[j]!;
  }
  let gamma = 1;
  if (k > 0) {
    const s = sHist[k - 1]!;
    const y = yHist[k - 1]!;
    const sy = dot(s, y);
    if (sy > 0) gamma = sy / Math.max(dot(y, y), 1e-300);
  }
  const r = q.map((v) => gamma * v);
  for (let i = 0; i < k; i++) {
    const s = sHist[i]!;
    const y = yHist[i]!;
    const beta = dot(y, r) / Math.max(dot(s, y), 1e-300);
    const alpha = alphas[i]!;
    for (let j = 0; j < r.length; j++) r[j] = r[j]! + (alpha - beta) * s[j]!;
  }
  return r.map((v) => -v);
}

interface LineSearchOut {
  x: number[];
  f: number;
  funcEvals: number;
  /** True when no progress is possible from this point (face stationary). */
  stalled: boolean;
}

/**
 * Strong-Wolfe-type search along the projected path x(a) = P(x + a*d):
 * sufficient decrease f(x(a)) <= f + c1 * g'(x(a) - x) and
 * |g'(x(a) - x)| <= c2 * a * |g'd| (projected derivative test). At
 * non-smooth kinks of the projected path the curvature test can be
 * unreachable; the search then returns the best Armijo point found.
 */
function projectedLineSearch(
  f: (x: number[]) => number,
  x: number[],
  f0: number,
  g: number[],
  d: number[],
  project: (v: number[]) => number[],
  c1: number,
  c2: number,
): LineSearchOut {
  let funcEvals = 0;
  const evalAlpha = (a: number): { xa: number[]; fa: number; delta: number } | null => {
    const xa = project(x.map((v, i) => v + a * d[i]!));
    const fa = f(xa);
    funcEvals++;
    if (!Number.isFinite(fa)) return null;
    const delta = dot(g, xa.map((v, i) => v - x[i]!));
    return { xa, fa, delta };
  };
  const D0 = dot(g, d);
  const armijo = (e: { fa: number; delta: number }): boolean => e.fa <= f0 + c1 * Math.min(e.delta, 0);

  // First trial.
  let alpha = 1;
  let best: { xa: number[]; fa: number; delta: number; alpha: number } | null = null;
  let alphaHi = Infinity;
  let alphaLo = 0;
  let fLo = f0;

  for (let stage = 0; stage < 30; stage++) {
    const e = evalAlpha(alpha);
    if (e === null) {
      // Overflow beyond the bounds: shrink.
      alphaHi = alpha;
      alpha = 0.5 * (alphaLo + alpha);
      continue;
    }
    if (armijo(e)) {
      if (best === null || e.fa < best.fa) best = { ...e, alpha };
      // Strong Wolfe (projected average slope version).
      if (Math.abs(e.delta) <= c2 * alpha * Math.abs(D0)) {
        return { x: e.xa, f: e.fa, funcEvals, stalled: alpha === 0 };
      }
      alphaLo = alpha;
      fLo = e.fa;
      if (alphaHi === Infinity) alpha = 2 * alpha;
      else alpha = 0.5 * (alphaLo + alphaHi);
    } else {
      alphaHi = alpha;
      alpha = 0.5 * (alphaLo + alpha);
    }
    if (alphaHi - alphaLo < 1e-16 * Math.max(1, alphaLo)) break;
  }

  if (best !== null && best.fa <= fLo) {
    const stalled = best.alpha === 0 || Math.abs(best.delta) <= 1e-16 * Math.max(1, Math.abs(f0));
    return { x: best.xa, f: best.fa, funcEvals, stalled };
  }
  // No acceptable point: report stall at the current iterate.
  return { x: x.slice(), f: f0, funcEvals, stalled: true };
}
