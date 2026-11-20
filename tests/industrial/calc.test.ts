// Tests for the mesh-free engineering calculators (core/engineering/calc.ts).

import { describe, expect, it } from 'vitest';
import { pipePressureDrop, thermalStack } from '@/core/engineering/calc';

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

describe('thermalStack', () => {
  // Si(0.5mm) + TIM(0.2mm) + Cu(2mm), 4 cm² each, 5 W, no film:
  // R_Si = 5e-4/(148·4e-4) ≈ 8.45e-3, R_TIM = 2e-4/(4·4e-4) = 0.125,
  // R_Cu = 2e-3/(390·4e-4) ≈ 0.0128 → ΔT ≈ 5·0.1463 ≈ 0.73 K.
  const layers = [
    { name: 'Si', k: 148, thicknessMm: 0.5, areaCm2: 4 },
    { name: 'TIM', k: 4, thicknessMm: 0.2, areaCm2: 4 },
    { name: 'Cu', k: 390, thicknessMm: 2, areaCm2: 4 },
  ];

  it('sums series resistances and gives hot-side temperatures', () => {
    const r = thermalStack({ powerW: 5, ambientC: 25, hExternal: 0, layers })!;
    expect(r.totalR).toBeGreaterThan(0.14);
    expect(r.totalR).toBeLessThan(0.15);
    // TIM dominates — its hot side sits at the highest temperature.
    expect(r.layerHotC[1]!).toBeGreaterThan(r.layerHotC[0]!);
    expect(r.layerHotC[1]!).toBeCloseTo(25 + 5 * 0.1463, 1);
    expect(r.coldC).toBe(25);
  });

  it('adds the external film resistance 1/(h·A) at the cold end', () => {
    const r = thermalStack({ powerW: 5, ambientC: 25, hExternal: 500, layers })!;
    // Film: 1/(500·4e-4) = 5 K/W — dominates the stack.
    expect(r.totalR).toBeGreaterThan(5);
    expect(r.coldC).toBeCloseTo(25 + 5 * 5, 1);
    expect(r.layerHotC[2]!).toBeCloseTo(r.coldC + 5 * 0.0128, 1);
  });

  it('rejects non-physical layers', () => {
    expect(thermalStack({
      powerW: 5, ambientC: 25, hExternal: 0,
      layers: [{ name: 'x', k: 0, thicknessMm: 1, areaCm2: 4 }],
    })).toBeNull();
  });
});
