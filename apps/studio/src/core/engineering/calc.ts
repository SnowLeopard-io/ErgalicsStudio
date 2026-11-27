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
  // Reject NaN / Infinity explicitly: a NaN that slips through would make
  // every downstream result NaN while still looking like a valid number.
  if (
    !Number.isFinite(flowM3h) || !Number.isFinite(diameterMm) ||
    !Number.isFinite(lengthM) || !Number.isFinite(roughnessUm) ||
    !Number.isFinite(densityKgM3) || !Number.isFinite(viscosityPaS) ||
    !Number.isFinite(fittingsK)
  ) return null;
  if (
    !(diameterMm > 0) || !(flowM3h >= 0) || !(lengthM >= 0) ||
    !(roughnessUm >= 0) || !(densityKgM3 > 0) || !(viscosityPaS > 0) ||
    !(fittingsK >= 0)
  ) return null;
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
  if (!Number.isFinite(powerW) || !(powerW >= 0) || !Number.isFinite(ambientC)) return null;
  if (hExternal !== 0 && (!Number.isFinite(hExternal) || hExternal < 0)) return null;
  const layerR: number[] = [];
  for (const layer of layers) {
    const a = layer.areaCm2 * 1e-4;
    if (!Number.isFinite(layer.k) || !(layer.k > 0) ||
        !Number.isFinite(layer.thicknessMm) || !(layer.thicknessMm > 0) ||
        !Number.isFinite(layer.areaCm2) || !(a > 0)) return null;
    layerR.push(layer.thicknessMm / 1000 / (layer.k * a));
  }
  // External convection acts on the outer (last) layer's surface area.
  const outerArea = layers.length ? layers[layers.length - 1]!.areaCm2 * 1e-4 : 0;
  const filmR = hExternal > 0 && outerArea > 0 ? 1 / (hExternal * outerArea) : 0;
  const totalR = layerR.reduce((a, b) => a + b, 0) + filmR;
  // Layers are ordered hot-side first, so the hot face of layer j sits
  // filmR + Σ_{k≥j} R_k above ambient (suffix sum from the cold end).
  const layerHotC = new Array<number>(layerR.length);
  let suffix = 0;
  for (let j = layerR.length - 1; j >= 0; j -= 1) {
    suffix += layerR[j]!;
    layerHotC[j] = ambientC + (filmR + suffix) * powerW;
  }
  return { totalR, layerR, layerHotC, coldC: ambientC + filmR * powerW };
}

// --- beam quick check (Euler-Bernoulli closed forms) -------------------------

export type BeamSupport = 'cantilever' | 'simple';
export type BeamLoad = 'point' | 'udl';
export type BeamSection = 'rect' | 'circle';

export interface BeamInput {
  support: BeamSupport;
  load: BeamLoad;
  /** Span [mm]. */
  spanMm: number;
  /** Point load [N] (ignored for udl). */
  pointLoadN: number;
  /** Distributed load [N/mm] (ignored for point). */
  udlNMm: number;
  section: BeamSection;
  /** Rect width [mm] (ignored for circle). */
  widthMm: number;
  /** Rect height / circle diameter [mm]. */
  heightMm: number;
  /** Young's modulus [GPa]. */
  elasticGPa: number;
}

export interface BeamResult {
  areaMm2: number;
  inertiaMm4: number;
  outerFiberMm: number;
  /** Max bending moment [N·mm]. */
  maxMomentNmm: number;
  /** Max bending stress [MPa]. */
  maxStressMPa: number;
  /** Max deflection [mm]. */
  maxDeflectionMm: number;
}

/** Closed-form max moment, stress and deflection for the four basic cases. */
export function beamQuick(input: BeamInput): BeamResult | null {
  const { support, load, spanMm, pointLoadN, udlNMm, section, widthMm, heightMm, elasticGPa } = input;
  if (!(spanMm > 0) || !(elasticGPa > 0) || !(heightMm > 0)) return null;
  if (section === 'rect' && !(widthMm > 0)) return null;
  const loadValue = load === 'point' ? pointLoadN : udlNMm;
  if (!Number.isFinite(spanMm) || !Number.isFinite(elasticGPa) ||
      !Number.isFinite(widthMm) || !Number.isFinite(heightMm) ||
      !Number.isFinite(loadValue)) return null;

  const areaMm2 = section === 'rect'
    ? widthMm * heightMm
    : Math.PI * heightMm * heightMm / 4;
  const inertiaMm4 = section === 'rect'
    ? widthMm * heightMm ** 3 / 12
    : Math.PI * heightMm ** 4 / 64;
  const c = heightMm / 2;
  const e = elasticGPa * 1000; // MPa

  const moment = support === 'cantilever'
    ? (load === 'point' ? pointLoadN * spanMm : udlNMm * spanMm ** 2 / 2)
    : (load === 'point' ? pointLoadN * spanMm / 4 : udlNMm * spanMm ** 2 / 8);
  const deflection = support === 'cantilever'
    ? (load === 'point'
        ? pointLoadN * spanMm ** 3 / (3 * e * inertiaMm4)
        : udlNMm * spanMm ** 4 / (8 * e * inertiaMm4))
    : (load === 'point'
        ? pointLoadN * spanMm ** 3 / (48 * e * inertiaMm4)
        : 5 * udlNMm * spanMm ** 4 / (384 * e * inertiaMm4));

  return {
    areaMm2,
    inertiaMm4,
    outerFiberMm: c,
    maxMomentNmm: moment,
    maxStressMPa: moment * c / inertiaMm4,
    maxDeflectionMm: deflection,
  };
}

// --- fatigue life (Basquin S-N + Miner cumulative damage) ---------------------

export interface FatigueRow {
  /** Alternating stress amplitude [MPa]. */
  stressMPa: number;
  /** Applied cycle count at this amplitude. */
  cycles: number;
}

export interface FatigueInput {
  /** Ultimate tensile strength [MPa]. */
  ultimateMPa: number;
  /** Endurance-limit knock-down (surface × size × load, 0–1]. */
  knockDown: number;
  rows: FatigueRow[];
}

export interface FatigueRowResult {
  stressMPa: number;
  cycles: number;
  /** Life at this amplitude; Infinity below the endurance limit (run-out). */
  lifeCycles: number;
  /** Miner damage contribution n/N. */
  damage: number;
}

export interface FatigueResult {
  /** Corrected endurance limit [MPa]. */
  enduranceMPa: number;
  rows: FatigueRowResult[];
  /** Σ n/N — predicts failure when it reaches 1. */
  totalDamage: number;
  /** Estimated total life at the dominant amplitude for reference. */
  safe: boolean;
}

/**
 * Basquin S-N anchored at (10³, 0.9·Su) and (10⁶, Se) — the standard steel
 * approximation. Amplitudes at or below the corrected endurance limit never
 * fail (run-out, life = ∞). Miner damage sums n/N across the spectrum.
 */
export function fatigueLife(input: FatigueInput): FatigueResult | null {
  const { ultimateMPa, knockDown, rows } = input;
  if (!Number.isFinite(ultimateMPa) || !(ultimateMPa > 0)) return null;
  if (!Number.isFinite(knockDown) || !(knockDown > 0) || knockDown > 1) return null;
  // An invalid spectrum row would otherwise turn the whole Miner sum into NaN
  // while the UI might still render it as a run-out.
  for (const row of rows) {
    if (!Number.isFinite(row.stressMPa) || row.stressMPa < 0) return null;
    if (!Number.isFinite(row.cycles) || row.cycles < 0) return null;
  }
  const endurance = 0.5 * ultimateMPa * knockDown;
  // Basquin exponent from the two anchor points.
  const b = Math.log10(endurance / (0.9 * ultimateMPa)) / 3;
  const rowResults = rows.map((row) => {
    const life = row.stressMPa <= endurance
      ? Infinity
      : 1e3 * Math.pow(row.stressMPa / (0.9 * ultimateMPa), 1 / b);
    return {
      stressMPa: row.stressMPa,
      cycles: row.cycles,
      lifeCycles: life,
      damage: row.cycles / life,
    };
  });
  const totalDamage = rowResults.reduce((a, r) => a + r.damage, 0);
  return {
    enduranceMPa: endurance,
    rows: rowResults,
    totalDamage,
    safe: totalDamage < 1,
  };
}

// --- tolerance chain (worst-case + statistical RSS) ----------------------------

export type ToleranceDistribution = 'extreme' | 'normal';

export interface ToleranceItem {
  name: string;
  /** Nominal dimension [mm]. */
  nominalMm: number;
  /** Symmetric tolerance ±[mm]. */
  tolMm: number;
  distribution: ToleranceDistribution;
}

export interface ToleranceChainResult {
  /** Σ nominal [mm]. */
  nominalMm: number;
  /** Worst-case tolerance Σ|t_i| [mm]. */
  worstCaseTolMm: number;
  /** Mixed estimate: extreme items linearly + 3σ RSS of normal items [mm]. */
  statisticalTolMm: number;
  /** Worst-case gap bounds [mm]. */
  minMm: number;
  maxMm: number;
  /** How much tighter the statistical estimate is (worstCase/statistical). */
  gain: number;
}

/**
 * 1-D assembly tolerance chain. Extreme contributions add linearly in both
 * methods; normal (3σ-specified) contributions combine as variances, reported
 * at ±3σ. The mixed estimate therefore never exceeds the worst case.
 */
export function toleranceChain(items: ToleranceItem[]): ToleranceChainResult | null {
  if (items.length === 0) return null;
  let nominal = 0;
  let worst = 0;
  let extreme = 0;
  let normalVariance = 0;
  for (const item of items) {
    if (!Number.isFinite(item.nominalMm) || !Number.isFinite(item.tolMm) || !(item.tolMm >= 0)) return null;
    nominal += item.nominalMm;
    worst += item.tolMm;
    if (item.distribution === 'normal') normalVariance += (item.tolMm / 3) ** 2;
    else extreme += item.tolMm;
  }
  // Extreme items stay linear (their worst case is the only known bound);
  // normal items are combined as 3σ variances.
  const statistical = extreme + 3 * Math.sqrt(normalVariance);
  return {
    nominalMm: nominal,
    worstCaseTolMm: worst,
    statisticalTolMm: statistical,
    minMm: nominal - worst,
    maxMm: nominal + worst,
    gain: statistical > 0 ? worst / statistical : 1,
  };
}

// --- safety factor check ---------------------------------------------------------

export interface SafetyFactorInput {
  /** Applied working stress [MPa]. */
  appliedMPa: number;
  /** Material allowable (yield for ductile design) [MPa]. */
  allowableMPa: number;
  /** Required minimum safety factor (company/design code). */
  requiredSf: number;
}

export interface SafetyFactorResult {
  /** n = allowable / applied. */
  factor: number;
  /** Margin = n − n_required (negative → under-strength). */
  margin: number;
  pass: boolean;
}

/** n = σ_allowable / σ_applied against the required design factor. */
export function safetyFactor(input: SafetyFactorInput): SafetyFactorResult | null {
  const { appliedMPa, allowableMPa, requiredSf } = input;
  if (!(appliedMPa > 0) || !(allowableMPa > 0) || !(requiredSf > 0)) return null;
  if (!Number.isFinite(appliedMPa) || !Number.isFinite(allowableMPa) || !Number.isFinite(requiredSf)) return null;
  const factor = allowableMPa / appliedMPa;
  return {
    factor,
    margin: factor - requiredSf,
    pass: factor >= requiredSf,
  };
}
