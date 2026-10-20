// Tests for src/core/numerics/interp: cubic splines and RBF interpolation.
import { describe, expect, it } from 'vitest';
import { NumericsError } from '../../src/core/numerics/errors';
import { createSpline } from '../../src/core/numerics/interp/spline';
import { createRBF } from '../../src/core/numerics/interp/rbf';

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

describe('spline (natural boundary)', () => {
  it('interpolates the knots exactly and has zero end curvature', () => {
    const s = createSpline([0, 1, 2, 3], [0, 1, 4, 9]);
    expect(s.n).toBe(4);
    expect(s.eval(0)).toBeCloseTo(0, 12);
    expect(s.eval(1)).toBeCloseTo(1, 12);
    expect(s.eval(2)).toBeCloseTo(4, 12);
    expect(s.eval(3)).toBeCloseTo(9, 12);
    expect(s.secondDerivative(0)).toBeCloseTo(0, 10);
    expect(s.secondDerivative(3)).toBeCloseTo(0, 10);
  });

  it('matches the analytic natural spline of y = x^2 between knots', () => {
    // Unit spacing gives M1 = M2 = 12/5; on [0,1] the spline is 0.6 t + 0.4 t^3.
    const s = createSpline([0, 1, 2, 3], [0, 1, 4, 9]);
    expect(s.eval(0.5)).toBeCloseTo(0.35, 10);
    expect(s.secondDerivative(0.5)).toBeCloseTo(1.2, 10);
  });

  it('degenerates to a straight line with two knots', () => {
    const s = createSpline([0, 1], [2, 4]);
    expect(s.eval(0.25)).toBeCloseTo(2.5, 12);
    expect(s.eval(-1)).toBeCloseTo(0, 12); // end-piece cubic extrapolation
    expect(s.derivative(0.7)).toBeCloseTo(2, 12);
  });
});

describe('spline (clamped boundary)', () => {
  it('reproduces a cubic exactly when the end slopes match', () => {
    // y = x^3 with S'(0) = 0, S'(2) = 12: the clamped spline is exact.
    const s = createSpline([0, 1, 2], [0, 1, 8], { boundary: 'clamped', derivs: [0, 12] });
    expect(s.eval(0.5)).toBeCloseTo(0.125, 10);
    expect(s.eval(1.3)).toBeCloseTo(2.197, 10);
    expect(s.derivative(1.3)).toBeCloseTo(5.07, 8);
    expect(s.secondDerivative(0.7)).toBeCloseTo(4.2, 8);
  });
});

describe('spline input validation', () => {
  it('rejects bad knots, mismatched data and incomplete clamped options', () => {
    expectNumericsError(() => createSpline([0, 1, 1], [1, 2, 3]), 'numerics/invalid-input');
    expectNumericsError(() => createSpline([0, 1], [1]), 'numerics/invalid-input');
    expectNumericsError(() => createSpline([0, 1], [1, 2], { boundary: 'clamped' }), 'numerics/invalid-input');
    expectNumericsError(() => createSpline([0, 1], [1, Number.NaN]), 'numerics/non-finite');
  });
});

describe('rbf (gaussian)', () => {
  it('interpolates 1-D nodes exactly', () => {
    const f = createRBF([0, 1, 2], [1, 3, 2]);
    expect(f.kernel).toBe('gaussian');
    expect(f.dim).toBe(1);
    expect(f.n).toBe(3);
    expect(f.eval(0)).toBeCloseTo(1, 8);
    expect(f.eval(1)).toBeCloseTo(3, 8);
    expect(f.eval(2)).toBeCloseTo(2, 8);
  });

  it('honours an explicit shape parameter', () => {
    const f = createRBF([0, 1, 2], [1, 3, 2], { epsilon: 2 });
    expect(f.epsilon).toBe(2);
    expect(f.eval(1)).toBeCloseTo(3, 8);
  });
});

describe('rbf (multiquadric)', () => {
  it('interpolates nodes exactly', () => {
    const f = createRBF([0, 1, 2], [1, 3, 2], { kernel: 'multiquadric' });
    expect(f.kernel).toBe('multiquadric');
    expect(f.eval(0)).toBeCloseTo(1, 8);
    expect(f.eval(1)).toBeCloseTo(3, 8);
    expect(f.eval(2)).toBeCloseTo(2, 8);
  });
});

describe('rbf (thin plate)', () => {
  it('reproduces degree-1 polynomials exactly via the poly augmentation', () => {
    const f = createRBF([0, 1, 2, 3], [2, 2.5, 3, 3.5], { kernel: 'thinplate' });
    expect(f.kernel).toBe('thinplate');
    expect(f.eval(1.7)).toBeCloseTo(2.85, 8);
    expect(f.eval(0)).toBeCloseTo(2, 8);
    expect(f.eval(3)).toBeCloseTo(3.5, 8);
  });
});

describe('rbf (2-D)', () => {
  it('interpolates scattered nodes exactly', () => {
    const f = createRBF(
      [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ],
      [1, 2, 3, 4],
    );
    expect(f.dim).toBe(2);
    expect(f.eval([0, 0])).toBeCloseTo(1, 8);
    expect(f.eval([1, 0])).toBeCloseTo(2, 8);
    expect(f.eval([0, 1])).toBeCloseTo(3, 8);
    expect(f.eval([1, 1])).toBeCloseTo(4, 8);
    expect(Number.isFinite(f.eval([0.5, 0.5]))).toBe(true);
  });
});

describe('rbf smoothing and validation', () => {
  it('smooth > 0 no longer interpolates but stays finite', () => {
    const f = createRBF([0, 1, 2], [1, 3, 2], { smooth: 0.5 });
    expect(Number.isFinite(f.eval(0))).toBe(true);
    expect(Math.abs(f.eval(0) - 1)).toBeGreaterThan(1e-6);
  });

  it('throws structured errors on duplicate nodes and bad input', () => {
    expectNumericsError(() => createRBF([0, 1, 1], [1, 2, 3]), 'numerics/singular');
    expectNumericsError(() => createRBF([0, 1], [1]), 'numerics/invalid-input');
    expectNumericsError(() => createRBF([0, 1], [1, Number.NaN]), 'numerics/non-finite');
    expectNumericsError(() => createRBF([0, 1], [1, 2], { kernel: 'bogus' as never }), 'numerics/invalid-input');
    const f = createRBF([0, 1], [1, 2]);
    expectNumericsError(() => f.eval([0.5, 0.5]), 'numerics/invalid-input');
  });
});
