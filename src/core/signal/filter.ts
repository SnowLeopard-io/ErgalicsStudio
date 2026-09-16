// ==========================================================================
// Ergalics Studio — digital filtering (pure TS, data layer)
//
// Savitzky–Golay smoothing via precomputed least-squares convolution
// coefficients (the classic §-gram polynomial fit), plus centred/causal
// moving averages and a first-difference operator. Edge samples are handled
// by shrinking the window symmetrically rather than reflecting, so the
// output length always equals the input length.
// ==========================================================================

/** Solve A x = b for a small dense matrix A (Gaussian elimination, n ≤ 30). */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const m = A.map((row) => row.slice());
  const y = b.slice();
  for (let i = 0; i < n; i += 1) {
    let pivot = i;
    for (let r = i + 1; r < n; r += 1) {
      if (Math.abs(m[r]![i]!) > Math.abs(m[pivot]![i]!)) pivot = r;
    }
    [m[i], m[pivot]] = [m[pivot]!, m[i]!];
    [y[i], y[pivot]] = [y[pivot]!, y[i]!];
    const piv = m[i]![i]! || 1e-15;
    for (let r = i + 1; r < n; r += 1) {
      const f = m[r]![i]! / piv;
      for (let c = i; c < n; c += 1) m[r]![c] = m[r]![c]! - f * m[i]![c]!;
      y[r] = y[r]! - f * y[i]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let s = y[i]!;
    for (let c = i + 1; c < n; c += 1) s -= m[i]![c]! * x[c]!;
    x[i] = s / (m[i]![i]! || 1e-15);
  }
  return x;
}

/**
 * Savitzky–Golay convolution coefficients for a symmetric window of
 * `2half + 1` points fitted by a polynomial of degree `poly`.
 * The returned array is ordered t = −half … +half.
 */
export function savitzkyGolayCoeffs(half: number, poly: number): Float64Array {
  const size = 2 * half + 1;
  const order = Math.min(poly, size - 1);
  // The smoothed centre value is c₀, the constant polynomial coefficient:
  //   c = (JᵀJ)⁻¹ Jᵀ y  ⇒  h = J (JᵀJ)⁻¹ e₀,  e₀ = (1,0,…,0)
  // i.e. solve (JᵀJ) z = e₀ once, then h[t] = Σ_p t^p z[p]. Symmetric
  // t-lags make h symmetric and guarantee Σh = 1 (constant preservation).
  const Jte = new Array<number>(order + 1).fill(0);
  Jte[0] = 1;
  const JtJ: number[][] = Array.from({ length: order + 1 }, () =>
    new Array<number>(order + 1).fill(0),
  );
  for (let t = -half; t <= half; t += 1) {
    const tpows: number[] = [1];
    for (let p = 1; p <= order; p += 1) tpows.push(tpows[p - 1]! * t);
    for (let a = 0; a <= order; a += 1) {
      for (let b = 0; b <= order; b += 1) JtJ[a]![b]! += tpows[a]! * tpows[b]!;
    }
  }
  const c = solveLinear(JtJ, Jte);
  // Full-length filter c[t] = Σ_p coeff[p] t^p, but the smoothed centre
  // only needs the polynomial coefficients folded onto each lag.
  const h = new Float64Array(size);
  for (let i = 0; i < size; i += 1) {
    const t = i - half;
    let v = 0;
    let tp = 1;
    for (let p = 0; p <= order; p += 1) {
      v += c[p]! * tp;
      tp *= t;
    }
    h[i] = v;
  }
  return h;
}

export interface SgOptions {
  /** Full window length; must be odd and in [5, 51]. Default 11. */
  window?: number;
  /** Polynomial degree; 1–4 and < window. Default 2. */
  poly?: number;
}

/**
 * Savitzky–Golay smoothing filter. Preserves polynomial content of degree
 * ≤ `poly` exactly (coefficients sum to 1). Window shrinks near the edges.
 */
export function savitzkyGolay(x: ArrayLike<number>, opts: SgOptions = {}): Float64Array {
  const n = x.length;
  const win = opts.window ?? 11;
  const poly = opts.poly ?? 2;
  if (win < 5 || win > 51 || win % 2 === 0) {
    throw new Error('savitzkyGolay: window must be odd and between 5 and 51');
  }
  if (poly < 1 || poly > 4 || poly >= win) {
    throw new Error('savitzkyGolay: poly must be in [1,4] and smaller than window');
  }
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    // Shrink the half-width symmetrically at the boundaries.
    let half = (win - 1) / 2;
    while (i - half < 0 || i + half >= n) half -= 1;
    if (half < 1) {
      out[i] = x[i]!;
      continue;
    }
    const h = savitzkyGolayCoeffs(half, poly);
    let v = 0;
    for (let j = 0; j < h.length; j += 1) v += h[j]! * x[i - half + j]!;
    out[i] = v;
  }
  return out;
}

/**
 * Centred moving average of odd window length. Equivalent to a degree-0
 * Savitzky–Golay filter but O(n) (the constant kernel is just 1/win).
 */
export function movingAverage(x: ArrayLike<number>, window = 5, causal = false): Float64Array {
  const n = x.length;
  if (window < 1) throw new Error('movingAverage: window must be ≥ 1');
  const out = new Float64Array(n);
  if (causal) {
    let s = 0;
    for (let i = 0; i < n; i += 1) {
      s += x[i]!;
      if (i >= window) s -= x[i - window]!;
      const cnt = Math.min(i + 1, window);
      out[i] = s / cnt;
    }
    return out;
  }
  const half = (window - 1) / 2;
  for (let i = 0; i < n; i += 1) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let s = 0;
    for (let j = lo; j <= hi; j += 1) s += x[j]!;
    out[i] = s / (hi - lo + 1);
  }
  return out;
}

/** First difference y[i] = x[i] − x[i−1]; output length n−1. */
export function diff(x: ArrayLike<number>): Float64Array {
  const out = new Float64Array(Math.max(0, x.length - 1));
  for (let i = 1; i < x.length; i += 1) out[i - 1] = x[i]! - x[i - 1]!;
  return out;
}
