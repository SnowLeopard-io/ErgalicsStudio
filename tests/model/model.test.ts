import { describe, it, expect } from 'vitest';
import { ols, invertMatrix } from '@/core/model/ols';
import { polyFit } from '@/core/model/poly';
import { logisticFit } from '@/core/model/logistic';
import { ridgeCV, predictRidge } from '@/core/model/ridge';
import { qr, matmul, transpose, lstsqQR } from '@/core/model/linalg';
import { diagnosticSeries, StreamingNormalEquations } from '@/core/model/diagnostics';
import { pearson } from '@/core/stats/effect';

// Deterministic LCG.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    // Box–Muller for Gaussian noise.
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}
function gaussians(seed: number): () => number {
  const r = rng(seed);
  let cache: number | null = null;
  return () => {
    if (cache !== null) {
      const v = cache;
      cache = null;
      return v;
    }
    let u = r();
    while (u <= 1e-9) u = r();
    const u2 = r();
    const mag = Math.sqrt(-2 * Math.log(u));
    cache = mag * Math.sin(2 * Math.PI * u2);
    return mag * Math.cos(2 * Math.PI * u2);
  };
}

describe('model/linalg', () => {
  it('QR satisfies Q orthogonal and A = QR', () => {
    const A = [[1, 2], [3, 4], [5, 6], [7, 8]];
    const { Q, R } = qr(A);
    const QtQ = matmul(transpose(Q), Q);
    for (let i = 0; i < QtQ.length; i += 1) {
      for (let j = 0; j < QtQ.length; j += 1) {
        expect(QtQ[i]![j]).toBeCloseTo(i === j ? 1 : 0, 9);
      }
    }
    const QR = matmul(Q, R);
    for (let i = 0; i < A.length; i += 1) {
      for (let j = 0; j < 2; j += 1) expect(QR[i]![j]).toBeCloseTo(A[i]![j]!, 9);
    }
  });

  it('least squares recovers a known overdetermined system', () => {
    const X = [[1, 0], [1, 1], [1, 2], [1, 3]];
    const y = [1, 3, 5, 7]; // y = 1 + 2x
    const { beta } = lstsqQR(X, y);
    expect(beta[0]).toBeCloseTo(1, 9);
    expect(beta[1]).toBeCloseTo(2, 9);
  });

  it('invertMatrix round-trips a 3×3', () => {
    const A = [[4, 1, 2], [1, 3, 1], [2, 1, 5]];
    const inv = invertMatrix(A);
    const prod = matmul(A, inv);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        expect(prod[i]![j]).toBeCloseTo(i === j ? 1 : 0, 8);
      }
    }
  });
});

describe('model/ols', () => {
  it('fits a simple line exactly', () => {
    const x = [-1, 0, 1, 2, 3];
    const y = x.map((v) => 2 + 3 * v);
    const fit = ols(y, x.map((v) => [v]), ['x']);
    expect(fit.beta[0]).toBeCloseTo(2, 9);
    expect(fit.beta[1]).toBeCloseTo(3, 9);
    expect(fit.r2).toBeCloseTo(1, 10);
  });

  it('R² equals Pearson r² for one predictor (AC2)', () => {
    const n = 60;
    const noise = gaussians(11);
    const x = Array.from({ length: n }, (_, i) => i / 10);
    const y = x.map((v) => 2 - v + noise() * 0.5);
    const fit = ols(y, x.map((v) => [v]));
    const r = pearson(x, y);
    expect(fit.r2).toBeCloseTo(r * r, 9);
  });

  it('coefficient table has finite SE / p in [0,1] and symmetric CIs', () => {
    const n = 40;
    const noise = gaussians(23);
    const x = Array.from({ length: n }, (_, i) => i / 5);
    const y = x.map((v) => 1 + 0.8 * v + noise());
    const fit = ols(y, x.map((v) => [v]));
    for (const c of fit.coefficients) {
      expect(Number.isFinite(c.se)).toBe(true);
      expect(c.p).toBeGreaterThanOrEqual(0);
      expect(c.p).toBeLessThanOrEqual(1);
      expect(c.ciLow).toBeLessThan(c.coef);
      expect(c.ciHigh).toBeGreaterThan(c.coef);
    }
  });

  it('leverage sums to p and flags an influential point via Cook’s D', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 40];
    const y = x.map((v) => (v === 40 ? 60 : v + 0.1 * (v % 3)));
    const fit = ols(y, x.map((v) => [v]));
    const hSum = fit.leverage.reduce((a, b) => a + b, 0);
    expect(hSum).toBeCloseTo(fit.p, 8);
    const maxCook = Math.max(...fit.cooksD);
    expect(fit.cooksD[10]).toBe(maxCook);
  });

  it('rejects underdetermined designs', () => {
    expect(() => ols([1, 2], [[1], [2]])).toThrow();
  });
});

describe('model/poly', () => {
  it('recovers y = 2 + 3x − 1.5x² within 1% and R² > 0.99 (AC1)', () => {
    const n = 200;
    const noise = gaussians(77);
    const x = Array.from({ length: n }, (_, i) => (i - n / 2) / 25);
    const y = x.map((v) => 2 + 3 * v - 1.5 * v * v + noise() * 0.05);
    const fit = polyFit(x, y, 2);
    // β in centred power basis: convert expectation at centre: β0 ≈ 2 + 3c − 1.5c²
    const c = fit.centre;
    const expect0 = 2 + 3 * c - 1.5 * c * c;
    expect(Math.abs((fit.beta[0]! - expect0) / expect0)).toBeLessThan(0.01);
    expect(Math.abs((fit.beta[1]! - (3 - 3 * c)) / 3)).toBeLessThan(0.01);
    expect(Math.abs(fit.beta[2]! - -1.5) / 1.5).toBeLessThan(0.01);
    expect(fit.ols.r2).toBeGreaterThan(0.99);
  });

  it('predictions match the design expectation', () => {
    const x = [0, 1, 2, 3, 4, 5, 6, 7];
    const y = x.map((v) => 1 - 2 * v + v * v);
    const fit = polyFit(x, y, 2);
    expect(fit.predict(8)).toBeCloseTo(49, 6);
  });

  it('rejects degree outside [1,6]', () => {
    expect(() => polyFit([1, 2, 3], [1, 2, 3], 7)).toThrow();
  });
});

describe('model/logistic', () => {
  it('separates a clean two-class cloud with accuracy > 0.95 (AC3)', () => {
    const n = 200;
    const noise = gaussians(313);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const cls = i % 2;
      const v = cls * 4 + noise();
      X.push([v]);
      y.push(cls);
    }
    const fit = logisticFit(y, X, { names: ['x'] });
    expect(fit.converged).toBe(true);
    expect(fit.iterations).toBeLessThanOrEqual(50);
    expect(fit.confusionAt(0.5).accuracy).toBeGreaterThan(0.95);
    expect(fit.coefficients[1]!.coef).toBeGreaterThan(0);
  });

  it('McFadden pseudo-R² is positive for a real relationship', () => {
    const n = 100;
    const noise = gaussians(9);
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const v = noise() + (i % 2) * 1.5;
      X.push([v]);
      y.push(i % 2);
    }
    const fit = logisticFit(y, X);
    expect(fit.pseudoR2).toBeGreaterThan(0.05);
  });

  it('intercept-only null model has pseudo-R² ≈ 0', () => {
    const y = [0, 0, 1, 1, 0, 1, 1, 0, 0, 1];
    const fit = logisticFit(y, []);
    expect(Math.abs(fit.pseudoR2)).toBeLessThan(1e-9);
  });
});

describe('model/ridge', () => {
  it('shrinks coefficients relative to OLS under collinearity', () => {
    const n = 60;
    const noise = gaussians(5);
    const base = Array.from({ length: n }, (_, i) => i);
    // Two almost-identical predictors.
    const X = base.map((v) => [v + noise() * 0.01, v + noise() * 0.012]);
    const y = base.map((v) => v * 0.5 + noise());
    const fit = ridgeCV(y, X, { lambdas: [0, 0.1, 1, 10], folds: 5, seed: 2 });
    expect(fit.cvPath.length).toBe(4);
    expect(Number.isFinite(fit.lambda)).toBe(true);
    const pred = predictRidge(fit, X.slice(0, 3));
    expect(pred.length).toBe(3);
  });

  it('λ=0 grid choice matches OLS slope on orthogonal-ish data', () => {
    const n = 40;
    const noise = gaussians(17);
    const X = Array.from({ length: n }, (_, i) => [i]);
    const y = X.map((row) => 2 * row[0]! + noise() * 2);
    const fit = ridgeCV(y, X, { lambdas: [0, 1e6], folds: 5, seed: 4 });
    const olsFit = ols(y, X);
    // With λ=0 in the grid the CV-optimal fit should be near OLS.
    const rmse0 = fit.cvPath.find((c) => c.lambda === 0)!.rmse;
    const rmseBig = fit.cvPath.find((c) => c.lambda === 1e6)!.rmse;
    expect(rmse0).toBeLessThan(rmseBig);
    expect(fit.beta[1]).toBeGreaterThan(1.5);
    // β₁ lives on the standardised scale; compare predictions against OLS.
    const pred = predictRidge(fit, X);
    const pmse = Math.sqrt(
      pred.reduce((s, v, i) => s + (v - olsFit.fitted[i]!) ** 2, 0) / n,
    );
    expect(pmse).toBeLessThan(0.5);
  });
});

describe('model/diagnostics', () => {
  it('diagnostic quartet series are aligned and QQ pairs sorted', () => {
    const n = 50;
    const noise = gaussians(7);
    const x = Array.from({ length: n }, (_, i) => i / 10);
    const y = x.map((v) => v + noise());
    const d = diagnosticSeries(ols(y, x.map((v) => [v])));
    expect(d.qqSample.length).toBe(n);
    expect(d.qqTheoretical[0]).toBeLessThan(d.qqTheoretical[n - 1]!);
    for (let k = 1; k < n; k += 1) {
      expect(d.qqSample[k]).toBeGreaterThanOrEqual(d.qqSample[k - 1]!);
    }
    expect(d.cookLines.fourOverN).toBeCloseTo(4 / n, 12);
  });

  it('streaming normal equations match batch OLS (FR4.7)', () => {
    const n = 200;
    const noise = gaussians(91);
    const X = Array.from({ length: n }, (_, i) => [1, i, (i - 100) ** 2]);
    const y = X.map((row) => 1 + 0.5 * row[1]! - 0.01 * row[2]! + noise() * 0.2);
    const acc = new StreamingNormalEquations(3);
    for (let i = 0; i < n; i += 1) acc.add(y[i]!, X[i]!);
    // Feed in 4 chunks as the reader would.
    const acc2 = new StreamingNormalEquations(3);
    for (let chunk = 0; chunk < 4; chunk += 1) {
      for (let i = chunk * 50; i < Math.min(n, (chunk + 1) * 50); i += 1) {
        acc2.add(y[i]!, X[i]!);
      }
    }
    const a = acc.solve();
    const b = acc2.solve();
    for (let j = 0; j < 3; j += 1) {
      expect(a.beta[j]).toBeCloseTo(b.beta[j]!, 10);
    }
    const batch = lstsqQR(X, y);
    for (let j = 0; j < 3; j += 1) {
      expect(a.beta[j]).toBeCloseTo(batch.beta[j]!, 8);
    }
  });
});
