// ==========================================================================
// FEM core — Poisson physics: −∇·(k∇u) = f with piecewise-constant k
// (multi-material via element physical tags), Dirichlet / Neumann BCs.
//
// Analytic reference case (unit square, k = 1):
//   u = sin(πx)·sin(πy),  f = 2π²·sin(πx)·sin(πy),  u = 0 on ∂Ω.
// ==========================================================================

import {
  Coefficient,
  CsrBuilder,
  CsrMatrix,
  coefficientAt,
  assembleP1Stiffness,
} from '../assemble/stiffness';
import { SourceFn, assembleSourceVector, assembleEdgeLoad, EdgeSelector, selectBoundaryEdges } from '../assemble/load';
import { DofValue, applyDirichlet, selectEdgeNodes, selectNodesByPredicate, selectTaggedNodes } from '../bc/dirichlet';
import { PlanarMesh, nodeCount, nodeX, nodeY } from '../mesh/types';
import { CgOptions } from '../solve/cg';
import { solveStationarySystem } from '../solve/stationary';
import { FemScalarResult } from './types';

export interface DirichletSpec {
  /** Boundary edge tags whose nodes get the prescribed value. */
  edgeTags?: number[];
  /** Explicit node tags to constrain. */
  nodeTags?: number[];
  /** Explicit node indices to constrain. */
  nodes?: number[];
  /** Prescribed value (constant or coordinate-dependent). */
  value: number | ((x: number, y: number) => number);
}

export interface NeumannSpec {
  edges: EdgeSelector;
  /** Outward flux g (constant or point-evaluated). */
  flux: number | ((x: number, y: number) => number);
}

export interface PoissonProblem {
  mesh: PlanarMesh;
  /** Conductivity k (constant | per-tag record | tag → k). Default 1. */
  k?: Coefficient;
  /** Source term f(x, y, tag). Default 0. */
  source?: SourceFn;
  dirichlet?: DirichletSpec;
  neumann?: NeumannSpec;
  cg?: CgOptions;
}

/** Collect the constrained DOFs of a Dirichlet spec against the mesh. */
export function dirichletDofs(mesh: PlanarMesh, spec: DirichletSpec): DofValue[] {
  const valueOf = (x: number, y: number): number =>
    typeof spec.value === 'number' ? spec.value : spec.value(x, y);
  const dofs: DofValue[] = [];
  if (spec.edgeTags && spec.edgeTags.length > 0) {
    for (const n of selectEdgeNodes(mesh, spec.edgeTags)) {
      dofs.push({ dof: n, value: valueOf(nodeX(mesh, n), nodeY(mesh, n)) });
    }
  }
  if (spec.nodeTags) {
    for (const tag of spec.nodeTags) {
      for (const n of selectTaggedNodes(mesh, tag)) {
        dofs.push({ dof: n, value: valueOf(nodeX(mesh, n), nodeY(mesh, n)) });
      }
    }
  }
  if (spec.nodes) {
    for (const n of spec.nodes) {
      dofs.push({ dof: n, value: valueOf(nodeX(mesh, n), nodeY(mesh, n)) });
    }
  }
  return dofs;
}

/** Convenience selector: nodes matching a coordinate predicate. */
export function selectNodes(mesh: PlanarMesh, predicate: (x: number, y: number) => boolean): number[] {
  return selectNodesByPredicate(mesh, predicate);
}

/**
 * Solve −∇·(k∇u) = f with the given boundary conditions. Returns nodal
 * values, per-element gradients and the flux −k∇u.
 */
export function solvePoisson(problem: PoissonProblem): FemScalarResult {
  const { mesh } = problem;
  const n = nodeCount(mesh);
  const k = problem.k ?? 1;
  const builder = new CsrBuilder(n, n);
  addPoissonStiffness(mesh, k, builder);
  const load = assembleSourceVector(mesh, problem.source ?? (() => 0));
  if (problem.neumann) {
    const selected = selectBoundaryEdges(mesh, problem.neumann.edges);
    const flux = assembleEdgeLoad(mesh, selected, problem.neumann.flux);
    for (let i = 0; i < n; i += 1) load[i] = load[i]! + flux[i]!;
  }
  const K = builder.toCsr();
  const dofs = problem.dirichlet ? dirichletDofs(mesh, problem.dirichlet) : [];
  applyDirichlet(K, load, dofs);
  const solved = solveStationarySystem(K, load, problem.cg);

  // Per-element gradients and flux.
  const nE = mesh.elements.length;
  const elementGradients = new Float64Array(nE * 2);
  const elementFlux = new Float64Array(nE * 2);
  const u = solved.solution;
  const nodes = mesh.nodes;
  for (let e = 0; e < nE; e += 1) {
    const el = mesh.elements[e]!;
    const x0 = nodes[el.a * 2]!;
    const y0 = nodes[el.a * 2 + 1]!;
    const x1 = nodes[el.b * 2]!;
    const y1 = nodes[el.b * 2 + 1]!;
    const x2 = nodes[el.c * 2]!;
    const y2 = nodes[el.c * 2 + 1]!;
    const det = 2 * 0.5 * ((x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0));
    const u0 = u[el.a]!;
    const u1 = u[el.b]!;
    const u2 = u[el.c]!;
    // ∇u = Σ ui ∇λi with ∇λ0 = (y1−y2, x2−x1)/det etc.
    const gx = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / det;
    const gy = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / det;
    elementGradients[e * 2] = gx;
    elementGradients[e * 2 + 1] = gy;
    const ke = coefficientAt(k, el.tag);
    elementFlux[e * 2] = -ke * gx;
    elementFlux[e * 2 + 1] = -ke * gy;
  }
  return {
    mesh,
    values: u,
    elementGradients,
    elementFlux,
    iterations: solved.iterations,
    residual: solved.residual,
  };
}

/**
 * Add the Poisson stiffness ∫ k ∇λi·∇λj dΩ into a builder (shared helper so
 * the heat module can assemble M + θΔt·K with one sparsity pattern).
 */
export function addPoissonStiffness(mesh: PlanarMesh, k: Coefficient, builder: CsrBuilder): void {
  const assembled: CsrMatrix = assembleP1Stiffness(mesh, k);
  for (let row = 0; row < assembled.rows; row += 1) {
    for (let idx = assembled.rowPtr[row]!; idx < assembled.rowPtr[row + 1]!; idx += 1) {
      builder.add(row, assembled.colIdx[idx]!, assembled.values[idx]!);
    }
  }
}

// ---- analytic reference case ----------------------------------------------

export const POISSON_SINE_CASE = {
  /** Domain: unit square, k = 1, u = 0 on the whole boundary. */
  domain: 'unit-square' as const,
  k: 1,
  exact: (x: number, y: number): number => Math.sin(Math.PI * x) * Math.sin(Math.PI * y),
  source: (x: number, y: number): number =>
    2 * Math.PI * Math.PI * Math.sin(Math.PI * x) * Math.sin(Math.PI * y),
};
