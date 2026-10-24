// ==========================================================================
// FEM core — stationary (steady-state) solve driver.
// Thin, physics-agnostic orchestration: constrained CSR system in,
// converged CG solution + diagnostics out.
// ==========================================================================

import { CsrMatrix } from '../assemble/stiffness';
import { CgOptions, CgResult, conjugateGradient } from './cg';

export interface StationarySolveStats extends CgResult {
  /** System size (number of DOFs). */
  size: number;
  /** Number of nonzero entries of the constrained matrix. */
  nonzeros: number;
}

/**
 * Solve the stationary system K·u = f with conjugate gradients and report
 * solver diagnostics alongside the solution.
 */
export function solveStationarySystem(K: CsrMatrix, f: Float64Array, options: CgOptions = {}): StationarySolveStats {
  const result = conjugateGradient(K, f, options);
  let nonzeros = 0;
  for (let i = 0; i < K.rows; i += 1) nonzeros += K.rowPtr[i + 1]! - K.rowPtr[i]!;
  return {
    ...result,
    size: K.rows,
    nonzeros,
  };
}
