import { describe, it, expect } from 'vitest';
import { twoSampleTTestPower } from '@/core/stats/power';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('stats/power', () => {
  it('Cohen benchmark: d=0.5, n=64/group, α=0.05 → power ≈ 0.80', () => {
    const power = twoSampleTTestPower(0.5, 64, 0.05, true);
    expect(close(power, 0.807, 5e-3)).toBe(true);
  });

  it('power increases with sample size', () => {
    const small = twoSampleTTestPower(0.5, 20, 0.05, true);
    const large = twoSampleTTestPower(0.5, 200, 0.05, true);
    expect(large).toBeGreaterThan(small);
  });

  it('power increases with effect size', () => {
    const d1 = twoSampleTTestPower(0.2, 100, 0.05, true);
    const d2 = twoSampleTTestPower(0.8, 100, 0.05, true);
    expect(d2).toBeGreaterThan(d1);
  });
});
