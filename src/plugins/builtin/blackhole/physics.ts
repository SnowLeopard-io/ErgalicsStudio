// ==========================================================================
// Black-hole plugin — Schwarzschild physics core (pure TS, testable).
//
// Units: G = c = 1 and all lengths in Schwarzschild radii (r_s = 2GM/c²)
// unless a symbol says otherwise (e.g. `*Km`, `*Rad`). The GLSL ray tracer
// in `shader.ts` integrates the exact same null-geodesic equation (Binet
// form) per pixel; this module mirrors it for unit tests, validation and
// the science output strip.
// ==========================================================================

/** Photon sphere radius: 1.5 r_s. */
export const PHOTON_SPHERE_RS = 1.5;
/** Innermost stable circular orbit: 3 r_s (Schwarzschild). */
export const ISCO_RS = 3;
/** Critical impact parameter b_c = 3√3/2 · r_s ≈ 2.598 r_s. */
export const CRITICAL_B_RS = 1.5 * Math.sqrt(3);

/** Schwarzschild radius in km for a mass given in solar masses. */
export function schwarzschildRadiusKm(massSolar: number): number {
  return 2.9532500765 * massSolar; // 2GM☉/c² ≈ 2.9532 km
}

/**
 * Circular-orbit speed measured by a local static observer, in units of c.
 * v² = M/(r − 2M) = 1/(2(r/r_s − 1)); reaches c at the photon sphere.
 */
export function orbitalBeta(rRs: number): number {
  const b2 = 1 / (2 * (rRs - 1));
  return b2 >= 1 ? 1 : Math.sqrt(b2);
}

/** γ factor of the circular orbit at radius r. */
export function orbitalGamma(rRs: number): number {
  const beta = orbitalBeta(rRs);
  return 1 / Math.sqrt(Math.max(1 - beta * beta, 1e-9));
}

/**
 * Special-relativistic Doppler factor ν_obs/ν_em for an emitter moving with
 * speed β at angle ψ to the photon direction (cosψ = β·n̂): 1/(γ(1 − β cosψ)).
 */
export function dopplerFactor(beta: number, cosPsi: number): number {
  const gamma = 1 / Math.sqrt(Math.max(1 - beta * beta, 1e-9));
  return 1 / (gamma * (1 - beta * cosPsi));
}

/** Static-observer gravitational redshift √(1 − r_s/r), clamped away from 0. */
export function gravRedshift(rRs: number): number {
  return Math.sqrt(Math.max(1 - 1 / rRs, 0.01));
}

/**
 * Shakura–Sunyaev thin-disk effective temperature profile
 * T(r) ∝ (r/r_in)^{-3/4} (1 − √(r_in/r))^{1/4}, normalised so that the peak
 * (at r = 49/36 · r_in) equals `tPeak`. Zero at the inner edge.
 */
export function diskTemp(rRs: number, rInRs: number, tPeak: number): number {
  const profile = (x: number): number =>
    Math.pow(x, -0.75) * Math.pow(Math.max(1 - Math.pow(x, -0.5), 0), 0.25);
  const x = Math.max(rRs / rInRs, 1.0001);
  const xp = 49 / 36; // peak location of the SS profile
  return tPeak * (profile(x) / profile(xp));
}

/** Bolometric intensity amplification g⁴ from the I/ν⁴ invariant. */
export function intensityShift(g: number): number {
  return g * g * g * g;
}

/**
 * Approximate Planckian-locus RGB for 1000–40000 K, max-normalised.
 * Standard colour-temperature fit (Tanner Helland constants, /255).
 */
export function blackbodyRGB(tK: number): [number, number, number] {
  const t = Math.min(Math.max(tK, 1000), 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 1;
    g = Math.min(Math.max(0.3900816 * Math.log(t) - 0.6318414, 0), 1);
  } else {
    r = Math.min(Math.max(1.292936 * Math.pow(t - 60, -0.1332047), 0), 1);
    g = Math.min(Math.max(1.1298909 * Math.pow(t - 60, -0.0755148), 0), 1);
  }
  if (t >= 66) b = 1;
  else if (t <= 19) b = 0;
  else b = Math.min(Math.max(0.5432068 * Math.log(t - 10) - 1.1962541, 0), 1);
  const m = Math.max(r, g, b, 1e-6);
  return [r / m, g / m, b / m];
}

/**
 * Shadow (silhouette) angular diameter seen by a static observer at distance
 * D: sin(θ/2) = b_c·√(1 − r_s/D)/D. For D ≫ r_s this → 2·b_c/D.
 */
export function shadowAngularDiameterRad(massSolar: number, distanceMeters: number): number {
  const rs = schwarzschildRadiusKm(massSolar) * 1000;
  const x = (CRITICAL_B_RS * rs) / distanceMeters;
  const sinHalf = x * Math.sqrt(Math.max(1 - rs / distanceMeters, 0));
  return 2 * Math.asin(Math.min(sinHalf, 1));
}

// ---- null-geodesic integration (Binet form) --------------------------------

export interface TraceOptions {
  /** RK4 step in φ (rad). Default 5e-3. */
  dphi?: number;
  /** Stop integrating beyond this total φ (rad). Default 8π. */
  phiMax?: number;
  /** Escape radius in r_s (u below 1/rEsc counts as escaped). Default 1e4. */
  rEsc?: number;
}

export interface TraceResult {
  /** Photon crossed the horizon (r ≤ r_s). */
  captured: boolean;
  /** Photon reached rEsc without capture. */
  escaped: boolean;
  /** Impact parameter in r_s (conserved, from b² = 1/(u'² + u² − u³)). */
  b: number;
  /** Total deflection vs the straight chord, rad (null unless escaped). */
  deflection: number | null;
  /** Closest approach reached, in r_s. */
  minR: number;
  /** Total φ swept (rad) — windings of near-critical rays show up here. */
  phiTotal: number;
  /** Sampled trajectory (r in r_s, φ in rad), decimated. */
  samples: Array<{ r: number; phi: number }>;
}

/**
 * Integrate the Schwarzschild null geodesic in Binet form
 *   u''(φ) = −u + (3/2) r_s u²,  u = 1/r   (r_s = 1 in these units)
 * with RK4, starting from (u0, u'0) at φ = 0.
 *
 * Straight-line reference: u = sin(φ0 + φ)/b with φ0 = atan2(u0, u'0), so the
 * deflection of an escaped ray is φ_end − (π − φ0).
 */
export function traceGeodesic(u0: number, up0: number, opts: TraceOptions = {}): TraceResult {
  const dphi = opts.dphi ?? 5e-3;
  const phiMax = opts.phiMax ?? 8 * Math.PI;
  const rEsc = opts.rEsc ?? 1e4;
  const b = 1 / Math.sqrt(Math.max(up0 * up0 + u0 * u0 - u0 * u0 * u0, 1e-14));
  const phi0 = Math.atan2(u0, up0);

  const accel = (u: number): number => -u + 1.5 * u * u;
  let u = u0;
  let v = up0;
  let phi = 0;
  let minR = u0 > 0 ? 1 / u0 : Infinity;
  const sampleEvery = Math.max(1, Math.floor((phiMax / dphi) / 600));
  const samples: Array<{ r: number; phi: number }> = [{ r: 1 / u0, phi: 0 }];
  let step = 0;
  let captured = false;
  let escaped = false;

  while (phi < phiMax) {
    // RK4 on the system (u' = v, v' = −u + 1.5u²)
    const k1u = v;
    const k1v = accel(u);
    const k2u = v + (dphi / 2) * k1v;
    const k2v = accel(u + (dphi / 2) * k1u);
    const k3u = v + (dphi / 2) * k2v;
    const k3v = accel(u + (dphi / 2) * k2u);
    const k4u = v + dphi * k3v;
    const k4v = accel(u + dphi * k3u);
    u += (dphi / 6) * (k1u + 2 * k2u + 2 * k3u + k4u);
    v += (dphi / 6) * (k1v + 2 * k2v + 2 * k3v + k4v);
    phi += dphi;
    step++;

    if (u >= 1) {
      // r ≤ r_s: crossed the horizon
      captured = true;
      break;
    }
    if (u <= 1 / rEsc) {
      escaped = true;
      break;
    }
    if (u > 0) {
      const r = 1 / u;
      if (r < minR) minR = r;
    }
    if (step % sampleEvery === 0) samples.push({ r: 1 / Math.max(u, 1e-12), phi });
  }

  const deflection = escaped ? phi - (Math.PI - phi0) : null;
  return { captured, escaped, b, deflection, minR, phiTotal: phi, samples };
}

/**
 * Initial (u, u') for a ray starting at radius r0 with impact parameter b on
 * the incoming branch (u' > 0), from the conserved b² = 1/(u'² + u² − u³).
 */
export function initialConditionsFromB(b: number, r0: number): { u0: number; up0: number } {
  const u0 = 1 / r0;
  const w = 1 / (b * b) - u0 * u0 + u0 * u0 * u0;
  return { u0, up0: Math.sqrt(Math.max(w, 0)) };
}
