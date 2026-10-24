// ==========================================================================
// Ergalics Studio — MCMC convergence diagnostics (pure TS, data layer)
//
//   • split-R-hat (Gelman–Rubin with split chains, Gelman et al. 2013)
//   • effective sample size (ESS) with Geyer's initial-positive-sequence
//     autocorrelation estimator, ACF computed through FFT so it stays fast
//     at the 1e6-sample scale F1 targets
//
// Both accept several chains (recommended ≥ 4). All inputs are plain
// Float64Arrays so GPU readback buffers plug in directly.
// ==========================================================================

import { fft, nextPow2 } from '@/core/signal/fft';

/** Autocorrelation ρ[k] for k = 0 … maxLag via circular FFT convolution. */
export function autocorrelationFFT(x: ArrayLike<number>, maxLag: number): Float64Array {
  const n = x.length;
  const lag = Math.min(Math.max(0, maxLag), n - 1);
  const out = new Float64Array(lag + 1);
  if (n < 2) {
    out[0] = 1;
    return out;
  }
  let mean = 0;
  for (let i = 0; i < n; i += 1) mean += x[i]!;
  mean /= n;
  const size = nextPow2(2 * n);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let i = 0; i < n; i += 1) re[i] = x[i]! - mean;
  fft(re, im, false);
  for (let i = 0; i < size; i += 1) {
    re[i] = re[i]! * re[i]! + im[i]! * im[i]!;
    im[i] = 0;
  }
  fft(re, im, true);
  const denom = re[0]!;
  if (denom <= 0 || !Number.isFinite(denom)) {
    out.fill(0);
    out[0] = 1;
    return out;
  }
  for (let k = 0; k <= lag; k += 1) out[k] = re[k]! / denom;
  return out;
}

/**
 * Effective sample size for one chain:
 *   ESS = n / (1 + 2 Σ ρ[k])
 * with the sum truncated by Geyer's initial positive sequence (pair sums of
 * adjacent autocorrelations must stay positive).
 */
export function effectiveSampleSize(chain: ArrayLike<number>): number {
  const n = chain.length;
  if (n < 4) return n;
  // Lag cap: ESS is never larger than n, and beyond √n-ish lags the estimate
  // is noise; initial-positive truncation usually stops much earlier.
  const rho = autocorrelationFFT(chain, Math.min(n - 1, Math.max(100, Math.floor(Math.sqrt(n) * 4))));
  let pairSum = 0;
  for (let k = 1; k + 1 < rho.length; k += 2) {
    const pair = rho[k]! + rho[k + 1]!;
    if (pair <= 0) break;
    pairSum += pair;
  }
  const tau = 1 + 2 * pairSum;
  return Math.min(n, n / Math.max(1, tau));
}

/**
 * Split-R-hat for a single parameter across ≥ 2 chains. Each chain is split
 * in half, doubling the chain count, so within-chain non-stationarity is
 * caught (Gelman et al., Bayesian Data Analysis 3rd ed., §11.4).
 *
 * Returns 1 for degenerate (constant everywhere) draws and NaN when fewer
 * than 4 total post-split draws are available.
 */
export function splitRHat(chains: Array<ArrayLike<number>>): number {
  const halves: ArrayLike<number>[] = [];
  for (const chain of chains) {
    const mid = Math.floor(chain.length / 2);
    if (mid < 2) continue;
    const a: number[] = [];
    const b: number[] = [];
    for (let i = 0; i < mid; i += 1) a.push(chain[i]!);
    for (let i = mid; i < chain.length; i += 1) b.push(chain[i]!);
    if (a.length >= 2) halves.push(a);
    if (b.length >= 2) halves.push(b);
  }
  const m = halves.length;
  if (m < 2) return Number.NaN;
  const n = halves[0]!.length;
  const means = new Float64Array(m);
  const vars = new Float64Array(m);
  let grand = 0;
  for (let j = 0; j < m; j += 1) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += halves[j]![i]!;
    means[j] = s / n;
    grand += means[j]!;
  }
  grand /= m;
  let w = 0;
  let b = 0;
  for (let j = 0; j < m; j += 1) {
    let ss = 0;
    for (let i = 0; i < n; i += 1) {
      const d = halves[j]![i]! - means[j]!;
      ss += d * d;
    }
    vars[j] = ss / (n - 1);
    w += vars[j]!;
    b += (means[j]! - grand) ** 2;
  }
  w /= m;
  b *= n / (m - 1);
  if (w <= 0) {
    // All chains constant: mixed iff they share the same value.
    return b === 0 ? 1 : Number.POSITIVE_INFINITY;
  }
  const varPlus = ((n - 1) / n) * w + b / n;
  return Math.sqrt(varPlus / w);
}

export interface McmcDiagnostics {
  /** Split-R-hat per parameter. */
  rHat: number[];
  /** Bulk effective sample size per parameter (chains pooled after R-hat). */
  ess: number[];
  /** True when every R-hat is finite and ≤ threshold (default 1.01). */
  converged: boolean;
}

/**
 * Per-parameter diagnostics for multi-chain MCMC output. `chains[c][d]` is
 * chain c, dimension d. Pooled ESS sums per-chain ESS (chains run from
 * independent seeds, so their effective draws add).
 */
export function mcmcDiagnostics(
  chains: Array<Array<ArrayLike<number>>>,
  rHatThreshold = 1.01,
): McmcDiagnostics {
  if (chains.length === 0 || chains[0]!.length === 0) {
    return { rHat: [], ess: [], converged: false };
  }
  const dims = chains[0]!.length;
  const rHat: number[] = [];
  const ess: number[] = [];
  let converged = true;
  for (let d = 0; d < dims; d += 1) {
    const perChain = chains.map((c) => c[d]!);
    const r = splitRHat(perChain);
    rHat.push(r);
    let totalEss = 0;
    for (const chain of perChain) totalEss += effectiveSampleSize(chain);
    ess.push(Math.round(totalEss));
    if (!Number.isFinite(r) || r > rHatThreshold) converged = false;
  }
  return { rHat, ess, converged };
}

/**
 * Highest-density interval: the narrowest interval covering `prob` mass of
 * the (sorted) samples. Caller passes an already-sorted copy.
 */
export function hdiSorted(sorted: ArrayLike<number>, prob = 0.94): [number, number] {
  const n = sorted.length;
  if (n === 0) return [Number.NaN, Number.NaN];
  if (n === 1) return [sorted[0]!, sorted[0]!];
  const count = Math.max(1, Math.floor(prob * n));
  let bestLo = 0;
  let bestWidth = Infinity;
  for (let i = 0; i + count - 1 < n; i += 1) {
    const width = sorted[i + count - 1]! - sorted[i]!;
    if (width < bestWidth) {
      bestWidth = width;
      bestLo = i;
    }
  }
  return [sorted[bestLo]!, sorted[bestLo + count - 1]!];
}
