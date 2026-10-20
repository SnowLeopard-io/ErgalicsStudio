// ==========================================================================
// Ergalics Studio — numerics: radial basis function interpolation
//
// Global RBF interpolation f(x) = sum_i a_i phi(||x - x_i||) (+ optional
// degree-1 polynomial term) with the classical kernels:
//   gaussian     phi(r) = exp(-(eps r)^2)           (strictly PD, no poly)
//   multiquadric phi(r) = sqrt(1 + (eps r)^2)       (conditionally PD)
//   thinplate    phi(r) = r^2 log(r)                (needs degree-1 poly)
// The linear system (or KKT system with polynomial orthogonality constraints
// for the thin-plate spline) is solved with dense LU. Duplicate points make
// the system singular and are reported as a structured error.
// ==========================================================================

import { NumericsError, assertFinite, requireInput } from '../errors';
import { solveLinear } from '../linalg';

export type RBFKernel = 'gaussian' | 'multiquadric' | 'thinplate';

export interface RBFOptions {
  /** Kernel selection. Default 'gaussian'. */
  kernel?: RBFKernel;
  /** Shape parameter epsilon. Default: 1 / (mean pairwise distance). */
  epsilon?: number;
  /** Regularisation lambda added to the kernel diagonal (smoothing). Default 0. */
  smooth?: number;
  /** Augment with a degree-1 polynomial term (forced on for 'thinplate'). */
  polynomial?: boolean;
}

export interface RBFInterpolator {
  /** Evaluate at a point (number for 1-D data, vector otherwise). */
  eval: (x: number | number[]) => number;
  readonly n: number;
  readonly dim: number;
  readonly kernel: RBFKernel;
  /** Shape parameter actually used. */
  readonly epsilon: number;
}

/**
 * Build an exact interpolant through the given nodes. `points` may be a flat
 * number[] for 1-D data or an array of d-dimensional vectors.
 */
export function createRBF(
  points: number[] | number[][],
  values: number[],
  opts: RBFOptions = {},
): RBFInterpolator {
  requireInput(points.length > 0, 'rbf: at least one node is required');
  const dim = Array.isArray(points[0]) ? (points[0] as number[]).length : 1;
  const pts: number[][] = (points as Array<number | number[]>).map((p) => {
    const v = Array.isArray(p) ? p : [p];
    requireInput(v.length === dim, 'rbf: all points must have the same dimension');
    assertFinite(v, 'rbf points');
    return v;
  });
  const n = pts.length;
  requireInput(values.length === n, 'rbf: values length must match points');
  assertFinite(values, 'rbf values');

  const kernel = opts.kernel ?? 'gaussian';
  requireInput(['gaussian', 'multiquadric', 'thinplate'].includes(kernel), `rbf: unknown kernel '${kernel}'`);

  // Shape parameter: explicit, or 1 / (mean pairwise distance).
  let eps: number;
  if (opts.epsilon !== undefined) {
    requireInput(opts.epsilon > 0, 'rbf: epsilon must be positive');
    eps = opts.epsilon;
  } else if (kernel === 'thinplate') {
    eps = 1; // unused by the thin-plate kernel
  } else {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        sum += dist(pts[i]!, pts[j]!);
        count++;
      }
    }
    const mean = count > 0 ? sum / count : 1;
    eps = mean > 0 ? 1 / mean : 1;
  }

  const smooth = opts.smooth ?? 0;
  requireInput(smooth >= 0, 'rbf: smooth must be non-negative');
  const usePoly = kernel === 'thinplate' ? true : opts.polynomial === true;
  const d = dim;

  const phi = (r: number): number => {
    switch (kernel) {
      case 'gaussian': {
        const t = eps * r;
        return Math.exp(-t * t);
      }
      case 'multiquadric': {
        const t = eps * r;
        return Math.sqrt(1 + t * t);
      }
      case 'thinplate':
        return r === 0 ? 0 : r * r * Math.log(r);
    }
  };

  // Assemble the interpolation system.
  const size = n + (usePoly ? d + 1 : 0);
  const A: number[][] = [];
  for (let i = 0; i < size; i++) A.push(new Array<number>(size).fill(0));
  const rhs = new Array<number>(size).fill(0);
  for (let i = 0; i < n; i++) {
    A[i]![i] = phi(0) + smooth; // gaussian: 1; thinplate: 0; multiquadric: 1
    for (let j = i + 1; j < n; j++) {
      const v = phi(dist(pts[i]!, pts[j]!));
      A[i]![j] = v;
      A[j]![i] = v;
    }
    rhs[i] = values[i]!;
    if (usePoly) {
      for (let j = 0; j <= d; j++) {
        A[i]![n + j] = j === 0 ? 1 : pts[i]![j - 1]!;
        A[n + j]![i] = A[i]![n + j]!;
      }
    }
  }
  // Polynomial orthogonality constraints: sum a_i = 0, sum a_i x_i = 0.
  if (usePoly) {
    for (let j = 0; j <= d; j++) rhs[n + j] = 0;
  }

  let coeffs: number[];
  try {
    coeffs = solveLinear(A, rhs);
  } catch (err) {
    if (err instanceof NumericsError) {
      throw new NumericsError('numerics/singular', 'rbf: interpolation system is singular (duplicate nodes?)');
    }
    throw err;
  }
  const a = coeffs.slice(0, n);
  const poly = usePoly ? coeffs.slice(n) : null;

  const evalAt = (x: number | number[]): number => {
    const xv = Array.isArray(x) ? x : [x];
    requireInput(xv.length === dim, 'rbf.eval: query dimension mismatch');
    assertFinite(xv, 'rbf query');
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i]! * phi(dist(xv, pts[i]!));
    if (poly !== null) {
      s += poly[0]!;
      for (let j = 0; j < d; j++) s += poly[j + 1]! * xv[j]!;
    }
    return s;
  };

  return { eval: evalAt, n, dim, kernel, epsilon: eps };
}

function dist(u: number[], v: number[]): number {
  let s = 0;
  for (let i = 0; i < u.length; i++) {
    const diff = u[i]! - v[i]!;
    s += diff * diff;
  }
  return Math.sqrt(s);
}
