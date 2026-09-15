// Tests for the uncertainty suite: bootstrap CI, Monte-Carlo propagation,
// and Metropolis–Hastings MCMC. All stochastic results use fixed seeds so
// assertions are deterministic.

import { describe, it, expect } from 'vitest';
import { bootstrapCI } from '@/core/uncertainty/bootstrap';
import { propagateError, sampleDist } from '@/core/uncertainty/montecarlo';
import { metropolisHastings } from '@/core/uncertainty/mcmc';
import { mulberry32 } from '@/core/repro/random';

describe('bootstrap CI', () => {
  it('covers the true mean and reproduces with the same seed', () => {
    // Deterministic "population": 200 draws from N(10, 2).
    const rand = mulberry32(42);
    const x: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      let u1 = rand();
      while (u1 <= 0) u1 = rand();
      x.push(10 + 2 * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rand()));
    }
    const stat = (s: number[]) => s.reduce((a, v) => a + v, 0) / s.length;
    const a = bootstrapCI(x, stat, { iters: 1000, seed: 7 });
    const b = bootstrapCI(x, stat, { iters: 1000, seed: 7 });
    expect(b.lower).toBe(a.lower);
    expect(b.upper).toBe(a.upper);
    expect(a.estimate).toBeCloseTo(10, 0);
    // A 95% CI for the mean should comfortably cover the true mean here.
    expect(a.lower).toBeLessThan(10);
    expect(a.upper).toBeGreaterThan(10);
    expect(a.lower).toBeLessThan(a.upper);
    expect(a.se).toBeGreaterThan(0);
    expect(a.replicates).toHaveLength(1000);
  });

  it('rejects empty samples and clamps iteration counts', () => {
    expect(() => bootstrapCI([], (s) => s[0] ?? NaN)).toThrow();
    const r = bootstrapCI([1, 2, 3], (s) => s.reduce((a, v) => a + v, 0) / s.length, {
      iters: 1, // below the minimum → clamped to 100
      seed: 1,
    });
    expect(r.iters).toBe(100);
  });

  it('supports the median statistic', () => {
    const r = bootstrapCI([1, 2, 3, 4, 100], (s) => [...s].sort((a, b) => a - b)[2]!, {
      iters: 200,
      seed: 3,
    });
    expect(r.estimate).toBe(3);
    expect(r.upper).toBeLessThanOrEqual(100);
  });
});

describe('Monte-Carlo propagation', () => {
  it('propagates a sum of normals with the expected moments', () => {
    const f = (xs: number[]) => xs[0]! + xs[1]!;
    const r = propagateError(f, [
      { kind: 'normal', mean: 10, sd: 1 },
      { kind: 'normal', mean: 20, sd: 2 },
    ], 50_000, { seed: 11 });
    expect(r.mean).toBeGreaterThan(29.8);
    expect(r.mean).toBeLessThan(30.2);
    // Independent normals: variance adds → sd = sqrt(1 + 4) = sqrt(5).
    expect(r.std).toBeGreaterThan(Math.sqrt(5) * 0.95);
    expect(r.std).toBeLessThan(Math.sqrt(5) * 1.05);
    expect(r.sensitivity).toHaveLength(2);
    // With the second input twice as noisy, it should correlate more strongly.
    expect(Math.abs(r.sensitivity[1]!)).toBeGreaterThan(Math.abs(r.sensitivity[0]!));
  });

  it('is reproducible for a fixed seed', () => {
    const f = (xs: number[]) => xs[0]! * 2;
    const a = propagateError(f, [{ kind: 'uniform', low: 0, high: 5 }], 500, { seed: 9 });
    const b = propagateError(f, [{ kind: 'uniform', low: 0, high: 5 }], 500, { seed: 9 });
    expect(b.mean).toBe(a.mean);
    expect(b.ci95[0]).toBe(a.ci95[0]);
  });

  it('uniform draws stay inside the bounds', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 1000; i += 1) {
      const v = sampleDist({ kind: 'uniform', low: -2, high: 3 }, rand);
      expect(v).toBeGreaterThanOrEqual(-2);
      expect(v).toBeLessThan(3);
    }
  });

  it('triangular draws stay inside the bounds and cluster at the mode', () => {
    const rand = mulberry32(6);
    const draws: number[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const v = sampleDist({ kind: 'triangular', low: 0, mode: 8, high: 10 }, rand);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(10);
      draws.push(v);
    }
    const fracAboveMode = draws.filter((v) => v > 8).length / draws.length;
    // P(X > mode) = (high-mode)/(high-low) = 0.2 for a triangular law.
    expect(fracAboveMode).toBeGreaterThan(0.15);
    expect(fracAboveMode).toBeLessThan(0.25);
  });

  it('lognormal draws are strictly positive', () => {
    const rand = mulberry32(8);
    for (let i = 0; i < 500; i += 1) {
      expect(sampleDist({ kind: 'lognormal', logMean: 0, logSd: 0.5 }, rand)).toBeGreaterThan(0);
    }
  });

  it('drops non-finite outputs instead of corrupting the summary', () => {
    const f = (xs: number[]) => (xs[0]! > 10 ? NaN : xs[0]!);
    const r = propagateError(f, [{ kind: 'uniform', low: 0, high: 20 }], 5000, { seed: 4 });
    expect(r.mean).toBeGreaterThan(0);
    expect(r.mean).toBeLessThan(10);
    expect(Number.isFinite(r.median)).toBe(true);
  });

  it('throws when f never yields finite values', () => {
    expect(() =>
      propagateError(() => NaN, [{ kind: 'normal', mean: 0, sd: 1 }], 500, { seed: 1 }),
    ).toThrow();
  });
});

describe('Metropolis–Hastings', () => {
  it('recovers the mean of a normal sample and is seed-reproducible', async () => {
    // Ground truth: y ~ N(5, 1), n = 100 → posterior mean of μ ≈ 5.
    const rand = mulberry32(77);
    const y: number[] = [];
    for (let i = 0; i < 100; i += 1) {
      let u1 = rand();
      while (u1 <= 0) u1 = rand();
      y.push(5 + Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rand()));
    }
    const logPost = (theta: number[]) => {
      let s = 0;
      for (const v of y) s += (v - theta[0]!) * (v - theta[0]!);
      return -s * 0.5;
    };
    const opts = { iters: 4000, burnIn: 1000, seed: 21 } as const;
    const a = await metropolisHastings(logPost, [0], opts);
    const b = await metropolisHastings(logPost, [0], opts);
    expect(b.samples[0]![10]).toBe(a.samples[0]![10]);
    expect(a.acceptanceRate).toBeGreaterThan(0.1);
    const mean = a.samples[0]!.reduce((s, v) => s + v, 0) / a.samples[0]!.length;
    expect(mean).toBeGreaterThan(4.8);
    expect(mean).toBeLessThan(5.2);
  });

  it('keeps partial samples when cancelled and reports cancelled=true', async () => {
    const logPost = (theta: number[]) => -theta[0]! * theta[0]!; // N(0, 1/√2)
    let checks = 0;
    const r = await metropolisHastings(logPost, [0], {
      iters: 5000,
      burnIn: 500,
      seed: 2,
      batchSize: 500,
      shouldCancel: () => {
        checks += 1;
        return checks >= 3; // cancel at the third batch boundary
      },
    });
    expect(r.cancelled).toBe(true);
    expect(r.samples[0]!.length).toBeGreaterThan(0);
    expect(r.samples[0]!.length).toBeLessThan(4500);
  });

  it('rejects a non-finite initial log-posterior', async () => {
    await expect(
      metropolisHastings(() => NaN, [1]),
    ).rejects.toThrow();
  });
});
