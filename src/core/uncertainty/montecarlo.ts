// ==========================================================================
// Ergalics Studio — Monte-Carlo error propagation (pure TS, data layer)
//
// Draw inputs from parametric distributions, push them through a scalar
// function `f`, and summarize the output distribution. Seeded (mulberry32) so
// results are reproducible from the manifest.
//
// GPU note: `f` is an arbitrary JS function, so the sampling loop cannot be
// expressed as a WGSL kernel; the CPU path here is the implementation. The
// existing GPU compute pipeline remains available to Code-mode scripts that
// need heavy numeric work around these routines.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

export type DistSpec =
  | { kind: 'normal'; mean: number; sd: number }
  | { kind: 'uniform'; low: number; high: number }
  | { kind: 'lognormal'; logMean: number; logSd: number }
  | { kind: 'triangular'; low: number; mode: number; high: number };

export interface MonteCarloOptions {
  /** Deterministic seed; null → non-reproducible. */
  seed?: number | null;
}

export interface MonteCarloResult {
  /** Output draws of `f` (length n). */
  samples: Float64Array;
  mean: number;
  std: number;
  median: number;
  /** 2.5 / 97.5 percentiles of the output distribution. */
  ci95: [number, number];
  /** Pearson correlation of each input's draws with the output — a cheap,
   *  honest sensitivity ranking ("which input drives the result?"). */
  sensitivity: number[];
  n: number;
}

const N_MIN = 100;
const N_MAX = 1_000_000;

/**
 * Propagate input uncertainty through `f(xs) -> number`.
 *
 * @param dists one spec per input of `f`, in argument order
 */
export function propagateError(
  f: (xs: number[]) => number,
  dists: DistSpec[],
  n: number,
  opts: MonteCarloOptions = {},
): MonteCarloResult {
  if (dists.length === 0) throw new Error('propagateError needs at least one input distribution');
  const draws = Math.floor(n);
  if (!Number.isFinite(draws)) throw new Error('n must be a finite number');
  const count = Math.min(N_MAX, Math.max(N_MIN, draws));

  const rand = opts.seed === null || opts.seed === undefined
    ? Math.random
    : mulberry32(opts.seed);
  const gauss = makeGauss(rand);

  const samples = new Float64Array(count);
  // Per-input draw history kept for the sensitivity correlations. Rows stay
  // aligned with `samples`: non-finite outputs are stored as NaN in-place so
  // the correlation below pairs each input draw with its own output.
  const inputs: Float64Array[] = dists.map(() => new Float64Array(count));
  const xs = new Array<number>(dists.length).fill(0);
  let finiteCount = 0;

  for (let i = 0; i < count; i += 1) {
    for (let d = 0; d < dists.length; d += 1) {
      const v = sampleDist(dists[d]!, rand, gauss);
      xs[d] = v;
      inputs[d]![i] = v;
    }
    const out = f(xs);
    if (Number.isFinite(out)) {
      samples[i] = out;
      finiteCount += 1;
    } else {
      samples[i] = NaN;
    }
  }

  if (finiteCount === 0) {
    throw new Error('propagation produced no finite outputs — check f and the dist specs');
  }

  const { mean, std, median, ci95 } = summaryOf(samples);

  const sensitivity = dists.map((_, d) => pearsonFinite(inputs[d]!, samples));

  return { samples, mean, std, median, ci95, sensitivity, n: count };
}

/** Draw one value from a spec using the provided (seeded) uniform RNG. */
export function sampleDist(spec: DistSpec, rand: () => number, gauss?: () => number): number {
  const normal = gauss ?? makeGauss(rand);
  switch (spec.kind) {
    case 'normal': {
      if (!(spec.sd > 0)) return spec.mean;
      return spec.mean + spec.sd * normal();
    }
    case 'uniform': {
      const lo = Math.min(spec.low, spec.high);
      const hi = Math.max(spec.low, spec.high);
      if (hi === lo) return lo;
      return lo + rand() * (hi - lo);
    }
    case 'lognormal': {
      if (!(spec.logSd > 0)) return Math.exp(spec.logMean);
      return Math.exp(spec.logMean + spec.logSd * normal());
    }
    case 'triangular': {
      const u = rand();
      const { low, mode, high } = spec;
      if (high === low) return low;
      const c = (mode - low) / (high - low);
      // Inverse-CDF sampling of the triangular distribution.
      return u < c
        ? low + Math.sqrt(u * (high - low) * (mode - low))
        : high - Math.sqrt((1 - u) * (high - low) * (high - mode));
    }
  }
}

// Box–Muller with the two uniforms consumed per pair; the second value is
// cached inside the closure so each seeded stream stays reproducible and two
// concurrent propagations can never bleed their cached normals into each other.
function makeGauss(rand: () => number): () => number {
  let cache: number | null = null;
  return function gauss(): number {
    if (cache !== null) {
      const v = cache;
      cache = null;
      return v;
    }
    let u1 = rand();
    // log(0) is -Infinity; nudge away from exactly 0.
    while (u1 <= 0) u1 = rand();
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    cache = r * Math.sin(theta);
    return r * Math.cos(theta);
  };
}

function summaryOf(samples: Float64Array): {
  mean: number;
  std: number;
  median: number;
  ci95: [number, number];
} {
  let finiteCount = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i]!;
    if (Number.isFinite(v)) {
      finiteCount += 1;
      sum += v;
    }
  }
  const finite = new Float64Array(finiteCount);
  let k = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i]!;
    if (Number.isFinite(v)) {
      finite[k] = v;
      k += 1;
    }
  }
  const mean = sum / finiteCount;
  let ss = 0;
  for (let i = 0; i < finiteCount; i += 1) {
    const d = finite[i]! - mean;
    ss += d * d;
  }
  const std = finiteCount > 1 ? Math.sqrt(ss / (finiteCount - 1)) : 0;
  finite.sort();
  const median =
    finiteCount % 2
      ? finite[finiteCount >> 1]!
      : (finite[(finiteCount >> 1) - 1]! + finite[finiteCount >> 1]!) / 2;
  const lo = finite[Math.floor(0.025 * finiteCount)]!;
  const hi = finite[Math.min(finiteCount - 1, Math.floor(0.975 * finiteCount))]!;
  return { mean, std, median, ci95: [lo, hi] };
}

/** Pearson correlation that skips pairs with a non-finite member. */
function pearsonFinite(a: Float64Array, b: Float64Array): number {
  let n = 0;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      sa += x;
      sb += y;
      n += 1;
    }
  }
  if (n < 2) return NaN;
  const ma = sa / n;
  const mb = sb / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      const dx = x - ma;
      const dy = y - mb;
      sab += dx * dy;
      saa += dx * dx;
      sbb += dy * dy;
    }
  }
  const denom = Math.sqrt(saa * sbb);
  return denom === 0 ? NaN : sab / denom;
}
