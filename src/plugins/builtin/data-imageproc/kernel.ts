// ==========================================================================
// data-imageproc — image-processing numerics (pure, testable)
//
// Self-implemented kernel: radix-2 Cooley–Tukey 2-D FFT (rows then columns,
// sizes zero/edge-padded to powers of two), direct and FFT-based linear
// convolution (separable kernels optimised), histogram equalisation (CDF
// mapping), Gaussian blur / unsharp sharpen / Sobel edges, and PSNR/MSE.
//
// Embedded validation benchmarks (unified absolute/relative-error checks):
//   ① 2-D FFT vs naive DFT on a seeded 32×32 real matrix (< 1e-9);
//   ② convolution theorem: spatial convolution == spectral product → inverse
//      (< 1e-6);
//   ③ equalisation flattens the grey-level histogram (bin-frequency variance
//      strictly decreases);
//   ④ PSNR ⇔ MSE analytic identity PSNR = 10·log10(MAX²/MSE) (exact).
// All functions are pure: no DOM / canvas dependency.
// ==========================================================================

import { mulberry32 } from '@/core/repro/random';

/** 8-bit grayscale image, values nominally in [0, 255]. */
export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

// ---- deterministic test image -------------------------------------------------

/**
 * Built-in program-generated test image: diagonal intensity gradient + a
 * bright disc + vertical stripes + seeded gaussian noise. Deterministic for
 * a fixed seed, so all processing results are reproducible.
 */
export function makeTestImage(width = 256, height = 256, seed = 20261011): GrayImage {
  const rand = mulberry32(seed);
  const nextNormal = (): number => {
    let u = 0;
    do {
      u = rand();
    } while (u <= 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const data = new Float32Array(width * height);
  const cx = width * 0.3;
  const cy = height * 0.58;
  const r = Math.min(width, height) * 0.22;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let v = 28 + (0.34 * x) / 1 + (0.26 * y) / 1;
      const d = Math.hypot(x - cx, y - cy);
      if (d < r) v += 88 * (1 - (d / r) ** 2);
      if (Math.sin((2 * Math.PI * x) / 14) > 0.25) v += 26;
      data[y * width + x] = Math.min(255, Math.max(0, v + 9 * nextNormal()));
    }
  }
  return { width, height, data };
}

// ---- 1-D / 2-D FFT -------------------------------------------------------------

/** Smallest power of two ≥ n. */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * In-place iterative radix-2 Cooley–Tukey FFT of one complex sequence whose
 * length must be a power of two. `inverse` applies the conjugate transform
 * and divides by n.
 */
export function fft1d(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  if (n <= 1) return;
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]!;
      re[i] = re[j]!;
      re[j] = tr;
      const ti = im[i]!;
      im[i] = im[j]!;
      im[j] = ti;
    }
  }
  // Butterfly passes.
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    const half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k += 1) {
        const ar = re[i + k]!;
        const ai = im[i + k]!;
        const br = re[i + k + half]! * cr - im[i + k + half]! * ci;
        const bi = re[i + k + half]! * ci + im[i + k + half]! * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + half] = ar - br;
        im[i + k + half] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      re[i]! /= n;
      im[i]! /= n;
    }
  }
}

/** In-place 2-D FFT (rows then columns); width and height must be powers of two. */
export function fft2d(re: Float64Array, im: Float64Array, width: number, height: number, inverse = false): void {
  const rowRe = new Float64Array(width);
  const rowIm = new Float64Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rowRe[x] = re[y * width + x]!;
      rowIm[x] = im[y * width + x]!;
    }
    fft1d(rowRe, rowIm, inverse);
    for (let x = 0; x < width; x += 1) {
      re[y * width + x] = rowRe[x]!;
      im[y * width + x] = rowIm[x]!;
    }
  }
  const colRe = new Float64Array(height);
  const colIm = new Float64Array(height);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      colRe[y] = re[y * width + x]!;
      colIm[y] = im[y * width + x]!;
    }
    fft1d(colRe, colIm, inverse);
    for (let y = 0; y < height; y += 1) {
      re[y * width + x] = colRe[y]!;
      im[y * width + x] = colIm[y]!;
    }
  }
}

/** Naive O(N⁴) reference DFT used only to validate the FFT (small sizes). */
export function naiveDft2d(
  re: Float64Array,
  im: Float64Array,
  width: number,
  height: number,
  inverse = false,
): { re: Float64Array; im: Float64Array } {
  const outRe = new Float64Array(width * height);
  const outIm = new Float64Array(width * height);
  const sign = inverse ? 2 : -2;
  const norm = inverse ? 1 / (width * height) : 1;
  for (let v = 0; v < height; v += 1) {
    for (let u = 0; u < width; u += 1) {
      let sr = 0;
      let si = 0;
      for (let y = 0; y < height; y += 1) {
        const ay = (sign * Math.PI * v * y) / height;
        const cy = Math.cos(ay);
        const sy = Math.sin(ay);
        for (let x = 0; x < width; x += 1) {
          const ax = (sign * Math.PI * u * x) / width;
          const c = cy * Math.cos(ax) - sy * Math.sin(ax);
          const s = cy * Math.sin(ax) + sy * Math.cos(ax);
          const idx = y * width + x;
          sr += re[idx]! * c - im[idx]! * s;
          si += re[idx]! * s + im[idx]! * c;
        }
      }
      const o = v * width + u;
      outRe[o] = sr * norm;
      outIm[o] = si * norm;
    }
  }
  return { re: outRe, im: outIm };
}

/**
 * Pad a grayscale image to power-of-two dimensions. Padding uses **edge
 * (replicate) extension** rather than zeros so that borders do not create
 * artificial high-frequency steps in the FFT; the imaginary part starts at 0.
 */
export function padToPow2(
  img: GrayImage,
): { re: Float64Array; im: Float64Array; width: number; height: number } {
  const width = nextPow2(img.width);
  const height = nextPow2(img.height);
  const re = new Float64Array(width * height);
  const im = new Float64Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(y, img.height - 1);
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(x, img.width - 1);
      re[y * width + x] = img.data[sy * img.width + sx]!;
    }
  }
  return { re, im, width, height };
}

// ---- convolution ----------------------------------------------------------------

export interface ConvOptions {
  /** Border handling: replicate the nearest pixel (default) or treat outside as zero. */
  edge?: 'clamp' | 'zero';
  /** True convolution flips the kernel; false gives cross-correlation (image-processing convention). */
  flip?: boolean;
}

/** Direct 2-D convolution / correlation with the given edge mode. */
export function convolve2d(img: GrayImage, kernel: Float32Array | number[], kw: number, kh: number, opts?: ConvOptions): GrayImage {
  const edge = opts?.edge ?? 'clamp';
  const flip = opts?.flip ?? false;
  const out = new Float32Array(img.width * img.height);
  const cx = (kw - 1) >> 1;
  const cy = (kh - 1) >> 1;
  const sample = (x: number, y: number): number => {
    // In 'clamp' mode coordinates are clamped by the caller, so out-of-range
    // samples only occur in 'zero' mode where the outside contributes 0.
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
    return img.data[y * img.width + x]!;
  };
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      let acc = 0;
      for (let j = 0; j < kh; j += 1) {
        const ky = flip ? kh - 1 - j : j;
        for (let i = 0; i < kw; i += 1) {
          const kx = flip ? kw - 1 - i : i;
          let sx = x + i - cx;
          let sy = y + j - cy;
          if (edge === 'clamp') {
            sx = Math.min(img.width - 1, Math.max(0, sx));
            sy = Math.min(img.height - 1, Math.max(0, sy));
          }
          acc += sample(sx, sy) * kernel[ky * kw + kx]!;
        }
      }
      out[y * img.width + x] = acc;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

/**
 * Separable convolution: apply the 1-D column kernel then the 1-D row kernel
 * (both in the flip=false correlation sense). Equivalent to the outer-product
 * 2-D kernel but O(k) instead of O(k²) per pixel.
 */
export function convolveSeparable(
  img: GrayImage,
  rowKernel: Float32Array | number[],
  colKernel: Float32Array | number[],
  opts?: ConvOptions,
): GrayImage {
  const edge = opts?.edge ?? 'clamp';
  const w = img.width;
  const h = img.height;
  const kr = rowKernel;
  const kc = colKernel;
  const cr = (kr.length - 1) >> 1;
  const cc = (kc.length - 1) >> 1;
  const mid = new Float32Array(w * h);
  // Vertical pass.
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let j = 0; j < kc.length; j += 1) {
        let sy = y + j - cc;
        if (edge === 'clamp') sy = Math.min(h - 1, Math.max(0, sy));
        else if (sy < 0 || sy >= h) continue;
        acc += img.data[sy * w + x]! * kc[j]!;
      }
      mid[y * w + x] = acc;
    }
  }
  // Horizontal pass.
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let i = 0; i < kr.length; i += 1) {
        let sx = x + i - cr;
        if (edge === 'clamp') sx = Math.min(w - 1, Math.max(0, sx));
        else if (sx < 0 || sx >= w) continue;
        acc += mid[y * w + sx]! * kr[i]!;
      }
      out[y * w + x] = acc;
    }
  }
  return { width: w, height: h, data: out };
}

/** Normalised 1-D Gaussian kernel (odd length ≈ 6σ). */
export function gaussianKernel1d(sigma: number): Float64Array {
  const s = Math.max(0.3, sigma);
  const size = Math.max(3, Math.ceil(6 * s) | 1);
  const c = (size - 1) / 2;
  const k = new Float64Array(size);
  let sum = 0;
  for (let i = 0; i < size; i += 1) {
    const d = (i - c) / s;
    k[i] = Math.exp(-0.5 * d * d);
    sum += k[i]!;
  }
  for (let i = 0; i < size; i += 1) k[i] /= sum;
  return k;
}

/** 2-D Gaussian kernel as the outer product of two 1-D kernels. */
export function gaussianKernel2d(sigma: number): { kernel: Float64Array; size: number } {
  const k1 = gaussianKernel1d(sigma);
  const size = k1.length;
  const k = new Float64Array(size * size);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) k[y * size + x] = k1[y]! * k1[x]!;
  return { kernel: k, size };
}

/** Gaussian blur via the separable path (edge-clamped). */
export function gaussianBlur(img: GrayImage, sigma: number): GrayImage {
  const k = gaussianKernel1d(sigma);
  return convolveSeparable(img, k, k);
}

/** Unsharp-mask sharpening: out = (1+s)·I − s·G_σ(I), clamped to [0, 255]. */
export function sharpen(img: GrayImage, strength: number): GrayImage {
  const blur = gaussianBlur(img, Math.max(0.5, strength * 0.6));
  const s = strength;
  const out = new Float32Array(img.data.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.min(255, Math.max(0, (1 + s) * img.data[i]! - s * blur.data[i]!));
  }
  return { width: img.width, height: img.height, data: out };
}

/** Sobel gradient magnitude (correlation kernels), scaled and clamped to [0, 255]. */
export function sobelMagnitude(img: GrayImage): GrayImage {
  const gx = convolve2d(img, [-1, 0, 1, -2, 0, 2, -1, 0, 1], 3, 3, { edge: 'clamp', flip: false });
  const gy = convolve2d(img, [-1, -2, -1, 0, 0, 0, 1, 2, 1], 3, 3, { edge: 'clamp', flip: false });
  const out = new Float32Array(img.data.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.min(255, Math.hypot(gx.data[i]!, gy.data[i]!));
  }
  return { width: img.width, height: img.height, data: out };
}

/**
 * Linear convolution computed in the frequency domain: both operands are
 * zero-padded to a common power-of-two size ≥ (w+kw−1)×(h+kh−1), the spectra
 * are multiplied, the result is transformed back and the central "same" crop
 * is returned. The convolution-theorem benchmark compares this against the
 * direct spatial convolution.
 */
export function fftConvolve2d(img: GrayImage, kernel: Float32Array | number[], kw: number, kh: number): GrayImage {
  const W = nextPow2(img.width + kw - 1);
  const H = nextPow2(img.height + kh - 1);
  const are = new Float64Array(W * H);
  const aim = new Float64Array(W * H);
  const bre = new Float64Array(W * H);
  const bim = new Float64Array(W * H);
  for (let y = 0; y < img.height; y += 1)
    for (let x = 0; x < img.width; x += 1) are[y * W + x] = img.data[y * img.width + x]!;
  for (let y = 0; y < kh; y += 1)
    for (let x = 0; x < kw; x += 1) bre[y * W + x] = kernel[y * kw + x]!;
  fft2d(are, aim, W, H, false);
  fft2d(bre, bim, W, H, false);
  const cre = new Float64Array(W * H);
  const cim = new Float64Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    cre[i] = are[i]! * bre[i]! - aim[i]! * bim[i]!;
    cim[i] = are[i]! * bim[i]! + aim[i]! * bre[i]!;
  }
  fft2d(cre, cim, W, H, true);
  const out = new Float32Array(img.width * img.height);
  const ox = (kw - 1) >> 1;
  const oy = (kh - 1) >> 1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      out[y * img.width + x] = cre[(y + oy) * W + (x + ox)]!;
    }
  }
  return { width: img.width, height: img.height, data: out };
}

// ---- histogram equalisation -------------------------------------------------------

/** 256-bin grey-level histogram. */
export function histogram(img: GrayImage): Float64Array {
  const hist = new Float64Array(256);
  for (let i = 0; i < img.data.length; i += 1) {
    const v = Math.min(255, Math.max(0, Math.round(img.data[i]!)));
    hist[v] += 1;
  }
  return hist;
}

/**
 * Global histogram equalisation: map each grey level through the normalised
 * CDF, g = round(255·CDF(v)/N). Monotonic by construction.
 */
export function histogramEqualize(img: GrayImage): GrayImage {
  const hist = histogram(img);
  const total = img.data.length;
  const cdf = new Float64Array(256);
  let acc = 0;
  for (let v = 0; v < 256; v += 1) {
    acc += hist[v]!;
    cdf[v] = acc / total;
  }
  const map = new Float64Array(256);
  for (let v = 0; v < 256; v += 1) map[v] = Math.round(255 * cdf[v]!);
  const out = new Float32Array(img.data.length);
  for (let i = 0; i < img.data.length; i += 1) {
    const v = Math.min(255, Math.max(0, Math.round(img.data[i]!)));
    out[i] = map[v]!;
  }
  return { width: img.width, height: img.height, data: out };
}

/**
 * Uniformity measure: variance of the normalised grey-range frequencies over
 * `bins` uniform ranges (default 16, coarse enough that the mapping cannot
 * split a single input level and the flattening effect is measurable).
 */
export function histogramVariance(img: GrayImage, bins = 16): number {
  const hist = new Float64Array(bins);
  for (let i = 0; i < img.data.length; i += 1) {
    const v = Math.min(255, Math.max(0, Math.round(img.data[i]!)));
    hist[Math.min(bins - 1, Math.floor((v / 256) * bins))] += 1;
  }
  const n = img.data.length;
  const mean = 1 / bins;
  let acc = 0;
  for (let i = 0; i < bins; i += 1) acc += (hist[i]! / n - mean) ** 2;
  return acc / bins;
}

// ---- quality metrics -----------------------------------------------------------------

/** Mean squared error between two same-sized images (NaN on size mismatch). */
export function imageMse(a: GrayImage, b: GrayImage): number {
  if (a.width !== b.width || a.height !== b.height) return NaN;
  let acc = 0;
  for (let i = 0; i < a.data.length; i += 1) acc += (a.data[i]! - b.data[i]!) ** 2;
  return acc / a.data.length;
}

/** Peak signal-to-noise ratio in dB: PSNR = 10·log10(MAX²/MSE). */
export function imagePsnr(a: GrayImage, b: GrayImage, max = 255): number {
  const mse = imageMse(a, b);
  if (!Number.isFinite(mse) || mse <= 0) return Number.POSITIVE_INFINITY;
  return 10 * Math.log10((max * max) / mse);
}

// ---- spectral analysis ------------------------------------------------------------------

/** In-place FFT shift (swap quadrants) so the DC term sits at the centre. */
function fftShift(re: Float64Array, im: Float64Array, w: number, h: number): void {
  const hw = w >> 1;
  const hh = h >> 1;
  for (let y = 0; y < hh; y += 1) {
    for (let x = 0; x < hw; x += 1) {
      const i1 = y * w + x;
      const i2 = (y + hh) * w + (x + hw);
      const i3 = y * w + (x + hw);
      const i4 = (y + hh) * w + x;
      for (const arr of [re, im]) {
        const a = arr[i1]!;
        arr[i1] = arr[i2]!;
        arr[i2] = a;
        const b = arr[i3]!;
        arr[i3] = arr[i4]!;
        arr[i4] = b;
      }
    }
  }
}

/** Log-magnitude FFT spectrum visualisation (fft-shifted, 0–255). */
export function fftSpectrumImage(img: GrayImage): GrayImage {
  const { re, im, width, height } = padToPow2(img);
  fft2d(re, im, width, height, false);
  fftShift(re, im, width, height);
  let maxMag = 0;
  const mag = new Float64Array(width * height);
  for (let i = 0; i < mag.length; i += 1) {
    mag[i] = Math.log1p(Math.hypot(re[i]!, im[i]!));
    if (mag[i]! > maxMag) maxMag = mag[i]!;
  }
  const out = new Float32Array(img.width * img.height);
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      out[y * img.width + x] = (255 * mag[y * width + x]!) / (maxMag || 1);
    }
  }
  return { width: img.width, height: img.height, data: out };
}

/**
 * Fraction of total spectral energy contained within the central quarter
 * radius (low-frequency concentration), computed on the power-of-two padded
 * (edge-replicated) transform.
 */
export function spectralEnergyConcentration(img: GrayImage): number {
  const { re, im, width, height } = padToPow2(img);
  fft2d(re, im, width, height, false);
  const hw = width >> 2;
  const hh = height >> 2;
  let inner = 0;
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const e = re[y * width + x]! ** 2 + im[y * width + x]! ** 2;
      total += e;
      if (Math.abs(x - width / 2) < hw && Math.abs(y - height / 2) < hh) inner += e;
    }
  }
  return total > 0 ? inner / total : 0;
}

// ---- embedded validation benchmark ---------------------------------------------------------

export const IMAGEPROC_BENCHMARK = {
  id: 'imageproc-numerics-benchmark',
  /** FFT vs naive DFT comparison size. */
  fftSize: 32,
  seed: 20261011,
  /** Tolerances. */
  fftTol: 1e-9,
  convTol: 1e-6,
  psnrTol: 1e-9,
} as const;

export interface ImageProcBenchmarkResult {
  /** ① max |FFT − naive DFT| over the complex parts (must be < 1e-9). */
  fftVsDftErr: number;
  /** Inverse-FFT round-trip error (max |original − recovered|). */
  fftRoundTripErr: number;
  /** ② max |spatial conv − spectral product⁻¹| (must be < 1e-6). */
  convTheoremErr: number;
  /** ③ histogram bin-frequency variance before / after equalisation. */
  eqVarBefore: number;
  eqVarAfter: number;
  eqVarRatio: number;
  /** ④ |PSNR − 10·log10(MAX²/MSE)| for a known constant offset (must be 0). */
  psnrIdentityErr: number;
  /** MSE of the offset pair (must equal offset² exactly). */
  mseMeasured: number;
  /** Reference MSE used in ④ (offset²). */
  mseExpected: number;
  elapsedMs: number;
  passed: boolean;
}

/**
 * Run the embedded numerics benchmark. The skewed equalisation subject uses
 * a seeded cubic-distribution ramp so the pre-equalisation histogram is
 * strongly non-uniform; the PSNR identity uses a constant +15 offset image.
 */
export function runImageProcBenchmark(): ImageProcBenchmarkResult {
  const t0 = Date.now();
  const n = IMAGEPROC_BENCHMARK.fftSize;
  // ① seeded random real matrix → FFT vs naive DFT.
  const rand = mulberry32(IMAGEPROC_BENCHMARK.seed);
  const re = new Float64Array(n * n);
  const im = new Float64Array(n * n);
  for (let i = 0; i < n * n; i += 1) re[i] = rand() * 2 - 1;
  const refRe = Float64Array.from(re);
  const refIm = Float64Array.from(im);
  const naive = naiveDft2d(refRe, refIm, n, n, false);
  const testRe = Float64Array.from(re);
  const testIm = Float64Array.from(im);
  fft2d(testRe, testIm, n, n, false);
  let fftVsDftErr = 0;
  for (let i = 0; i < n * n; i += 1) {
    fftVsDftErr = Math.max(fftVsDftErr, Math.abs(testRe[i]! - naive.re[i]!), Math.abs(testIm[i]! - naive.im[i]!));
  }
  // Round trip.
  const rtRe = Float64Array.from(re);
  const rtIm = Float64Array.from(im);
  fft2d(rtRe, rtIm, n, n, false);
  fft2d(rtRe, rtIm, n, n, true);
  let fftRoundTripErr = 0;
  for (let i = 0; i < n * n; i += 1) fftRoundTripErr = Math.max(fftRoundTripErr, Math.abs(rtRe[i]! - re[i]!));

  // ② convolution theorem on a 24×24 image with a 5×5 Gaussian kernel.
  const w = 24;
  const h = 24;
  const img: GrayImage = { width: w, height: h, data: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i += 1) img.data[i] = rand() * 255;
  const g = gaussianKernel2d(1.1);
  const direct = convolve2d(img, g.kernel, g.size, g.size, { edge: 'zero', flip: true });
  const spectral = fftConvolve2d(img, g.kernel, g.size, g.size);
  let convTheoremErr = 0;
  for (let i = 0; i < w * h; i += 1) convTheoremErr = Math.max(convTheoremErr, Math.abs(direct.data[i]! - spectral.data[i]!));

  // ③ equalisation uniformity on a skewed synthetic image.
  const sw = 96;
  const sh = 96;
  const skew: GrayImage = { width: sw, height: sh, data: new Float32Array(sw * sh) };
  for (let i = 0; i < sw * sh; i += 1) {
    const u = rand();
    skew.data[i] = Math.floor(255 * u * u * u);
  }
  const eqVarBefore = histogramVariance(skew);
  const eqVarAfter = histogramVariance(histogramEqualize(skew));

  // ④ PSNR ⇔ MSE analytic identity with a constant +15 offset.
  const aw = 64;
  const ah = 64;
  const a: GrayImage = { width: aw, height: ah, data: new Float32Array(aw * ah) };
  const b: GrayImage = { width: aw, height: ah, data: new Float32Array(aw * ah) };
  for (let i = 0; i < aw * ah; i += 1) {
    a.data[i] = 30 + rand() * 170;
    b.data[i] = a.data[i]! + 15;
  }
  const mseExpected = 15 * 15;
  const mseMeasured = imageMse(a, b);
  const psnr = imagePsnr(a, b);
  const psnrIdentityErr = Math.abs(psnr - 10 * Math.log10((255 * 255) / mseMeasured));

  const elapsedMs = Date.now() - t0;
  const passed =
    fftVsDftErr < IMAGEPROC_BENCHMARK.fftTol &&
    fftRoundTripErr < IMAGEPROC_BENCHMARK.fftTol &&
    convTheoremErr < IMAGEPROC_BENCHMARK.convTol &&
    eqVarAfter < eqVarBefore &&
    psnrIdentityErr < IMAGEPROC_BENCHMARK.psnrTol &&
    Math.abs(mseMeasured - mseExpected) < 1e-6;
  return {
    fftVsDftErr,
    fftRoundTripErr,
    convTheoremErr,
    eqVarBefore,
    eqVarAfter,
    eqVarRatio: eqVarBefore > 0 ? eqVarAfter / eqVarBefore : NaN,
    psnrIdentityErr,
    mseMeasured,
    mseExpected,
    elapsedMs,
    passed,
  };
}
