// ==========================================================================
// 3-D volume solver bridge — P1 tetrahedral steady heat conduction
//
// Reuses the project's existing sparse linear algebra (CSR builder + CG/ILU0)
// and the neutral EngineeringMesh. This is the first true 3-D analysis kernel
// in the workbench: importing a tet4 mesh (Gmsh/Abaqus/Nastran/Ansys) and
// solving a steady temperature field now works end to end, and the result is
// returned as the same EngineeringField used by every viewer/exporter.
//
// Scope (deliberate, so it stays rigorous): linear P1 tetrahedra, isotropic
// per-material conductivity, Dirichlet node temperatures and a constant
// volumetric source. Structural/hexa/transient 3-D are follow-ups.
// ==========================================================================

import { CsrBuilder, type CsrMatrix as FemCsr } from '@/core/fem/assemble/stiffness';
import { solve, type CSRMatrix, type UnifiedSolveResult } from '@/core/numerics/sparse';
import { coefficientByTag } from './materials';
import type {
  EngineeringField,
  EngineeringMesh,
  EngineeringStudy,
} from './types';

/** Nodes addressed by a BC target (0-D groups = nodes, higher = element nodes). */
function targetNodes(
  mesh: EngineeringMesh,
  target: { dimension: number; tag: number },
): number[] {
  const group = mesh.groups.find((g) => g.dimension === target.dimension && g.tag === target.tag);
  if (!group) return [];
  if (target.dimension === 0) return [...group.members];
  const nodes = new Set<number>();
  for (const elementIndex of group.members) {
    const element = mesh.elements[elementIndex];
    if (element) for (const node of element.nodes) nodes.add(node);
  }
  return [...nodes].sort((a, b) => a - b);
}

/** Convert the FEM kernel's CSR to the numerics solver's CSR layout. */
function toSolverCSR(matrix: FemCsr): CSRMatrix {
  return {
    n: matrix.rows,
    indptr: Array.from(matrix.rowPtr),
    indices: Array.from(matrix.colIdx),
    data: Array.from(matrix.values),
  };
}

export class Solve3DError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Solve3DError';
  }
}

/** Signed volume of a tetrahedral element (positive when CCW). */
export function tetVolume(mesh: EngineeringMesh, elementIndex: number): number {
  const element = mesh.elements[elementIndex]!;
  if (element.nodes.length !== 4) return 0;
  const pts = element.nodes.map((i) => mesh.nodes[i]!);
  const [a, b, c, d] = [pts[0]!, pts[1]!, pts[2]!, pts[3]!];
  const b0 = [b.x - a.x, b.y - a.y, b.z - a.z];
  const c0 = [c.x - a.x, c.y - a.y, c.z - a.z];
  const d0 = [d.x - a.x, d.y - a.y, d.z - a.z];
  const det =
    b0[0]! * (c0[1]! * d0[2]! - c0[2]! * d0[1]!) -
    b0[1]! * (c0[0]! * d0[2]! - c0[2]! * d0[0]!) +
    b0[2]! * (c0[0]! * d0[1]! - c0[1]! * d0[0]!);
  return det / 6;
}

/** Shape-function gradients ∇N0..N3 for a P1 tetrahedron. */
function tetGradients(mesh: EngineeringMesh, elementIndex: number): number[][] {
  const element = mesh.elements[elementIndex]!;
  const p = element.nodes.map((i) => mesh.nodes[i]!);
  // Matrix B = [[x1-x0, y1-y0, z1-z0], [x2-x0,...], [x3-x0,...]]
  // ∇N1..N3 are rows of B⁻¹; ∇N0 = -(∇N1+∇N2+∇N3).
  const m = [
    [p[1]!.x - p[0]!.x, p[1]!.y - p[0]!.y, p[1]!.z - p[0]!.z],
    [p[2]!.x - p[0]!.x, p[2]!.y - p[0]!.y, p[2]!.z - p[0]!.z],
    [p[3]!.x - p[0]!.x, p[3]!.y - p[0]!.y, p[3]!.z - p[0]!.z],
  ];
  const det =
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  if (Math.abs(det) < 1e-14) return [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  // Inverse of 3x3 via cofactors (rows of inverse are columns of adjugate/det).
  const inv = [
    [
      (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) / det,
      (m[0]![2]! * m[2]![1]! - m[0]![1]! * m[2]![2]!) / det,
      (m[0]![1]! * m[1]![2]! - m[0]![2]! * m[1]![1]!) / det,
    ],
    [
      (m[1]![2]! * m[2]![0]! - m[1]![0]! * m[2]![2]!) / det,
      (m[0]![0]! * m[2]![2]! - m[0]![2]! * m[2]![0]!) / det,
      (m[0]![2]! * m[1]![0]! - m[0]![0]! * m[1]![2]!) / det,
    ],
    [
      (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!) / det,
      (m[0]![1]! * m[2]![0]! - m[0]![0]! * m[2]![1]!) / det,
      (m[0]![0]! * m[1]![1]! - m[0]![1]! * m[1]![0]!) / det,
    ],
  ];
  // Rows of B⁻¹ are ∇N1, ∇N2, ∇N3 (since N_i = B⁻¹ (x-x0) components).
  const g1 = inv[0]!;
  const g2 = inv[1]!;
  const g3 = inv[2]!;
  const g0 = [-(g1[0]! + g2[0]! + g3[0]!), -(g1[1]! + g2[1]! + g3[1]!), -(g1[2]! + g2[2]! + g3[2]!)];
  return [g0, g1, g2, g3];
}

/** Assemble the 3-D steady-heat system K·T = f for a tet4 mesh. */
export function assembleTetHeat(
  mesh: EngineeringMesh,
  conductivity: number | Record<number, number>,
  source: number,
): { K: CSRMatrix; f: Float64Array } {
  const n = mesh.nodes.length;
  const builder = new CsrBuilder(n, n);
  const f = new Float64Array(n);
  const kAt = (tag: number | undefined): number => {
    if (typeof conductivity === 'number') return conductivity;
    if (tag !== undefined && conductivity[tag] !== undefined) return conductivity[tag]!;
    return Object.values(conductivity)[0] ?? 1;
  };
  for (let e = 0; e < mesh.elements.length; e += 1) {
    const element = mesh.elements[e]!;
    if (element.type !== 'tet4' || element.nodes.length !== 4) continue;
    const volume = Math.abs(tetVolume(mesh, e));
    if (volume <= 0) continue;
    const k = kAt(element.group);
    const grads = tetGradients(mesh, e);
    for (let i = 0; i < 4; i += 1) {
      const ni = element.nodes[i]!;
      f[ni]! += (source * volume) / 4;
      for (let j = 0; j < 4; j += 1) {
        const nj = element.nodes[j]!;
        let dot = 0;
        for (let d = 0; d < 3; d += 1) dot += grads[i]![d]! * grads[j]![d]!;
        builder.add(ni, nj, k * volume * dot);
      }
    }
  }
  return { K: toSolverCSR(builder.toCsr()), f };
}

export interface Solve3DOptions {
  source?: number;
  tolerance?: number;
  maxIterations?: number;
}

/** Solve a 3-D steady-heat problem on an EngineeringStudy's tet4 mesh. */
export function solve3DSteadyHeat(
  study: EngineeringStudy,
  options: Solve3DOptions = {},
): { field: EngineeringField; iterations: number; residual: number } {
  const mesh = study.mesh;
  if (!mesh.elements.some((e) => e.type === 'tet4')) {
    throw new Solve3DError('3-D solve requires tet4 elements in the mesh');
  }
  // Neumann (heat-flux) boundary conditions are not assembled on the volume
  // boundary, so refuse them instead of silently dropping the load.
  const heatFlux = study.boundaryConditions.find((condition) => condition.kind === 'heat-flux');
  if (heatFlux) {
    throw new Solve3DError(
      `3-D steady heat does not support the heat-flux boundary condition "${heatFlux.name}" ` +
        `(group ${heatFlux.target.dimension}:${heatFlux.target.tag}); use a temperature BC instead`,
    );
  }
  const tags = [...new Set(mesh.elements.map((e) => e.group).filter((v): v is number => v !== undefined))];
  const conductivity = coefficientByTag(
    study.materials, study.materialAssignment, 'k', 1,
    tags.length > 0 ? tags : [0],
  );
  const { K, f } = assembleTetHeat(mesh, conductivity, options.source ?? 0);

  // Dirichlet temperatures from temperature BCs.
  const prescribed = new Map<number, number>();
  for (const condition of study.boundaryConditions) {
    if (condition.kind !== 'temperature') continue;
    for (const node of targetNodes(mesh, condition.target)) {
      prescribed.set(node, condition.components[0] ?? 0);
    }
  }
  if (prescribed.size === 0) {
    throw new Solve3DError('no temperature boundary condition: add one on a node/element group');
  }

  // Eliminate prescribed dofs by row/column zeroing + rhs adjustment.
  const n = mesh.nodes.length;
  const kept = Array.from({ length: n }, (_, i) => i).filter((i) => !prescribed.has(i));
  const reduced = new CsrBuilder(kept.length, kept.length);
  // Map original row → reduced row index (prescribed rows are dropped).
  const reducedRow = new Map<number, number>();
  kept.forEach((node, i) => reducedRow.set(node, i));
  for (let row = 0; row < K.n; row += 1) {
    const ri = reducedRow.get(row);
    if (ri === undefined) continue;
    for (let p = K.indptr[row]!; p < K.indptr[row + 1]!; p += 1) {
      const col = K.indices[p]!;
      const ci = reducedRow.get(col);
      if (ci !== undefined) reduced.add(ri, ci, K.data[p]!);
    }
  }
  // Every node prescribed → no free system to solve (the field is fully known).
  if (kept.length === 0) {
    const values = new Float64Array(n);
    for (const [node, value] of prescribed) values[node] = value;
    return {
      field: { name: 'temperature', location: 'node', components: 1, values, unit: 'K' },
      iterations: 0,
      residual: 0,
    };
  }
  const b = new Array<number>(kept.length).fill(0);
  for (let i = 0; i < kept.length; i += 1) {
    const row = kept[i]!;
    let rhs = f[row]!;
    for (let p = K.indptr[row]!; p < K.indptr[row + 1]!; p += 1) {
      const col = K.indices[p]!;
      const value = prescribed.get(col);
      if (value !== undefined) rhs -= K.data[p]! * value;
    }
    b[i] = rhs;
  }
  const Kr = toSolverCSR(reduced.toCsr());
  const result: UnifiedSolveResult = solve(Kr, b, {
    // The assembled tet stiffness is symmetric positive definite by
    // construction, so skip the 'auto' symmetry check (it materialises an
    // O(n²) dense array and becomes an OOM on large meshes).
    method: 'cg',
    precond: 'jacobi',
    tol: options.tolerance ?? 1e-9,
    maxIter: options.maxIterations ?? 2000,
  });
  if (!result.converged) {
    throw new Solve3DError(
      `3-D steady-heat solve did not converge after ${result.iterations} iterations ` +
        `(relative residual ${result.relResidual}); increase maxIterations or relax tolerance`,
    );
  }
  const solution = Float64Array.from(result.x);
  const values = new Float64Array(n);
  for (const [node, value] of prescribed) values[node] = value;
  kept.forEach((node, i) => { values[node] = solution[i]!; });
  return {
    field: { name: 'temperature', location: 'node', components: 1, values, unit: 'K' },
    iterations: result.iterations ?? 0,
    residual: result.relResidual ?? 0,
  };
}
