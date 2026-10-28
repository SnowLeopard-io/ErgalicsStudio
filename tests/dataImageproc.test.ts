// ==========================================================================
// data-imageproc kernel unit tests: 2-D FFT vs naive DFT, round-trip,
// convolution theorem, separable == direct, histogram equalisation
// flattening, PSNR⇔MSE identity and kernel normalisation.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import {
  IMAGEPROC_BENCHMARK,
  convolve2d,
  fft2d,
  fftConvolve2d,
  gaussianBlur,
  gaussianKernel1d,
  gaussianKernel2d,
  grayFromRgba,
  histogramEqualize,
  histogramVariance,
  imageMse,
  imagePsnr,
  makeTestImage,
  naiveDft2d,
  runImageProcBenchmark,
  sharpen,
  sobelMagnitude,
  type GrayImage,
} from '@/plugins/builtin/data/imageproc/kernel';

function seededMatrix(n: number, seed: number): Float64Array {
  // Simple deterministic LCG, independent of the implementation under test.
  const out = new Float64Array(n * n);
  let s = seed >>> 0;
  for (let i = 0; i < out.length; i += 1) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    out[i] = (s / 0xffffffff) * 2 - 1;
  }
  return out;
}

describe('2-D FFT vs naive DFT', () => {
  it('matches the O(N⁴) reference to < 1e-9 on a 32×32 real matrix', () => {
    const n = 32;
    const re = seededMatrix(n, IMAGEPROC_BENCHMARK.seed);
    const im = new Float64Array(n * n);
    const refRe = Float64Array.from(re);
    const refIm = Float64Array.from(im);
    const naive = naiveDft2d(refRe, refIm, n, n, false);
    fft2d(re, im, n, n, false);
    let worst = 0;
    for (let i = 0; i < n * n; i += 1) {
      worst = Math.max(worst, Math.abs(re[i]! - naive.re[i]!), Math.abs(im[i]! - naive.im[i]!));
    }
    expect(worst).toBeLessThan(IMAGEPROC_BENCHMARK.fftTol);
  });

  it('round-trips forward → inverse to < 1e-9', () => {
    const n = 32;
    const re = seededMatrix(n, 42);
    const im = new Float64Array(n * n);
    const orig = Float64Array.from(re);
    fft2d(re, im, n, n, false);
    fft2d(re, im, n, n, true);
    let worst = 0;
    for (let i = 0; i < n * n; i += 1) worst = Math.max(worst, Math.abs(re[i]! - orig[i]!));
    expect(worst).toBeLessThan(IMAGEPROC_BENCHMARK.fftTol);
  });
});

describe('convolution', () => {
  it('satisfies the convolution theorem to < 1e-6 (spatial == spectral)', () => {
    const w = 24;
    const h = 24;
    const img: GrayImage = { width: w, height: h, data: new Float32Array(w * h) };
    let s = 7;
    for (let i = 0; i < img.data.length; i += 1) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      img.data[i] = (s / 0xffffffff) * 255;
    }
    const g = gaussianKernel2d(1.1);
    const direct = convolve2d(img, g.kernel, g.size, g.size, { edge: 'zero', flip: true });
    const spectral = fftConvolve2d(img, g.kernel, g.size, g.size);
    let worst = 0;
    for (let i = 0; i < w * h; i += 1) worst = Math.max(worst, Math.abs(direct.data[i]! - spectral.data[i]!));
    expect(worst).toBeLessThan(IMAGEPROC_BENCHMARK.convTol);
  });

  it('separable Gaussian equals the direct 2-D kernel within Float32 rounding', () => {
    const img = makeTestImage(48, 48, 5);
    const sigma = 1.3;
    const g = gaussianKernel2d(sigma);
    const direct = convolve2d(img, g.kernel, g.size, g.size, { edge: 'clamp', flip: false });
    const sep = gaussianBlur(img, sigma);
    let worst = 0;
    for (let i = 0; i < img.data.length; i += 1) worst = Math.max(worst, Math.abs(direct.data[i]! - sep.data[i]!));
    // Outputs are stored in Float32Array: the separable path rounds twice, so
    // ~1.5e-5 absolute on the 0–255 scale is the expected rounding envelope.
    expect(worst).toBeLessThan(5e-4);
  });

  it('normalises Gaussian kernels to unit sum', () => {
    for (const sigma of [0.6, 1, 2.5]) {
      const k1 = gaussianKernel1d(sigma);
      const sum = k1.reduce((a, v) => a + v, 0);
      expect(Math.abs(sum - 1)).toBeLessThan(1e-12);
      const k2 = gaussianKernel2d(sigma);
      const sum2 = k2.kernel.reduce((a, v) => a + v, 0);
      expect(Math.abs(sum2 - 1)).toBeLessThan(1e-12);
    }
  });

  it('Sobel responds strongly on a step edge and weakly on a flat field', () => {
    const w = 32;
    const h = 32;
    const step: GrayImage = { width: w, height: h, data: new Float32Array(w * h) };
    const flat: GrayImage = { width: w, height: h, data: new Float32Array(w * h) };
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        flat.data[y * w + x] = 100;
        step.data[y * w + x] = x < w / 2 ? 40 : 180;
      }
    }
    const edge = sobelMagnitude(step);
    const flatEdge = sobelMagnitude(flat);
    const midRow = h >> 1;
    expect(edge.data[midRow * w + (w >> 1)]!).toBeGreaterThan(120);
    expect(Math.max(...flatEdge.data)).toBeLessThan(1e-6);
  });
});

describe('histogram equalisation', () => {
  it('strictly decreases the 16-bin grey-range frequency variance on a skewed image', () => {
    const n = 96 * 96;
    const skew: GrayImage = { width: 96, height: 96, data: new Float32Array(n) };
    let s = 99;
    for (let i = 0; i < n; i += 1) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const u = s / 0xffffffff;
      skew.data[i] = Math.floor(255 * u * u * u);
    }
    const before = histogramVariance(skew);
    const after = histogramVariance(histogramEqualize(skew));
    expect(after).toBeLessThan(before);
  });
});

describe('PSNR / MSE metrics', () => {
  it('fulfils the analytic identity PSNR = 10·log10(MAX²/MSE) exactly', () => {
    const n = 64 * 64;
    const a: GrayImage = { width: 64, height: 64, data: new Float32Array(n) };
    const b: GrayImage = { width: 64, height: 64, data: new Float32Array(n) };
    let s = 123;
    for (let i = 0; i < n; i += 1) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      a.data[i] = 30 + (s / 0xffffffff) * 170;
      b.data[i] = a.data[i]! + 15;
    }
    const mse = imageMse(a, b);
    expect(Math.abs(mse - 225)).toBeLessThan(1e-6);
    const psnr = imagePsnr(a, b);
    expect(psnr - 10 * Math.log10((255 * 255) / mse)).toBe(0);
  });

  it('identical images give infinite PSNR', () => {
    const img = makeTestImage(16, 16, 1);
    expect(imagePsnr(img, img)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('processing pipeline on the built-in test image', () => {
  const img = makeTestImage(96, 96, IMAGEPROC_BENCHMARK.seed);

  it('deterministically regenerates the same test image', () => {
    const again = makeTestImage(96, 96, IMAGEPROC_BENCHMARK.seed);
    let worst = 0;
    for (let i = 0; i < img.data.length; i += 1) worst = Math.max(worst, Math.abs(img.data[i]! - again.data[i]!));
    expect(worst).toBe(0);
  });

  it('blur lowers, sharpen raises high-frequency energy (variance proxy)', () => {
    const blurred = gaussianBlur(img, 2);
    const sharp = sharpen(img, 2);
    const variance = (im: GrayImage): number => {
      let mean = 0;
      for (const v of im.data) mean += v;
      mean /= im.data.length;
      let acc = 0;
      for (const v of im.data) acc += (v - mean) ** 2;
      return acc / im.data.length;
    };
    expect(variance(blurred)).toBeLessThan(variance(img));
    expect(variance(sharp)).toBeGreaterThan(variance(img));
  });

  it('PSNR of the blurred image sits in a sane band', () => {
    const psnr = imagePsnr(img, gaussianBlur(img, 1.5));
    expect(psnr).toBeGreaterThan(20);
    expect(psnr).toBeLessThan(60);
  });
});

describe('embedded numerics benchmark', () => {
  it('passes all four checks', () => {
    const b = runImageProcBenchmark();
    expect(b.fftVsDftErr).toBeLessThan(IMAGEPROC_BENCHMARK.fftTol);
    expect(b.convTheoremErr).toBeLessThan(IMAGEPROC_BENCHMARK.convTol);
    expect(b.eqVarAfter).toBeLessThan(b.eqVarBefore);
    expect(b.psnrIdentityErr).toBe(0);
    expect(b.passed).toBe(true);
  });
});

describe('grayFromRgba (external image import)', () => {
  it('applies ITU-R BT.601 luma weights (0.299/0.587/0.114)', () => {
    // One pure-red, one pure-green, one pure-blue, one white pixel (opaque).
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const img = grayFromRgba(rgba, 2, 2);
    expect(img.width).toBe(2);
    expect(img.height).toBe(2);
    // Values are stored in a Float32Array, so compare to ~1e-3.
    expect(img.data[0]).toBeCloseTo(0.299 * 255, 3);
    expect(img.data[1]).toBeCloseTo(0.587 * 255, 3);
    expect(img.data[2]).toBeCloseTo(0.114 * 255, 3);
    expect(img.data[3]).toBeCloseTo(255, 3);
  });

  it('composites transparent pixels over white', () => {
    // Fully transparent black → white; alpha 128/255 black → 255·(1−128/255) = 127.
    const rgba = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 128]);
    const img = grayFromRgba(rgba, 2, 1);
    expect(img.data[0]).toBeCloseTo(255, 3);
    expect(img.data[1]).toBeCloseTo(127, 3);
  });

  it('keeps dimensions when the long side is within maxSide', () => {
    const n = 8 * 4;
    const rgba = new Uint8ClampedArray(n * 4);
    for (let i = 0; i < n; i += 1) {
      rgba[i * 4] = 128;
      rgba[i * 4 + 1] = 128;
      rgba[i * 4 + 2] = 128;
      rgba[i * 4 + 3] = 255;
    }
    const img = grayFromRgba(rgba, 8, 4, 512);
    expect(img.width).toBe(8);
    expect(img.height).toBe(4);
    expect(img.data[0]).toBeCloseTo(128, 6);
  });

  it('box-average downscales a uniform image without intensity drift', () => {
    const w = 16;
    const h = 8;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i += 1) {
      rgba[i * 4] = 100;
      rgba[i * 4 + 1] = 150;
      rgba[i * 4 + 2] = 200;
      rgba[i * 4 + 3] = 255;
    }
    const img = grayFromRgba(rgba, w, h, 4);
    // Long side 16 → 4, so height scales to 2.
    expect(img.width).toBe(4);
    expect(img.height).toBe(2);
    const luma = 0.299 * 100 + 0.587 * 150 + 0.114 * 200;
    for (let i = 0; i < img.data.length; i += 1) expect(img.data[i]).toBeCloseTo(luma, 6);
  });

  it('rejects buffers smaller than width*height*4', () => {
    expect(() => grayFromRgba(new Uint8ClampedArray(4), 2, 2)).toThrow(/too small/);
  });
});
