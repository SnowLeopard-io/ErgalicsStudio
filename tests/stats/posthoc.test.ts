import { describe, expect, it } from 'vitest';
import {
  dunnettTest,
  studentizedRangeCdf,
  studentizedRangeInv,
  tukeyHSD,
} from '@/core/stats/posthoc';

const close = (a: number, b: number, eps: number) => Math.abs(a - b) < eps;

describe('stats/posthoc — Studentized range distribution', () => {
  it('matches published critical q values (alpha = 0.05)', () => {
    expect(close(studentizedRangeInv(0.95, 3, 6), 4.34, 0.02)).toBe(true);
    expect(close(studentizedRangeInv(0.95, 3, 10), 3.88, 0.02)).toBe(true);
    expect(close(studentizedRangeInv(0.95, 4, 20), 3.96, 0.02)).toBe(true);
  });

  it('CDF is monotone and bounded', () => {
    expect(studentizedRangeCdf(0, 3, 10)).toBe(0);
    expect(studentizedRangeCdf(1e6, 3, 10)).toBeGreaterThan(0.999);
    const a = studentizedRangeCdf(3, 3, 10);
    const b = studentizedRangeCdf(4, 3, 10);
    expect(a).toBeLessThan(b);
  });
});

describe('stats/posthoc — Tukey HSD', () => {
  it('compares every pair against pooled within-group variance', () => {
    const groups = [
      [10, 11, 12, 13],
      [20, 21, 22, 23],
      [30, 31, 32, 33],
    ];
    const result = tukeyHSD(groups, ['a', 'b', 'c']);
    expect(result.method).toBe('tukey-hsd');
    expect(result.comparisons).toHaveLength(3);
    expect(result.dfError).toBe(9);
    expect(result.msWithin).toBeCloseTo(5 / 3, 10);
    expect(result.qCrit).toBeGreaterThan(3);
    const ab = result.comparisons.find((c) => c.groupA === 'a' && c.groupB === 'b')!;
    expect(ab.meanDiff).toBe(-10);
    expect(ab.pValue).toBeLessThan(0.001);
    expect(ab.significant).toBe(true);
  });

  it('gives p close to 1 for identical groups', () => {
    const result = tukeyHSD([[1, 2, 3, 4], [1, 2, 3, 4]]);
    expect(result.comparisons[0]!.pValue).toBeGreaterThan(0.99);
    expect(result.comparisons[0]!.significant).toBe(false);
  });
});

describe('stats/posthoc — Dunnett', () => {
  it('compares each treatment with the control and controls FWER', () => {
    const control = [5, 6, 7, 8, 9];
    const result = dunnettTest(control, [[15, 16, 17, 18, 19], [5, 6, 7, 8, 9]], [
      'control',
      'high',
      'same',
    ]);
    expect(result.method).toBe('dunnett');
    expect(result.comparisons).toHaveLength(2);
    expect(result.control).toBe('control');
    expect(result.tCrit).toBeGreaterThan(2);
    expect(result.comparisons[0]!.pValue).toBeLessThan(0.001);
    expect(result.comparisons[1]!.pValue).toBeGreaterThan(0.4);
  });

  it('rejects malformed group names', () => {
    expect(() => dunnettTest([1, 2, 3], [[4, 5, 6]], ['only-one'])).toThrow();
  });
});
