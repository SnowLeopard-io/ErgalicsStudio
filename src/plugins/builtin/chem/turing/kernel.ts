// ==========================================================================
// chem-turing — Gray–Scott reaction–diffusion kernel (pure TS, no DOM)
//
// Two-species reaction–diffusion on an N×N periodic grid, explicit FTCS
// (forward-time centred-space) with the 5-point Laplacian:
//   ∂u/∂t = Du·∇²u − u v² + f·(1−u)      (feed replenishes u)
//   ∂v/∂t = Dv·∇²v + u v² − (f+k)·v      (drain removes v)
// u v² is the autocatalytic step; f and f+k are the feed / drain rates of
// the open reactor. With f = k = 0 the reactor is closed: both Laplacians
// sum to exactly zero over a periodic grid and the reaction term cancels
// cell by cell, so Σ(u+v) is conserved to floating-point round-off — the
// mass-conservation benchmark below. Pearson (1993) classic (f, k) regimes
// are provided as presets. FTCS stability for the diffusion part requires
// dt ≤ 1/(4·max(Du,Dv)) at unit grid spacing.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

export interface GrayScottParams {
  /** Feed rate f. */
  f: number;
  /** Kill (drain) rate k. */
  k: number;
  /** Diffusion coefficient of u. */
  du: number;
  /** Diffusion coefficient of v. */
  dv: number;
  /** Time step (FTCS: must satisfy dt ≤ 1/(4·max(Du,Dv)) for stability). */
  dt: number;
}

export interface GrayScottState {
  n: number;
  u: Float64Array;
  v: Float64Array;
  /** Double buffers swapped by `step`. */
  u2: Float64Array;
  v2: Float64Array;
  /** Number of integration steps applied so far. */
  steps: number;
}

/** Largest FTCS-stable time step at unit grid spacing: dt ≤ 1/(4·Dmax). */
export function maxStableDt(du: number, dv: number): number {
  return 1 / (4 * Math.max(du, dv, 1e-12));
}

/** Allocate a u=1, v=0 state (fresh feed stock, no catalyst). */
export function createState(n: number): GrayScottState {
  const size = n * n;
  const u = new Float64Array(size).fill(1);
  return { n, u, v: new Float64Array(size), u2: new Float64Array(size), v2: new Float64Array(size), steps: 0 };
}

export type SeedPattern = 'center' | 'random';

/** Seed v with a central square patch (deterministic, textbook starting point). */
export function seedCenter(state: GrayScottState, value = 0.5, half = 0): void {
  const { n } = state;
  const h = half > 0 ? half : Math.max(2, Math.floor(n / 16));
  state.v.fill(0);
  for (let y = Math.floor(n / 2) - h; y < Math.floor(n / 2) + h; y += 1) {
    for (let x = Math.floor(n / 2) - h; x < Math.floor(n / 2) + h; x += 1) {
      state.v[((y + n) % n) * n + ((x + n) % n)] = value;
    }
  }
}

/** Seed v with `count` Gaussian-blob spots from a fixed seed (deterministic). */
export function seedRandom(state: GrayScottState, seed: number, count = 12): void {
  const { n } = state;
  const rand = mulberry32(seed);
  state.v.fill(0);
  for (let s = 0; s < count; s += 1) {
    const cy = Math.floor(rand() * n);
    const cx = Math.floor(rand() * n);
    const r = Math.max(2, Math.floor(n / 24));
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy > r * r) continue;
        state.v[((cy + dy + n) % n) * n + ((cx + dx + n) % n)] = 0.5;
      }
    }
  }
}

/** Total mass Σ(u+v) over the grid. */
export function totalMass(state: GrayScottState): number {
  let m = 0;
  for (let i = 0; i < state.u.length; i += 1) m += state.u[i]! + state.v[i]!;
  return m;
}

/** True when every u/v sample is finite (no NaN / ±Inf after evolution). */
export function isFiniteState(state: GrayScottState): boolean {
  for (let i = 0; i < state.u.length; i += 1) {
    if (!Number.isFinite(state.u[i]!) || !Number.isFinite(state.v[i]!)) return false;
  }
  return true;
}

/**
 * One explicit FTCS step with periodic boundaries. The same `u v²` sample
 * feeds both updates (− for u, + for v), so with f = k = 0 the reaction
 * cancels and Σ(u+v) changes only by the Laplacian sums — zero for a
 * periodic grid up to floating-point round-off.
 */
export function step(state: GrayScottState, p: GrayScottParams): void {
  const { n, u, v, u2, v2 } = state;
  const { f, k, du, dv, dt } = p;
  for (let y = 0; y < n; y += 1) {
    const ym = ((y - 1 + n) % n) * n;
    const yp = ((y + 1) % n) * n;
    const yc = y * n;
    for (let x = 0; x < n; x += 1) {
      const xm = (x - 1 + n) % n;
      const xp = (x + 1) % n;
      const i = yc + x;
      const uvv = u[i]! * v[i]! * v[i]!;
      const lu = u[ym + x]! + u[yp + x]! + u[yc + xm]! + u[yc + xp]! - 4 * u[i]!;
      const lv = v[ym + x]! + v[yp + x]! + v[yc + xm]! + v[yc + xp]! - 4 * v[i]!;
      u2[i] = u[i]! + dt * (du * lu - uvv + f * (1 - u[i]!));
      v2[i] = v[i]! + dt * (dv * lv + uvv - (f + k) * v[i]!);
    }
  }
  state.u = u2;
  state.v = v2;
  state.u2 = u;
  state.v2 = v;
  state.steps += 1;
}

/** Convenience: `steps` successive FTCS steps. */
export function stepN(state: GrayScottState, p: GrayScottParams, steps: number): void {
  for (let i = 0; i < steps; i += 1) step(state, p);
}

// ---- pattern statistics (Pearson-regime qualitative anchors) -------------------

export interface FieldStats {
  /** Mean of the field. */
  mean: number;
  /** Standard deviation of the field. */
  std: number;
  /** Fraction of cells above `threshold` (spot coverage). */
  coverage: number;
  /** Pearson autocorrelation of the field against its x-shift by `lag` (periodic). */
  autocorr: number;
}

/**
 * Statistics of one species field used by the qualitative pattern checks:
 * a steady spot/soliton pattern has a small non-zero coverage, a sizable
 * contrast (std) and a finite correlation length (autocorrelation decays
 * with lag). These are qualitative Pearson-1993 regime anchors, not
 * quantitative predictions.
 */
export function fieldStats(state: GrayScottState, field: 'u' | 'v', threshold: number, lag: number): FieldStats {
  const w = field === 'u' ? state.u : state.v;
  const size = state.n * state.n;
  let sum = 0;
  let sumSq = 0;
  let above = 0;
  for (let i = 0; i < size; i += 1) {
    const val = w[i]!;
    sum += val;
    sumSq += val * val;
    if (val > threshold) above += 1;
  }
  const mean = sum / size;
  const variance = Math.max(sumSq / size - mean * mean, 0);
  // Autocorrelation at the given x-lag (periodic wrap, same row).
  const lg = ((lag % state.n) + state.n) % state.n;
  let cov = 0;
  for (let y = 0; y < state.n; y += 1) {
    for (let x = 0; x < state.n; x += 1) {
      cov += w[y * state.n + x]! * w[y * state.n + ((x + lg) % state.n)]!;
    }
  }
  cov /= size;
  const denom = sumSq / size - mean * mean;
  const autocorr = denom > 1e-30 ? (cov - mean * mean) / denom : 1;
  return { mean, std: Math.sqrt(variance), coverage: above / size, autocorr };
}

// ---- Pearson (1993) classic parameter regimes ----------------------------------

export interface GrayScottPreset {
  key: string;
  en: string;
  zh: string;
  f: number;
  k: number;
}

/**
 * Classic Pearson-classification (f, k) regimes as popularised by the
 * Gray–Scott galleries (Pearson 1993, Science 261; Sims / Munafo tables).
 * Diffusion constants are the common Du=0.16, Dv=0.08, dt=1 parameterisation.
 */
export const GRAY_SCOTT_PRESETS: GrayScottPreset[] = [
  { key: 'spots', en: 'Soliton spots', zh: '孤子斑点', f: 0.03, k: 0.062 },
  { key: 'pulsating', en: 'Pulsating spots', zh: '脉动斑点', f: 0.025, k: 0.06 },
  { key: 'worms', en: 'Worms', zh: '蠕虫纹', f: 0.058, k: 0.065 },
  { key: 'uskate', en: 'U-skate world', zh: 'U 型滑冰世界', f: 0.062, k: 0.0609 },
  { key: 'mitosis', en: 'Mitosis', zh: '有丝分裂', f: 0.0367, k: 0.0649 },
  { key: 'coral', en: 'Coral growth', zh: '珊瑚生长', f: 0.0545, k: 0.062 },
];
