// ==========================================================================
// Ergalics Studio — univariate polynomial regression (pure TS, data layer)
//
// Builds a raw-power Vandermonde design (degrees 1–6) and solves through the
// QR-based OLS path. Degree ≤ 6 on centred x keeps the design acceptably
// conditioned (the caller centres the predictor; polyFit does this
// internally and returns the predictor centre so predictions stay exact).
// ==========================================================================

import { ols, type OlsResult } from './ols';

export interface PolyResult {
  degree: number;
  /** Coefficients ascending in power of (x − centre), including intercept. */
  beta: number[];
  centre: number;
  ols: OlsResult;
  predict: (x: number) => number;
}

/**
 * Fit y = Σ β_j (x − centre)^j, j = 0 … degree, with degree ∈ [1, 6].
 */
export function polyFit(x: number[], y: number[], degree = 2): PolyResult {
  if (x.length !== y.length) throw new Error('polyFit: x and y length differ');
  if (!Number.isInteger(degree) || degree < 1 || degree > 6) {
    throw new Error('polyFit: degree must be an integer in [1,6]');
  }
  const centre = x.reduce((a, b) => a + b, 0) / x.length;
  const X = x.map((v) => {
    const row: number[] = [];
    let u = v - centre;
    let uj = u;
    for (let j = 1; j <= degree; j += 1) {
      row.push(uj);
      uj *= u;
    }
    return row;
  });
  const names = Array.from({ length: degree }, (_, j) => `x^${j + 1}`);
  const fit = ols(y, X, names);
  const beta = fit.beta;
  const predict = (xv: number): number => {
    const u = xv - centre;
    let v = 1;
    let s = 0;
    for (let j = 0; j < beta.length; j += 1) {
      s += beta[j]! * v;
      v *= u;
    }
    return s;
  };
  return { degree, beta, centre, ols: fit, predict };
}
