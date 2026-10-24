// ==========================================================================
// Ergalics Studio — numerics: Nelder-Mead simplex minimiser
//
// Standard Nelder-Mead (reflection / expansion / outside & inside
// contraction / shrink) with the adaptive initial simplex of Nash
// (step = 5% per coordinate, 0.025% for zero coordinates) and a
// classic coefficient set (rho=1, chi=2, gamma=0.5, sigma=0.5).
// Non-finite objective values are treated as +Infinity so such vertices are
// naturally discarded instead of poisoning the simplex ordering.
// ==========================================================================

import { assertFinite, requireInput } from '../errors';
import type { OptimizeResult } from './types';

export interface NelderMeadOptions {
  /** Initial simplex edge length per coordinate (default: 5% of |x_i| or 0.00025). */
  initialStep?: number | number[];
  /** Max iterations. Default 1000. */
  maxIter?: number;
  /** Tolerance on the simplex function-value spread. Default 1e-10. */
  ftol?: number;
  /** Tolerance on the simplex geometric spread. Default 1e-8. */
  xtol?: number;
}

/**
 * Minimise `f` from a starting point `x0` (deterministic, derivative-free).
 * Bounds are not supported; exhaustion of `maxIter` is reported via
 * `converged: false`.
 */
export function minimizeNM(
  f: (x: number[]) => number,
  x0: number[],
  opts: NelderMeadOptions = {},
): OptimizeResult {
  const n = x0.length;
  requireInput(n > 0, 'neldermead: x0 must be non-empty');
  assertFinite(x0, 'neldermead x0');
  const maxIter = opts.maxIter ?? 1000;
  const ftol = opts.ftol ?? 1e-10;
  const xtol = opts.xtol ?? 1e-8;

  // Safe wrapper: non-finite -> +Infinity (sorts to the worst vertex).
  const obj = (x: number[]): number => {
    const v = f(x);
    return Number.isFinite(v) ? v : Infinity;
  };

  // Adaptive initial simplex.
  const steps: number[] = [];
  if (opts.initialStep === undefined) {
    for (let i = 0; i < n; i++) steps.push(x0[i]! !== 0 ? 0.05 * Math.abs(x0[i]!) : 0.00025);
  } else if (typeof opts.initialStep === 'number') {
    for (let i = 0; i < n; i++) steps.push(opts.initialStep);
  } else {
    requireInput(opts.initialStep.length === n, 'neldermead: initialStep length must match x0');
    for (let i = 0; i < n; i++) steps.push(opts.initialStep[i]!);
  }

  const rho = 1;
  const chi = 2;
  const gamma = 0.5;
  const sigma = 0.5;

  // Simplex: n+1 vertices, each with cached objective value.
  const simplex: { x: number[]; f: number }[] = [{ x: x0.slice(), f: obj(x0) }];
  let funcEvals = 1;
  for (let i = 0; i < n; i++) {
    const v = x0.slice();
    v[i] = x0[i]! + steps[i]!;
    simplex.push({ x: v, f: obj(v) });
    funcEvals++;
  }

  const sortSimplex = (): void => {
    simplex.sort((a, b) => a.f - b.f);
  };

  let iterations = 0;
  let converged = false;
  for (iterations = 0; iterations < maxIter; iterations++) {
    sortSimplex();
    const best = simplex[0]!;
    const worst = simplex[n]!;
    const secondWorst = simplex[n - 1]!;

    // Convergence: value spread small or simplex collapsed.
    const fSpread = worst.f - best.f;
    let xSpread = 0;
    for (let i = 1; i <= n; i++) {
      for (let j = 0; j < n; j++) xSpread = Math.max(xSpread, Math.abs(simplex[i]!.x[j]! - best.x[j]!));
    }
    if (fSpread <= ftol * Math.max(1, Math.abs(best.f)) && xSpread <= xtol) {
      converged = true;
      break;
    }

    // Centroid of all vertices except the worst.
    const centroid = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      const v = simplex[i]!.x;
      for (let j = 0; j < n; j++) centroid[j] = centroid[j]! + v[j]! / n;
    }

    // Reflection.
    const reflect = centroid.map((c, j) => c + rho * (c - worst.x[j]!));
    const fr = obj(reflect);
    funcEvals++;
    if (fr < best.f) {
      // Expansion.
      const expand = centroid.map((c, j) => c + chi * (reflect[j]! - c));
      const fe = obj(expand);
      funcEvals++;
      simplex[n] = fe < fr ? { x: expand, f: fe } : { x: reflect, f: fr };
      continue;
    }
    if (fr < secondWorst.f) {
      simplex[n] = { x: reflect, f: fr };
      continue;
    }
    // Contraction.
    if (fr < worst.f) {
      // Outside contraction.
      const outside = centroid.map((c, j) => c + gamma * (reflect[j]! - c));
      const fo = obj(outside);
      funcEvals++;
      if (fo <= fr) {
        simplex[n] = { x: outside, f: fo };
        continue;
      }
    } else {
      // Inside contraction.
      const inside = centroid.map((c, j) => c - gamma * (reflect[j]! - c));
      const fi = obj(inside);
      funcEvals++;
      if (fi < worst.f) {
        simplex[n] = { x: inside, f: fi };
        continue;
      }
    }
    // Shrink towards the best vertex.
    for (let i = 1; i <= n; i++) {
      const v = best.x.map((bv, j) => bv + sigma * (simplex[i]!.x[j]! - bv));
      simplex[i] = { x: v, f: obj(v) };
      funcEvals++;
    }
  }

  sortSimplex();
  const best = simplex[0]!;
  return { x: best.x, f: best.f, iterations, converged, funcEvals };
}
