import { describe, expect, it } from 'vitest';
import { kaplanMeier, logRankTest, survivalAt } from '@ergalics/sci-kernels/stats/survival';

describe('stats/survival — Kaplan–Meier', () => {
  it('computes the product-limit curve and median', () => {
    const km = kaplanMeier([1, 2, 3, 4], [true, true, true, true]);
    // S after each event: 0.75, 0.5, 0.25, 0.
    expect(km.curve.map((p) => p.survival)).toEqual([1, 0.75, 0.5, 0.25, 0]);
    expect(km.curve.map((p) => p.nAtRisk)).toEqual([4, 4, 3, 2, 1]);
    expect(km.median).toBe(2);
    expect(km.events).toBe(4);
    expect(km.censored).toBe(0);
    expect(survivalAt(km.curve, 0.5)).toBe(1);
    expect(survivalAt(km.curve, 2.5)).toBe(0.5);
  });

  it('treats censoring as surviving past the time', () => {
    const km = kaplanMeier([1, 2, 3, 4], [true, false, true, false]);
    expect(km.censored).toBe(2);
    // Only events at 1 and 3: S = 3/4 then 3/4 * 1/2 = 3/8.
    expect(km.curve[1]!.survival).toBeCloseTo(0.75, 12);
    expect(km.curve[2]!.nCensored).toBe(1);
    expect(km.curve[3]!.survival).toBeCloseTo(0.375, 12);
    expect(km.median).toBe(3);
  });

  it('returns a median of null when the curve never reaches 0.5', () => {
    const km = kaplanMeier([1, 2, 3, 4], [false, false, true, true]);
    // S = 1 * 1 * 0.5 * 0 = ... first event drops to 0.5.
    const km2 = kaplanMeier([1, 2], [false, false]);
    expect(km2.median).toBeNull();
    expect(km2.curve[0]!.survival).toBe(1);
    expect(km).toBeDefined();
  });

  it('rejects mismatched or empty input', () => {
    expect(() => kaplanMeier([1, 2], [true])).toThrow();
    expect(() => kaplanMeier([], [])).toThrow();
    expect(() => kaplanMeier([-1], [true])).toThrow();
  });
});

describe('stats/survival — log-rank test', () => {
  it('returns chi-square 0 for identical groups', () => {
    const g = { times: [1, 2, 3, 4], events: [true, true, true, true] };
    const result = logRankTest(g, g);
    expect(result.chiSquare).toBeCloseTo(0, 12);
    expect(result.pValue).toBeCloseTo(1, 12);
    expect(result.df).toBe(1);
  });

  it('detects a strong survival difference', () => {
    const result = logRankTest(
      { times: [1, 2, 3, 4, 5], events: [true, true, true, true, true] },
      { times: [10, 11, 12, 13, 14], events: [true, true, true, true, true] },
    );
    expect(result.chiSquare).toBeGreaterThan(5);
    expect(result.pValue).toBeLessThan(0.05);
    expect(result.observed1).toBe(5);
    expect(result.observed2).toBe(5);
  });

  it('validates input shapes', () => {
    expect(() =>
      logRankTest({ times: [1], events: [] }, { times: [2], events: [true] }),
    ).toThrow();
  });
});
