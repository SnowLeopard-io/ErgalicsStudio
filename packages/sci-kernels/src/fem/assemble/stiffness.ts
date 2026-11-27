// ==========================================================================
// FEM core — sparse matrix (COO → CSR) and P1 stiffness / mass assembly.
// ==========================================================================

import { p1Basis } from './basis';
import { PlanarMesh, nodeCount } from '../mesh/types';

/** Compressed sparse row matrix (square unless stated otherwise). */
export interface CsrMatrix {
  rows: number;
  cols: number;
  /** Length `rows + 1`; row i occupies `[rowPtr[i], rowPtr[i+1])`. */
  rowPtr: Int32Array;
  /** Column indices, ascending within each row. */
  colIdx: Int32Array;
  values: Float64Array;
}

/** Sparse accumulator: triplets merged on conversion. */
export class CsrBuilder {
  private r: number[] = [];
  private c: number[] = [];
  private v: number[] = [];

  constructor(public rows: number, public cols = rows) {}

  /**
   * Add `value` to entry (row, col). Zero values are kept on purpose so two
   * matrices assembled over the same mesh share an identical sparsity
   * pattern (the θ-scheme relies on that).
   */
  add(row: number, col: number, value: number): void {
    this.r.push(row);
    this.c.push(col);
    this.v.push(value);
  }

  get entryCount(): number {
    return this.v.length;
  }

  /** Merge triplets (summing duplicates) into a CSR matrix. */
  toCsr(): CsrMatrix {
    const nnz = this.v.length;
    const order: number[] = Array.from({ length: nnz }, (_, i) => i);
    // Sort triplet ids by (row, col) so duplicates become adjacent.
    order.sort((ia, ib) => {
      const ra = this.r[ia]!;
      const rb = this.r[ib]!;
      if (ra !== rb) return ra - rb;
      return this.c[ia]! - this.c[ib]!;
    });
    const mergedRow: number[] = [];
    const mergedCol: number[] = [];
    const mergedVal: number[] = [];
    for (const i of order) {
      const row = this.r[i]!;
      const col = this.c[i]!;
      const val = this.v[i]!;
      const m = mergedRow.length;
      if (m > 0 && mergedRow[m - 1] === row && mergedCol[m - 1] === col) {
        mergedVal[m - 1] = mergedVal[m - 1]! + val;
      } else {
        mergedRow.push(row);
        mergedCol.push(col);
        mergedVal.push(val);
      }
    }
    // Derive row pointers from the row-sorted merged stream.
    const rowPtr = new Int32Array(this.rows + 1);
    let p = 0;
    for (let row = 0; row < this.rows; row += 1) {
      rowPtr[row] = p;
      while (p < mergedRow.length && mergedRow[p] === row) p += 1;
    }
    rowPtr[this.rows] = mergedRow.length;
    return {
      rows: this.rows,
      cols: this.cols,
      rowPtr,
      colIdx: Int32Array.from(mergedCol),
      values: Float64Array.from(mergedVal),
    };
  }
}

/** y = A·x. */
export function csrMulVec(A: CsrMatrix, x: ArrayLike<number>, y: Float64Array): void {
  for (let i = 0; i < A.rows; i += 1) {
    let sum = 0;
    for (let k = A.rowPtr[i]!; k < A.rowPtr[i + 1]!; k += 1) {
      sum += A.values[k]! * x[A.colIdx[k]!]!;
    }
    y[i] = sum;
  }
}

/** Diagonal entries of A (missing diagonals count as 0). */
export function csrDiagonal(A: CsrMatrix): Float64Array {
  const d = new Float64Array(A.rows);
  for (let i = 0; i < A.rows; i += 1) {
    for (let k = A.rowPtr[i]!; k < A.rowPtr[i + 1]!; k += 1) {
      if (A.colIdx[k] === i) d[i] = A.values[k]!;
    }
  }
  return d;
}

/** Selector for a piecewise-constant coefficient: constant | per-tag map | fn. */
export type Coefficient =
  | number
  | Record<number, number>
  | ((tag: number) => number);

export function coefficientAt(k: Coefficient, tag: number): number {
  if (typeof k === 'number') return k;
  if (typeof k === 'function') return k(tag);
  return k[tag] ?? k[0] ?? 0;
}

/**
 * Assemble the P1 stiffness matrix K_ij = ∫ k ∇λi·∇λj dΩ for
 * −∇·(k∇u) = f. `k` may vary per element physical tag (multi-material).
 * The result is symmetric positive (semi-)definite for k > 0.
 */
export function assembleP1Stiffness(mesh: PlanarMesh, k: Coefficient = 1): CsrMatrix {
  const n = nodeCount(mesh);
  const builder = new CsrBuilder(n, n);
  const nodes = mesh.nodes;
  for (const el of mesh.elements) {
    const basis = p1Basis(
      nodes[el.a * 2]!, nodes[el.a * 2 + 1]!,
      nodes[el.b * 2]!, nodes[el.b * 2 + 1]!,
      nodes[el.c * 2]!, nodes[el.c * 2 + 1]!,
    );
    const ke = coefficientAt(k, el.tag);
    const g = basis.grad;
    const idx = [el.a, el.b, el.c];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        const gradDot = g[i * 2]! * g[j * 2]! + g[i * 2 + 1]! * g[j * 2 + 1]!;
        builder.add(idx[i]!, idx[j]!, ke * basis.area * gradDot);
      }
    }
  }
  return builder.toCsr();
}

/**
 * Assemble the consistent P1 mass matrix M_ij = ∫ λi λj dΩ
 * (diag = A/6, off-diag = A/12).
 */
export function assembleP1Mass(mesh: PlanarMesh): CsrMatrix {
  const n = nodeCount(mesh);
  const builder = new CsrBuilder(n, n);
  const nodes = mesh.nodes;
  for (const el of mesh.elements) {
    const area = Math.abs(
      0.5 * ((nodes[el.b * 2]! - nodes[el.a * 2]!) * (nodes[el.c * 2 + 1]! - nodes[el.a * 2 + 1]!) -
        (nodes[el.c * 2]! - nodes[el.a * 2]!) * (nodes[el.b * 2 + 1]! - nodes[el.a * 2 + 1]!)),
    );
    const idx = [el.a, el.b, el.c];
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        builder.add(idx[i]!, idx[j]!, area * (i === j ? 1 / 6 : 1 / 12));
      }
    }
  }
  return builder.toCsr();
}
