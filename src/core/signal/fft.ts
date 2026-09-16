// ==========================================================================
// Ergalics Studio — FFT / power spectral density (pure TS, data layer)
//
// Iterative radix-2 Cooley–Tukey on packed complex Float64Arrays
// ([re0, im0, re1, im1, …]). All arithmetic is Float64; non-power-of-two
// inputs are zero-padded to the next 2^k by the high-level helpers (the
// primitive `fft` requires 2^n length and throws otherwise — padding policy
// belongs to the caller). Welch's method provides a one-sided PSD with
// 50%-overlap segment averaging.
// ==========================================================================

import { makeWindow, type WindowKind } from './window';

/** Next power of two ≥ n. */
export function nextPow2(n: number): number {
  if (n <= 1) return 1;
  return 2 ** Math.ceil(Math.log2(n));
}

/**
 * In-place iterative radix-2 DIT FFT on a packed complex array.
 * Length 2n must be a power of two. `inverse` performs the IFFT (1/n scale).
 */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n !== im.length) throw new Error('fft: real/imaginary arrays must match in length');
  if ((n & (n - 1)) !== 0) throw new Error('fft: length must be a power of two');

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      const ti = im[i]!;
      re[i] = re[j]!;
      im[i] = im[j]!;
      re[j] = tr;
      im[j] = ti;
    }
  }

  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const ang = (sign * 2 * Math.PI) / len;
    const wlr = Math.cos(ang);
    const wli = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let k = 0; k < half; k += 1) {
        const a = i + k;
        const b = i + k + half;
        const tr = wr * re[b]! - wi * im[b]!;
        const ti = wr * im[b]! + wi * re[b]!;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const nwr = wr * wlr - wi * wli;
        wi = wr * wli + wi * wlr;
        wr = nwr;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      re[i] = re[i]! / n;
      im[i] = im[i]! / n;
    }
  }
}

export interface SpectrumResult {
  /** Bin frequencies (length n/2 + 1). */
  freqs: Float64Array;
  /** One-sided magnitude spectrum (amplitude-corrected for real signals). */
  magnitude: Float64Array;
  /** One-sided power spectral density |X|²/n². */
  power: Float64Array;
  /** FFT length actually used after zero padding. */
  nfft: number;
  /** True when zero padding was applied. */
  padded: boolean;
}

/**
 * One-sided amplitude/power spectrum of a real sequence. The input is
 * zero-padded to the next power of two unless `nfft` is given.
 */
export function spectrum(
  x: ArrayLike<number>,
  sampleRate = 1,
  window: WindowKind = 'hann',
  nfft?: number,
): SpectrumResult {
  const target = nfft ?? nextPow2(x.length);
  if ((target & (target - 1)) !== 0) throw new Error('nfft must be a power of two');
  const re = new Float64Array(target);
  const im = new Float64Array(target);
  const w = makeWindow(x.length, window);
  for (let i = 0; i < x.length; i += 1) re[i] = x[i]! * w[i]!;
  fft(re, im);

  const half = target / 2 + 1;
  const freqs = new Float64Array(half);
  const magnitude = new Float64Array(half);
  const power = new Float64Array(half);
  // Coherent gain corrects the amplitude lost to the window taper.
  let gain = 0;
  for (let i = 0; i < w.length; i += 1) gain += w[i]!;
  gain /= w.length || 1;
  const ampScale = gain > 0 ? 1 / gain : 1;

  for (let k = 0; k < half; k += 1) {
    freqs[k] = (k * sampleRate) / target;
    let mag = Math.hypot(re[k]!, im[k]!);
    // Fold negative frequencies for interior bins (real one-sided spectrum).
    if (k !== 0 && k !== target / 2) mag *= 2;
    magnitude[k] = (mag / x.length) * ampScale;
    power[k] = mag * mag / (x.length * x.length);
  }
  return { freqs, magnitude, power, nfft: target, padded: target !== x.length };
}

export interface WelchResult {
  freqs: Float64Array;
  /** PSD values in units of x²/Hz. */
  psd: Float64Array;
  nfft: number;
  segments: number;
}

/**
 * Welch's averaged periodogram: `segLen` windowed segments with 50% overlap,
 * each periodogram normalised by sampleRate × Σw², then averaged. Pure
 * Float64 and allocation-light per segment (buffers are reused).
 */
export function welch(
  x: ArrayLike<number>,
  sampleRate = 1,
  segLen = 256,
  window: WindowKind = 'hann',
): WelchResult {
  const nfft = nextPow2(segLen);
  const n = x.length;
  if (n < 4) throw new Error('welch: need at least 4 samples');
  const len = Math.min(segLen, n);
  const hop = Math.max(1, Math.floor(len / 2));
  const w = makeWindow(len, window);
  let w2 = 0;
  for (let i = 0; i < len; i += 1) w2 += w[i]! * w[i]!;
  const scale = sampleRate * w2;

  const half = nfft / 2 + 1;
  const acc = new Float64Array(half);
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  let segments = 0;
  for (let start = 0; start + len <= n; start += hop) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < len; i += 1) re[i] = x[start + i]! * w[i]!;
    fft(re, im);
    for (let k = 0; k < half; k += 1) {
      acc[k] = acc[k]! + (re[k]! * re[k]! + im[k]! * im[k]!) / scale;
    }
    segments += 1;
  }
  // A series shorter than one segment still gets a single (truncated) one.
  if (segments === 0) {
    for (let i = 0; i < n; i += 1) re[i] = x[i]! * (w[i] ?? 1);
    fft(re, im);
    for (let k = 0; k < half; k += 1) {
      acc[k] = (re[k]! * re[k]! + im[k]! * im[k]!) / (sampleRate * n);
    }
    segments = 1;
  }
  const psd = new Float64Array(half);
  const freqs = new Float64Array(half);
  for (let k = 0; k < half; k += 1) {
    psd[k] = acc[k]! / segments;
    freqs[k] = (k * sampleRate) / nfft;
  }
  return { freqs, psd, nfft, segments };
}

/** Index of the bin with peak one-sided magnitude — dominant frequency. */
export function peakFrequency(r: SpectrumResult, minBin = 1): number {
  let best = minBin;
  let bestV = -1;
  for (let k = minBin; k < r.magnitude.length; k += 1) {
    if (r.magnitude[k]! > bestV) {
      bestV = r.magnitude[k]!;
      best = k;
    }
  }
  return r.freqs[best]!;
}
