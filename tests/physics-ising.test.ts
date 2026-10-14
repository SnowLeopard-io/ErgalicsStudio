import { describe, expect, it } from 'vitest';
import {
  IsingLattice,
  ONSAGER_TC,
  estimateTcFromChi,
  exact2x2,
  exactEnumerate,
  mulberry32,
  onsagerMagnetization,
  runIsingPoint,
} from '../src/plugins/builtin/physics-ising/kernel';

const relErr = (a: number, b: number): number => Math.abs(a - b) / Math.abs(b);

describe('ising exact solutions', () => {
  it('closed-form 2x2 solution matches brute-force enumeration to <1e-9 at several temperatures', () => {
    for (const T of [1.0, 1.5, ONSAGER_TC, 3.0, 5.0]) {
      const closed = exact2x2(T, 1);
      const enumd = exactEnumerate(2, T, 1, 0);
      expect(relErr(closed.Z, enumd.Z)).toBeLessThan(1e-9);
      expect(relErr(closed.energyPerSpin, enumd.energyPerSpin)).toBeLessThan(1e-9);
      expect(relErr(closed.absM, enumd.absM)).toBeLessThan(1e-9);
      expect(relErr(closed.m2, enumd.m2)).toBeLessThan(1e-9);
      expect(relErr(closed.m4, enumd.m4)).toBeLessThan(1e-9);
      expect(relErr(closed.chi, enumd.chi)).toBeLessThan(1e-9);
      expect(relErr(closed.heatCapacity, enumd.heatCapacity)).toBeLessThan(1e-9);
      expect(Math.abs(closed.binder - enumd.binder)).toBeLessThan(1e-9);
    }
  });

  it('2x2 partition function hits the textbook limits Z(hot) = 16 and Z(cold) = 2 e^{8K}', () => {
    const hot = exactEnumerate(2, 1e7, 1, 0);
    expect(Math.abs(hot.Z - 16)).toBeLessThan(1e-6);
    expect(Math.abs(hot.m2 - 0.25)).toBeLessThan(1e-6); // random spins: <m^2> = 1/N
    const cold = exactEnumerate(2, 0.01, 1, 0);
    expect(Math.abs(cold.energyPerSpin + 2)).toBeLessThan(1e-9); // E/N -> -2J
    expect(Math.abs(cold.absM - 1)).toBeLessThan(1e-9);
    const closedCold = exact2x2(0.05, 1); // e^{160} still finite; e^{800} would overflow
    expect(relErr(closedCold.Z, 2 * Math.exp(8 / 0.05))).toBeLessThan(1e-9);
  });

  it('4x4 enumeration with a field aligns spins: E/N -> -2J - H, |m| -> 1', () => {
    const r = exactEnumerate(4, 2.0, 1, 5);
    // Finite T keeps a small density of flipped spins (~e^{-beta*2(J*4+H)}),
    // so the ground-state limit is approached but not reached exactly.
    expect(Math.abs(r.energyPerSpin - (-2 - 5))).toBeLessThan(0.01);
    expect(Math.abs(r.absM - 1)).toBeLessThan(0.005);
  });
});

describe('ising lattice bookkeeping', () => {
  it('all-up lattice energy equals -2 J L^2 (each of the 2L^2 bonds contributes -J)', () => {
    const L = 6;
    const spins = new Int8Array(L * L).fill(1);
    const lat = new IsingLattice(L, 1, 0, mulberry32(1), spins);
    expect(lat.energy).toBeCloseTo(-2 * L * L, 10);
  });

  it('incremental Metropolis energy stays exact against recomputation', () => {
    const lat = new IsingLattice(10, 1, 0, mulberry32(3));
    lat.setTemperature(3);
    for (let k = 0; k < 100; k++) lat.metropolisSweep();
    expect(Math.abs(lat.recomputeEnergy() - lat.energy)).toBeLessThan(1e-8);
  });

  it('incremental Wolff energy stays exact and flips conserve nothing but energy bookkeeping', () => {
    const lat = new IsingLattice(8, 1, 0, mulberry32(11));
    lat.setTemperature(2.4);
    for (let k = 0; k < 60; k++) lat.wolffSweep();
    expect(Math.abs(lat.recomputeEnergy() - lat.energy)).toBeLessThan(1e-8);
  });
});

describe('ising Monte Carlo vs exact enumeration (2x2)', () => {
  it('auto algorithm matches exact <E>, <|m|>, <m^2> within 2% at cold / critical / hot points', () => {
    for (const T of [1.5, ONSAGER_TC, 3.5]) {
      const ex = exactEnumerate(2, T, 1, 0);
      const mc = runIsingPoint({
        L: 2,
        T,
        J: 1,
        H: 0,
        thermSweeps: 20000,
        measureSweeps: 400000,
        seed: 42,
        algorithm: 'auto',
      });
      expect(relErr(mc.energyPerSpin, ex.energyPerSpin)).toBeLessThan(0.02);
      expect(relErr(mc.absM, ex.absM)).toBeLessThan(0.02);
      expect(relErr(mc.m2, ex.m2)).toBeLessThan(0.02);
      expect(Math.abs(mc.binder - ex.binder)).toBeLessThan(0.1);
    }
  });

  it('pure Metropolis also agrees with the exact solution at Tc', () => {
    const ex = exactEnumerate(2, ONSAGER_TC, 1, 0);
    const mc = runIsingPoint({
      L: 2,
      T: ONSAGER_TC,
      J: 1,
      H: 0,
      thermSweeps: 20000,
      measureSweeps: 400000,
      seed: 7,
      algorithm: 'metropolis',
    });
    expect(mc.algorithmUsed).toBe('metropolis');
    expect(relErr(mc.energyPerSpin, ex.energyPerSpin)).toBeLessThan(0.03);
    expect(relErr(mc.absM, ex.absM)).toBeLessThan(0.03);
  });

  it('finite field (Metropolis fallback) matches the exact enumeration within tolerance', () => {
    const ex = exactEnumerate(2, 3.0, 1, 0.3);
    const mc = runIsingPoint({
      L: 2,
      T: 3.0,
      J: 1,
      H: 0.3,
      thermSweeps: 20000,
      measureSweeps: 400000,
      seed: 13,
      algorithm: 'auto',
    });
    expect(mc.algorithmUsed).toBe('metropolis');
    expect(relErr(mc.energyPerSpin, ex.energyPerSpin)).toBeLessThan(0.02);
    expect(relErr(mc.absM, ex.absM)).toBeLessThan(0.02);
  });
});

describe('critical temperature from a 64x64 susceptibility scan', () => {
  it('chi-peak parabola locates Tc = 2/ln(1+sqrt 2) within +-0.05 (fixed seeds)', () => {
    const L = 64;
    // Coarse sweep T in [1.5, 3.5], 21 points, step 0.1.
    const coarse: Array<{ T: number; chi: number }> = [];
    for (let i = 0; i <= 20; i++) {
      const T = 1.5 + i * 0.1;
      const r = runIsingPoint({
        L,
        T,
        J: 1,
        H: 0,
        thermSweeps: 150,
        measureSweeps: 600,
        seed: 1000 + i,
        algorithm: 'auto',
      });
      coarse.push({ T, chi: r.chi });
    }
    const coarseEst = estimateTcFromChi(coarse);
    expect(coarseEst).not.toBeNull();
    let center = coarseEst!.tc;
    expect(Math.abs(center - ONSAGER_TC)).toBeLessThan(0.15);

    // Fine sweep +-0.12 around the coarse peak, step 0.02 (13 points);
    // recenter once if the discrete maximum touches the window edge.
    const scanWindow = (c: number, seedBase: number): Array<{ T: number; chi: number }> => {
      const pts: Array<{ T: number; chi: number }> = [];
      for (let i = 0; i <= 12; i++) {
        const T = c - 0.12 + i * 0.02;
        if (T < 1.5 || T > 3.5) continue;
        const r = runIsingPoint({
          L,
          T,
          J: 1,
          H: 0,
          thermSweeps: 150,
          measureSweeps: 1600,
          seed: seedBase + i,
          algorithm: 'auto',
        });
        pts.push({ T, chi: r.chi });
      }
      return pts;
    };
    let fine = scanWindow(center, 7000);
    let iMax = 0;
    for (let i = 1; i < fine.length; i++) if (fine[i]!.chi > fine[iMax]!.chi) iMax = i;
    if (iMax === 0 || iMax === fine.length - 1) {
      center = fine[iMax]!.T;
      fine = scanWindow(center, 9000);
    }
    const est = estimateTcFromChi(fine);
    expect(est).not.toBeNull();
    expect(Math.abs(est!.tc - ONSAGER_TC)).toBeLessThan(0.05);
    expect(est!.tcErr).toBeGreaterThan(0);
    expect(est!.tcErr).toBeLessThan(0.3);
  }, 90000);
});

describe('Onsager magnetisation curve (64x64, T < Tc)', () => {
  it('measured <|m|> follows m(T) = (1 - sinh^{-4}(2/T))^{1/8} within 2%', () => {
    for (const T of [1.7, 2.0, 2.15]) {
      const r = runIsingPoint({
        L: 64,
        T,
        J: 1,
        H: 0,
        thermSweeps: 300,
        measureSweeps: 1500,
        seed: 99 + Math.round(T * 10),
        algorithm: 'auto',
      });
      const exact = onsagerMagnetization(T, 1);
      expect(relErr(r.absM, exact)).toBeLessThan(0.02);
    }
  }, 30000);

  it('Onsager formula vanishes at and above Tc and tends to 1 deep below', () => {
    expect(onsagerMagnetization(ONSAGER_TC, 1)).toBe(0);
    expect(onsagerMagnetization(3.0, 1)).toBe(0);
    expect(onsagerMagnetization(0.5, 1)).toBeGreaterThan(0.999);
  });
});

describe('Binder cumulant crossing', () => {
  it('U4 at Tc on 64x64 sits in the 2-D Ising universal window (0.55, 0.67)', () => {
    const r = runIsingPoint({
      L: 64,
      T: ONSAGER_TC,
      J: 1,
      H: 0,
      thermSweeps: 300,
      measureSweeps: 2500,
      seed: 2024,
      algorithm: 'auto',
    });
    expect(r.binder).toBeGreaterThan(0.55);
    expect(r.binder).toBeLessThan(0.67);
  }, 30000);
});

describe('reproducibility', () => {
  it('identical seeds give bit-identical observables and configurations', () => {
    const mk = (seed: number) =>
      runIsingPoint({ L: 32, T: 2.269, J: 1, H: 0, thermSweeps: 100, measureSweeps: 200, seed, algorithm: 'auto' });
    const a = mk(5);
    const b = mk(5);
    const c = mk(6);
    expect(a.chi).toBe(b.chi);
    expect(a.absM).toBe(b.absM);
    expect(a.heatCapacity).toBe(b.heatCapacity);
    expect(Array.from(a.spins)).toEqual(Array.from(b.spins));
    expect(a.absM).not.toBe(c.absM);
  });

  it('susceptibility and specific heat are positive in the ordered and disordered phases', () => {
    for (const T of [1.8, 3.0]) {
      const r = runIsingPoint({ L: 32, T, J: 1, H: 0, thermSweeps: 200, measureSweeps: 500, seed: 31, algorithm: 'auto' });
      expect(r.chi).toBeGreaterThan(0);
      expect(r.heatCapacity).toBeGreaterThan(0);
    }
  });
});
