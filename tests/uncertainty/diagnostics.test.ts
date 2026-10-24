import { describe, it, expect } from 'vitest';
import { splitRHat, effectiveSampleSize, mcmcDiagnostics, autocorrelationFFT, hdiSorted } from '@/core/uncertainty/diagnostics';
import { pcg32Seed, pcg32Next, pcg32Float } from '@/core/uncertainty/pcg';

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng: () => number): () => number {
  let cache: number | null = null;
  return () => {
    if (cache !== null) { const v = cache; cache = null; return v; }
    let u1 = rng();
    while (u1 <= 0) u1 = rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const th = 2 * Math.PI * rng();
    cache = r * Math.sin(th);
    return r * Math.cos(th);
  };
}

describe('pcg32', () => {
  it('is deterministic for a seed/stream pair', () => {
    const a = pcg32Seed(42, 7);
    const b = pcg32Seed(42, 7);
    const seqA = Array.from({ length: 8 }, () => pcg32Next(a));
    const seqB = Array.from({ length: 8 }, () => pcg32Next(b));
    expect(seqA).toEqual(seqB);
  });

  it('different streams diverge', () => {
    const a = pcg32Seed(42, 1);
    const b = pcg32Seed(42, 2);
    expect(pcg32Next(a)).not.toBe(pcg32Next(b));
  });

  it('floats stay in [0,1) and cover the range', () => {
    const s = pcg32Seed(1, 1);
    const values = Array.from({ length: 10000 }, () => pcg32Float(s));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.47);
    expect(mean).toBeLessThan(0.53);
  });
});

describe('autocorrelationFFT', () => {
  it('rho(0) = 1 and lag-1 of an AR(1) process is positive', () => {
    const rng = mulberry(3);
    const g = gaussian(rng);
    const n = 4000;
    const x = new Float64Array(n);
    let v = 0;
    for (let i = 0; i < n; i += 1) {
      v = 0.7 * v + g();
      x[i] = v;
    }
    const rho = autocorrelationFFT(x, 10);
    expect(rho[0]).toBeCloseTo(1, 9);
    expect(rho[1]).toBeGreaterThan(0.6);
    expect(rho[1]).toBeLessThan(0.8);
  });
});

describe('split R-hat', () => {
  it('≈ 1 for chains drawn from the same stationary distribution', () => {
    const rng = mulberry(11);
    const g = gaussian(rng);
    const chains = [0, 1, 2, 3].map(() => Array.from({ length: 2000 }, () => g()));
    expect(splitRHat(chains)).toBeLessThan(1.01);
    expect(splitRHat(chains)).toBeGreaterThan(0.99);
  });

  it('> 1.01 when chains have different means', () => {
    const rng = mulberry(13);
    const g = gaussian(rng);
    const chains = [
      Array.from({ length: 2000 }, () => g()),
      Array.from({ length: 2000 }, () => g() + 2),
      Array.from({ length: 2000 }, () => g() - 1),
      Array.from({ length: 2000 }, () => g() + 0.5),
    ];
    expect(splitRHat(chains)).toBeGreaterThan(1.1);
  });

  it('returns 1 when every chain is the same constant', () => {
    const chains = [new Array(100).fill(3), new Array(100).fill(3)];
    expect(splitRHat(chains)).toBe(1);
  });

  it('returns NaN for a single short chain', () => {
    expect(Number.isNaN(splitRHat([[1, 2, 3]]))).toBe(true);
  });
});

describe('ESS', () => {
  it('is close to n for independent draws', () => {
    const rng = mulberry(21);
    const g = gaussian(rng);
    const x = Array.from({ length: 10000 }, () => g());
    const ess = effectiveSampleSize(x);
    expect(ess).toBeGreaterThan(8000);
    expect(ess).toBeLessThanOrEqual(10000);
  });

  it('is much smaller than n for a strongly autocorrelated chain', () => {
    const rng = mulberry(31);
    const g = gaussian(rng);
    const n = 10000;
    const x: number[] = [];
    let v = 0;
    for (let i = 0; i < n; i += 1) {
      v = 0.99 * v + g();
      x.push(v);
    }
    expect(effectiveSampleSize(x)).toBeLessThan(1000);
  });

  it('never exceeds the chain length', () => {
    expect(effectiveSampleSize([5, 5, 5, 5])).toBe(4);
  });
});

describe('mcmcDiagnostics', () => {
  it('reports converged for well-mixed chains and flags bad ones', () => {
    const rng = mulberry(99);
    const g = gaussian(rng);
    const good = [0, 1, 2, 3].map(() =>
      Array.from({ length: 2 }, () => Array.from({ length: 3000 }, () => g())),
    );
    const d = mcmcDiagnostics(good);
    expect(d.rHat.length).toBe(2);
    expect(d.rHat[0]).toBeLessThan(1.01);
    expect(d.ess[0]).toBeGreaterThan(8000);
    expect(d.converged).toBe(true);

    const bad = [
      [Array.from({ length: 1000 }, () => g()), Array.from({ length: 1000 }, () => g())],
      [Array.from({ length: 1000 }, () => g() + 3), Array.from({ length: 1000 }, () => g() - 2)],
    ];
    expect(mcmcDiagnostics(bad).converged).toBe(false);
  });
});

describe('hdiSorted', () => {
  it('covers the requested probability mass', () => {
    const x = Array.from({ length: 10000 }, (_, i) => i / 10000).sort((a, b) => a - b);
    const [lo, hi] = hdiSorted(x, 0.94);
    expect(hi - lo).toBeCloseTo(0.94, 2);
    expect(lo).toBe(0);
  });

  it('works for a single sample', () => {
    expect(hdiSorted([7], 0.94)).toEqual([7, 7]);
  });
});
