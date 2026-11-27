// ==========================================================================
// Ergalics Studio — numerics: root finding (unified exit)
// ==========================================================================

export { brent, findBracket, type BrentOptions, type BrentResult } from './brent';
export {
  newtonSolve,
  newtonScalar,
  defaultJacobian,
  type VectorField,
  type JacobianFn,
  type NewtonOptions,
  type NewtonResult,
} from './newton';
