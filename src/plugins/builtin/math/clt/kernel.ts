// ==========================================================================
// stats-clt — central-limit-theorem numerics (pure, dependency-free, testable)
//
// Population samplers with closed-form moments, a sampling experiment that
// accumulates m sample means of size n, moment / normality statistics
// (skewness, raw kurtosis, Jarque-Bera), histogram building, and three
// embedded verification benchmarks against analytic ground truth:
//   (1) uniform population, n=30, m=50000: mean & variance of the sample-mean
//       distribution vs (a+b)/2 and sigma^2/(12n), relative error < 2%;
//   (2) standardized mean distribution: skewness < 0.1, |kurtosis-3| < 0.2;
//   (3) exponential population at n=1: skewness vs exact value 2, < 10%
//       (tolerance relaxed because m is finite).
// Uniform relative-error convention |computed - analytic| / |analytic|.
// All randomness flows through the deterministic mulberry32 PRNG, so every
// result is reproducible for a fixed seed. No DOM anywhere.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

/** Population families the bench can draw from. */
export type PopulationKind = 'uniform' | 'exponential' | 'bernoulli' | 'bimodal' | 'pareto';

/** One population: `param` is the family's shape/extent parameter. */
export interface PopulationSpec {
  kind: PopulationKind;
  param: number;
}

/** Closed-form moments of the (possibly truncated) population. */
export interface PopMoments {
  mean: number;
  variance: number;
  skewness: number;
}

/** Sample statistics of one collection of values. */
export interface SampleStats {
  mean: number;
  variance: number;
  skewness: number;
  kurtosis: number; // raw (normal = 3); excess = kurtosis - 3
}

export interface Histogram {
  centers: number[];
  counts: number[];
  binWidth: number;
  min: number;
  max: number;
}

export interface CltResult {
  spec: PopulationSpec;
  n: number;
  m: number;
  seed: number;
  means: Float64Array;
  theory: PopMoments;
  stats: SampleStats;
  hist: Histogram;
  /** Analytic sd of a single sample mean, sigma / sqrt(n). */
  sdOfMean: number;
  /** Jarque-Bera statistic of the sample-mean distribution (chi^2 with 2 dof). */
  jarqueBera: number;
}

/** Fixed constants for the derived families. */
export const BIMODAL_SIGMA = 0.35;
export const PARETO_XM = 1;
export const PARETO_UPPER = 20;

export const POPULATION_KINDS: PopulationKind[] = ['uniform', 'exponential', 'bernoulli', 'bimodal', 'pareto'];

/** Valid slider range of each family's shape parameter. */
export function paramRange(kind: PopulationKind): { min: number; max: number } {
  switch (kind) {
    case 'uniform':
      return { min: 0.1, max: 5 };
    case 'exponential':
      return { min: 0.2, max: 5 };
    case 'bernoulli':
      return { min: 0.05, max: 0.95 };
    case 'bimodal':
      return { min: 0.1, max: 3 };
    case 'pareto':
      return { min: 1.1, max: 4 };
  }
}

/** Clamp the family parameter into its valid range. */
export function clampParam(kind: PopulationKind, param: number): number {
  const p = Number.isFinite(param) ? param : 1;
  const { min, max } = paramRange(kind);
  return Math.min(max, Math.max(min, p));
}

/** Human-readable name of the family parameter (for the slider label). */
export function paramLabel(kind: PopulationKind, zh: boolean): string {
  switch (kind) {
    case 'uniform':
      return zh ? '区间宽度 w' : 'Interval width w';
    case 'exponential':
      return zh ? '速率 λ' : 'Rate λ';
    case 'bernoulli':
      return zh ? '成功概率 p' : 'Success probability p';
    case 'bimodal':
      return zh ? '双峰分离度 d' : 'Mode separation d';
    case 'pareto':
      return zh ? 'Pareto 形状 α（截断于 20）' : 'Pareto shape α (truncated at 20)';
  }
}

/**
 * Closed-form moments. For the truncated Pareto the k-th raw moment is
 *   E[X^k] = alpha * (T^(k-alpha) - 1) / ((k - alpha) * (1 - T^(-alpha))),
 * with the k = alpha case integrating to alpha * ln(T) / (1 - T^(-alpha)).
 */
export function theoryMoments(spec: PopulationSpec): PopMoments {
  const a = clampParam(spec.kind, spec.param);
  switch (spec.kind) {
    case 'uniform': {
      const mean = a / 2;
      const variance = (a * a) / 12;
      return { mean, variance, skewness: 0 };
    }
    case 'exponential': {
      return { mean: 1 / a, variance: 1 / (a * a), skewness: 2 };
    }
    case 'bernoulli': {
      const variance = a * (1 - a);
      const sd = Math.sqrt(Math.max(variance, 1e-300));
      return { mean: a, variance, skewness: (1 - 2 * a) / sd };
    }
    case 'bimodal': {
      return { mean: 0, variance: a * a + BIMODAL_SIGMA * BIMODAL_SIGMA, skewness: 0 };
    }
    case 'pareto': {
      const t = PARETO_UPPER;
      const c = 1 - Math.pow(t, -a); // normalising constant of the truncated pdf
      const e1 = (a * (Math.pow(t, 1 - a) - 1)) / ((1 - a) * c);
      const e2 =
        Math.abs(a - 2) < 1e-12
          ? (a * Math.log(t)) / c
          : (a * (Math.pow(t, 2 - a) - 1)) / ((2 - a) * c);
      const e3 =
        Math.abs(a - 3) < 1e-12
          ? (a * Math.log(t)) / c
          : (a * (Math.pow(t, 3 - a) - 1)) / ((3 - a) * c);
      const variance = e2 - e1 * e1;
      const cs = Math.pow(Math.max(variance, 1e-300), 1.5);
      const skewness = (e3 - 3 * e1 * e2 + 2 * e1 * e1 * e1) / cs;
      return { mean: e1, variance, skewness };
    }
  }
}

/** Box-Muller standard normal from two fresh uniforms. */
function standardNormal(next: () => number): number {
  const u1 = next();
  const u2 = next();
  return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2);
}

/** Draw one sample from the population (deterministic given the rng). */
export function sampleOne(next: () => number, spec: PopulationSpec): number {
  const a = clampParam(spec.kind, spec.param);
  const u = next();
  switch (spec.kind) {
    case 'uniform':
      return a * u;
    case 'exponential':
      return -Math.log(1 - u) / a;
    case 'bernoulli':
      return u < a ? 1 : 0;
    case 'bimodal': {
      const centre = u < 0.5 ? -a : a;
      return centre + BIMODAL_SIGMA * standardNormal(next);
    }
    case 'pareto': {
      // Inverse CDF of the Pareto(x_m=1, alpha) truncated at T.
      const t = PARETO_UPPER;
      return Math.pow(1 - u * (1 - Math.pow(t, -a)), -1 / a);
    }
  }
}

/** Sample-mean distribution: m repetitions of "draw n samples, average". */
export function sampleMeans(spec: PopulationSpec, n: number, m: number, seed: number): Float64Array {
  const next = mulberry32(seed >>> 0);
  const size = Math.max(1, Math.floor(n));
  const reps = Math.max(1, Math.floor(m));
  const out = new Float64Array(reps);
  for (let r = 0; r < reps; r += 1) {
    let acc = 0;
    for (let i = 0; i < size; i += 1) acc += sampleOne(next, spec);
    out[r] = acc / size;
  }
  return out;
}

/** Mean / (biased) variance / skewness / raw kurtosis of a sample. */
export function sampleStats(xs: ArrayLike<number>): SampleStats {
  const n = xs.length;
  if (n === 0) return { mean: 0, variance: 0, skewness: 0, kurtosis: 3 };
  let s1 = 0;
  for (let i = 0; i < n; i += 1) s1 += xs[i]!;
  const mean = s1 / n;
  let m2 = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i += 1) {
    const d = xs[i]! - mean;
    const d2 = d * d;
    m2 += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  const variance = m2;
  const sd = Math.sqrt(Math.max(m2, 1e-300));
  return {
    mean,
    variance,
    skewness: m3 / Math.pow(sd, 3),
    kurtosis: m4 / (m2 * m2),
  };
}

/** Fixed-bin histogram over the observed range (last bin inclusive). */
export function histogram(xs: ArrayLike<number>, bins: number): Histogram {
  const n = xs.length;
  const b = Math.max(4, Math.floor(bins));
  if (n === 0) return { centers: [], counts: [], binWidth: 1, min: 0, max: 1 };
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i += 1) {
    const v = xs[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!(max > min)) {
    max = min + 1e-9;
  }
  const width = (max - min) / b;
  const counts = new Array<number>(b).fill(0);
  for (let i = 0; i < n; i += 1) {
    const v = xs[i]!;
    let k = Math.floor((v - min) / width);
    if (k >= b) k = b - 1; // right edge inclusive
    if (k < 0) k = 0;
    counts[k] = (counts[k] ?? 0) + 1;
  }
  const centers: number[] = [];
  for (let k = 0; k < b; k += 1) centers.push(min + (k + 0.5) * width);
  return { centers, counts, binWidth: width, min, max };
}

/** Normal pdf with the given standard deviation. */
export function normalPdf(x: number, mu: number, sd: number): number {
  const z = (x - mu) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

/** Standardize to (x - mu) / (sigma / sqrt(n)). */
export function standardized(xs: ArrayLike<number>, mu: number, sigma: number, n: number): Float64Array {
  const sdOfMean = sigma / Math.sqrt(Math.max(1, n));
  const out = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i += 1) out[i] = (xs[i]! - mu) / sdOfMean;
  return out;
}

/** Jarque-Bera normality statistic: m/6 * (S^2 + (K-3)^2/4), ~ chi^2(2). */
export function jarqueBera(stats: SampleStats, count: number): number {
  const k = stats.kurtosis - 3;
  return (count / 6) * (stats.skewness * stats.skewness + (k * k) / 4);
}

/**
 * Run the full experiment: sample-mean distribution + histogram + theory
 * overlay statistics. Deterministic for a fixed seed.
 */
export function runClt(spec: PopulationSpec, n: number, m: number, seed: number): CltResult {
  const size = Math.max(1, Math.floor(n));
  const reps = Math.max(1, Math.floor(m));
  const means = sampleMeans(spec, size, reps, seed);
  const theory = theoryMoments(spec);
  const stats = sampleStats(means);
  const hist = histogram(means, 60);
  return {
    spec: { kind: spec.kind, param: clampParam(spec.kind, spec.param) },
    n: size,
    m: reps,
    seed: seed >>> 0,
    means,
    theory,
    stats,
    hist,
    sdOfMean: Math.sqrt(Math.max(theory.variance, 0)) / Math.sqrt(size),
    jarqueBera: jarqueBera(stats, reps),
  };
}

/** Relative error under the |computed - analytic| / |analytic| convention. */
export function relErr(computed: number, analytic: number): number {
  const a = Math.abs(analytic);
  if (a < 1e-300) return Math.abs(computed);
  return Math.abs(computed - analytic) / a;
}

export interface CltBenchmark {
  /** Scenario 1: uniform U[0,2], n=30, m=50000 — moment recovery errors. */
  uniformRelErrMean: number;
  uniformRelErrVar: number;
  uniformMeanTheory: number;
  uniformMeanSample: number;
  uniformVarTheory: number;
  uniformVarSample: number;
  /** Scenario 2: standardized mean distribution normality (same run). */
  standardizedSkewness: number;
  standardizedKurtosis: number;
  /** Scenario 3: exponential at n=1 — skewness vs exact 2. */
  exponentialSkewness: number;
  exponentialSkewTheory: number;
  exponentialRelErr: number;
  seed: number;
}

/**
 * Embedded validation benchmark (see manifest notesI18n for the exact
 * thresholds): ① relative errors < 2%, ② skew < 0.1 & |kurt-3| < 0.2,
 * ③ skew error < 10%.
 */
export function runCltBenchmark(seed = 20261011): CltBenchmark {
  // Scenario 1 (+ 2): uniform population U[0, 2].
  const uSpec: PopulationSpec = { kind: 'uniform', param: 2 };
  const res = runClt(uSpec, 30, 50000, seed);
  const uniformMeanTheory = res.theory.mean; // (a+b)/2 = 1
  const uniformVarTheory = res.theory.variance / 30; // sigma^2 / (12n) = 1/90
  const uniformRelErrMean = relErr(res.stats.mean, uniformMeanTheory);
  const uniformRelErrVar = relErr(res.stats.variance, uniformVarTheory);

  const std = standardized(res.means, res.theory.mean, Math.sqrt(res.theory.variance), 30);
  const stdStats = sampleStats(std);

  // Scenario 3: exponential population, n = 1 — the mean distribution IS the
  // population, so its skewness must match the exact exponential skewness 2.
  const eSpec: PopulationSpec = { kind: 'exponential', param: 1 };
  const eres = runClt(eSpec, 1, 50000, seed ^ 0x9e3779b9);
  const exponentialSkewTheory = eres.theory.skewness; // exactly 2
  const exponentialRelErr = relErr(eres.stats.skewness, exponentialSkewTheory);

  return {
    uniformRelErrMean,
    uniformRelErrVar,
    uniformMeanTheory,
    uniformMeanSample: res.stats.mean,
    uniformVarTheory,
    uniformVarSample: res.stats.variance,
    standardizedSkewness: stdStats.skewness,
    standardizedKurtosis: stdStats.kurtosis,
    exponentialSkewness: eres.stats.skewness,
    exponentialSkewTheory,
    exponentialRelErr,
    seed: seed >>> 0,
  };
}
