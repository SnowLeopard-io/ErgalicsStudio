// ==========================================================================
// Ergalics Studio — descriptive statistics
//
// Pure functions over numeric samples. `meanCI` builds a confidence interval
// for the mean from the Student's-t critical value (exact for small samples),
// unlike a z-interval which only becomes valid asymptotically.
// ==========================================================================

import { studentTInv } from './special';

/** Arithmetic mean. Returns NaN for an empty sample. */
export function mean(x: number[]): number {
  if (x.length === 0) return NaN;
  let s = 0;
  for (const v of x) s += v;
  return s / x.length;
}

/** Variance. `sample = true` (default) uses Bessel's correction (n-1). */
export function variance(x: number[], sample = true): number {
  const n = x.length;
  if (n < 2) return NaN;
  const m = mean(x);
  let s = 0;
  for (const v of x) s += (v - m) * (v - m);
  return s / (sample ? n - 1 : n);
}

/** Standard deviation (square root of `variance`). */
export function std(x: number[], sample = true): number {
  const v = variance(x, sample);
  return Number.isNaN(v) ? v : Math.sqrt(v);
}

/** Median (average of the two middle values for even n). */
export function median(x: number[]): number {
  const n = x.length;
  if (n === 0) return NaN;
  const s = [...x].sort((a, b) => a - b);
  const mid = n >> 1;
  return n % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Quantile via linear interpolation between order statistics. `p` in [0,1]. */
export function quantile(x: number[], p: number): number {
  const n = x.length;
  if (n === 0) return NaN;
  if (p <= 0) return [...x].sort((a, b) => a - b)[0]!;
  if (p >= 1) return [...x].sort((a, b) => a - b)[n - 1]!;
  const s = [...x].sort((a, b) => a - b);
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const frac = h - lo;
  return s[lo]! + frac * (s[lo + 1]! - s[lo]!);
}

export interface Summary {
  n: number;
  mean: number;
  median: number;
  std: number;
  min: number;
  max: number;
  q1: number;
  q3: number;
}

/** Five-number-style summary with mean/std. */
export function summary(x: number[]): Summary {
  const n = x.length;
  if (n === 0) {
    return { n: 0, mean: NaN, median: NaN, std: NaN, min: NaN, max: NaN, q1: NaN, q3: NaN };
  }
  const s = [...x].sort((a, b) => a - b);
  return {
    n,
    mean: mean(x),
    median: median(x),
    std: std(x, true),
    min: s[0]!,
    max: s[n - 1]!,
    q1: quantile(x, 0.25),
    q3: quantile(x, 0.75),
  };
}

/**
 * Confidence interval for the population mean under the t-distribution.
 * Returns [lower, upper]. `conf` is the coverage (e.g. 0.95).
 */
export function meanCI(x: number[], conf = 0.95): [number, number] {
  const n = x.length;
  if (n < 2) return [NaN, NaN];
  const m = mean(x);
  const se = std(x, true) / Math.sqrt(n);
  const t = studentTInv(1 - (1 - conf) / 2, n - 1);
  return [m - t * se, m + t * se];
}
