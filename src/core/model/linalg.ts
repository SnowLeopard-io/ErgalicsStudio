// ==========================================================================
// Ergalics Studio — small dense linear algebra for the modelling kernel
//
// Only what OLS / ridge / polynomial fitting need: transpose, multiply,
// Householder QR and triangular solves. Columns are kept small (number of
// features, ≤ a few dozen), so straightforward in-place algorithms are both
// clearer and faster here than a packed design. Pure TS, no allocations on
// the innermost loops beyond the R workspace.
// ==========================================================================

export type Matrix = number[][];

export function mat(rows: number, cols: number): Matrix {
  return Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
}

export function transpose(A: Matrix): Matrix {
  const r = A.length;
  const c = A[0]!.length;
  const T = mat(c, r);
  for (let i = 0; i < r; i += 1) for (let j = 0; j < c; j += 1) T[j]![i] = A[i]![j]!;
  return T;
}

export function matmul(A: Matrix, B: Matrix): Matrix {
  const n = A.length;
  const k = B.length;
  const m = B[0]!.length;
  const C = mat(n, m);
  for (let i = 0; i < n; i += 1) {
    const row = A[i]!;
    const out = C[i]!;
    for (let p = 0; p < k; p += 1) {
      const a = row[p]!;
      if (a === 0) continue;
      const brow = B[p]!;
      for (let j = 0; j < m; j += 1) out[j]! += a * brow[j]!;
    }
  }
  return C;
}

export interface QRDecomposition {
  /** Orthogonal factor n×n (explicit Q). */
  Q: Matrix;
  /** Upper triangular factor n×p. */
  R: Matrix;
}

/**
 * Householder QR of an n×p matrix (n ≥ p). Works in a copy and forms Q
 * explicitly by applying the n−p+1 reflectors — fine for the small, tall
 * designs the modelling layer produces.
 */
export function qr(A: Matrix): QRDecomposition {
  const n = A.length;
  const p = A[0]!.length;
  const R = A.map((row) => row.slice());
  // Store reflector vectors v_k and scalars tau_k.
  const vs: Matrix = [];
  const taus: number[] = [];

  for (let k = 0; k < Math.min(n, p); k += 1) {
    const v = new Array<number>(n - k).fill(0);
    let norm = 0;
    for (let i = k; i < n; i += 1) {
      v[i - k] = R[i]![k]!;
      norm += R[i]![k]! ** 2;
    }
    norm = Math.sqrt(norm);
    if (norm < 1e-14) {
      taus.push(0);
      vs.push(v);
      continue;
    }
    const sign = v[0]! >= 0 ? 1 : -1;
    v[0]! += sign * norm;
    let vtv = 0;
    for (let i = 0; i < v.length; i += 1) vtv += v[i]! ** 2;
    const tau = vtv === 0 ? 0 : 2 / vtv;
    taus.push(tau);
    vs.push(v);
    // R := (I − τ vvᵀ) R on rows k…n, columns k…p−1.
    for (let j = k; j < p; j += 1) {
      let dot = 0;
      for (let i = k; i < n; i += 1) dot += v[i - k]! * R[i]![j]!;
      dot *= tau;
      for (let i = k; i < n; i += 1) R[i]![j]! -= dot * v[i - k]!;
    }
  }

  // Q = H_0 H_1 … H_{m−1}: apply the reflectors in REVERSE of the order
  // they reduced R (R = H_{m−1}…H_0 A, and each H is symmetric, so
  // Q = H_0…H_{m−1}).
  let Q = mat(n, n);
  for (let i = 0; i < n; i += 1) Q[i]![i] = 1;
  for (let k = vs.length - 1; k >= 0; k -= 1) {
    const tau = taus[k]!;
    const vk = vs[k]!;
    for (let j = 0; j < n; j += 1) {
      let dot = 0;
      for (let i = k; i < n; i += 1) dot += vk[i - k]! * Q[i]![j]!;
      dot *= tau;
      for (let i = k; i < n; i += 1) Q[i]![j]! -= dot * vk[i - k]!;
    }
  }

  // Zero the lower triangle of R (reflection roundoff) for clean solves.
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < Math.min(i, p); j += 1) R[i]![j] = 0;
  }
  return { Q, R };
}

/** Solve R x = b for an upper-triangular p×p R (top square of an n×p R). */
export function solveUpperTriangular(R: Matrix, b: number[]): number[] {
  const p = b.length;
  const x = new Array<number>(p).fill(0);
  for (let i = p - 1; i >= 0; i -= 1) {
    let s = b[i]!;
    for (let j = i + 1; j < p; j += 1) s -= R[i]![j]! * x[j]!;
    const d = R[i]![i]!;
    x[i] = Math.abs(d) < 1e-14 ? 0 : s / d;
  }
  return x;
}

/** Solve L x = b for a lower-triangular L (used by the Durbin recursion path). */
export function solveLowerTriangular(L: Matrix, b: number[]): number[] {
  const p = b.length;
  const x = new Array<number>(p).fill(0);
  for (let i = 0; i < p; i += 1) {
    let s = b[i]!;
    for (let j = 0; j < i; j += 1) s -= L[i]![j]! * x[j]!;
    x[i] = s / (L[i]![i]! || 1e-15);
  }
  return x;
}

/**
 * Least-squares solution β = argmin ‖y − Xβ‖ via Householder QR.
 * Returns β and the (thin) upper factor R for covariance/variance work.
 */
export function lstsqQR(X: Matrix, y: number[]): { beta: number[]; R: Matrix } {
  const { Q, R } = qr(X);
  const p = X[0]!.length;
  // Qᵀy — full Q is n×n; only the first p rows of the result are needed.
  const qty = new Array<number>(p).fill(0);
  for (let i = 0; i < p; i += 1) {
    let s = 0;
    for (let r = 0; r < y.length; r += 1) s += Q[r]![i]! * y[r]!;
    qty[i] = s;
  }
  const Rtop = R.slice(0, p).map((row) => row.slice(0, p));
  return { beta: solveUpperTriangular(Rtop, qty), R: Rtop };
}

/** Inverse of a positive-definite symmetric matrix via Cholesky (covariance). */
export function inverseSPD(A: Matrix): Matrix {
  const n = A.length;
  const L = mat(n, n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= i; j += 1) {
      let s = A[i]![j]!;
      for (let k = 0; k < j; k += 1) s -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        L[i]![j] = Math.sqrt(Math.max(s, 1e-18));
      } else {
        L[i]![j] = s / L[j]![j]!;
      }
    }
  }
  // A⁻¹ = L⁻ᵀ L⁻¹: solve L X = I column by column, then Xᵀ X.
  const inv = mat(n, n);
  for (let col = 0; col < n; col += 1) {
    const e = new Array<number>(n).fill(0);
    e[col] = 1;
    const z = solveLowerTriangular(L, e);
    // Solve Lᵀ w = z (column w of A⁻¹).
    const w = new Array<number>(n).fill(0);
    for (let i = n - 1; i >= 0; i -= 1) {
      let s = z[i]!;
      for (let k = i + 1; k < n; k += 1) s -= L[k]![i]! * w[k]!;
      w[i] = s / L[i]![i]!;
    }
    for (let i = 0; i < n; i += 1) inv[i]![col] = w[i]!;
  }
  return inv;
}
