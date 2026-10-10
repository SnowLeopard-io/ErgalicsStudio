// ==========================================================================
// Astronomy pipeline kernels — pure TypeScript, deterministic, unit-tested.
//
// Simulation: synthetic CCD frames with Moffat PSF stars, bias/dark/flat
// calibration structure, Poisson shot noise, Gaussian read noise and cosmic
// rays — the canonical CCD equation, seeded (mulberry32) for reproducibility.
// Reduction: master-frame calibration, sigma-clipped background statistics,
// local-maximum star detection and aperture photometry with annulus
// background (the classic DAOPHOT-style workflow).
// ==========================================================================

import { median } from '@/core/stats/descriptive';

/** TypedArray read helper (noUncheckedIndexedAccess yields T | undefined). */
const rd = (a: Float64Array, i: number): number => a[i] ?? 0;

// ---- deterministic RNG -----------------------------------------------------------------

/** mulberry32 PRNG — returns a fresh stream; deterministic per seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller standard normal from a uniform stream. */
export function gaussian(rng: () => number): number {
  let u = rng();
  while (u <= 1e-12) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Poisson sample: Knuth for small λ, normal approximation for large λ. */
export function poisson(rng: () => number, lambda: number): number {
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gaussian(rng)));
  let l = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > l);
  return k - 1;
}

// ---- simulation ---------------------------------------------------------------------------

export interface SimStar {
  /** Fractional pixel centre (0-based). */
  x: number;
  y: number;
  /** Injected total source electrons. */
  fluxE: number;
}

export interface SimParams {
  width: number;
  height: number;
  /** Moffat FWHM (pixels). */
  fwhm: number;
  /** Moffat shape β (2.5 ≈ atmospheric seeing). */
  beta: number;
  stars: SimStar[];
  /** Diffuse sky level (electrons). */
  skyE: number;
  /** Bias pedestal (ADU). */
  biasAdu: number;
  /** Dark current × exposure (electrons). */
  darkE: number;
  /** Read noise σ (electrons). */
  readNoiseE: number;
  /** Electrons per ADU. */
  gainEPerAdu: number;
  /** Vignetting strength 0..0.5 (cos⁴-like fall-off). */
  vignetting: number;
  /** Expected cosmic-ray hits per frame. */
  cosmicRays: number;
  seed: number;
}

export interface SimFrame {
  width: number;
  height: number;
  /** Raw frame in ADU (what a real camera delivers). */
  raw: Float64Array;
  bias: Float64Array;
  dark: Float64Array;
  flat: Float64Array;
  stars: SimStar[];
  params: SimParams;
}

/**
 * Builds a complete synthetic observation: masters (bias/dark/flat) plus the
 * raw science frame. Everything derives from one seed → fully reproducible.
 */
export function simulateFrame(p: SimParams): SimFrame {
  const { width: w, height: h } = p;
  const rng = mulberry32(p.seed);
  const raw = new Float64Array(w * h);
  const bias = new Float64Array(w * h);
  const dark = new Float64Array(w * h);
  const flat = new Float64Array(w * h);
  const alpha2 = (p.fwhm / 2) ** 2; // Moffat α² from FWHM

  // Masters (single-frame masters keep the demo honest: they carry noise too).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      bias[i] = p.biasAdu + gaussian(rng) * (p.readNoiseE / p.gainEPerAdu);
      dark[i] = (poisson(rng, p.darkE) / p.gainEPerAdu) + p.biasAdu * 0.02;
      const nx = (x - w / 2 + 0.5) / (w / 2);
      const ny = (y - h / 2 + 0.5) / (h / 2);
      const r2 = nx * nx + ny * ny;
      // Flat-field response: vignetting + a faint dust donut + 1% pixel noise.
      const dust = 1 - 0.06 * Math.exp(-((r2 - 0.55) ** 2) / 0.04);
      flat[i] = Math.max(0.35, (1 - p.vignetting * r2) * dust) * (1 + 0.01 * gaussian(rng));
    }
  }
  // Science frame: sky + dark through the flat, pedestal + full read noise.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      raw[i] =
        poisson(rng, p.skyE * rd(flat, i)) / p.gainEPerAdu +
        poisson(rng, p.darkE) / p.gainEPerAdu +
        p.biasAdu +
        gaussian(rng) * (p.readNoiseE / p.gainEPerAdu);
    }
  }
  for (const star of p.stars) {
    const rad = Math.ceil(p.fwhm * 2.2);
    const x0 = Math.max(0, Math.floor(star.x - rad));
    const x1 = Math.min(w - 1, Math.ceil(star.x + rad));
    const y0 = Math.max(0, Math.floor(star.y - rad));
    const y1 = Math.min(h - 1, Math.ceil(star.y + rad));
    // Peak amplitude so the Moffat integral ≈ fluxE (electrons):
    // ∫ psf dA = peak · π·α²/(β−1) = fluxE.
    const peak = star.fluxE / (Math.PI * alpha2 / (p.beta - 1));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - star.x;
        const dy = y - star.y;
        const r2 = dx * dx + dy * dy;
        const e = peak / (1 + r2 / alpha2) ** p.beta; // electrons this pixel
        const i = y * w + x;
        raw[i] = rd(raw, i) + poisson(rng, Math.max(e * rd(flat, i), 0)) / p.gainEPerAdu;
      }
    }
  }
  // Cosmic rays: sharp 1-3 pixel spikes, insensitive to the flat.
  for (let c = 0; c < p.cosmicRays; c++) {
    const x = Math.floor(rng() * w);
    const y = Math.floor(rng() * h);
    const energy = 800 + rng() * 4000; // ADU
    const i = y * w + x;
    raw[i] = rd(raw, i) + energy;
    if (rng() < 0.5 && x + 1 < w) raw[i + 1] = rd(raw, i + 1) + energy * 0.4 * rng();
  }
  return { width: w, height: h, raw, bias, dark, flat, stars: p.stars, params: p };
}

/** Random star layout with a power-law flux distribution (faint majority). */
export function randomStarField(rng: () => number, w: number, h: number, n: number, fluxRange: [number, number]): SimStar[] {
  const stars: SimStar[] = [];
  const [fMin, fMax] = fluxRange;
  const logMin = Math.log(fMin);
  const logMax = Math.log(fMax);
  for (let i = 0; i < n; i++) {
    const margin = 12;
    const x = margin + rng() * (w - 2 * margin);
    const y = margin + rng() * (h - 2 * margin);
    const flux = Math.exp(logMin + rng() * (logMax - logMin));
    stars.push({ x, y, fluxE: flux });
  }
  return stars;
}

// ---- calibration -----------------------------------------------------------------------------

export interface CalibrateOptions {
  /** Sigma threshold for the Laplacian-style cosmic-ray clip (0 = off). */
  cosmicRaySigma?: number;
}

/**
 * Standard CCD reduction: (raw − bias − dark) / normalisedFlat, followed by an
 * optional 6-σ single-pixel cosmic-ray clip against the local median. The
 * input frame is never modified (raw data stays pristine).
 */
export function calibrate(frame: SimFrame, opts: CalibrateOptions = {}): { pixels: Float64Array; crMask: Uint8Array; clipped: number } {
  const { width: w, height: h, raw, bias, dark, flat } = frame;
  const flatMed = median(Array.from(flat));
  const pixels = new Float64Array(w * h);
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] = (rd(raw, i) - rd(bias, i) - rd(dark, i)) / Math.max(rd(flat, i) / flatMed, 0.05);
  }
  // Cosmic-ray clip: flag isolated spikes against the 3×3 local median, but
  // only where the neighbourhood is background-like — star cores have elevated
  // neighbours and must not be clipped.
  const crMask = new Uint8Array(w * h);
  let clipped = 0;
  const sig = opts.cosmicRaySigma ?? 0;
  if (sig > 0) {
    // Global (subsampled, sigma-clipped) background to identify star-free areas.
    const sub: number[] = [];
    for (let i = 0; i < pixels.length; i += 5) sub.push(rd(pixels, i));
    let gmed = median(sub);
    let gmad = median(sub.map((v) => Math.abs(v - gmed)));
    for (let it = 0; it < 2; it++) {
      const kept = sub.filter((v) => Math.abs(v - gmed) < 3 * Math.max(gmad, 1e-9));
      if (kept.length < 100) break;
      gmed = median(kept);
      gmad = median(kept.map((v) => Math.abs(v - gmed)));
    }
    const gSigma = Math.max(gmad * 1.4826, 1e-6);
    const local = new Float64Array(9);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            local[n++] = rd(pixels, i + dy * w + dx);
          }
        const vals = Array.from(local.subarray(0, n));
        const med = median(vals);
        // Noise scale: global sky σ (a per-pixel MAD from 8 samples is far too
        // noisy and produces false positives at high thresholds).
        const dev = (rd(pixels, i) - med) / (gSigma * 1.1);
        // Star core guard: the 3×3 neighbourhood must sit at the sky level.
        const starCore = Math.abs(med - gmed) > 4 * gSigma;
        if (dev > sig && !starCore) {
          crMask[i] = 1;
          clipped++;
        }
      }
    }
    // Replace clipped pixels with the local median (interpolation, flagged).
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (!crMask[i]) continue;
        const local: number[] = [];
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx === 0 && dy === 0) || crMask[i + dy * w + dx]) continue;
            local.push(rd(pixels, i + dy * w + dx));
          }
        pixels[i] = local.length ? median(local) : rd(pixels, i);
      }
    }
  }
  return { pixels, crMask, clipped };
}

/**
 * Absolute flux scale of the calibration chain: after division by the
 * normalised master flat (flat / median(flat)), recovered fluxes are in
 * "median-flat units" — the physical reference for flux-recovery benchmarks
 * (the residual constant is absorbed by the photometric zeropoint, as in
 * professional pipelines).
 */
export function flatZeroLevel(frame: SimFrame): number {
  return median(Array.from(frame.flat));
}

// ---- background / detection -------------------------------------------------------------------

export interface BackgroundStats {
  medianAdu: number;
  /** Robust σ from the MAD (×1.4826). */
  sigmaAdu: number;
}

/** Sigma-clipped (2.5σ, 3 iterations) background estimate. */
export function estimateBackground(pixels: Float64Array): BackgroundStats {
  let values = Array.from(pixels);
  let med = median(values);
  let sig = mad(values, med);
  for (let it = 0; it < 3; it++) {
    const kept = values.filter((v) => Math.abs(v - med) < 2.5 * Math.max(sig, 1e-9));
    if (kept.length < 100) break;
    values = kept;
    med = median(values);
    sig = mad(values, med);
  }
  return { medianAdu: med, sigmaAdu: sig * 1.4826 };
}

function mad(values: number[], med: number): number {
  return median(values.map((v) => Math.abs(v - med)));
}

export interface Detection {
  x: number;
  y: number;
  peak: number;
  /** Background-subtracted aperture flux (ADU). */
  flux: number;
  fluxErr: number;
  snr: number;
  /** Instrumental magnitude −2.5·log₁₀(flux) + zeropoint. */
  mag: number;
}

export interface DetectOptions {
  /** Detection threshold in background σ above the median. */
  thresholdSigma: number;
  /** Minimum separation between detections (pixels). */
  minSeparation?: number;
}

/**
 * Star detection: scan for local maxima above the background threshold, then
 * refine a 5×5 flux-weighted centroid. Non-maximum suppression by radius.
 */
export function detectStars(
  pixels: Float64Array,
  w: number,
  h: number,
  bkg: BackgroundStats,
  opts: DetectOptions,
): Array<{ x: number; y: number; peak: number }> {
  const thresh = bkg.medianAdu + opts.thresholdSigma * bkg.sigmaAdu;
  const minSep = opts.minSeparation ?? 5;
  const peaks: Array<{ x: number; y: number; peak: number }> = [];
  const at = (x: number, y: number): number => rd(pixels, y * w + x);
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const v = at(x, y);
      if (v < thresh) continue;
      if (v < at(x - 1, y) || v < at(x + 1, y) || v < at(x, y - 1) || v < at(x, y + 1)) continue;
      // 5×5 flux-weighted centroid.
      let sw = 0;
      let sx = 0;
      let sy = 0;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const wgt = Math.max(at(x + dx, y + dy) - bkg.medianAdu, 0);
          sw += wgt;
          sx += (x + dx) * wgt;
          sy += (y + dy) * wgt;
        }
      if (sw <= 0) continue;
      const cx = sx / sw;
      const cy = sy / sw;
      // Non-maximum suppression.
      if (peaks.some((p) => (p.x - cx) ** 2 + (p.y - cy) ** 2 < minSep * minSep)) continue;
      peaks.push({ x: cx, y: cy, peak: v });
    }
  }
  return peaks;
}

// ---- aperture photometry ------------------------------------------------------------------------

export interface PhotometryOptions {
  apertureR: number;
  annulusIn: number;
  annulusOut: number;
  /** Photometric zeropoint (mag = −2.5 log₁₀ flux + ZP). */
  zeropoint: number;
}

/**
 * Classic aperture photometry with a median annulus background. SNR follows
 * the CCD equation F/√(F + n·(sky + RN²)) with F in electrons (gain-scaled).
 */
export function aperturePhotometry(
  pixels: Float64Array,
  w: number,
  h: number,
  cx: number,
  cy: number,
  opts: PhotometryOptions,
  gainEPerAdu: number,
  readNoiseE: number,
): { flux: number; fluxErr: number; snr: number; mag: number; skyAdu: number } {
  const annulus: number[] = [];
  for (let y = Math.max(0, Math.floor(cy - opts.annulusOut)); y <= Math.min(h - 1, Math.ceil(cy + opts.annulusOut)); y++) {
    for (let x = Math.max(0, Math.floor(cx - opts.annulusOut)); x <= Math.min(w - 1, Math.ceil(cx + opts.annulusOut)); x++) {
      const r = Math.hypot(x - cx, y - cy);
      if (r >= opts.annulusIn && r <= opts.annulusOut) annulus.push(rd(pixels, y * w + x));
    }
  }
  const sky = annulus.length ? median(annulus) : 0;
  let flux = 0;
  let nAp = 0;
  for (let y = Math.max(0, Math.floor(cy - opts.apertureR)); y <= Math.min(h - 1, Math.ceil(cy + opts.apertureR)); y++) {
    for (let x = Math.max(0, Math.floor(cx - opts.apertureR)); x <= Math.min(w - 1, Math.ceil(cx + opts.apertureR)); x++) {
      if (Math.hypot(x - cx, y - cy) <= opts.apertureR) {
        flux += rd(pixels, y * w + x) - sky;
        nAp++;
      }
    }
  }
  // CCD equation: all noise terms in electrons.
  const fluxE = Math.max(flux * gainEPerAdu, 1e-9);
  const skyE = Math.max(sky, 0) * gainEPerAdu;
  const noiseE = Math.sqrt(Math.max(fluxE, 0) + nAp * (skyE + readNoiseE * readNoiseE));
  const snr = fluxE / noiseE;
  const fluxErr = noiseE / gainEPerAdu;
  const mag = flux > 0 ? -2.5 * Math.log10(flux) + opts.zeropoint : NaN;
  return { flux, fluxErr, snr, mag, skyAdu: sky };
}

/** Photometric pipeline for one frame: detect + measure every source. */
export function runPhotometry(
  pixels: Float64Array,
  w: number,
  h: number,
  bkg: BackgroundStats,
  detect: DetectOptions,
  phot: PhotometryOptions,
  gainEPerAdu: number,
  readNoiseE: number,
): Detection[] {
  const peaks = detectStars(pixels, w, h, bkg, detect);
  return peaks
    .map((p) => {
      const m = aperturePhotometry(pixels, w, h, p.x, p.y, phot, gainEPerAdu, readNoiseE);
      return { x: p.x, y: p.y, peak: p.peak, flux: m.flux, fluxErr: m.fluxErr, snr: m.snr, mag: m.mag };
    })
    .sort((a, b) => b.flux - a.flux);
}
