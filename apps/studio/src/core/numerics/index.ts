// ==========================================================================
// Ergalics Studio — numerics kernel package (pure TypeScript, zero DOM)
//
// Re-exports the numeric families shared by the browser workbench and the
// desktop/native runtime:
//   - ode:    adaptive explicit (Dormand-Prince RK45) and implicit
//             (variable-order BDF1-5, Radau IIA 5) integrators
//   - optim:  L-BFGS-B, Nelder-Mead, SLSQP, Lawson-Hanson NNLS
//   - root:   Brent root finding, damped multivariate Newton
//   - interp: natural/clamped cubic splines, RBF interpolation
//   - sparse: CSR matrices, CG / restarted GMRES(m), Jacobi + ILU(0),
//             unified `solve` entry point
//   - shared: structured NumericsError and dense linear algebra helpers
// ==========================================================================

export * from './errors';
export * from './linalg';
export * from './root';
export * from './ode';
export * from './optim';
export * from './interp';
export * from './sparse';
