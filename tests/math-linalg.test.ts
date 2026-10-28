// math-linalg kernel tests — determinants, eigenpairs, QR, SVD, projection, benchmarks
import { describe, it, expect } from 'vitest';
import {
  determinant,
  determinant2x2,
  eigenvalues2x2,
  eigenvaluesQR,
  eigenvector2x2,
  frobeniusNorm,
  identity,
  matmul,
  projectOntoSpan,
  qrDecomposition,
  runLinalgBenchmarks,
  SAMPLE_MATRICES,
  selectSample,
  svdJacobi,
  transpose,
  type ComplexNum,
  type Matrix,
} from '../src/plugins/builtin/math/linalg/kernel';

function orthoDefect(m: Matrix): number {
  const g = matmul(transpose(m), m);
  let s = 0;
  for (let i = 0; i < g.length; i += 1) {
    for (let j = 0; j < g.length; j += 1) {
      const d = g[i]![j]! - (i === j ? 1 : 0);
      s += d * d;
    }
  }
  return Math.sqrt(s);
}

function dist(a: Matrix, b: Matrix): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < a.length; j += 1) {
      const d = a[i]![j]! - b[i]![j]!;
      s += d * d;
    }
  }
  return Math.sqrt(s);
}

function sortEigen(l: ComplexNum[]): ComplexNum[] {
  return l.slice().sort((p, q) => p.re - q.re || p.im - q.im);
}

function closeSet(got: ComplexNum[], ref: Array<[number, number]>, tol: number): void {
  const sortedGot = sortEigen(got);
  const sortedRef = sortEigen(ref.map(([re, im]) => ({ re, im })));
  expect(sortedGot.length).toBe(sortedRef.length);
  sortedGot.forEach((g, i) => {
    const r = sortedRef[i]!;
    expect(Math.hypot(g.re - r.re, g.im - r.im), `λ = (${g.re}, ${g.im}) vs (${r.re}, ${r.im})`).toBeLessThan(tol);
  });
}

describe('determinants', () => {
  it('matches the closed form in 2×2', () => {
    expect(determinant2x2(1, 3, 2, -1)).toBe(-7);
    expect(determinant([[1, 3], [2, -1]])).toBeCloseTo(-7, 12);
    expect(determinant([[2, 0], [0, 0.5]])).toBeCloseTo(1, 12);
    expect(determinant([[1, 0.8], [0, 1]])).toBeCloseTo(1, 12);
  });

  it('returns exactly 0 for singular matrices', () => {
    expect(determinant([[1, 1], [1, 1]])).toBe(0);
    expect(determinant([[2, 4], [3, 6]])).toBe(0);
  });

  it('matches explicit 3×3 values and multiplicative behaviour', () => {
    expect(determinant([[1, 2, 3], [4, 5, 6], [7, 8, 10]])).toBeCloseTo(-3, 10);
    expect(determinant([[0, 0, 8], [1, 0, -14], [0, 1, 7]])).toBeCloseTo(8, 10);
    const a = [[1, 2], [3, 4]] as Matrix;
    const b = [[0, 1], [1, 0]] as Matrix;
    expect(determinant(matmul(a, b))).toBeCloseTo(determinant(a) * determinant(b), 10);
  });
});

describe('closed-form 2×2 eigenpairs', () => {
  it('saddle [[1,3],[2,−1]] → ±√7', () => {
    const [l1, l2] = eigenvalues2x2(1, 3, 2, -1);
    expect(l1.re).toBeCloseTo(Math.sqrt(7), 12);
    expect(l2.re).toBeCloseTo(-Math.sqrt(7), 12);
    expect(l1.im).toBe(0);
  });

  it('rotation by 30° → e^{±iπ/6}', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const [l1, l2] = eigenvalues2x2(c, -s, s, c);
    expect(l1.re).toBeCloseTo(c, 12);
    expect(l1.im).toBeCloseTo(s, 12);
    expect(l2.im).toBeCloseTo(-s, 12);
  });

  it('eigenvectors are unit vectors satisfying (A − λI)v = 0', () => {
    const v = eigenvector2x2(2, 1, 1, 2, { re: 3, im: 0 });
    expect(Math.hypot(v[0].re, v[0].im)).toBeCloseTo(1 / Math.SQRT2, 12);
    expect(v[1].re).toBeCloseTo(1 / Math.SQRT2, 12);
    // row 1: (2 − 3)·v0 + 1·v1 ≈ 0
    const r1 = (2 - 3) * v[0].re + v[1].re;
    expect(Math.abs(r1)).toBeLessThan(1e-12);
  });

  it('handles diagonal and defective matrices', () => {
    const v = eigenvector2x2(5, 0, 0, 7, { re: 5, im: 0 });
    expect(v[0].re).toBeCloseTo(1, 12);
    expect(v[1].re).toBeCloseTo(0, 12);
    const vd = eigenvector2x2(1, 1, 0, 1, { re: 1, im: 0 });
    expect(Math.hypot(vd[0].re, vd[1].re)).toBeCloseTo(1, 12); // (1, 0)
  });
});

describe('Householder QR', () => {
  const A: Matrix = [[1, 2, 3], [4, 5, 6], [7, 8, 10]];

  it('produces an orthonormal Q and triangular R', () => {
    const { Q, R } = qrDecomposition(A);
    expect(orthoDefect(Q)).toBeLessThan(1e-12);
    for (let i = 0; i < R.length; i += 1) {
      for (let j = 0; j < i; j += 1) expect(Math.abs(R[i]![j]!)).toBeLessThan(1e-12);
    }
  });

  it('reconstructs A = QR', () => {
    const { Q, R } = qrDecomposition(A);
    expect(dist(matmul(Q, R), A) / frobeniusNorm(A)).toBeLessThan(1e-12);
  });

  it('leaves an already triangular matrix unchanged up to rounding', () => {
    const T: Matrix = [[2, 1, 0], [0, 3, 1], [0, 0, 4]];
    const { Q, R } = qrDecomposition(T);
    expect(dist(matmul(Q, R), T)).toBeLessThan(1e-12);
  });
});

describe('QR-iteration eigenvalues', () => {
  it('recovers the spectrum of a symmetric tridiagonal matrix', () => {
    const s2 = Math.sqrt(2);
    closeSet(
      eigenvaluesQR([[2, 1, 0], [1, 2, 1], [0, 1, 2]]),
      [[2 - s2, 0], [2, 0], [2 + s2, 0]],
      1e-7,
    );
  });

  it('recovers the spectrum of a companion matrix {1, 2, 4}', () => {
    closeSet(
      eigenvaluesQR([[0, 0, 8], [1, 0, -14], [0, 1, 7]]),
      [[1, 0], [2, 0], [4, 0]],
      1e-7,
    );
  });

  it('handles a complex pair from a quarter-turn', () => {
    closeSet(eigenvaluesQR([[0, -1], [1, 0]]), [[0, 1], [0, -1]], 1e-9);
  });

  it('agrees with the closed form on 2×2 samples', () => {
    for (const s of SAMPLE_MATRICES) {
      const m = s.matrix;
      const [c1, c2] = eigenvalues2x2(m[0]![0]!, m[0]![1]!, m[1]![0]!, m[1]![1]!);
      const qr = sortEigen(eigenvaluesQR(m));
      const ref = sortEigen([c1, c2]);
      qr.forEach((g, i) => {
        const r = ref[i]!;
        expect(Math.hypot(g.re - r.re, g.im - r.im), s.id).toBeLessThan(1e-9);
      });
    }
  });
});

describe('one-sided Jacobi SVD', () => {
  it('reproduces the known singular values of [[3,0],[4,5]]', () => {
    const { sigma } = svdJacobi([[3, 0], [4, 5]]);
    expect(sigma[0]).toBeCloseTo(Math.sqrt(45), 10); // 3√5
    expect(sigma[1]).toBeCloseTo(Math.sqrt(5), 10);
  });

  it('returns descending singular values with orthonormal factors', () => {
    const { U, sigma, V } = svdJacobi([[1, 2, 3], [4, 5, 6], [7, 8, 10]]);
    expect(sigma[0]).toBeGreaterThanOrEqual(sigma[1]!);
    expect(sigma[1]).toBeGreaterThanOrEqual(sigma[2]!);
    expect(orthoDefect(U)).toBeLessThan(1e-12);
    expect(orthoDefect(V)).toBeLessThan(1e-12);
  });

  it('reconstructs A = UΣVᵀ for every sample matrix', () => {
    for (const s of SAMPLE_MATRICES) {
      const { U, sigma, V } = svdJacobi(s.matrix);
      const scaled = U.map((row) => row.map((x, j) => x * sigma[j]!));
      const back = matmul(scaled, transpose(V));
      expect(dist(back, s.matrix) / frobeniusNorm(s.matrix), s.id).toBeLessThan(1e-12);
      // |det| equals the product of singular values for nonsingular samples.
      const detAbs = Math.abs(determinant(s.matrix));
      if (detAbs > 1e-9) {
        expect(sigma[0]! * sigma[1]! / detAbs, s.id).toBeCloseTo(1, 10);
      }
    }
  });
});

describe('projection onto a span', () => {
  it('projects onto a line', () => {
    const { projection, residual, dimension } = projectOntoSpan([3, 4], [[1, 1]]);
    expect(dimension).toBe(1);
    expect(projection[0]).toBeCloseTo(3.5, 12);
    expect(projection[1]).toBeCloseTo(3.5, 12);
    // residual ⟂ basis
    expect(residual[0]! * 1 + residual[1]! * 1).toBeCloseTo(0, 12);
  });

  it('projects onto the xy-plane in 3D', () => {
    const { projection, residual, dimension } = projectOntoSpan([3, 4, 5], [[1, 0, 0], [0, 1, 0]]);
    expect(dimension).toBe(2);
    expect(projection[0]).toBeCloseTo(3, 12);
    expect(projection[1]).toBeCloseTo(4, 12);
    expect(projection[2]).toBeCloseTo(0, 12);
    expect(residual[0]).toBeCloseTo(0, 12);
    expect(residual[2]).toBeCloseTo(5, 12);
  });

  it('projects onto an oblique plane {x + y + z = 0}', () => {
    const { projection, dimension } = projectOntoSpan([1, 2, 3], [[1, -1, 0], [1, 1, -2]]);
    expect(dimension).toBe(2);
    expect(projection[0]).toBeCloseTo(-1, 12);
    expect(projection[1]).toBeCloseTo(0, 12);
    expect(projection[2]).toBeCloseTo(1, 12);
  });

  it('drops dependent basis directions', () => {
    const { projection, dimension } = projectOntoSpan([3, 4], [[1, 0], [2, 0]]);
    expect(dimension).toBe(1);
    expect(projection[0]).toBeCloseTo(3, 12);
    expect(projection[1]).toBeCloseTo(0, 12);
  });
});

describe('sample matrix dataset', () => {
  it('exposes well-formed unique 2×2 samples', () => {
    expect(SAMPLE_MATRICES.length).toBeGreaterThanOrEqual(4);
    const ids = new Set(SAMPLE_MATRICES.map((s) => s.id));
    expect(ids.size).toBe(SAMPLE_MATRICES.length);
    for (const s of SAMPLE_MATRICES) {
      expect(s.matrix.length, s.id).toBe(2);
      for (const row of s.matrix) {
        expect(row.length, s.id).toBe(2);
        for (const v of row) expect(Number.isFinite(v), s.id).toBe(true);
      }
      expect(s.labelZh.length, s.id).toBeGreaterThan(0);
      expect(s.labelEn.length, s.id).toBeGreaterThan(0);
    }
  });

  it('selects samples by id and rejects unknown ids', () => {
    const rot = selectSample('rotate-30');
    expect(rot).not.toBeNull();
    expect(determinant(rot!.matrix)).toBeCloseTo(1, 12);
    expect(selectSample('does-not-exist')).toBeNull();
  });
});

describe('embedded validation benchmarks', () => {
  it('passes every benchmark within the spec tolerances', () => {
    const bench = runLinalgBenchmarks();
    expect(bench.map((b) => b.id)).toEqual([
      'eigen-2x2-closed-form',
      'eigen-qr-iteration',
      'eigen-residual',
      'svd-reconstruction',
      'svd-orthogonality',
      'det-closed-form',
      'qr-reconstruction',
      'projection-analytic',
    ]);
    for (const b of bench) {
      expect(b.passed, `${b.id}: ${b.detailEn} (relErr=${b.relErr})`).toBe(true);
      expect(Number.isFinite(b.relErr), b.id).toBe(true);
      expect(b.labelZh.length, b.id).toBeGreaterThan(0);
      expect(b.labelEn.length, b.id).toBeGreaterThan(0);
      expect(b.detailZh.length, b.id).toBeGreaterThan(0);
      expect(b.detailEn.length, b.id).toBeGreaterThan(0);
    }
    const byId = new Map(bench.map((b) => [b.id, b]));
    expect(byId.get('eigen-2x2-closed-form')!.relErr).toBeLessThan(1e-9);
    expect(byId.get('eigen-qr-iteration')!.relErr).toBeLessThan(1e-8);
    expect(byId.get('eigen-residual')!.relErr).toBeLessThan(1e-12);
    expect(byId.get('svd-reconstruction')!.relErr).toBeLessThan(1e-12);
    expect(byId.get('svd-orthogonality')!.relErr).toBeLessThan(1e-12);
    expect(byId.get('det-closed-form')!.relErr).toBeLessThan(1e-12);
    expect(byId.get('qr-reconstruction')!.relErr).toBeLessThan(1e-12);
    expect(byId.get('projection-analytic')!.relErr).toBeLessThan(1e-12);
  });

  it('stays deterministic across runs', () => {
    const a = runLinalgBenchmarks().map((b) => b.relErr);
    const b2 = runLinalgBenchmarks().map((x) => x.relErr);
    expect(b2).toEqual(a);
  });
});

describe('matrix helpers', () => {
  it('identity and transpose behave', () => {
    expect(identity(3)).toEqual([[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(transpose([[1, 2, 3], [4, 5, 6]])).toEqual([[1, 4], [2, 5], [3, 6]]);
    const a = [[1, 2], [3, 4]] as Matrix;
    expect(matmul(a, identity(2))).toEqual(a);
  });
});
