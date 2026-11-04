// math-dist kernel tests — special functions, pdf/cdf/quantile, sampling, MLE, benchmarks
import { describe, it, expect } from 'vitest';
import {
  allDefaultParams,
  DISTS,
  distCdf,
  distPdf,
  distQuantile,
  getDist,
  histogramBars,
  logGamma,
  mleFit,
  normalCdf,
  normalPpf,
  regularizedBetaI,
  runDistBenchmarks,
  sampleDist,
  summarize,
  SAMPLE_DATASETS,
  DIST_BENCHMARK_ID,
  type DistId,
} from '../src/plugins/builtin/math/dist/kernel';

describe('special functions', () => {
  it('logGamma matches the factorial / known values', () => {
    expect(logGamma(1)).toBeCloseTo(0, 12);
    expect(logGamma(2)).toBeCloseTo(0, 12);
    expect(Math.exp(logGamma(5))).toBeCloseTo(24, 9); // Γ(5) = 4!
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
  });

  it('normalCdf / normalPpf are inverse at tabulated points', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 12);
    expect(normalCdf(1.959963984540054)).toBeCloseTo(0.975, 12);
    expect(normalPpf(0.975)).toBeCloseTo(1.959963984540054, 9);
    expect(normalPpf(0.5)).toBeCloseTo(0, 12);
    for (const q of [0.01, 0.25, 0.5, 0.75, 0.99]) {
      expect(normalCdf(normalPpf(q))).toBeCloseTo(q, 9);
    }
    // far-tail round-trip through the r > 5 branch of AS241
    expect(normalCdf(normalPpf(1e-12)) / 1e-12).toBeCloseTo(1, 6);
  });

  it('regularizedBetaI matches closed forms', () => {
    expect(regularizedBetaI(0.5, 1, 1)).toBeCloseTo(0.5, 12); // uniform
    expect(regularizedBetaI(0.5, 2, 2)).toBeCloseTo(0.5, 12); // symmetric
    // I_x(1, b) = 1 − (1 − x)^b
    expect(regularizedBetaI(0.3, 1, 3)).toBeCloseTo(1 - Math.pow(0.7, 3), 12);
  });
});

describe('pdf / cdf / quantile of the ten families', () => {
  it('every family exposes positive density and a sane x window', () => {
    expect(DISTS).toHaveLength(10);
    expect(DISTS.map((d) => d.id)).toEqual([
      'normal',
      'poisson',
      'exponential',
      'beta',
      'gamma',
      't',
      'chisq',
      'f',
      'binomial',
      'geometric',
    ]);
    for (const def of DISTS) {
      const p = allDefaultParams();
      const [lo, hi] = [distQuantile(def.id, p, 0.25), distQuantile(def.id, p, 0.75)];
      expect(hi, def.id).toBeGreaterThan(lo);
      const mid = (lo + hi) / 2;
      const y = distPdf(def.id, p, mid);
      expect(Number.isFinite(y), def.id).toBe(true);
      expect(y, def.id).toBeGreaterThanOrEqual(0);
      const c = distCdf(def.id, p, mid);
      expect(c, def.id).toBeGreaterThanOrEqual(0);
      expect(c, def.id).toBeLessThanOrEqual(1);
    }
  });

  it('closed-form checks: normal pdf, exponential cdf, binomial pmf', () => {
    const p = allDefaultParams();
    // N(0, 1) pdf at 0 = 1/√(2π)
    expect(distPdf('normal', p, 0)).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 12);
    // Exp(1) cdf at 1 = 1 − e⁻¹
    expect(distCdf('exponential', { ...p, expLambda: 1 }, 1)).toBeCloseTo(1 - Math.exp(-1), 12);
    // Bin(5, 0.5) pmf at 2 = 10/32
    expect(distPdf('binomial', { ...p, binomN: 5, binomP: 0.5 }, 2)).toBeCloseTo(10 / 32, 12);
  });

  it('quantile inverts the cdf on the bulk for every family', () => {
    for (const def of DISTS) {
      const p = allDefaultParams();
      for (const q of [0.1, 0.5, 0.9]) {
        const x = distQuantile(def.id, p, q);
        expect(Number.isFinite(x), def.id).toBe(true);
        // continuous families invert tightly; discrete families land on the step
        const back = distCdf(def.id, p, x);
        expect(Math.abs(back - q), `${def.id}@${q}`).toBeLessThan(def.kind === 'discrete' ? 0.5 : 1e-6);
      }
    }
  });

  it('cdf is non-decreasing on a quantile grid', () => {
    for (const def of DISTS) {
      const p = allDefaultParams();
      const lo = distQuantile(def.id, p, 0.001);
      const hi = distQuantile(def.id, p, 0.999);
      let prev = -Infinity;
      for (let i = 0; i <= 40; i += 1) {
        const c = distCdf(def.id, p, lo + ((hi - lo) * i) / 40);
        expect(c, def.id).toBeGreaterThanOrEqual(prev - 1e-12);
        prev = c;
      }
    }
  });
});

describe('reproducible sampling and datasets', () => {
  it('a fixed seed yields an identical sample every time', () => {
    const a = sampleDist('normal', { normalMu: 2, normalSigma: 3 }, 500, 7);
    const b = sampleDist('normal', { normalMu: 2, normalSigma: 3 }, 500, 7);
    expect(a).toEqual(b);
    const c = sampleDist('normal', { normalMu: 2, normalSigma: 3 }, 500, 8);
    expect(c).not.toEqual(a);
  });

  it('sample moments track the theory within Monte-Carlo noise', () => {
    const s = summarize(sampleDist('exponential', { expLambda: 0.5 }, 6000, 42));
    expect(s.n).toBe(6000);
    expect(Math.abs(s.mean - 2) / 2).toBeLessThan(0.05);
    expect(Math.abs(s.sd - 2) / 2).toBeLessThan(0.1);
  });

  it('histogramBars returns density-scaled bins that integrate to ~1', () => {
    const vals = sampleDist('normal', { normalMu: 0, normalSigma: 1 }, 4000, 11);
    const bars = histogramBars(vals, -4, 4, 40);
    expect(bars).toHaveLength(40);
    let area = 0;
    for (const b of bars) area += (b.x1 - b.x0) * b.y;
    expect(area).toBeCloseTo(1, 6);
  });

  it('built-in datasets fit their families by MLE near the sample moments', () => {
    expect(SAMPLE_DATASETS).toHaveLength(3);
    for (const ds of SAMPLE_DATASETS) {
      const fit = mleFit(ds.family, ds.values);
      expect(fit, ds.id).not.toBeNull();
      const s = summarize(ds.values);
      if (ds.family === 'normal') {
        expect(fit!.params.normalMu!).toBeCloseTo(s.mean, 10);
        expect(fit!.params.normalSigma!).toBeGreaterThan(0);
        expect(fit!.logLik).toBeLessThan(0);
      } else if (ds.family === 'exponential') {
        expect(fit!.params.expLambda!).toBeCloseTo(1 / s.mean, 10);
      } else if (ds.family === 'poisson') {
        expect(fit!.params.poissonLambda!).toBeCloseTo(s.mean, 10);
      }
    }
  });
});

describe('embedded validation benchmarks', () => {
  it('passes all six distribution benchmarks within the spec tolerances', () => {
    expect(DIST_BENCHMARK_ID).toBe('dist-benchmarks');
    const bench = runDistBenchmarks();
    expect(bench.map((b) => b.id)).toEqual([
      'pdf-unit-integral',
      'normal-quantile',
      'cdf-monotone-range',
      'discrete-pmf-sum',
      'sample-mean-convergence',
      'chi-t-critical',
    ]);
    for (const b of bench) expect(b.passed, b.id).toBe(true);
    const byId = new Map(bench.map((b) => [b.id, b]));
    expect(byId.get('pdf-unit-integral')!.relErr).toBeLessThan(1e-6);
    expect(byId.get('normal-quantile')!.relErr).toBeLessThan(1e-9);
    expect(byId.get('cdf-monotone-range')!.relErr).toBeLessThan(1e-12);
    expect(byId.get('discrete-pmf-sum')!.relErr).toBeLessThan(1e-10);
    expect(byId.get('sample-mean-convergence')!.relErr).toBeLessThan(0.05);
    expect(byId.get('chi-t-critical')!.relErr).toBeLessThan(1e-9);
  });

  it('every benchmark carries bilingual labels and a detail note', () => {
    for (const b of runDistBenchmarks()) {
      expect(b.labelZh.length, b.id).toBeGreaterThan(0);
      expect(b.labelEn.length, b.id).toBeGreaterThan(0);
      expect(b.detailZh.length, b.id).toBeGreaterThan(0);
      expect(b.detailEn.length, b.id).toBeGreaterThan(0);
      expect(Number.isFinite(b.relErr), b.id).toBe(true);
      expect(b.relErr, b.id).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('getDist lookup', () => {
  it('resolves each registered id and rejects unknown ids at runtime', () => {
    for (const def of DISTS) expect(getDist(def.id)).toBe(def);
    expect(() => getDist('nope' as DistId)).toThrow();
  });
});
