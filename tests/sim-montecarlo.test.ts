// sim-montecarlo kernel tests — distributions, samplers, copula, evaluator,
// statistics, convergence diagnostics and sensitivity.
import { describe, expect, it } from 'vitest';
import {
  applyGaussianCopula,
  createRng,
  distributionMean,
  distributionStd,
  evalRpn,
  gelmanRubin,
  histogram,
  mean,
  normalInvCdf,
  parseCorrMatrix,
  parseExpression,
  parseInputsTable,
  percentileSorted,
  rankCorrelation,
  runMonteCarlo,
  sampleDistribution,
  sampleLhs,
  sampleRandom,
  sampleSobol,
  std,
  summarize,
  variance,
} from '@/plugins/builtin/sim/montecarlo/kernel';

const N = 50000;

describe('distributions', () => {
  const sample = (spec: Parameters<typeof sampleDistribution>[0]) => {
    const rng = createRng(12345);
    const out: number[] = [];
    for (let i = 0; i < N; i++) out.push(sampleDistribution(spec, rng.next()));
    return out;
  };

  it('uniform matches analytic moments', () => {
    const xs = sample({ dist: 'uniform', params: [2, 6] });
    expect(Math.abs(mean(xs) - 4)).toBeLessThan(0.05);
    expect(Math.abs(std(xs) - 4 / Math.sqrt(12))).toBeLessThan(0.02);
  });

  it('normal matches analytic moments', () => {
    const xs = sample({ dist: 'normal', params: [10, 3] });
    expect(Math.abs(mean(xs) - 10)).toBeLessThan(0.1);
    expect(Math.abs(std(xs) - 3)).toBeLessThan(0.05);
  });

  it('triangular matches analytic mean', () => {
    const xs = sample({ dist: 'triangular', params: [0, 3, 5] });
    expect(Math.abs(mean(xs) - 8 / 3)).toBeLessThan(0.05);
  });

  it('pert stays within support and near PERT mean', () => {
    const xs = sample({ dist: 'pert', params: [1, 2, 10, 4] });
    const expected = (1 + 4 * 2 + 10) / 6;
    for (const v of xs) {
      expect(v).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(v).toBeLessThanOrEqual(10 + 1e-9);
    }
    expect(Math.abs(mean(xs) - expected)).toBeLessThan(0.08);
  });

  it('beta stays in (0,1) with correct mean', () => {
    const xs = sample({ dist: 'beta', params: [2, 5] });
    for (const v of xs) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
    expect(Math.abs(mean(xs) - 2 / 7)).toBeLessThan(0.01);
  });

  it('empirical samples only from the provided support', () => {
    const xs = sample({ dist: 'empirical', params: [], samples: [1, 2, 3] });
    for (const v of xs) expect([1, 2, 3]).toContain(v);
  });

  it('analytic mean/std helpers agree with sampled moments', () => {
    const spec: import('@/plugins/builtin/sim/montecarlo/kernel').DistributionSpec = { dist: 'normal', params: [5, 2] };
    const xs = sample(spec);
    expect(Math.abs(distributionMean(spec) - mean(xs))).toBeLessThan(0.1);
    expect(Math.abs(distributionStd(spec) - std(xs))).toBeLessThan(0.1);
  });
});

describe('samplers', () => {
  it('LHS places exactly one sample per stratum per column', () => {
    const u = sampleLhs(100, 3, createRng(7));
    for (let j = 0; j < 3; j++) {
      const seen = new Set(u.map((r) => Math.floor(r[j]! * 100)));
      expect(seen.size).toBe(100);
    }
  });

  it('Sobol first dimension starts 0, 1/2, 3/4, 1/4 (van der Corput)', () => {
    const u = sampleSobol(4, 2);
    expect(u[0]![0]).toBe(0);
    expect(u[1]![0]).toBe(0.5);
    expect(u[2]![0]).toBe(0.75);
    expect(u[3]![0]).toBe(0.25);
  });

  it('Sobol is a dyadic net: first 64 points stratify 64 cells per dim', () => {
    const u = sampleSobol(64, 4);
    for (let d = 0; d < 4; d++) {
      const seen = new Set(u.map((r) => Math.floor(r[d]! * 64)));
      expect(seen.size).toBe(64);
    }
  });

  it('Sobol marginals have low discrepancy vs simple random', () => {
    const s = sampleSobol(1024, 2);
    const r = sampleRandom(1024, 2, createRng(1));
    const disc = (pts: number[][]) => {
      // star discrepancy proxy: max cell-count deviation on a 16x16 grid
      const grid = new Array(256).fill(0);
      for (const p of pts) {
        const cx = Math.min(15, Math.floor(p[0]! * 16));
        const cy = Math.min(15, Math.floor(p[1]! * 16));
        grid[cy * 16 + cx]!++;
      }
      return Math.max(...grid.map((c) => Math.abs(c - 4)));
    };
    expect(disc(s)).toBeLessThanOrEqual(disc(r));
  });
});

describe('gaussian copula', () => {
  it('achieves the target rank correlation', () => {
    const u = sampleRandom(8000, 2, createRng(3));
    const c = applyGaussianCopula(u, [[1, 0.8], [0.8, 1]]);
    expect(Math.abs(rankCorrelation(c.map((r) => r[0]!), c.map((r) => r[1]!)) - 0.8)).toBeLessThan(0.1);
  });

  it('marginals remain uniforms in (0,1)', () => {
    const u = sampleRandom(2000, 2, createRng(4));
    const c = applyGaussianCopula(u, [[1, 0.5], [0.5, 1]]);
    for (const row of c) {
      expect(row[0]).toBeGreaterThanOrEqual(0);
      expect(row[0]).toBeLessThanOrEqual(1);
      expect(row[1]).toBeGreaterThanOrEqual(0);
      expect(row[1]).toBeLessThanOrEqual(1);
    }
  });
});

describe('expression evaluator', () => {
  it('respects operator precedence and unary minus', () => {
    const rpn = parseExpression('-2 + 3 * 4 ^ 2', []);
    expect(evalRpn(rpn, {})).toBe(46);
  });

  it('evaluates parentheses, functions and identifiers', () => {
    const rpn = parseExpression('max(a, b) * sqrt(a^2 + b^2)', ['a', 'b']);
    expect(evalRpn(rpn, { a: 3, b: 4 })).toBe(4 * 5);
    expect(evalRpn(rpn, { a: -3, b: 4 })).toBe(4 * 5);
  });

  it('rejects unknown identifiers', () => {
    expect(() => parseExpression('a + zzz', ['a'])).toThrow(/Unknown identifier/);
  });

  it('rejects unbalanced parentheses', () => {
    expect(() => parseExpression('(a + b', ['a', 'b'])).toThrow();
  });
});

describe('statistics', () => {
  it('percentiles interpolate linearly', () => {
    const sorted = [0, 10, 20, 30];
    expect(percentileSorted(sorted, 0.5)).toBe(15);
    expect(percentileSorted(sorted, 0.25)).toBe(7.5);
  });

  it('sample variance uses the n-1 estimator', () => {
    expect(variance([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(4.5714286, 5);
  });

  it('confidence interval brackets the true mean', () => {
    const rng = createRng(11);
    const xs: number[] = [];
    for (let i = 0; i < 5000; i++) xs.push(rng.next());
    const s = summarize(xs);
    expect(s.ci95Lo).toBeLessThan(0.5);
    expect(s.ci95Hi).toBeGreaterThan(0.5);
  });

  it('histogram counts sum to n', () => {
    const h = histogram([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(h.binEdges).toHaveLength(6);
  });
});

describe('convergence diagnostics', () => {
  it('Gelman-Rubin is ~1 for identical-distribution chains', () => {
    const chains = [1, 2, 3].map((c) => {
      const rng = createRng(100 + c);
      return Array.from({ length: 2000 }, () => rng.next());
    });
    expect(gelmanRubin(chains)).toBeLessThan(1.02);
  });

  it('Gelman-Rubin exceeds 1.1 for shifted chains', () => {
    const mk = (shift: number) => Array.from({ length: 1000 }, (_, i) => shift + i * 1e-6);
    expect(gelmanRubin([mk(0), mk(10)])).toBeGreaterThan(1.1);
  });

  it('returns 1 for a single chain (degenerate input)', () => {
    expect(gelmanRubin([[1, 2, 3]])).toBe(1);
  });
});

describe('sensitivity', () => {
  it('ranks the dominant input first in the tornado and detects rank correlation sign', () => {
    const res = runMonteCarlo({
      inputs: [
        { name: 'big', spec: { dist: 'uniform', params: [0, 100] } },
        { name: 'small', spec: { dist: 'uniform', params: [0, 1] } },
      ],
      expression: 'big * 10 + small',
      n: 4000,
      sampler: 'random',
      seed: 9,
      chains: 0,
      computeSensitivity: true,
    });
    expect(res.tornado[0]!.name).toBe('big');
    expect(Math.abs(res.correlations[0]!.spearman - 1)).toBeLessThan(0.02);
    expect(Math.abs(res.correlations[1]!.spearman)).toBeLessThan(0.1);
  });
});

describe('end-to-end determinism and table parsing', () => {
  const opts: import('@/plugins/builtin/sim/montecarlo/kernel').McRunOptions = {
    inputs: [
      { name: 'a', spec: { dist: 'normal', params: [5, 2] } },
      { name: 'b', spec: { dist: 'uniform', params: [0, 3] } },
    ],
    expression: 'a * b + 1',
    n: 3000,
    sampler: 'lhs' as const,
    seed: 77,
    chains: 2,
    computeSensitivity: true,
  };

  it('same seed reproduces identical results', () => {
    const r1 = runMonteCarlo(opts);
    const r2 = runMonteCarlo(opts);
    expect(r1.stats.mean).toBe(r2.stats.mean);
    expect(r1.outputs.slice(0, 10)).toEqual(r2.outputs.slice(0, 10));
    expect(r1.rhat).toBeCloseTo(r2.rhat ?? 0, 12);
  });

  it('model mean matches closed form within sampling error', () => {
    const r = runMonteCarlo(opts);
    // E[a*b+1] = 5 * 1.5 + 1 = 8.5
    expect(Math.abs(r.stats.mean - 8.5)).toBeLessThan(0.2);
  });

  it('parses the inputs table incl. empirical variables', () => {
    const vars = parseInputsTable('x,normal,0,1\ny,empirical,1;2;3;4');
    expect(vars).toHaveLength(2);
    expect(vars[1]!.spec.dist).toBe('empirical');
    expect(vars[1]!.spec.samples).toEqual([1, 2, 3, 4]);
  });

  it('rejects duplicate names and bad distributions', () => {
    expect(() => parseInputsTable('x,uniform,0,1\nx,normal,0,1')).toThrow(/Duplicate/);
    expect(() => parseInputsTable('x,bogus,0,1')).toThrow(/Unknown distribution/);
  });

  it('validates the correlation matrix', () => {
    expect(parseCorrMatrix('1 0.5\n0.5 1', 2)).toEqual([[1, 0.5], [0.5, 1]]);
    expect(() => parseCorrMatrix('1 0.5\n0.4 1', 2)).toThrow(/symmetric/);
    expect(() => parseCorrMatrix('1 2\n2 1', 2)).toThrow(/\[-1, 1\]/);
  });

  it('normalInvCdf is the inverse of the normal CDF', () => {
    expect(normalInvCdf(0.5)).toBeCloseTo(0, 6);
    expect(normalInvCdf(0.975)).toBeCloseTo(1.959964, 3);
    expect(normalInvCdf(0.025)).toBeCloseTo(-1.959964, 3);
  });

  it('chain running means are returned for chains >= 2', () => {
    const r = runMonteCarlo(opts);
    expect(r.chainRunningMeans).not.toBeNull();
    expect(r.chainRunningMeans!.length).toBe(2);
    expect(r.chainRunningMeans![0]).toHaveLength(opts.n);
  });
});
