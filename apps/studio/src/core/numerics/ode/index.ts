// ==========================================================================
// Ergalics Studio — numerics: ODE integrators (unified exit)
// ==========================================================================

export { solveODE, type RK45Options } from './rk45';
export { solveBDF, type BDFOptions } from './bdf';
export { solveRadau, type RadauOptions } from './radau';
export type {
  ODERHS,
  ODEJacobian,
  ODEEvent,
  ODEOptions,
  ODEEventOccurrence,
  ODEStats,
  ODEResult,
} from './common';
