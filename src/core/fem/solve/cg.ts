// ==========================================================================
// FEM core — self-contained conjugate gradient solver for CSR matrices.
// (Deliberately independent of src/core/numerics: the FEM kernel ships its
// own tiny SPD solver so it stays a pure, dependency-free kernel.)
// ==========================================================================

import { CsrMatrix, csrMulVec } from '../assemble/stiffness';

export interface CgOptions {
  /** Relative residual tolerance ‖r‖ / ‖b‖ (default 1e-10). */
  tol?: number;
  /** Iteration cap (default min(10·n, 20000)). */
  maxIter?: number;
}

export interface CgResult {
  solution: Float64Array;
  iterations: number;
  /** Final absolute residual ‖b − A x‖. */
  residual: number;
  converged: boolean;
}

/**
 * Standard preconditioned-free conjugate gradient on a symmetric positive
 * definite CSR matrix, starting from x0 = 0.
 */
export function conjugateGradient(A: CsrMatrix, b: ArrayLike<number>, options: CgOptions = {}): CgResult {
  const n = A.rows;
  const tol = options.tol ?? 1e-10;
  const maxIter = options.maxIter ?? Math.min(n * 10, 20000);
  const x = new Float64Array(n);
  const r = new Float64Array(n);
  const p = new Float64Array(n);
  const Ap = new Float64Array(n);

  // r = b − A·x (x = 0 ⇒ r = b)
  let bNorm = 0;
  for (let i = 0; i < n; i += 1) {
    r[i] = b[i]!;
    bNorm += b[i]! * b[i]!;
  }
  bNorm = Math.sqrt(bNorm);
  if (bNorm === 0) {
    return { solution: x, iterations: 0, residual: 0, converged: true };
  }
  p.set(r);
  let rr = 0;
  for (let i = 0; i < n; i += 1) rr += r[i]! * r[i]!;

  let iterations = 0;
  let converged = Math.sqrt(rr) <= tol * bNorm;
  while (!converged && iterations < maxIter) {
    csrMulVec(A, p, Ap);
    let pAp = 0;
    for (let i = 0; i < n; i += 1) pAp += p[i]! * Ap[i]!;
    if (pAp === 0) break; // breakdown (singular or inconsistent system)
    const alpha = rr / pAp;
    for (let i = 0; i < n; i += 1) {
      x[i] = x[i]! + alpha * p[i]!;
      r[i] = r[i]! - alpha * Ap[i]!;
    }
    let rrNew = 0;
    for (let i = 0; i < n; i += 1) rrNew += r[i]! * r[i]!;
    const beta = rrNew / rr;
    for (let i = 0; i < n; i += 1) p[i] = r[i]! + beta * p[i]!;
    rr = rrNew;
    iterations += 1;
    converged = Math.sqrt(rr) <= tol * bNorm;
  }
  // Report the true residual ‖b − A x‖.
  csrMulVec(A, x, Ap);
  let res = 0;
  for (let i = 0; i < n; i += 1) {
    const d = b[i]! - Ap[i]!;
    res += d * d;
  }
  return { solution: x, iterations, residual: Math.sqrt(res), converged };
}
