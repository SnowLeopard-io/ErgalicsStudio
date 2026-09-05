import { describe, it, expect } from 'vitest';
import { mean, variance, std, median, quantile, summary, meanCI } from '@/core/stats/descriptive';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('stats/descriptive', () => {
  it('mean / variance / std', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(close(variance([2, 4, 4, 4, 5, 5, 7, 9], true), 32 / 7, 1e-9)).toBe(true);
    expect(close(std([2, 4, 4, 4, 5, 5, 7, 9], true), Math.sqrt(32 / 7), 1e-9)).toBe(true);
  });

  it('median and quantile (linear interpolation)', () => {
    expect(median([1, 2, 3, 4, 5])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
  });

  it('summary five-number + mean/std', () => {
    const s = summary([1, 2, 3, 4, 5]);
    expect(s.n).toBe(5);
    expect(s.mean).toBe(3);
    expect(s.median).toBe(3);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(close(s.q1, 2, 1e-9)).toBe(true);
    expect(close(s.q3, 4, 1e-9)).toBe(true);
  });

  it('meanCI (t-based) contains the mean and has the right width', () => {
    const ci = meanCI([1, 2, 3, 4, 5], 0.95);
    expect(ci[0]! < 3 && 3 < ci[1]!).toBe(true);
    // t(0.975,4)=2.776445; s=sqrt(2.5); se=sqrt(2.5/5); width = 2*t*se ≈ 3.925
    expect(close(ci[1]! - ci[0]!, 2 * 2.776445 * Math.sqrt(2.5 / 5), 1e-3)).toBe(true);
  });
});
