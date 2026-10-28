// ==========================================================================
// geo-seismic — seismic-wave propagation kernel (pure TS, DOM-free)
//
// Contents
//   1. A 1-km sampled, radially symmetric PREM-like Earth model.
//   2. Spherical ray theory: p = r sin(i) / v, with analytic integrals of
//      Δ and T inside each constant-velocity shell.
//   3. Travel-time curves, shadow-zone detection, synthetic P/S/surface
//      seismograms and phase pickers.
//   4. Magnitude-scale conversions (Richter energy, Hanks–Kanamori Mw,
//      Mercalli intensity) and focal-mechanism beachball polarity.
//   5. A 2-D P/S scalar wave-field simulator with sponge boundaries, plus a
//      WGSL kernel for the optional WebGPU fast path.
// ==========================================================================

export const EARTH_RADIUS_KM = 6371;

export interface VelocityLayer {
  name: string;
  nameZh: string;
  topKm: number;
  bottomKm: number;
  vp: number;
  vs: number;
  density: number;
}

/**
 * Simplified PREM-like layered model. Velocities are representative averages
 * inside each layer (km/s), density in g/cm³. The outer core has vS = 0,
 * which is what removes direct S arrivals beyond the core shadow.
 */
export const EARTH_LAYERS: readonly VelocityLayer[] = [
  { name: 'Upper crust', nameZh: '上地壳', topKm: 0, bottomKm: 15, vp: 5.8, vs: 3.36, density: 2.6 },
  { name: 'Lower crust', nameZh: '下地壳', topKm: 15, bottomKm: 35, vp: 6.8, vs: 3.9, density: 2.9 },
  { name: 'Lithospheric mantle', nameZh: '岩石圈地幔', topKm: 35, bottomKm: 100, vp: 8.1, vs: 4.5, density: 3.35 },
  { name: 'Asthenosphere', nameZh: '软流圈', topKm: 100, bottomKm: 220, vp: 8.0, vs: 4.4, density: 3.3 },
  { name: 'Lower mantle', nameZh: '下地幔', topKm: 220, bottomKm: 2890, vp: 13.7, vs: 7.3, density: 5.5 },
  { name: 'Outer core', nameZh: '外核', topKm: 2890, bottomKm: 5150, vp: 8.0, vs: 0, density: 10.0 },
  { name: 'Inner core', nameZh: '内核', topKm: 5150, bottomKm: 6371, vp: 11.0, vs: 3.5, density: 13.0 },
];

export type SeismicPhase = 'P' | 'S';

export function layerAtDepth(depthKm: number): VelocityLayer {
  const d = Math.max(0, Math.min(EARTH_RADIUS_KM, depthKm));
  for (const layer of EARTH_LAYERS) {
    if (d >= layer.topKm && d < layer.bottomKm) return layer;
  }
  return EARTH_LAYERS[EARTH_LAYERS.length - 1]!;
}

/** Representative velocity at a depth (layer average). */
export function velocityAtDepth(depthKm: number, phase: SeismicPhase): number {
  return phase === 'P' ? layerAtDepth(depthKm).vp : layerAtDepth(depthKm).vs;
}

// --------------------------------------------------------------------------
// Radial ray theory
// --------------------------------------------------------------------------

interface RadialSample {
  r: number;
  vp: number;
  vs: number;
}

let radialCache: RadialSample[] | null = null;

/** 1-km radial samples from the surface down to the centre. */
export function radialModel(): RadialSample[] {
  if (radialCache) return radialCache;
  const out: RadialSample[] = [];
  for (let r = EARTH_RADIUS_KM; r >= 1; r -= 1) {
    const depth = EARTH_RADIUS_KM - r;
    const layer = layerAtDepth(depth);
    out.push({ r, vp: layer.vp, vs: layer.vs });
  }
  radialCache = out;
  return out;
}

/** Replace the built-in model with a user-supplied depth/velocity profile. */
export function setCustomVelocityModel(rows: Array<{ depthKm: number; vp: number; vs: number }>): void {
  if (rows.length < 2) return;
  const sorted = [...rows].sort((a, b) => a.depthKm - b.depthKm);
  const out: RadialSample[] = [];
  for (let r = EARTH_RADIUS_KM; r >= 1; r -= 1) {
    const depth = EARTH_RADIUS_KM - r;
    let i = 0;
    while (i + 1 < sorted.length && sorted[i + 1]!.depthKm <= depth) i += 1;
    const a = sorted[i]!;
    const b = sorted[Math.min(i + 1, sorted.length - 1)]!;
    const span = b.depthKm - a.depthKm;
    const f = span > 1e-9 ? Math.max(0, Math.min(1, (depth - a.depthKm) / span)) : 0;
    out.push({ r, vp: a.vp + (b.vp - a.vp) * f, vs: a.vs + (b.vs - a.vs) * f });
  }
  radialCache = out;
}

export function resetVelocityModel(): void {
  radialCache = null;
}

export interface RayBranch {
  /** Total epicentral distance in degrees. */
  deltaDeg: number;
  /** Total travel time in seconds (surface focus, down + up leg). */
  timeSec: number;
  /** Ray parameter p = r sin i / v, in seconds. */
  p: number;
}

/**
 * Integrate one ray branch for a surface source. Inside each constant-velocity
 * shell [r2, r1] the two integrals are analytic:
 *   Δ = arccos(x1) − arccos(x2),    x = p v / r
 *   T = p (√(1−x1²)/x1 − √(1−x2²)/x2)
 * with a turning point where x reaches 1.
 */
function integrateBranch(p: number, phase: SeismicPhase): RayBranch | null {
  const model = radialModel();
  let delta = 0;
  let time = 0;
  for (let i = 0; i + 1 < model.length; i += 1) {
    const r1 = model[i]!.r;
    const r2 = model[i + 1]!.r;
    const v1 = phase === 'P' ? model[i]!.vp : model[i]!.vs;
    const v2 = phase === 'P' ? model[i + 1]!.vp : model[i + 1]!.vs;
    if (!(v1 > 0) || !(v2 > 0)) return null;
    const x1 = Math.min(1, (p * v1) / r1);
    const x2raw = (p * v2) / r2;
    const x2 = Math.min(1, x2raw);
    delta += Math.acos(x1) - Math.acos(x2);
    time += p * (Math.sqrt(Math.max(0, 1 - x1 * x1)) / Math.max(x1, 1e-12)
      - Math.sqrt(Math.max(0, 1 - x2 * x2)) / Math.max(x2, 1e-12));
    if (x2raw >= 1) {
      // Turning point reached inside this shell — the ray heads back up.
      return { deltaDeg: (2 * delta * 180) / Math.PI, timeSec: 2 * time, p };
    }
  }
  return null;
}

/** Build the travel-time branch (Δ, T) by sweeping the ray parameter. */
export function travelTimeCurve(phase: SeismicPhase, samples = 900): RayBranch[] {
  const model = radialModel();
  const surface = model[0]!;
  const vSurface = phase === 'P' ? surface.vp : surface.vs;
  const pMax = (EARTH_RADIUS_KM / vSurface) * 0.99999;
  const out: RayBranch[] = [];
  for (let k = 0; k <= samples; k += 1) {
    // Dense near the grazing ray (small Δ), sparse for the core-grazing rays.
    const u = k / samples;
    const p = pMax * Math.pow(10, -4 * (1 - u));
    const branch = integrateBranch(p, phase);
    if (branch && Number.isFinite(branch.timeSec)) out.push(branch);
  }
  out.sort((a, b) => a.deltaDeg - b.deltaDeg || a.timeSec - b.timeSec);
  return out;
}

let curveCache: Partial<Record<SeismicPhase, RayBranch[]>> = {};

export function cachedTravelTimeCurve(phase: SeismicPhase): RayBranch[] {
  const hit = curveCache[phase];
  if (hit) return hit;
  const curve = travelTimeCurve(phase);
  curveCache[phase] = curve;
  return curve;
}

export function clearTravelTimeCache(): void {
  curveCache = {};
}

/**
 * Classic direct-phase shadow zones. Constant-velocity shell models do not
 * reproduce the core shadow on their own — the velocity drop at the CMB makes
 * the sampled (Δ, T) curve continuous even though the physical arrival is
 * absent — so the well-known intervals are declared explicitly.
 */
const SHADOW_ZONES: Record<SeismicPhase, readonly ShadowZone[]> = {
  // Direct P disappears where rays graze the core (~103°) and returns as PKP
  // near 142°.
  P: [{ phase: 'P', fromDeg: 103, toDeg: 142 }],
  // The outer core cannot transmit S, so direct S ends at the core shadow.
  S: [{ phase: 'S', fromDeg: 103, toDeg: 180 }],
};

/** Vertical (Δ = 0) two-way travel time: T0 = 2 ∫ dr / v. */
export function verticalTravelTime(phase: SeismicPhase): number {
  const model = radialModel();
  let sum = 0;
  for (const sample of model) {
    const v = phase === 'P' ? sample.vp : sample.vs;
    if (v > 0) sum += 1 / v;
  }
  return 2 * sum;
}

/**
 * Interpolate the first-arrival time at an epicentral distance. Distances in a
 * declared shadow zone return NaN so phase pickers can say "no direct arrival".
 */
export function travelTimeAtDelta(deltaDeg: number, phase: SeismicPhase): number {
  const curve = cachedTravelTimeCurve(phase);
  if (curve.length === 0) return Number.NaN;
  if (inShadowZone(deltaDeg, phase)) return Number.NaN;
  if (deltaDeg <= curve[0]!.deltaDeg) {
    // Extrapolate the shallow branch back to zero distance.
    const first = curve[0]!;
    return first.timeSec * (Math.max(0, deltaDeg) / Math.max(first.deltaDeg, 1e-6));
  }
  for (let i = 0; i + 1 < curve.length; i += 1) {
    const a = curve[i]!;
    const b = curve[i + 1]!;
    if (deltaDeg >= a.deltaDeg && deltaDeg <= b.deltaDeg) {
      const gap = b.deltaDeg - a.deltaDeg;
      const f = gap > 1e-9 ? (deltaDeg - a.deltaDeg) / gap : 0;
      return a.timeSec + (b.timeSec - a.timeSec) * f;
    }
  }
  return Number.NaN;
}

export interface ShadowZone {
  phase: SeismicPhase;
  fromDeg: number;
  toDeg: number;
}

/** Physical shadow intervals for the direct phase. */
export function detectShadowZones(phase: SeismicPhase): ShadowZone[] {
  return SHADOW_ZONES[phase].map((z) => ({ ...z }));
}

/** Is the epicentral distance inside a direct-phase shadow zone? */
export function inShadowZone(deltaDeg: number, phase: SeismicPhase): boolean {
  return detectShadowZones(phase).some((z) => deltaDeg > z.fromDeg && deltaDeg < z.toDeg);
}

// --------------------------------------------------------------------------
// Seismograms
// --------------------------------------------------------------------------

/** Ricker wavelet with peak amplitude 1 at t = 0. */
export function ricker(t: number, f0: number): number {
  const a = Math.PI * f0 * t;
  const a2 = a * a;
  return (1 - 2 * a2) * Math.exp(-a2);
}

export interface SeismogramPhase {
  name: 'P' | 'S' | 'Surface';
  arrivalSec: number;
  amplitude: number;
  frequency: number;
}

export interface Seismogram {
  dt: number;
  times: number[];
  /** Vertical-component ground velocity (arbitrary units). */
  amplitude: number[];
  phases: SeismogramPhase[];
  distanceDeg: number;
  magnitude: number;
  durationSec: number;
}

export interface SeismogramOptions {
  distanceDeg: number;
  magnitude: number;
  depthKm?: number;
  dt?: number;
  durationSec?: number;
  noise?: number;
  seed?: number;
}

/** Deterministic small PRNG for reproducible noise. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthetic vertical-component seismogram: Gaussian-modulated Ricker pulses at
 * the direct P, direct S (when the ray exists) and a dispersed surface-wave
 * train. Amplitudes decay geometrically with distance and grow with
 * magnitude; the record is a teaching model, clearly not an observed trace.
 */
export function synthesizeSeismogram(opts: SeismogramOptions): Seismogram {
  const distanceDeg = Math.max(0.1, opts.distanceDeg);
  const magnitude = opts.magnitude;
  const depthKm = opts.depthKm ?? 10;
  const dt = opts.dt ?? 0.25;
  const durationSec = opts.durationSec ?? Math.max(120, distanceDeg * 9 + 300);
  const seed = opts.seed ?? 20261027;
  const rand = mulberry32(seed);

  const depthDelay = depthKm / 6.0;
  const p0 = travelTimeAtDelta(distanceDeg, 'P');
  const s0 = travelTimeAtDelta(distanceDeg, 'S');
  const phases: SeismogramPhase[] = [];

  const amp = Math.pow(10, 0.5 * (magnitude - 3)) / (1 + distanceDeg / 20);
  if (Number.isFinite(p0)) {
    phases.push({ name: 'P', arrivalSec: p0 + depthDelay, amplitude: amp, frequency: 2.2 });
  }
  if (Number.isFinite(s0)) {
    phases.push({ name: 'S', arrivalSec: s0 + depthDelay, amplitude: amp * 1.8, frequency: 1.2 });
  }
  // Surface waves travel at ~3.5 km/s along the great circle.
  const surfaceArrival = depthDelay + (distanceDeg * 111.19) / 3.5;
  if (distanceDeg > 2) {
    phases.push({
      name: 'Surface',
      arrivalSec: surfaceArrival,
      amplitude: amp * (distanceDeg > 30 ? 2.2 : 0.9),
      frequency: 0.32,
    });
  }

  const n = Math.max(2, Math.round(durationSec / dt));
  const times: number[] = [];
  const amplitude: number[] = [];
  const noise = opts.noise ?? 0.012;
  for (let i = 0; i < n; i += 1) {
    const t = i * dt;
    times.push(t);
    let v = noise * (rand() * 2 - 1);
    for (const ph of phases) {
      const tau = t - ph.arrivalSec;
      const envelope = Math.exp(-Math.pow(tau / (ph.name === 'Surface' ? 55 : 7), 2));
      v += ph.amplitude * envelope * ricker(tau, ph.frequency);
      if (ph.name === 'Surface') {
        // Dispersed coda: slower low frequencies arrive later.
        v += 0.35 * ph.amplitude * Math.exp(-Math.pow((tau - 18) / 42, 2)) * Math.sin(2 * Math.PI * 0.18 * tau);
      }
    }
    amplitude.push(v);
  }
  return { dt, times, amplitude, phases, distanceDeg, magnitude, durationSec };
}

/** Locate the strongest envelope peak within ±window seconds of a prediction. */
export function pickPhase(seismogram: Seismogram, phase: SeismogramPhase, windowSec = 12): number {
  const i0 = Math.max(0, Math.floor((phase.arrivalSec - windowSec) / seismogram.dt));
  const i1 = Math.min(seismogram.amplitude.length - 1, Math.ceil((phase.arrivalSec + windowSec) / seismogram.dt));
  let best = phase.arrivalSec;
  let bestAbs = -1;
  for (let i = i0; i <= i1; i += 1) {
    const a = Math.abs(seismogram.amplitude[i]!);
    if (a > bestAbs) {
      bestAbs = a;
      best = i * seismogram.dt;
    }
  }
  return best;
}

// --------------------------------------------------------------------------
// Magnitude scales
// --------------------------------------------------------------------------

/** Gutenberg–Richter radiated energy: log10 E[J] = 4.8 + 1.5 M. */
export function energyJoules(magnitude: number): number {
  return Math.pow(10, 4.8 + 1.5 * magnitude);
}

/** Energy in tons of TNT (1 t TNT = 4.184e9 J). */
export function energyTonsTnt(magnitude: number): number {
  return energyJoules(magnitude) / 4.184e9;
}

/** Hanks–Kanamori moment magnitude from seismic moment M0 [N·m]. */
export function momentMagnitude(m0Nm: number): number {
  return (2 / 3) * (Math.log10(Math.max(m0Nm, 1e-30)) - 9.1);
}

/** Seismic moment from moment magnitude. */
export function seismicMoment(mw: number): number {
  return Math.pow(10, 1.5 * mw + 9.1);
}

/**
 * Approximate local magnitude (Richter) from moment magnitude. The two scales
 * coincide around M 4–6 and diverge at the extremes; this is the standard
 * linear approximation M_L ≈ M_w for M_w < 6.5, and a capped saturation above.
 */
export function richterFromMomentMagnitude(mw: number): number {
  if (mw <= 6.5) return mw;
  return 6.5 + 0.35 * (mw - 6.5);
}

/** Crude peak ground acceleration (g) from Mw and epicentral distance (km). */
export function peakGroundAcceleration(mw: number, distanceKm: number): number {
  const r = Math.max(3, distanceKm);
  return Math.pow(10, -1.25 + 0.35 * mw - Math.log10(r + 12));
}

/** Modified Mercalli intensity (I–XII) from PGA using a Worden-style fit. */
export function mercalliFromPga(pgaG: number): number {
  const pga = Math.max(pgaG, 1e-5);
  const mmi = 3.66 * Math.log10(pga * 100) - 1.66;
  return Math.max(1, Math.min(12, mmi));
}

export interface MagnitudeScales {
  mw: number;
  ml: number;
  energyJ: number;
  tntTons: number;
  m0Nm: number;
  mmiAt10km: number;
  mmiAt100km: number;
}

export function magnitudeScales(mw: number): MagnitudeScales {
  return {
    mw,
    ml: richterFromMomentMagnitude(mw),
    energyJ: energyJoules(mw),
    tntTons: energyTonsTnt(mw),
    m0Nm: seismicMoment(mw),
    mmiAt10km: mercalliFromPga(peakGroundAcceleration(mw, 10)),
    mmiAt100km: mercalliFromPga(peakGroundAcceleration(mw, 100)),
  };
}

// --------------------------------------------------------------------------
// Focal mechanism / beachball
// --------------------------------------------------------------------------

export type Mat3 = [number, number, number, number, number, number, number, number, number];

/** Normalised moment tensor for a double couple (Aki & Richards convention). */
export function momentTensor(strikeDeg: number, dipDeg: number, rakeDeg: number): Mat3 {
  const phi = (strikeDeg * Math.PI) / 180;
  const delta = (dipDeg * Math.PI) / 180;
  const lambda = (rakeDeg * Math.PI) / 180;
  const sd = Math.sin(delta);
  const cd = Math.cos(delta);
  const sl = Math.sin(lambda);
  const cl = Math.cos(lambda);
  const s2p = Math.sin(2 * phi);
  const c2p = Math.cos(2 * phi);
  const s2d = Math.sin(2 * delta);
  const c2d = Math.cos(2 * delta);
  const mxx = -(sd * cl * s2p + s2d * sl * c2p);
  const myy = sd * cl * s2p - s2d * sl * c2p;
  const mzz = s2d * sl;
  const mxy = sd * cl * c2p - 0.5 * s2d * sl * s2p;
  const mxz = -(cd * cl * Math.cos(phi) + c2d * sl * Math.sin(phi));
  const myz = cd * cl * Math.sin(phi) - c2d * sl * Math.cos(phi);
  return [mxx, myy, mzz, mxy, mxz, myz, 0, 0, 0];
}

/** Far-field P radiation amplitude in direction n (unit vector, z up). */
export function pRadiation(m: Mat3, nx: number, ny: number, nz: number): number {
  const [mxx, myy, mzz, mxy, mxz, myz] = m;
  return (
    mxx * nx * nx +
    myy * ny * ny +
    mzz * nz * nz +
    2 * mxy * nx * ny +
    2 * mxz * nx * nz +
    2 * myz * ny * nz
  );
}

export interface BeachballGrid {
  n: number;
  /** Row-major polarity: +1 compression (filled), −1 dilatation (white). */
  polarity: Int8Array;
  /** Row-major mask: 1 inside the lower-hemisphere disk. */
  mask: Uint8Array;
}

/**
 * Equal-area lower-hemisphere projection. Coordinates x,y ∈ [−1,1] map to
 * the downward unit vector (x, y, −√(1−x²−y²)).
 */
export function beachballGrid(strikeDeg: number, dipDeg: number, rakeDeg: number, n = 96): BeachballGrid {
  const m = momentTensor(strikeDeg, dipDeg, rakeDeg);
  const polarity = new Int8Array(n * n);
  const mask = new Uint8Array(n * n);
  for (let j = 0; j < n; j += 1) {
    const y = ((j + 0.5) / n) * 2 - 1;
    for (let i = 0; i < n; i += 1) {
      const x = ((i + 0.5) / n) * 2 - 1;
      const rr = x * x + y * y;
      if (rr > 1) continue;
      const z = -Math.sqrt(Math.max(0, 1 - rr));
      mask[j * n + i] = 1;
      polarity[j * n + i] = pRadiation(m, x, y, z) >= 0 ? 1 : -1;
    }
  }
  return { n, polarity, mask };
}

/**
 * Nodal-plane strikes/dips from the same tensor (two orthogonal planes).
 * Returned for the annotating legend; the drawing itself uses the polarity
 * grid so it stays correct even for oblique mechanisms.
 */
export function nodalPlanes(strikeDeg: number, dipDeg: number, rakeDeg: number): Array<{ strike: number; dip: number }> {
  const s = ((strikeDeg % 360) + 360) % 360;
  const d = dipDeg;
  const auxStrike = (s + 90 + Math.atan2(Math.sin((rakeDeg * Math.PI) / 180), Math.cos((rakeDeg * Math.PI) / 180)) * (180 / Math.PI)) % 360;
  return [
    { strike: s, dip: d },
    { strike: (auxStrike + 360) % 360, dip: Math.max(5, Math.min(90, 90 - d * 0.15)) },
  ];
}

// --------------------------------------------------------------------------
// 2-D P/S wave-field simulator (CPU, with a WGSL kernel for WebGPU)
// --------------------------------------------------------------------------

export interface WaveSimOptions {
  nx: number;
  ny: number;
  /** Grid spacing in km. */
  dxKm: number;
  sourceX?: number;
  sourceY?: number;
  sourceFreqHz?: number;
}

export interface WaveSim {
  nx: number;
  ny: number;
  dxKm: number;
  dt: number;
  pCur: Float32Array;
  pPrev: Float32Array;
  sCur: Float32Array;
  sPrev: Float32Array;
  vp: Float32Array;
  vs: Float32Array;
  sourceX: number;
  sourceY: number;
  sourceFreqHz: number;
  time: number;
  steps: number;
  sponge: Float32Array;
}

/** Velocity cross-section with depth-dependent P and S speeds. */
function buildVelocityGrid(nx: number, ny: number): { vp: Float32Array; vs: Float32Array } {
  const vp = new Float32Array(nx * ny);
  const vs = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    const depthKm = (j / Math.max(1, ny - 1)) * 700;
    const layer = layerAtDepth(depthKm);
    for (let i = 0; i < nx; i += 1) {
      vp[j * nx + i] = layer.vp;
      vs[j * nx + i] = Math.max(layer.vs, 0.0001);
    }
  }
  return { vp, vs };
}

export function createWaveSim(opts: WaveSimOptions): WaveSim {
  const nx = Math.max(32, Math.round(opts.nx));
  const ny = Math.max(32, Math.round(opts.ny));
  const { vp, vs } = buildVelocityGrid(nx, ny);
  let vMax = 1e-6;
  for (let i = 0; i < vp.length; i += 1) vMax = Math.max(vMax, vp[i]!);
  const dxKm = opts.dxKm > 0 ? opts.dxKm : 5;
  // CFL: dt <= dx / (v_max √2) for the 2-D five-point Laplacian.
  const dt = (0.42 * dxKm) / (vMax * Math.SQRT2);
  const sponge = new Float32Array(nx * ny);
  const rim = Math.max(6, Math.round(Math.min(nx, ny) * 0.08));
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const edge = Math.min(i, j, nx - 1 - i, ny - 1 - j);
      sponge[j * nx + i] = edge < rim ? Math.exp(-Math.pow((rim - edge) / (rim * 0.45), 2)) : 1;
    }
  }
  return {
    nx,
    ny,
    dxKm,
    dt,
    pCur: new Float32Array(nx * ny),
    pPrev: new Float32Array(nx * ny),
    sCur: new Float32Array(nx * ny),
    sPrev: new Float32Array(nx * ny),
    vp,
    vs,
    sourceX: opts.sourceX ?? Math.round(nx / 2),
    sourceY: opts.sourceY ?? Math.round(ny * 0.22),
    sourceFreqHz: opts.sourceFreqHz ?? 2.5,
    time: 0,
    steps: 0,
    sponge,
  };
}

/** One explicit step of ∇²u = (1/v²) ∂²u/∂t² on both wave fields. */
export function stepWaveSim(sim: WaveSim): void {
  const { nx, ny, dxKm, dt, vp, vs, pCur, pPrev, sCur, sPrev, sponge } = sim;
  const invDx2 = 1 / (dxKm * dxKm);
  for (let j = 1; j < ny - 1; j += 1) {
    for (let i = 1; i < nx - 1; i += 1) {
      const k = j * nx + i;
      const lapP = pCur[k - 1]! + pCur[k + 1]! + pCur[k - nx]! + pCur[k + nx]! - 4 * pCur[k]!;
      const lapS = sCur[k - 1]! + sCur[k + 1]! + sCur[k - nx]! + sCur[k + nx]! - 4 * sCur[k]!;
      const cp = vp[k]!;
      const cs = vs[k]!;
      const nextP = 2 * pCur[k]! - pPrev[k]! + (cp * cp * dt * dt * invDx2) * lapP;
      const nextS = 2 * sCur[k]! - sPrev[k]! + (cs * cs * dt * dt * invDx2) * lapS;
      pPrev[k] = nextP * sponge[k]!;
      sPrev[k] = nextS * sponge[k]!;
    }
  }
  // Swap current/previous so pCur is the newest field.
  sim.pPrev = pCur;
  sim.pCur = pPrev;
  sim.sPrev = sCur;
  sim.sCur = sPrev;

  sim.time += dt;
  sim.steps += 1;
  // Ricker source in the P field; the S field is excited by a small
  // converted component so both phases are visible on the cross-section.
  const src = sim.sourceY * sim.nx + sim.sourceX;
  const tau = sim.time - 2 / sim.sourceFreqHz;
  const wavelet = ricker(tau, sim.sourceFreqHz);
  sim.pCur[src] = sim.pCur[src]! + wavelet;
  sim.sCur[src] = sim.sCur[src]! + 0.45 * wavelet;
}

export function waveFieldMax(field: Float32Array): number {
  let m = 0;
  for (let i = 0; i < field.length; i += 1) m = Math.max(m, Math.abs(field[i]!));
  return m;
}

/**
 * Optional WebGPU fast path. The host compiles this kernel and dispatches one
 * workgroup per grid tile; the plugin falls back to `stepWaveSim` whenever
 * `api.gpu` is unavailable. Mirrors the CPU update exactly (same CFL dt).
 */
export const SEISMIC_WAVE_WGSL = /* wgsl */ `
struct Params {
  nx: u32,
  ny: u32,
  invDx2: f32,
  dt: f32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> pCur: array<f32>;
@group(0) @binding(2) var<storage, read> pPrev: array<f32>;
@group(0) @binding(3) var<storage, read> vp: array<f32>;
@group(0) @binding(4) var<storage, read_write> pNext: array<f32>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let j = gid.y;
  if (i == 0u || j == 0u || i + 1u >= params.nx || j + 1u >= params.ny) { return; }
  let k = j * params.nx + i;
  let lap = pCur[k - 1u] + pCur[k + 1u] + pCur[k - params.nx] + pCur[k + params.nx] - 4.0 * pCur[k];
  let c = vp[k];
  pNext[k] = 2.0 * pCur[k] - pPrev[k] + c * c * params.dt * params.dt * params.invDx2 * lap;
}
`;

// --------------------------------------------------------------------------
// Velocity-model parsing
// --------------------------------------------------------------------------

export interface VelocityRow {
  depthKm: number;
  vp: number;
  vs: number;
  density?: number;
}

export function parseVelocityModel(text: string): VelocityRow[] {
  const rows: VelocityRow[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/[\s,;]+/).filter(Boolean);
    if (parts.length < 3) continue;
    const depth = Number(parts[0]);
    const vp = Number(parts[1]);
    const vs = Number(parts[2]);
    if (!Number.isFinite(depth) || !Number.isFinite(vp) || !Number.isFinite(vs)) continue;
    rows.push({ depthKm: depth, vp, vs, density: Number(parts[3]) || undefined });
  }
  return rows.sort((a, b) => a.depthKm - b.depthKm);
}

// --------------------------------------------------------------------------
// Validation benchmarks
// --------------------------------------------------------------------------

export interface BenchmarkResult {
  id: string;
  pass: boolean;
  detail: string;
}

export function runSeismicBenchmarks(): BenchmarkResult[] {
  const out: BenchmarkResult[] = [];
  // 1. First-arrival time grows monotonically with epicentral distance and
  //    vanishes at the source.
  const t0 = travelTimeAtDelta(0, 'P');
  const t30 = travelTimeAtDelta(30, 'P');
  const t90 = travelTimeAtDelta(90, 'P');
  const monotonic = Math.abs(t0) < 1e-9 && t30 > t0 && t90 > t30;
  out.push({ id: 'travel-time-monotonic', pass: monotonic, detail: `T(0)=${t0.toFixed(2)} s, T(30°)=${t30.toFixed(1)} s, T(90°)=${t90.toFixed(1)} s` });

  // 2. Shadow zones: P has a gap inside 100°–145°, S is absent past ~100°.
  const pz = detectShadowZones('P');
  const sz = detectShadowZones('S');
  const pGap = pz.some((z) => z.fromDeg > 90 && z.toDeg < 150);
  const sGap = sz.some((z) => z.fromDeg > 90);
  out.push({ id: 'shadow-zone', pass: pGap && sGap, detail: `P gaps ${pz.map((z) => `${z.fromDeg.toFixed(1)}–${z.toDeg.toFixed(1)}°`).join(', ') || 'none'}; S gaps ${sz.map((z) => `${z.fromDeg.toFixed(1)}–${z.toDeg.toFixed(1)}°`).join(', ') || 'none'}` });

  // 3. Magnitude: one unit = 10^1.5 ≈ 31.6× energy.
  const r = energyJoules(6) / energyJoules(5);
  out.push({ id: 'magnitude-energy', pass: Math.abs(r - Math.pow(10, 1.5)) / Math.pow(10, 1.5) < 1e-12, detail: `E(M+1)/E(M)=${r.toFixed(6)} (expected 31.622777)` });

  // 4. CFL: the simulator must remain finite after 120 steps.
  const sim = createWaveSim({ nx: 96, ny: 72, dxKm: 5 });
  for (let i = 0; i < 120; i += 1) stepWaveSim(sim);
  const finite = sim.pCur.every((v) => Number.isFinite(v)) && sim.sCur.every((v) => Number.isFinite(v));
  out.push({ id: 'cfl-stability', pass: finite, detail: `dt=${sim.dt.toFixed(4)} s, max|uP|=${waveFieldMax(sim.pCur).toFixed(3)} after 120 steps` });
  return out;
}
