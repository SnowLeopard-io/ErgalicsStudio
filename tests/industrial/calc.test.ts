// Tests for the mesh-free engineering calculators (core/engineering/calc.ts).

import { describe, expect, it } from 'vitest';
import { beamQuick, fatigueLife, pipePressureDrop, thermalStack } from '@/core/engineering/calc';

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
    // Temperature decreases along the stack; Si's hot face is the hottest.
    expect(r.layerHotC[0]!).toBeGreaterThan(r.layerHotC[1]!);
    expect(r.layerHotC[0]!).toBeCloseTo(25 + 5 * 0.1463, 1);
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

describe('beamQuick', () => {
  // Steel cantilever 200 mm, 100 N at the tip, 20×10 rect:
  // I = 20·10³/12 ≈ 1666.7 mm⁴, M = 2e4 N·mm, σ = 2e4·5/I = 60 MPa,
  // δ = P L³/(3EI) = 100·8e6/(3·2.1e5·1666.7) ≈ 0.762 mm.
  const base = {
    support: 'cantilever', load: 'point', spanMm: 200, pointLoadN: 100,
    udlNMm: 0.5, section: 'rect', widthMm: 20, heightMm: 10, elasticGPa: 210,
  } as const;

  it('cantilever + point load matches the textbook numbers', () => {
    const r = beamQuick(base)!;
    expect(r.inertiaMm4).toBeCloseTo(1666.67, 1);
    expect(r.maxMomentNmm).toBeCloseTo(20000, 3);
    expect(r.maxStressMPa).toBeCloseTo(60, 1);
    expect(r.maxDeflectionMm).toBeCloseTo(0.762, 2);
  });

  it('switches to the simply-supported point-load formulas', () => {
    const r = beamQuick({ ...base, support: 'simple' })!;
    expect(r.maxMomentNmm).toBeCloseTo(5000, 3); // PL/4
    expect(r.maxStressMPa).toBeCloseTo(15, 1);
    expect(r.maxDeflectionMm).toBeCloseTo(0.0476, 3); // PL³/48EI
  });

  it('circular section uses πd⁴/64', () => {
    const r = beamQuick({ ...base, section: 'circle', heightMm: 10 })!;
    expect(r.inertiaMm4).toBeCloseTo(Math.PI * 10000 / 64, 2);
  });

  it('rejects non-physical spans', () => {
    expect(beamQuick({ ...base, spanMm: 0 })).toBeNull();
  });
});

describe('fatigueLife', () => {
  // Su = 400 MPa, knock-down 0.8 → Se = 160 MPa.
  // Anchors: (1e3, 360 MPa), (1e6, 160 MPa).
  it('gives finite life above and run-out below the endurance limit', () => {
    const r = fatigueLife({
      ultimateMPa: 400, knockDown: 0.8,
      rows: [{ stressMPa: 300, cycles: 1e5 }, { stressMPa: 100, cycles: 1e7 }],
    })!;
    expect(r.enduranceMPa).toBeCloseTo(160, 3);
    const above = r.rows[0]!;
    expect(above.lifeCycles).toBeGreaterThan(1e3);
    expect(above.lifeCycles).toBeLessThan(1e6);
    expect(above.damage).toBeGreaterThan(0);
    // 100 MPa < Se — run-out contributes zero damage.
    expect(r.rows[1]!.lifeCycles).toBe(Infinity);
    expect(r.rows[1]!.damage).toBe(0);
  });

  it('sums Miner damage and flags failure above 1', () => {
    const failing = fatigueLife({
      ultimateMPa: 400, knockDown: 0.8,
      rows: [{ stressMPa: 300, cycles: 1e7 }],
    })!;
    expect(failing.totalDamage).toBeGreaterThan(1);
    expect(failing.safe).toBe(false);
    const safe = fatigueLife({
      ultimateMPa: 400, knockDown: 0.8,
      rows: [{ stressMPa: 100, cycles: 1e9 }],
    })!;
    expect(safe.safe).toBe(true);
  });

  it('rejects invalid knock-down factors', () => {
    expect(fatigueLife({ ultimateMPa: 400, knockDown: 0, rows: [] })).toBeNull();
    expect(fatigueLife({ ultimateMPa: 400, knockDown: 1.5, rows: [] })).toBeNull();
  });
});
