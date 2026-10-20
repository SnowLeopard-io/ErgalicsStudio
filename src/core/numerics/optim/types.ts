// ==========================================================================
// Ergalics Studio — numerics: optimisation shared types
// ==========================================================================

/** Common result shape for the optimisers in this package. */
export interface OptimizeResult {
  /** Minimiser found. */
  x: number[];
  /** Objective value at `x`. */
  f: number;
  iterations: number;
  converged: boolean;
  /** Objective evaluations consumed. */
  funcEvals: number;
}
