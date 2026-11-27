// Sub-bin peak refinement + half-power bandwidth: the spectrum must report a
// centre with an explicit resolution bound, not a bin index dressed as Hz.

import { describe, expect, it } from 'vitest';
import { analysePeak } from '@ergalics/sci-kernels/signal';

const df = 2; // fs = 1024 Hz over 512 bins
const freqs = Array.from({ length: 513 }, (_, k) => k * df);
// Log-Gaussian is an exact parabola, so the interpolation error is measurable
// in isolation from the line shape.
const gaussPower = (f: number, f0 = 49.3, sigma = 1.5) => Math.exp(-(((f - f0) / sigma) ** 2));

describe('analysePeak', () => {
  it('recovers a peak that sits between bins', () => {
    const psd = freqs.map((f) => gaussPower(f));
    const pk = analysePeak(freqs, psd, { halfPower: 'power' })!;
    expect(pk.frequency).toBeCloseTo(49.3, 6);
    expect(pk.height).toBeCloseTo(1, 6);
    expect(pk.resolution).toBe(df);
    expect(pk.uncertainty).toBe(df / 2);
  });

  it('turns the half-power width into a damping ratio', () => {
    const psd = freqs.map((f) => gaussPower(f));
    const pk = analysePeak(freqs, psd, { halfPower: 'power' })!;
    // True full width: 2σ√ln2 ≈ 2.498 Hz.
    expect(pk.bandwidth).toBeCloseTo(2.498, 0);
    expect(pk.damping).toBeCloseTo(2.498 / (2 * 49.3), 2);
  });

  it('treats an amplitude spectrum as −3 dB at 1/√2', () => {
    const mag = freqs.map((f) => Math.sqrt(gaussPower(f)));
    const pk = analysePeak(freqs, mag, { halfPower: 'amplitude' })!;
    expect(pk.frequency).toBeCloseTo(49.3, 6);
    expect(pk.bandwidth).toBeCloseTo(2.498, 0);
  });

  it('reports no bandwidth when a side never crosses half power', () => {
    const flat = freqs.map(() => 1);
    flat[0] = 1e6; // DC spike is skipped
    const pk = analysePeak(freqs, flat)!;
    expect(pk.frequency).toBe(df); // first non-DC bin, no sub-bin shift
    expect(pk.bandwidth).toBeNull();
    expect(pk.damping).toBeNull();
  });

  it('returns null when the maximum touches an edge or data is too short', () => {
    expect(analysePeak(freqs.slice(0, 20), freqs.slice(0, 20).map((f) => f))).toBeNull();
    expect(analysePeak([0, 1, 2], [1, 2, 3])).toBeNull();
  });
});
