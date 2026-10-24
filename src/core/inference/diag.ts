// ==========================================================================
// Ergalics Studio — Inference Forge diagnostics (pure TS, data layer)
//
// Convergence + summary layer for the samplers (spec FR9.4):
//   • split R-hat      — reused from the tested uncertainty core (identical
//                         Gelman–Rubin estimator, so both engines agree)
//   • bulk / tail ESS  — simplified Vehtari et al. 2021: combined-chain ESS
//                         from direct-sum autocovariances capped at n/2 lags
//                         (no FFT, no rank normalization at this scale)
//   • 94% HDI          — shortest interval covering the probability mass
//   • MCSE             — sd / sqrt(ESS)
//   • PPC              — posterior predictive p-value of a summary statistic
// ==========================================================================

import { hdiSorted, splitRHat } from '@/core/uncertainty/diagnostics';
import { mulberry32 } from '@/core/repro/random';
import type {
  ChainSamples,
  CompiledModel,
  InferenceDiagnostics,
  ParamSummary,
} from './types';

/** Shortest interval covering `prob` of the (copied + sorted) draws. */
export function hdi(samples: ArrayLike<number>, prob = 0.94): [number, number] {
  const sorted = Float64Array.from(samples).sort();
  return hdiSorted(sorted, prob);
}

/** Pooled mean of an array (NaN-safe: skips non-finite values). */
function meanOf(x: ArrayLike<number>): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < x.length; i += 1) {
    if (Number.isFinite(x[i])) {
      s += x[i]!;
      n += 1;
    }
  }
  return n > 0 ? s / n : Number.NaN;
}

function varianceOf(x: ArrayLike<number>): number {
  const m = meanOf(x);
  let ss = 0;
  let n = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = x[i]!;
    if (Number.isFinite(v)) {
      ss += (v - m) * (v - m);
      n += 1;
    }
  }
  return n > 1 ? ss / (n - 1) : 0;
}

/**
 * Autocovariance of one chain at lags 0..maxLag by direct summation.
 * Normalized by n (not n - lag), following the Geyer/Vehtari estimator.
 */
function autocovDirect(x: ArrayLike<number>, maxLag: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(maxLag + 1);
  const m = meanOf(x);
  for (let lag = 0; lag <= maxLag; lag += 1) {
    let s = 0;
    for (let i = 0; i + lag < n; i += 1) s += (x[i]! - m) * (x[i + lag]! - m);
    out[lag] = s / n;
  }
  return out;
}

/**
 * Combined-chain effective sample size across several chains (Geyer initial
 * positive sequence on the pooled autocorrelation, Vehtari et al. 2021 eq. 10
 * without rank normalization). Result is capped to (0, m*n].
 */
export function combinedEss(chains: ArrayLike<number>[]): number {
  const m = chains.length;
  if (m === 0) return 0;
  let n = Infinity;
  for (const c of chains) n = Math.min(n, c.length);
  if (!Number.isFinite(n) || n < 4) return 0;
  const total = m * n;

  const means = new Float64Array(m);
  const vars = new Float64Array(m);
  let w = 0;
  for (let c = 0; c < m; c += 1) {
    means[c] = meanOf(chains[c]!);
    vars[c] = varianceOf(chains[c]!);
    w += vars[c]!;
  }
  w /= m;
  const bOverN = varianceOf(means);
  const varPlus = ((n - 1) / n) * w + bOverN;
  if (!(varPlus > 0)) return total; // all chains constant

  // Direct autocovariances up to n/2 lags (simplification vs the FFT version).
  const maxLag = Math.max(2, Math.floor(n / 2));
  const acov = new Float64Array(maxLag + 1);
  for (let c = 0; c < m; c += 1) {
    const a = autocovDirect(chains[c]!, maxLag);
    for (let t = 0; t <= maxLag; t += 1) acov[t]! += a[t]!;
  }
  for (let t = 0; t <= maxLag; t += 1) acov[t] = acov[t]! / m;

  // rho(t) = 1 - (W - mean_acov(t)) / varPlus, then Geyer pair truncation.
  const rho = (t: number): number => 1 - (w - acov[t]!) / varPlus;
  let sumP = 0;
  for (let k = 0; 2 * k + 1 <= maxLag; k += 1) {
    const pair = rho(2 * k) + rho(2 * k + 1);
    if (pair <= 0) break;
    sumP += pair;
  }
  const tau = Math.max(1 / Math.log10(total + 10), 2 * sumP - 1);
  return Math.min(total, Math.max(1, total / tau));
}

/** Bulk-ESS on the raw draws (simplified: no rank normalization). */
export function essBulk(chains: ArrayLike<number>[]): number {
  return combinedEss(chains);
}

/**
 * Tail-ESS: minimum ESS of the 5% / 95% quantile indicator functions
 * (Vehtari et al. 2021, §3.4 simplified). Low values flag chains that
 * disagree in the tails even when the bulk looks fine.
 */
export function essTail(chains: ArrayLike<number>[]): number {
  const pooled = Float64Array.from(chains.flatMap((c) => Array.from(c))).filter(Number.isFinite).sort();
  if (pooled.length < 8) return combinedEss(chains);
  const q = (p: number): number => pooled[Math.floor(p * (pooled.length - 1))]!;
  const tailEss = (p: number): number => {
    const indicators = chains.map((c) => {
      const thr = q(p);
      return Float64Array.from(c, (v) => (v <= thr ? 1 : 0));
    });
    return combinedEss(indicators);
  };
  return Math.min(tailEss(0.05), tailEss(0.95));
}

/** Monte-Carlo standard error of the mean from the posterior sd and ESS. */
export function mcse(sd: number, ess: number): number {
  if (!(ess > 0)) return Number.NaN;
  return sd / Math.sqrt(ess);
}

/**
 * Map sampler chains (unconstrained draws) through the model transform so
 * diagnostics and summaries operate on the reported (constrained) parameters.
 * Returns [chain][dim] arrays, matching summarizeChains' expected layout.
 */
export function constrainChains(chains: ChainSamples[], model: CompiledModel): Float64Array[][] {
  return chains.map((chain) => {
    const dims = chain.samples.length;
    const n = dims > 0 ? chain.samples[0]!.length : 0;
    const out: Float64Array[] = Array.from({ length: dims }, () => new Float64Array(n));
    const eta = new Float64Array(dims);
    for (let i = 0; i < n; i += 1) {
      for (let d = 0; d < dims; d += 1) eta[d] = chain.samples[d]![i]!;
      const theta = model.transform(eta);
      for (let d = 0; d < dims; d += 1) out[d]![i] = theta[d]!;
    }
    return out;
  });
}

/** PPC result: observed statistic vs the posterior predictive distribution. */
export interface PpcResult {
  stat: string;
  observed: number;
  simulated: Float64Array;
  pValue: number;
}

/**
 * Posterior predictive check (FR9.4): for a subset of posterior draws,
 * simulate one dataset with `likelihoodSim(theta, rand)` and compare a summary
 * statistic against the observed one. Two-sided p-value:
 *   p = 2 * min(P(T_sim >= T_obs), P(T_sim <= T_obs)).
 */
export function posteriorPredictive(
  likelihoodSim: (theta: Record<string, number>, rand: () => number) => ArrayLike<number>,
  observed: ArrayLike<number>,
  samples: Record<string, Float64Array>,
  opts: {
    stat?: (values: ArrayLike<number>) => number;
    statName?: string;
    maxDraws?: number;
    seed?: number;
  } = {},
): PpcResult {
  const stat = opts.stat ?? meanOf;
  const statName = opts.statName ?? 'mean';
  const names = Object.keys(samples);
  if (names.length === 0) throw new Error('posteriorPredictive needs posterior samples');
  const n = samples[names[0]!]!.length;

  const maxDraws = Math.max(1, Math.min(opts.maxDraws ?? 500, n));
  const stride = Math.max(1, Math.floor(n / maxDraws));
  const rand = mulberry32(opts.seed ?? 0x1234567);
  const observedStat = stat(observed);

  const sim = new Float64Array(Math.floor((n - 1) / stride) + 1);
  let count = 0;
  let ge = 0;
  let le = 0;
  const theta: Record<string, number> = {};
  for (let i = 0; i < n; i += stride) {
    for (const name of names) theta[name] = samples[name]![i]!;
    const value = stat(likelihoodSim(theta, rand));
    if (!Number.isFinite(value)) continue;
    sim[count] = value;
    count += 1;
    if (value >= observedStat) ge += 1;
    if (value <= observedStat) le += 1;
  }
  const pGe = count > 0 ? ge / count : 0.5;
  const pLe = count > 0 ? le / count : 0.5;
  return {
    stat: statName,
    observed: observedStat,
    simulated: sim.slice(0, count),
    pValue: Math.min(1, 2 * Math.min(pGe, pLe)),
  };
}

/** Flatten per-chain draws (chain-major, dim-minor) into pooled arrays. */
export function summarizeChains(
  chains: Float64Array[][],
  paramNames: string[],
): {
  samples: Record<string, Float64Array>;
  diagnostics: InferenceDiagnostics;
  summary: Record<string, ParamSummary>;
} {
  const samples: Record<string, Float64Array> = {};
  const rHat: Record<string, number> = {};
  const essBulkMap: Record<string, number> = {};
  const essTailMap: Record<string, number> = {};
  const summary: Record<string, ParamSummary> = {};

  for (let d = 0; d < paramNames.length; d += 1) {
    const name = paramNames[d]!;
    const perChain = chains.map((c) => c[d] ?? new Float64Array(0));
    const total = perChain.reduce((s, c) => s + c.length, 0);
    const pooled = new Float64Array(total);
    let k = 0;
    for (const c of perChain) {
      pooled.set(c, k);
      k += c.length;
    }
    samples[name] = pooled;

    const sd = Math.sqrt(varianceOf(pooled));
    const ess = essBulk(perChain);
    rHat[name] = splitRHat(perChain);
    essBulkMap[name] = ess;
    essTailMap[name] = essTail(perChain);

    const sorted = Float64Array.from(pooled).sort();
    const median = sorted.length % 2
      ? sorted[sorted.length >> 1]!
      : (sorted[(sorted.length >> 1) - 1]! + sorted[sorted.length >> 1]!) / 2;
    summary[name] = {
      mean: meanOf(pooled),
      sd,
      median,
      hdi94: hdi(pooled, 0.94),
      mcse: mcse(sd, ess),
    };
  }

  return { samples, diagnostics: { rHat, essBulk: essBulkMap, essTail: essTailMap }, summary };
}
