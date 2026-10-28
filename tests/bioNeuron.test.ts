// bio-neuron kernel validation: Hodgkin–Huxley 1952 fixed point, excitability
// threshold, subthreshold recovery and F–I monotonicity.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HH_PARAMS,
  REST_V,
  countSpikes,
  firingRate,
  gatingAt,
  runHhBenchmarks,
  simulateHH,
  vtrap,
} from '../src/plugins/builtin/bio/neuron/kernel';

const NO_STIM = { hold: 0, pulseAmp: 0, pulseStart: 0, pulseDur: 0 };

describe('bio-neuron kernel (Hodgkin–Huxley 1952)', () => {
  it('recovers the published resting gate values at V = −65 mV', () => {
    const g = gatingAt(REST_V);
    expect(g.mInf).toBeCloseTo(0.0529, 3);
    expect(g.hInf).toBeCloseTo(0.5961, 3);
    expect(g.nInf).toBeCloseTo(0.3177, 3);
  });

  it('handles the vtrap removable singularity', () => {
    expect(vtrap(0, 10)).toBeCloseTo(10, 12);
    expect(vtrap(1e-12, 10)).toBeCloseTo(10, 9);
    expect(vtrap(-25, 10)).toBeCloseTo(2.2356, 3);
  });

  it('keeps the membrane at the −65 mV fixed point with no injected current', () => {
    const s = simulateHH(DEFAULT_HH_PARAMS, NO_STIM, 100, 0.01);
    expect(Math.abs(s.v[s.v.length - 1]! - REST_V)).toBeLessThan(0.5);
  });

  it('fires a suprathreshold spike for a 10 µA·2 ms pulse (peak > 0 mV)', () => {
    const s = simulateHH(DEFAULT_HH_PARAMS, { ...NO_STIM, pulseAmp: 10, pulseStart: 5, pulseDur: 2 }, 30, 0.01);
    const peak = Math.max(...s.v);
    expect(peak).toBeGreaterThan(0);
  });

  it('stays subthreshold for a 2 µA·2 ms pulse and returns to rest within 1 mV', () => {
    const s = simulateHH(DEFAULT_HH_PARAMS, { ...NO_STIM, pulseAmp: 2, pulseStart: 5, pulseDur: 2 }, 60, 0.01);
    expect(Math.max(...s.v)).toBeLessThan(0);
    expect(Math.abs(s.v[s.v.length - 1]! - REST_V)).toBeLessThan(1);
  });

  it('increases firing rate monotonically with sustained 10/20/40 µA/cm²', () => {
    const r10 = firingRate(DEFAULT_HH_PARAMS, 10);
    const r20 = firingRate(DEFAULT_HH_PARAMS, 20);
    const r40 = firingRate(DEFAULT_HH_PARAMS, 40);
    expect(r10).toBeGreaterThan(0);
    expect(r20).toBeGreaterThan(r10);
    expect(r40).toBeGreaterThan(r20);
  });

  it('counts spikes as upward 0 mV crossings', () => {
    expect(countSpikes([-1, 1, -1, 1])).toBe(2);
    expect(countSpikes([-5, -2, -1])).toBe(0);
  });

  it('passes the embedded validation battery', () => {
    for (const b of runHhBenchmarks()) expect(b.pass).toBe(true);
  });
});
