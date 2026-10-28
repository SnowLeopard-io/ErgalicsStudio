import { describe, expect, it } from 'vitest';
import {
  R,
  computeCycle,
  sampleSegment,
  type EngineInput,
} from '../src/plugins/builtin/physics/heatengine/kernel';

const relErr = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

const base: EngineInput = {
  cycle: 'otto',
  n: 1,
  gamma: 1.4,
  Tcold: 300,
  Thot: 2000,
  ratio: 8,
  cutoff: 2,
  regenerative: false,
  Vmin: 1e-3,
};

describe('heat engine closed-form benchmarks', () => {
  it('Otto efficiency matches eta = 1 - r^(1-gamma) to <1e-4 (r=8, gamma=1.4 => 0.5647)', () => {
    const r = computeCycle({ ...base, cycle: 'otto' });
    expect(r).not.toBeNull();
    const closed = 1 - Math.pow(8, -0.4);
    expect(relErr(r!.eta, closed)).toBeLessThan(1e-4);
    expect(r!.eta).toBeCloseTo(0.5647, 3);
    // Net work against the endpoint-sum form W = c_v [(T3-T2) - (T4-T1)].
    const cv = R / 0.4;
    const T2 = 300 * Math.pow(8, 0.4);
    const T4 = 2000 / Math.pow(8, 0.4);
    const wClosed = cv * (2000 - T2 - (T4 - 300));
    expect(relErr(r!.W, wClosed)).toBeLessThan(1e-6);
    // Isochoric heat input is exact: Q_in = c_v (T3 - T2).
    expect(relErr(r!.Qin, cv * (2000 - T2))).toBeLessThan(1e-9);
  });

  it('Carnot efficiency is exactly 1 - Tc/Th with W = nR(Th-Tc) ln r', () => {
    const r = computeCycle({ ...base, cycle: 'carnot', n: 2, Thot: 600, Tcold: 300, ratio: 4 });
    expect(r).not.toBeNull();
    expect(relErr(r!.eta, 0.5)).toBeLessThan(1e-6);
    expect(relErr(r!.W, 2 * R * 300 * Math.log(4))).toBeLessThan(1e-6);
    // Isothermal trapezoid residual is O(du^2) ~ 1e-7 relative.
    expect(relErr(r!.Qin, 2 * R * 600 * Math.log(4))).toBeLessThan(1e-6);
    expect(relErr(r!.Qout, 2 * R * 300 * Math.log(4))).toBeLessThan(1e-6);
  });

  it('Stirling with a perfect regenerator reaches the Carnot efficiency; without it, the closed form', () => {
    const common = { ...base, cycle: 'stirling' as const, Thot: 600, Tcold: 300, ratio: 3 };
    const regen = computeCycle({ ...common, regenerative: true });
    expect(regen).not.toBeNull();
    expect(relErr(regen!.eta, 0.5)).toBeLessThan(1e-9);
    expect(relErr(regen!.W, R * 300 * Math.log(3))).toBeLessThan(1e-6);
    // Only the hot isotherm draws external heat when regeneration is perfect.
    expect(relErr(regen!.Qin, R * 600 * Math.log(3))).toBeLessThan(1e-6);

    const plain = computeCycle({ ...common, regenerative: false });
    expect(plain).not.toBeNull();
    const cv = R / 0.4;
    const wNet = R * 300 * Math.log(3);
    const qinClosed = R * 600 * Math.log(3) + cv * 300;
    expect(relErr(plain!.Qin, qinClosed)).toBeLessThan(1e-6);
    expect(relErr(plain!.eta, wNet / qinClosed)).toBeLessThan(1e-6);
    expect(plain!.eta).toBeLessThan(regen!.eta);
  });

  it('Diesel efficiency matches the cutoff-ratio formula to <1e-4 (r=8, rc=2, gamma=1.4 => 0.4904)', () => {
    const r = computeCycle({ ...base, cycle: 'diesel' });
    expect(r).not.toBeNull();
    const closed =
      1 - Math.pow(8, -0.4) * ((Math.pow(2, 1.4) - 1) / (1.4 * (2 - 1)));
    expect(relErr(r!.eta, closed)).toBeLessThan(1e-4);
    expect(r!.eta).toBeCloseTo(0.4904, 3);
    // The isobaric branch fixes the peak temperature: T3 = T2 * rc.
    const T2 = 300 * Math.pow(8, 0.4);
    const cp = (1.4 / 0.4) * R;
    expect(relErr(r!.Qin, cp * (T2 * 2 - T2))).toBeLessThan(1e-6);
  });
});

describe('first law and branch bookkeeping', () => {
  const cases: EngineInput[] = [
    { ...base, cycle: 'otto' },
    { ...base, cycle: 'diesel' },
    { ...base, cycle: 'carnot', Thot: 600, ratio: 4, n: 2 },
    { ...base, cycle: 'stirling', Thot: 600, ratio: 3 },
    { ...base, cycle: 'stirling', Thot: 600, ratio: 3, regenerative: true },
    { ...base, cycle: 'otto', gamma: 5 / 3, ratio: 12, Thot: 2500 },
  ];

  it('W = Qin - Qout closes for every cycle (first law over the loop)', () => {
    for (const c of cases) {
      const r = computeCycle(c);
      expect(r).not.toBeNull();
      expect(Math.abs(r!.closure)).toBeLessThan(1e-6 * Math.max(1, Math.abs(r!.W)));
    }
  });

  it('isochoric branches do exactly zero work; isothermal branch heat equals its work', () => {
    for (const c of cases) {
      const r = computeCycle(c)!;
      for (const s of r.segments) {
        if (s.kind === 'isochoric') expect(s.W).toBe(0);
        if (s.kind === 'isothermal') expect(relErr(Math.abs(s.Q), Math.abs(s.W))).toBeLessThan(1e-12);
      }
    }
  });

  it('corner states satisfy pV = nRT and the Otto adiabatic relation T2 = T1 r^(gamma-1)', () => {
    const r = computeCycle(base)!;
    for (const p of r.states) {
      expect(Math.abs(p.p * p.V - base.n * R * p.T)).toBeLessThan(1e-6 * Math.max(1, p.p * p.V));
    }
    const T2 = 300 * Math.pow(8, 0.4);
    expect(relErr(r.states[1]!.T, T2)).toBeLessThan(1e-12);
    expect(relErr(r.states[3]!.T, 2000 / Math.pow(8, 0.4))).toBeLessThan(1e-12);
    // etaAnalytic is reported alongside the numeric efficiency.
    expect(relErr(r.etaAnalytic, 1 - Math.pow(8, -0.4))).toBeLessThan(1e-12);
  });

  it('sampleSegment reproduces the branch endpoints and the isothermal law pV = const', () => {
    const r = computeCycle({ ...base, cycle: 'carnot', Thot: 600, ratio: 4 })!;
    const iso = r.segments[1]!;
    const pts = sampleSegment(iso, 2, 1.4, 50);
    expect(pts.length).toBe(50);
    expect(relErr(pts[0]!.V, iso.Va)).toBeLessThan(1e-12);
    expect(relErr(pts[pts.length - 1]!.V, iso.Vb)).toBeLessThan(1e-12);
    for (const q of pts) expect(relErr(q.p * q.V, 2 * R * 600)).toBeLessThan(1e-9);
    const ad = r.segments[0]!;
    const adPts = sampleSegment(ad, 2, 1.4, 40);
    // Adiabat: p V^gamma = n R Ta Va^(gamma-1) along the whole branch.
    const kAd = 2 * R * ad.Ta * Math.pow(ad.Va, 0.4);
    for (const q of adPts) expect(relErr(q.p * Math.pow(q.V, 1.4), kAd)).toBeLessThan(1e-9);
  });
});

describe('invalid parameter combinations return null', () => {
  it('rejects non-physical inputs instead of throwing', () => {
    expect(computeCycle({ ...base, n: 0 })).toBeNull();
    expect(computeCycle({ ...base, gamma: 1 })).toBeNull();
    expect(computeCycle({ ...base, gamma: 0.5 })).toBeNull();
    expect(computeCycle({ ...base, Tcold: 0 })).toBeNull();
    expect(computeCycle({ ...base, ratio: 1 })).toBeNull();
    expect(computeCycle({ ...base, Vmin: 0 })).toBeNull();
    // Otto needs headroom above the adiabatic compression temperature.
    expect(computeCycle({ ...base, Thot: 500 })).toBeNull(); // T2 = 689 K
    // Diesel cutoff must lie inside (1, ratio].
    expect(computeCycle({ ...base, cycle: 'diesel', cutoff: 1 })).toBeNull();
    expect(computeCycle({ ...base, cycle: 'diesel', cutoff: 10 })).toBeNull();
    // Carnot / Stirling need a real temperature lift.
    expect(computeCycle({ ...base, cycle: 'carnot', Thot: 300, ratio: 4 })).toBeNull();
    expect(computeCycle({ ...base, cycle: 'stirling', Thot: 250, ratio: 3 })).toBeNull();
    expect(computeCycle({ ...base, gamma: NaN })).toBeNull();
  });
});
