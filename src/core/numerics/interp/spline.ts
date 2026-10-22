// ==========================================================================
// Ergalics Studio — numerics: cubic spline interpolation
//
// Natural or clamped cubic splines over strictly increasing knots,
// assembled as a tridiagonal system for the second derivatives M_i and
// solved with the Thomas algorithm. Evaluation outside the knot range
// extrapolates with the end-interval cubic piece.
// ==========================================================================

import { assertFinite, requireInput } from '../errors';
import { thomas } from '../linalg';

export interface SplineOptions {
  /** 'natural' (default): S'' = 0 at both ends. 'clamped': match end slopes. */
  boundary?: 'natural' | 'clamped';
  /** End slopes [S'(x0), S'(xn)] (required for 'clamped'). */
  derivs?: [number, number];
}

export interface Spline {
  /** Evaluate the spline (end-piece cubic extrapolation outside the knots). */
  eval: (x: number) => number;
  /** First derivative. */
  derivative: (x: number) => number;
  /** Second derivative. */
  secondDerivative: (x: number) => number;
  /** Knot count. */
  readonly n: number;
}

/**
 * Build an interpolating cubic spline through the points (xs[i], ys[i]).
 * Throws on non-finite data, mismatched lengths or non-increasing knots.
 */
export function createSpline(xs: number[], ys: number[], opts: SplineOptions = {}): Spline {
  const n = xs.length;
  requireInput(n >= 2, 'spline: at least two knots are required');
  requireInput(ys.length === n, 'spline: xs and ys must have the same length');
  assertFinite(xs, 'spline xs');
  assertFinite(ys, 'spline ys');
  for (let i = 1; i < n; i++) {
    requireInput(xs[i]! > xs[i - 1]!, `spline: knots must be strictly increasing (x[${i}])`);
  }

  const boundary = opts.boundary ?? 'natural';
  requireInput(boundary !== 'clamped' || opts.derivs !== undefined, 'spline: clamped boundary requires derivs');

  const m = n - 1; // number of intervals
  const h: number[] = new Array<number>(m);
  for (let i = 0; i < m; i++) h[i] = xs[i + 1]! - xs[i]!;

  // Solve for the second derivatives M_0..M_n.
  const M = new Array<number>(n).fill(0);
  if (n === 2 && boundary === 'natural') {
    // Single interval: natural spline is the straight line.
    M[0] = 0;
    M[1] = 0;
  } else {
    const lower = new Array<number>(n).fill(0);
    const diag = new Array<number>(n).fill(0);
    const upper = new Array<number>(n).fill(0);
    const rhs = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      lower[i] = h[i - 1]!;
      diag[i] = 2 * (h[i - 1]! + h[i]!);
      upper[i] = h[i]!;
      const slopeRight = (ys[i + 1]! - ys[i]!) / h[i]!;
      const slopeLeft = (ys[i]! - ys[i - 1]!) / h[i - 1]!;
      rhs[i] = 6 * (slopeRight - slopeLeft);
    }
    if (boundary === 'natural') {
      diag[0] = 1;
      rhs[0] = 0;
      diag[n - 1] = 1;
      rhs[n - 1] = 0;
    } else {
      const [d0, dn] = opts.derivs!;
      assertFinite([d0, dn], 'spline derivs');
      diag[0] = 2 * h[0]!;
      upper[0] = h[0]!;
      rhs[0] = 6 * ((ys[1]! - ys[0]!) / h[0]! - d0);
      lower[n - 1] = h[m - 1]!;
      diag[n - 1] = 2 * h[m - 1]!;
      rhs[n - 1] = 6 * (dn - (ys[n - 1]! - ys[n - 2]!) / h[m - 1]!);
    }
    const sol = thomas(lower, diag, upper, rhs);
    for (let i = 0; i < n; i++) M[i] = sol[i]!;
  }

  /** Piecewise polynomial coefficients per interval: S(x) = a + b t + c t^2 + d t^3, t = x - xs[i]. */
  const findInterval = (x: number): number => {
    if (x <= xs[0]!) return 0;
    if (x >= xs[n - 1]!) return m - 1;
    // Binary search for the interval with xs[i] <= x < xs[i+1].
    let lo = 0;
    let hi = m - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid]! <= x) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  const evalSpline = (x: number): number => {
    const i = findInterval(x);
    const hi = h[i]!;
    const t = x - xs[i]!;
    const a = ys[i]!;
    const b = (ys[i + 1]! - ys[i]!) / hi - (hi / 6) * (2 * M[i]! + M[i + 1]!);
    const c = M[i]! / 2;
    const d = (M[i + 1]! - M[i]!) / (6 * hi);
    return a + b * t + c * t * t + d * t * t * t;
  };

  const derivative = (x: number): number => {
    const i = findInterval(x);
    const hi = h[i]!;
    const t = x - xs[i]!;
    const b = (ys[i + 1]! - ys[i]!) / hi - (hi / 6) * (2 * M[i]! + M[i + 1]!);
    const c = M[i]!;
    const d = (M[i + 1]! - M[i]!) / (2 * hi);
    return b + c * t + d * t * t;
  };

  const secondDerivative = (x: number): number => {
    const i = findInterval(x);
    const hi = h[i]!;
    const t = x - xs[i]!;
    return M[i]! + ((M[i + 1]! - M[i]!) / hi) * t;
  };

  return { eval: evalSpline, derivative, secondDerivative, n };
}
