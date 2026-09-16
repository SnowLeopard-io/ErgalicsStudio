// ==========================================================================
// Ergalics Studio — ordinary least-squares regression (pure TS, data layer)
//
// Solved via the Householder QR in linalg.ts (normal-equation-free, so
// near-collinear designs stay numerically sound). Produces the full
// publication table: coefficient estimates, SEs, t statistics, two-sided
// p-values, 95% CIs, plus R²/adj-R², fitted values, residuals, internally
// studentised residuals, leverage (hat diagonals) and Cook's distance.
// ==========================================================================

import { lstsqQR, transpose, matmul, type Matrix } from './linalg';
import {
  studentTCdf,
  studentTInv,
  regularizedIncompleteBeta as betaI,
} from '@/core/stats/special';

export interface OlsCoefficient {
  name: string;
  coef: number;
  se: number;
  t: number;
  p: number;
  ciLow: number;
  ciHigh: number;
}

export interface OlsResult {
  coefficients: OlsCoefficient[];
  /** Raw vector in design-column order (first entry = intercept). */
  beta: number[];
  fitted: number[];
  residuals: number[];
  /** Internally studentised residuals. */
  stdResiduals: number[];
  /** Hat-matrix diagonals (leverage). */
  leverage: number[];
  /** Cook's distance per observation. */
  cooksD: number[];
  r2: number;
  adjR2: number;
  /** Residual standard error (σ̂ = √(SSE/(n−p))). */
  sigma: number;
  /** F-statistic for the global slope test. */
  f: number;
  fP: number;
  n: number;
  p: number;
  df: number;
}

function fCdf(x: number, d1: number, d2: number): number {
  // F → regularized incomplete beta (stats kernel convention).
  const b = (d2 / (d2 + d1 * x));
  return 1 - betaI(b, d2 / 2, d1 / 2);
}

// Local wrapper around the kernel's regularized incomplete beta (kept here
// so model code does not depend on the internal function name across files).
import { regularizedIncompleteBeta as betaI } from '@/core/stats/special';

/**
 * OLS with an intercept column prepended automatically.
 *
 * @param y response, length n
 * @param X design without intercept (n × k); pass [] for an intercept-only model
 * @param names optional feature names (intercept named '(Intercept)')
 */
export function ols(y: number[], X: Matrix, names?: string[]): OlsResult {
  const n = y.length;
  if (n < 3) throw new Error('OLS needs at least 3 observations');
  const k = X.length === 0 ? 0 : X[0]!.length;
  if (X.length > 0 && X.length !== n) throw new Error('OLS: X row count must match y');
  const p = k + 1;
  if (n <= p) throw new Error('OLS: need more observations than parameters');

  const D: Matrix = X.length === 0
    ? Array.from({ length: n }, () => [1])
    : X.map((row) => [1, ...row]);
  const colNames = ['(Intercept)', ...(names ?? Array.from({ length: k }, (_, i) => `x${i + 1}`))];

  const { beta, R } = lstsqQR(D, y);
  const fitted = D.map((row) => row.reduce((s, v, j) => s + v * beta[j]!, 0));
  const resid = y.map((v, i) => v - fitted[i]!);
  let sse = 0;
  let tss = 0;
  const ybar = y.reduce((a, b) => a + b, 0) / n;
  for (let i = 0; i < n; i += 1) {
    sse += resid[i]! ** 2;
    tss += (y[i]! - ybar) ** 2;
  }
  const df = n - p;
  const sigma2 = sse / df;
  const sigma = Math.sqrt(sigma2);
  const r2 = tss > 0 ? 1 - sse / tss : NaN;
  const adjR2 = tss > 0 ? 1 - (1 - r2) * ((n - 1) / df) : NaN;

  // Covariance β̂ = σ² (RᵀR)⁻¹. With thin R from QR, (RᵀR)⁻¹ = R⁻¹ R⁻ᵀ.
  const pR = R;
  const RtR = matmul(transpose(pR), pR);
  const cov = invertMatrix(RtR);
  const tcrit = Math.abs(studentTInv(0.975, df));

  const coefficients: OlsCoefficient[] = beta.map((coef, j) => {
    const se = Math.sqrt(Math.max(sigma2 * cov[j]![j]!, 0));
    const t = se > 0 ? coef / se : 0;
    const pval = 2 * (1 - studentTCdf(Math.abs(t), df));
    return {
      name: colNames[j]!,
      coef,
      se,
      t,
      p: Math.min(1, Math.max(0, pval)),
      ciLow: coef - tcrit * se,
      ciHigh: coef + tcrit * se,
    };
  });

  // Hat matrix H = D (DᵀD)⁻¹ Dᵀ; diagonals h_ii = row_i (DᵀD)⁻¹ row_iᵀ.
  const XtX = matmul(transpose(D), D);
  const XtXinv = invertMatrix(XtX);
  const leverage = new Array<number>(n);
  const stdResiduals = new Array<number>(n);
  const cooksD = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    let h = 0;
    for (let a = 0; a < p; a += 1) {
      for (let b = 0; b < p; b += 1) h += D[i]![a]! * XtXinv[a]![b]! * D[i]![b]!;
    }
    leverage[i] = h;
    const denom = sigma * Math.sqrt(Math.max(1 - h, 1e-12));
    stdResiduals[i] = denom > 0 ? resid[i]! / denom : 0;
    cooksD[i] = (h / Math.max(1 - h, 1e-12)) * (stdResiduals[i]! ** 2) / p;
  }

  // Global F: (TSS−SSE)/k over SSE/(n−p); intercept-only k = 0 → NaN.
  let f = NaN;
  let fP = NaN;
  if (k > 0) {
    f = ((tss - sse) / k) / (sse / df);
    fP = 1 - fCdf(f, k, df);
  }

  return {
    coefficients, beta, fitted, residuals: resid, stdResiduals, leverage, cooksD,
    r2, adjR2, sigma, f, fP, n, p, df,
  };
}

// ---- local numeric helper -------------------------------------------------

/** Invert a small dense matrix via Gauss–Jordan (covariance matrices, p ≤ ~30). */
export function invertMatrix(A: Matrix): Matrix {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    const d = M[col]![col]! || 1e-15;
    for (let j = 0; j < 2 * n; j += 1) M[col]![j] = M[col]![j]! / d;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r]![col]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) M[r]![j]! -= f * M[col]![j]!;
    }
  }
  return M.map((row) => row.slice(n));
}
