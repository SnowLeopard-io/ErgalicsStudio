// ==========================================================================
// FEM core — 2-D linear elasticity (plane stress / plane strain), P1
// triangles, displacement DOFs interleaved [ux0, uy0, ux1, uy1, ...].
//
//   ε = B·a (3 components: εx, εy, γxy),  σ = D·B·a,
//   ke = ∫ Bᵀ·D·B dV = Bᵀ·D·B·(A·t)  (constant over a P1 triangle).
//
// Analytic reference case (uniaxial tension of a rectangular bar, plane
// stress): σx = σ0 ⇒ u = (σ0·x/E, −ν·σ0·y/E). P1 reproduces this exactly.
// ==========================================================================

import { CsrBuilder, CsrMatrix, Coefficient, coefficientAt } from '../assemble/stiffness';
import { assembleEdgeLoad, EdgeSelector, selectBoundaryEdges } from '../assemble/load';
import { DofValue, applyDirichlet } from '../bc/dirichlet';
import { PlanarMesh, nodeCount, nodeX, nodeY } from '../mesh/types';
import { CgOptions } from '../solve/cg';
import { solveStationarySystem } from '../solve/stationary';
import { FemElasticityResult } from './types';
import { recoverElementStrain, recoverElementStress, nodalVonMises } from '../post/stress';

export type PlaneState = 'plane-stress' | 'plane-strain';

/** Constitutive matrix D (3×3, flat) for the given elastic constants. */
export function constitutiveMatrix(E: number, nu: number, state: PlaneState): Float64Array {
  const D = new Float64Array(9);
  if (state === 'plane-stress') {
    const f = E / (1 - nu * nu);
    D[0] = f;        // D11
    D[1] = f * nu;   // D12
    D[3] = f * nu;   // D21
    D[4] = f;        // D22
    D[8] = (f * (1 - nu)) / 2; // D33 (shear)
  } else {
    const f = E / ((1 + nu) * (1 - 2 * nu));
    D[0] = f * (1 - nu);
    D[1] = f * nu;
    D[3] = f * nu;
    D[4] = f * (1 - nu);
    D[8] = (f * (1 - 2 * nu)) / 2;
  }
  return D;
}

export interface DisplacementConstraint {
  /** Node indices to constrain. */
  nodes: number[];
  /** Preset ux (undefined = free). */
  ux?: number;
  /** Preset uy (undefined = free). */
  uy?: number;
}

export interface TractionSpec {
  edges: EdgeSelector;
  /** Traction components (constant or point-evaluated). */
  tx?: number | ((x: number, y: number) => number);
  ty?: number | ((x: number, y: number) => number);
}

export interface ElasticityProblem {
  mesh: PlanarMesh;
  /** Young's modulus (constant | per-tag record | tag → E). */
  E?: Coefficient;
  /** Poisson ratio (same selector forms). */
  nu?: Coefficient;
  state?: PlaneState;
  /** Out-of-plane thickness (default 1). */
  thickness?: number;
  /** Displacement constraints (nodes with fixed ux and/or uy). */
  constraints?: DisplacementConstraint[];
  /** Surface tractions on boundary edge tags. */
  tractions?: TractionSpec[];
  /** Constant body force per unit volume. */
  bodyForce?: { fx?: number; fy?: number };
  /** Point loads applied at nodes. */
  pointLoads?: Array<{ node: number; fx: number; fy: number }>;
  cg?: CgOptions;
}

/**
 * Solve the 2-D plane elasticity problem. Returns nodal displacements plus
 * per-element strain/stress and nodal von Mises (via the post module).
 */
export function solveElasticity(problem: ElasticityProblem): FemElasticityResult {
  const { mesh } = problem;
  const n = nodeCount(mesh);
  const ndof = 2 * n;
  const state = problem.state ?? 'plane-stress';
  const thickness = problem.thickness ?? 1;
  const E = problem.E ?? 1;
  const nu = problem.nu ?? 0.3;

  const builder = new CsrBuilder(ndof, ndof);
  addElasticityStiffness(mesh, E, nu, state, thickness, builder);

  // Load vector (blocked, stride 2).
  const load = new Float64Array(ndof);
  const nodes = mesh.nodes;
  if (problem.bodyForce) {
    const fx = problem.bodyForce.fx ?? 0;
    const fy = problem.bodyForce.fy ?? 0;
    for (const el of mesh.elements) {
      const area = Math.abs(
        0.5 * ((nodes[el.b * 2]! - nodes[el.a * 2]!) * (nodes[el.c * 2 + 1]! - nodes[el.a * 2 + 1]!) -
          (nodes[el.c * 2]! - nodes[el.a * 2]!) * (nodes[el.b * 2 + 1]! - nodes[el.a * 2 + 1]!)),
      );
      const share = (area * thickness) / 3;
      load[2 * el.a] = load[2 * el.a]! + fx * share;
      load[2 * el.a + 1] = load[2 * el.a + 1]! + fy * share;
      load[2 * el.b] = load[2 * el.b]! + fx * share;
      load[2 * el.b + 1] = load[2 * el.b + 1]! + fy * share;
      load[2 * el.c] = load[2 * el.c]! + fx * share;
      load[2 * el.c + 1] = load[2 * el.c + 1]! + fy * share;
    }
  }
  if (problem.tractions) {
    for (const tr of problem.tractions) {
      const selected = selectBoundaryEdges(mesh, tr.edges);
      const lx = assembleEdgeLoad(mesh, selected, tr.tx ?? 0, 2, 0);
      const ly = assembleEdgeLoad(mesh, selected, tr.ty ?? 0, 2, 1);
      for (let i = 0; i < ndof; i += 1) load[i] = load[i]! + lx[i]! + ly[i]!;
    }
  }
  if (problem.pointLoads) {
    for (const pl of problem.pointLoads) {
      load[2 * pl.node] = load[2 * pl.node]! + pl.fx;
      load[2 * pl.node + 1] = load[2 * pl.node + 1]! + pl.fy;
    }
  }

  // Constraints: map node → (ux?, uy?) into DOF list.
  const dofs: DofValue[] = [];
  for (const c of problem.constraints ?? []) {
    for (const node of c.nodes) {
      if (c.ux !== undefined) dofs.push({ dof: 2 * node, value: c.ux });
      if (c.uy !== undefined) dofs.push({ dof: 2 * node + 1, value: c.uy });
    }
  }

  const K = builder.toCsr();
  applyDirichlet(K, load, dofs);
  const solved = solveStationarySystem(K, load, problem.cg);

  const displacement = solved.solution;
  const elementStrain = recoverElementStrain(mesh, displacement);
  const elementStress = recoverElementStress(mesh, elementStrain, E, nu, state);
  const nodalVonMisesValues = nodalVonMises(mesh, elementStress);

  let maxDisp = 0;
  for (let i = 0; i < n; i += 1) {
    maxDisp = Math.max(maxDisp, Math.hypot(displacement[2 * i]!, displacement[2 * i + 1]!));
  }

  return {
    mesh,
    displacement,
    elementStress,
    elementStrain,
    nodalVonMises: nodalVonMisesValues,
    maxDisplacement: maxDisp,
    iterations: solved.iterations,
    residual: solved.residual,
  };
}

/**
 * Add the 6×6-per-element elasticity stiffness into a CSR builder.
 * ke = Bᵀ·D·B·(A·t) with the P1 strain-displacement matrix B.
 */
export function addElasticityStiffness(
  mesh: PlanarMesh,
  E: Coefficient,
  nu: Coefficient,
  state: PlaneState,
  thickness: number,
  builder: CsrBuilder,
): void {
  for (const el of mesh.elements) {
    const x0 = nodeX(mesh, el.a);
    const y0 = nodeY(mesh, el.a);
    const x1 = nodeX(mesh, el.b);
    const y1 = nodeY(mesh, el.b);
    const x2 = nodeX(mesh, el.c);
    const y2 = nodeY(mesh, el.c);
    const signed = 0.5 * ((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0));
    const area = Math.abs(signed);
    if (area === 0) continue;
    const det = 2 * signed;
    // ∇λi = ((y_j − y_k), (x_k − x_j)) / det, cyclic over (i, j, k).
    const grads: Array<[number, number]> = [
      [(y1 - y2) / det, (x2 - x1) / det],
      [(y2 - y0) / det, (x0 - x2) / det],
      [(y0 - y1) / (det), (x1 - x0) / det],
    ];
    // B (3×6): rows εx, εy, γxy.
    const B = new Float64Array(18);
    for (let i = 0; i < 3; i += 1) {
      const gx = grads[i]![0];
      const gy = grads[i]![1];
      B[i * 2] = gx;              // εx row
      B[6 + i * 2 + 1] = gy;      // εy row
      B[12 + i * 2] = gy;         // γxy row
      B[12 + i * 2 + 1] = gx;
    }
    const D = constitutiveMatrix(coefficientAt(E, el.tag), coefficientAt(nu, el.tag), state);
    const ke = new Float64Array(36);
    // ke = Bᵀ·D·B·(A·t)
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 6; j += 1) {
        let sum = 0;
        for (let a = 0; a < 3; a += 1) {
          for (let b = 0; b < 3; b += 1) {
            sum += B[a * 6 + i]! * D[a * 3 + b]! * B[b * 6 + j]!;
          }
        }
        ke[i * 6 + j] = sum * area * thickness;
      }
    }
    const dof = [2 * el.a, 2 * el.a + 1, 2 * el.b, 2 * el.b + 1, 2 * el.c, 2 * el.c + 1];
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 6; j += 1) {
        builder.add(dof[i]!, dof[j]!, ke[i * 6 + j]!);
      }
    }
  }
}

/** Analytic uniaxial-tension case constants (plane stress). */
export const UNIAXIAL_BAR_CASE = {
  /** σ0 = 100, E = 200000, ν = 0.3 (consistent units). */
  sigma0: 100,
  E: 200000,
  nu: 0.3,
  /** ux = σ0·x / E. */
  exactUx: (x: number, E = 200000, sigma0 = 100): number => (sigma0 * x) / E,
  /** uy = −ν·σ0·y / E. */
  exactUy: (y: number, E = 200000, nu = 0.3, sigma0 = 100): number => (-nu * sigma0 * y) / E,
};

export type { CsrMatrix };
