import { describe, expect, it } from 'vitest';
import { bartlettTest, cronbachAlpha, itemTotalTests, kmo } from '@/core/stats/psychometrics';

describe('stats/psychometrics — Cronbach alpha', () => {
  it('is 1 when every item measures the same thing exactly', () => {
    const items = [
      [1, 1, 1],
      [2, 2, 2],
      [3, 3, 3],
      [4, 4, 4],
      [5, 5, 5],
    ];
    const result = cronbachAlpha(items);
    expect(result.alpha).toBeCloseTo(1, 10);
    expect(result.nItems).toBe(3);
    expect(result.nSubjects).toBe(5);
    expect(result.interpretation).toBe('excellent');
    expect(result.itemTotalCorrelation.every((r) => Math.abs(r - 1) < 1e-10)).toBe(true);
  });

  it('returns alpha-if-deleted and diagnostics for a realistic matrix', () => {
    const items = [
      [4, 3, 5, 2],
      [5, 4, 5, 3],
      [3, 3, 4, 4],
      [4, 4, 4, 3],
      [2, 3, 3, 2],
      [5, 5, 4, 4],
      [3, 2, 3, 1],
      [4, 4, 5, 3],
    ];
    const result = cronbachAlpha(items);
    expect(result.alpha).toBeGreaterThan(0);
    expect(result.alpha).toBeLessThanOrEqual(1);
    expect(result.alphaIfDeleted).toHaveLength(4);
    expect(result.itemTotalCorrelation).toHaveLength(4);
    expect(Number.isFinite(result.meanInterItemCorrelation)).toBe(true);
    const tests = itemTotalTests(items);
    expect(tests).toHaveLength(4);
    expect(tests[0]!.df).toBe(6);
  });

  it('rejects ragged or single-item input', () => {
    expect(() => cronbachAlpha([[1, 2], [3]])).toThrow();
    expect(() => cronbachAlpha([[1], [2]])).toThrow();
  });
});

describe('stats/psychometrics — KMO', () => {
  it('stays in [0, 1] and flags a factorable matrix', () => {
    const items = [
      [1, 2, 5],
      [2, 4, 4],
      [3, 3, 6],
      [4, 6, 5],
      [5, 5, 8],
      [6, 8, 7],
      [7, 7, 9],
      [8, 9, 10],
    ];
    const result = kmo(items);
    expect(result.overall).toBeGreaterThan(0);
    expect(result.overall).toBeLessThanOrEqual(1);
    expect(result.perItem).toHaveLength(3);
    expect(['marvelous', 'meritorious', 'middling', 'mediocre', 'miserable', 'unacceptable']).toContain(
      result.interpretation,
    );
  });

  it('rejects a singular correlation matrix', () => {
    const items = [
      [1, 2, 3],
      [2, 4, 6],
      [3, 6, 9],
      [4, 8, 12],
    ];
    expect(() => kmo(items)).toThrow();
  });
});

describe('stats/psychometrics — Bartlett', () => {
  it('is highly significant for strongly correlated items', () => {
    const items = [
      [1, 1.1, 1.2],
      [2, 1.9, 2.2],
      [3, 3.1, 2.9],
      [4, 4.2, 4.1],
      [5, 4.9, 5.2],
      [6, 6.1, 5.8],
      [7, 7.0, 7.2],
      [8, 7.9, 8.1],
    ];
    const result = bartlettTest(items);
    expect(result.df).toBe(3);
    expect(result.determinant).toBeGreaterThan(0);
    expect(result.chiSquare).toBeGreaterThan(0);
    expect(result.pValue).toBeLessThan(0.001);
  });

  it('is not significant for unrelated items', () => {
    const items = [
      [1, 5, 2],
      [4, 1, 8],
      [7, 3, 1],
      [2, 9, 4],
      [8, 2, 9],
      [3, 7, 5],
      [6, 4, 3],
      [9, 8, 7],
      [5, 6, 6],
      [2, 1, 10],
    ];
    const result = bartlettTest(items);
    expect(result.pValue).toBeGreaterThan(0.05);
  });
});
