// ==========================================================================
// FEM core — unified result shapes returned by the physics modules.
// ==========================================================================

import { PlanarMesh } from '../mesh/types';

/** Result of a scalar elliptic problem (Poisson / steady heat). */
export interface FemScalarResult {
  mesh: PlanarMesh;
  /** Nodal values of the primary field. */
  values: Float64Array;
  /** Piecewise-constant gradient ∇u per element, flat [gx, gy] pairs. */
  elementGradients: Float64Array;
  /** Piecewise-constant flux q = −k∇u per element (k = 1 when not defined). */
  elementFlux: Float64Array;
  /** CG iterations spent. */
  iterations: number;
  /** Final absolute residual of the linear solve. */
  residual: number;
}

/** Result of the transient heat equation. */
export interface FemHeatResult {
  mesh: PlanarMesh;
  /** Nodal temperature at the final time. */
  values: Float64Array;
  /** Snapshot of nodal values at every step (length steps+1, incl. t=0). */
  history: Float64Array[];
  /** Snapshot times, aligned with `history`. */
  times: number[];
  /** Total thermal energy ∫ u dV at every snapshot. */
  energyHistory: number[];
  iterations: number;
  residual: number;
  /** θ actually used (1 implicit Euler, 0.5 Crank–Nicolson). */
  theta: number;
  dt: number;
}

/** Result of 2-D plane linear elasticity. */
export interface FemElasticityResult {
  mesh: PlanarMesh;
  /** Nodal displacement, interleaved [ux0, uy0, ux1, uy1, ...]. */
  displacement: Float64Array;
  /** Per-element stress [σxx, σyy, τxy], flat length 3·nElem. */
  elementStress: Float64Array;
  /** Per-element strain [εx, εy, γxy], flat length 3·nElem. */
  elementStrain: Float64Array;
  /** Nodal von Mises stress (area-weighted average of adjacent elements). */
  nodalVonMises: Float64Array;
  /** max |u| over all nodes. */
  maxDisplacement: number;
  iterations: number;
  residual: number;
}
