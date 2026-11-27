// ==========================================================================
// Ergalics Studio — numerics: unified sparse linear solver entry point
//
// `solve(A, b, opts)` dispatches to CG (symmetric positive definite) or
// restarted GMRES (general systems). `method: 'auto'` picks CG when the
// matrix is structurally + numerically symmetric, GMRES otherwise.
// Preconditioners: 'none' | 'jacobi' | 'ilu0' or a custom Preconditioner.
// Accepts either a CSRMatrix or a dense row-major square matrix (converted
// internally; zeros dropped).
// ==========================================================================

import { requireInput } from '../errors';
import { csrFromDense, isSymmetric, validateCSR, type CSRMatrix } from './csr';
import { ilu0Preconditioner, jacobiPreconditioner, type Preconditioner } from './precond';
import { cgSolve, type LinearSolveResult } from './cg';
import { gmresSolve, type GMRESSolveOptions } from './gmres';

export type LinearMethod = 'auto' | 'cg' | 'gmres';
export type LinearPrecondSpec = 'none' | 'jacobi' | 'ilu0' | Preconditioner;

export interface SolveOptions extends Omit<GMRESSolveOptions, 'precond'> {
  /** 'auto' (default): cg for symmetric A, gmres otherwise. */
  method?: LinearMethod;
  /** 'none' (default) | 'jacobi' | 'ilu0' | a custom Preconditioner. */
  precond?: LinearPrecondSpec;
}

export interface UnifiedSolveResult extends LinearSolveResult {
  /** Name of the preconditioner that was applied ('none' when disabled). */
  precond: string;
}

/** Unified sparse linear solver entry point. */
export function solve(A: CSRMatrix | number[][], b: number[], opts: SolveOptions = {}): UnifiedSolveResult {
  const csr: CSRMatrix = Array.isArray(A) ? csrFromDense(A) : A;
  validateCSR(csr);
  const { method = 'auto', precond = 'none' } = opts;
  requireInput(
    method === 'auto' || method === 'cg' || method === 'gmres',
    `solve: unknown method '${String(method)}'`,
    { method },
  );

  let M: Preconditioner | undefined;
  if (precond === 'jacobi') {
    M = jacobiPreconditioner(csr);
  } else if (precond === 'ilu0') {
    M = ilu0Preconditioner(csr);
  } else if (precond !== 'none') {
    requireInput(
      typeof precond === 'object' && typeof (precond as Preconditioner).apply === 'function',
      'solve: precond must be "none" | "jacobi" | "ilu0" or a Preconditioner object',
    );
    M = precond as Preconditioner;
  }

  const resolved: 'cg' | 'gmres' = method === 'auto' ? (isSymmetric(csr) ? 'cg' : 'gmres') : method;
  const base: { tol?: number; maxIter?: number; precond?: Preconditioner; restart?: number } = {};
  if (opts.tol !== undefined) base.tol = opts.tol;
  if (opts.maxIter !== undefined) base.maxIter = opts.maxIter;
  if (M !== undefined) base.precond = M;
  if (resolved === 'gmres' && opts.restart !== undefined) base.restart = opts.restart;

  const res = resolved === 'cg' ? cgSolve(csr, b, base) : gmresSolve(csr, b, base);
  return { ...res, precond: M ? M.name : 'none' };
}
