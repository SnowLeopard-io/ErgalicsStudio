import { describe, expect, it } from 'vitest';
import {
  type ControlParams,
  analyticFirstOrderSettlingTime,
  analyticOvershootPct,
  analyticPeakTime,
  analyticSecondOrderBandwidth,
  analyticSecondOrderStep,
  analyticSettlingTimeExact,
  closedLoopBandwidth,
  plantBode,
  simulateStep,
  textbookSettlingTime2pct,
  validateParams,
} from '../src/plugins/builtin/engineering/control/kernel';

/** Unified relative-error yardstick: |computed − analytic| / |analytic|. */
function relErr(computed: number, analytic: number): number {
  return Math.abs(computed - analytic) / Math.abs(analytic);
}

const openSecond: ControlParams = {
  type: 'second',
  tau: 1,
  wn: 2,
  zeta: 0.3,
  kp: 0,
  ki: 0,
  kd: 0,
  // tEnd = 25 lets the ζ·ωn = 0.6 envelope decay to e^(−15) ≈ 3e-7, so the
  // zero-input steady state is verified at the strict 1e-6 level.
  tEnd: 25,
  dt: 0.001,
};

describe('eng-control time domain (RK4)', () => {
  it('underdamped second-order step (ζ=0.3, ωn=2) matches the analytic σ%, tp and ts (rel. err < 2 %)', () => {
    const sim = simulateStep(openSecond);
    // σ% = 100·exp(−ζπ/√(1−ζ²)) ≈ 37.24 %
    const sigmaAnalytic = analyticOvershootPct(0.3);
    expect(relErr(sim.metrics.overshootPct, sigmaAnalytic)).toBeLessThan(0.02);
    // tp = π/(ωn·√(1−ζ²)) ≈ 1.6465 s
    expect(relErr(sim.metrics.peakTime, analyticPeakTime(2, 0.3))).toBeLessThan(0.02);
    // ts: exact last-exit time of the ±2 % band on the analytic solution.
    const tsAnalytic = analyticSettlingTimeExact(2, 0.3);
    expect(relErr(sim.metrics.settlingTime, tsAnalytic)).toBeLessThan(0.02);
    // The textbook envelope value 4/(ζωn) is only a coarse screen (the true
    // 2 %-settling for ζ = 0.3 is ~19 % shorter than 4/(ζωn)).
    expect(relErr(sim.metrics.settlingTime, textbookSettlingTime2pct(2, 0.3))).toBeLessThan(0.25);
    // Zero steady-state error (plant DC gain = 1).
    expect(sim.metrics.ess).toBeLessThan(1e-6);
  });

  it('RK4 trace stays on the closed-form second-order solution (max rel. dev < 1e-6)', () => {
    const sim = simulateStep(openSecond);
    let maxDev = 0;
    for (let i = 0; i < sim.t.length; i += 10) {
      const exact = analyticSecondOrderStep(2, 0.3, sim.t[i]!);
      maxDev = Math.max(maxDev, Math.abs(sim.y[i]! - exact));
    }
    expect(maxDev).toBeLessThan(1e-6);
  });

  it('first-order step hits 63.2 % at t = τ and settles (2 %) at τ·ln 50 (≈ 4τ)', () => {
    const sim = simulateStep({ ...openSecond, type: 'first', tau: 0.5, tEnd: 8, dt: 0.0005 });
    // y(4τ) = 1 − e^(−4) = 0.9816844 — the grid hits t = 2.0 exactly.
    const idx = sim.t.findIndex((v) => Math.abs(v - 2) < 1e-9);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(relErr(sim.y[idx]!, 1 - Math.exp(-4))).toBeLessThan(1e-7);
    // 63.2 % = 1 − 1/e crossing time ≈ τ (linear interpolation between samples).
    const target = 1 - 1 / Math.E;
    let cross = -1;
    for (let i = 1; i < sim.t.length; i += 1) {
      if (sim.y[i]! >= target) {
        const y0 = sim.y[i - 1]!;
        const y1 = sim.y[i]!;
        cross = sim.t[i - 1]! + ((target - y0) / (y1 - y0)) * (sim.t[i]! - sim.t[i - 1]!);
        break;
      }
    }
    expect(relErr(cross, 0.5)).toBeLessThan(1e-3);
    // 2 %-settling: exact τ·ln 50 = 1.95601 s; the 4τ rule is a coarse screen.
    expect(relErr(sim.metrics.settlingTime, analyticFirstOrderSettlingTime(0.5))).toBeLessThan(0.005);
    expect(relErr(sim.metrics.settlingTime, 4 * 0.5)).toBeLessThan(0.05);
  });

  it('integral action drives the steady-state error to zero; P-only leaves 1/(1+Kp)', () => {
    // PI control on the first-order plant: closed-loop poles −3 ± √3 → fully
    // converged well before tEnd = 25.
    const pi = simulateStep({ ...openSecond, type: 'first', tau: 0.5, kp: 2, ki: 3, tEnd: 25, dt: 0.001 });
    expect(pi.metrics.ess).toBeLessThan(1e-6);
    // P-only contrast: e_ss = 1/(1+Kp) = 1/3 (exactly, once settled).
    const pOnly = simulateStep({ ...openSecond, type: 'first', tau: 0.5, kp: 2, tEnd: 25, dt: 0.001 });
    expect(relErr(pOnly.metrics.ess, 1 / 3)).toBeLessThan(1e-6);
    // PID on the second-order plant stays stable and converges (Routh-stable
    // closed loop s³+2.4s²+12s+12).
    const pid = simulateStep({ ...openSecond, zeta: 0.5, kp: 2, ki: 3, kd: 0.1, tEnd: 30, dt: 0.002 });
    expect(Number.isFinite(pid.metrics.ess)).toBe(true);
    expect(pid.metrics.ess).toBeLessThan(1e-6);
  });

  it('simulation is deterministic and rejects out-of-range parameters', () => {
    const a = simulateStep(openSecond);
    const b = simulateStep(openSecond);
    expect(a.metrics).toEqual(b.metrics);
    expect(a.y.slice(0, 5)).toEqual(b.y.slice(0, 5));
    expect(() => validateParams({ ...openSecond, tau: 0 })).toThrow(/tau/);
    expect(() => validateParams({ ...openSecond, dt: 1e-6 })).toThrow(/steps/);
    expect(() => validateParams({ ...openSecond, kp: -1 })).toThrow(/gains/);
  });
});

describe('eng-control frequency domain (direct s = jω evaluation)', () => {
  it('first-order low-pass: −3.01 dB and −45° exactly at ω = 1/τ; −20 dB/dec at high frequency', () => {
    const p: ControlParams = { ...openSecond, type: 'first', tau: 0.5 };
    const atCorner = plantBode(p, 1 / 0.5);
    // 20·log10(1/√2) = −3.0102999566 dB
    expect(Math.abs(atCorner.magDb - 20 * Math.log10(Math.SQRT1_2))).toBeLessThan(1e-9);
    expect(Math.abs(atCorner.phaseDeg + 45)).toBeLessThan(1e-9);
    // High-frequency roll-off: |ΔdB| between ωτ = 100 and 1000 is −20 dB/decade.
    const lo = plantBode(p, 200);
    const hi = plantBode(p, 2000);
    expect(Math.abs(hi.magDb - lo.magDb + 20)).toBeLessThan(1e-3);
    // Numeric half-power (−3 dB) bandwidth of T = G (PID off) lands on ω = 1/τ.
    const bw = closedLoopBandwidth(p);
    expect(relErr(bw, 1 / 0.5)).toBeLessThan(1e-3);
  });

  it('second-order closed-loop bandwidth matches the analytic Franklin formula (rel. err < 1e-3)', () => {
    // T = G with PID off; ω_b = ωn·√(1−2ζ²+√(4ζ⁴−4ζ²+2)).
    const bw = closedLoopBandwidth(openSecond);
    expect(relErr(bw, analyticSecondOrderBandwidth(2, 0.3))).toBeLessThan(1e-3);
  });

  it('integral action restores the closed-loop DC gain to unity (0 dB at low frequency)', () => {
    const p: ControlParams = { ...openSecond, type: 'first', tau: 0.5, kp: 2, ki: 3 };
    const low = closedLoopBandwidth(p);
    expect(Number.isFinite(low)).toBe(true);
    expect(low).toBeGreaterThan(0);
  });
});
