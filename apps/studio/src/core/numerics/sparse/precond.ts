// ==========================================================================
// Ergalics Studio — numerics: sparse preconditioners
//
// Jacobi (diagonal) scaling and ILU(0) — incomplete LU with the same
// sparsity pattern as A (Saad's IKJ variant, no fill-in, no pivoting).
// The ILU(0) factorisation reuses the CSR pattern of A: the factorised
// matrix stores the unit lower triangular L (implicit 1 diagonal) and the
// upper triangular U (explicit diagonal) in the same positions.
// ==========================================================================

import { NumericsError, assertFinite } from '../errors';
import { csrDiagonal, type CSRMatrix } from './csr';

/** Preconditioner interface shared by the iterative solvers. */
export interface Preconditioner {
  /** Human-readable name for diagnostics. */
  readonly name: string;
  /** Apply the preconditioner: returns M^{-1} r. */
  apply: (r: number[]) => number[];
}

/** Jacobi (diagonal) preconditioner. Throws on a zero diagonal entry. */
export function jacobiPreconditioner(A: CSRMatrix): Preconditioner {
  const d = csrDiagonal(A);
  for (let i = 0; i < d.length; i++) {
    if (d[i] === 0 || !Number.isFinite(d[i]!)) {
      throw new NumericsError('numerics/singular', `jacobi: zero diagonal at row ${i} (use ilu0 instead)`, { row: i });
    }
  }
  return {
    name: 'jacobi',
    apply: (r: number[]): number[] => {
      assertFinite(r, 'jacobi rhs');
      return r.map((v, i) => v / d[i]!);
    },
  };
}

/**
 * ILU(0) preconditioner. Workspace is O(n) beyond the factor; the
 * factorisation costs O(sum over rows of pattern intersections).
 * Throws `numerics/zero-pivot` when a pivot underflows (no pivoting here).
 */
export function ilu0Preconditioner(A: CSRMatrix): Preconditioner {
  const { n, indptr, indices } = A;
  // Factorised values, same pattern as A.
  const data = A.data.slice();

  // Dense work row + pattern markers (marker[j] === i+1 => column j is in row i's pattern).
  const rowWork = new Array<number>(n).fill(0);
  const marker = new Array<number>(n).fill(0);
  // Dense cache of the most recently used factorised row k (U part only).
  const ukRow = new Array<number>(n).fill(0);
  let ukCached = -1;

  for (let i = 0; i < n; i++) {
    // Load row i into the dense work array.
    for (let p = indptr[i]!; p < indptr[i + 1]!; p++) {
      rowWork[indices[p]!] = data[p]!;
      marker[indices[p]!] = i + 1;
    }
    // Eliminate with previous rows that share the pattern.
    for (let p = indptr[i]!; p < indptr[i + 1]!; p++) {
      const k = indices[p]!;
      if (k >= i) break; // pattern is sorted: everything after is upper
      if (ukCached !== k) {
        // Extract factorised row k (entries j >= k; L entry at j=k is the multiplier itself).
        for (let q = indptr[k]!; q < indptr[k + 1]!; q++) {
          const j = indices[q]!;
          ukRow[j] = j >= k ? data[q]! : 0;
        }
        ukCached = k;
      }
      const aik = rowWork[k]! / ukRow[k]!;
      rowWork[k] = aik; // store the L multiplier
      if (aik !== 0) {
        for (let q = indptr[k]!; q < indptr[k + 1]!; q++) {
          const j = indices[q]!;
          if (j > k && marker[j] === i + 1) {
            rowWork[j] = rowWork[j]! - aik * ukRow[j]!;
          }
        }
      }
    }
    // Write back and check the pivot.
    const pivot = rowWork[i]!;
    if (!Number.isFinite(pivot) || Math.abs(pivot) < 1e-300) {
      throw new NumericsError('numerics/zero-pivot', `ilu0: (near-)zero pivot at row ${i}`, { row: i });
    }
    for (let p = indptr[i]!; p < indptr[i + 1]!; p++) {
      const j = indices[p]!;
      data[p] = rowWork[j]!;
      rowWork[j] = 0;
      marker[j] = 0;
    }
  }

  return {
    name: 'ilu0',
    apply: (r: number[]): number[] => {
      assertFinite(r, 'ilu0 rhs');
      const y = new Array<number>(n);
      // Forward solve L y = r (unit diagonal).
      for (let i = 0; i < n; i++) {
        let s = r[i]!;
        for (let p = indptr[i]!; p < indptr[i + 1]!; p++) {
          const j = indices[p]!;
          if (j < i) s -= data[p]! * y[j]!;
        }
        y[i] = s;
      }
      // Back solve U x = y.
      const x = new Array<number>(n).fill(0);
      for (let i = n - 1; i >= 0; i--) {
        let s = y[i]!;
        let diag = 0;
        for (let p = indptr[i]!; p < indptr[i + 1]!; p++) {
          const j = indices[p]!;
          if (j > i) s -= data[p]! * x[j]!;
          else if (j === i) diag = data[p]!;
        }
        x[i] = s / diag;
      }
      return x;
    },
  };
}
