import { describe, it, expect } from 'vitest';
import { pearson } from '@ergalics/sci-kernels/stats/effect';

describe('pearson 在大偏移/缩放下的稳定性', () => {
  it('is exactly 1 for a perfectly linear pair', () => {
    const x = [1, 2, 3, 4, 5, 6];
    const y = x.map((v) => 2 * v);
    expect(pearson(x, y)).toBeCloseTo(1, 12);
  });

  it('survives a large offset and mixed scale', () => {
    const x = [1, 2, 3, 4, 5, 6];
    const y = x.map((v) => 2 * v);
    const xs = x.map((v) => v * 1e6 + 1e9);
    const ys = y.map((v) => v * 1e3 - 2e9);
    expect(pearson(xs, ys)).toBeCloseTo(1, 10);
  });

  it('returns 0 for a constant series instead of NaN', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0);
  });

  it('is symmetric under swapping the inputs', () => {
    const a = [3, 1, 4, 1, 5, 9];
    const b = [2, 7, 1, 8, 2, 8];
    expect(pearson(a, b)).toBeCloseTo(pearson(b, a), 12);
  });
});
