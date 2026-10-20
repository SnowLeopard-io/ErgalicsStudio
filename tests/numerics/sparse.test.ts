// Tests for src/core/numerics/sparse: CSR helpers, CG, GMRES, preconditioners
// and the unified `solve` entry point.
import { describe, expect, it } from 'vitest';
import { NumericsError } from '../../src/core/numerics/errors';
import {
  csrDiagonal,
  csrFromDense,
  csrMatVec,
  csrToDense,
  isSymmetric,
  rowMaxAbs,
  validateCSR,
  type CSRMatrix,
} from '../../src/core/numerics/sparse/csr';
import { cgSolve } from '../../src/core/numerics/sparse/cg';
import { gmresSolve } from '../../src/core/numerics/sparse/gmres';
import { ilu0Preconditioner, jacobiPreconditioner } from '../../src/core/numerics/sparse/precond';
import { solve } from '../../src/core/numerics/sparse/linsolve';

function expectNumericsError(fn: () => unknown, code?: string): void {
  let threw = false;
  try {
    fn();
  } catch (err) {
    threw = true;
    expect(err).toBeInstanceOf(NumericsError);
    if (code !== undefined) expect((err as NumericsError).code).toBe(code);
  }
  expect(threw).toBe(true);
}

/** Deterministic PRNG (mulberry32) so the random-system tests are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** m x m 5-point Poisson matrix (SPD, natural row ordering, canonical CSR). */
function poisson2D(m: number): CSRMatrix {
  const n = m * m;
  const indptr: number[] = [0];
  const indices: number[] = [];
  const data: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / m);
    const c = i % m;
    if (r > 0) {
      indices.push(i - m);
      data.push(-1);
    }
    if (c > 0) {
      indices.push(i - 1);
      data.push(-1);
    }
    indices.push(i);
    data.push(4);
    if (c < m - 1) {
      indices.push(i + 1);
      data.push(-1);
    }
    if (r < m - 1) {
      indices.push(i + m);
      data.push(-1);
    }
    indptr.push(indices.length);
  }
  return { n, indptr, indices, data };
}

describe('csr helpers', () => {
  const A = csrFromDense([
    [1, 2],
    [0, 3],
  ]);

  it('builds canonical CSR from dense and round-trips', () => {
    expect(A).toEqual({ n: 2, indptr: [0, 2, 3], indices: [0, 1, 1], data: [1, 2, 3] });
    expect(csrToDense(A)).toEqual([
      [1, 2],
      [0, 3],
    ]);
  });

  it('computes mat-vec, diagonal, symmetry and row scales', () => {
    expect(csrMatVec(A, [1, 1])).toEqual([3, 3]);
    expect(csrDiagonal(A)).toEqual([1, 3]);
    expect(isSymmetric(A)).toBe(false);
    expect(
      isSymmetric(
        csrFromDense([
          [1, 2],
          [2, 1],
        ]),
      ),
    ).toBe(true);
    expect(rowMaxAbs(A)).toEqual([2, 3]);
  });

  it('validates structure and rejects malformed input', () => {
    expect(() => validateCSR(A)).not.toThrow();
    expectNumericsError(
      () => validateCSR({ n: 2, indptr: [0, 1], indices: [], data: [] }),
      'numerics/invalid-input',
    );
    expectNumericsError(
      () => validateCSR({ n: 2, indptr: [0, 2, 3], indices: [0, 0, 1], data: [1, 2, 3] }),
      'numerics/invalid-input',
    );
    expectNumericsError(
      () => validateCSR({ n: 2, indptr: [0, 1, 2], indices: [5, 1], data: [1, 2] }),
      'numerics/invalid-input',
    );
  });
});

describe('cg', () => {
  it('solves a random SPD system to the true solution', () => {
    const rng = mulberry32(20261020);
    const n = 12;
    const B: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) row.push(rng() * 2 - 1);
      B.push(row);
    }
    const dense: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += B[k]![i]! * B[k]![j]!; // (B^T B)_ij, exactly symmetric
        row.push(s + (i === j ? 12 : 0));
      }
      dense.push(row);
    }
    const A = csrFromDense(dense);
    const b = csrMatVec(A, new Array<number>(n).fill(1));
    const res = cgSolve(A, b, { tol: 1e-10 });
    expect(res.converged).toBe(true);
    expect(res.relResidual).toBeLessThanOrEqual(1e-10);
    for (let i = 0; i < n; i++) expect(res.x[i]!).toBeCloseTo(1, 6);
  });

  it('terminates within #distinct-eigenvalue iterations on a diagonal SPD system', () => {
    const A = csrFromDense([
      [1, 0],
      [0, 10],
    ]);
    const res = cgSolve(A, [1, 1], { tol: 1e-10 });
    expect(res.converged).toBe(true);
    expect(res.iterations).toBeLessThanOrEqual(2);
    expect(res.x[0]!).toBeCloseTo(1, 8);
    expect(res.x[1]!).toBeCloseTo(0.1, 8);
  });

  it('rejects non-SPD systems with a structured error', () => {
    const A = csrFromDense([
      [1, 0],
      [0, -1],
    ]);
    expectNumericsError(() => cgSolve(A, [1, 1]), 'numerics/singular');
  });

  it('returns the zero solution for a zero rhs', () => {
    const A = csrFromDense([
      [2, 0],
      [0, 3],
    ]);
    const res = cgSolve(A, [0, 0]);
    expect(res.converged).toBe(true);
    expect(res.iterations).toBe(0);
    expect(res.x).toEqual([0, 0]);
  });

  it('reports converged=false when the iteration budget is exhausted', () => {
    const A = poisson2D(4);
    const b = csrMatVec(A, new Array<number>(16).fill(1));
    const res = cgSolve(A, b, { tol: 1e-12, maxIter: 2 });
    expect(res.converged).toBe(false);
    expect(res.iterations).toBe(2);
    expect(res.relResidual).toBeLessThan(1);
  });

  it('applies the Jacobi preconditioner and labels the method', () => {
    const A = poisson2D(4);
    const b = csrMatVec(A, new Array<number>(16).fill(1));
    const res = cgSolve(A, b, { precond: jacobiPreconditioner(A) });
    expect(res.method).toBe('cg(jacobi)');
    expect(res.converged).toBe(true);
    for (let i = 0; i < 16; i++) expect(res.x[i]!).toBeCloseTo(1, 6);
  });
});

describe('gmres', () => {
  it('solves a non-symmetric diagonally dominant system with restarts', () => {
    const rng = mulberry32(7);
    const n = 10;
    const dense: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < n; j++) row.push(i === j ? 30 + rng() : rng() * 2 - 1);
      dense.push(row);
    }
    const A = csrFromDense(dense);
    const xTrue = Array.from({ length: n }, (_, i) => i + 1);
    const b = csrMatVec(A, xTrue);
    const res = gmresSolve(A, b, { restart: 3, tol: 1e-10 });
    expect(res.converged).toBe(true);
    for (let i = 0; i < n; i++) expect(res.x[i]!).toBeCloseTo(i + 1, 6);
  });

  it('accepts a Jacobi preconditioner', () => {
    const A = csrFromDense([
      [3, 1],
      [0.5, 4],
    ]);
    const b = csrMatVec(A, [2, -1]);
    const res = gmresSolve(A, b, { precond: jacobiPreconditioner(A), tol: 1e-10 });
    expect(res.method).toBe('gmres(jacobi)');
    expect(res.converged).toBe(true);
    expect(res.x[0]!).toBeCloseTo(2, 8);
    expect(res.x[1]!).toBeCloseTo(-1, 8);
  });
});

describe('ilu(0) preconditioner', () => {
  it('reduces CG iterations on the 2-D Poisson system', () => {
    // 6x6 grid: on a 4x4 grid only ~6 distinct eigenvalues exist and rounding
    // dominates at tol 1e-10, masking the preconditioner effect (both solvers
    // tie at the same iteration count).
    const A = poisson2D(6);
    // Random rhs: a linear x_true is discrete-harmonic (A x vanishes at the
    // interior nodes) and collapses the Krylov space just like b = A * ones,
    // which would mask the preconditioner effect.
    const rng = mulberry32(20261020);
    const xTrue = Array.from({ length: 36 }, () => rng() * 4 - 2);
    const b = csrMatVec(A, xTrue);
    const plain = cgSolve(A, b, { tol: 1e-10 });
    const ilu = cgSolve(A, b, { tol: 1e-10, precond: ilu0Preconditioner(A) });
    expect(plain.converged).toBe(true);
    expect(ilu.converged).toBe(true);
    expect(ilu.method).toBe('cg(ilu0)');
    expect(ilu.iterations).toBeLessThan(plain.iterations);
    for (let i = 0; i < 36; i++) expect(ilu.x[i]!).toBeCloseTo(xTrue[i]!, 6);
  });

  it('rejects a zero diagonal for the Jacobi preconditioner', () => {
    const A = csrFromDense([
      [1, 0],
      [0, 0],
    ]);
    expectNumericsError(() => jacobiPreconditioner(A), 'numerics/singular');
  });
});

describe('unified solve', () => {
  it('dispatches symmetric systems to cg in auto mode', () => {
    const res = solve(
      [
        [4, 1],
        [1, 3],
      ],
      [1, 2],
    );
    expect(res.method).toBe('cg');
    expect(res.precond).toBe('none');
    expect(res.converged).toBe(true);
    expect(res.x[0]!).toBeCloseTo(1 / 11, 8);
    expect(res.x[1]!).toBeCloseTo(7 / 11, 8);
  });

  it('dispatches non-symmetric systems to gmres in auto mode', () => {
    const res = solve(
      [
        [2, 1],
        [0, 3],
      ],
      [1, 2],
    );
    expect(res.method).toBe('gmres');
    expect(res.converged).toBe(true);
    expect(res.x[0]!).toBeCloseTo(1 / 6, 8);
    expect(res.x[1]!).toBeCloseTo(2 / 3, 8);
  });

  it('accepts named and custom preconditioners', () => {
    const r1 = solve(
      [
        [4, 1],
        [1, 3],
      ],
      [1, 2],
      { method: 'cg', precond: 'jacobi' },
    );
    expect(r1.precond).toBe('jacobi');
    expect(r1.converged).toBe(true);

    const r2 = solve(
      [
        [4, 1],
        [1, 3],
      ],
      [1, 2],
      { method: 'cg', precond: 'ilu0' },
    );
    expect(r2.precond).toBe('ilu0');
    expect(r2.converged).toBe(true);

    const r3 = solve(
      [
        [4, 0],
        [0, 8],
      ],
      [4, 16],
      { precond: { name: 'exact', apply: (r) => [r[0]! / 4, r[1]! / 8] } },
    );
    expect(r3.precond).toBe('exact');
    expect(r3.converged).toBe(true);
    expect(r3.iterations).toBe(1);
    expect(r3.x[0]!).toBeCloseTo(1, 10);
    expect(r3.x[1]!).toBeCloseTo(2, 10);
  });

  it('rejects shape mismatches, non-finite rhs and unknown options', () => {
    const A = csrFromDense([
      [2, 0],
      [0, 3],
    ]);
    expectNumericsError(() => solve(A, [1, 2, 3]), 'numerics/shape-mismatch');
    expectNumericsError(() => solve(A, [Number.NaN, 1]), 'numerics/non-finite');
    expectNumericsError(() => solve(A, [1, 1], { method: 'bogus' as never }), 'numerics/invalid-input');
  });
});
