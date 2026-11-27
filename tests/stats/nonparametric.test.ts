import { describe, expect, it } from 'vitest';
import { dunnPostHoc, kruskalWallis } from '@ergalics/sci-kernels/stats/nonparametric';

describe('stats/nonparametric — Kruskal–Wallis', () => {
  it('computes H on completely separated groups', () => {
    const groups = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];
    const result = kruskalWallis(groups);
    expect(result.n).toBe(9);
    expect(result.df).toBe(2);
    // No ties: H = 12/(N(N+1)) * Σ n_i R̄_i² − 3(N+1)
    expect(result.H).toBeCloseTo(7.2, 10);
    expect(result.tied).toBe(false);
    expect(result.pValue).toBeCloseTo(0.0273, 3);
    expect(result.epsilonSquared).toBeCloseTo(7.2 / 8, 10);
  });

  it('applies the tie correction', () => {
    const result = kruskalWallis([[1, 2, 2], [2, 3, 4], [4, 4, 5]]);
    expect(result.tied).toBe(true);
    expect(result.H).toBeGreaterThan(0);
    expect(result.pValue).toBeGreaterThanOrEqual(0);
    expect(result.pValue).toBeLessThanOrEqual(1);
  });

  it('rejects empty groups', () => {
    expect(() => kruskalWallis([[1, 2], []])).toThrow();
  });
});

describe('stats/nonparametric — Dunn post-hoc', () => {
  it('compares all pairs and returns corrected p-values', () => {
    const groups = [
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
    ];
    const result = dunnPostHoc(groups, ['a', 'b', 'c']);
    expect(result.comparisons).toHaveLength(3);
    expect(result.correction).toBe('bonferroni');
    for (const c of result.comparisons) {
      expect(c.adjustedP).toBeGreaterThanOrEqual(c.pValue - 1e-12);
      expect(c.z).toBeCloseTo(c.rankDiff / Math.sqrt(result.rankVariance * (1 / 4 + 1 / 4)), 10);
    }
    const ab = result.comparisons[0]!;
    expect(ab.adjustedP).toBeCloseTo(Math.min(1, ab.pValue * 3), 12);
  });

  it('supports Benjamini–Hochberg adjustment', () => {
    const result = dunnPostHoc(
      [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
      ],
      undefined,
      'bh',
    );
    expect(result.correction).toBe('bh');
    expect(result.comparisons.every((c) => c.adjustedP <= 1)).toBe(true);
  });
});
