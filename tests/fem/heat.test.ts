// ==========================================================================
// FEM core — transient heat equation tests: (1) the analytic sine decay case
// with Dirichlet boundaries, (2) exact discrete energy conservation with
// insulated (natural) boundaries for any θ, and (3) preservation of a
// constant field (stiffness row sums vanish).
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { rectStructuredMesh } from '../../src/core/fem/mesh/domain';
import { solveHeat, totalHeatEnergy, HEAT_SINE_CASE } from '../../src/core/fem/physics/heat';
import { l2Error } from '../../src/core/fem/post/stress';

const DIRICHLET_ALL = [1, 2, 3, 4];

describe('fem heat: analytic sine decay (Dirichlet, Crank–Nicolson)', () => {
  it('final field matches u = e^(−2π²t)·sin(πx)·sin(πy)', () => {
    const mesh = rectStructuredMesh(1, 1, 16, 16);
    const tFinal = 0.2;
    const r = solveHeat({
      mesh,
      initial: HEAT_SINE_CASE.initial,
      dirichlet: { edgeTags: DIRICHLET_ALL, value: 0 },
      dt: 0.01,
      steps: 20,
      theta: 0.5,
      cg: { tol: 1e-12 },
    });
    expect(r.residual).toBeLessThan(1e-8);
    expect(r.history.length).toBe(21);
    expect(r.times[r.times.length - 1]).toBeCloseTo(tFinal, 10);

    const exactAtT = (x: number, y: number): number => HEAT_SINE_CASE.exact(x, y, tFinal, 1);
    const err = l2Error(mesh, r.values, exactAtT);
    expect(err).toBeLessThan(0.01);

    // Peak amplitude decays at the analytic rate (within 5 %: the P1
    // consistent-mass discrete eigenvalue sits marginally below the exact
    // 2π², so the numerical decay is a touch slower than the analytic one).
    let peak = 0;
    for (let i = 0; i < r.values.length; i += 1) peak = Math.max(peak, Math.abs(r.values[i]!));
    const peakExact = Math.exp(-2 * Math.PI * Math.PI * tFinal);
    expect(Math.abs(peak - peakExact) / peakExact).toBeLessThan(0.05);

    // Dirichlet cooling removes energy monotonically.
    for (let i = 1; i < r.energyHistory.length; i += 1) {
      expect(r.energyHistory[i]!).toBeLessThan(r.energyHistory[i - 1]!);
    }
  });

  it('implicit Euler (θ = 1) stays stable and decays at the analytic rate', () => {
    const mesh = rectStructuredMesh(1, 1, 12, 12);
    const dt = 0.02;
    const steps = 10;
    const r = solveHeat({
      mesh,
      initial: HEAT_SINE_CASE.initial,
      dirichlet: { edgeTags: DIRICHLET_ALL, value: 0 },
      dt,
      steps,
      theta: 1,
      cg: { tol: 1e-12 },
    });
    expect(r.residual).toBeLessThan(1e-8);
    const tFinal = dt * steps;
    const err = l2Error(mesh, r.values, (x, y) => HEAT_SINE_CASE.exact(x, y, tFinal, 1));
    // Implicit Euler is only first-order in time but stable for any dt; the
    // space error dominates here, so the same L² ball applies.
    expect(err).toBeLessThan(0.02);
  });
});

describe('fem heat: discrete energy conservation (insulated boundaries)', () => {
  it('∫u dV is conserved to solver tolerance for θ = 1 and θ = 0.5', () => {
    // With no Dirichlet/Neumann data the θ scheme satisfies
    // 1ᵀM(uⁿ⁺¹ − uⁿ) = −Δt·1ᵀK(…) = 0 exactly (K has zero row sums),
    // so the discrete total heat is conserved for EVERY θ.
    for (const theta of [1, 0.5]) {
      const mesh = rectStructuredMesh(1, 1, 12, 12);
      const r = solveHeat({
        mesh,
        initial: (x, y) => 1 + 0.5 * Math.sin(Math.PI * x) * Math.sin(Math.PI * y),
        dt: 0.05,
        steps: 50,
        theta,
        cg: { tol: 1e-12 },
      });
      const e0 = r.energyHistory[0]!;
      for (const e of r.energyHistory) {
        expect(Math.abs(e - e0) / Math.abs(e0)).toBeLessThan(1e-9);
      }
    }
  });

  it('a constant field is a fixed point of the θ scheme', () => {
    // K·1 = 0 and rhsOp·1 = M·1 = lhs·1, so u ≡ 1 must be reproduced exactly.
    const mesh = rectStructuredMesh(1, 1, 10, 10);
    const r = solveHeat({
      mesh,
      initial: () => 1,
      dt: 0.05,
      steps: 20,
      theta: 0.5,
      cg: { tol: 1e-12 },
    });
    let maxDev = 0;
    for (const field of r.history) {
      for (const v of field) maxDev = Math.max(maxDev, Math.abs(v - 1));
    }
    expect(maxDev).toBeLessThan(1e-9);
    expect(totalHeatEnergy(mesh, r.values)).toBeCloseTo(1, 9);
  });
});
