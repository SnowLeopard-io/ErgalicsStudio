// ==========================================================================
// Ergalics Studio — Inference Forge HMC sampler (pure TS, data layer)
//
// Hamiltonian Monte Carlo with position-momentum leapfrog integration and
// DualAveraging step-size adaptation during warmup (Hoffman & Gelman 2014,
// spec FR9.2). The mass matrix is the identity — a pragmatic simplification,
// the DSL models here are small (dim <= ~20) and well-conditioned.
//
// Determinism: every chain draws from its own mulberry32 stream derived from
// (seed, chainIndex), so a config replays bit-for-bit. All chains run
// sequentially — the closures cannot cross a Worker boundary (see nuts.ts).
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';
import { numericGradient } from './model';
import type { ChainSamples, CompiledModel, InferenceConfig } from './types';

export interface SamplerOptions {
  /** Fix the step size (skips DualAveraging adaptation). */
  stepSize?: number;
  /** Fix the number of leapfrog steps per trajectory. When omitted the
   *  trajectory length is jittered uniformly in [1, 32] each iteration. */
  numSteps?: number;
  signal?: AbortSignal;
}

export interface SamplerRun {
  chains: ChainSamples[];
  timing: { warmupMs: number; samplingMs: number; chains: number };
}

const MAX_STEPS = 64;
/** Divergence threshold on the Hamiltonian error (Stan's Δmax = 1000). */
const DIVERGENCE = 1000;

/** Throw an AbortError-named Error so callers can match on `err.name`. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const err = new Error('sampler aborted');
    err.name = 'AbortError';
    throw err;
  }
}

/** Box-Muller standard normals over one uniform stream (per-stream cache). */
export function makeNormals(rand: () => number): () => number {
  let cache: number | null = null;
  return function normal(): number {
    if (cache !== null) {
      const v = cache;
      cache = null;
      return v;
    }
    let u1 = rand();
    while (u1 <= 0) u1 = rand();
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    cache = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

export function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i]! * b[i]!;
  return s;
}

export interface LeapfrogResult {
  eta: Float64Array;
  r: Float64Array;
  logP: number;
  divergent: boolean;
}

/**
 * Integrate Hamilton's equations for `nSteps` leapfrog steps of size eps in
 * the potential U(eta) = -logPost(eta). Signals a divergence when the
 * trajectory leaves the support (non-finite log posterior) or the Hamiltonian
 * error blows past `DIVERGENCE`.
 */
export function leapfrogTrajectory(
  logPost: (eta: Float64Array) => number,
  eta0: Float64Array,
  r0: Float64Array,
  eps: number,
  nSteps: number,
  signal?: AbortSignal,
): LeapfrogResult {
  let grad = numericGradient(logPost, eta0);
  const eta = Float64Array.from(eta0);
  const r = Float64Array.from(r0);
  const h0 = -logPost(eta0) + 0.5 * dot(r0, r0);
  let logP = logPost(eta);
  for (let s = 0; s < nSteps; s += 1) {
    throwIfAborted(signal);
    // Half step for momentum, full step for position, half step for momentum;
    // the second half-kick uses the gradient at the *new* position.
    for (let d = 0; d < eta.length; d += 1) r[d] = r[d]! + 0.5 * eps * grad[d]!;
    for (let d = 0; d < eta.length; d += 1) eta[d] = eta[d]! + eps * r[d]!;
    grad = numericGradient(logPost, eta);
    logP = logPost(eta);
    if (!Number.isFinite(logP)) return { eta, r, logP, divergent: true };
    for (let d = 0; d < eta.length; d += 1) r[d] = r[d]! + 0.5 * eps * grad[d]!;
    // Hamiltonian error check against the start of *this* trajectory.
    const hErr = -logP + 0.5 * dot(r, r) - h0;
    if (!Number.isFinite(hErr) || Math.abs(hErr) > DIVERGENCE) {
      return { eta, r, logP, divergent: true };
    }
  }
  return { eta, r, logP, divergent: false };
}

/** Simplified FindReasonableEpsilon: double/halve until one leapfrog step
 *  crosses the 0.5 acceptance boundary (Hoffman & Gelman 2014, Algorithm 4). */
export function findReasonableEpsilon(
  logPost: (eta: Float64Array) => number,
  eta: Float64Array,
  rand: () => number,
  normal: () => number,
): number {
  const r = new Float64Array(eta.length);
  for (let d = 0; d < r.length; d += 1) r[d] = normal();
  let eps = 1;
  const r0 = rand();
  const base = logPost(eta);
  const step = (e: number): number => {
    const res = leapfrogTrajectory(logPost, eta, r, e, 1);
    if (!Number.isFinite(res.logP)) return 0;
    return Math.exp(res.logP - 0.5 * dot(res.r, res.r) - (base - 0.5 * dot(r, r)));
  };
  const dir = step(eps) > r0 ? 1 : -1;
  for (let i = 0; i < 60; i += 1) {
    eps *= 2 ** dir;
    const ratio = step(eps);
    if (!(ratio ** dir > 2 ** -dir)) break;
    if (eps > 10 || eps < 1e-8) break;
  }
  return Math.min(10, Math.max(1e-8, eps));
}

/**
 * Run one HMC chain (synchronous). Warmup adapts the step size with
 * DualAveraging toward `cfg.targetAccept`; the sampling phase uses the fixed
 * adapted (or user-provided) step size.
 */
export function runHmcChain(
  model: CompiledModel,
  cfg: InferenceConfig,
  chainIndex: number,
  opts: SamplerOptions = {},
): ChainSamples {
  const dim = model.dim;
  const rand = mulberry32((cfg.seed ^ Math.imul(0x9e3779b9, chainIndex + 1)) >>> 0);
  const normal = makeNormals(rand);
  const thin = Math.max(1, Math.floor(cfg.thin ?? 1));
  const kept = Math.max(1, Math.floor(cfg.samples));
  const total = kept * thin;

  const samples: Float64Array[] = Array.from({ length: dim }, () => new Float64Array(kept));

  // Overdispersed deterministic start per chain.
  const eta = Float64Array.from(model.init);
  for (let d = 0; d < dim; d += 1) eta[d] = model.init[d]! + (rand() < 0.5 ? -1 : 1);
  let logP = model.logPost(eta);
  if (!Number.isFinite(logP)) {
    // Init fell outside the support (custom models): fall back to eta = 0.
    eta.fill(0);
    logP = model.logPost(eta);
    if (!Number.isFinite(logP)) throw new Error('logPosterior is not finite at the initial state');
  }

  let eps = opts.stepSize ?? findReasonableEpsilon(model.logPost, eta, rand, normal);
  // DualAveraging state (gamma/t0/kappa from Hoffman & Gelman 2014, §3.2).
  const mu = Math.log(10 * eps);
  const gamma = 0.05;
  const t0 = 10;
  const kappa = 0.75;
  let hBar = 0;
  let logEpsBar = 0;
  let adaptCount = 0;

  const maxL = Math.min(MAX_STEPS, Math.max(1, Math.floor(opts.numSteps ?? MAX_STEPS)));
  let accepted = 0;
  let divergences = 0;
  const warmup = Math.max(0, Math.floor(cfg.warmup));
  const t0Wall = performance.now();
  let warmupMs = 0;

  for (let it = 0; it < warmup + total; it += 1) {
    const r0 = new Float64Array(dim);
    for (let d = 0; d < dim; d += 1) r0[d] = normal();
    const nSteps = opts.numSteps !== undefined ? maxL : 1 + Math.floor(rand() * maxL);
    const traj = leapfrogTrajectory(model.logPost, eta, r0, eps, nSteps, opts.signal);

    let alpha = 0;
    if (!traj.divergent && Number.isFinite(traj.logP)) {
      const logRatio = traj.logP - 0.5 * dot(traj.r, traj.r) - (logP - 0.5 * dot(r0, r0));
      alpha = Math.min(1, Math.exp(Math.min(0, logRatio)));
      if (rand() < alpha) {
        eta.set(traj.eta);
        logP = traj.logP;
        accepted += 1;
      }
    } else {
      divergences += 1;
    }

    if (it < warmup) {
      if (opts.stepSize === undefined) {
        adaptCount += 1;
        const w = 1 / (adaptCount + t0);
        hBar = (1 - w) * hBar + w * (cfg.targetAccept - alpha);
        const logEps = mu - (Math.sqrt(adaptCount) / gamma) * hBar;
        const etaW = adaptCount ** -kappa;
        logEpsBar = etaW * logEps + (1 - etaW) * logEpsBar;
        eps = Math.min(10, Math.max(1e-8, Math.exp(logEps)));
      }
      if (it === warmup - 1) {
        if (opts.stepSize === undefined) eps = Math.min(10, Math.max(1e-8, Math.exp(logEpsBar)));
        warmupMs = performance.now() - t0Wall;
      }
    } else {
      // Post-warmup: store every `thin`-th draw (thin = 1 keeps them all).
      const j = it - warmup;
      if ((j + 1) % thin === 0) {
        const k = Math.floor(j / thin);
        for (let d = 0; d < dim; d += 1) samples[d]![k] = eta[d]!;
      }
    }
  }

  const samplingMs = performance.now() - t0Wall - warmupMs;
  const iterations = warmup + total;
  return {
    samples,
    acceptRate: accepted / iterations,
    stepSize: eps,
    divergences,
    warmupMs,
    samplingMs,
  };
}

/**
 * Run all chains sequentially (JS closures cannot cross a Worker boundary, so
 * the "multi-chain parallelism" of FR9.3 is chain-level orchestration here).
 * Yields to the host between chains and reports progress per finished chain.
 */
export async function runHmc(
  model: CompiledModel,
  cfg: InferenceConfig,
  opts: SamplerOptions & {
    onProgress?: (chainsDone: number, totalChains: number) => void;
  } = {},
): Promise<SamplerRun> {
  const chains: ChainSamples[] = [];
  let warmupMs = 0;
  let samplingMs = 0;
  for (let c = 0; c < cfg.chains; c += 1) {
    throwIfAborted(opts.signal);
    const chain = runHmcChain(model, cfg, c, opts);
    chains.push(chain);
    warmupMs += chain.warmupMs;
    samplingMs += chain.samplingMs;
    opts.onProgress?.(c + 1, cfg.chains);
    // Give the event loop a turn so progress can paint between chains.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { chains, timing: { warmupMs, samplingMs, chains: cfg.chains } };
}
