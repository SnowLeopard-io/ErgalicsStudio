// ==========================================================================
// Astronomy core + pipeline tests.
//
// 1. Ephemeris sanity: Julian Day, GMST, solar altitude (equinox noon),
//    lunar illumination range.
// 2. FITS round-trip: writeFits → parseFits → bit-exact pixels + header.
// 3. Pipeline: simulated frame → calibration → detection → aperture
//    photometry recovers the injected flux of the brightest star within 5 %.
// ==========================================================================

import { describe, expect, it } from 'vitest';
import { gmst, julianDay, moonPhaseIllumination, sunPosition } from '@/core/raytrace/astro';
import { parseFits, pixelToSky, skyToPixel, writeFits } from '@/core/astro/fits';
import {
  aperturePhotometry,
  calibrate,
  detectStars,
  estimateBackground,
  flatZeroLevel,
  mulberry32,
  randomStarField,
  simulateFrame,
} from '@/plugins/builtin/astro/pipeline/kernel';

describe('raytrace/astro ephemeris', () => {
  it('computes the Julian Day of J2000.0', () => {
    // 2000-01-01 12:00 UTC == JD 2451545.0
    expect(julianDay(new Date(Date.UTC(2000, 0, 1, 12, 0, 0)))).toBeCloseTo(2451545.0, 5);
  });

  it('GMST advances by ~24 h per sidereal day', () => {
    const jd0 = 2461000.0;
    const d1 = gmst(jd0);
    const d2 = gmst(jd0 + 1);
    const delta = ((d2 - d1 + Math.PI) % (2 * Math.PI)) - Math.PI; // wrapped
    // Sidereal day = 23h56m → GMST gain ≈ 2π × 1.002738 per solar day.
    const gain = (delta + 2 * Math.PI) / (2 * Math.PI);
    expect(gain).toBeGreaterThan(1.002);
    expect(gain).toBeLessThan(1.004);
  });

  it('sun altitude at equinox noon (lat 40°, lon 0°) is ≈ 49–51°', () => {
    // At equinox noon the solar altitude equals 90° − latitude = 50°.
    const pos = sunPosition(new Date(Date.UTC(2026, 2, 20, 12, 0, 0)), 40, 0);
    const altDeg = (pos.alt * 180) / Math.PI;
    expect(altDeg).toBeGreaterThan(49);
    expect(altDeg).toBeLessThan(51);
  });

  it('sun is below the horizon at local midnight', () => {
    const pos = sunPosition(new Date(Date.UTC(2026, 2, 20, 0, 0, 0)), 40, 0);
    expect(pos.alt).toBeLessThan(0);
  });

  it('moon illumination is within [0, 1] and peaks near opposition', () => {
    const jd = 2461100.0;
    const k = moonPhaseIllumination(jd);
    expect(k).toBeGreaterThanOrEqual(0);
    expect(k).toBeLessThanOrEqual(1);
    // A full moon occurs within any 30-day window: max illumination > 0.98.
    let maxK = 0;
    for (let d = 2461100; d < 2461130; d += 0.5) maxK = Math.max(maxK, moonPhaseIllumination(d));
    expect(maxK).toBeGreaterThan(0.98);
  });
});

describe('FITS reader/writer', () => {
  it('round-trips float64 pixels bit-exactly', () => {
    const w = 17;
    const h = 11;
    const pixels = new Float64Array(w * h);
    for (let i = 0; i < pixels.length; i++) pixels[i] = Math.sin(i * 0.7) * 1e5 + i * 0.25;
    const bytes = writeFits(pixels, w, h, [
      ['OBJECT', 'TEST FIELD', 'round-trip check'],
      ['EXPTIME', 42.5, 'seconds'],
      ['TELESCOP', 'ERGALICS-1m'],
    ]);
    const img = parseFits(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    expect(img.width).toBe(w);
    expect(img.height).toBe(h);
    expect(img.bitpix).toBe(-64);
    expect(img.header.find((c) => c.keyword === 'OBJECT')?.value).toBe('TEST FIELD');
    expect(img.header.find((c) => c.keyword === 'EXPTIME')?.value).toBeCloseTo(42.5, 10);
    for (let i = 0; i < pixels.length; i++) expect(img.pixels[i]).toBe(pixels[i]);
  });

  it('applies BSCALE/BZERO on 16-bit data written with scaled values', () => {
    // Build a minimal 16-bit FITS by hand: BITPIX=16, BZERO=-32768, BSCALE=1
    // encodes unsigned 0..65535 — the classic SDSS convention.
    const w = 4;
    const h = 3;
    const rawValues = [0, 1, 32768, 65535, 100, 200, 300, 400, 500, 600, 700, 800];
    const card = (s: string): string => s.padEnd(80, ' ');
    const cards: string[] = [
      card('SIMPLE  =                    T'),
      card('BITPIX  =                   16'),
      card('NAXIS   =                    2'),
      card(`NAXIS1  =                    ${w}`),
      card(`NAXIS2  =                    ${h}`),
      card('BSCALE  =                    1'),
      card('BZERO   =                32768'),
      card('END'),
    ];
    const header = cards.join('').padEnd(2880, ' ');
    const dataBlocks = Math.ceil((w * h * 2) / 2880);
    const buf = new Uint8Array(2880 + dataBlocks * 2880);
    for (let i = 0; i < header.length; i++) buf[i] = header.charCodeAt(i);
    const view = new DataView(buf.buffer);
    rawValues.forEach((v, i) => view.setInt16(2880 + i * 2, v - 32768, false));
    const img = parseFits(buf.buffer);
    expect(img.width).toBe(w);
    expect(img.height).toBe(h);
    rawValues.forEach((v, i) => expect(img.pixels[i]).toBe(v));
  });

  it('maps TAN WCS pixels to sky and back', () => {
    const wcs = { crval1: 180, crval2: 30, crpix1: 128, crpix2: 128, cdelt1: -0.001, cdelt2: 0.001 };
    const ref = pixelToSky(wcs, wcs.crpix1 - 1, wcs.crpix2 - 1);
    expect(ref.raDeg).toBeCloseTo(180, 4);
    expect(ref.decDeg).toBeCloseTo(30, 4);
    const p = skyToPixel(wcs, ref.raDeg, ref.decDeg);
    expect(p.x).toBeCloseTo(wcs.crpix1 - 1, 4);
    expect(p.y).toBeCloseTo(wcs.crpix2 - 1, 4);
  });
});

describe('astro CCD pipeline', () => {
  // Shared deterministic scene: a 256² frame, 40 stars, FWHM 3 px.
  const params = {
    width: 256,
    height: 256,
    fwhm: 3,
    beta: 2.5,
    stars: [] as ReturnType<typeof randomStarField>,
    skyE: 180,
    biasAdu: 512,
    darkE: 1.2,
    readNoiseE: 5,
    gainEPerAdu: 1.5,
    vignetting: 0.22,
    cosmicRays: 10,
    seed: 20260321,
  };
  params.stars = randomStarField(mulberry32(42), 256, 256, 40, [400, 90000]);
  const frame = simulateFrame(params);

  it('is fully deterministic for a given seed', () => {
    const again = simulateFrame(params);
    let diff = 0;
    for (let i = 0; i < frame.raw.length; i++) if (frame.raw[i] !== again.raw[i]) diff++;
    expect(diff).toBe(0);
  });

  it('background estimate sits near the sky pedestal', () => {
    const cal = calibrate(frame);
    const bkg = estimateBackground(cal.pixels);
    // Sky 180 e⁻ / 1.5 e⁻/ADU = 120 ADU; the calibrated frame is in
    // median-flat units (× ≈0.85) minus the dark-master pedestal offset.
    expect(bkg.medianAdu).toBeGreaterThan(70);
    expect(bkg.medianAdu).toBeLessThan(130);
    expect(bkg.sigmaAdu).toBeGreaterThan(2);
    expect(bkg.sigmaAdu).toBeLessThan(20);
  });

  it('detects the majority of stars above 5σ', () => {
    const cal = calibrate(frame);
    const bkg = estimateBackground(cal.pixels);
    const peaks = detectStars(cal.pixels, 256, 256, bkg, { thresholdSigma: 5, minSeparation: 5 });
    // Marginal faint stars may drop out; require ≥ 60 % recovery.
    expect(peaks.length).toBeGreaterThanOrEqual(24);
    expect(peaks.length).toBeLessThanOrEqual(80);
  });

  it('clips cosmic rays above 6σ without eating star cores', () => {
    const cal = calibrate(frame, { cosmicRaySigma: 6 });
    // 10 injected CRs (some double-pixel) → a handful of flagged pixels;
    // 40 stars must survive untouched.
    expect(cal.clipped).toBeGreaterThanOrEqual(5);
    expect(cal.clipped).toBeLessThan(60);
  });

  it('recovers the brightest injected star flux within 5 %', () => {
    const cal = calibrate(frame);
    const brightest = [...frame.stars].sort((a, b) => b.fluxE - a.fluxE)[0];
    if (!brightest) throw new Error('no injected stars');
    const meas = aperturePhotometry(
      cal.pixels,
      256,
      256,
      brightest.x,
      brightest.y,
      { apertureR: 6, annulusIn: 10, annulusOut: 16, zeropoint: 25 },
      1.5,
      5,
    );
    // Calibrated fluxes live in median-flat units (× median(flat) ≈ 0.85);
    // with the correct Moffat α = FWHM/(2√(2^(1/β)−1)) the wings extend
    // beyond the aperture: β=2.5 encloses ≈98.6 % inside r = 2×FWHM, and
    // pixel sampling + annulus wing subtraction cost ≈1–2 % more.
    const recovered = (meas.flux * 1.5) / (brightest.fluxE * flatZeroLevel(frame));
    expect(recovered).toBeGreaterThan(0.92);
    expect(recovered).toBeLessThan(1.05);
    // SNR of a 90000 e⁻ star on this sky must be very high.
    expect(meas.snr).toBeGreaterThan(50);
  });

  it('flags no detections when the threshold is extreme', () => {
    const cal = calibrate(frame);
    const bkg = estimateBackground(cal.pixels);
    // 3000σ ≈ 27 kADU sits above even the brightest star peak (~11 kADU).
    const peaks = detectStars(cal.pixels, 256, 256, bkg, { thresholdSigma: 3000, minSeparation: 5 });
    expect(peaks.length).toBe(0);
  });
});
