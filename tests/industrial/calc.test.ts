// Tests for the mesh-free engineering calculators (core/engineering/calc.ts).

import { describe, expect, it } from 'vitest';
import { pipePressureDrop } from '@/core/engineering/calc';

describe('pipePressureDrop', () => {
  // Water, 6 m³/h in a DN40 (40 mm) pipe: v ≈ 1.326 m/s, Re ≈ 5.28e4.
  it('computes velocity and Reynolds number for water in a DN40 pipe', () => {
    const r = pipePressureDrop({
      flowM3h: 6, diameterMm: 40, lengthM: 12, roughnessUm: 50,
      densityKgM3: 998, viscosityPaS: 1.002e-3, fittingsK: 2.5,
    });
    expect(r).not.toBeNull();
    expect(r!.velocity).toBeCloseTo(1.326, 2);
    expect(r!.reynolds).toBeGreaterThan(5e4);
    expect(r!.reynolds).toBeLessThan(6e4);
    expect(r!.regime).toBe('turbulent');
  });

  it('uses Swamee-Jain friction (≈0.02) and splits friction vs fittings Δp', () => {
    const r = pipePressureDrop({
      flowM3h: 6, diameterMm: 40, lengthM: 12, roughnessUm: 50,
      densityKgM3: 998, viscosityPaS: 1.002e-3, fittingsK: 2.5,
    })!;
    expect(r.frictionFactor).toBeGreaterThan(0.015);
    expect(r.frictionFactor).toBeLessThan(0.03);
    const q = 998 * r.velocity ** 2 / 2;
    expect(r.dpFriction).toBeCloseTo(r.frictionFactor * (12 / 0.04) * q, 4);
    expect(r.dpFittings).toBeCloseTo(2.5 * q, 4);
    expect(r.dpTotal).toBeCloseTo(r.dpFriction + r.dpFittings, 4);
  });

  it('classifies slow flow as laminar with f = 64/Re', () => {
    const r = pipePressureDrop({
      flowM3h: 0.01, diameterMm: 40, lengthM: 1, roughnessUm: 50,
      densityKgM3: 998, viscosityPaS: 1.002e-3, fittingsK: 0,
    })!;
    expect(r.regime).toBe('laminar');
    expect(r.frictionFactor).toBeCloseTo(64 / r.reynolds, 6);
  });

  it('returns null for non-physical inputs', () => {
    expect(pipePressureDrop({
      flowM3h: 6, diameterMm: 0, lengthM: 12, roughnessUm: 50,
      densityKgM3: 998, viscosityPaS: 1.002e-3, fittingsK: 0,
    })).toBeNull();
    expect(pipePressureDrop({
      flowM3h: NaN, diameterMm: 40, lengthM: 12, roughnessUm: 50,
      densityKgM3: 998, viscosityPaS: 1.002e-3, fittingsK: 0,
    })).toBeNull();
  });
});
