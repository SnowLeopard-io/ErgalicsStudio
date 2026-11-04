// math-odefield kernel tests — parser, RK4, Newton, eigenvalues, manifolds
import { describe, it, expect } from 'vitest';
import {
  classifyEquilibrium,
  compileReal2,
  eigenvalues2x2,
  integrateStream,
  newtonEquilibrium,
  numericJacobian,
  ODE_PRESETS,
  rk4Step,
  runOdefieldBenchmarks,
  saddleManifoldDeviation,
  type VectorField,
} from '../src/plugins/builtin/math/odefield/kernel';

function mustCompile(src: string): (x: number, y: number) => number {
  const c = compileReal2(src);
  if (!c.ok) throw new Error(`compile failed for '${src}': ${c.error}`);
  return c.fn;
}

describe('compileReal2 parser', () => {
  it('evaluates expressions in x and y', () => {
    expect(mustCompile('x^2 + y^2')(3, 4)).toBeCloseTo(25, 10);
    expect(mustCompile('sin(pi/2)*x')(2, 9)).toBeCloseTo(2, 12);
    expect(mustCompile('atan(1)*4')(0, 0)).toBeCloseTo(Math.PI, 12);
  });

  it('supports implicit multiplication and right-associative power', () => {
    expect(mustCompile('2x + 3y')(1, 2)).toBeCloseTo(8, 12);
    expect(mustCompile('x(x+1)')(2, 0)).toBeCloseTo(6, 12);
    expect(mustCompile('(x+y)(x-y)')(3, 1)).toBeCloseTo(8, 12);
    expect(mustCompile('2^2^3')(0, 0)).toBe(256);
    expect(mustCompile('-x^2')(2, 0)).toBe(-4);
    expect(mustCompile('EXP(X)')(1, 0)).toBeCloseTo(Math.E, 12);
  });

  it('rejects malformed input with an error message', () => {
    expect(compileReal2('').ok).toBe(false);
    expect(compileReal2('x +').ok).toBe(false);
    expect(compileReal2('w + 1').ok).toBe(false);
    expect(compileReal2('foo(x)').ok).toBe(false);
    expect(compileReal2('(x').ok).toBe(false);
  });
});

describe('RK4 integration', () => {
  it('matches the closed form after one step of y′ = y', () => {
    const [, ny] = rk4Step((_x, y) => [0, y], 0, 1, 0.1);
    expect(ny).toBeCloseTo(1.1051708333, 9); // e^0.1 = 1.10517091808
  });

  it('tracks e^t over T = 2 with x′ = 0 kept exact', () => {
    const f: VectorField = (_x, y) => [0, y];
    const pts = integrateStream(f, 1, 1, 0.005, 400);
    const last = pts[pts.length - 1]!;
    expect(last.x).toBe(1); // exact: x + (h/6)·0
    expect(Math.abs(last.y - Math.exp(2)) / Math.exp(2)).toBeLessThan(1e-6);
  });

  it('integrates backward with negative h', () => {
    const f: VectorField = (_x, y) => [0, y];
    const pts = integrateStream(f, 1, Math.exp(2), -0.005, 400);
    const last = pts[pts.length - 1]!;
    expect(Math.abs(last.y - 1)).toBeLessThan(1e-6);
  });

  it('stops early on finite-time blow-up and keeps points finite', () => {
    const f: VectorField = (x) => [x * x, 0];
    const pts = integrateStream(f, 2, 0, 0.01, 400);
    expect(pts.length).toBeLessThan(401);
    for (const p of pts) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
    expect(pts[0]!.speed).toBeCloseTo(4, 12); // |f(2,0)| = |(4,0)| = 4
  });
});

describe('Newton equilibrium localization', () => {
  const lvFx = mustCompile('x*(1.1 - 0.4*y)');
  const lvFy = mustCompile('y*(0.3*x - 0.9)');
  const lv: VectorField = (x, y) => [lvFx(x, y), lvFy(x, y)];

  it('converges to the Lotka–Volterra equilibrium (γ/δ, α/β) = (3, 2.75)', () => {
    const eq = newtonEquilibrium(lv, 2.5, 2.0);
    expect(eq.converged).toBe(true);
    expect(Math.abs(eq.x - 3) / 3).toBeLessThan(1e-6);
    expect(Math.abs(eq.y - 2.75) / 2.75).toBeLessThan(1e-6);
  });

  it('finds the damped-pendulum rest point (0, 0)', () => {
    const f: VectorField = (x, y) => [y, -Math.sin(x) - 0.25 * y];
    const eq = newtonEquilibrium(f, 0.5, 0.3);
    expect(eq.converged).toBe(true);
    expect(Math.abs(eq.x)).toBeLessThan(1e-6);
    expect(Math.abs(eq.y)).toBeLessThan(1e-6);
  });

  it('reports non-convergence for a field without zeros', () => {
    const eq = newtonEquilibrium(() => [1, 1], 0, 0);
    expect(eq.converged).toBe(false);
  });

  it('computes the central-difference Jacobian of the LV field', () => {
    const [j11, j12, j21, j22] = numericJacobian(lv, 3, 2.75);
    expect(Math.abs(j11)).toBeLessThan(1e-6); // α − βy = 0
    expect(Math.abs(j12 + 1.2)).toBeLessThan(1e-5); // −βx = −1.2
    expect(Math.abs(j21 - 0.825)).toBeLessThan(1e-5); // δy = 0.825
    expect(Math.abs(j22)).toBeLessThan(1e-6); // δx − γ = 0
  });
});

describe('eigenvalues and planar classification', () => {
  it('saddle [[1,3],[2,−1]] → ±√7', () => {
    const [l1, l2] = eigenvalues2x2(1, 3, 2, -1);
    expect(l1.re).toBeCloseTo(Math.sqrt(7), 12);
    expect(l2.re).toBeCloseTo(-Math.sqrt(7), 12);
    expect(l1.im).toBe(0);
    const cls = classifyEquilibrium(1, 3, 2, -1);
    expect(cls.kind).toBe('saddle');
    expect(cls.stability).toBe('none');
  });

  it('spiral [[−0.1,2],[−2,−0.1]] → −0.1 ± 2i, sink', () => {
    const [l1, l2] = eigenvalues2x2(-0.1, 2, -2, -0.1);
    expect(l1.re).toBeCloseTo(-0.1, 12);
    expect(l1.im).toBeCloseTo(2, 12);
    expect(l2.im).toBeCloseTo(-2, 12);
    const cls = classifyEquilibrium(-0.1, 2, -2, -0.1);
    expect(cls.kind).toBe('spiral');
    expect(cls.stability).toBe('sink');
  });

  it('classifies node sink/source and center', () => {
    expect(classifyEquilibrium(-1, 0, 0, -2).kind).toBe('node');
    expect(classifyEquilibrium(-1, 0, 0, -2).stability).toBe('sink');
    expect(classifyEquilibrium(2, 0, 0, 3).stability).toBe('source');
    const ctr = classifyEquilibrium(0, 1, -1, 0);
    expect(ctr.kind).toBe('center');
    const [l1, l2] = eigenvalues2x2(0, 1, -1, 0);
    expect(l1.re).toBeCloseTo(0, 12);
    expect(l1.im).toBeCloseTo(1, 12);
    expect(l2.im).toBeCloseTo(-1, 12);
    expect(classifyEquilibrium(0, 0, 0, 0).kind).toBe('degenerate');
  });
});

describe('saddle invariant manifolds', () => {
  it('keeps eigenvector-seeded trajectories parallel to the eigenvector', () => {
    const devU = saddleManifoldDeviation(1, 3, 2, -1, 'unstable', 0.005, 300);
    const devS = saddleManifoldDeviation(1, 3, 2, -1, 'stable', -0.005, 300);
    expect(devU).toBeLessThan(1e-6);
    expect(devS).toBeLessThan(1e-6);
  });

  it('returns NaN for systems without real eigenvalues', () => {
    expect(Number.isNaN(saddleManifoldDeviation(-0.1, 2, -2, -0.1, 'unstable', 0.005, 10))).toBe(true);
  });
});

describe('preset systems', () => {
  it('compile and evaluate finitely at sample points', () => {
    for (const p of ODE_PRESETS) {
      const fx = compileReal2(p.fx);
      const fy = compileReal2(p.fy);
      expect(fx.ok, p.id).toBe(true);
      expect(fy.ok, p.id).toBe(true);
      if (fx.ok && fy.ok) {
        const samples: Array<[number, number]> = [
          [1, 1],
          [2, -1],
        ];
        for (const [sx, sy] of samples) {
          expect(Number.isFinite(fx.fn(sx, sy)), p.id).toBe(true);
          expect(Number.isFinite(fy.fn(sx, sy)), p.id).toBe(true);
        }
      }
    }
  });
});

describe('embedded validation benchmarks', () => {
  it('passes all four benchmarks within the spec tolerances', () => {
    const bench = runOdefieldBenchmarks();
    expect(bench.map((b) => b.id)).toEqual([
      'rk4-exponential',
      'lv-equilibrium',
      'eigen-closed-form',
      'saddle-manifold',
    ]);
    for (const b of bench) expect(b.passed, b.id).toBe(true);
    const byId = new Map(bench.map((b) => [b.id, b]));
    expect(byId.get('rk4-exponential')!.relErr).toBeLessThan(1e-3);
    expect(byId.get('lv-equilibrium')!.relErr).toBeLessThan(1e-6);
    expect(byId.get('eigen-closed-form')!.relErr).toBeLessThan(1e-9);
    expect(byId.get('saddle-manifold')!.relErr).toBeLessThan(1e-6);
  });
});
