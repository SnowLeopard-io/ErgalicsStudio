// ==========================================================================
// Ergalics Studio — numerics: dense linear-algebra kernels
//
// Small, dependency-free building blocks shared by the ODE, optimisation,
// root-finding and sparse modules: LU with partial pivoting, Householder QR
// least squares, the Thomas algorithm for tridiagonal systems and a few
// vector helpers. All routines throw `NumericsError` on structurally bad
// input instead of silently returning garbage.
// ==========================================================================

import { NumericsError, assertFinite } from './errors';

/** Dot product of two equally sized vectors. */
export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

/** Euclidean (2) norm. */
export function norm2(v: ArrayLike<number>): number {
  return Math.sqrt(dot(v, v));
}

/** Maximum (infinity) norm. */
export function normInf(v: ArrayLike<number>): number {
  let m = 0;
  for (let i = 0; i < v.length; i++) m = Math.max(m, Math.abs(v[i]!));
  return m;
}

// ---------------------------------------------------------------------------
// LU factorisation with partial pivoting
// ---------------------------------------------------------------------------

export interface LUFactor {
  /** Factorised matrix: strictly lower part = L (unit diagonal implied), upper part = U. */
  lu: number[][];
  /** Row permutation: row i of the factorisation came from original row `piv[i]`. */
  piv: number[];
}

/**
 * In-place-free LU factorisation with partial pivoting.
 * Throws `numerics/singular` on an (near-)zero pivot.
 */
export function luFactor(A: number[][]): LUFactor {
  const n = A.length;
  const lu: number[][] = A.map((row) => row.slice());
  const piv: number[] = new Array<number>(n);
  for (let i = 0; i < n; i++) piv[i] = i;

  for (let k = 0; k < n; k++) {
    // Pivot: largest magnitude in column k at or below row k.
    let p = k;
    let pmax = Math.abs(lu[k]![k]!);
    for (let i = k + 1; i < n; i++) {
      const v = Math.abs(lu[i]![k]!);
      if (v > pmax) {
        pmax = v;
        p = i;
      }
    }
    if (pmax === 0 || !Number.isFinite(pmax)) {
      throw new NumericsError('numerics/singular', `LU factorisation: zero pivot at column ${k}`, { column: k });
    }
    if (p !== k) {
      const tmp = lu[p]!;
      lu[p] = lu[k]!;
      lu[k] = tmp;
      const tp = piv[p]!;
      piv[p] = piv[k]!;
      piv[k] = tp;
    }
    const pivot = lu[k]![k]!;
    for (let i = k + 1; i < n; i++) {
      const row = lu[i]!;
      const m = row[k]! / pivot;
      row[k] = m;
      if (m !== 0) {
        const prow = lu[k]!;
        for (let j = k + 1; j < n; j++) row[j] = row[j]! - m * prow[j]!;
      }
    }
  }
  return { lu, piv };
}

/** Solve `A x = b` using a factorisation produced by `luFactor`. */
export function luSolve(f: LUFactor, b: ArrayLike<number>): number[] {
  const n = f.lu.length;
  assertFinite(b, 'luSolve rhs');
  const x = new Array<number>(n);
  for (let i = 0; i < n; i++) x[i] = b[f.piv[i]!]!;
  // Forward substitution (unit lower triangular).
  for (let i = 1; i < n; i++) {
    let s = x[i]!;
    const row = f.lu[i]!;
    for (let j = 0; j < i; j++) s -= row[j]! * x[j]!;
    x[i] = s;
  }
  // Back substitution.
  for (let i = n - 1; i >= 0; i--) {
    let s = x[i]!;
    const row = f.lu[i]!;
    for (let j = i + 1; j < n; j++) s -= row[j]! * x[j]!;
    x[i] = s / row[i]!;
  }
  return x;
}

/** One-shot dense solve of `A x = b` (square A). Throws on singular A. */
export function solveLinear(A: number[][], b: ArrayLike<number>): number[] {
  if (A.length !== b.length) {
    throw new NumericsError('numerics/shape-mismatch', `solveLinear: A is ${A.length}x? but b has ${b.length} entries`);
  }
  return luSolve(luFactor(A), b);
}

// ---------------------------------------------------------------------------
// Householder QR least squares (min ||A x - b||_2)
// ---------------------------------------------------------------------------

export interface QRResult {
  /** Least-squares solution x (null-free even for rank-deficient A: minimum-residual basic solution). */
  x: number[];
  /** True if a diagonal entry of R was numerically negligible (rank < n). */
  rankDeficient: boolean;
}

/**
 * Solve min ||A x - b||_2 with Householder transformations applied to the
 * augmented [A | b]. Columns whose R diagonal falls below
 * `rankTol * maxDiag` are treated as zero (their unknown is set to 0).
 */
export function qrSolve(A: number[][], b: ArrayLike<number>, rankTol = 1e-11): QRResult {
  const m = A.length;
  const n = m > 0 ? A[0]!.length : 0;
  if (m < n) {
    throw new NumericsError('numerics/invalid-input', `qrSolve needs m >= n (got ${m}x${n})`);
  }
  assertFinite(b, 'qrSolve rhs');
  // Work matrix: columns of R stored transposed for cache-friendly access,
  // plus the transformed rhs as an extra column.
  const w: number[][] = [];
  for (let j = 0; j < n; j++) {
    const col = new Array<number>(m);
    for (let i = 0; i < m; i++) col[i] = A[i]![j]!;
    w.push(col);
  }
  const rhs = Array.from(b, (v) => v);
  // Signed R diagonal per column: the reflector maps a to -alphaSigned * e1.
  const rDiag: number[] = new Array<number>(n).fill(0);

  for (let k = 0; k < n; k++) {
    // Norm of the active part of column k.
    let sigma = 0;
    for (let i = k; i < m; i++) sigma += w[k]![i]! * w[k]![i]!;
    const alpha = Math.sqrt(sigma);
    if (alpha === 0) continue;
    const v0 = w[k]![k]!;
    const alphaSigned = v0 >= 0 ? alpha : -alpha;
    rDiag[k] = -alphaSigned;
    // Householder vector v (stored implicitly): v[k] = v0 + alphaSigned.
    const vk = v0 + alphaSigned;
    w[k]![k] = vk;
    let vNorm2 = vk * vk;
    for (let i = k + 1; i < m; i++) vNorm2 += w[k]![i]! * w[k]![i]!;
    if (vNorm2 === 0) continue;
    const beta = 2 / vNorm2;
    // Apply to remaining columns.
    for (let j = k + 1; j < n; j++) {
      const col = w[j]!;
      let s = 0;
      for (let i = k; i < m; i++) s += w[k]![i]! * col[i]!;
      const f = beta * s;
      for (let i = k; i < m; i++) col[i] = col[i]! - f * w[k]![i]!;
    }
    // Apply to rhs.
    let s = 0;
    for (let i = k; i < m; i++) s += w[k]![i]! * rhs[i]!;
    const f = beta * s;
    for (let i = k; i < m; i++) rhs[i] = rhs[i]! - f * w[k]![i]!;
  }

  const diag: number[] = new Array<number>(n);
  let maxDiag = 0;
  for (let k = 0; k < n; k++) {
    diag[k] = Math.abs(rDiag[k]!);
    maxDiag = Math.max(maxDiag, diag[k]!);
  }
  const x = new Array<number>(n).fill(0);
  let rankDeficient = false;
  for (let k = n - 1; k >= 0; k--) {
    if (diag[k]! <= rankTol * maxDiag) {
      rankDeficient = true;
      x[k] = 0;
      continue;
    }
    let s = rhs[k]!;
    for (let j = k + 1; j < n; j++) s -= w[j]![k]! * x[j]!;
    x[k] = s / rDiag[k]!;
  }
  return { x, rankDeficient };
}

// ---------------------------------------------------------------------------
// Thomas algorithm for tridiagonal systems
// ---------------------------------------------------------------------------

/**
 * Solve a tridiagonal system given by sub-diagonal `a`, diagonal `b`,
 * super-diagonal `c` (length n, n, n; `a[0]` and `c[n-1]` unused) and rhs `d`.
 * Not pivoting — the caller must supply a diagonally dominant or otherwise
 * well-behaved tridiagonal matrix (spline systems always are).
 */
export function thomas(a: number[], b: number[], c: number[], d: number[]): number[] {
  const n = b.length;
  if (n === 0) return [];
  assertFinite(b, 'thomas diagonal');
  const cp = new Array<number>(n).fill(0);
  const dp = new Array<number>(n).fill(0);
  let beta = b[0]!;
  if (beta === 0) throw new NumericsError('numerics/singular', 'thomas: zero leading diagonal');
  cp[0] = c[0]! / beta;
  dp[0] = d[0]! / beta;
  for (let i = 1; i < n; i++) {
    beta = b[i]! - a[i]! * cp[i - 1]!;
    if (beta === 0) throw new NumericsError('numerics/singular', `thomas: zero pivot at row ${i}`);
    cp[i] = i < n - 1 ? c[i]! / beta : 0;
    dp[i] = (d[i]! - a[i]! * dp[i - 1]!) / beta;
  }
  const x = new Array<number>(n).fill(0);
  x[n - 1] = dp[n - 1]!;
  for (let i = n - 2; i >= 0; i--) x[i] = dp[i]! - cp[i]! * x[i + 1]!;
  return x;
}

// ---------------------------------------------------------------------------
// Weighted RMS norm used by the ODE error controllers
// ---------------------------------------------------------------------------

/**
 * Root-mean-square of `err[i] / scale[i]`. A value <= 1 means the estimated
 * local error fits within the mixed absolute/relative tolerance.
 */
export function wrmsNorm(err: ArrayLike<number>, scale: ArrayLike<number>): number {
  const n = err.length;
  if (n === 0) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const r = err[i]! / scale[i]!;
    s += r * r;
  }
  return Math.sqrt(s / n);
}

/** Mixed tolerance scale `atol + rtol * max(|y_i|, |yNew_i|)` (scalar or per-component atol). */
export function toleranceScale(y: number[], yNew: number[], rtol: number, atol: number | number[]): number[] {
  const n = y.length;
  const s = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const a = typeof atol === 'number' ? atol : atol[i]!;
    s[i] = a + rtol * Math.max(Math.abs(y[i]!), Math.abs(yNew[i]!));
  }
  return s;
}
