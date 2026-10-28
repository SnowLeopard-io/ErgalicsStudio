// math-numerics kernel tests — roots, quadrature, differences, splines, benchmarks
import { describe, it, expect } from 'vitest';
import {
  FD_STEP_LADDER,
  PANEL_LADDER,
  SAMPLE_FUNCTIONS,
  backwardDiff,
  bisectRoot,
  centralDiff,
  compositeGauss,
  cubicSpline,
  dividedDifferences,
  equiNodes,
  fitIterationOrder,
  fitLogLogOrder,
  forwardDiff,
  gaussLegendre,
  gaussNodesWeights,
  lagrangeInterp,
  newtonInterp,
  newtonRoot,
  runNumericsBenchmarks,
  secantRoot,
  selectSample,
  simpson,
  simpsonEstimate,
  splineEval,
  trapezoidal,
  trapezoidalEstimate,
} from '../src/plugins/builtin/math/numerics/kernel';

describe('sample dataset', () => {
  it('resolves every sample with finite f/df and a sign-changing bracket', () => {
    for (const s of SAMPLE_FUNCTIONS) {
      expect(selectSample(s.id).id, s.id).toBe(s.id);
      expect(Number.isFinite(s.f(0.5)), s.id).toBe(true);
      expect(Number.isFinite(s.df(0.5)), s.id).toBe(true);
      const [a, b] = s.bracket;
      expect(s.f(a) * s.f(b), s.id).toBeLessThan(0);
      expect(s.f(s.root), `${s.id} at analytic root`).toBeCloseTo(0, 12);
      expect(s.f(s.integral.a) * 0 + s.integral.value, s.id).not.toBe(0);
    }
  });
});

describe('root finding', () => {
  const s2 = selectSample('sqrt2');

  it('bisects x² − 2 to the bracket tolerance', () => {
    const r = bisectRoot(s2.f, 1, 2, 40, s2.root);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.root - Math.SQRT2) / Math.SQRT2).toBeLessThan(1e-9);
    const errs = r.steps.map((s) => s.err);
    expect(errs.length).toBeGreaterThan(20);
    // measured order ≈ 1 (linear convergence)
    const order = fitIterationOrder(errs, 10, Math.min(35, errs.length - 1));
    expect(order).toBeGreaterThan(0.85);
    expect(order).toBeLessThan(1.15);
  });

  it('rejects brackets without a sign change', () => {
    expect(bisectRoot((x) => x * x + 1, -1, 1, 10).converged).toBe(false);
  });

  it('newton converges quadratically to √2', () => {
    const r = newtonRoot(s2.f, s2.df, 1.5, 20, s2.root);
    expect(r.converged).toBe(true);
    expect(Math.abs(r.root - Math.SQRT2) / Math.SQRT2).toBeLessThan(1e-12);
    const errs = r.steps.map((s) => s.err).filter((e) => e > 1e-13);
    expect(errs.length).toBeGreaterThanOrEqual(3);
    // pointwise order p = log(e_k / e_{k-1}) / log(e_{k-1} / e_{k-2}) ≈ 2
    const p = Math.log(errs[2]! / errs[1]!) / Math.log(errs[1]! / errs[0]!);
    expect(p).toBeGreaterThan(1.5);
  });

  it('secant converges without a derivative', () => {
    const r = secantRoot(s2.f, 1, 1.3, 30, s2.root);
    expect(Math.abs(r.root - Math.SQRT2) / Math.SQRT2).toBeLessThan(1e-10);
  });

  it('finds π from the sin bracket and ln 2 from the exp bracket', () => {
    const sin = selectSample('sin');
    const rs = secantRoot(sin.f, 2, 2.6, 40, sin.root);
    expect(Math.abs(rs.root - Math.PI) / Math.PI).toBeLessThan(1e-10);
    const exp = selectSample('exp');
    const rn = newtonRoot(exp.f, exp.df, 0, 30, exp.root);
    expect(Math.abs(rn.root - Math.LN2) / Math.LN2).toBeLessThan(1e-10);
  });
});

describe('quadrature', () => {
  it('trapezoid converges at O(h²) for ∫₀^π sin x dx = 2', () => {
    const f = (x: number) => Math.sin(x);
    const e4 = Math.abs(trapezoidal(f, 0, Math.PI, 4) - 2) / 2;
    const e8 = Math.abs(trapezoidal(f, 0, Math.PI, 8) - 2) / 2;
    expect(e4).toBeGreaterThan(e8); // error decreases
    expect(e4 / e8).toBeGreaterThan(3); // ≈ 4× per doubling
    const hs = PANEL_LADDER.map((n) => Math.PI / n);
    const errs = PANEL_LADDER.map((n) => Math.abs(trapezoidal(f, 0, Math.PI, n) - 2));
    const order = fitLogLogOrder(hs, errs);
    expect(order).toBeGreaterThan(1.8);
    expect(order).toBeLessThan(2.2);
  });

  it('composite Simpson is exact for cubics', () => {
    const p = (x: number) => x * x * x - 2 * x + 1; // ∫₀² = 2
    expect(Math.abs(simpson(p, 0, 2, 6) - 2)).toBeLessThan(1e-12);
  });

  it('Simpson quintic error matches the closed-form −(b−a)h⁴f⁗/180 term', () => {
    const q = (x: number) => x ** 5 - 3 * x ** 4 + 2;
    const d4 = (x: number) => 120 * x - 72;
    const n = 4;
    const h = 1 / n;
    let pred = 0;
    for (let i = 0; i < n / 2; i += 1) pred += ((2 * h) / 180) * h ** 4 * d4((2 * i + 1) * h);
    const diff = simpson(q, 0, 1, n) - (1 / 6 - 3 / 5 + 2);
    expect(Math.abs(diff - pred) / Math.abs(pred)).toBeLessThan(1e-10);
  });

  it('Gauss–Legendre nodes/weights integrate cubics exactly with 2 points', () => {
    const { nodes, weights } = gaussNodesWeights(2);
    expect(nodes[0]).toBeCloseTo(-1 / Math.sqrt(3), 12);
    expect(nodes[1]).toBeCloseTo(1 / Math.sqrt(3), 12);
    expect(weights[0]).toBeCloseTo(1, 12);
    expect(weights[1]).toBeCloseTo(1, 12);
    expect(Math.abs(gaussLegendre((x) => x * x * x, 0, 2, 2) - 4)).toBeLessThan(1e-14);
    expect(gaussNodesWeights(1).weights[0]).toBe(2);
  });

  it('composite 3-point Gauss beats the trapezoid on ∫ sin', () => {
    const f = (x: number) => Math.sin(x);
    const g = Math.abs(compositeGauss(f, 0, Math.PI, 2, 3) - 2) / 2;
    const t = Math.abs(trapezoidal(f, 0, Math.PI, 2) - 2) / 2;
    expect(g).toBeLessThan(t);
    expect(g).toBeLessThan(1e-3);
  });

  it('Richardson estimates bracket the true errors', () => {
    const f = (x: number) => Math.sin(x);
    const t = trapezoidalEstimate(f, 0, Math.PI, 8);
    expect(t.estimate).toBeGreaterThan(Math.abs(t.value - 2) / 2);
    const s = simpsonEstimate(f, 0, Math.PI, 8);
    expect(s.estimate).toBeGreaterThan(Math.abs(s.value - 2) / 2);
    expect(s.estimate).toBeLessThan(t.estimate);
  });
});

describe('finite differences', () => {
  const s = selectSample('sin');
  const x = s.xDiff;
  const exact = s.df(x);

  it('central difference is more accurate than forward/backward', () => {
    const h = 1e-5;
    const eF = Math.abs(forwardDiff(s.f, x, h) - exact);
    const eB = Math.abs(backwardDiff(s.f, x, h) - exact);
    const eC = Math.abs(centralDiff(s.f, x, h) - exact);
    expect(eC).toBeLessThan(eF);
    expect(eC).toBeLessThan(eB);
    expect(eC / eF).toBeLessThan(1e-3);
  });

  it('measured orders follow O(h) forward and O(h²) central', () => {
    const small = FD_STEP_LADDER.filter((h) => h >= 1e-4 && h <= 1e-2);
    const fwd = small.map((h) => Math.abs(forwardDiff(s.f, x, h) - exact));
    const cen = small.map((h) => Math.abs(centralDiff(s.f, x, h) - exact));
    expect(fitLogLogOrder(small, fwd)).toBeGreaterThan(0.9);
    expect(fitLogLogOrder(small, cen)).toBeGreaterThan(1.8);
    expect(fitLogLogOrder(small, cen)).toBeLessThan(2.2);
  });
});

describe('interpolation', () => {
  it('Lagrange and Newton divided differences reproduce polynomials exactly', () => {
    const xs = equiNodes(0, 2, 5);
    const p = (x: number) => 2 * x * x * x - 5 * x + 1;
    const ys = xs.map(p);
    const coefs = dividedDifferences(xs, ys);
    for (let t = 0; t <= 10; t += 1) {
      const x = (2 * t) / 10;
      expect(lagrangeInterp(xs, ys, x)).toBeCloseTo(p(x), 8);
      expect(newtonInterp(coefs, xs, x)).toBeCloseTo(p(x), 8);
    }
  });

  it('cubic splines interpolate their nodes (natural and clamped)', () => {
    const s = selectSample('sqrt2');
    const xs = equiNodes(s.range[0], s.range[1], 7);
    const ys = xs.map((x) => s.f(x));
    for (const mode of ['natural', 'clamped'] as const) {
      const segs = cubicSpline(xs, ys, mode, [s.df(xs[0]!), s.df(xs[xs.length - 1]!)]);
      expect(segs.length).toBe(xs.length - 1);
      for (let i = 0; i < xs.length; i += 1) {
        expect(Math.abs(splineEval(segs, xs, xs[i]!) - ys[i]!), `${mode} node ${i}`).toBeLessThan(1e-12);
      }
    }
  });

  it('the natural spline tracks the underlying function better than a straight line', () => {
    const s = selectSample('sin');
    const xs = equiNodes(s.range[0], s.range[1], 8);
    const ys = xs.map((x) => s.f(x));
    const segs = cubicSpline(xs, ys, 'natural');
    let maxErr = 0;
    let maxSlope = 0;
    for (let t = 0; t <= 100; t += 1) {
      const x = s.range[0] + ((s.range[1] - s.range[0]) * t) / 100;
      maxErr = Math.max(maxErr, Math.abs(splineEval(segs, xs, x) - s.f(x)));
      maxSlope = Math.max(maxSlope, Math.abs(s.f(x)));
    }
    expect(maxErr).toBeLessThan(0.05 * maxSlope);
  });

  it('returns no segments for fewer than two nodes', () => {
    expect(cubicSpline([1], [2], 'natural').length).toBe(0);
  });
});

describe('convergence-order fits', () => {
  it('recovers a known log-log slope', () => {
    const hs = [1, 0.5, 0.25, 0.125];
    const errs = hs.map((h) => 3 * Math.pow(h, 4));
    expect(fitLogLogOrder(hs, errs)).toBeCloseTo(4, 10);
  });

  it('skips non-positive and non-finite pairs', () => {
    expect(fitLogLogOrder([1, 2], [0, NaN])).toBeNaN();
    expect(fitLogLogOrder([1], [1])).toBeNaN();
  });

  it('recovers a known geometric iteration slope', () => {
    const errs = Array.from({ length: 20 }, (_, k) => Math.pow(0.5, k));
    expect(fitIterationOrder(errs, 2, 15)).toBeCloseTo(1, 6);
    const quad = Array.from({ length: 12 }, (_, k) => Math.pow(10, -Math.pow(2, k)));
    expect(fitIterationOrder(quad, 3, 8)).toBeGreaterThan(1.8);
  });
});

describe('embedded validation benchmarks', () => {
  it('passes all benchmarks within the spec tolerances', () => {
    const bench = runNumericsBenchmarks();
    expect(bench.map((b) => b.id)).toEqual([
      'bisection-order',
      'simpson-cubic',
      'simpson-quintic-error',
      'gauss2-cubic',
      'newton-sqrt2',
      'central-vs-forward',
      'spline-nodes',
    ]);
    for (const b of bench) expect(b.passed, `${b.id}: ${b.detailEn}`).toBe(true);
    const byId = new Map(bench.map((b) => [b.id, b]));
    expect(byId.get('bisection-order')!.relErr).toBeLessThan(0.1);
    expect(byId.get('simpson-cubic')!.relErr).toBeLessThan(1e-12);
    expect(byId.get('simpson-quintic-error')!.relErr).toBeLessThan(1e-10);
    expect(byId.get('gauss2-cubic')!.relErr).toBeLessThan(1e-14);
    expect(byId.get('newton-sqrt2')!.relErr).toBeLessThan(1e-12);
    expect(byId.get('central-vs-forward')!.relErr).toBeLessThan(1e-6);
    expect(byId.get('spline-nodes')!.relErr).toBeLessThan(1e-12);
    for (const b of bench) {
      expect(b.labelZh.length, b.id).toBeGreaterThan(0);
      expect(b.labelEn.length, b.id).toBeGreaterThan(0);
      expect(b.detailZh.length, b.id).toBeGreaterThan(0);
      expect(b.detailEn.length, b.id).toBeGreaterThan(0);
      expect(Number.isFinite(b.relErr), b.id).toBe(true);
    }
  });
});
