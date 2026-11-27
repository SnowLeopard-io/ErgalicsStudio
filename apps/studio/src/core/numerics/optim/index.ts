// ==========================================================================
// Ergalics Studio — numerics: optimisation (unified exit)
// ==========================================================================

export { minimize as minimizeLBFGSB, type LBFGSBOptions, type BoxBounds, type LBFGSBResult } from './lbfgs';
export { minimizeNM, type NelderMeadOptions } from './neldermead';
export { minimizeSLSQP, type SLSQPOptions, type SLSQPConstraints, type SLSQPResult } from './slsqp';
export { nnls, type NNLSResult } from './nnls';
export type { OptimizeResult } from './types';
