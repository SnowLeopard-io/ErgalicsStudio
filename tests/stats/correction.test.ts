import { describe, it, expect } from 'vitest';
import { bonferroni, benjaminiHochberg } from '@/core/stats/correction';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('stats/correction — multiple-comparison control', () => {
  it('Bonferroni multiplies by m (capped at 1)', () => {
    const r = bonferroni([0.01, 0.04], 0.05);
    expect(close(r.adjusted[0]!, 0.02, 1e-9)).toBe(true);
    expect(close(r.adjusted[1]!, 0.08, 1e-9)).toBe(true);
    expect(r.significant).toEqual([true, false]);
  });

  it('Benjamini-Hochberg yields q = 0.05 across the board for evenly spaced p', () => {
    const p = [0.01, 0.02, 0.03, 0.04, 0.05];
    const r = benjaminiHochberg(p, 0.05);
    for (const q of r.adjusted) expect(close(q, 0.05, 1e-9)).toBe(true);
    expect(r.significant.every(Boolean)).toBe(true);
  });
});
