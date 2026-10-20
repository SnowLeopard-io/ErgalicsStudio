// Numerics root finding — Brent and damped Newton tests.
import { describe, it, expect } from 'vitest';
import { NumericsError } from '../../src/core/numerics/errors';
import { brent, findBracket, newtonSolve, newtonScalar, defaultJacobian } from '../../src/core/numerics/root';

describe('brent (Brent-Dekker zeroin)', () => {
  it('finds the Dottie number of cos(x) = x', () => {
    const r = brent((x) => Math.cos(x) - x, 0, 1);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x - 0.7390851332151607)).toBeLessThan(1e-10);
    expect(Math.abs(r.fx)).toBeLessThan(1e-10);
  });

  it('solves the classic Wallis polynomial x^3 - 2x - 5 on [1, 3]', () => {
    const r = brent((x) => x * x * x - 2 * x - 5, 1, 3);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x - 2.0945514815423265)).toBeLessThan(1e-9);
  });

  it('returns an endpoint root without iterating', () => {
    const r = brent((x) => x, 0, 5);
    expect(r.converged).toBe(true);
    expect(r.x).toBe(0);
    expect(r.iterations).toBe(1);
  });

  it('throws a structured no-bracket error when signs agree', () => {
    try {
      brent((x) => x * x + 1, -1, 1);
      expect.unreachable('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NumericsError);
      expect((err as NumericsError).code).toBe('numerics/no-bracket');
    }
  });

  it('reports exhaustion of maxIter through converged = false', () => {
    const r = brent((x) => x, -1e8, 1e8, { maxIter: 2 });
    expect(r.converged).toBe(false);
    expect(r.iterations).toBe(2);
  });

  it('rejects non-finite endpoints', () => {
    expect(() => brent((x) => x, Number.NaN, 1)).toThrowError(NumericsError);
  });

  it('works with a bracket found by findBracket', () => {
    const br = findBracket(Math.sin, 3, 0.1);
    expect(br.lo).toBeLessThan(Math.PI);
    expect(br.hi).toBeGreaterThan(Math.PI);
    const r = brent(Math.sin, br.lo, br.hi);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x - Math.PI)).toBeLessThan(1e-10);
  });
});

describe('damped Newton for systems', () => {
  it('converges with an analytic Jacobian', () => {
    const F = (x: number[]): number[] => [x[0]! * x[0]! - 2, x[1]! - 3];
    const jac = (x: number[]): number[][] => [
      [2 * x[0]!, 0],
      [0, 1],
    ];
    const r = newtonSolve(F, [1, 0], { jac });
    expect(r.converged).toBe(true);
    expect(r.jacobian).toBe('analytic');
    expect(Math.abs(r.x[0]! - Math.SQRT2)).toBeLessThan(1e-10);
    expect(Math.abs(r.x[1]! - 3)).toBeLessThan(1e-10);
  });

  it('converges with the finite-difference Jacobian', () => {
    const F = (x: number[]): number[] => [x[0]! * x[0]! - 2, x[1]! - 3];
    const r = newtonSolve(F, [1, 0]);
    expect(r.converged).toBe(true);
    expect(r.jacobian).toBe('finite-difference');
    expect(Math.abs(r.x[0]! - Math.SQRT2)).toBeLessThan(1e-6);
    expect(Math.abs(r.x[1]! - 3)).toBeLessThan(1e-8);
  });

  it('solves a nonlinear 2x2 system (polar -> cartesian intersection)', () => {
    // Intersection of the circle r = 1 with the line y = x/2 in the first quadrant.
    const F = (x: number[]): number[] => [x[0]! * x[0]! + x[1]! * x[1]! - 1, x[1]! - 0.5 * x[0]!];
    const r = newtonSolve(F, [0.8, 0.2]);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x[0]! - 2 / Math.sqrt(5))).toBeLessThan(1e-9);
    expect(Math.abs(r.x[1]! - 1 / Math.sqrt(5))).toBeLessThan(1e-9);
  });

  it('scalar convenience wrapper matches the multivariate kernel', () => {
    const r = newtonScalar((x) => Math.cos(x) - x, 1);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.x[0]! - 0.7390851332151607)).toBeLessThan(1e-8);
  });

  it('reports budget exhaustion through converged = false (maxIter = 1)', () => {
    const r = newtonSolve((x) => [x[0]! * x[0]! - 2], [5], { maxIter: 1 });
    expect(r.converged).toBe(false);
    expect(r.iterations).toBe(1);
  });

  it('converges quickly from inside the basin of attraction', () => {
    const fast = newtonSolve((x) => [Math.tanh(x[0]!)], [0.1]);
    expect(fast.converged).toBe(true);
    expect(Math.abs(fast.x[0]!)).toBeLessThan(1e-8);
  });

  it('finite-difference helper approximates the derivative', () => {
    const J = defaultJacobian((x) => [x[0]! * x[0]! * x[0]!])([2]);
    expect(Math.abs(J[0]![0]! - 12)).toBeLessThan(1e-4);
  });
});
