// ==========================================================================
// Ergalics Studio — numerics: sparse linear algebra (CSR + iterative solvers)
// ==========================================================================

export type { CSRMatrix } from './csr';
export {
  validateCSR,
  csrMatVec,
  csrFromDense,
  csrToDense,
  csrDiagonal,
  isSymmetric,
  rowMaxAbs,
  requireCompatible,
} from './csr';
export type { Preconditioner } from './precond';
export { jacobiPreconditioner, ilu0Preconditioner } from './precond';
export type { IterativeSolveOptions, LinearSolveResult } from './cg';
export { cgSolve } from './cg';
export type { GMRESSolveOptions } from './gmres';
export { gmresSolve } from './gmres';
export type { LinearMethod, LinearPrecondSpec, SolveOptions, UnifiedSolveResult } from './linsolve';
export { solve } from './linsolve';
