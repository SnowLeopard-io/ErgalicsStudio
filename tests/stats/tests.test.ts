import { describe, it, expect } from 'vitest';
import {
  tTestOneSample,
  tTestTwoSample,
  tTestPaired,
  anovaOneWay,
  mannWhitney,
  chiSquareIndependence,
} from '@/core/stats/tests';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('stats/tests — hypothesis tests', () => {
  it('one-sample t-test against the sample mean is t=0, p=1', () => {
    const r = tTestOneSample([1, 2, 3, 4, 5], 3);
    expect(close(r.statistic, 0, 1e-9)).toBe(true);
    expect(close(r.pValue, 1, 1e-9)).toBe(true);
    expect(r.df).toBe(4);
  });

  it('Welch two-sample t-test (scipy-style example)', () => {
    const r = tTestTwoSample([1, 2, 3, 4, 5], [2, 3, 4, 5, 6]);
    expect(close(r.statistic, -1, 1e-9)).toBe(true);
    expect(r.df).toBe(8);
    // two-sided p for t=1, df=8 is ~0.346
    expect(close(r.pValue, 0.3461, 2e-3)).toBe(true);
  });

  it('paired t-test reduces to a difference-score one-sample test', () => {
    const a = [10, 20, 30, 40, 50];
    const b = [8, 19, 28, 39, 49];
    const paired = tTestPaired(a, b);
    const one = tTestOneSample(a.map((v, i) => v - b[i]!), 0);
    expect(close(paired.statistic, one.statistic, 1e-9)).toBe(true);
    expect(close(paired.pValue, one.pValue, 1e-9)).toBe(true);
  });

  it('one-way ANOVA F = 3.0 for the classic 3-group example', () => {
    const r = anovaOneWay([
      [1, 2, 3],
      [2, 3, 4],
      [3, 4, 5],
    ]);
    expect(close(r.statistic, 3.0, 1e-9)).toBe(true);
    expect(r.df).toEqual([2, 6]);
  });

  it('chi-square independence: [[10,10],[10,30]] gives chi2 = 3.75', () => {
    const r = chiSquareIndependence([
      [10, 10],
      [10, 30],
    ]);
    expect(close(r.statistic, 3.75, 1e-9)).toBe(true);
    expect(r.df).toBe(1);
    expect(close(r.pValue, 0.0528, 3e-3)).toBe(true);
  });

  it('Mann-Whitney U = 0 when all of group A rank below group B', () => {
    const r = mannWhitney([1, 2, 3], [4, 5, 6]);
    expect(r.u).toBe(0);
    expect(close(r.pValue, 0.0808, 5e-3)).toBe(true);
  });

  it('Mann-Whitney on identical groups gives p = 1', () => {
    const r = mannWhitney([1, 2, 3], [1, 2, 3]);
    expect(close(r.u, 4.5, 1e-9)).toBe(true);
    expect(close(r.pValue, 1, 1e-9)).toBe(true);
  });
});
