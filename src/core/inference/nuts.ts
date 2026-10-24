// ==========================================================================
// Ergalics Studio — Inference Forge NUTS sampler (pure TS, data layer)
//
// No-U-Turn Sampler with *multinomial* trajectory sampling (Betancourt 2017):
// leaves are weighted by exp(H - H0), subtrees merge with progressive
// log-weight sampling, and the trajectory stops when a subtree makes a U-turn
// (Hoffman & Gelman 2014, spec FR9.3). Divergences use Stan's threshold
// (Delta H > 1000). Step size adapts with the same DualAveraging scheme as
// HMC during warmup.
//
// FR9.3 pragmatism note: the spec asks for one Worker per chain, but JS
// closures (the compiled model) cannot cross a Worker boundary without a
// serialization layer, so chains run sequentially here — same as runHmc.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';
import { numericGradient } from './model';
import {
  findReasonableEpsilon,
  makeNormals,
  dot,
  throwIfAborted,
  type SamplerOptions,
  type SamplerRun,
} from './hmc';
import type { ChainSamples, CompiledModel, InferenceConfig } from './types';

const MAX_DEPTH = 10;
const DIVERGENCE = 1000;

/** U-turn criterion: continue only while (etaPlus - etaMinus) has positive
 *  projection onto BOTH endpoint momenta. Exported for direct testing. */
export function isUTurn(
  etaMinus: Float64Array,
  etaPlus: Float64Array,
  rMinus: Float64Array,
  rPlus: Float64Array,
): boolean {
  const d = new Float64Array(etaMinus.length);
  for (let i = 0; i < d.length; i += 1) d[i] = etaPlus[i]! - etaMinus[i]!;
  return dot(d, rMinus) < 0 || dot(d, rPlus) < 0;
}

function logAddExp(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

interface Tree {
  etaMinus: Float64Array;
  rMinus: Float64Array;
  etaPlus: Float64Array;
  rPlus: Float64Array;
  /** Selected proposal (multinomial sample over the subtree's leaves). */
  eta: Float64Array;
  logP: number;
  /** log sum of leaf weights exp(H - H0) inside this subtree. */
  logSumW: number;
  /** Sum and count of per-leaf acceptance statistics (DualAveraging input). */
  sumAlpha: number;
  nAlpha: number;
  divergent: boolean;
  turning: boolean;
}

interface TreeContext {
  logPost: (eta: Float64Array) => number;
  eps: number;
  h0: number;
  rand: () => number;
  signal?: AbortSignal;
  divergences: number;
}

/** One leapfrog step in `direction` — the depth-0 base case. */
function leaf(ctx: TreeContext, eta: Float64Array, r: Float64Array, direction: 1 | -1): Tree {
  throwIfAborted(ctx.signal);
  const eps = direction * ctx.eps;
  const grad = numericGradient(ctx.logPost, eta);
  const etaNew = Float64Array.from(eta);
  const rNew = Float64Array.from(r);
  for (let d = 0; d < etaNew.length; d += 1) rNew[d] = rNew[d]! + 0.5 * eps * grad[d]!;
  for (let d = 0; d < etaNew.length; d += 1) etaNew[d] = etaNew[d]! + eps * rNew[d]!;
  const g2 = numericGradient(ctx.logPost, etaNew);
  const logP = ctx.logPost(etaNew);
  for (let d = 0; d < etaNew.length; d += 1) rNew[d] = rNew[d]! + 0.5 * eps * g2[d]!;
  const h = logP - 0.5 * dot(rNew, rNew);
  const logW = h - ctx.h0;
  if (!Number.isFinite(logP) || logW < -DIVERGENCE) {
    ctx.divergences += 1;
    return {
      etaMinus: etaNew, rMinus: rNew, etaPlus: etaNew, rPlus: rNew,
      eta: etaNew, logP,
      logSumW: -Infinity, sumAlpha: 0, nAlpha: 0,
      divergent: true, turning: false,
    };
  }
  return {
    etaMinus: etaNew, rMinus: rNew, etaPlus: etaNew, rPlus: rNew,
    eta: etaNew, logP,
    logSumW: logW,
    sumAlpha: Math.min(1, Math.exp(Math.min(0, logW))),
    nAlpha: 1,
    divergent: false,
    turning: false,
  };
}

/** Build a subtree of `depth` doubling from (eta, r) along `direction`. */
function buildTree(ctx: TreeContext, depth: number, eta: Float64Array, r: Float64Array, direction: 1 | -1): Tree {
  if (depth === 0) return leaf(ctx, eta, r, direction);
  // First half of the subtree, then continue from its far endpoint.
  const inner = buildTree(ctx, depth - 1, eta, r, direction);
  if (inner.divergent || inner.turning) return inner;
  const outer = buildTree(
    ctx,
    depth - 1,
    direction === 1 ? inner.etaPlus : inner.etaMinus,
    direction === 1 ? inner.rPlus : inner.rMinus,
    direction,
  );
  const combined: Tree = {
    etaMinus: inner.etaMinus,
    rMinus: inner.rMinus,
    etaPlus: direction === 1 ? outer.etaPlus : outer.etaMinus,
    rPlus: direction === 1 ? outer.rPlus : outer.rMinus,
    eta: inner.eta,
    logP: inner.logP,
    logSumW: logAddExp(inner.logSumW, outer.logSumW),
    sumAlpha: inner.sumAlpha + outer.sumAlpha,
    nAlpha: inner.nAlpha + outer.nAlpha,
    divergent: inner.divergent || outer.divergent,
    turning: true,
  };
  if (outer.divergent || outer.turning) return combined;
  // Progressive multinomial: the outer subtree holds
  // exp(logW_outer / exp(logSumW)) of the probability mass.
  if (outer.logSumW > -Infinity && ctx.rand() < Math.exp(outer.logSumW - combined.logSumW)) {
    combined.eta = outer.eta;
    combined.logP = outer.logP;
  }
  combined.turning = isUTurn(combined.etaMinus, combined.etaPlus, combined.rMinus, combined.rPlus);
  return combined;
}

/**
 * Run one NUTS chain (synchronous). Warmup adapts the step size toward
 * `cfg.targetAccept`; the sampling phase uses the fixed adapted step size.
 */
export function runNutsChain(
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

  // Overdispersed deterministic start per chain (same scheme as HMC).
  const eta = Float64Array.from(model.init);
  for (let d = 0; d < dim; d += 1) eta[d] = model.init[d]! + (rand() < 0.5 ? -1 : 1);
  let logP = model.logPost(eta);
  if (!Number.isFinite(logP)) {
    eta.fill(0);
    logP = model.logPost(eta);
    if (!Number.isFinite(logP)) throw new Error('logPosterior is not finite at the initial state');
  }

  let eps = opts.stepSize ?? findReasonableEpsilon(model.logPost, eta, rand, normal);
  const mu = Math.log(10 * eps);
  const gamma = 0.05;
  const t0 = 10;
  const kappa = 0.75;
  let hBar = 0;
  let logEpsBar = 0;
  let adaptCount = 0;

  let accepted = 0;
  let divergences = 0;
  const warmup = Math.max(0, Math.floor(cfg.warmup));
  const t0Wall = performance.now();
  let warmupMs = 0;

  for (let it = 0; it < warmup + total; it += 1) {
    const r0 = new Float64Array(dim);
    for (let d = 0; d < dim; d += 1) r0[d] = normal();
    const h0 = logP - 0.5 * dot(r0, r0);
    const ctx: TreeContext = { logPost: model.logPost, eps, h0, rand, signal: opts.signal, divergences: 0 };

    // Tree doubling: start from the single initial point (weight 0 = H0 - H0).
    let etaMinus = eta;
    let etaPlus = eta;
    let rMinus = r0;
    let rPlus = r0;
    let logSumW = 0;
    let propEta = eta;
    let propLogP = logP;
    let sumAlpha = 0;
    let nAlpha = 0;
    let stopped = false;

    for (let depth = 0; depth < MAX_DEPTH && !stopped; depth += 1) {
      const direction: 1 | -1 = rand() < 0.5 ? -1 : 1;
      const sub = buildTree(
        ctx,
        depth,
        direction === 1 ? etaPlus : etaMinus,
        direction === 1 ? rPlus : rMinus,
        direction,
      );
      divergences += sub.divergent ? 1 : 0;
      sumAlpha += sub.sumAlpha;
      nAlpha += sub.nAlpha;
      if (sub.divergent || sub.turning) {
        stopped = true;
        break;
      }
      // Progressive multinomial over the merged trajectory.
      const newLogSumW = logAddExp(logSumW, sub.logSumW);
      if (sub.logSumW > -Infinity && rand() < Math.exp(sub.logSumW - newLogSumW)) {
        propEta = sub.eta;
        propLogP = sub.logP;
      }
      logSumW = newLogSumW;
      if (direction === 1) {
        etaPlus = sub.etaPlus;
        rPlus = sub.rPlus;
      } else {
        etaMinus = sub.etaMinus;
        rMinus = sub.rMinus;
      }
      if (isUTurn(etaMinus, etaPlus, rMinus, rPlus)) stopped = true;
    }

    // Accept the trajectory sample; track acceptance statistics for DualAveraging.
    if (nAlpha > 0) {
      eta.set(propEta);
      logP = propLogP;
      accepted += 1;
    }
    const alpha = nAlpha > 0 ? sumAlpha / nAlpha : 0;

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
      if (it === warmup - 1 && opts.stepSize === undefined) {
        eps = Math.min(10, Math.max(1e-8, Math.exp(logEpsBar)));
        warmupMs = performance.now() - t0Wall;
      }
    } else {
      const j = it - warmup;
      if ((j + 1) % thin === 0) {
        const k = Math.floor(j / thin);
        for (let d = 0; d < dim; d += 1) samples[d]![k] = eta[d]!;
      }
    }
    throwIfAborted(opts.signal);
  }

  const samplingMs = performance.now() - t0Wall - warmupMs;
  return {
    samples,
    acceptRate: accepted / (warmup + total),
    stepSize: eps,
    divergences,
    warmupMs,
    samplingMs,
  };
}

/** Run all NUTS chains sequentially with per-chain progress + abort support. */
export async function runNuts(
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
    const chain = runNutsChain(model, cfg, c, opts);
    chains.push(chain);
    warmupMs += chain.warmupMs;
    samplingMs += chain.samplingMs;
    opts.onProgress?.(c + 1, cfg.chains);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { chains, timing: { warmupMs, samplingMs, chains: cfg.chains } };
}
