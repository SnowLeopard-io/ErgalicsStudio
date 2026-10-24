// ==========================================================================
// Ergalics Studio — logistic regression by IRLS (pure TS, data layer)
//
// Binomial GLM with logit link fitted by iteratively reweighted least squares.
// Reports the Wald coefficient table (z, p, CI), McFadden's pseudo-R² and a
// thresholded confusion matrix. Perfectly separable data is detected via
// diverging coefficients and reported as a non-convergence flag rather than
// silently returning infinities.
// ==========================================================================

import { normalCdf } from '@/core/stats/special';

export interface LogisticCoefficient {
  name: string;
  coef: number;
  se: number;
  z: number;
  p: number;
  ciLow: number;
  ciHigh: number;
}

export interface ConfusionMatrix {
  tp: number;
  tn: number;
  fp: number;
  fn: number;
  accuracy: number;
  precision: number;
  recall: number;
}

export interface LogisticResult {
  coefficients: LogisticCoefficient[];
  beta: number[];
  /** Fitted probabilities. */
  probs: number[];
  iterations: number;
  converged: boolean;
  /** McFadden pseudo-R². */
  pseudoR2: number;
  logLik: number;
  nullLogLik: number;
  confusionAt: (threshold: number) => ConfusionMatrix;
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Bernoulli log-likelihood Σ [y log p + (1−y) log(1−p)] (stable). */
export function bernoulliLogLik(y: number[], p: number[]): number {
  let ll = 0;
  for (let i = 0; i < y.length; i += 1) {
    const pi = Math.min(1 - 1e-12, Math.max(1e-12, p[i]!));
    ll += y[i]! * Math.log(pi) + (1 - y[i]!) * Math.log1p(-pi);
  }
  return ll;
}

export interface LogisticFitOptions {
  maxIter?: number;
  tol?: number;
  /** L2 ridge on coefficients (excluding intercept) for stable fits. */
  ridge?: number;
  names?: string[];
}

/**
 * Fit y ∈ {0,1} against features X (intercept prepended automatically).
 */
export function logisticFit(
  y: number[],
  X: number[][],
  opts: LogisticFitOptions = {},
): LogisticResult {
  const n = y.length;
  const k = X.length === 0 ? 0 : X[0]!.length;
  if (X.length > 0 && X.length !== n) throw new Error('logistic: X row count must match y');
  const p = k + 1;
  const D = X.length === 0
    ? Array.from({ length: n }, () => [1])
    : X.map((row) => [1, ...row]);
  const colNames = ['(Intercept)', ...(opts.names ?? Array.from({ length: k }, (_, i) => `x${i + 1}`))];

  const maxIter = opts.maxIter ?? 50;
  const tol = opts.tol ?? 1e-9;
  const ridge = opts.ridge ?? 0;

  const beta = new Array<number>(p).fill(0);
  let converged = false;
  let iter = 0;

  for (iter = 0; iter < maxIter; iter += 1) {
    const probs = D.map((row) => sigmoid(row.reduce((s, v, j) => s + v * beta[j]!, 0)));
    // Working weights w = p(1−p); IRLS step (XᵀWX + λI)⁻¹ XᵀW z with
    // z = Xβ + (y−p)/w solved as weighted normal equations.
    const XtWX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    const XtWz = new Array<number>(p).fill(0);
    for (let i = 0; i < n; i += 1) {
      const w = Math.max(probs[i]! * (1 - probs[i]!), 1e-10);
      const z = D[i]!.reduce((s, v, j) => s + v * beta[j]!, 0) + (y[i]! - probs[i]!) / w;
      for (let a = 0; a < p; a += 1) {
        XtWz[a]! += D[i]![a]! * w * z;
        for (let b = 0; b < p; b += 1) XtWX[a]![b]! += w * D[i]![a]! * D[i]![b]!;
      }
    }
    if (ridge > 0) {
      for (let a = 1; a < p; a += 1) XtWX[a]![a]! += ridge;
    }
    const step = solveNormal(XtWX, XtWz);
    let delta = 0;
    for (let j = 0; j < p; j += 1) {
      delta += (step[j]! - beta[j]!) ** 2;
      beta[j] = step[j]!;
    }
    if (Math.sqrt(delta) < tol) {
      converged = true;
      iter += 1;
      break;
    }
  }

  const probs = D.map((row) => sigmoid(row.reduce((s, v, j) => s + v * beta[j]!, 0)));
  const logLik = bernoulliLogLik(y, probs);
  const pNull = y.reduce((a, b) => a + b, 0) / n;
  const nullLogLik = bernoulliLogLik(y, y.map(() => pNull));

  // Covariance (XᵀWX)⁻¹ at the final estimate.
  const XtWX = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < n; i += 1) {
    const w = Math.max(probs[i]! * (1 - probs[i]!), 1e-10);
    for (let a = 0; a < p; a += 1) {
      for (let b = 0; b < p; b += 1) XtWX[a]![b]! += w * D[i]![a]! * D[i]![b]!;
    }
  }
  const cov = invert(XtWX);

  const coefficients: LogisticCoefficient[] = beta.map((coef, j) => {
    const se = Math.sqrt(Math.max(cov[j]![j]!, 0));
    const z = se > 0 ? coef / se : 0;
    const pval = 2 * (1 - normalCdf(Math.abs(z)));
    return {
      name: colNames[j]!,
      coef,
      se,
      z,
      p: Math.min(1, Math.max(0, pval)),
      ciLow: coef - 1.96 * se,
      ciHigh: coef + 1.96 * se,
    };
  });

  const confusionAt = (threshold: number): ConfusionMatrix => {
    let tp = 0;
    let tn = 0;
    let fp = 0;
    let fn = 0;
    for (let i = 0; i < n; i += 1) {
      const pred = probs[i]! >= threshold ? 1 : 0;
      if (pred === 1 && y[i] === 1) tp += 1;
      else if (pred === 0 && y[i] === 0) tn += 1;
      else if (pred === 1) fp += 1;
      else fn += 1;
    }
    return {
      tp,
      tn,
      fp,
      fn,
      accuracy: (tp + tn) / n,
      precision: tp + fp > 0 ? tp / (tp + fp) : NaN,
      recall: tp + fn > 0 ? tp / (tp + fn) : NaN,
    };
  };

  return {
    coefficients,
    beta,
    probs,
    iterations: iter,
    converged,
    pseudoR2: 1 - logLik / nullLogLik,
    logLik,
    nullLogLik,
    confusionAt,
  };
}

// Gaussian elimination with partial pivot (small systems).
function solveNormal(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];
    const d = M[col]![col]! || 1e-15;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      for (let c = col; c <= n; c += 1) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return M.map((row, i) => row[n]! / (row[i]! || 1e-15));
}

function invert(A: number[][]): number[][] {
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
      for (let j = 0; j < 2 * n; j += 1) M[r]![j]! -= f * M[col]![j]!;
    }
  }
  return M.map((row) => row.slice(n));
}
