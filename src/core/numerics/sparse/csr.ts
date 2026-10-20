// ==========================================================================
// Ergalics Studio — numerics: CSR sparse matrix utilities
//
// Square matrices in compressed sparse row format {n, indptr, indices, data}
// plus conversion, mat-vec and validation helpers used by the iterative
// solvers in this package.
// ==========================================================================

import { NumericsError, assertFinite, requireInput } from '../errors';

/** Square CSR matrix: row i occupies data[indptr[i] .. indptr[i+1]). */
export interface CSRMatrix {
  /** Dimension (n x n). */
  n: number;
  /** Row offsets, length n+1, non-decreasing, indptr[0] = 0. */
  indptr: number[];
  /** Column indices, length nnz, ascending within each row. */
  indices: number[];
  /** Non-zero values, length nnz. */
  data: number[];
}

/** Validate structure and values; requires canonical CSR (indices unique and ascending within each row). */
export function validateCSR(A: CSRMatrix): void {
  const { n, indptr, indices, data } = A;
  requireInput(Number.isInteger(n) && n > 0, 'csr: dimension must be a positive integer', { n });
  requireInput(indptr.length === n + 1, `csr: indptr must have length n+1 (${n + 1})`, { got: indptr.length });
  requireInput(indptr[0] === 0, 'csr: indptr[0] must be 0');
  for (let i = 0; i < n; i++) {
    requireInput(indptr[i + 1]! >= indptr[i]!, `csr: indptr must be non-decreasing at row ${i}`);
  }
  requireInput(indices.length === data.length, 'csr: indices and data must have the same length');
  requireInput(indices.length === indptr[n]!, 'csr: nnz mismatch with indptr[n]');
  assertFinite(data, 'csr data');
  for (let i = 0; i < n; i++) {
    const start = indptr[i]!;
    const end = indptr[i + 1]!;
    for (let p = start; p < end; p++) {
      const j = indices[p]!;
      requireInput(Number.isInteger(j) && j >= 0 && j < n, `csr: column index out of range at row ${i}`, {
        row: i,
        col: j,
      });
      if (p > start) {
        requireInput(indices[p]! > indices[p - 1]!, `csr: duplicate or unsorted column index in row ${i}`, {
          row: i,
          col: j,
        });
      }
    }
  }
}

/** Sparse matrix-vector product y = A x. */
export function csrMatVec(A: CSRMatrix, x: number[]): number[] {
  const { n, indptr, indices, data } = A;
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let p = indptr[i]!; p < indptr[i + 1]!; p++) s += data[p]! * x[indices[p]!]!;
    y[i] = s;
  }
  return y;
}

/** Build a CSR matrix from a dense row-major square matrix (zeros dropped). */
export function csrFromDense(dense: number[][]): CSRMatrix {
  const n = dense.length;
  requireInput(n > 0, 'csrFromDense: matrix must be non-empty');
  const indptr: number[] = [0];
  const indices: number[] = [];
  const data: number[] = [];
  for (let i = 0; i < n; i++) {
    const row = dense[i]!;
    requireInput(row.length === n, `csrFromDense: row ${i} has length ${row.length}, expected ${n}`);
    assertFinite(row, `csrFromDense row ${i}`);
    for (let j = 0; j < n; j++) {
      if (row[j] !== 0) {
        indices.push(j);
        data.push(row[j]!);
      }
    }
    indptr.push(indices.length);
  }
  return { n, indptr, indices, data };
}

/** Convert CSR to a dense row-major matrix (test/diagnostic helper). */
export function csrToDense(A: CSRMatrix): number[][] {
  const dense: number[][] = [];
  for (let i = 0; i < A.n; i++) dense.push(new Array<number>(A.n).fill(0));
  for (let i = 0; i < A.n; i++) {
    for (let p = A.indptr[i]!; p < A.indptr[i + 1]!; p++) {
      dense[i]![A.indices[p]!] = A.data[p]!;
    }
  }
  return dense;
}

/** Extract the main diagonal. */
export function csrDiagonal(A: CSRMatrix): number[] {
  const d = new Array<number>(A.n).fill(0);
  for (let i = 0; i < A.n; i++) {
    for (let p = A.indptr[i]!; p < A.indptr[i + 1]!; p++) {
      if (A.indices[p] === i) d[i] = A.data[p]!;
    }
  }
  return d;
}

/** Structural + numerical symmetry check (exact comparison). */
export function isSymmetric(A: CSRMatrix): boolean {
  const dense: number[][] = [];
  for (let i = 0; i < A.n; i++) dense.push(new Array<number>(A.n).fill(0));
  for (let i = 0; i < A.n; i++) {
    for (let p = A.indptr[i]!; p < A.indptr[i + 1]!; p++) {
      dense[i]![A.indices[p]!] = A.data[p]!;
    }
  }
  for (let i = 0; i < A.n; i++) {
    for (let j = i + 1; j < A.n; j++) {
      if (dense[i]![j] !== dense[j]![i]) return false;
    }
  }
  return true;
}

/** Row scaling helper: returns the maximum absolute entry per row. */
export function rowMaxAbs(A: CSRMatrix): number[] {
  const out = new Array<number>(A.n).fill(0);
  for (let i = 0; i < A.n; i++) {
    for (let p = A.indptr[i]!; p < A.indptr[i + 1]!; p++) {
      out[i] = Math.max(out[i]!, Math.abs(A.data[p]!));
    }
  }
  return out;
}

/** Throw a structured error for solver-level shape mismatches. */
export function requireCompatible(A: CSRMatrix, b: number[]): void {
  if (b.length !== A.n) {
    throw new NumericsError('numerics/shape-mismatch', `solver: b has ${b.length} entries but A is ${A.n}x${A.n}`);
  }
  assertFinite(b, 'solver rhs');
}
