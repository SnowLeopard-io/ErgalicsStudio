import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  VG_SAND_1980,
  benchmarkCapacityDerivative,
  benchmarkParameterRecovery,
  benchmarkRmseConvergence,
  equivalentPoreRadiusCm,
  fitVanGenuchten,
  logSpacedHeads,
  parseRetentionData,
  syntheticRetention,
  vgCapacity,
  vgSe,
  vgTheta,
  type VGParams,
} from '../src/plugins/builtin/geo/soilwater/kernel';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('geo-soilwater · van Genuchten model', () => {
  it('theta(h=0) = theta_s and theta(h) decays toward theta_r', () => {
    expect(vgTheta(0, VG_SAND_1980)).toBeCloseTo(VG_SAND_1980.ths, 12);
    expect(vgTheta(1e7, VG_SAND_1980)).toBeLessThan(VG_SAND_1980.thr + 1e-4);
    expect(vgTheta(100, VG_SAND_1980)).toBeGreaterThan(vgTheta(1000, VG_SAND_1980));
  });

  it('effective saturation Se = (theta - thr)/(ths - thr)', () => {
    for (const h of [1, 10, 100, 1000, 15000]) {
      const se = vgSe(h, VG_SAND_1980);
      const q = (vgTheta(h, VG_SAND_1980) - VG_SAND_1980.thr) / (VG_SAND_1980.ths - VG_SAND_1980.thr);
      expect(Math.abs(se - q)).toBeLessThan(1e-12);
    }
  });

  it('analytic C(h) matches the numerical dtheta/dh to <0.1%', () => {
    for (const h of logSpacedHeads(2, 15000, 15)) {
      const d = Math.max(h, 1) * 1e-5;
      const num = (vgTheta(h + d, VG_SAND_1980) - vgTheta(h - d, VG_SAND_1980)) / (2 * d);
      const ana = vgCapacity(h, VG_SAND_1980);
      expect(Math.abs(Math.abs(num) - ana) / ana).toBeLessThan(1e-3);
    }
  });

  it('Young-Laplace equivalent pore radius r = 0.1486 / h cm', () => {
    expect(equivalentPoreRadiusCm(330)).toBeCloseTo(0.1486 / 330, 12);
    expect(equivalentPoreRadiusCm(-200)).toBeCloseTo(0.1486 / 200, 12);
  });
});

describe('geo-soilwater · parser', () => {
  it('skips comments/header and keeps h,theta rows', () => {
    const pts = parseRetentionData('# lab run\nh,theta\n1,0.42\n100,0.05');
    expect(pts.points).toEqual([
      { h: 1, theta: 0.42 },
      { h: 100, theta: 0.05 },
    ]);
    expect(pts.percentScaled).toBe(false);
  });

  it('rescales percent values and takes |h| for negative heads', () => {
    const pts = parseRetentionData('h,theta\n1,43\n-100,4.6');
    expect(pts.percentScaled).toBe(true);
    expect(pts.points[0]).toEqual({ h: 1, theta: 0.43 });
    expect(pts.points[1]).toEqual({ h: 100, theta: 0.046 });
  });
});

describe('geo-soilwater · Levenberg-Marquardt fit', () => {
  const data = syntheticRetention(VG_SAND_1980, logSpacedHeads(1, 15000, 24), 0.01, 20260922);
  const fit = fitVanGenuchten(data, { init: { thr: 0.05, ths: 0.4, alpha: 0.05, n: 1.8 } })!;

  it('recovers the published sand parameters within 3%', () => {
    expect(fit).not.toBeNull();
    const p: VGParams = fit.params;
    expect(rel(p.thr, VG_SAND_1980.thr)).toBeLessThan(0.03);
    expect(rel(p.ths, VG_SAND_1980.ths)).toBeLessThan(0.03);
    expect(rel(p.alpha, VG_SAND_1980.alpha)).toBeLessThan(0.03);
    expect(rel(p.n, VG_SAND_1980.n)).toBeLessThan(0.03);
  });

  it('RMSE sits at the noise floor and the fit converges', () => {
    expect(fit.rmse).toBeLessThan(0.02);
    expect(fit.converged).toBe(true);
  });

  it('SSE decreases monotonically along the LM history', () => {
    for (let i = 1; i < fit.history.length; i += 1) {
      expect(fit.history[i]!.sse).toBeLessThanOrEqual(fit.history[i - 1]!.sse + 1e-12);
    }
  });

  it('reports finite positive covariance standard errors', () => {
    expect(fit.stderr).not.toBeNull();
    for (const v of [fit.stderr!.thr, fit.stderr!.ths, fit.stderr!.alpha, fit.stderr!.n]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThan(0);
    }
  });

  it('residuals and fitted values are consistent with the reported parameters', () => {
    for (let i = 0; i < data.length; i += 1) {
      const pred = vgTheta(data[i]!.h, fit.params);
      expect(Math.abs(fit.fitted[i]! - pred)).toBeLessThan(1e-9);
      expect(Math.abs(fit.residuals[i]! - (data[i]!.theta - pred))).toBeLessThan(1e-9);
    }
  });

  it('returns null when the data cannot constrain the model', () => {
    expect(fitVanGenuchten([{ h: 1, theta: 0.4 }])).toBeNull();
  });
});

describe('geo-soilwater · shipped example data (vg-sand-retention.csv)', () => {
  const text = readFileSync('examples/data/vg-sand-retention.csv', 'utf8');
  const parsed = parseRetentionData(text);
  const fit = fitVanGenuchten(parsed.points)!;

  it('parses 19 noisy sand points without percent rescaling', () => {
    expect(parsed.points.length).toBe(19);
    expect(parsed.percentScaled).toBe(false);
  });

  it('fits back to the generating parameters within 5%', () => {
    const p = fit.params;
    expect(rel(p.thr, VG_SAND_1980.thr)).toBeLessThan(0.05);
    expect(rel(p.ths, VG_SAND_1980.ths)).toBeLessThan(0.05);
    expect(rel(p.alpha, VG_SAND_1980.alpha)).toBeLessThan(0.05);
    expect(rel(p.n, VG_SAND_1980.n)).toBeLessThan(0.05);
    expect(fit.rmse).toBeLessThan(0.02);
  });
});

describe('geo-soilwater · validation benchmarks', () => {
  it('parameter recovery, C(h) derivative and RMSE convergence all pass', () => {
    expect(benchmarkParameterRecovery().passed).toBe(true);
    expect(benchmarkCapacityDerivative().passed).toBe(true);
    expect(benchmarkRmseConvergence().passed).toBe(true);
  });
});
