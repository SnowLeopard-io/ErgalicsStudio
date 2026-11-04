// ==========================================================================
// eng-vibration kernel benchmarks — analytic cross-references for the
// structural vibration laboratory (pure numeric core, no DOM).
//
// Benchmarks covered (mirrors the research tiers in the plugin manifest):
//   1. SDOF log decrement     delta = 2*pi*zeta/sqrt(1-zeta^2) recovery
//   2. Damped frequency       wd = wn*sqrt(1-zeta^2) from the peak spacing
//   3. RK4 vs closed form     free-decay integration accuracy
//   4. Chain eigenvalues      2-DOF {10, 10*sqrt(3)} rad/s; 3-DOF uniform
//                             chain 2*sqrt(k/m)*sin(r*pi/8), whose modes 1
//                             and 3 are the spec values
//                             sqrt(k/m)*{sqrt(2-sqrt(2)), sqrt(2+sqrt(2))}
//   5. FRF resonance peak     receptance peaks at wn*sqrt(1-2*zeta^2)
//   6. Half-power (-3 dB)     zeta / wn identification from a dB sweep
//   7. Isolation boundary     T(sqrt(2)) = 1 exactly for every zeta
//   8. Transmissibility peak  closed form vs dense numeric argmax
//   9. Unbalance peak         r_peak = 1/sqrt(1-2*zeta^2),
//                             A_peak = 1/(2*zeta*sqrt(1-zeta^2)),
//                             exactly 90 deg lag and 1/(2*zeta) at r = 1
//  10. Determinism            bitwise-identical repeats; VibrationError
//                             on out-of-range parameters
// ==========================================================================

import { describe, expect, it } from 'vitest';
import {
  type SdofParams,
  VibrationError,
  buildChain,
  chainAnalyticOmega,
  decayIdentify,
  generalizedEigenDiagM,
  halfPowerIdentify,
  logspace,
  sdofDerived,
  sdofFreeDecayRk4,
  sdofFrf,
  sdofReceptance,
  transmissibility,
  transmissibilityPeak,
  unbalancePeak,
  unbalancePoint,
} from '../src/plugins/builtin/engineering/vibration/kernel';

/** Unified relative-error yardstick: |computed − analytic| / |analytic|. */
function relErr(computed: number, analytic: number): number {
  return Math.abs(computed - analytic) / Math.abs(analytic);
}

/** Canonical underdamped SDOF: wn = 20 rad/s, zeta = 0.05, wd ≈ 19.975 rad/s. */
const P: SdofParams = { m: 1, k: 400, c: 2 };

describe('eng-vibration SDOF free decay (RK4 vs closed form)', () => {
  // 3 s at 0.5 ms steps: ~9.5 damped periods (~630 steps per period).
  const sim = sdofFreeDecayRk4(P, 1, 0, 3, 6000);
  const { wn, zeta, wd } = sdofDerived(P);
  const deltaAnalytic = (2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta);

  it('RK4 stays on the exact damped solution (max rel. dev < 1e-5, velocity too)', () => {
    expect(sim.maxRelDev).toBeGreaterThan(0); // the comparison is non-trivial
    expect(sim.maxRelDev).toBeLessThan(1e-5);
    let maxVExact = 0;
    let maxVDev = 0;
    for (let i = 0; i < sim.t.length; i += 1) {
      maxVExact = Math.max(maxVExact, Math.abs(sim.vExact[i]!));
      maxVDev = Math.max(maxVDev, Math.abs(sim.vNum[i]! - sim.vExact[i]!));
    }
    expect(maxVDev / maxVExact).toBeLessThan(1e-5);
  });

  it('log decrement recovers delta = 2*pi*zeta/sqrt(1-zeta^2) and zeta (rel. err < 0.2 %)', () => {
    const id = decayIdentify(sim.t, sim.xNum);
    expect(id.ok).toBe(true);
    expect(id.peaks).toBeGreaterThanOrEqual(5);
    expect(relErr(id.delta, deltaAnalytic)).toBeLessThan(2e-3);
    // zeta = delta/sqrt(4*pi^2 + delta^2) back-conversion.
    expect(relErr(id.zeta, zeta)).toBeLessThan(2e-3);
  });

  it('peak spacing gives wd = wn*sqrt(1-zeta^2); wn follows (rel. err < 0.1 %)', () => {
    const id = decayIdentify(sim.t, sim.xNum);
    expect(relErr(id.wd, wd)).toBeLessThan(1e-3);
    expect(relErr(id.wd, wn * Math.sqrt(1 - zeta * zeta))).toBeLessThan(1e-3);
    expect(relErr(id.wn, wn)).toBeLessThan(1e-3);
  });

  it('identification reports failure for too-short or non-decaying signals', () => {
    expect(decayIdentify([0, 0.5, 1], [1, 2, 3]).ok).toBe(false);
    // Exponentially GROWING oscillation: every peak ratio drops below 1.
    const t: number[] = [];
    const x: number[] = [];
    for (let i = 0; i < 400; i += 1) {
      const ti = i * 0.005;
      t.push(ti);
      x.push(Math.exp(0.5 * ti) * Math.sin((2 * Math.PI * ti) / 0.5));
    }
    expect(decayIdentify(t, x).ok).toBe(false);
  });
});

describe('eng-vibration MDOF chain eigenanalysis (generalized Jacobi)', () => {
  it('2-DOF uniform fixed-fixed chain: omega = {10, 10*sqrt(3)} rad/s (rel. err < 1e-9)', () => {
    // Two unit masses, three equal springs k = 100: K = [[200, -100], [-100, 200]].
    const modes = generalizedEigenDiagM(buildChain([1, 1], [100, 100]));
    expect(modes.n).toBe(2);
    expect(relErr(modes.omega[0]!, 10)).toBeLessThan(1e-9);
    expect(relErr(modes.omega[1]!, 10 * Math.sqrt(3))).toBeLessThan(1e-9);
    // Published modal frequencies f = omega/(2*pi): {10, 10*sqrt(3)}/(2*pi) Hz.
    // Mass-normalized shapes: Phi^T M Phi = I with M = I (unit masses).
    const phi = modes.shapes; // shapes[dof][mode]
    for (let r = 0; r < 2; r += 1) {
      for (let s = r; s < 2; s += 1) {
        let acc = 0;
        for (let i = 0; i < 2; i += 1) acc += phi[i]![r]! * phi[i]![s]!;
        expect(Math.abs(acc - (r === s ? 1 : 0))).toBeLessThan(1e-10);
      }
    }
    // Uniform 2-DOF chain: mode 1 in-phase [1,1]/sqrt(2), mode 2 anti-phase [1,-1]/sqrt(2).
    expect(Math.abs(Math.abs(phi[0]![0]!) - Math.SQRT1_2)).toBeLessThan(1e-9);
    expect(phi[0]![0]! * phi[1]![0]!).toBeGreaterThan(0);
    expect(phi[0]![1]! * phi[1]![1]!).toBeLessThan(0);
  });

  it('3-DOF uniform chain matches 2*sqrt(k/m)*sin(r*pi/8); spec benchmark values are modes 1 and 3', () => {
    const modes = generalizedEigenDiagM(buildChain([1, 1, 1], [100, 100, 100, 100]));
    const ref = chainAnalyticOmega(3, 1, 100); // 2*sqrt(k/m)*sin(r*pi/(2*(n+1)))
    for (let r = 0; r < 3; r += 1) expect(relErr(modes.omega[r]!, ref[r]!)).toBeLessThan(1e-9);
    // Task benchmark f = sqrt(k/m)*{sqrt(2-sqrt(2)), sqrt(2+sqrt(2))}/(2*pi):
    // exactly the fundamental (r = 1) and highest (r = 3) modes of the
    // uniform 3-DOF chain, since 2*sin(pi/8) = sqrt(2-sqrt(2)) and
    // 2*sin(3*pi/8) = sqrt(2+sqrt(2)).
    expect(relErr(ref[0]!, 10 * Math.sqrt(2 - Math.SQRT2))).toBeLessThan(1e-12);
    expect(relErr(ref[2]!, 10 * Math.sqrt(2 + Math.SQRT2))).toBeLessThan(1e-12);
    // Mass-orthonormality of the full mode matrix.
    const phi = modes.shapes;
    for (let r = 0; r < 3; r += 1) {
      for (let s = r; s < 3; s += 1) {
        let acc = 0;
        for (let i = 0; i < 3; i += 1) acc += phi[i]![r]! * phi[i]![s]!;
        expect(Math.abs(acc - (r === s ? 1 : 0))).toBeLessThan(1e-10);
      }
    }
  });
});

describe('eng-vibration FRF (receptance) and half-power identification', () => {
  it('receptance peaks at wn*sqrt(1-2*zeta^2) with value 1/(2*zeta*k*sqrt(1-zeta^2)) (rel. err < 1e-5)', () => {
    const zeta = 0.1;
    const p: SdofParams = { m: 1, k: 400, c: 2 * zeta * Math.sqrt(1 * 400) };
    const { wn } = sdofDerived(p);
    const wPeak = wn * Math.sqrt(1 - 2 * zeta * zeta);
    // Dense deterministic log sweep around the peak (grid step ~1e-4 rad/s).
    const w = logspace(0.9 * wn, 1.1 * wn, 40001);
    let imax = 0;
    let hMax = 0;
    for (let i = 0; i < w.length; i += 1) {
      const h = sdofReceptance(p, w[i]!);
      if (h.mag > hMax) {
        hMax = h.mag;
        imax = i;
      }
    }
    expect(relErr(w[imax]!, wPeak)).toBeLessThan(1e-5);
    expect(relErr(hMax, 1 / (2 * zeta * 400 * Math.sqrt(1 - zeta * zeta)))).toBeLessThan(1e-6);
  });

  it('phase lag: ~0 deg below resonance, exactly 90 deg at wn, ~180 deg above', () => {
    const { wn } = sdofDerived(P);
    expect(sdofReceptance(P, 0.01 * wn).phaseLagDeg).toBeLessThan(1);
    // k - m*wn^2 = 0 exactly at wn, so atan2(c*wn, 0) = pi/2.
    expect(Math.abs(sdofReceptance(P, wn).phaseLagDeg - 90)).toBeLessThan(1e-9);
    expect(sdofReceptance(P, 100 * wn).phaseLagDeg).toBeGreaterThan(179);
  });

  it('half-power (-3 dB) identification recovers zeta within 2 % and wr/wn within 0.5 %', () => {
    const id = halfPowerIdentify(sdofFrf(P)); // zeta = 0.05, wn = 20
    expect(id.ok).toBe(true);
    expect(relErr(id.zeta, 0.05)).toBeLessThan(0.02);
    expect(relErr(id.wr, 20 * Math.sqrt(1 - 2 * 0.05 * 0.05))).toBeLessThan(0.005);
    expect(relErr(id.wn, 20)).toBeLessThan(0.005);
  });
});

describe('eng-vibration base-excitation transmissibility', () => {
  const zetas = [0.02, 0.05, 0.1, 0.2, 0.5, 1];

  it('T(sqrt(2)) = 1 exactly for every damping ratio (isolation boundary)', () => {
    for (const z of zetas) {
      expect(Math.abs(transmissibility(z, Math.SQRT2) - 1)).toBeLessThan(1e-12);
    }
  });

  it('T > 1 below r = sqrt(2) and T < 1 above it (amplification vs isolation)', () => {
    for (const z of zetas) {
      expect(transmissibility(z, 0.5)).toBeGreaterThan(1);
      expect(transmissibility(z, 1)).toBeGreaterThan(1);
      expect(transmissibility(z, 2)).toBeLessThan(1);
      expect(transmissibility(z, 5)).toBeLessThan(1);
    }
  });

  it('closed-form peak matches a dense numeric argmax (rel. err < 1e-6)', () => {
    const z = 0.1;
    const pk = transmissibilityPeak(z);
    const n = 2000001;
    const lo = 0.5;
    const step = 1 / (n - 1); // r in [0.5, 1.5]
    let rBest = lo;
    let tBest = 0;
    for (let i = 0; i < n; i += 1) {
      const r = lo + i * step;
      const t = transmissibility(z, r);
      if (t > tBest) {
        tBest = t;
        rBest = r;
      }
    }
    expect(relErr(rBest, pk.rPeak)).toBeLessThan(1e-6);
    expect(Math.abs(tBest - pk.tMax)).toBeLessThan(1e-6);
  });

  it('small-damping peak approaches 1/(2*zeta): tMax(0.05) within 1 % of 10', () => {
    expect(relErr(transmissibilityPeak(0.05).tMax, 10)).toBeLessThan(0.01);
  });
});

describe('eng-vibration rotating unbalance', () => {
  it('amplitude peaks at r = 1/sqrt(1-2*zeta^2) with value 1/(2*zeta*sqrt(1-zeta^2)) (rel. err < 1e-6)', () => {
    const z = 0.2;
    const pk = unbalancePeak(z);
    const n = 2000001;
    const lo = 0.5;
    const step = 1.5 / (n - 1); // r in [0.5, 2]
    let rBest = lo;
    let aBest = 0;
    for (let i = 0; i < n; i += 1) {
      const pt = unbalancePoint(z, lo + i * step);
      if (pt.ampNorm > aBest) {
        aBest = pt.ampNorm;
        rBest = pt.r;
      }
    }
    expect(relErr(rBest, pk.rPeak)).toBeLessThan(1e-6);
    expect(relErr(aBest, pk.ampPeak)).toBeLessThan(1e-6);
  });

  it('at r = 1 the amplitude is exactly 1/(2*zeta) and the phase lag is exactly 90 degrees', () => {
    for (const z of [0.05, 0.2, 0.5]) {
      const pt = unbalancePoint(z, 1);
      expect(relErr(pt.ampNorm, 1 / (2 * z))).toBeLessThan(1e-12);
      expect(Math.abs(pt.phaseLagDeg - 90)).toBeLessThan(1e-9);
    }
  });

  it('rejects zeta >= 1/sqrt(2), where no interior peak exists', () => {
    expect(() => unbalancePeak(0.8)).toThrow(/zeta/);
    expect(() => unbalancePoint(0, 1)).toThrow(/zeta/);
  });
});

describe('eng-vibration determinism and parameter validation', () => {
  it('repeated runs are bitwise identical (no hidden randomness)', () => {
    const a = sdofFreeDecayRk4(P, 1, 0.5, 2, 4000);
    const b = sdofFreeDecayRk4(P, 1, 0.5, 2, 4000);
    expect(a.t).toEqual(b.t);
    expect(a.xNum).toEqual(b.xNum);
    expect(a.vNum).toEqual(b.vNum);
    const s1 = sdofFrf(P);
    const s2 = sdofFrf(P);
    expect(s1.w).toEqual(s2.w);
    expect(s1.magDb).toEqual(s2.magDb);
    expect(s1.phaseLagDeg).toEqual(s2.phaseLagDeg);
  });

  it('rejects out-of-range parameters with VibrationError', () => {
    expect(() => sdofDerived({ m: 0, k: 400, c: 2 })).toThrow(VibrationError);
    expect(() => sdofDerived({ m: -1, k: 400, c: 2 })).toThrow(/mass/);
    expect(() => sdofDerived({ m: 1, k: 0, c: 2 })).toThrow(/stiffness/);
    expect(() => sdofDerived({ m: 1, k: 400, c: -1 })).toThrow(/damping/);
    expect(() => buildChain([], [100])).toThrow(/mass/);
    expect(() => buildChain([1, 1], [100])).toThrow(/spring/);
    expect(() => transmissibilityPeak(-1)).toThrow(/zeta/);
    expect(() => unbalancePeak(0.8)).toThrow(/zeta/);
  });
});
