import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DESIGN_STORM_90MM_6H,
  M3_PER_MM_PER_KM2,
  PEAK_FACTOR_SI,
  benchmarkCnHandcalc,
  benchmarkMassConservation,
  benchmarkSuperposition,
  benchmarkUnitHydrographPeak,
  buildUnitHydrograph,
  convolveHyetograph,
  excessRainfallIncrements,
  initialAbstraction,
  parseHyetograph,
  parseRainText,
  potentialRetention,
  runScsEvent,
  scsRunoff,
} from '../src/plugins/builtin/geo/hydrology/kernel';

const S80 = potentialRetention(80); // 63.5 mm

describe('geo-hydrology · SCS curve number', () => {
  it('S = 25400/CN - 254: CN=80 gives S = 63.5 mm, Ia = 12.7 mm', () => {
    expect(S80).toBeCloseTo(63.5, 9);
    expect(initialAbstraction(S80)).toBeCloseTo(12.7, 9);
  });

  it('Q = (P-0.2S)^2/(P+0.8S): P=50 mm, CN=80 gives 13.8025 mm', () => {
    // hand calculation: S=63.5, Ia=12.7, Q = 37.3^2 / 100.8 = 1391.29/100.8
    const q = scsRunoff(50, S80);
    expect(Math.abs(q - 1391.29 / 100.8) / (1391.29 / 100.8)).toBeLessThan(1e-12);
    expect(q).toBeCloseTo(1391.29 / 100.8, 9);
  });

  it('no runoff below the initial abstraction; continuous at P = Ia', () => {
    expect(scsRunoff(10, S80)).toBe(0);
    expect(scsRunoff(12.7, S80)).toBe(0);
    expect(scsRunoff(12.7 + 1e-7, S80)).toBeLessThan(1e-9);
  });

  it('CN=100 means S=0 and Q=P', () => {
    expect(potentialRetention(100)).toBe(0);
    expect(scsRunoff(42, potentialRetention(100))).toBeCloseTo(42, 12);
  });

  it('incremental excess telescopes exactly onto the cumulative runoff', () => {
    const inc = excessRainfallIncrements([10, 20, 30, 30], S80);
    const total = inc.reduce((a, b) => a + b, 0);
    expect(Math.abs(total - scsRunoff(90, S80))).toBeLessThan(1e-12);
    for (const x of inc) expect(x).toBeGreaterThanOrEqual(-1e-15);
  });
});

describe('geo-hydrology · unit hydrograph', () => {
  const area = 10;
  const tp = 2;
  const dt = tp / 100;
  const qp = (PEAK_FACTOR_SI * area) / tp; // 1.04 m3/s per mm

  it('triangular shape peaks at Tp with qp within 1% after renormalization', () => {
    const u = buildUnitHydrograph(area, tp, dt, 'triangular');
    const peakIdx = u.ordinates.indexOf(Math.max(...u.ordinates));
    expect(peakIdx).toBe(Math.round(tp / dt));
    expect(Math.abs(u.ordinates[peakIdx]! - qp) / qp).toBeLessThan(0.01);
  });

  it('curvilinear (NOHRSC table) shape peaks at Tp with qp within 1%', () => {
    const u = buildUnitHydrograph(area, tp, dt, 'curvilinear');
    const peak = Math.max(...u.ordinates);
    expect(Math.abs(peak - qp) / qp).toBeLessThan(0.01);
  });

  it('renormalized ordinates carry EXACTLY 1 mm over the basin', () => {
    for (const type of ['triangular', 'curvilinear'] as const) {
      const u = buildUnitHydrograph(area, tp, dt, type);
      const volume = u.ordinates.reduce((a, b) => a + b, 0) * 3600 * dt;
      expect(Math.abs(volume - M3_PER_MM_PER_KM2 * area) / (M3_PER_MM_PER_KM2 * area)).toBeLessThan(1e-12);
    }
  });

  it('triangular time base is 2.67 Tp; curvilinear 5.0 Tp', () => {
    expect(buildUnitHydrograph(area, tp, 0.5, 'triangular').timeBaseHours).toBeCloseTo(5.34, 9);
    expect(buildUnitHydrograph(area, tp, 0.5, 'curvilinear').timeBaseHours).toBeCloseTo(10, 9);
  });
});

describe('geo-hydrology · convolution and event mass balance', () => {
  it('runoff volume equals excess volume to <1e-9 for both UH shapes', () => {
    for (const type of ['triangular', 'curvilinear'] as const) {
      const ev = runScsEvent({
        precipMm: DESIGN_STORM_90MM_6H,
        dtHours: 0.5,
        cn: 80,
        areaKm2: 10,
        tpHours: 2,
        uhType: type,
      });
      expect(ev.massRelResidual).toBeLessThan(1e-9);
      expect(ev.totalExcessMm).toBeCloseTo(scsRunoff(90, S80), 9);
    }
  });

  it('discrete convolution is linear: Q([a,b]) = Q([a,0]) + shift(Q([0,b]))', () => {
    const uh = buildUnitHydrograph(5, 1.5, 0.5, 'curvilinear').ordinates;
    const a = 3.2;
    const b = 7.1;
    const full = convolveHyetograph([a, b], uh);
    const r1 = convolveHyetograph([a, 0], uh);
    const r2 = convolveHyetograph([0, b], uh);
    const peak = Math.max(...full.map(Math.abs));
    for (let i = 0; i < full.length; i += 1) {
      expect(Math.abs(full[i]! - (r1[i]! + r2[i]!))).toBeLessThan(peak * 1e-12);
    }
  });

  it('event on the 90 mm storm: P=90 -> Q=42.44 mm, peak after the rain peak', () => {
    const ev = runScsEvent({
      precipMm: DESIGN_STORM_90MM_6H,
      dtHours: 1,
      cn: 80,
      areaKm2: 10,
      tpHours: 2,
      uhType: 'triangular',
    });
    expect(ev.totalPrecipMm).toBeCloseTo(90, 9);
    // S=63.5: Q = (90-12.7)^2/(90+0.8*63.5) = 5975.29/140.8 = 42.4383 mm
    expect(ev.totalExcessMm).toBeCloseTo(5975.29 / 140.8, 6);
    expect(ev.peakFlowM3s).toBeGreaterThan(0);
    expect(ev.timeToPeakHours).toBeGreaterThanOrEqual(2);
    expect(ev.timeToPeakHours).toBeLessThanOrEqual(12);
  });
});

describe('geo-hydrology · hyetograph parsing and example data', () => {
  it('the shipped design storm sums to exactly 90 mm', () => {
    const sum = DESIGN_STORM_90MM_6H.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 90)).toBeLessThan(1e-9);
  });

  it('parses the shipped usgs-storm-hyetograph.csv (time column -> dt=1 h)', () => {
    const parsed = parseHyetograph(readFileSync('examples/data/usgs-storm-hyetograph.csv', 'utf8'), 1);
    expect(parsed.rainMm.length).toBe(6);
    expect(parsed.hasTimeColumn).toBe(true);
    expect(parsed.dtHours).toBe(1);
    expect(parsed.rainMm.reduce((a, b) => a + b, 0)).toBeCloseTo(90, 9);
    // matches the built-in demo storm
    for (let i = 0; i < 6; i += 1) expect(parsed.rainMm[i]).toBeCloseTo(DESIGN_STORM_90MM_6H[i]!, 9);
  });

  it('falls back to the given dt for a single unlabeled column', () => {
    const parsed = parseHyetograph('# rain only\n5\n10\n20', 2);
    expect(parsed.rainMm).toEqual([5, 10, 20]);
    expect(parsed.hasTimeColumn).toBe(false);
    expect(parsed.dtHours).toBe(2);
  });

  it('parseRainText accepts comma / whitespace / semicolon lists', () => {
    expect(parseRainText('6.25, 18.75; 27.5\n20.83 12.5 4.17')).toEqual([6.25, 18.75, 27.5, 20.83, 12.5, 4.17]);
    expect(parseRainText('no numbers here')).toEqual([]);
  });
});

describe('geo-hydrology · validation benchmarks', () => {
  it('hand-calc, UH peak, mass conservation and superposition all pass', () => {
    expect(benchmarkCnHandcalc().passed).toBe(true);
    expect(benchmarkUnitHydrographPeak().passed).toBe(true);
    expect(benchmarkMassConservation().passed).toBe(true);
    expect(benchmarkSuperposition().passed).toBe(true);
  });
});
