// ==========================================================================
// Ergalics Studio — signal window functions (pure TS, data layer)
//
// Symmetric analysis windows applied before spectral estimation. Every
// window is returned as a full-length coefficient array; callers normalise
// for window energy themselves (the PSD routine in fft.ts does this).
// ==========================================================================

export type WindowKind = 'rectangular' | 'hann' | 'hamming' | 'blackman';

export const WINDOW_KINDS: WindowKind[] = ['rectangular', 'hann', 'hamming', 'blackman'];

/**
 * Build a symmetric analysis window of length `n`.
 *
 * - rectangular: no taper (coherent integration)
 * - hann:       0.5 − 0.5 cos(2πk/(n−1))
 * - hamming:    0.54 − 0.46 cos(…), tuned sidelobe cancellation
 * - blackman:   three-term cosine, lowest leakage / widest main lobe
 */
export function makeWindow(n: number, kind: WindowKind = 'hann'): Float64Array {
  if (!Number.isInteger(n) || n <= 0) throw new Error('window length must be a positive integer');
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  const denom = n - 1;
  for (let k = 0; k < n; k += 1) {
    const x = (2 * Math.PI * k) / denom;
    switch (kind) {
      case 'rectangular':
        w[k] = 1;
        break;
      case 'hann':
        w[k] = 0.5 - 0.5 * Math.cos(x);
        break;
      case 'hamming':
        w[k] = 0.54 - 0.46 * Math.cos(x);
        break;
      case 'blackman':
        w[k] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
        break;
    }
  }
  return w;
}

/** Apply a window of `kind` to a segment, returning a new array. */
export function applyWindow(x: ArrayLike<number>, kind: WindowKind = 'hann'): Float64Array {
  const w = makeWindow(x.length, kind);
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i += 1) out[i] = x[i]! * w[i]!;
  return out;
}

/** Coherent gain (mean coefficient); useful for amplitude correction. */
export function windowCoherentGain(w: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < w.length; i += 1) s += w[i]!;
  return s / w.length;
}

/**
 * Noise-equivalent power: Σw² / (Σw)². Multiply a Hann-based variance
 * estimate by ~1.5 to correct for the energy the window threw away.
 */
export function windowPowerFactor(w: ArrayLike<number>): number {
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < w.length; i += 1) {
    sum += w[i]!;
    sq += w[i]! * w[i]!;
  }
  return sq / (sum * sum);
}
