// ==========================================================================
// Ergalics Studio — bootstrap confidence intervals (pure TS, data layer)
//
// Non-parametric bootstrap: resample the observed data with replacement,
// recompute the statistic on each replicate, and read a percentile interval
// off the replicate distribution. Deterministic for a given seed (mulberry32),
// so a CI is always reproducible from the recorded manifest.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

export interface BootstrapOptions {
  /** Number of resamples (clamped to [100, 100_000]). Default 2000. */
  iters?: number;
  /** Significance level; the interval covers 1 - alpha. Default 0.05. */
  alpha?: number;
  /** Deterministic seed; null → non-reproducible (Math.random path). */
  seed?: number | null;
}

export interface BootstrapCIResult {
  /** Statistic on the original sample. */
  estimate: number;
  lower: number;
  upper: number;
  /** Standard error of the bootstrap distribution. */
  se: number;
  iters: number;
  alpha: number;
  /** The replicate statistics (histogram-friendly). */
  replicates: Float64Array;
}

const ITERS_MIN = 100;
const ITERS_MAX = 100_000;

/**
 * Percentile bootstrap CI for an arbitrary statistic.
 *
 * @param x observed sample (non-empty, finite values)
 * @param statistic function computed on each resample (e.g. mean, median)
 */
export function bootstrapCI(
  x: number[],
  statistic: (sample: number[]) => number,
  opts: BootstrapOptions = {},
): BootstrapCIResult {
  if (x.length === 0) throw new Error('bootstrap needs a non-empty sample');

  const rawIters = Math.floor(opts.iters ?? 2000);
  const iters = Number.isFinite(rawIters)
    ? Math.min(ITERS_MAX, Math.max(ITERS_MIN, rawIters))
    : 2000;
  const alpha = clampAlpha(opts.alpha ?? 0.05);
  const n = x.length;
  const estimate = statistic(x);
  if (!Number.isFinite(estimate)) {
    throw new Error('statistic must return a finite number on the original sample');
  }

  const rand = opts.seed === null || opts.seed === undefined
    ? Math.random
    : mulberry32(opts.seed);
  const replicates = new Float64Array(iters);
  // Resample by drawing indices; reuse a scratch index buffer to avoid
  // per-iteration allocation churn at high iteration counts.
  const idx = new Uint32Array(n);
  const scratch = new Array<number>(n);
  for (let b = 0; b < iters; b += 1) {
    for (let i = 0; i < n; i += 1) {
      idx[i] = (rand() * n) | 0;
    }
    for (let i = 0; i < n; i += 1) {
      scratch[i] = x[idx[i]!]!;
    }
    const s = statistic(scratch);
    replicates[b] = Number.isFinite(s) ? s : NaN;
  }

  // Percentile interval over the finite replicates. NaN replicates (possible
  // when a statistic is undefined for a pathological resample, e.g. std of an
  // all-identical draw) are dropped, not silently turned into ±Infinity.
  const finite = Array.from(replicates).filter(Number.isFinite);
  if (finite.length === 0) {
    throw new Error('bootstrap produced no finite replicates');
  }
  finite.sort((a, b) => a - b);
  const lo = finite[Math.floor((alpha / 2) * finite.length)]!;
  const hi = finite[Math.min(finite.length - 1, Math.floor((1 - alpha / 2) * finite.length))]!;
  const mu = finite.reduce((s, v) => s + v, 0) / finite.length;
  const se = Math.sqrt(finite.reduce((s, v) => s + (v - mu) * (v - mu), 0) / finite.length);

  return { estimate, lower: lo, upper: hi, se, iters, alpha, replicates };
}

function clampAlpha(alpha: number): number {
  if (!Number.isFinite(alpha)) return 0.05;
  return Math.min(0.49, Math.max(0.001, alpha));
}
