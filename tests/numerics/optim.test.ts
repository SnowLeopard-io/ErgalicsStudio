// Numerics optimisation — reference problems and robustness tests.
import { describe, it, expect } from 'vitest';
import { NumericsError } from '../../src/core/numerics/errors';
import { minimizeLBFGSB, minimizeNM, minimizeSLSQP, nnls } from '../../src/core/numerics/optim';

const rosenbrock = (x: number[]): number => {
  const a = 1 - x[0]!;
  const b = x[1]! - x[0]! * x[0]!;
  return a * a + 100 * b * b;
};

const rosenbrockGrad = (x: number[]): number[] => [
  -2 * (1 - x[0]!) - 400 * x[0]! * (x[1]! - x[0]! * x[0]!),
  200 * (x[1]! - x[0]! * x[0]!),
];

describe('L-BFGS-B', () => {
  it('minimises the Rosenbrock function towards (1, 1)', () => {
    const r = minimizeLBFGSB(rosenbrock, rosenbrockGrad, [-1.2, 1], { pgtol: 1e-6, maxIter: 2000 });
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x[0]! - 1)).toBeLessThan(1e-2);
    expect(Math.abs(r.x[1]! - 1)).toBeLessThan(1e-2);
    expect(r.f).toBeLessThan(1e-6);
  });

  it('pins the solution to an active upper bound', () => {
    const f = (x: number[]): number => (x[0]! - 1) ** 2 + (x[1]! - 2) ** 2;
    const grad = (x: number[]): number[] => [2 * (x[0]! - 1), 2 * (x[1]! - 2)];
    const r = minimizeLBFGSB(f, grad, [0, 0], { u: [0.5, Infinity], pgtol: 1e-8 });
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x[0]! - 0.5)).toBeLessThan(1e-6);
    expect(Math.abs(r.x[1]! - 2)).toBeLessThan(1e-5);
    expect(r.projGradNorm).toBeLessThan(1e-6);
  });

  it('solves an unconstrained quadratic to machine level', () => {
    const r = minimizeLBFGSB(
      (x) => 0.5 * (x[0]! * x[0]! + x[1]! * x[1]!),
      (x) => [x[0]!, x[1]!],
      [3, -4],
      { pgtol: 1e-9 },
    );
    expect(Math.abs(r.x[0]!)).toBeLessThan(1e-8);
    expect(Math.abs(r.x[1]!)).toBeLessThan(1e-8);
    expect(r.f).toBeLessThan(1e-14);
  });

  it('throws a structured error on non-finite gradients', () => {
    expect(() => minimizeLBFGSB(() => 1, () => [Number.NaN], [0])).toThrowError(NumericsError);
  });
});

describe('Nelder-Mead', () => {
  it('minimises the Rosenbrock function', () => {
    const r = minimizeNM(rosenbrock, [-1.2, 1], { maxIter: 2000 });
    expect(r.converged).toBe(true);
    expect(r.f).toBeLessThan(1e-6);
    expect(Math.abs(r.x[0]! - 1)).toBeLessThan(1e-2);
    expect(Math.abs(r.x[1]! - 1)).toBeLessThan(1e-2);
  });

  it('solves a 3-D quadratic with a custom initial simplex', () => {
    const f = (x: number[]): number => (x[0]! - 1) ** 2 + (x[1]! - 2) ** 2 + (x[2]! - 3) ** 2;
    const r = minimizeNM(f, [0, 0, 0], { initialStep: 1 });
    expect(r.converged).toBe(true);
    for (let i = 0; i < 3; i++) expect(Math.abs(r.x[i]! - (i + 1))).toBeLessThan(1e-4);
  });

  it('treats non-finite objectives as the worst vertex instead of crashing', () => {
    // Domain x < 0.5 is non-finite; the initial simplex therefore contains a
    // +Infinity vertex that must be discarded, and the minimiser still finds
    // the interior minimum at x = 2.
    const f = (x: number[]): number => (x[0]! < 0.5 ? Number.NaN : (x[0]! - 2) ** 2);
    const r = minimizeNM(f, [0.4], { initialStep: 0.5 });
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x[0]! - 2)).toBeLessThan(1e-3);
  });

  it('reports budget exhaustion through converged = false', () => {
    const r = minimizeNM(rosenbrock, [-1.2, 1], { maxIter: 3 });
    expect(r.converged).toBe(false);
  });
});

describe('SLSQP', () => {
  it('solves an equality-constrained problem exactly', () => {
    const r = minimizeSLSQP(
      (x) => 0.5 * (x[0]! * x[0]! + x[1]! * x[1]!),
      [0.4, 0.4],
      {
        grad: (x) => [x[0]!, x[1]!],
        constraints: { eq: (x) => x[0]! + x[1]! - 1 },
      },
    );
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x[0]! - 0.5)).toBeLessThan(1e-6);
    expect(Math.abs(r.x[1]! - 0.5)).toBeLessThan(1e-6);
    expect(r.constraintViolation).toBeLessThan(1e-8);
  });

  it('handles an active inequality constraint', () => {
    const r = minimizeSLSQP(
      (x) => (x[0]! - 2) ** 2 + (x[1]! - 2) ** 2,
      [0, 0],
      {
        grad: (x) => [2 * (x[0]! - 2), 2 * (x[1]! - 2)],
        constraints: { ineq: (x) => 2 - x[0]! - x[1]! },
      },
    );
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x[0]! - 1)).toBeLessThan(1e-5);
    expect(Math.abs(r.x[1]! - 1)).toBeLessThan(1e-5);
    expect(r.constraintViolation).toBeLessThan(1e-7);
  });

  it('expands vector-valued inequality constraints', () => {
    const r = minimizeSLSQP(
      (x) => x[0]! * x[0]! + x[1]! * x[1]!,
      [1, 1],
      {
        grad: (x) => [x[0]!, x[1]!],
        constraints: { ineq: (x) => [x[0]! - 0.2, x[1]! - 0.3] },
      },
    );
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x[0]! - 0.2)).toBeLessThan(1e-5);
    expect(Math.abs(r.x[1]! - 0.3)).toBeLessThan(1e-5);
    expect(r.constraintViolation).toBeLessThan(1e-7);
  });

  it('reports budget exhaustion through converged = false', () => {
    const r = minimizeSLSQP(rosenbrock, [-1.2, 1], {
      grad: rosenbrockGrad,
      constraints: { eq: (x) => x[0]! + x[1]! },
      maxIter: 2,
    });
    expect(r.converged).toBe(false);
  });
});

describe('NNLS (Lawson-Hanson)', () => {
  it('clips a negative unconstrained coefficient to zero', () => {
    const A = [
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    const r = nnls(A, [-5, 4, -1]);
    expect(r.converged).toBe(true);
    expect(r.x[0]!).toBeCloseTo(0, 9);
    expect(r.x[1]!).toBeCloseTo(1.5, 9);
    expect(Math.abs(r.residualNorm - Math.sqrt(37.5))).toBeLessThan(1e-9);
  });

  it('returns the exact solution when it is already non-negative', () => {
    const A = [
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    const r = nnls(A, [3, 4, 7]);
    expect(r.converged).toBe(true);
    expect(r.x[0]!).toBeCloseTo(3, 9);
    expect(r.x[1]!).toBeCloseTo(4, 9);
    expect(r.residualNorm).toBeLessThan(1e-9);
  });

  it('throws on shape mismatch', () => {
    expect(() =>
      nnls(
        [
          [1, 0],
          [0, 1],
        ],
        [1, 2, 3],
      ),
    ).toThrowError(NumericsError);
  });
});
