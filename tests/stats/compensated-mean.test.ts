import { describe, it, expect } from 'vitest';
import { mean, variance } from '@ergalics/sci-kernels/stats/descriptive';
import { compensatedSum } from '@ergalics/sci-kernels/stats/sum';

describe('compensated summation', () => {
  it('keeps the digits a naive loop throws away', () => {
    expect(compensatedSum([1e16, 1, -1e16, 1])).toBe(2);
    let naive = 0;
    for (const v of [1e16, 1, -1e16, 1]) naive += v;
    expect(naive).toBe(1); // 丢掉了两个 1
  });

  it('matches an exact integer sum', () => {
    const xs = Array.from({ length: 1000 }, (_, i) => (i % 7) - 3);
    expect(compensatedSum(xs)).toBe(xs.reduce((a, b) => a + b, 0));
  });

  it('propagates NaN instead of dropping it', () => {
    expect(compensatedSum([1, Number.NaN, 3])).toBeNaN();
  });
});

describe('mean uses compensated summation', () => {
  it('survives catastrophic cancellation', () => {
    expect(mean([1e16, 1, -1e16, 1])).toBe(0.5);
  });

  it('is invariant under a large offset', () => {
    const base = [1, 2, 3, 4, 5];
    const shifted = base.map((v) => v + 1e9);
    expect(variance(shifted)).toBeCloseTo(variance(base), 10);
  });
});
