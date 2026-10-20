// ==========================================================================
// FEM core — Dirichlet boundary conditions.
//
// Two imposition flavours are provided:
//   - `applyDirichlet`: exact elimination (zero rows/columns, unit diagonal),
//     which preserves symmetry and keeps the linear system well-posed;
//   - `applyDirichletPenalty`: the "big number" method, useful when the
//     caller wants to keep the matrix pattern untouched.
// Plus the node selectors used to build constrained sets from boundary edge
// tags, node tags or coordinate predicates.
// ==========================================================================

import { CsrMatrix } from '../assemble/stiffness';
import { PlanarMesh, nodeCount, nodeX, nodeY } from '../mesh/types';

export interface DofValue {
  dof: number;
  value: number;
}

/** All nodes lying on the given boundary edge tags. */
export function selectEdgeNodes(mesh: PlanarMesh, edgeTags: number[]): number[] {
  const wanted = new Set(edgeTags);
  const nodes = new Set<number>();
  for (const e of mesh.boundaryEdges) {
    if (wanted.has(e.tag)) {
      nodes.add(e.a);
      nodes.add(e.b);
    }
  }
  return [...nodes].sort((a, b) => a - b);
}

/** All nodes carrying the given node tag. */
export function selectTaggedNodes(mesh: PlanarMesh, nodeTag: number): number[] {
  const nodes: number[] = [];
  for (let i = 0; i < nodeCount(mesh); i += 1) {
    if (mesh.nodeTags[i] === nodeTag) nodes.push(i);
  }
  return nodes;
}

/** Nodes matching a coordinate predicate (x, y) → boolean. */
export function selectNodesByPredicate(mesh: PlanarMesh, predicate: (x: number, y: number) => boolean): number[] {
  const nodes: number[] = [];
  for (let i = 0; i < nodeCount(mesh); i += 1) {
    if (predicate(nodeX(mesh, i), nodeY(mesh, i))) nodes.push(i);
  }
  return nodes;
}

/**
 * RHS correction for Dirichlet data: corr_i = Σ_d K_id·g_d. Must be computed
 * on the PRISTINE matrix (before `eliminateDirichletMatrix`).
 */
export function dirichletCorrection(A: CsrMatrix, dofValues: DofValue[]): Float64Array {
  const constrained = new Map<number, number>();
  for (const { dof, value } of dofValues) constrained.set(dof, value);
  const corr = new Float64Array(A.rows);
  if (constrained.size === 0) return corr;
  for (let row = 0; row < A.rows; row += 1) {
    for (let k = A.rowPtr[row]!; k < A.rowPtr[row + 1]!; k += 1) {
      const g = constrained.get(A.colIdx[k]!);
      if (g !== undefined) corr[row] = corr[row]! + A.values[k]! * g;
    }
  }
  return corr;
}

/**
 * Matrix-side Dirichlet elimination, in place: zero constrained rows and
 * columns, set a unit diagonal on constrained rows. The matrix stays
 * symmetric. (RHS handling is up to the caller — see `applyDirichlet` for
 * the one-shot stationary variant.)
 */
export function eliminateDirichletMatrix(A: CsrMatrix, dofValues: DofValue[]): void {
  const constrained = new Set<number>();
  for (const { dof } of dofValues) constrained.add(dof);
  if (constrained.size === 0) return;
  for (let row = 0; row < A.rows; row += 1) {
    const rowFixed = constrained.has(row);
    for (let k = A.rowPtr[row]!; k < A.rowPtr[row + 1]!; k += 1) {
      const col = A.colIdx[k]!;
      if (rowFixed || constrained.has(col)) A.values[k] = 0;
      if (rowFixed && col === row) A.values[k] = 1;
    }
  }
}

/**
 * Strong Dirichlet imposition by elimination, in place. For each constrained
 * DOF d with value g the RHS is corrected (f_i -= K_id·g), then rows and
 * columns d are zeroed and the diagonal set to 1 so the solve reproduces
 * exactly the prescribed values. Symmetry of the constrained matrix is kept.
 */
export function applyDirichlet(A: CsrMatrix, f: Float64Array, dofValues: DofValue[]): void {
  const constrained = new Map<number, number>();
  for (const { dof, value } of dofValues) constrained.set(dof, value);
  if (constrained.size === 0) return;

  // Pass 1: adjust the RHS with the original matrix values.
  for (let row = 0; row < A.rows; row += 1) {
    if (constrained.has(row)) continue;
    for (let k = A.rowPtr[row]!; k < A.rowPtr[row + 1]!; k += 1) {
      const col = A.colIdx[k]!;
      const g = constrained.get(col);
      if (g !== undefined) f[row] = f[row]! - A.values[k]! * g;
    }
  }
  for (const [dof, value] of constrained) f[dof] = value;

  // Pass 2: zero constrained columns, then whole constrained rows, then set
  // a unit diagonal on the constrained rows.
  eliminateDirichletMatrix(A, dofValues);
}

/**
 * Big-number (penalty) imposition: add `penalty` to the diagonal and
 * `penalty·g` to the RHS so the solve drives u_d → g. The matrix stays
 * symmetric; `penalty` should be ~1e10 × the largest diagonal entry.
 */
export function applyDirichletPenalty(A: CsrMatrix, f: Float64Array, dofValues: DofValue[], penalty?: number): void {
  let scale = 0;
  const diag = new Float64Array(A.rows);
  for (let row = 0; row < A.rows; row += 1) {
    for (let k = A.rowPtr[row]!; k < A.rowPtr[row + 1]!; k += 1) {
      if (A.colIdx[k] === row) {
        diag[row] = A.values[k]!;
        scale = Math.max(scale, Math.abs(A.values[k]!));
      }
    }
  }
  const p = penalty ?? scale * 1e10 + 1;
  for (const { dof, value } of dofValues) {
    for (let k = A.rowPtr[dof]!; k < A.rowPtr[dof + 1]!; k += 1) {
      if (A.colIdx[k] === dof) {
        A.values[k] = diag[dof]! + p;
        f[dof] = (diag[dof]! + p) * value;
      }
    }
  }
}
