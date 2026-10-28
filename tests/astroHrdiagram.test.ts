// ==========================================================================
// astro-hrdiagram kernel unit tests: distance-modulus anchors, solar anchor
// on the empirical main sequence, monotone/continuous reference line, parser
// and the shipped Yale BSC bright-star excerpt.
// ==========================================================================

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HR_BENCHMARK,
  SUN_ANCHOR,
  absoluteMagnitude,
  distanceModulus,
  fitDataMainSequence,
  mainSequenceMagnitude,
  mainSequenceSlope,
  parseStarTable,
  runHrBenchmark,
  type StarRecord,
} from '@/plugins/builtin/astro/hrdiagram/kernel';

describe('distance modulus anchors (unified error convention)', () => {
  it('gives M_V = V at exactly 10 pc (π = 0.1″) to < 1e-9', () => {
    const mv = absoluteMagnitude(HR_BENCHMARK.anchor10pc.v, HR_BENCHMARK.anchor10pc.parallax);
    const rel = Math.abs(mv - HR_BENCHMARK.anchor10pc.expectedMv) / Math.abs(HR_BENCHMARK.anchor10pc.expectedMv);
    expect(rel).toBeLessThan(1e-9);
  });

  it('places a V = 0.401 star at the Proxima parallax at M_V ≈ 4.83 within 1e-3', () => {
    const mv = absoluteMagnitude(HR_BENCHMARK.anchorProxima.v, HR_BENCHMARK.anchorProxima.parallax);
    const rel = Math.abs(mv - HR_BENCHMARK.anchorProxima.expectedMv) / Math.abs(HR_BENCHMARK.anchorProxima.expectedMv);
    expect(rel).toBeLessThan(1e-3);
  });

  it('gives M_V = V + 5 at exactly 1 pc (π = 1″) to < 1e-9', () => {
    const mv = absoluteMagnitude(HR_BENCHMARK.anchor1pc.v, HR_BENCHMARK.anchor1pc.parallax);
    expect(Math.abs(mv - HR_BENCHMARK.anchor1pc.expectedMv)).toBeLessThan(1e-9);
  });

  it('distanceModulus(0.1″) = 0 and M_V = V − μ (the two formulas agree)', () => {
    expect(Math.abs(distanceModulus(0.1))).toBeLessThan(1e-9);
    const v = 7.2;
    const plx = 0.42;
    expect(Math.abs(absoluteMagnitude(v, plx) - (v - distanceModulus(plx)))).toBeLessThan(1e-12);
  });

  it('reproduces the published absolute magnitudes of Sirius A and α Cen A', () => {
    // Sirius A: V = −1.46, π = 0.37921″ → M_V ≈ 1.435 (literature 1.43).
    const sirius = absoluteMagnitude(-1.46, 0.37921);
    expect(Math.abs(sirius - 1.43)).toBeLessThan(0.05);
    // α Cen A: V = −0.01, π = 0.74212″ → M_V ≈ 4.34 (literature 4.38).
    const cenA = absoluteMagnitude(-0.01, 0.74212);
    expect(Math.abs(cenA - 4.38)).toBeLessThan(0.05);
  });
});

describe('empirical main-sequence reference', () => {
  it('pins the solar anchor B−V = 0.65 → M_V = 4.83 within 0.05 mag', () => {
    expect(Math.abs(mainSequenceMagnitude(SUN_ANCHOR.bv) - SUN_ANCHOR.mv)).toBeLessThan(0.05);
  });

  it('is strictly decreasing and C0-continuous (embedded benchmark)', () => {
    const b = runHrBenchmark();
    expect(b.err10pc).toBeLessThan(1e-9);
    expect(b.errProxima).toBeLessThan(1e-3);
    expect(b.err1pc).toBeLessThan(1e-9);
    expect(b.sunOnMsDeviation).toBeLessThan(HR_BENCHMARK.sunTolerance);
    expect(b.msMonotonic).toBe(true);
    expect(b.msMaxJump).toBeLessThan(1e-9);
  });

  it('has a physical slope on the 0.3–1.0 colour band (mag per mag of colour)', () => {
    const { slope, n } = mainSequenceSlope(0.3, 1.0);
    expect(n).toBeGreaterThanOrEqual(3);
    expect(slope).toBeGreaterThan(2.5);
    expect(slope).toBeLessThan(7);
  });
});

describe('star-table parser', () => {
  it('maps named columns (name, bv, v, parallax_mas) case-insensitively', () => {
    const text = [
      '# comment',
      'Name,B-V,Vmag,Plx_mas',
      'Sun,0.65,-26.74,NA',
      'Alpha,0.1,1.2,150.5',
      'Beta;0.9;2.5;20',
    ].join('\n');
    const stars = parseStarTable(text);
    expect(stars.length).toBe(3);
    const alpha = stars[1]!;
    expect(alpha.name).toBe('Alpha');
    expect(alpha.bv).toBeCloseTo(0.1, 12);
    expect(alpha.v).toBeCloseTo(1.2, 12);
    expect(alpha.parallax).toBeCloseTo(0.1505, 12); // mas → arcsec
    const beta = stars[2]!;
    expect(beta.name).toBe('Beta');
    expect(beta.parallax).toBeCloseTo(0.02, 12);
  });
});

describe('shipped Yale BSC bright-star excerpt', () => {
  const csv = readFileSync(fileURLToPath(new URL('../examples/data/yale-bsc-bright.csv', import.meta.url)), 'utf8');
  const stars: StarRecord[] = parseStarTable(csv);

  it('contains the expected number of bright stars with sane columns', () => {
    expect(stars.length).toBeGreaterThanOrEqual(150);
    expect(stars.length).toBeLessThanOrEqual(220);
    for (const s of stars) {
      expect(Number.isFinite(s.bv)).toBe(true);
      expect(s.bv).toBeGreaterThan(-0.5);
      expect(s.bv).toBeLessThanOrEqual(1.65);
      expect(s.v).toBeLessThan(3.05);
      expect(s.v).toBeGreaterThan(-2);
    }
    const withPlx = stars.filter((s) => s.parallax != null && s.parallax > 0);
    expect(withPlx.length).toBeGreaterThan(stars.length * 0.9);
  });

  it('fits the membership-screened data main sequence across the full colour range', () => {
    const fit = fitDataMainSequence(stars);
    expect(fit).not.toBeNull();
    expect(fit!.n).toBeGreaterThanOrEqual(5);
    expect(fit!.screenedOut).toBeGreaterThan(0); // giants must be screened out
    expect(fit!.bvMax - fit!.bvMin).toBeGreaterThanOrEqual(0.3);
    // The observed slope must track the empirical reference over the SAME
    // fitted colour span (relative deviation < 30%).
    const ref = mainSequenceSlope(fit!.bvMin, fit!.bvMax);
    expect(Math.abs(fit!.slope - ref.slope) / Math.abs(ref.slope)).toBeLessThan(0.3);
    expect(fit!.rms).toBeLessThan(1.0); // screened MS members scatter ≲ 1 mag
  });
});
