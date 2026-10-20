// ==========================================================================
// Ergalics Studio — numerics: Lawson-Hanson NNLS
//
// Non-negative least squares: min ||A x - b||_2 subject to x >= 0.
// Classic Lawson-Hanson active-set algorithm (1974): pick the most
// correlated variable (max w_j with w = A'(b - Ax)) into the passive set,
// solve the unrestricted least-squares problem on the passive set with
// Householder QR, and step back along the segment x + alpha (z - x) when any
// passive coefficient turns negative. Terminates finitely with the exact KKT
// solution: w_j <= 0 off the passive set, x >= 0, complementary slackness.
// ==========================================================================

import { assertFinite, requireInput } from '../errors';
import { norm2, qrSolve } from '../linalg';

export interface NNLSResult {
  /** Non-negative solution. */
  x: number[];
  /** Euclidean norm of the residual A x - b. */
  residualNorm: number;
  /** Outer iterations performed. */
  iterations: number;
  converged: boolean;
}

/**
 * Solve min ||A x - b||_2 with x >= 0. `A` is m x n (row-major),
 * `b` has m entries. Throws on shape mismatch or non-finite input.
 * Rank-deficient passive subproblems are handled by the QR rank tolerance
 * (their coefficients stay at zero).
 */
export function nnls(A: number[][], b: number[], maxOuter?: number): NNLSResult {
  const m = A.length;
  const n = m > 0 ? A[0]!.length : 0;
  requireInput(m > 0 && n > 0, 'nnls: A must be non-empty');
  requireInput(b.length === m, 'nnls: b length must match A rows');
  for (const row of A) {
    requireInput(row.length === n, 'nnls: A rows must all have the same length');
    assertFinite(row, 'nnls A');
  }
  assertFinite(b, 'nnls b');
  const maxIter = maxOuter ?? 30 * n;
  requireInput(maxIter > 0, 'nnls: maxOuter must be positive');

  let x = new Array<number>(n).fill(0);
  const passive = new Array<boolean>(n).fill(false);
  let passiveCount = 0;

  // Scale of the normal-equation gradient, for the entry tolerance.
  let atbMax = 0;
  for (let j = 0; j < n; j++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += A[i]![j]! * b[i]!;
    atbMax = Math.max(atbMax, Math.abs(s));
  }
  const wTol = Math.max(1e-10 * atbMax, 1e-300);

  const residual = (): number[] => {
    const r = b.slice();
    for (let j = 0; j < n; j++) {
      const xj = x[j]!;
      if (xj !== 0) for (let i = 0; i < m; i++) r[i] = r[i]! - A[i]![j]! * xj;
    }
    return r;
  };

  let iterations = 0;
  let kkt = false;
  for (iterations = 0; iterations < maxIter; iterations++) {
    if (passiveCount === n) {
      // Every variable is in the passive set and the last unrestricted
      // least-squares solve was feasible: exact KKT solution.
      kkt = true;
      break;
    }
    const r = residual();
    // Correlations w = A' r on the active set.
    let wMax = 0;
    let jMax = -1;
    for (let j = 0; j < n; j++) {
      if (passive[j]) continue;
      let s = 0;
      for (let i = 0; i < m; i++) s += A[i]![j]! * r[i]!;
      if (s > wMax) {
        wMax = s;
        jMax = j;
      }
    }
    if (jMax < 0 || wMax <= wTol) {
      return { x, residualNorm: norm2(r), iterations, converged: true };
    }
    passive[jMax] = true;
    passiveCount++;

    // Inner loop: solve on the passive set and backtrack to feasibility.
    for (let inner = 0; inner < 3 * n; inner++) {
      const idx: number[] = [];
      for (let j = 0; j < n; j++) if (passive[j]) idx.push(j);
      const Ap: number[][] = A.map((row) => idx.map((j) => row[j]!));
      const qr = qrSolve(Ap, b);
      const z = new Array<number>(n).fill(0);
      for (let k = 0; k < idx.length; k++) z[idx[k]!] = qr.x[k]!;

      if (idx.every((j) => z[j]! > 0)) {
        x = z;
        break;
      }
      // Longest step alpha keeping x + alpha (z - x) >= 0.
      let alpha = Infinity;
      for (const j of idx) {
        const xj = x[j]!;
        const zj = z[j]!;
        if (zj <= 0 && xj - zj > 0) alpha = Math.min(alpha, xj / (xj - zj));
      }
      if (!Number.isFinite(alpha)) {
        // No blocking variable (e.g. rank-deficient QR): clamp and stop.
        x = z.map((v) => Math.max(v, 0));
        break;
      }
      let xMax = 0;
      x = x.map((xv, j) => {
        const nv = passive[j] ? xv + alpha * (z[j]! - xv) : 0;
        xMax = Math.max(xMax, Math.abs(nv));
        return Math.max(nv, 0);
      });
      // Drop variables that hit zero (at least one does by construction).
      const zeroTol = 1e-13 * Math.max(1, xMax);
      let removed = false;
      for (const j of idx) {
        if (passive[j] && x[j]! <= zeroTol) {
          x[j] = 0;
          passive[j] = false;
          passiveCount--;
          removed = true;
        }
      }
      if (!removed) {
        break;
      }
    }
  }

  return { x, residualNorm: norm2(residual()), iterations, converged: kkt };
}
