import { describe, expect, it } from 'vitest';
import {
  advance,
  analytic1d,
  benchmarkConvergence2D,
  benchmarkGaussian,
  benchmarkSineDecay,
  courantNumber,
  isStable,
  makeInitialField,
  maxRelativeError,
  runToTime,
  type DiffusionParams,
} from '../src/plugins/builtin/physics/diffusion/kernel';

const cn1d: DiffusionParams = {
  dim: '1d',
  scheme: 'cn',
  d: 1,
  n: 160,
  dt: 1e-3,
  boundary: 'dirichlet',
  initial: 'sine',
  domain: 1,
};

describe('physics-diffusion kernel — validation benchmarks', () => {
  it('benchmark ①: sine-mode amplitude decays as exp(−Dk²t) (rel err < 1e-3)', () => {
    const b = benchmarkSineDecay();
    expect(b.relErr).toBeLessThan(1e-3);
  });

  it('benchmark ②: Gaussian width σ² = σ₀² + 2Dt and amplitude σ₀/σ_t (rel err < 1%)', () => {
    const b = benchmarkGaussian();
    expect(b.relErrWidth2).toBeLessThan(0.01);
    expect(b.relErrAmplitude).toBeLessThan(0.01);
  });

  it('benchmark ③: 2-D FTCS is second-order (refinement error ratio in 3–5)', () => {
    const b = benchmarkConvergence2D();
    expect(b.errCoarse).toBeGreaterThan(0);
    expect(b.errFine).toBeGreaterThan(0);
    expect(b.ratio).toBeGreaterThan(3);
    expect(b.ratio).toBeLessThan(5);
  });
});

describe('physics-diffusion kernel — stability gate', () => {
  it('rejects FTCS configurations with D·Δt/Δx² > 0.5 before stepping', () => {
    // dx = 1/20 = 0.05 → dx² = 2.5e-3; dt = 0.002 gives r = 0.8 > 0.5
    const p: DiffusionParams = { ...cn1d, scheme: 'ftcs', n: 21, dt: 0.002 };
    expect(courantNumber(p)).toBeCloseTo(0.8, 9);
    expect(isStable(p)).toBe(false);
    expect(() => runToTime(p, 0.01)).toThrow(/unstable/i);
  });

  it('accepts FTCS at the ceiling (r = 0.5) and CN at any courant number', () => {
    const edge: DiffusionParams = { ...cn1d, scheme: 'ftcs', n: 21, dt: 0.00125 };
    expect(courantNumber(edge)).toBeCloseTo(0.5, 9);
    expect(isStable(edge)).toBe(true);
    const hotCn: DiffusionParams = { ...cn1d, n: 21, dt: 0.05 }; // r = 20
    expect(isStable(hotCn)).toBe(true);
    const f = runToTime(hotCn, 0.1);
    expect(f.u.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('2-D FTCS stability uses the summed courant number (r_x + r_y ≤ 0.5)', () => {
    const ok: DiffusionParams = { ...cn1d, dim: '2d', scheme: 'ftcs', n: 33, dt: 0.2 / 1024 };
    expect(courantNumber(ok)).toBeCloseTo(0.4, 9); // 2 × r_axis = 2 × 0.2
    expect(isStable(ok)).toBe(true);
    const bad: DiffusionParams = { ...ok, dt: 0.3 / 1024 };
    expect(isStable(bad)).toBe(false);
  });
});

describe('physics-diffusion kernel — boundary handling', () => {
  it('Dirichlet pins the boundary values; Neumann conserves the field total (zero flux)', () => {
    const sq: DiffusionParams = { ...cn1d, initial: 'square', n: 101 };
    const fDir = makeInitialField(sq);
    advance(fDir, sq, 200);
    expect(fDir.u[0]).toBe(0);
    expect(fDir.u[sq.n - 1]).toBe(0);

    const neu: DiffusionParams = { ...sq, boundary: 'neumann' };
    const fNeu = makeInitialField(neu);
    let total0 = 0;
    for (let i = 0; i < fNeu.u.length; i++) total0 += fNeu.u[i]!;
    advance(fNeu, neu, 300);
    let total1 = 0;
    for (let i = 0; i < fNeu.u.length; i++) total1 += fNeu.u[i]!;
    expect(Math.abs(total1 - total0) / total0).toBeLessThan(1e-12);
  });

  it('maxRelativeError returns null when no analytic reference exists', () => {
    const p: DiffusionParams = { ...cn1d, initial: 'sine', boundary: 'neumann' };
    const f = runToTime(p, 0.05);
    expect(maxRelativeError(f, p)).toBeNull();
    const p2d: DiffusionParams = { ...cn1d, dim: '2d', n: 33, initial: 'square', dt: 0.2 / 1024 };
    const f2d = runToTime(p2d, 0.01);
    expect(maxRelativeError(f2d, p2d)).toBeNull();
  });

  it('analytic sine reference decays by exp(−Dπ²t) at the domain centre', () => {
    const t = 0.07;
    const ua = analytic1d(cn1d, 0.5, t);
    expect(ua).not.toBeNull();
    expect(Math.abs(ua! - Math.exp(-Math.PI * Math.PI * t))).toBeLessThan(1e-15);
  });
});
