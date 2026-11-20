// ==========================================================================
// Ergalics Studio — engineering quick calculators
//
// Closed-form engineering estimates that need no mesh: pipe pressure drop,
// thermal resistance stacks, beam quick checks, fatigue life, tolerance
// chains and safety factors. Pure functions — the calculators page renders
// them live; every kernel is validated in tests/industrial/calc.test.ts.
// ==========================================================================

// --- pipe pressure drop (Darcy-Weisbach + Swamee-Jain) ----------------------

export interface PipeInput {
  /** Volumetric flow rate [m³/h]. */
  flowM3h: number;
  /** Inner pipe diameter [mm]. */
  diameterMm: number;
  /** Straight run length [m]. */
  lengthM: number;
  /** Pipe wall roughness [µm]. */
  roughnessUm: number;
  /** Fluid density [kg/m³]. */
  densityKgM3: number;
  /** Dynamic viscosity [Pa·s]. */
  viscosityPaS: number;
  /** Sum of fitting loss coefficients (bends, valves, …). */
  fittingsK: number;
}

export interface PipeResult {
  velocity: number; // m/s
  reynolds: number;
  frictionFactor: number;
  regime: 'laminar' | 'turbulent';
  dpFriction: number; // Pa
  dpFittings: number; // Pa
  dpTotal: number; // Pa
}

/** Darcy-Weisbach pressure drop with Swamee-Jain friction for turbulent flow. */
export function pipePressureDrop(input: PipeInput): PipeResult | null {
  const { flowM3h, diameterMm, lengthM, roughnessUm, densityKgM3, viscosityPaS, fittingsK } = input;
  if (!(diameterMm > 0) || !(flowM3h >= 0) || !(densityKgM3 > 0) || !(viscosityPaS > 0)) return null;
  const d = diameterMm / 1000;
  const area = Math.PI * d * d / 4;
  const v = (flowM3h / 3600) / area;
  const re = (densityKgM3 * v * d) / viscosityPaS;
  let f: number;
  let regime: PipeResult['regime'];
  if (re < 2300) {
    regime = 'laminar';
    f = re > 0 ? 64 / re : 0;
  } else {
    regime = 'turbulent';
    const eps = roughnessUm / 1e6 / d;
    f = 0.25 / Math.pow(Math.log10(eps / 3.7 + 5.74 / Math.pow(Math.max(re, 1), 0.9)), 2);
  }
  const q = densityKgM3 * v * v / 2;
  const dpFriction = f * (lengthM / d) * q;
  const dpFittings = fittingsK * q;
  return {
    velocity: v,
    reynolds: re,
    frictionFactor: f,
    regime,
    dpFriction,
    dpFittings,
    dpTotal: dpFriction + dpFittings,
  };
}
