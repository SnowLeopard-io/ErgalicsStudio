// ==========================================================================
// FEM core — transient heat equation ρc·∂u/∂t = ∇·(k∇u) + Q discretized as
// M·du/dt = −K·u + F with the θ scheme (implicit Euler / Crank–Nicolson).
//
// Analytic reference case (unit square, α = k/ρc = 1, u = 0 on ∂Ω):
//   u(x, y, t) = e^(−2π²αt)·sin(πx)·sin(πy).
// Energy check: with insulated (zero-flux) boundaries and Q = 0 the discrete
// total heat ∫u dV is conserved EXACTLY by the θ scheme for every θ.
// ==========================================================================

import { CsrBuilder, Coefficient, coefficientAt } from '../assemble/stiffness';
import { assembleEdgeLoad, assembleSourceVector, selectBoundaryEdges } from '../assemble/load';
import { DofValue } from '../bc/dirichlet';
import { addPoissonStiffness, dirichletDofs, DirichletSpec, NeumannSpec } from './poisson';
import { PlanarMesh, nodeCount } from '../mesh/types';
import { CgOptions } from '../solve/cg';
import { thetaOperators, thetaTimeStep } from '../solve/transient';
import { FemHeatResult } from './types';

export interface HeatProblem {
  mesh: PlanarMesh;
  /** Conductivity k (constant | per-tag record | tag → k). Default 1. */
  k?: Coefficient;
  /** Volumetric heat capacity ρc (same selector forms). Default 1. */
  heatCapacity?: Coefficient;
  /** Source Q(x, y, t, tag). Default 0. */
  source?: (x: number, y: number, t: number, tag: number) => number;
  /** Initial condition u0(x, y). Required. */
  initial: (x: number, y: number) => number;
  /** Dirichlet (fixed temperature) boundaries. */
  dirichlet?: DirichletSpec;
  /** Prescribed boundary heat flux (Neumann) groups. */
  neumann?: NeumannSpec | NeumannSpec[];
  /** Time step, number of steps, θ (1 = implicit, 0.5 = CN). */
  dt: number;
  steps: number;
  theta?: number;
  cg?: CgOptions;
}

/** Total discrete thermal energy ∫ u dV (mass-weighted nodal sum). */
export function totalHeatEnergy(mesh: PlanarMesh, values: ArrayLike<number>): number {
  const nodes = mesh.nodes;
  let energy = 0;
  for (const el of mesh.elements) {
    const ax = nodes[el.a * 2]!;
    const ay = nodes[el.a * 2 + 1]!;
    const bx = nodes[el.b * 2]!;
    const by = nodes[el.b * 2 + 1]!;
    const cx = nodes[el.c * 2]!;
    const cy = nodes[el.c * 2 + 1]!;
    const area = Math.abs(0.5 * ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)));
    const avg = (values[el.a]! + values[el.b]! + values[el.c]!) / 3;
    energy += area * avg;
  }
  return energy;
}

/** Solve the transient heat equation; returns the final field + history. */
export function solveHeat(problem: HeatProblem): FemHeatResult {
  const { mesh, dt, steps } = problem;
  if (!Number.isFinite(dt) || dt <= 0) throw new Error('fem: heat dt must be a positive finite number');
  if (!Number.isInteger(steps) || steps < 1) throw new Error('fem: heat steps must be an integer ≥ 1');
  const theta = problem.theta ?? 1;
  if (!Number.isFinite(theta) || theta < 0 || theta > 1) {
    throw new Error('fem: heat theta must lie in [0, 1]');
  }
  const n = nodeCount(mesh);
  // Positive finite conductivity / heat capacity per element tag. Zero or
  // non-finite values silently remove M or K from the scheme.
  const tags = new Set<number>();
  for (const el of mesh.elements) tags.add(el.tag);
  if (tags.size === 0) tags.add(0);
  for (const tag of tags) {
    const k = coefficientAt(problem.k ?? 1, tag);
    if (!Number.isFinite(k) || k <= 0) {
      throw new Error(`fem: heat conductivity must be positive and finite (element tag ${tag})`);
    }
    const capacity = coefficientAt(problem.heatCapacity ?? 1, tag);
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`fem: heat capacity ρc must be positive and finite (element tag ${tag})`);
    }
  }

  // Assemble M and K on a shared sparsity pattern.
  const massBuilder = new CsrBuilder(n, n);
  const kBuilder = new CsrBuilder(n, n);
  addP1Mass(mesh, problem.heatCapacity ?? 1, massBuilder);
  addPoissonStiffness(mesh, problem.k ?? 1, kBuilder);
  const M = massBuilder.toCsr();
  const K = kBuilder.toCsr();
  const { lhs, rhsOp } = thetaOperators(M, K, dt, theta);

  // Time-independent boundary flux load ∫ g·N ds (Neumann), added to the
  // source vector at every step.
  const neumann = problem.neumann
    ? (Array.isArray(problem.neumann) ? problem.neumann : [problem.neumann])
    : [];
  let fluxLoad: Float64Array | null = null;
  if (neumann.length > 0) {
    fluxLoad = new Float64Array(n);
    for (const spec of neumann) {
      const selected = selectBoundaryEdges(mesh, spec.edges);
      const contribution = assembleEdgeLoad(mesh, selected, spec.flux);
      for (let i = 0; i < n; i += 1) fluxLoad[i] = fluxLoad[i]! + contribution[i]!;
    }
  }

  // Source vector at time t (volume source plus any boundary flux).
  const sourceAt = (problem.source || fluxLoad)
    ? (t: number): Float64Array => {
        const vector = problem.source
          ? assembleSourceVector(mesh, (x, y, tag) => problem.source!(x, y, t, tag))
          : new Float64Array(n);
        if (fluxLoad) {
          for (let i = 0; i < n; i += 1) vector[i] = vector[i]! + fluxLoad[i]!;
        }
        return vector;
      }
    : undefined;

  // Dirichlet DOFs (values may be prescribed per time via the value fn —
  // evaluated at t = 0 here; time-varying support uses the constant map).
  const dofs: DofValue[] = problem.dirichlet ? dirichletDofs(mesh, problem.dirichlet) : [];

  // Initial field.
  const u0 = new Float64Array(n);
  const nodes = mesh.nodes;
  for (let i = 0; i < n; i += 1) {
    u0[i] = problem.initial(nodes[i * 2]!, nodes[i * 2 + 1]!);
    if (!Number.isFinite(u0[i]!)) {
      throw new Error(`fem: initial temperature is not finite at node ${i}`);
    }
  }

  const history: Float64Array[] = [Float64Array.from(u0)];
  const times: number[] = [0];
  const energyHistory: number[] = [totalHeatEnergy(mesh, u0)];

  // March all steps in one driver call; snapshot the field after each step.
  const result = thetaTimeStep(lhs, rhsOp, u0, {
    dt,
    theta,
    steps,
    sourceAt,
    dirichlet: dofs,
    cg: problem.cg,
    onStep: (u, t) => {
      history.push(Float64Array.from(u));
      times.push(t);
      energyHistory.push(totalHeatEnergy(mesh, u));
    },
  });
  const u = result.values;

  return {
    mesh,
    values: u,
    history,
    times,
    energyHistory,
    iterations: result.iterations,
    residual: result.residual,
    theta,
    dt,
  };
}

/** Consistent P1 mass matrix scaled by ρc(tag) added into a builder. */
export function addP1Mass(mesh: PlanarMesh, heatCapacity: Coefficient, builder: CsrBuilder): void {
  const nodes = mesh.nodes;
  for (const el of mesh.elements) {
    const ax = nodes[el.a * 2]!;
    const ay = nodes[el.a * 2 + 1]!;
    const bx = nodes[el.b * 2]!;
    const by = nodes[el.b * 2 + 1]!;
    const cx = nodes[el.c * 2]!;
    const cy = nodes[el.c * 2 + 1]!;
    const area = Math.abs(0.5 * ((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)));
    const c = coefficientAt(heatCapacity, el.tag);
    const idx = [el.a, el.b, el.c];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        builder.add(idx[i]!, idx[j]!, c * area * (i === j ? 1 / 6 : 1 / 12));
      }
    }
  }
}

// ---- analytic reference case ----------------------------------------------

export const HEAT_SINE_CASE = {
  /** Unit square, k = ρc = 1 (α = 1), u = 0 on ∂Ω. */
  domain: 'unit-square' as const,
  alpha: 1,
  initial: (x: number, y: number): number => Math.sin(Math.PI * x) * Math.sin(Math.PI * y),
  exact: (x: number, y: number, t: number, alpha = 1): number =>
    Math.exp(-2 * Math.PI * Math.PI * alpha * t) * Math.sin(Math.PI * x) * Math.sin(Math.PI * y),
};
