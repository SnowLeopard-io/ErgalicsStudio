// ==========================================================================
// math-linalg — linear algebra numerics (pure, dependency-free, testable)
//
// Dense-matrix building blocks behind the Linear Algebra Lab: LU
// determinants with partial pivoting, closed-form 2×2 eigenpairs, Householder
// QR, n×n eigenvalues via Hessenberg reduction + complex shifted QR
// iteration, one-sided Jacobi SVD, and orthogonal projection onto a span.
// SAMPLE_MATRICES is the built-in sample dataset chosen through the plugin's
// `sample` select parameter, and runLinalgBenchmarks() cross-checks every
// routine against analytic answers.
//
// All functions are pure so the kernel unit-tests without a canvas or DOM.
// The unified error metric throughout is |computed − analytic|/|analytic|.
// ==========================================================================

// ---- dense matrix basics ---------------------------------------------------------

/** Row-major dense matrix (rows of equal length). */
export type Matrix = number[][];

/** Minimal local complex type (plugins must not cross-import each other). */
export interface ComplexNum {
  re: number;
  im: number;
}

export function identity(n: number): Matrix {
  const m: Matrix = [];
  for (let i = 0; i < n; i += 1) {
    const row = new Array<number>(n).fill(0);
    row[i] = 1;
    m.push(row);
  }
  return m;
}

export function transpose(m: Matrix): Matrix {
  const rows = m.length;
  const cols = rows > 0 ? m[0]!.length : 0;
  const out: Matrix = [];
  for (let j = 0; j < cols; j += 1) {
    const row: number[] = [];
    for (let i = 0; i < rows; i += 1) row.push(m[i]![j]!);
    out.push(row);
  }
  return out;
}

export function matmul(a: Matrix, b: Matrix): Matrix {
  const rows = a.length;
  const inner = rows > 0 ? a[0]!.length : 0;
  const cols = b.length > 0 ? b[0]!.length : 0;
  const out: Matrix = [];
  for (let i = 0; i < rows; i += 1) {
    const row = new Array<number>(cols).fill(0);
    for (let k = 0; k < inner; k += 1) {
      const aik = a[i]![k]!;
      if (aik === 0) continue;
      for (let j = 0; j < cols; j += 1) row[j] = row[j]! + aik * b[k]![j]!;
    }
    out.push(row);
  }
  return out;
}

export function frobeniusNorm(m: Matrix): number {
  let s = 0;
  for (const row of m) {
    for (const v of row) s += v * v;
  }
  return Math.sqrt(s);
}

/** ‖A − B‖_F (Frobenius distance between two equally shaped matrices). */
function diffNorm(a: Matrix, b: Matrix): number {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < a[i]!.length; j += 1) {
      const d = a[i]![j]! - b[i]![j]!;
      s += d * d;
    }
  }
  return Math.sqrt(s);
}

// ---- determinant -------------------------------------------------------------------

/** Closed-form determinant of the 2×2 matrix [[a, b], [c, d]]. */
export function determinant2x2(a: number, b: number, c: number, d: number): number {
  return a * d - b * c;
}

/**
 * Determinant by Gaussian elimination with partial pivoting. Exact 0 is
 * returned as soon as a zero pivot is met, so singular inputs never divide
 * by zero.
 */
export function determinant(m: Matrix): number {
  const n = m.length;
  if (n === 0) return 1;
  const a = m.map((row) => row.slice());
  let sign = 1;
  for (let k = 0; k < n; k += 1) {
    let p = k;
    for (let i = k + 1; i < n; i += 1) {
      if (Math.abs(a[i]![k]!) > Math.abs(a[p]![k]!)) p = i;
    }
    if (a[p]![k] === 0) return 0;
    if (p !== k) {
      const tmp = a[p]!;
      a[p] = a[k]!;
      a[k] = tmp;
      sign = -sign;
    }
    const pivot = a[k]![k]!;
    for (let i = k + 1; i < n; i += 1) {
      const f = a[i]![k]! / pivot;
      a[i]![k] = 0;
      for (let j = k + 1; j < n; j += 1) a[i]![j] = a[i]![j]! - f * a[k]![j]!;
    }
  }
  let det = sign;
  for (let k = 0; k < n; k += 1) det *= a[k]![k]!;
  return det;
}

// ---- complex scalar helpers (kernel-internal) ----------------------------------------

function cAdd(a: ComplexNum, b: ComplexNum): ComplexNum {
  return { re: a.re + b.re, im: a.im + b.im };
}

function cSub(a: ComplexNum, b: ComplexNum): ComplexNum {
  return { re: a.re - b.re, im: a.im - b.im };
}

function cMul(a: ComplexNum, b: ComplexNum): ComplexNum {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function cDiv(a: ComplexNum, b: ComplexNum): ComplexNum {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}

function cAbs(a: ComplexNum): number {
  return Math.hypot(a.re, a.im);
}

function cConj(a: ComplexNum): ComplexNum {
  return { re: a.re, im: -a.im };
}

/** Principal complex square root (branch cut handled via the sign of im). */
function cSqrt(a: ComplexNum): ComplexNum {
  if (a.re === 0 && a.im === 0) return { re: 0, im: 0 };
  const r = Math.hypot(a.re, a.im);
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sqrt((r - a.re) / 2);
  return { re, im: a.im >= 0 ? im : -im };
}

// ---- 2×2 eigenpairs (closed form) -----------------------------------------------------

/**
 * Closed-form eigenvalues of [[a, b], [c, d]] via the quadratic formula on
 * λ² − tr·λ + det = 0. Complex conjugate pairs are returned when the
 * discriminant is negative.
 */
export function eigenvalues2x2(a: number, b: number, c: number, d: number): [ComplexNum, ComplexNum] {
  const half = (a + d) / 2;
  const disc = half * half - (a * d - b * c);
  if (disc >= 0) {
    const s = Math.sqrt(disc);
    return [
      { re: half + s, im: 0 },
      { re: half - s, im: 0 },
    ];
  }
  const s = Math.sqrt(-disc);
  return [
    { re: half, im: s },
    { re: half, im: -s },
  ];
}

/**
 * Unit eigenvector of [[a, b], [c, d]] for the (possibly complex)
 * eigenvalue `lam`, taken from the better-scaled row of (A − λI) = 0:
 * (b, λ − a) when b ≠ 0, else (λ − d, c). Diagonal matrices resolve to the
 * matching axis.
 */
export function eigenvector2x2(a: number, b: number, c: number, d: number, lam: ComplexNum): [ComplexNum, ComplexNum] {
  let x: ComplexNum;
  let y: ComplexNum;
  if (b !== 0) {
    x = { re: b, im: 0 };
    y = cSub(lam, { re: a, im: 0 });
  } else if (c !== 0) {
    x = cSub(lam, { re: d, im: 0 });
    y = { re: c, im: 0 };
  } else if (Math.abs(a - lam.re) <= Math.abs(d - lam.re)) {
    x = { re: 1, im: 0 };
    y = { re: 0, im: 0 };
  } else {
    x = { re: 0, im: 0 };
    y = { re: 1, im: 0 };
  }
  const n = Math.hypot(cAbs(x), cAbs(y));
  if (n > 0) {
    x = { re: x.re / n, im: x.im / n };
    y = { re: y.re / n, im: y.im / n };
  }
  return [x, y];
}

// ---- Householder QR --------------------------------------------------------------------

/**
 * Full QR decomposition A = Q·R by Householder reflections. Q is orthogonal
 * (QᵀQ = I) and R is upper triangular.
 */
export function qrDecomposition(m: Matrix): { Q: Matrix; R: Matrix } {
  const n = m.length;
  const R = m.map((row) => row.slice());
  const Q = identity(n);
  for (let k = 0; k < n - 1; k += 1) {
    let normx = 0;
    for (let i = k; i < n; i += 1) normx += R[i]![k]! * R[i]![k]!;
    normx = Math.sqrt(normx);
    if (normx === 0) continue;
    const x0 = R[k]![k]!;
    // Reflector acts on rows k..n−1 and maps the column onto alpha·e1 with
    // |alpha| = ‖x‖; the sign choice avoids cancellation in v = x − alpha·e1.
    const alpha = x0 > 0 ? -normx : normx;
    const v: number[] = [x0 - alpha];
    for (let i = k + 1; i < n; i += 1) v.push(R[i]![k]!);
    let vn2 = 0;
    for (const t of v) vn2 += t * t;
    if (vn2 === 0) continue;
    const tau = 2 / vn2;
    // H ← H · R (rows k..n−1)
    for (let j = 0; j < n; j += 1) {
      let s = 0;
      for (let i = 0; i < v.length; i += 1) s += v[i]! * R[k + i]![j]!;
      s *= tau;
      for (let i = 0; i < v.length; i += 1) R[k + i]![j] = R[k + i]![j]! - s * v[i]!;
    }
    // Q ← Q · H (columns k..n−1)
    for (let i = 0; i < n; i += 1) {
      let s = 0;
      for (let j = 0; j < v.length; j += 1) s += Q[i]![k + j]! * v[j]!;
      s *= tau;
      for (let j = 0; j < v.length; j += 1) Q[i]![k + j] = Q[i]![k + j]! - s * v[j]!;
    }
    for (let i = k + 1; i < n; i += 1) R[i]![k] = 0;
  }
  return { Q, R };
}

// ---- n×n eigenvalues (Hessenberg + complex shifted QR iteration) -----------------------

/** Upper-Hessenberg reduction by Householder similarities (real arithmetic). */
function toHessenberg(m: Matrix): Matrix {
  const n = m.length;
  const H = m.map((row) => row.slice());
  for (let k = 0; k <= n - 3; k += 1) {
    let normx = 0;
    for (let i = k + 1; i < n; i += 1) normx += H[i]![k]! * H[i]![k]!;
    normx = Math.sqrt(normx);
    if (normx === 0) continue;
    const x0 = H[k + 1]![k]!;
    const alpha = x0 > 0 ? -normx : normx;
    const v: number[] = [x0 - alpha];
    for (let i = k + 2; i < n; i += 1) v.push(H[i]![k]!);
    let vn2 = 0;
    for (const t of v) vn2 += t * t;
    if (vn2 === 0) continue;
    const tau = 2 / vn2;
    for (let j = 0; j < n; j += 1) {
      let s = 0;
      for (let i = 0; i < v.length; i += 1) s += v[i]! * H[k + 1 + i]![j]!;
      s *= tau;
      for (let i = 0; i < v.length; i += 1) H[k + 1 + i]![j] = H[k + 1 + i]![j]! - s * v[i]!;
    }
    for (let i = 0; i < n; i += 1) {
      let s = 0;
      for (let j = 0; j < v.length; j += 1) s += H[i]![k + 1 + j]! * v[j]!;
      s *= tau;
      for (let j = 0; j < v.length; j += 1) H[i]![k + 1 + j] = H[i]![k + 1 + j]! - s * v[j]!;
    }
    for (let i = k + 2; i < n; i += 1) H[i]![k] = 0;
  }
  return H;
}

/**
 * Unitary Givens rotation [[c, s], [−s̄, c̄]] with c = ā/r, s = b̄/r and
 * r = √(|a|² + |b|²), mapping (a, b)ᵀ onto (r, 0)ᵀ.
 */
function cGivens(a: ComplexNum, b: ComplexNum): { c: ComplexNum; s: ComplexNum } {
  const r = Math.hypot(cAbs(a), cAbs(b));
  if (r === 0) return { c: { re: 1, im: 0 }, s: { re: 0, im: 0 } };
  return {
    c: { re: a.re / r, im: -a.im / r },
    s: { re: b.re / r, im: -b.im / r },
  };
}

/** Wilkinson shift: eigenvalue of the trailing 2×2 block nearest a_{n,n}. */
function wilkinsonShift(a: ComplexNum, b: ComplexNum, c: ComplexNum, d: ComplexNum): ComplexNum {
  const half = cDiv(cAdd(a, d), { re: 2, im: 0 });
  const disc = cSub(cMul(half, half), cSub(cMul(a, d), cMul(b, c)));
  const rt = cSqrt(disc);
  const l1 = cAdd(half, rt);
  const l2 = cSub(half, rt);
  return cAbs(cSub(l1, d)) <= cAbs(cSub(l2, d)) ? l1 : l2;
}

/** q · h · qᴴ for small complex matrices (one shifted-QR similarity step). */
function cSimilarity(q: ComplexNum[][], h: ComplexNum[][]): ComplexNum[][] {
  const size = q.length;
  const tmp: ComplexNum[][] = [];
  for (let i = 0; i < size; i += 1) {
    const row: ComplexNum[] = [];
    for (let j = 0; j < size; j += 1) {
      let acc: ComplexNum = { re: 0, im: 0 };
      for (let k = 0; k < size; k += 1) acc = cAdd(acc, cMul(h[i]![k]!, cConj(q[j]![k]!)));
      row.push(acc);
    }
    tmp.push(row);
  }
  const out: ComplexNum[][] = [];
  for (let i = 0; i < size; i += 1) {
    const row: ComplexNum[] = [];
    for (let j = 0; j < size; j += 1) {
      let acc: ComplexNum = { re: 0, im: 0 };
      for (let k = 0; k < size; k += 1) acc = cAdd(acc, cMul(q[i]![k]!, tmp[k]![j]!));
      row.push(acc);
    }
    out.push(row);
  }
  return out;
}

/**
 * Eigenvalues of a real n×n matrix by Householder Hessenberg reduction
 * followed by complex shifted QR iteration with Wilkinson shifts and
 * diagonal deflation. Complex conjugate pairs are handled natively because
 * the iteration runs in complex arithmetic; a diagonal dump is the
 * last-resort fallback if the iteration cap is reached.
 */
export function eigenvaluesQR(m: Matrix): ComplexNum[] {
  const n = m.length;
  if (n === 0) return [];
  if (n === 1) return [{ re: m[0]![0]!, im: 0 }];
  const H: ComplexNum[][] = toHessenberg(m).map((row) => row.map((x) => ({ re: x, im: 0 })));
  const out: ComplexNum[] = [];
  let hi = n - 1;
  let iter = 0;
  const maxIter = 60 * n + 200;
  while (hi >= 0) {
    if (hi === 0) {
      out.push(H[0]![0]!);
      break;
    }
    const sub = cAbs(H[hi]![hi - 1]!);
    const diagSum = cAbs(H[hi]![hi]!) + cAbs(H[hi - 1]![hi - 1]!);
    if (sub <= 1e-14 * (diagSum + 1e-300)) {
      out.push(H[hi]![hi]!);
      hi -= 1;
      iter = 0;
      continue;
    }
    if (iter >= maxIter) {
      for (let i = 0; i <= hi; i += 1) out.push(H[i]![i]!);
      break;
    }
    iter += 1;
    const mu = wilkinsonShift(H[hi - 1]![hi - 1]!, H[hi - 1]![hi]!, H[hi]![hi - 1]!, H[hi]![hi]!);
    const size = hi + 1;
    // Triangularize A = H_active − μI with Givens rotations; Qacc ends as Qᴴ
    // with Qacc·A = R.
    const A: ComplexNum[][] = [];
    for (let i = 0; i < size; i += 1) {
      const row: ComplexNum[] = [];
      for (let j = 0; j < size; j += 1) {
        const v = H[i]![j]!;
        row.push(i === j ? cSub(v, mu) : { re: v.re, im: v.im });
      }
      A.push(row);
    }
    const Qacc: ComplexNum[][] = identity(size).map((row) => row.map((x) => ({ re: x, im: 0 })));
    for (let col = 0; col < hi; col += 1) {
      const rot = cGivens(A[col]![col]!, A[col + 1]![col]!);
      const cc = cConj(rot.c);
      const sc = cConj(rot.s);
      for (let j = 0; j < size; j += 1) {
        const rp = A[col]![j]!;
        const rq = A[col + 1]![j]!;
        A[col]![j] = cAdd(cMul(rot.c, rp), cMul(rot.s, rq));
        A[col + 1]![j] = cSub(cMul(cc, rq), cMul(sc, rp));
      }
      for (let j = 0; j < size; j += 1) {
        const qp = Qacc[col]![j]!;
        const qq = Qacc[col + 1]![j]!;
        Qacc[col]![j] = cAdd(cMul(rot.c, qp), cMul(rot.s, qq));
        Qacc[col + 1]![j] = cSub(cMul(cc, qq), cMul(sc, qp));
      }
    }
    const next = cSimilarity(Qacc, H.slice(0, size).map((row) => row.slice(0, size)));
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) H[i]![j] = next[i]![j]!;
      // restore the exact Hessenberg structure eaten by rounding
      for (let j = 0; j + 2 <= i; j += 1) H[i]![j] = { re: 0, im: 0 };
    }
  }
  return out;
}

// ---- one-sided Jacobi SVD ----------------------------------------------------------------

export interface Svd {
  /** Left singular vectors (columns of U, orthonormal). */
  U: Matrix;
  /** Singular values in descending order. */
  sigma: number[];
  /** Right singular vectors (columns of V, orthonormal). */
  V: Matrix;
}

/**
 * One-sided Jacobi SVD of a square matrix: column-pair rotations make the
 * working matrix's columns mutually orthogonal (A·V = W), the column norms
 * are the singular values, and the normalized columns form U, so
 * A = U·diag(σ)·Vᵀ. Columns are sorted by decreasing σ.
 */
export function svdJacobi(m: Matrix): Svd {
  const n = m.length;
  const w = m.map((row) => row.slice());
  const v = identity(n);
  for (let sweep = 0; sweep < 30; sweep += 1) {
    let rotated = false;
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        let alpha = 0;
        let beta = 0;
        let gamma = 0;
        for (let i = 0; i < n; i += 1) {
          const wp = w[i]![p]!;
          const wq = w[i]![q]!;
          alpha += wp * wp;
          beta += wq * wq;
          gamma += wp * wq;
        }
        const scale = Math.sqrt(alpha * beta);
        if (Math.abs(gamma) <= 1e-15 * scale) continue;
        const zeta = (beta - alpha) / (2 * gamma);
        const sgn = zeta >= 0 ? 1 : -1;
        const t = sgn / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        rotated = true;
        for (let i = 0; i < n; i += 1) {
          const a = w[i]![p]!;
          const b = w[i]![q]!;
          w[i]![p] = c * a - s * b;
          w[i]![q] = s * a + c * b;
          const va = v[i]![p]!;
          const vb = v[i]![q]!;
          v[i]![p] = c * va - s * vb;
          v[i]![q] = s * va + c * vb;
        }
      }
    }
    if (!rotated) break;
  }
  const sigma: number[] = [];
  for (let j = 0; j < n; j += 1) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += w[i]![j]! * w[i]![j]!;
    sigma.push(Math.sqrt(s));
  }
  const order = sigma.map((_, j) => j).sort((a, b) => sigma[b]! - sigma[a]!);
  const U: Matrix = [];
  const V: Matrix = [];
  for (let i = 0; i < n; i += 1) {
    const urow: number[] = [];
    const vrow: number[] = [];
    for (let j = 0; j < n; j += 1) {
      const col = order[j]!;
      const sig = sigma[col]!;
      urow.push(sig > 0 ? w[i]![col]! / sig : 0);
      vrow.push(v[i]![col]!);
    }
    U.push(urow);
    V.push(vrow);
  }
  // Zero singular values leave their U column unset; complete it with a
  // canonical-basis vector orthogonal to the columns already assigned. The
  // column's image under A is 0, so any orthonormal choice keeps A = UΣVᵀ.
  const assigned: number[][] = [];
  for (let j = 0; j < n; j += 1) {
    if (sigma[order[j]!]! > 0) {
      assigned.push(U.map((row) => row[j]!));
      continue;
    }
    let best: number[] = [];
    let bestNorm = 0;
    for (let k = 0; k < n; k += 1) {
      const cand = new Array<number>(n).fill(0);
      cand[k] = 1;
      for (const u of assigned) {
        let d = 0;
        for (let i = 0; i < n; i += 1) d += cand[i]! * u[i]!;
        for (let i = 0; i < n; i += 1) cand[i] = cand[i]! - d * u[i]!;
      }
      let nn = 0;
      for (const x of cand) nn += x * x;
      nn = Math.sqrt(nn);
      if (nn > bestNorm) {
        bestNorm = nn;
        best = cand;
      }
    }
    if (bestNorm > 0) {
      for (let i = 0; i < n; i += 1) U[i]![j] = best[i]! / bestNorm;
      assigned.push(U.map((row) => row[j]!));
    }
  }
  return { U, sigma: order.map((j) => sigma[j]!), V };
}

// ---- orthogonal projection onto a span ---------------------------------------------------

export interface SubspaceProjection {
  /** Orthogonal projection of the query vector onto span(basis). */
  projection: number[];
  /** Query minus projection — the orthogonal complement component. */
  residual: number[];
  /** Coordinates of the projection along the orthonormalized directions. */
  coordinates: number[];
  /** Number of linearly independent directions kept from the basis. */
  dimension: number;
}

/**
 * Project a vector onto the span of a basis with modified Gram–Schmidt:
 * dependent basis directions are dropped, the remaining orthonormal
 * directions carry the projection, and residual = query − projection is
 * orthogonal to the span.
 */
export function projectOntoSpan(v: number[], basis: number[][]): SubspaceProjection {
  const dim = v.length;
  const q: number[][] = [];
  for (const b of basis) {
    const w = b.slice();
    for (const qi of q) {
      let d = 0;
      for (let k = 0; k < dim; k += 1) d += w[k]! * qi[k]!;
      for (let k = 0; k < dim; k += 1) w[k] = w[k]! - d * qi[k]!;
    }
    let n = 0;
    for (const x of w) n += x * x;
    n = Math.sqrt(n);
    let bn = 0;
    for (const x of b) bn += x * x;
    bn = Math.sqrt(bn);
    if (n <= 1e-10 * bn) continue; // dependent or zero direction
    q.push(w.map((x) => x / n));
  }
  const projection = new Array<number>(dim).fill(0);
  const coordinates: number[] = [];
  for (const qi of q) {
    let c = 0;
    for (let k = 0; k < dim; k += 1) c += v[k]! * qi[k]!;
    coordinates.push(c);
    for (let k = 0; k < dim; k += 1) projection[k] = projection[k]! + c * qi[k]!;
  }
  const residual = v.map((x, k) => x - projection[k]!);
  return { projection, residual, coordinates, dimension: q.length };
}

// ---- built-in sample dataset (the `sample` select parameter) -----------------------------

export interface SampleMatrix {
  id: string;
  labelZh: string;
  labelEn: string;
  /** Row-major 2×2 entries. */
  matrix: Matrix;
}

const C30 = Math.cos(Math.PI / 6);
const S30 = Math.sin(Math.PI / 6);
const C45 = Math.cos(Math.PI / 4);
const S45 = Math.sin(Math.PI / 4);

export const SAMPLE_MATRICES: SampleMatrix[] = [
  {
    id: 'rotate-30',
    labelZh: '旋转 30°',
    labelEn: 'Rotation 30°',
    matrix: [
      [C30, -S30],
      [S30, C30],
    ],
  },
  {
    id: 'scale-xy',
    labelZh: '缩放（x × 2, y × 0.5）',
    labelEn: 'Scaling (x × 2, y × 0.5)',
    matrix: [
      [2, 0],
      [0, 0.5],
    ],
  },
  {
    id: 'shear-x',
    labelZh: '水平剪切 k = 0.8',
    labelEn: 'Horizontal shear k = 0.8',
    matrix: [
      [1, 0.8],
      [0, 1],
    ],
  },
  {
    id: 'reflect-diag',
    labelZh: '关于直线 y = x 反射',
    labelEn: 'Reflection across y = x',
    matrix: [
      [0, 1],
      [1, 0],
    ],
  },
  {
    id: 'rot-scale',
    labelZh: '旋转 45° + 均匀放大 1.5×',
    labelEn: 'Rotation 45° + uniform scale 1.5',
    matrix: [
      [1.5 * C45, -1.5 * S45],
      [1.5 * S45, 1.5 * C45],
    ],
  },
  {
    id: 'collapse',
    labelZh: '面积塌缩（奇异阵，det = 0）',
    labelEn: 'Area collapse (singular, det = 0)',
    matrix: [
      [1, 1],
      [1, 1],
    ],
  },
];

/** Look up one SAMPLE_MATRICES entry by its select id (null when unknown). */
export function selectSample(id: string): SampleMatrix | null {
  return SAMPLE_MATRICES.find((s) => s.id === id) ?? null;
}

// ---- embedded validation benchmarks ---------------------------------------------------------

export const LINALG_BENCHMARK_ID = 'linalg-benchmarks';

export interface LinalgBenchmark {
  id: string;
  labelZh: string;
  labelEn: string;
  detailZh: string;
  detailEn: string;
  /** Unified relative error |computed − analytic|/|analytic|. */
  relErr: number;
  passed: boolean;
}

/** Worst per-eigenvalue relative error after greedy set matching. */
function eigenSetError(computed: ComplexNum[], ref: ComplexNum[]): number {
  const pool = computed.slice();
  let worst = 0;
  for (const r of ref) {
    if (pool.length === 0) return Infinity;
    let bestIdx = 0;
    let bestErr = Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const e = Math.hypot(pool[i]!.re - r.re, pool[i]!.im - r.im) / Math.hypot(r.re, r.im);
      if (e < bestErr) {
        bestErr = e;
        bestIdx = i;
      }
    }
    pool.splice(bestIdx, 1);
    worst = Math.max(worst, bestErr);
  }
  return worst;
}

/** Reconstruct U·diag(σ)·Vᵀ from an SVD triple. */
function svdProduct(U: Matrix, sigma: number[], V: Matrix): Matrix {
  const scaled = U.map((row) => row.map((x, j) => x * sigma[j]!));
  return matmul(scaled, transpose(V));
}

/** ‖MᵀM − I‖_F — orthogonality defect of a candidate factor matrix. */
function orthoError(m: Matrix): number {
  const g = matmul(transpose(m), m);
  let s = 0;
  for (let i = 0; i < g.length; i += 1) {
    for (let j = 0; j < g[i]!.length; j += 1) {
      const d = g[i]![j]! - (i === j ? 1 : 0);
      s += d * d;
    }
  }
  return Math.sqrt(s);
}

/** ‖A·v − λ·v‖₂ / (‖A‖_F·‖v‖₂) for a complex 2×2 eigenpair. */
function eigenResidual2x2(m: Matrix, lam: ComplexNum, v: [ComplexNum, ComplexNum]): number {
  const a: ComplexNum = { re: m[0]![0]!, im: 0 };
  const b: ComplexNum = { re: m[0]![1]!, im: 0 };
  const c: ComplexNum = { re: m[1]![0]!, im: 0 };
  const d: ComplexNum = { re: m[1]![1]!, im: 0 };
  const r0 = cSub(cAdd(cMul(a, v[0]), cMul(b, v[1])), cMul(lam, v[0]));
  const r1 = cSub(cAdd(cMul(c, v[0]), cMul(d, v[1])), cMul(lam, v[1]));
  const rn = Math.hypot(cAbs(r0), cAbs(r1));
  const vn = Math.hypot(cAbs(v[0]), cAbs(v[1]));
  return rn / (frobeniusNorm(m) * vn);
}

/**
 * Run the embedded validation suite: closed-form 2×2 eigenvalues and
 * eigen-residuals against analytic references, QR-iteration spectra against
 * closed-form spectra, Jacobi SVD reconstruction / orthogonality, LU
 * determinants against closed-form entries, Householder QR reconstruction,
 * and span projections against closed-form projections. Every check uses the
 * unified metric |computed − analytic|/|analytic|.
 */
export function runLinalgBenchmarks(): LinalgBenchmark[] {
  const out: LinalgBenchmark[] = [];

  // ① closed-form 2×2 eigenvalues vs analytic (saddle, rotation, symmetric).
  const cos30 = Math.cos(Math.PI / 6);
  const sin30 = Math.sin(Math.PI / 6);
  const eigenCases: Array<{ m: Matrix; ref: ComplexNum[] }> = [
    {
      m: [
        [1, 3],
        [2, -1],
      ],
      ref: [
        { re: Math.sqrt(7), im: 0 },
        { re: -Math.sqrt(7), im: 0 },
      ],
    },
    {
      m: [
        [cos30, -sin30],
        [sin30, cos30],
      ],
      ref: [
        { re: cos30, im: sin30 },
        { re: cos30, im: -sin30 },
      ],
    },
    {
      m: [
        [2, 1],
        [1, 2],
      ],
      ref: [
        { re: 3, im: 0 },
        { re: 1, im: 0 },
      ],
    },
  ];
  let e1 = 0;
  for (const cs of eigenCases) {
    const [l1, l2] = eigenvalues2x2(cs.m[0]![0]!, cs.m[0]![1]!, cs.m[1]![0]!, cs.m[1]![1]!);
    e1 = Math.max(e1, eigenSetError([l1, l2], cs.ref));
  }
  out.push({
    id: 'eigen-2x2-closed-form',
    labelZh: '2×2 闭式特征值对照解析谱（< 1e-9）',
    labelEn: 'Closed-form 2×2 eigenvalues vs analytic spectra (< 1e-9)',
    passed: e1 < 1e-9,
    relErr: e1,
    detailZh: `最坏相对误差 ${e1.toExponential(2)}；对照：鞍点 ±√7、旋转 e^{±iπ/6}、对称阵 3/1`,
    detailEn: `worst rel. err ${e1.toExponential(2)}; references: saddle ±√7, rotation e^{±iπ/6}, symmetric 3/1`,
  });

  // ② QR-iteration eigenvalues vs analytic (tridiagonal, companion, quarter-turn).
  const sqrt2 = Math.sqrt(2);
  const qrCases: Array<{ m: Matrix; ref: ComplexNum[] }> = [
    {
      m: [
        [2, 1, 0],
        [1, 2, 1],
        [0, 1, 2],
      ],
      ref: [
        { re: 2 - sqrt2, im: 0 },
        { re: 2, im: 0 },
        { re: 2 + sqrt2, im: 0 },
      ],
    },
    {
      m: [
        [0, 0, 8],
        [1, 0, -14],
        [0, 1, 7],
      ],
      ref: [
        { re: 1, im: 0 },
        { re: 2, im: 0 },
        { re: 4, im: 0 },
      ],
    },
    {
      m: [
        [0, -1],
        [1, 0],
      ],
      ref: [
        { re: 0, im: 1 },
        { re: 0, im: -1 },
      ],
    },
  ];
  let e2 = 0;
  for (const cs of qrCases) {
    e2 = Math.max(e2, eigenSetError(eigenvaluesQR(cs.m), cs.ref));
  }
  out.push({
    id: 'eigen-qr-iteration',
    labelZh: 'QR 迭代特征值对照解析谱（< 1e-8）',
    labelEn: 'QR-iteration eigenvalues vs analytic spectra (< 1e-8)',
    passed: e2 < 1e-8,
    relErr: e2,
    detailZh: `最坏相对误差 ${e2.toExponential(2)}；对照：三对角 {2±√2, 2}、友矩阵 {1, 2, 4}、四分之一转 {±i}`,
    detailEn: `worst rel. err ${e2.toExponential(2)}; references: tridiagonal {2±√2, 2}, companion {1, 2, 4}, quarter-turn {±i}`,
  });

  // ③ eigen residual ‖Av − λv‖/(‖A‖·‖v‖) on closed-form eigenpairs.
  const residCases: Array<{ m: Matrix; lam: ComplexNum }> = [
    {
      m: [
        [1, 3],
        [2, -1],
      ],
      lam: { re: Math.sqrt(7), im: 0 },
    },
    {
      m: [
        [cos30, -sin30],
        [sin30, cos30],
      ],
      lam: { re: cos30, im: sin30 },
    },
    {
      m: [
        [2, 1],
        [1, 2],
      ],
      lam: { re: 3, im: 0 },
    },
    {
      m: [
        [2, 0],
        [0, 0.5],
      ],
      lam: { re: 2, im: 0 },
    },
  ];
  let e3 = 0;
  for (const cs of residCases) {
    const v = eigenvector2x2(cs.m[0]![0]!, cs.m[0]![1]!, cs.m[1]![0]!, cs.m[1]![1]!, cs.lam);
    e3 = Math.max(e3, eigenResidual2x2(cs.m, cs.lam, v));
  }
  out.push({
    id: 'eigen-residual',
    labelZh: '特征方程残差 ‖Av−λv‖/(‖A‖·‖v‖)（< 1e-12）',
    labelEn: 'Eigen residual ‖Av−λv‖/(‖A‖·‖v‖) (< 1e-12)',
    passed: e3 < 1e-12,
    relErr: e3,
    detailZh: `最坏归一化残差 ${e3.toExponential(2)}，覆盖 4 组闭式特征对（含复特征值旋转阵）`,
    detailEn: `worst normalized residual ${e3.toExponential(2)} across 4 closed-form eigenpairs (complex pair included)`,
  });

  // ④ / ⑤ Jacobi SVD reconstruction and orthogonality.
  const svdSet: Matrix[] = [
    ...SAMPLE_MATRICES.map((s) => s.matrix),
    [
      [1, 3],
      [2, -1],
    ],
    [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 10],
    ],
  ];
  let e4 = 0;
  let e5 = 0;
  for (const m of svdSet) {
    const { U, sigma, V } = svdJacobi(m);
    const ref = frobeniusNorm(m);
    e4 = Math.max(e4, diffNorm(m, svdProduct(U, sigma, V)) / ref);
    e5 = Math.max(e5, orthoError(U), orthoError(V));
  }
  out.push({
    id: 'svd-reconstruction',
    labelZh: 'SVD 重构相对误差 ‖A−UΣVᵀ‖/‖A‖（< 1e-12）',
    labelEn: 'SVD reconstruction ‖A−UΣVᵀ‖/‖A‖ (< 1e-12)',
    passed: e4 < 1e-12,
    relErr: e4,
    detailZh: `最坏相对误差 ${e4.toExponential(2)}，覆盖 ${svdSet.length} 个矩阵（2×2 样本 + 3×3）`,
    detailEn: `worst rel. err ${e4.toExponential(2)} over ${svdSet.length} matrices (2×2 samples + 3×3)`,
  });
  out.push({
    id: 'svd-orthogonality',
    labelZh: 'SVD 正交性 ‖UᵀU−I‖、‖VVᵀ−I‖（< 1e-12）',
    labelEn: 'SVD orthogonality ‖UᵀU−I‖, ‖VVᵀ−I‖ (< 1e-12)',
    passed: e5 < 1e-12,
    relErr: e5,
    detailZh: `最坏正交性缺陷 ${e5.toExponential(2)}（Frobenius 范数）`,
    detailEn: `worst orthogonality defect ${e5.toExponential(2)} (Frobenius norm)`,
  });

  // ⑥ LU determinant vs closed form (ad − bc for 2×2; explicit values for 3×3).
  const detPairs: Array<{ m: Matrix; ref: number }> = [
    ...SAMPLE_MATRICES.map((s) => ({
      m: s.matrix,
      ref: determinant2x2(s.matrix[0]![0]!, s.matrix[0]![1]!, s.matrix[1]![0]!, s.matrix[1]![1]!),
    })),
    {
      m: [
        [1, 3],
        [2, -1],
      ],
      ref: -7,
    },
    {
      m: [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 10],
      ],
      ref: -3,
    },
    {
      m: [
        [0, 0, 8],
        [1, 0, -14],
        [0, 1, 7],
      ],
      ref: 8,
    },
  ];
  let e6 = 0;
  let zeroExact = true;
  for (const p of detPairs) {
    const got = determinant(p.m);
    if (p.ref !== 0) e6 = Math.max(e6, Math.abs(got - p.ref) / Math.abs(p.ref));
    else if (got !== 0) zeroExact = false;
  }
  out.push({
    id: 'det-closed-form',
    labelZh: '行列式（LU）对照闭式 ad−bc（< 1e-12）',
    labelEn: 'LU determinant vs closed form ad − bc (< 1e-12)',
    passed: e6 < 1e-12 && zeroExact,
    relErr: e6,
    detailZh: `最坏相对误差 ${e6.toExponential(2)}；奇异样本 det 精确为 0：${zeroExact ? '是' : '否'}；3×3 对照 det = −3、8`,
    detailEn: `worst rel. err ${e6.toExponential(2)}; singular sample exactly 0: ${zeroExact ? 'yes' : 'no'}; 3×3 refs det = −3, 8`,
  });

  // ⑦ Householder QR reconstruction ‖A − QR‖/‖A‖.
  const qrSet: Matrix[] = [
    ...svdSet,
    [
      [0, 0, 8],
      [1, 0, -14],
      [0, 1, 7],
    ],
  ];
  let e7 = 0;
  for (const m of qrSet) {
    const { Q, R } = qrDecomposition(m);
    e7 = Math.max(e7, diffNorm(m, matmul(Q, R)) / frobeniusNorm(m));
  }
  out.push({
    id: 'qr-reconstruction',
    labelZh: 'QR 分解重构 ‖A−QR‖/‖A‖（< 1e-12）',
    labelEn: 'QR reconstruction ‖A−QR‖/‖A‖ (< 1e-12)',
    passed: e7 < 1e-12,
    relErr: e7,
    detailZh: `最坏相对误差 ${e7.toExponential(2)}，Householder 反射，覆盖 ${qrSet.length} 个矩阵`,
    detailEn: `worst rel. err ${e7.toExponential(2)}, Householder reflections, over ${qrSet.length} matrices`,
  });

  // ⑧ span projections vs closed-form projections.
  const projCases: Array<{ basis: number[][]; v: number[]; ref: number[] }> = [
    { basis: [[1, -1, 0], [1, 1, -2]], v: [1, 2, 3], ref: [-1, 0, 1] },
    { basis: [[1, 0, 0], [0, 1, 0]], v: [3, 4, 5], ref: [3, 4, 0] },
    { basis: [[1, 1]], v: [3, 4], ref: [3.5, 3.5] },
    { basis: [[1, 0], [2, 0]], v: [3, 4], ref: [3, 0] },
  ];
  let e8 = 0;
  for (const cs of projCases) {
    const { projection } = projectOntoSpan(cs.v, cs.basis);
    let num = 0;
    let den = 0;
    for (let k = 0; k < cs.ref.length; k += 1) {
      num += (projection[k]! - cs.ref[k]!) ** 2;
      den += cs.ref[k]! * cs.ref[k]!;
    }
    e8 = Math.max(e8, Math.sqrt(num) / Math.sqrt(den));
  }
  out.push({
    id: 'projection-analytic',
    labelZh: '子空间投影对照解析投影（< 1e-12）',
    labelEn: 'Span projection vs analytic projection (< 1e-12)',
    passed: e8 < 1e-12,
    relErr: e8,
    detailZh: `最坏相对误差 ${e8.toExponential(2)}；案例：xy 平面、斜平面、直线、含冗余基`,
    detailEn: `worst rel. err ${e8.toExponential(2)}; cases: xy-plane, oblique plane, line, redundant basis`,
  });

  return out;
}
