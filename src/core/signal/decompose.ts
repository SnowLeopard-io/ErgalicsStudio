// ==========================================================================
// Ergalics Studio — classical additive time-series decomposition (pure TS)
//
//   x = trend + seasonal + residual
//
// Trend: symmetric (or endpoint-shrunk) moving average of length `period`
// (period+1 centred MA when the period is even, as in X-11). Seasonal:
// average of detrended values at each phase, normalised to sum zero. The
// residual summary reports mean/sd plus a Jarque–Bera-style skew/kurtosis
// normality check, reusing the stats kernel's distribution shape.
// ==========================================================================

import { acf } from './correlation';

export interface DecompositionResult {
  trend: Float64Array;
  seasonal: Float64Array;
  residual: Float64Array;
  /** Per-phase seasonal component (length = period, sums to 0). */
  seasonalPattern: Float64Array;
  period: number;
  residualSummary: {
    mean: number;
    sd: number;
    skew: number;
    excessKurtosis: number;
    /** Jarque–Bera statistic (≈ χ²₂ under Gaussian residuals). */
    jb: number;
  };
}

/**
 * Period-length centred moving average, symmetric around every index.
 *
 * - odd m:  uniform weights 1/m on offsets −(m−1)/2 … +(m−1)/2
 * - even m: trapezoidal 2×m filter — weights (1,2,…,2,1)/(2m) on offsets
 *           −m/2 … +m/2 (the classic X-11 centring of two successive m-MAs)
 *
 * At the edges the window shrinks symmetrically, dropping the unmatched
 * half-weight endpoint pair first — the result is then exactly unbiased on
 * linear data (symmetric weights reproduce the centre value of a line).
 */
function centeredTrend(x: ArrayLike<number>, period: number): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    let wsum = 0;
    let vsum = 0;
    const maxHalf = Math.floor(period / 2);
    for (let h = 0; h <= maxHalf; h += 1) {
      const lo = i - h;
      const hi = i + h;
      if (lo < 0 || hi >= n) break;
      const isEndpoint = period % 2 === 0 && h === maxHalf;
      // Odd m: uniform window (centre 1, each pair member 1 → total m).
      // Even m: trapezoid (centre 2, inner pair members 2, endpoints 1).
      const w = period % 2 === 0 ? (h === 0 ? 2 : isEndpoint ? 1 : 2) : 1;
      if (h === 0) {
        vsum += w * x[i]!;
      } else {
        vsum += w * x[lo]!;
        vsum += w * x[hi]!;
      }
      wsum += h === 0 ? w : 2 * w;
    }
    out[i] = vsum / wsum;
  }
  return out;
}

/**
 * Classical additive decomposition with a known seasonal period m.
 * Requires at least two full periods for a stable seasonal estimate.
 */
export function decomposeAdditive(x: ArrayLike<number>, period: number): DecompositionResult {
  const n = x.length;
  if (!Number.isInteger(period) || period < 2) {
    throw new Error('decompose: period must be an integer ≥ 2');
  }
  if (n < 2 * period) {
    throw new Error('decompose: need at least two full periods');
  }

  // Pass 1: rough trend → seasonal phase means (centred to sum zero).
  // Seasonal phases are estimated only over interior indices whose trend
  // window is complete: boundary trend estimates are window-shrunk and would
  // otherwise bias the phase means (and every later pass inherits the bias).
  const trend1 = centeredTrend(x, period);
  const edge = Math.floor(period / 2);
  const phaseMeans = (trend: Float64Array): Float64Array => {
    const sums = new Float64Array(period);
    const counts = new Float64Array(period);
    for (let i = edge; i < n - edge; i += 1) {
      const p = i % period;
      sums[p]! += x[i]! - trend[i]!;
      counts[p]! += 1;
    }
    const pattern = new Float64Array(period);
    let m = 0;
    for (let p = 0; p < period; p += 1) {
      pattern[p] = counts[p]! > 0 ? sums[p]! / counts[p]! : 0;
      m += pattern[p]!;
    }
    m /= period;
    for (let p = 0; p < period; p += 1) pattern[p] = pattern[p]! - m;
    return pattern;
  };
  const pattern = phaseMeans(trend1);

  // Pass 2: deseasonalise, re-estimate the trend (free of seasonal bleed),
  // and recompute the seasonal pattern once for stability.
  const deseason = new Float64Array(n);
  for (let i = 0; i < n; i += 1) deseason[i] = x[i]! - pattern[i % period]!;
  const trend = centeredTrend(deseason, period);
  const pattern2 = phaseMeans(trend);

  const seasonal = new Float64Array(n);
  const residual = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    seasonal[i] = pattern2[i % period]!;
    residual[i] = x[i]! - trend[i]! - seasonal[i]!;
  }

  // Residual distribution shape (Jarque–Bera).
  let m = 0;
  for (let i = 0; i < n; i += 1) m += residual[i]!;
  m /= n;
  let v = 0;
  let m3 = 0;
  let m4 = 0;
  for (let i = 0; i < n; i += 1) {
    const d = residual[i]! - m;
    const d2 = d * d;
    v += d2;
    m3 += d2 * d;
    m4 += d2 * d2;
  }
  v /= n;
  const sd = Math.sqrt(v);
  // On a near-exact decomposition the residual variance is machine noise;
  // skew/kurtosis are ratios of that noise and meaningless, so report zeros.
  const degenerate = sd < 1e-12;
  const skew = !degenerate && sd > 0 ? m3 / (n * sd ** 3) : 0;
  const kurt = !degenerate && sd > 0 ? m4 / (n * sd ** 4) - 3 : 0;
  const jb = degenerate ? 0 : (n / 6) * (skew * skew + (kurt * kurt) / 4);

  return {
    trend,
    seasonal,
    residual,
    seasonalPattern: pattern2,
    period,
    residualSummary: { mean: m, sd, skew, excessKurtosis: kurt, jb },
  };
}

/**
 * Detect a candidate seasonal period. A light 3-point trend is removed first
 * so smooth trends cannot masquerade as seasonality, then the ACF is scanned
 * over lags 2…maxPeriod: the strongest significant autocorrelation is the
 * period (multiples never beat the base period because the base lag sits
 * closer and reaches the same correlation first).
 */
export function suggestPeriod(x: ArrayLike<number>, maxPeriod = 50): number | null {
  const n = x.length;
  const limit = Math.min(maxPeriod, Math.floor(n / 4));
  if (limit < 2) return null;
  const detrended = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    let s = 0;
    for (let j = lo; j <= hi; j += 1) s += x[j]!;
    detrended[i] = x[i]! - s / (hi - lo + 1);
  }
  const a = acf(detrended, limit);
  let best: number | null = null;
  let bestV = 0.5; // require clearly significant periodicity
  for (let lag = 2; lag <= limit; lag += 1) {
    if (a[lag]! > bestV) {
      bestV = a[lag]!;
      best = lag;
    }
  }
  return best;
}
