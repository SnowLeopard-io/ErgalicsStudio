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

// --- thermal resistance stack (1-D series network) ---------------------------

export interface ThermalLayer {
  name: string;
  /** Thermal conductivity [W/(m·K)]. */
  k: number;
  /** Layer thickness [mm]. */
  thicknessMm: number;
  /** Heat-transfer cross-section [cm²]. */
  areaCm2: number;
}

export interface ThermalStackInput {
  /** Dissipated heat [W]. */
  powerW: number;
  /** Ambient temperature on the cold side [°C]. */
  ambientC: number;
  /** Optional external convection coefficient [W/(m²·K)]. */
  hExternal: number;
  layers: ThermalLayer[];
}

export interface ThermalStackResult {
  /** Total resistance [K/W] (layers + optional external convection). */
  totalR: number;
  /** Per-layer resistances in stack order [K/W]. */
  layerR: number[];
  /** Temperature at the hot side of each layer [°C], stack order. */
  layerHotC: number[];
  /** Cold-side temperature after external convection [°C]. */
  coldC: number;
}

/**
 * Series 1-D thermal network: T_hot(j) = T_ambient + Q · Σ R. With an
 * external convection film its resistance 1/(h·A) sits at the cold end.
 */
export function thermalStack(input: ThermalStackInput): ThermalStackResult | null {
  const { powerW, ambientC, hExternal, layers } = input;
  if (!(powerW >= 0) || !Number.isFinite(ambientC)) return null;
  const layerR: number[] = [];
  for (const layer of layers) {
    const a = layer.areaCm2 * 1e-4;
    if (!(layer.k > 0) || !(layer.thicknessMm > 0) || !(a > 0)) return null;
    layerR.push(layer.thicknessMm / 1000 / (layer.k * a));
  }
  const filmR = hExternal > 0
    ? 1 / (hExternal * layers.reduce((acc, l) => acc + l.areaCm2 * 1e-4, 0))
    : 0;
  const totalR = layerR.reduce((a, b) => a + b, 0) + filmR;
  let acc = 0;
  const layerHotC = layerR.map((r) => {
    const hot = ambientC + filmR * powerW + (acc + r) * powerW;
    acc += r;
    return hot;
  });
  return { totalR, layerR, layerHotC, coldC: ambientC + filmR * powerW };
}
