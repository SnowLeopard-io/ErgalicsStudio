// ==========================================================================
// Ergalics Studio — spectral peak analysis (pure, no DOM)
//
// A DFT peak lands on a bin, but the true resonance usually sits between
// bins. Parabolic interpolation on the log magnitudes recovers the centre to
// a fraction of a bin; the bin spacing is kept as the hard resolution floor,
// and the half-power width yields the damping ratio ζ ≈ Δf / (2 f₀) for a
// lightly damped mode.
// ==========================================================================

export interface PeakEstimate {
  /** Interpolated peak centre, Hz. */
  frequency: number;
  /** Interpolated peak height (same units as the input series). */
  height: number;
  /** Bin spacing fs / nfft, Hz — the hard frequency-resolution floor. */
  resolution: number;
  /** Conservative ± bound on the centre: half a bin. */
  uncertainty: number;
  /** −3 dB full width (Hz), or null when a side never crosses half power. */
  bandwidth: number | null;
  /** ζ ≈ bandwidth / (2 f), or null without a bandwidth. */
  damping: number | null;
}

export interface PeakOptions {
  /**
   * `amplitude` treats the series as |X(f)| (−3 dB at peak/√2);
   * `power` treats it as a PSD (−3 dB at peak/2). Default amplitude.
   */
  halfPower?: 'amplitude' | 'power';
  /** Ignore the DC bin (default true). */
  skipDC?: boolean;
}

const EPS = 1e-300;

/**
 * Locate the dominant spectral peak. Returns null when the series is too
 * short or the maximum touches an edge (interpolation and one-sided
 * bandwidths would both be meaningless).
 */
export function analysePeak(
  freqs: ArrayLike<number>,
  values: ArrayLike<number>,
  opts: PeakOptions = {},
): PeakEstimate | null {
  const n = Math.min(freqs.length, values.length);
  if (n < 4) return null;
  const from = opts.skipDC === false ? 0 : 1;

  let k = -1;
  let best = -Infinity;
  for (let i = from; i < n; i += 1) {
    if (values[i]! > best) {
      best = values[i]!;
      k = i;
    }
  }
  if (k <= 0 || k >= n - 1 || !(best > 0)) return null;

  const yPrev = Math.log(Math.max(values[k - 1]!, EPS));
  const yPeak = Math.log(Math.max(values[k]!, EPS));
  const yNext = Math.log(Math.max(values[k + 1]!, EPS));
  // Curvature of the log-parabola; a flat top carries no sub-bin information.
  const denom = yPrev - 2 * yPeak + yNext;
  let delta = Math.abs(denom) > 1e-12 ? (0.5 * (yPrev - yNext)) / denom : 0;
  // A fitted vertex outside the centre bin is not a sub-bin answer; a flat
  // top (zero curvature) and a DC spike next to a flat floor both land here.
  if (!Number.isFinite(delta) || Math.abs(delta) >= 0.5) delta = 0;

  const df = freqs[1]! - freqs[0]!;
  const frequency = freqs[k]! + delta * df;
  const height = Math.exp(yPeak + 0.5 * (yNext - yPrev) * delta + 0.5 * denom * delta * delta);

  const target = opts.halfPower === 'power' ? height / 2 : height / Math.SQRT2;
  const bandwidth = halfPowerWidth(freqs, values, k, target, n);
  const damping = bandwidth !== null && frequency > 0 ? bandwidth / (2 * frequency) : null;

  return {
    frequency,
    height,
    resolution: Math.abs(df),
    uncertainty: Math.abs(df) / 2,
    bandwidth,
    damping,
  };
}

/** -3 dB full width by linear interpolation between the samples around each
 *  crossing. Requires a crossing on BOTH sides of the peak. */
function halfPowerWidth(
  freqs: ArrayLike<number>,
  values: ArrayLike<number>,
  peak: number,
  target: number,
  n: number,
): number | null {
  let left: number | null = null;
  for (let i = peak; i > 0; i -= 1) {
    if (values[i]! >= target && values[i - 1]! < target) {
      const span = values[i]! - values[i - 1]!;
      const frac = span > 0 ? (values[i]! - target) / span : 0;
      left = freqs[i]! - frac * (freqs[i]! - freqs[i - 1]!);
      break;
    }
  }
  let right: number | null = null;
  for (let i = peak; i < n - 1; i += 1) {
    if (values[i]! >= target && values[i + 1]! < target) {
      const span = values[i]! - values[i + 1]!;
      const frac = span > 0 ? (values[i]! - target) / span : 0;
      right = freqs[i]! + frac * (freqs[i + 1]! - freqs[i]!);
      break;
    }
  }
  if (left === null || right === null || right <= left) return null;
  return right - left;
}
