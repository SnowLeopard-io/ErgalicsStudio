// ==========================================================================
// tests for the physics-trajectory kernel (pure functions, no DOM).
// Covers the three embedded acceptance benchmarks plus unit tests for the
// differentiation stencils, Savitzky–Golay smoothing, the linearized fit,
// energy decomposition and the trajectory text parser.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  DEMO_SYNTH,
  benchmarkDerivativeAccuracy,
  benchmarkEnergyDrift,
  benchmarkProjectileRecovery,
  derivatives,
  energySeries,
  fitProjectile,
  mulberry32,
  parseTrajText,
  relativeDrift,
  sgSmooth,
  smoothTrajectory,
  synthesizeProjectile,
  type Trajectory,
} from '../src/plugins/builtin/physics-trajectory/kernel';

// ---- benchmark ①: projectile recovery from 0.5 % noise -------------------------------

describe('benchmark ① — projectile recovery', () => {
  it('recovers v0 and theta within 1 % from the 0.5 %-noise seed-20251011 dataset', () => {
    const b = benchmarkProjectileRecovery();
    expect(b.v0RelErr).toBeLessThan(1e-2);
    expect(b.thetaRelErr).toBeLessThan(1e-2);
    // sanity: recovered values sit near the injected ones
    expect(Math.abs(b.v0 - 20) / 20).toBeLessThan(0.01);
    expect(Math.abs(b.thetaDeg - 45) / 45).toBeLessThan(0.01);
  });

  it('recovers the parameters to machine precision on noiseless data', () => {
    const tr = synthesizeProjectile({ ...DEMO_SYNTH, noise: 0 });
    const fit = fitProjectile(tr, DEMO_SYNTH.g);
    expect(fit.v0!).toBeCloseTo(20, 8);
    expect(fit.thetaDeg!).toBeCloseTo(45, 8);
    expect(fit.x0).toBeCloseTo(0, 8);
    expect(fit.y0!).toBeCloseTo(0, 8);
  });
});

// ---- benchmark ②: derivative accuracy on non-uniform grids ---------------------------

describe('benchmark ② — derivative accuracy', () => {
  it('stencils reproduce vx/vy/ay below 1e-2 and ax below 1e-6 absolute', () => {
    const b = benchmarkDerivativeAccuracy();
    expect(b.maxRelErr).toBeLessThan(1e-2);
    expect(b.maxAbsAx).toBeLessThan(1e-6);
  });

  it('is exact for quadratics on a non-uniform grid', () => {
    // f(t) = 1 + 2t − 3t² → f' = 2 − 6t, f'' = −6, everywhere, any grid.
    const t = [0, 0.13, 0.37, 0.55, 0.9, 1.42, 2.01];
    const x = t.map((ti) => 1 + 2 * ti - 3 * ti * ti);
    const d = derivatives({ t, x, y: null });
    for (let i = 0; i < t.length; i++) {
      expect(d.vx[i]! - (2 - 6 * t[i]!)).toBeCloseTo(0, 10);
      expect(d.ax[i]! - (-6)).toBeCloseTo(0, 10);
    }
  });

  it('is exact for linear data: constant slope, zero curvature', () => {
    const t = [0, 0.4, 1.1, 2.3, 3.0];
    const x = t.map((ti) => 3 * ti - 2);
    const d = derivatives({ t, x, y: null });
    for (const v of d.vx) expect(v).toBeCloseTo(3, 12);
    // mathematically zero; floating-point cancellation leaves ~1e-16
    for (const v of d.ax) expect(v).toBeCloseTo(0, 12);
  });

  it('throws for fewer than 3 samples', () => {
    const tr: Trajectory = { t: [0, 1], x: [0, 1], y: null };
    expect(() => derivatives(tr)).toThrow();
  });
});

// ---- benchmark ③: energy conservation -------------------------------------------------

describe('benchmark ③ — energy conservation', () => {
  it('noiseless total mechanical energy drifts below 0.5 %', () => {
    const b = benchmarkEnergyDrift();
    expect(b.drift).toBeLessThan(5e-3);
  });

  it('KE + PE is constant pointwise on the exact parabola (m = 2.5 kg)', () => {
    const m = 2.5;
    const tr = synthesizeProjectile({ ...DEMO_SYNTH, noise: 0 });
    const d = derivatives(tr);
    const e = energySeries(tr, d, m, DEMO_SYNTH.g);
    const total = e.total!;
    const mean = total.reduce((s, v) => s + v, 0) / total.length;
    // analytic E = ½ m v0² (launch-height reference, y0 = 0)
    expect(mean).toBeCloseTo(0.5 * m * DEMO_SYNTH.v0 ** 2, 6);
    for (const v of total) expect(Math.abs(v - mean)).toBeLessThan(1e-6);
    expect(e.pe![0]!).toBeCloseTo(0, 12); // launch-height reference
  });
});

// ---- smoothing -------------------------------------------------------------------------

describe('Savitzky–Golay smoothing', () => {
  const g = 9.81;
  const v0 = 20;
  const th = Math.PI / 4;
  const n = 60;
  const T = (2 * v0 * Math.sin(th)) / g;
  const t = Array.from({ length: n }, (_, i) => (T * i) / (n - 1));

  it('preserves a clean parabola (local quadratic LSQ is exact)', () => {
    const clean = t.map((ti) => 5 + 2 * ti - 0.7 * ti * ti);
    const out = sgSmooth(clean, t, 9);
    let worst = 0;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(out[i]! - clean[i]!));
    expect(worst).toBeLessThan(1e-9);
  });

  it('suppresses multiplicative noise on a trajectory', () => {
    const rng = mulberry32(7);
    const cleanY = t.map((ti) => v0 * Math.sin(th) * ti - 0.5 * g * ti * ti);
    const noisyY = cleanY.map((v) => v * (1 + 0.05 * ((Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * Math.cos(2 * Math.PI * rng())))));
    const rms = (a: number[], b: number[]) =>
      Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]!) ** 2, 0) / a.length);
    const smoothed = sgSmooth(noisyY, t, 9);
    expect(rms(smoothed, cleanY)).toBeLessThan(0.7 * rms(noisyY, cleanY));
  });

  it('window < 5 leaves the data unchanged', () => {
    const vals = [1, 2, 3, 4, 5];
    expect(sgSmooth(vals, [0, 1, 2, 3, 4], 3)).toEqual(vals);
    const tr: Trajectory = { t: [0, 1, 2, 3, 4], x: vals, y: null };
    const out = smoothTrajectory(tr, 0);
    expect(out.x).toEqual(vals);
  });
});

// ---- text parsing ------------------------------------------------------------------------

describe('parseTrajText', () => {
  it('parses csv with header and comment lines', () => {
    const tr = parseTrajText('# bench run\nt,x,y\n0,1,2\n0.5,3,4\n1.0,5,6\n');
    expect(tr.t).toEqual([0, 0.5, 1]);
    expect(tr.x).toEqual([1, 3, 5]);
    expect(tr.y).toEqual([2, 4, 6]);
  });

  it('parses tab-separated files and // comments', () => {
    const tr = parseTrajText('// exported\n0\t1\t2\n0.5\t3\t4\n1\t5\t6');
    expect(tr.t).toEqual([0, 0.5, 1]);
    expect(tr.y).toEqual([2, 4, 6]);
  });

  it('accepts whitespace-delimited 2-column data (no y)', () => {
    const tr = parseTrajText('0 1\n1 2\n2 3\n');
    expect(tr.y).toBeNull();
    expect(tr.x).toEqual([1, 2, 3]);
  });

  it('sorts rows by time', () => {
    const tr = parseTrajText('1,5\n0,3\n0.5,4');
    expect(tr.t).toEqual([0, 0.5, 1]);
    expect(tr.x).toEqual([3, 4, 5]);
  });

  it('skips malformed rows and falls back to 2 columns on mixed tables', () => {
    const tr = parseTrajText('0,1,2\n0.5,3,4\nbad,row,here\n1,5\n');
    expect(tr.t).toEqual([0, 0.5, 1]);
    expect(tr.x).toEqual([1, 3, 5]);
    expect(tr.y).toBeNull();
  });

  it('throws below 3 valid rows', () => {
    expect(() => parseTrajText('t,x\n0,1\n1,2')).toThrow();
    expect(() => parseTrajText('')).toThrow();
  });
});

// ---- 1-D (t, x) tracks -------------------------------------------------------------------

describe('1-D tracks (no y column)', () => {
  it('derivatives, energies and fit null out the vertical channel', () => {
    const tr: Trajectory = { t: [0, 1, 2], x: [1, 3, 5], y: null };
    const d = derivatives(tr);
    expect(d.vy).toBeNull();
    expect(d.ay).toBeNull();
    for (const v of d.vx) expect(v).toBeCloseTo(2, 12);
    const e = energySeries(tr, d, 1, 9.81);
    expect(e.pe).toBeNull();
    expect(e.total).toBeNull();
    expect(e.ke[0]!).toBeCloseTo(0.5 * 1 * 4, 12);
    const fit = fitProjectile(tr, 9.81);
    expect(fit.v0).toBeNull();
    expect(fit.thetaDeg).toBeNull();
    expect(fit.vx).toBeCloseTo(2, 12);
  });
});

// ---- determinism & PRNG --------------------------------------------------------------------

describe('synthetic generator determinism', () => {
  it('same seed reproduces identical data, different seed does not', () => {
    const a = synthesizeProjectile(DEMO_SYNTH);
    const b = synthesizeProjectile(DEMO_SYNTH);
    expect(a).toEqual(b);
    const c = synthesizeProjectile({ ...DEMO_SYNTH, seed: 1 });
    expect(c.x).not.toEqual(a.x);
  });

  it('mulberry32 stays in [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const u = rng();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
    }
  });
});

// ---- shipped example data --------------------------------------------------------------------

describe('shipped example csv (phys-projectile-45deg.csv)', () => {
  it('parses and refits to v0 = 20 m/s, theta = 45° within 1 %', () => {
    const csvPath = fileURLToPath(new URL('../examples/data/phys-projectile-45deg.csv', import.meta.url));
    const tr = parseTrajText(readFileSync(csvPath, 'utf-8'));
    expect(tr.t.length).toBeGreaterThanOrEqual(50);
    expect(tr.y).not.toBeNull();
    const fit = fitProjectile(tr, DEMO_SYNTH.g);
    expect(Math.abs(fit.v0! - 20) / 20).toBeLessThan(0.01);
    expect(Math.abs(fit.thetaDeg! - 45) / 45).toBeLessThan(0.01);
  });
});

// ---- noise handling (honest data-quality indicator) --------------------------------------------

describe('noisy demo data energy drift', () => {
  it('is flagged by the drift metric and reduced by SG smoothing', () => {
    const tr = synthesizeProjectile(DEMO_SYNTH); // 0.5 % noise
    const driftRaw = relativeDrift(energySeries(tr, derivatives(tr), 1, DEMO_SYNTH.g).total!);
    expect(driftRaw).toBeGreaterThan(0); // metric reacts to noise
    const smoothed = smoothTrajectory(tr, 9);
    const driftSmooth = relativeDrift(
      energySeries(smoothed, derivatives(smoothed), 1, DEMO_SYNTH.g).total!,
    );
    expect(driftSmooth).toBeLessThan(driftRaw);
  });
});
