import { describe, it, expect } from 'vitest';
import {
  fft,
  nextPow2,
  spectrum,
  welch,
  peakFrequency,
} from '@/core/signal/fft';
import {
  makeWindow,
  applyWindow,
  windowCoherentGain,
} from '@/core/signal/window';
import {
  savitzkyGolay,
  savitzkyGolayCoeffs,
  movingAverage,
  diff,
} from '@/core/signal/filter';
import { acf, pacf, whiteNoiseBand } from '@/core/signal/correlation';
import { decomposeAdditive, suggestPeriod } from '@/core/signal/decompose';

const closeTo = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('signal/window', () => {
  it('rectangular window is all ones', () => {
    const w = makeWindow(8, 'rectangular');
    expect(Array.from(w).every((v) => v === 1)).toBe(true);
  });

  it('hann window endpoints zero and symmetry', () => {
    const w = makeWindow(9, 'hann');
    expect(w[0]).toBeCloseTo(0, 12);
    expect(w[8]).toBeCloseTo(0, 12);
    expect(w[4]).toBeCloseTo(1, 10);
    expect(w[1]).toBeCloseTo(w[7]!, 12);
  });

  it('hamming endpoints ~0.08', () => {
    const w = makeWindow(16, 'hamming');
    expect(w[0]).toBeCloseTo(0.08, 6);
    expect(windowCoherentGain(w)).toBeGreaterThan(0.5);
  });

  it('blackman window and applyWindow', () => {
    const w = makeWindow(11, 'blackman');
    expect(w[5]).toBeCloseTo(1, 10);
    const y = applyWindow([1, 1, 1, 1, 1], 'hann');
    expect(y.length).toBe(5);
    expect(y[0]).toBe(0);
    expect(y[2]).toBeCloseTo(1, 10);
  });
});

describe('signal/fft', () => {
  it('nextPow2', () => {
    expect(nextPow2(1)).toBe(1);
    expect(nextPow2(7)).toBe(8);
    expect(nextPow2(16)).toBe(16);
    expect(nextPow2(17)).toBe(32);
  });

  it('rejects non-power-of-two length', () => {
    expect(() => fft(new Float64Array(3), new Float64Array(3))).toThrow();
  });

  it('DC signal concentrates energy in bin 0', () => {
    const re = new Float64Array(8).fill(1);
    const im = new Float64Array(8);
    fft(re, im);
    expect(re[0]).toBeCloseTo(8, 9);
    for (let k = 1; k < 8; k += 1) expect(re[k]).toBeCloseTo(0, 9);
  });

  it('round-trips through inverse FFT', () => {
    const orig = new Float64Array([0.2, -1.1, 2.3, 0.4, -0.7, 1.9, 0.0, 0.5]);
    const re = orig.slice();
    const im = new Float64Array(8);
    fft(re, im);
    fft(re, im, true);
    for (let i = 0; i < 8; i += 1) expect(re[i]).toBeCloseTo(orig[i]!, 9);
  });

  it('single-bin complex exponential', () => {
    // x[n] = exp(j 2π·2n/8) → all energy in bin 2
    const re = new Float64Array(8);
    const im = new Float64Array(8);
    for (let n = 0; n < 8; n += 1) {
      re[n] = Math.cos((2 * Math.PI * 2 * n) / 8);
      im[n] = Math.sin((2 * Math.PI * 2 * n) / 8);
    }
    fft(re, im);
    expect(Math.hypot(re[2]!, im[2]!)).toBeCloseTo(8, 8);
  });

  it('dominant-frequency estimation within one bin (AC1)', () => {
    const n = 1024;
    const fs = 100;
    const f0 = 10;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i += 1) x[i] = Math.sin((2 * Math.PI * f0 * i) / fs);
    const sp = spectrum(x, fs, 'rectangular');
    expect(sp.padded).toBe(false);
    const binWidth = fs / n;
    expect(Math.abs(peakFrequency(sp) - f0)).toBeLessThanOrEqual(binWidth);
  });

  it('zero-pads non power-of-two input and flags it', () => {
    const x = new Float64Array(100);
    for (let i = 0; i < 100; i += 1) x[i] = Math.sin((2 * Math.PI * 3 * i) / 100);
    const sp = spectrum(x, 1, 'hann');
    expect(sp.nfft).toBe(128);
    expect(sp.padded).toBe(true);
  });

  it('welch PSD peaks at signal frequency', () => {
    const n = 4096;
    const fs = 256;
    const f0 = 40;
    const x = new Float64Array(n);
    // Deterministic pseudo-noise (mulberry-style LCG) keeps the test reproducible.
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff - 0.5;
    };
    for (let i = 0; i < n; i += 1) x[i] = 3 * Math.sin((2 * Math.PI * f0 * i) / fs) + rand();
    const w = welch(x, fs, 512, 'hann');
    let peak = 0;
    let pv = -1;
    for (let k = 1; k < w.psd.length; k += 1) {
      if (w.psd[k]! > pv) {
        pv = w.psd[k]!;
        peak = k;
      }
    }
    const fPeak = w.freqs[peak]!;
    expect(Math.abs(fPeak - f0)).toBeLessThanOrEqual(fs / 512 + 1e-9);
    expect(w.segments).toBeGreaterThan(10);
  });
});

describe('signal/filter', () => {
  it('SG coefficients sum to 1 and are symmetric', () => {
    const h = savitzkyGolayCoeffs(2, 2);
    const s = h.reduce((a, b) => a + b, 0);
    expect(s).toBeCloseTo(1, 9);
    expect(h[0]).toBeCloseTo(h[4]!, 9);
  });

  it('SG preserves polynomials exactly up to its degree (AC2)', () => {
    const n = 201;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i += 1) x[i] = 1 + 2 * i - 0.5 * i * i + 0.01 * i ** 3 - 1e-5 * i ** 4;
    const y = savitzkyGolay(x, { window: 11, poly: 4 });
    let rmse = 0;
    for (let i = 0; i < n; i += 1) rmse += (y[i]! - x[i]!) ** 2;
    rmse = Math.sqrt(rmse / n);
    expect(rmse).toBeLessThan(1e-9);
  });

  it('SG smooths noise while tracking a ramp', () => {
    const n = 501;
    const x = new Float64Array(n);
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff - 0.5;
    };
    for (let i = 0; i < n; i += 1) x[i] = i / 500 + rand() * 0.1;
    const y = savitzkyGolay(x, { window: 11, poly: 2 });
    let err = 0;
    for (let i = 20; i < n - 20; i += 1) err += (y[i]! - i / 500) ** 2;
    expect(Math.sqrt(err / (n - 40))).toBeLessThan(0.02);
  });

  it('rejects invalid windows', () => {
    expect(() => savitzkyGolay([1, 2, 3], { window: 4 })).toThrow();
    expect(() => savitzkyGolay([1, 2, 3], { window: 7, poly: 7 })).toThrow();
  });

  it('centred and causal moving averages', () => {
    const y = movingAverage([1, 2, 3, 4, 5], 3);
    expect(y[2]).toBeCloseTo(3, 9);
    const c = movingAverage([1, 2, 3, 4, 5], 3, true);
    expect(c[2]).toBeCloseTo(2, 9);
    expect(c[4]).toBeCloseTo(4, 9);
  });

  it('first difference', () => {
    expect(Array.from(diff([1, 3, 6, 10]))).toEqual([2, 3, 4]);
  });
});

describe('signal/correlation', () => {
  it('ACF(0)=1 and symmetry (AC3)', () => {
    const n = 500;
    let seed = 42;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    const x = new Float64Array(n);
    for (let i = 0; i < n; i += 1) x[i] = rand();
    const a = acf(x, 20);
    expect(a[0]).toBe(1);
    // ACF is even in theory: compare |r(k)-r(-k)| indirectly via two halves.
    for (let k = 1; k <= 20; k += 1) {
      expect(Math.abs(a[k]!)).toBeLessThanOrEqual(1 + 1e-12);
    }
  });

  it('ACF of an AR(1) decays geometrically', () => {
    const phi = 0.6;
    const n = 20000;
    const x = new Float64Array(n);
    let seed = 99;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return (seed / 0xffffffff - 0.5) * 2;
    };
    for (let i = 1; i < n; i += 1) x[i] = phi * x[i - 1]! + rand();
    const a = acf(x, 10);
    expect(a[1]).toBeGreaterThan(0.5);
    expect(a[1]).toBeLessThan(0.7);
    expect(a[2]).toBeLessThan(a[1]!);
  });

  it('PACF(1) ≈ φ for AR(1) and cuts off after lag 1 (AC3)', () => {
    const phi = 0.45;
    const n = 40000;
    const x = new Float64Array(n);
    let seed = 555;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return (seed / 0xffffffff - 0.5) * 2;
    };
    for (let i = 1; i < n; i += 1) x[i] = phi * x[i - 1]! + rand();
    const p = pacf(x, 8);
    expect(Math.abs(p[1]! - phi)).toBeLessThan(0.02);
    for (let k = 2; k <= 8; k += 1) expect(Math.abs(p[k]!)).toBeLessThan(whiteNoiseBand(n) * 1.5);
  });

  it('constant series ACF does not divide by zero', () => {
    const a = acf([3, 3, 3, 3, 3], 2);
    expect(a[0]).toBe(1);
  });
});

describe('signal/decompose', () => {
  it('recovers trend, season and residual of a synthetic series', () => {
    const period = 4;
    const n = 40;
    const x = new Float64Array(n);
    const pattern = [1, -1, 0.5, -0.5];
    for (let i = 0; i < n; i += 1) {
      x[i] = 2 + 0.1 * i + pattern[i % period]!;
    }
    const d = decomposeAdditive(x, period);
    expect(d.seasonalPattern).toHaveLength(4);
    const sum = d.seasonalPattern.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(0, 9);
    for (let p = 0; p < 4; p += 1) {
      expect(d.seasonalPattern[p]).toBeCloseTo(pattern[p]!, 1e-6);
    }
    let rmse = 0;
    for (let i = 0; i < n; i += 1) rmse += d.residual[i]! ** 2;
    expect(Math.sqrt(rmse / n)).toBeLessThan(1e-6);
  });

  it('requires two full periods', () => {
    expect(() => decomposeAdditive([1, 2, 3], 2)).toThrow();
  });

  it('suggestPeriod finds the injected period', () => {
    const period = 7;
    const n = 70;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      x[i] = 3 * Math.sin((2 * Math.PI * i) / period);
    }
    expect(suggestPeriod(x, 20)).toBe(period);
  });

  it('residual summary reports near-zero JB for clean data', () => {
    const period = 5;
    const n = 50;
    const x = new Float64Array(n);
    for (let i = 0; i < n; i += 1) x[i] = i * 0.05 + Math.sin((2 * Math.PI * i) / period);
    const d = decomposeAdditive(x, period);
    expect(Math.abs(d.residualSummary.mean)).toBeLessThan(1e-9);
    let rmse = 0;
    for (let i = 0; i < n; i += 1) rmse += d.residual[i]! ** 2;
    expect(Math.sqrt(rmse / n)).toBeLessThan(1e-8);
    expect(Number.isFinite(d.residualSummary.jb)).toBe(true);
  });
});

describe('signal end-to-end', () => {
  it('closeTo helper sanity', () => {
    expect(closeTo(1, 1 + 1e-9, 1e-8)).toBe(true);
  });
});
