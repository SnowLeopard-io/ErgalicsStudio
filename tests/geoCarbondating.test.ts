import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INT_CAL20_ANCHOR,
  LIBBY_HALF_LIFE,
  MEAN_LIFE_14C,
  benchmarkCurveAnchor,
  benchmarkInterpolation,
  benchmarkLibby,
  calibrateF14C,
  combineF14C,
  curveF14CAt,
  demoMeasurement,
  f14cFromRadiocarbonAge,
  libbyAgeFromF14C,
  parseCalibrationCurve,
  uncalibratedAge,
} from '../src/plugins/builtin/geo/carbondating/kernel';

// Official IntCal20 grid rows (Reimer et al. 2020), used as INDEPENDENT
// anchors — the excerpt file must reproduce them exactly.
const OFFICIAL_ANCHORS: Array<[number, number]> = [
  [0, 199],
  [3050, 2897],
  [6000, 5276],
  [10000, 8872],
  [14000, 12030],
];

const curve = parseCalibrationCurve(readFileSync('examples/data/intcal20-excerpt.csv', 'utf8'));

describe('geo-carbondating · Libby law', () => {
  it('t = -8033·ln(F): F = 0.5 gives one Libby half-life (5568 yr) within 0.1%', () => {
    const t = libbyAgeFromF14C(0.5);
    expect(Math.abs(t - LIBBY_HALF_LIFE) / LIBBY_HALF_LIFE).toBeLessThan(1e-3);
    // MEAN_LIFE_14C = 8033 is the rounded 5568/ln2, hence the tiny residual.
    expect(Math.abs(-MEAN_LIFE_14C * Math.log(0.5) - LIBBY_HALF_LIFE) / LIBBY_HALF_LIFE).toBeLessThan(1e-3);
  });

  it('F <-> age round trip closes to machine precision', () => {
    for (const age of [0, 1000, 5568, 12000, 25000]) {
      const f = f14cFromRadiocarbonAge(age);
      expect(Math.abs(libbyAgeFromF14C(f) - age) / Math.max(age, 1)).toBeLessThan(1e-12);
    }
  });

  it('error propagation: sigma_t = 8033·sigma_F / F', () => {
    const { age, sigma } = uncalibratedAge(0.7, 0.005);
    expect(age).toBeCloseTo(-8033 * Math.log(0.7), 3);
    expect(sigma).toBeCloseTo((8033 * 0.005) / 0.7, 3);
  });

  it('non-positive F14C yields NaN age', () => {
    expect(Number.isNaN(libbyAgeFromF14C(0))).toBe(true);
    expect(Number.isNaN(libbyAgeFromF14C(-1))).toBe(true);
  });
});

describe('geo-carbondating · IntCal20 excerpt (real official data)', () => {
  it('parses 281 rows on the 50-year grid spanning 0-14000 cal BP', () => {
    expect(curve.length).toBe(281);
    expect(curve[0]!.calBP).toBe(0);
    expect(curve[curve.length - 1]!.calBP).toBe(14000);
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i]!.calBP - curve[i - 1]!.calBP).toBe(50);
    }
  });

  it('reproduces the official IntCal20 anchor rows exactly', () => {
    for (const [calBP, age14C] of OFFICIAL_ANCHORS) {
      const s = curveF14CAt(curve, calBP, 'linear');
      const ref = f14cFromRadiocarbonAge(age14C);
      expect(Math.abs(s.f14c - ref) / ref).toBeLessThan(1e-9);
      expect(s.clamped).toBe(false);
    }
  });

  it('converts the 14C-age column with its sigma into F14C units', () => {
    // Row calBP=3050: 14C age 2897 ± 18 -> F = exp(-2897/8033), sigma_F = F·18/8033
    const row = curve.find((p) => p.calBP === 3050)!;
    const f = f14cFromRadiocarbonAge(2897);
    expect(Math.abs(row.f14c - f) / f).toBeLessThan(1e-12);
    expect(Math.abs(row.sigmaF14c - (f * 18) / 8033) / f).toBeLessThan(1e-12);
  });

  it('step mode returns the lower bracketing row; outside range clamps', () => {
    const at3074 = curveF14CAt(curve, 3074, 'step');
    const at3050 = curveF14CAt(curve, 3050, 'step');
    expect(at3074.f14c).toBe(at3050.f14c);
    const low = curveF14CAt(curve, -10, 'linear');
    const high = curveF14CAt(curve, 20000, 'linear');
    expect(low.clamped).toBe(true);
    expect(high.clamped).toBe(true);
    expect(low.f14c).toBe(curve[0]!.f14c);
    expect(high.f14c).toBe(curve[curve.length - 1]!.f14c);
  });
});

describe('geo-carbondating · likelihood calibration', () => {
  it('an exact-curve measurement lands the chi2 minimum on its own row', () => {
    const f = curveF14CAt(curve, 3050, 'linear').f14c;
    const res = calibrateF14C(curve, f, 0.005, { mode: 'linear' });
    expect(res).not.toBeNull();
    expect(res!.bestFitCalBP).toBe(3050);
    expect(res!.chi2Min).toBeLessThan(1e-12);
    // the 1-sigma interval must contain the best fit
    const inside = res!.interval1.some((r) => r.from <= 3050 && 3050 <= r.to);
    expect(inside).toBe(true);
    // 2-sigma support spans at least the 1-sigma support
    const span1 = res!.interval1.reduce((a, r) => a + (r.to - r.from), 0);
    const span2 = res!.interval2.reduce((a, r) => a + (r.to - r.from), 0);
    expect(span2).toBeGreaterThanOrEqual(span1);
  });

  it('the official anchor measurement recalibrates to its own calendar age', () => {
    const f = f14cFromRadiocarbonAge(INT_CAL20_ANCHOR.age14C);
    const sigmaF = (f * INT_CAL20_ANCHOR.sigma) / MEAN_LIFE_14C;
    const res = calibrateF14C(curve, f, sigmaF, { mode: 'linear' });
    expect(res).not.toBeNull();
    // The chi2 minimum must sit within one 50-yr grid step of the anchor.
    expect(Math.abs(res!.bestFitCalBP - INT_CAL20_ANCHOR.calBP)).toBeLessThanOrEqual(50);
  });

  it('demoMeasurement is deterministic and its calibration recovers ~3050 cal BP', () => {
    const a = demoMeasurement(curve, 3050);
    const b = demoMeasurement(curve, 3050);
    expect(a).toEqual(b);
    expect(a).not.toBeNull();
    const res = calibrateF14C(curve, a!.f14c, a!.sigma, { mode: 'linear' });
    expect(res).not.toBeNull();
    expect(Math.abs(res!.bestFitCalBP - 3050)).toBeLessThanOrEqual(100);
  });

  it('returns null for degenerate inputs', () => {
    expect(calibrateF14C([], 0.7, 0.005)).toBeNull();
    expect(calibrateF14C(curve, 0.7, 0)).toBeNull();
    expect(calibrateF14C(curve, Number.NaN, 0.005)).toBeNull();
  });
});

describe('geo-carbondating · multi-sample combination', () => {
  it('identical samples average to sigma/sqrt(2) with zero scatter', () => {
    const c = combineF14C([
      { f14c: 0.7, sigma: 0.005 },
      { f14c: 0.7, sigma: 0.005 },
    ])!;
    expect(c.f14c).toBeCloseTo(0.7, 12);
    expect(c.sigma).toBeCloseTo(0.005 / Math.SQRT2, 12);
    expect(c.chi2Red).toBeCloseTo(0, 12);
  });

  it('scatter about the weighted mean is flagged by reduced chi2', () => {
    const c = combineF14C([
      { f14c: 0.7, sigma: 0.005 },
      { f14c: 0.72, sigma: 0.005 },
    ])!;
    expect(c.f14c).toBeCloseTo(0.71, 12);
    // each deviates by 2 sigma -> chi2 = 8 on 1 dof
    expect(c.chi2Red).toBeCloseTo(8, 9);
  });
});

describe('geo-carbondating · validation benchmarks', () => {
  it('all three pass on the real IntCal20 excerpt', () => {
    const libby = benchmarkLibby();
    const anchor = benchmarkCurveAnchor(curve);
    const interp = benchmarkInterpolation(curve);
    expect(libby.passed).toBe(true);
    expect(anchor.passed).toBe(true);
    expect(interp.passed).toBe(true);
  });
});
