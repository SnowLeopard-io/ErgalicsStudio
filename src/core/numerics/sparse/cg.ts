// ==========================================================================
// Ergalics Studio — numerics: preconditioned conjugate gradient
//
// Solves A x = b for symmetric positive definite A stored in CSR. Right
// preconditioning (M ~ A^{-1}) only changes the search directions; the
// convergence test uses the true residual ||b - A x|| <= tol * ||b||.
// A non-positive curvature value (p^T A p <= 0) raises `numerics/singular`
// because CG is only valid for SPD systems.
// ==========================================================================

import { NumericsError, requireInput } from '../errors';
import { csrMatVec, requireCompatible, type CSRMatrix } from './csr';
import type { Preconditioner } from './precond';

/** Options shared by the iterative solvers (same convergence contract). */
export interface IterativeSolveOptions {
  /** Relative residual tolerance ||b - A x|| / ||b|| (default 1e-10). */
  tol?: number;
  /** Iteration budget (default 10 * n). */
  maxIter?: number;
  /** Optional preconditioner (default none). */
  precond?: Preconditioner;
}

/** Result shared by cg / gmres / the unified `solve` entry point. */
export interface LinearSolveResult {
  /** Approximate solution. */
  x: number[];
  /** Iterations actually performed. */
  iterations: number;
  /** True when the relative residual test passed within the budget. */
  converged: boolean;
  /** Final relative residual ||b - A x|| / ||b||. */
  relResidual: number;
  /** Solver actually used (diagnostic, includes the preconditioner name). */
  method: string;
}

function norm2(v: number[]): number {
  let s = 0;
  for (const c of v) s += c * c;
  return Math.sqrt(s);
}

function methodLabel(base: string, M: Preconditioner | undefined): string {
  return M ? `${base}(${M.name})` : base;
}

/** Preconditioned conjugate gradient for SPD systems. */
export function cgSolve(A: CSRMatrix, b: number[], opts: IterativeSolveOptions = {}): LinearSolveResult {
  requireCompatible(A, b);
  const tol = opts.tol ?? 1e-10;
  const maxIter = opts.maxIter ?? 10 * A.n;
  const M = opts.precond;
  const method = methodLabel('cg', M);
  requireInput(Number.isFinite(tol) && tol > 0, 'cg: tol must be a positive finite number', { tol });
  requireInput(Number.isInteger(maxIter) && maxIter > 0, 'cg: maxIter must be a positive integer', { maxIter });

  const n = A.n;
  const bNorm = norm2(b);
  if (bNorm === 0) {
    return { x: new Array<number>(n).fill(0), iterations: 0, converged: true, relResidual: 0, method };
  }

  const x = new Array<number>(n).fill(0);
  const r = b.slice();
  let z = M ? M.apply(r) : r.slice();
  const p = z.slice();
  let rz = 0;
  for (let i = 0; i < n; i++) rz += r[i]! * z[i]!;

  let iterations = 0;
  let relResidual = 1;
  while (iterations < maxIter) {
    const Ap = csrMatVec(A, p);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i]! * Ap[i]!;
    if (!(pAp > 0)) {
      throw new NumericsError(
        'numerics/singular',
        `cg: matrix is not positive definite (p^T A p = ${pAp} at iteration ${iterations})`,
        { iteration: iterations },
      );
    }
    const alpha = rz / pAp;
    for (let i = 0; i < n; i++) {
      x[i] = x[i]! + alpha * p[i]!;
      r[i] = r[i]! - alpha * Ap[i]!;
    }
    iterations++;
    const rNorm = norm2(r);
    relResidual = rNorm / bNorm;
    if (!Number.isFinite(relResidual)) {
      throw new NumericsError('numerics/non-finite', `cg: residual became non-finite at iteration ${iterations}`, {
        iteration: iterations,
      });
    }
    if (relResidual <= tol) {
      return { x, iterations, converged: true, relResidual, method };
    }
    z = M ? M.apply(r) : r.slice();
    let rzNew = 0;
    for (let i = 0; i < n; i++) rzNew += r[i]! * z[i]!;
    if (!(rzNew > 0)) {
      throw new NumericsError(
        'numerics/singular',
        `cg: preconditioned curvature r^T M^-1 r = ${rzNew} is not positive (A or M is not SPD)`,
        { iteration: iterations },
      );
    }
    const beta = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < n; i++) p[i] = z[i]! + beta * p[i]!;
  }
  return { x, iterations, converged: false, relResidual, method };
}
