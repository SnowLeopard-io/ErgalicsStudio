// Numerics ODE solvers — reference-solution, order and robustness tests.
import { describe, it, expect } from 'vitest';
import { NumericsError } from '../../src/core/numerics/errors';
import { solveODE, solveBDF, solveRadau } from '../../src/core/numerics/ode';

interface Span {
  t: number[];
  y: number[][];
  status: string;
  stats: { steps: number; rejected: number; jacEvals: number };
}

const end = (r: Span): { t: number; y: number[] } => ({
  t: r.t[r.t.length - 1]!,
  y: r.y[r.y.length - 1]!,
});

const expectFiniteSolution = (r: Span): void => {
  for (const row of r.y) for (const v of row) expect(Number.isFinite(v)).toBe(true);
};

describe('RK45 (Dormand-Prince 5(4))', () => {
  it('integrates y\' = -y to exp(-t) within tolerance', () => {
    const r = solveODE((_t, y) => [-y[0]!], 0, [1], 1, { rtol: 1e-8, atol: 1e-12 });
    expect(r.status).toBe('ok');
    expectFiniteSolution(r);
    const e = end(r);
    expect(e.t).toBe(1);
    expect(Math.abs(e.y[0]! - Math.exp(-1))).toBeLessThan(1e-6);
    expect(r.stats.steps).toBeGreaterThan(0);
    expect(r.stats.rejected).toBeLessThan(r.stats.steps);
  });

  it('exhibits 5th-order convergence on a fixed mesh (error ratio ~ 2^5)', () => {
    const errs = [0.2, 0.1, 0.05].map((h) => {
      const r = solveODE((_t, y) => [y[0]!], 0, [1], 1, { rtol: 1e-6, atol: 1e-10, h0: h, maxStep: h });
      return Math.abs(end(r).y[0]! - Math.E);
    });
    const ratio1 = errs[0]! / errs[1]!;
    const ratio2 = errs[1]! / errs[2]!;
    expect(ratio1).toBeGreaterThan(20);
    expect(ratio1).toBeLessThan(60);
    expect(ratio2).toBeGreaterThan(20);
    expect(ratio2).toBeLessThan(60);
  });

  it('locates a non-terminal event (sin t = 1/2 at pi/6) with a direction filter', () => {
    const r = solveODE((t) => [Math.cos(t)], 0, [0], 1, {
      rtol: 1e-10,
      atol: 1e-12,
      events: [{ g: (_t, y) => y[0]! - 0.5, direction: 1 }],
    });
    expect(r.status).toBe('ok');
    expect(r.events.length).toBe(1);
    expect(Math.abs(r.events[0]!.t - Math.PI / 6)).toBeLessThan(1e-5);
    expect(Math.abs(r.events[0]!.y[0]! - 0.5)).toBeLessThan(1e-4);
    expect(end(r).t).toBe(1);
  });

  it('stops at a terminal event (y = 2 reached at t = ln 2)', () => {
    const r = solveODE((_t, y) => [y[0]!], 0, [1], 1, {
      events: [{ g: (_t, y) => y[0]! - 2, terminal: true }],
    });
    expect(r.status).toBe('ok');
    expect(r.events.length).toBe(1);
    expect(Math.abs(end(r).t - Math.LN2)).toBeLessThan(1e-5);
    expect(Math.abs(end(r).y[0]! - 2)).toBeLessThan(1e-3);
  });

  it('reports both decreasing and increasing crossings when unfiltered', () => {
    const r = solveODE((t) => [Math.cos(t)], 0, [0], 2 * Math.PI, {
      rtol: 1e-9,
      atol: 1e-12,
      events: [{ g: (_t, y) => y[0]! - 0.5 }],
    });
    // sin t = 1/2 at pi/6 (up) and 5pi/6 (down) inside [0, 2pi].
    expect(r.events.length).toBe(2);
    expect(Math.abs(r.events[1]!.t - (5 * Math.PI) / 6)).toBeLessThan(1e-4);
  });

  it('provides a dense-output evaluator matching the solution between steps', () => {
    const r = solveODE((_t, y) => [-y[0]!], 0, [1], 1, { rtol: 1e-8, atol: 1e-12, denseOutput: true });
    expect(r.dense).toBeDefined();
    const d = r.dense!;
    expect(Math.abs(d(0.5)[0]! - Math.exp(-0.5))).toBeLessThan(1e-5);
    expect(Math.abs(d(0.123)[0]! - Math.exp(-0.123))).toBeLessThan(1e-5);
    // Exact reproduction at the output knots.
    for (let k = 0; k < r.t.length; k += 3) {
      expect(d(r.t[k]!)[0]!).toBeCloseTo(r.y[k]![0]!, 12);
    }
  });

  it('reports maxSteps exhaustion as a status, not an error', () => {
    const r = solveODE((_t, y) => [y[0]!], 0, [1], 1, { maxSteps: 2 });
    expect(r.status).toBe('maxSteps');
    expect(r.t.length).toBe(3);
    expect(end(r).t).toBeLessThan(1);
  });

  it('rejects non-finite initial data with a structured error', () => {
    try {
      solveODE((_t) => [1], 0, [Number.NaN], 1);
      expect.unreachable('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NumericsError);
      expect((err as NumericsError).code).toBe('numerics/non-finite');
    }
  });

  it('rejects a singular right-hand side with a structured error', () => {
    expect(() => solveODE((_t, y) => [1 / y[0]!], 0, [0], 1)).toThrowError(NumericsError);
  });
});

describe('BDF (variable order 1-5)', () => {
  it('integrates the smooth y\' = -y accurately', () => {
    const r = solveBDF((_t, y) => [-y[0]!], 0, [1], 1, { rtol: 1e-6, atol: 1e-9 });
    expect(r.status).toBe('ok');
    expectFiniteSolution(r);
    expect(Math.abs(end(r).y[0]! - Math.exp(-1))).toBeLessThan(1e-4);
  });

  it('beats explicit RK45 on a stiff two-rate system', () => {
    const f = (_t: number, y: number[]): number[] => [-1000 * y[0]!, -y[1]!];
    const bdf = solveBDF(f, 0, [1, 1], 1, { rtol: 1e-6, atol: 1e-9 });
    const rk = solveODE(f, 0, [1, 1], 1, { rtol: 1e-6, atol: 1e-9 });
    expect(bdf.status).toBe('ok');
    expect(rk.status).toBe('ok');
    const e = end(bdf);
    expect(Math.abs(e.y[0]!)).toBeLessThan(1e-6); // e^-1000 underflows to 0
    expect(Math.abs(e.y[1]! - Math.exp(-1))).toBeLessThan(1e-5);
    // The explicit method is stability-limited (|lambda*h| <=~ 3.3), the
    // implicit one is accuracy-limited: an order-of-magnitude fewer steps.
    expect(bdf.stats.steps).toBeLessThan(150);
    expect(rk.stats.steps).toBeGreaterThan(180);
  });

  it('handles the Robertson stiff problem with mass conservation', () => {
    const f = (_t: number, y: number[]): number[] => [
      -0.04 * y[0]! + 1e4 * y[1]! * y[2]!,
      0.04 * y[0]! - 1e4 * y[1]! * y[2]! - 3e7 * y[1]! * y[1]!,
      3e7 * y[1]! * y[1]!,
    ];
    const r = solveBDF(f, 0, [1, 0, 0], 40, { rtol: 1e-4, atol: [1e-6, 1e-10, 1e-6] });
    expect(r.status).toBe('ok');
    expect(r.stats.steps).toBeLessThan(3000);
    const e = end(r);
    expectFiniteSolution(r);
    expect(Math.abs(e.y[0]! + e.y[1]! + e.y[2]! - 1)).toBeLessThan(1e-4);
    expect(e.y[1]!).toBeGreaterThanOrEqual(-1e-10);
    expect(e.y[2]!).toBeGreaterThan(0);
  });

  it('reports maxSteps exhaustion as a status, not an error', () => {
    const r = solveBDF((_t, y) => [y[0]!], 0, [1], 1, { maxSteps: 2 });
    expect(r.status).toBe('maxSteps');
    expect(r.t.length).toBe(3);
  });
});

describe('Radau IIA (order 5)', () => {
  it('integrates y\' = -y within tolerance', () => {
    const r = solveRadau((_t, y) => [-y[0]!], 0, [1], 1, { rtol: 1e-6, atol: 1e-9 });
    expect(r.status).toBe('ok');
    expectFiniteSolution(r);
    expect(Math.abs(end(r).y[0]! - Math.exp(-1))).toBeLessThan(1e-5);
  });

  it('solves the Robertson stiff problem with mass conservation', () => {
    const f = (_t: number, y: number[]): number[] => [
      -0.04 * y[0]! + 1e4 * y[1]! * y[2]!,
      0.04 * y[0]! - 1e4 * y[1]! * y[2]! - 3e7 * y[1]! * y[1]!,
      3e7 * y[1]! * y[1]!,
    ];
    const r = solveRadau(f, 0, [1, 0, 0], 40, { rtol: 1e-4, atol: [1e-6, 1e-10, 1e-6] });
    expect(r.status).toBe('ok');
    expect(r.stats.steps).toBeLessThan(3000);
    const e = end(r);
    expectFiniteSolution(r);
    expect(Math.abs(e.y[0]! + e.y[1]! + e.y[2]! - 1)).toBeLessThan(1e-4);
    expect(e.y[2]!).toBeGreaterThan(0);
  });

  it('uses a user-supplied analytic Jacobian when provided', () => {
    let calls = 0;
    const r = solveRadau((_t, y) => [-y[0]!], 0, [1], 1, {
      rtol: 1e-6,
      atol: 1e-9,
      jac: (_t, _y) => {
        calls++;
        return [[-1]];
      },
    });
    expect(r.stats.jacEvals).toBeGreaterThan(0);
    expect(calls).toBe(r.stats.jacEvals);
    expect(Math.abs(end(r).y[0]! - Math.exp(-1))).toBeLessThan(1e-5);
  });
});
