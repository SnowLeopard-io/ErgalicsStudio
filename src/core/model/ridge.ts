// ==========================================================================
// Ergalics Studio — ridge regression with K-fold CV (pure TS, data layer)
//
// Features are centred and standardised before fitting so a single λ applies
// to every slope; the intercept is left unpenalised and reported on the
// original response scale. λ is chosen by K-fold cross-validation over a
// log-spaced grid (deterministic fold assignment from a seed).
// ==========================================================================

import type { Matrix } from './linalg';
import { transpose, matmul } from './linalg';

export interface RidgeResult {
  /** Coefficients on the standardised design, intercept first. */
  beta: number[];
  /** Per-feature centring/scale used (for prediction consistency). */
  means: number[];
  scales: number[];
  yMean: number;
  lambda: number;
  /** Validation RMSE per grid λ (in response units). */
  cvPath: { lambda: number; rmse: number }[];
  fitted: number[];
}

/** Solve (A + λI) x = b for small SPD A via Cholesky; intercept row (index 0) unpenalised. */
function solveRidge(A: Matrix, b: number[], lambda: number): number[] {
  const n = A.length;
  const M = A.map((row) => row.slice());
  for (let i = 1; i < n; i += 1) M[i]![i]! += lambda;
  // Cholesky.
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = M[i]![j]!;
      for (let k = 0; k < j; k += 1) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) L[i]![j] = Math.sqrt(Math.max(s, 1e-18));
      else L[i]![j] = s / L[j]![j]!;
    }
  }
  const y = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let s = b[i]!;
    for (let k = 0; k < i; k += 1) s -= L[i]![k]! * y[k]!;
    y[i] = s / L[i]![i]!;
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k += 1) s -= L[k]![i]! * x[k]!;
    x[i] = s / L[i]![i]!;
  }
  return x;
}

export interface RidgeOptions {
  lambdas?: number[];
  folds?: number;
  seed?: number;
}

/**
 * Ridge regression with K-fold CV over λ. `X` excludes the intercept.
 */
export function ridgeCV(y: number[], X: Matrix, opts: RidgeOptions = {}): RidgeResult {
  const n = y.length;
  const k = X[0]?.length ?? 0;
  if (n < 6) throw new Error('ridge: need at least 6 observations for CV');
  if (X.length > 0 && X.length !== n) throw new Error('ridge: X row count must match y');

  const means = new Array<number>(k).fill(0);
  const scales = new Array<number>(k).fill(1);
  for (let j = 0; j < k; j += 1) {
    let m = 0;
    for (let i = 0; i < n; i += 1) m += X[i]![j]!;
    m /= n;
    means[j] = m;
    let v = 0;
    for (let i = 0; i < n; i += 1) v += (X[i]![j]! - m) ** 2;
    scales[j] = Math.sqrt(v / n) || 1;
  }
  const yMean = y.reduce((a, b) => a + b, 0) / n;
  const Z: Matrix = X.map((row) => row.map((v, j) => (v - means[j]!) / scales[j]!));
  const yc = y.map((v) => v - yMean);

  const folds = Math.min(opts.folds ?? 5, n);
  const seed = opts.seed ?? 1;
  // Deterministic permuted fold assignment (LCG).
  const order = Array.from({ length: n }, (_, i) => i);
  let s = seed >>> 0;
  for (let i = n - 1; i > 0; i -= 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  const foldOf = new Array<number>(n);
  order.forEach((idx, pos) => {
    foldOf[idx] = pos % folds;
  });

  const grid = opts.lambdas ?? [0, 1e-4, 1e-3, 1e-2, 0.1, 1, 10, 100];
  const cvPath = grid.map((lambda) => {
    let sse = 0;
    let cnt = 0;
    for (let f = 0; f < folds; f += 1) {
      const trRows: number[] = [];
      const teRows: number[] = [];
      for (let i = 0; i < n; i += 1) (foldOf[i] === f ? teRows : trRows).push(i);
      const A = Array.from({ length: k + 1 }, () => new Array<number>(k + 1).fill(0));
      const b = new Array<number>(k + 1).fill(0);
      for (const i of trRows) {
        const d = [1, ...Z[i]!];
        for (let a = 0; a <= k; a += 1) {
          b[a]! += d[a]! * yc[i]!;
          for (let c = 0; c <= k; c += 1) A[a]![c]! += d[a]! * d[c]!;
        }
      }
      const beta = solveRidge(A, b, lambda);
      for (const i of teRows) {
        const pred = beta[0]! + Z[i]!.reduce((sum, z, j) => sum + z * beta[j + 1]!, 0);
        sse += (yc[i]! - pred) ** 2;
        cnt += 1;
      }
    }
    return { lambda, rmse: Math.sqrt(sse / Math.max(cnt, 1)) };
  });

  let best = cvPath[0]!;
  for (const cand of cvPath) {
    if (cand.rmse < best.rmse) best = cand;
  }

  // Full-data fit at the chosen λ.
  const XtX = matmul(transpose(Z.map((row) => [1, ...row])), Z.map((row) => [1, ...row]));
  const Xty = new Array<number>(k + 1).fill(0);
  Z.forEach((row, i) => {
    const d = [1, ...row];
    for (let a = 0; a <= k; a += 1) Xty[a]! += d[a]! * yc[i]!;
  });
  const beta = solveRidge(XtX, Xty, best.lambda);
  const fitted = Z.map((row) => yMean + beta[0]! + row.reduce((sum, z, j) => sum + z * beta[j + 1]!, 0));

  return { beta, means, scales, yMean, lambda: best.lambda, cvPath, fitted };
}

/** Predict at new feature rows using the stored standardisation. */
export function predictRidge(model: RidgeResult, rows: Matrix): number[] {
  return rows.map((row) => {
    const z = row.map((v, j) => (v - model.means[j]!) / model.scales[j]!);
    return model.yMean + model.beta[0]! + z.reduce((s, v, j) => s + v * model.beta[j + 1]!, 0);
  });
}
