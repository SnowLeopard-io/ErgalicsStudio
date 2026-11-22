// Sampling-rate inference: the frequency axis must never silently label a
// normalized 0–0.5 spectrum as hertz.

import { describe, expect, it } from 'vitest';
import { inferSampleRate, parseSamplingRateMetadata } from '@/core/signal';

describe('inferSampleRate', () => {
  it('recovers fs from a regular time axis', () => {
    const fs = 2048;
    const t = Array.from({ length: 1024 }, (_, i) => i / fs);
    expect(inferSampleRate(t)).toBeCloseTo(fs, 6);
  });

  it('uses the median interval so dropped rows do not skew the rate', () => {
    const fs = 100;
    const t: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      if (i % 17 === 0) continue; // missing samples
      t.push(i / fs);
    }
    // Duplicate a timestamp: zero deltas are ignored.
    t.splice(10, 0, t[10]!);
    expect(inferSampleRate(t)).toBeCloseTo(fs, 6);
  });

  it('refuses a decreasing axis', () => {
    const t = Array.from({ length: 50 }, (_, i) => 1 - i / 100);
    expect(inferSampleRate(t)).toBeNull();
  });

  it('needs at least two samples', () => {
    expect(inferSampleRate([0])).toBeNull();
    expect(inferSampleRate([])).toBeNull();
  });
});

describe('parseSamplingRateMetadata', () => {
  it('reads sampling_rate, sample_rate and fs comment headers', () => {
    expect(parseSamplingRateMetadata('# sampling_rate=2048\ntime_s,accel_g\n')).toBe(2048);
    expect(parseSamplingRateMetadata('// sample-rate: 500\n0,1\n')).toBe(500);
    expect(parseSamplingRateMetadata('# fs = 1000\n0,1\n')).toBe(1000);
    expect(parseSamplingRateMetadata('# sampling frequency: 256\n')).toBe(256);
  });

  it('ignores uncommented matches so data rows cannot set the axis', () => {
    expect(parseSamplingRateMetadata('time_s,accel_g\n0,1\n')).toBeNull();
  });

  it('rejects non-positive values', () => {
    expect(parseSamplingRateMetadata('# sampling_rate=0\n')).toBeNull();
  });
});
