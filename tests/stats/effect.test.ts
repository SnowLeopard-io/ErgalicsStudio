import { describe, it, expect } from 'vitest';
import { cohensD, pearson, spearman } from '@/core/stats/effect';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('stats/effect — effect sizes & correlation', () => {
  it("Cohen's d for two equal-variance groups", () => {
    // A mean 5, B mean 4, pooled sd ≈ 2.58199 → d ≈ 0.38730
    const d = cohensD([2, 4, 6, 8], [1, 3, 5, 7]);
    expect(close(d, 0.3873, 1e-3)).toBe(true);
  });

  it('Pearson r is +1 / -1 for perfect linear relationships', () => {
    expect(close(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1, 1e-9)).toBe(true);
    expect(close(pearson([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), -1, 1e-9)).toBe(true);
  });

  it('Spearman equals Pearson of the ranks', () => {
    expect(close(spearman([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]), 1, 1e-9)).toBe(true);
    // monotonic but non-linear still yields r = 1
    expect(close(spearman([1, 2, 3, 4], [1, 4, 9, 16]), 1, 1e-9)).toBe(true);
  });
});
