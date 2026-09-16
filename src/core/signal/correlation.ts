// ==========================================================================
// Ergalics Studio — autocorrelation / partial autocorrelation (pure TS)
//
// ACF uses the direct autocovariance estimator with the common "denominator
// c0" convention (so acf(0) = 1 exactly). PACF uses the Durbin–Levinson
// recursion — O(L²) but numerically stable, and it reuses the same ACF
// autocovariance sequence instead of fitting a regression at every lag.
// ==========================================================================

/**
 * Sample autocorrelation function for lags 0 … maxLag.
 * `maxLag` defaults to min(10 log10(n), n−1); spec clamps it to n/4.
 */
export function acf(x: ArrayLike<number>, maxLag?: number): Float64Array {
  const n = x.length;
  if (n < 2) throw new Error('acf: need at least 2 samples');
  let m = 0;
  for (let i = 0; i < n; i += 1) m += x[i]!;
  m /= n;
  const d = new Float64Array(n);
  let c0 = 0;
  for (let i = 0; i < n; i += 1) {
    d[i] = x[i]! - m;
    c0 += d[i]! * d[i]!;
  }
  if (c0 === 0) {
    // Constant series: correlation undefined beyond lag 0; report 0.
    const flat = new Float64Array(Math.min(maxLag ?? 1, n - 1) + 1);
    flat[0] = 1;
    return flat;
  }
  const L = Math.max(0, Math.min(maxLag ?? Math.floor(n / 4), n - 1));
  const out = new Float64Array(L + 1);
  out[0] = 1;
  for (let lag = 1; lag <= L; lag += 1) {
    let s = 0;
    for (let i = lag; i < n; i += 1) s += d[i]! * d[i - lag]!;
    out[lag] = s / c0;
  }
  return out;
}

/**
 * Partial autocorrelation via the Durbin–Levinson recursion, returning
 * φ_{k,k} for lags 0 … maxLag (φ_{0,0} = 1 by convention).
 */
export function pacf(x: ArrayLike<number>, maxLag?: number): Float64Array {
  const n = x.length;
  if (n < 3) throw new Error('pacf: need at least 3 samples');
  let m = 0;
  for (let i = 0; i < n; i += 1) m += x[i]!;
  m /= n;
  const d = new Float64Array(n);
  let c0 = 0;
  for (let i = 0; i < n; i += 1) {
    d[i] = x[i]! - m;
    c0 += d[i]! * d[i]!;
  }
  const L = Math.max(1, Math.min(maxLag ?? Math.floor(n / 4), n - 2));
  const gamma = new Float64Array(L + 1); // autocovariance γ(k)
  for (let lag = 0; lag <= L; lag += 1) {
    let s = 0;
    for (let i = lag; i < n; i += 1) s += d[i]! * d[i - lag]!;
    gamma[lag] = s / n;
  }
  const g0 = gamma[0] || 1;
  const r = gamma.map((g) => g / g0); // autocorrelations

  const out = new Float64Array(L + 1);
  out[0] = 1;
  // Durbin–Levinson: φ_{k,k} = (r[k] − Σ_{j=1}^{k−1} φ_{k−1,j} r[k−j]) /
  //                          (1 − Σ_{j=1}^{k−1} φ_{k−1,j} r[j])
  let phi = new Float64Array(L + 1);
  for (let k = 1; k <= L; k += 1) {
    let num = r[k]!;
    let den = 1;
    for (let j = 1; j < k; j += 1) {
      num -= phi[j]! * r[k - j]!;
      den -= phi[j]! * r[j]!;
    }
    const phikk = den === 0 ? 0 : num / den;
    const next = new Float64Array(L + 1);
    for (let j = 1; j < k; j += 1) {
      next[j] = phi[j]! - phikk * phi[k - j]!;
    }
    next[k] = phikk;
    phi = next;
    out[k] = phikk;
  }
  return out;
}

/** 95% white-noise confidence bands for ACF/PACF stems (±1.96/√n). */
export function whiteNoiseBand(n: number): number {
  return 1.96 / Math.sqrt(Math.max(1, n));
}
