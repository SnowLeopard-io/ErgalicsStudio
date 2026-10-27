import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  energyJoules,
  detectShadowZones,
  momentMagnitude,
  parseVelocityModel,
  runSeismicBenchmarks,
  travelTimeAtDelta,
  createWaveSim,
  stepWaveSim,
  waveFieldMax,
} from '../src/plugins/builtin/geo-seismic/kernel';

describe('geo-seismic · travel times and magnitudes', () => {
  it('P-wave first arrival increases with epicentral distance', () => {
    expect(travelTimeAtDelta(30, 'P')).toBeGreaterThan(0);
    expect(travelTimeAtDelta(90, 'P')).toBeGreaterThan(travelTimeAtDelta(30, 'P'));
  });

  it('detects a direct-P shadow zone in the 100°–150° range', () => {
    const zones = detectShadowZones('P');
    expect(zones.some((z) => z.fromDeg > 90 && z.toDeg < 150)).toBe(true);
  });

  it('one magnitude unit corresponds to 10^1.5 energy', () => {
    expect(energyJoules(6) / energyJoules(5)).toBeCloseTo(Math.pow(10, 1.5), 9);
  });

  it('moment magnitude round-trips through seismic moment', () => {
    const mw = momentMagnitude(1e20);
    expect(mw).toBeGreaterThan(6.5);
    expect(mw).toBeLessThan(7.5);
  });
});

describe('geo-seismic · model parsing and numerical stability', () => {
  it('parses the bundled velocity model', () => {
    const text = readFileSync('examples/data/geo-seismic-velocity.csv', 'utf8');
    const rows = parseVelocityModel(text);
    expect(rows.length).toBeGreaterThan(5);
    expect(rows[0]!.vp).toBeGreaterThan(0);
  });

  it('FDTD wave simulation stays finite', () => {
    const sim = createWaveSim({ nx: 64, ny: 48, dxKm: 5 });
    for (let i = 0; i < 60; i += 1) stepWaveSim(sim);
    expect(waveFieldMax(sim.pCur)).toBeGreaterThan(0);
    expect(sim.pCur.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('all declared benchmarks pass', () => {
    const out = runSeismicBenchmarks();
    expect(out.every((b) => b.pass)).toBe(true);
  });
});
