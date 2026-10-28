import { describe, expect, it } from 'vitest';
import {
  BIMODAL_SIGMA,
  clampParam,
  histogram,
  jarqueBera,
  normalPdf,
  relErr,
  runClt,
  runCltBenchmark,
  sampleOne,
  sampleStats,
  standardized,
  theoryMoments,
  type PopulationSpec,
} from '../src/plugins/builtin/math/clt/kernel';

describe('stats-clt closed-form population moments', () => {
  it('uniform U[0,w] has mean w/2 and variance w²/12', () => {
    const m = theoryMoments({ kind: 'uniform', param: 2 });
    expect(m.mean).toBeCloseTo(1, 12);
    expect(m.variance).toBeCloseTo(4 / 12, 12);
    expect(m.skewness).toBe(0);
  });

  it('exponential(λ) has mean 1/λ, variance 1/λ² and skewness exactly 2', () => {
    const m = theoryMoments({ kind: 'exponential', param: 0.5 });
    expect(m.mean).toBeCloseTo(2, 12);
    expect(m.variance).toBeCloseTo(4, 12);
    expect(m.skewness).toBe(2);
  });

  it('bernoulli(p) and bimodal(d) moments match their closed forms', () => {
    const b = theoryMoments({ kind: 'bernoulli', param: 0.3 });
    expect(b.mean).toBeCloseTo(0.3, 12);
    expect(b.variance).toBeCloseTo(0.21, 12);
    expect(b.skewness).toBeCloseTo((1 - 0.6) / Math.sqrt(0.21), 12);

    const bm = theoryMoments({ kind: 'bimodal', param: 1 });
    expect(bm.mean).toBe(0);
    expect(bm.variance).toBeCloseTo(1 + BIMODAL_SIGMA * BIMODAL_SIGMA, 12);
    expect(bm.skewness).toBe(0);
  });

  it('truncated Pareto α=2: mean ≈ 1.9050, second moment uses the k=α log branch', () => {
    const m = theoryMoments({ kind: 'pareto', param: 2 });
    // E[X] = 2·(20^-1 − 1) / ((1−2)(1−20^-2)) = 1.9050…, E[X²] = 2·ln20/(1−20^-2)
    const c = 1 - Math.pow(20, -2);
    const e1 = (2 * (Math.pow(20, -1) - 1)) / ((1 - 2) * c);
    const e2 = (2 * Math.log(20)) / c;
    expect(m.mean).toBeCloseTo(e1, 12);
    expect(m.variance).toBeCloseTo(e2 - e1 * e1, 12);
    expect(m.skewness).toBeGreaterThan(0);
  });

  it('clamps family parameters into their valid ranges', () => {
    expect(clampParam('uniform', 0.01)).toBe(0.1);
    expect(clampParam('uniform', 99)).toBe(5);
    expect(clampParam('bernoulli', 3)).toBe(0.95);
    expect(clampParam('pareto', 1)).toBe(1.1);
  });
});

describe('stats-clt sampling & statistics', () => {
  it('sampleOne is deterministic and stays inside population support', () => {
    let seed = 12345;
    const next = (): number => {
      // simple deterministic LCG so the test does not depend on mulberry32 here
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 2000; i += 1) {
      const u = sampleOne(next, { kind: 'uniform', param: 2 });
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(2);
    }
  });

  it('sampleStats matches hand-computed central moments on a fixed array', () => {
    const xs = Float64Array.from([0, 0, 0, 4]);
    const s = sampleStats(xs);
    expect(s.mean).toBeCloseTo(1, 12);
    expect(s.variance).toBeCloseTo(3, 12);
    // m3 = (1+1+1+27)/4 = 6, sd³ = 3√3 → skew = 2/√3
    expect(s.skewness).toBeCloseTo(2 / Math.sqrt(3), 12);
    // m4 = (1+1+1+81)/4 = 21, m2² = 9 → kurtosis = 7/3
    expect(s.kurtosis).toBeCloseTo(7 / 3, 12);
  });

  it('histogram conserves the count and bins the observed range', () => {
    const res = runClt({ kind: 'uniform', param: 2 }, 30, 5000, 7);
    const h = histogram(res.means, 60);
    expect(h.centers).toHaveLength(60);
    expect(h.counts.reduce((a, v) => a + v, 0)).toBe(5000);
    expect(h.min).toBeLessThanOrEqual(h.centers[0]!);
    expect(h.max).toBeGreaterThanOrEqual(h.centers[59]!);
    // zero-inflated degenerate input still yields a valid histogram
    const deg = histogram(Float64Array.from([3, 3, 3]), 10);
    expect(deg.counts.reduce((a, v) => a + v, 0)).toBe(3);
  });

  it('runClt is reproducible for a fixed seed and changes with the seed', () => {
    const a = runClt({ kind: 'exponential', param: 1 }, 10, 2000, 20261011);
    const b = runClt({ kind: 'exponential', param: 1 }, 10, 2000, 20261011);
    expect(a.means).toEqual(b.means);
    const c = runClt({ kind: 'exponential', param: 1 }, 10, 2000, 20261012);
    expect(a.means).not.toEqual(c.means);
  });

  it('standardized means have zero mean and unit variance', () => {
    const res = runClt({ kind: 'uniform', param: 2 }, 30, 20000, 42);
    const std = standardized(res.means, res.theory.mean, Math.sqrt(res.theory.variance), 30);
    const s = sampleStats(std);
    // the standardized mean is itself random (SE ≈ 1/√m), only unit variance
    // holds to sampling accuracy
    expect(Math.abs(s.mean)).toBeLessThan(0.02);
    expect(relErr(s.variance, 1)).toBeLessThan(0.02);
  });

  it('normal pdf peaks at 1/(σ√2π)', () => {
    expect(normalPdf(0, 0, 1)).toBeCloseTo(0.3989422804014327, 12);
    expect(normalPdf(2, 2, 3)).toBeCloseTo(1 / (3 * Math.sqrt(2 * Math.PI)), 12);
  });

  it('jarque-bera vanishes for an exactly normal shape statistic', () => {
    const normal: ReturnType<typeof sampleStats> = { mean: 0, variance: 1, skewness: 0, kurtosis: 3 };
    expect(jarqueBera(normal, 50000)).toBe(0);
  });
});

describe('stats-clt embedded benchmarks (research acceptance)', () => {
  const bench = runCltBenchmark();

  it('① uniform U[0,2], n=30, m=50000: mean & variance of the mean-distribution within 2% relative error', () => {
    expect(bench.uniformMeanTheory).toBeCloseTo(1, 12);
    expect(bench.uniformVarTheory).toBeCloseTo(1 / 90, 12);
    expect(bench.uniformRelErrMean).toBeLessThan(0.02);
    expect(bench.uniformRelErrVar).toBeLessThan(0.02);
  });

  it('② standardized mean distribution is Gaussian-shaped: |skew| < 0.1, |kurtosis−3| < 0.2', () => {
    expect(Math.abs(bench.standardizedSkewness)).toBeLessThan(0.1);
    expect(Math.abs(bench.standardizedKurtosis - 3)).toBeLessThan(0.2);
  });

  it('③ exponential population at n=1: skewness of the mean distribution within 10% of the exact 2', () => {
    expect(bench.exponentialSkewTheory).toBe(2);
    expect(bench.exponentialRelErr).toBeLessThan(0.10);
  });

  it('benchmark is deterministic for the default seed', () => {
    const again = runCltBenchmark();
    expect(again.uniformRelErrMean).toBe(bench.uniformRelErrMean);
    expect(again.exponentialSkewness).toBe(bench.exponentialSkewness);
  });
});

describe('stats-clt truncated Pareto empirical moments', () => {
  it('empirical mean of 200k truncated Pareto(α=2) draws matches theory within 2%', () => {
    const spec: PopulationSpec = { kind: 'pareto', param: 2 };
    const res = runClt(spec, 1, 200000, 777);
    expect(relErr(res.stats.mean, res.theory.mean)).toBeLessThan(0.02);
    expect(relErr(res.stats.variance, res.theory.variance)).toBeLessThan(0.04);
  });
});
