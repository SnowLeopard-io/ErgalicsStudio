// ==========================================================================
// Water-waves plugin — physics core (pure TS, testable).
//
// Two models, both mirrored by the GLSL in `shaders.ts`:
//  1. Ripples — the linear 2-D wave equation h_tt = c²∇²h stepped with an
//     explicit FDTD leapfrog stencil (identical to the GPU ping-pong pass),
//     including sponge-layer absorbing boundaries and sinusoidal point
//     sources. c = √(g·h_depth) is the real shallow-water speed, so the
//     simulation is dimensionally correct for a pool of a given depth.
//  2. Ocean — Gerstner (trochoidal) wave trains on the exact deep-water
//     dispersion relation ω² = g·k, with amplitudes scaled from the
//     Pierson–Moskowitz fully-developed-sea peak.
// ==========================================================================

/** 2-D CFL limit for the explicit wave stencil: c·dt/dx ≤ 1/√2. */
export const CFL_MAX_2D = 1 / Math.SQRT2;

/** Shallow-water (pool) wave speed c = √(g·depth). */
export function shallowWaterSpeed(depthM: number, g = 9.81): number {
  return Math.sqrt(g * Math.max(depthM, 0.01));
}

export interface FdtdOptions {
  /** CFL number A = c·dt/dx (≤ 1/√2 for stability). */
  a: number;
  /** Per-step height damping in (0, 1]. */
  damping: number;
  /** Sponge-layer width in cells (0 = reflective boundaries). */
  absorbWidth: number;
}

export interface PointSource {
  /** Cell coordinates. */
  x: number;
  y: number;
  /** Angular frequency, rad/step. */
  omega: number;
  amplitude: number;
}

/**
 * One leapfrog step of h_tt = A²·∇²h (A = c·dt/dx) over an n×n field.
 * Returns the new height field (h_new = 2h − h_prev + A²·(Σnb − 4h) + src).
 * Mirrors the GPU solver exactly (same sponge profile and source shape).
 */
export function waveStepFdtd(
  prev: Float32Array,
  curr: Float32Array,
  n: number,
  opts: FdtdOptions,
  sources: PointSource[] = [],
  step = 0,
): Float32Array {
  const next = new Float32Array(n * n);
  const a2 = opts.a * opts.a;
  const damp = Math.min(Math.max(opts.damping, 0.01), 1);
  const sig = 1.5; // source/drop spatial σ, cells
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const idx = j * n + i;
      const hL = curr[j * n + Math.max(i - 1, 0)] ?? 0;
      const hR = curr[j * n + Math.min(i + 1, n - 1)] ?? 0;
      const hD = curr[Math.max(j - 1, 0) * n + i] ?? 0;
      const hU = curr[Math.min(j + 1, n - 1) * n + i] ?? 0;
      let h = 2 * (curr[idx] ?? 0) - (prev[idx] ?? 0) + a2 * (hL + hR + hD + hU - 4 * (curr[idx] ?? 0));
      for (const s of sources) {
        const dx = i - s.x;
        const dy = j - s.y;
        h += s.amplitude * Math.sin(s.omega * step) * Math.exp(-(dx * dx + dy * dy) / (2 * sig * sig));
      }
      h *= damp;
      if (opts.absorbWidth > 0) {
        // Quadratic sponge: extra damping ramping toward the edges.
        const edge = Math.min(i, j, n - 1 - i, n - 1 - j);
        if (edge < opts.absorbWidth) {
          const s = edge / opts.absorbWidth;
          h *= 1 - 0.22 * (1 - s) * (1 - s);
        }
      }
      next[idx] = h;
    }
  }
  return next;
}

/**
 * Discrete dispersion of the FDTD stencil:
 * ω = (2/dt)·asin(c·dt·sin(k·dx/2)/dx). Tends to ω = c·k as k·dx → 0.
 */
export function fdtdOmega(k: number, a: number, dt = 1, dx = 1): number {
  const s = Math.min(a * Math.sin((k * dx) / 2), 1);
  return (2 * Math.asin(s)) / dt;
}

// ---- deep-water ocean (Gerstner) -------------------------------------------

export interface OceanWave {
  /** Wavenumber, rad/m. */
  k: number;
  /** Angular frequency from ω = √(g·k), rad/s. */
  omega: number;
  /** Amplitude, m. */
  amplitude: number;
  /** Unit direction. */
  dirX: number;
  dirZ: number;
  /** Initial phase, rad. */
  phase: number;
  /** Gerstner sharpening coefficient (q·k·A ≤ 1). */
  q: number;
}

export interface SeaState {
  /** Pierson–Moskowitz peak frequency ω_p = 0.855·g/U. */
  omegaP: number;
  /** Peak wavelength 2π·g/ω_p². */
  lambdaP: number;
  /** Peak period 2π/ω_p. */
  periodP: number;
  /** Phase speed at the peak g/ω_p. */
  cpP: number;
  /** Group velocity at the peak c_p/2. */
  cgP: number;
  /** Significant wave height H_s ≈ 0.21·U²/g. */
  hs: number;
}

/** Fully-developed-sea (Pierson–Moskowitz) peak parameters for wind speed U. */
export function piersonMoskowitzPeak(windMs: number, g = 9.81): SeaState {
  const omegaP = (0.855 * g) / Math.max(windMs, 0.5);
  const lambdaP = (2 * Math.PI * g) / (omegaP * omegaP);
  const periodP = (2 * Math.PI) / omegaP;
  const cpP = g / omegaP;
  return { omegaP, lambdaP, periodP, cpP, cgP: cpP / 2, hs: (0.21 * windMs * windMs) / g };
}

/** Deterministic PRNG (mulberry32) so spectra are reproducible from a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a deterministic Gerstner spectrum for a wind speed: K trains spread
 * ±60° around the wind direction, k log-spaced across [λ_p/9, 4·λ_p], with
 * amplitudes ∝ k^{-1.3} normalised so ΣA ≈ H_s/3 (visual RMS-ish height).
 */
export function buildSpectrum(windMs: number, count: number, seed: number, choppy: number, windDirRad = 0): OceanWave[] {
  const g = 9.81;
  const sea = piersonMoskowitzPeak(windMs, g);
  const kMin = (2 * Math.PI) / (4 * sea.lambdaP);
  const kMax = (2 * Math.PI) / (sea.lambdaP / 9);
  const rnd = mulberry32(seed);
  const kLogMin = Math.log(kMin);
  const kLogMax = Math.log(kMax);
  const raw: number[] = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const k = Math.exp(kLogMin + ((kLogMax - kLogMin) * i) / Math.max(count - 1, 1));
    const a = Math.pow(k, -1.3);
    raw.push(a);
    sum += a;
  }
  const target = sea.hs / 3;
  const waves: OceanWave[] = [];
  for (let i = 0; i < count; i++) {
    const k = Math.exp(kLogMin + ((kLogMax - kLogMin) * i) / Math.max(count - 1, 1));
    const amplitude = ((raw[i] ?? 0) / sum) * target;
    const spread = (rnd() * 2 - 1) * (Math.PI / 3);
    const dir = windDirRad + spread;
    // q per wave: choppy ∈ [0,1] is the target sharpening, clamped by the
    // per-wave self-intersection limit q·k·A ≤ 1. (No √count factor — that
    // made q·k·A independent of k,A and clamped q to 1 for any choppy > 0.)
    const q = Math.min(choppy, 1 / Math.max(k * amplitude, 1e-6));
    waves.push({
      k,
      omega: Math.sqrt(g * k),
      amplitude,
      dirX: Math.cos(dir),
      dirZ: Math.sin(dir),
      phase: rnd() * Math.PI * 2,
      q,
    });
  }
  return waves;
}

/**
 * Gerstner displacement of the surface point whose rest position is (x0, z0):
 *   x = x0 − Σ q·A·Dx·sin(θ), y = Σ A·cos(θ), z = z0 − Σ q·A·Dz·sin(θ)
 * with θ = k·(D·x0) − ω·t + φ.
 */
export function gerstnerDisplacement(
  waves: OceanWave[],
  x0: number,
  z0: number,
  t: number,
): { x: number; y: number; z: number } {
  let x = x0;
  let y = 0;
  let z = z0;
  for (const w of waves) {
    const theta = w.k * (w.dirX * x0 + w.dirZ * z0) - w.omega * t + w.phase;
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    x -= w.q * w.amplitude * w.dirX * s;
    z -= w.q * w.amplitude * w.dirZ * s;
    y += w.amplitude * c;
  }
  return { x, y, z };
}

/** Max steepness of a wave train: k·A·q must stay ≤ 1 to avoid self-intersection. */
export function gerstnerSteepness(w: OceanWave): number {
  return w.k * w.amplitude * w.q;
}
