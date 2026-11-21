// stats-conformal — split conformal prediction kernel checks.
import { describe, it, expect } from 'vitest';
import {
  conformalQuantile,
  conformalSelfCheck,
  generateDataset,
  normInv,
  runConformal,
} from '@/plugins/builtin/stats/conformal/kernel';

describe('conformal primitives', () => {
  it('returns the finite-sample order statistic', () => {
    const scores = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // n = 10, alpha = 0.2 -> k = ceil(11 * 0.8) = 9 -> 9th smallest.
    expect(conformalQuantile(scores, 0.2)).toBe(9);
    expect(conformalQuantile(scores, 0.1)).toBe(10);
    // Too few calibration points for 90% coverage: honestly infinite.
    expect(conformalQuantile([1, 2, 3], 0.1)).toBe(Infinity);
    expect(conformalQuantile([], 0.1)).toBe(Infinity);
  });

  it('inverse normal CDF matches known quantiles', () => {
    expect(normInv(0.5)).toBeCloseTo(0, 9);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
    expect(normInv(0.95)).toBeCloseTo(1.644854, 5);
    expect(normInv(0.025)).toBeCloseTo(-1.959964, 5);
    expect(conformalSelfCheck().ok).toBe(true);
  });

  it('generates a deterministic dataset of the requested size', () => {
    const a = generateDataset('hetero', 120, 0.3, 9);
    const b = generateDataset('hetero', 120, 0.3, 9);
    expect(a).toHaveLength(120);
    expect(a).toEqual(b);
    expect(a.every((p) => p.x >= 0 && p.x <= 1 && Number.isFinite(p.y))).toBe(true);
  });
});

describe('split conformal coverage', () => {
  const cfg = {
    kind: 'hetero' as const,
    n: 1500,
    noise: 0.22,
    degree: 4,
    alpha: 0.1,
    seed: 42,
  };

  it('hits the nominal marginal rate under heteroscedastic noise', () => {
    const r = runConformal({ ...cfg, method: 'absolute' });
    expect(r.coverage).toBeGreaterThan(0.86);
    expect(r.coverage).toBeLessThanOrEqual(0.99);
    expect(r.nCal).toBe(300);
    expect(r.nTest).toBe(300);
  });

  it('keeps its marginal rate while the Gaussian band loses the high-x tail', () => {
    const r = runConformal({ ...cfg, method: 'absolute' });
    // Marginal coverage is close to nominal for both. The failure of a single
    // global sigma-hat is conditional: the high-variance tercile under-covers.
    expect(Math.abs(r.coverage - r.target)).toBeLessThan(Math.abs(r.coverageNaive - r.target));
    expect(r.covHighNaive).toBeLessThan(r.target - 0.1);
    expect(r.covLowNaive).toBeGreaterThan(0.95);
  });

  it('local normalisation adapts the width and repairs the high-x coverage', () => {
    const abs = runConformal({ ...cfg, method: 'absolute' });
    const norm = runConformal({ ...cfg, method: 'normalized' });
    const widthAt = (r: typeof abs, x: number) => {
      let best = r.band[0]!;
      for (const b of r.band) if (Math.abs(b.x - x) < Math.abs(best.x - x)) best = b;
      return best.hi - best.lo;
    };
    // The normalised band grows with x; the absolute band is flat.
    expect(widthAt(norm, 0.95) / widthAt(norm, 0.05)).toBeGreaterThan(2);
    expect(Math.abs(widthAt(abs, 0.95) / widthAt(abs, 0.05) - 1)).toBeLessThan(0.05);
    expect(norm.coverage).toBeGreaterThan(0.88);
    expect(norm.covHigh).toBeGreaterThan(norm.covHighNaive + 0.1);
  });

  it('is deterministic for a fixed seed and agrees with its self-check', () => {
    const cfg = { kind: 'homo' as const, n: 400, noise: 0.2, degree: 3, alpha: 0.2, method: 'absolute' as const, seed: 3 };
    const a = runConformal(cfg);
    const b = runConformal(cfg);
    expect(a.coverage).toBe(b.coverage);
    expect(a.qhat).toBe(b.qhat);
    expect(a.band.map((p) => p.hi)).toEqual(b.band.map((p) => p.hi));
    expect(a.sweep).toHaveLength(19);
  });
});
