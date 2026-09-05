// ==========================================================================
// Ergalics Studio — statistical special functions
//
// Gamma / beta / error-function families plus the normal, Student's t,
// chi-square and F distributions with CDFs and inverse-CDFs, all implemented
// from first principles (no external math dependency). This keeps the entire
// stats kernel pure TypeScript and lets every routine be unit-tested against
// scipy / R reference values.
//
// References: Lanczos (1964) for ln Γ; Numerical Recipes `gammainc` /
// `betacf` continued fractions for the regularized incomplete gamma / beta;
// Acklam (2003) for the inverse normal CDF; Student's-t and F CDFs reduce to
// the regularized incomplete beta, and chi-square to the incomplete gamma.
// ==========================================================================

const LOG_SQRT_2PI = Math.log(2 * Math.PI) / 2;
const FPMIN = 1e-300;

/** ln Γ(x) via the Lanczos approximation (accurate to ~1e-12 for x > 0). */
export function logGamma(x: number): number {
  // Reflection for 0 < x < 0.5.
  if (x < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const n = g + 2;
  let y = x - 1;
  let a = c[0]!;
  for (let i = 1; i < n; i += 1) a += c[i]! / (y + i);
  const t = y + g + 0.5;
  return LOG_SQRT_2PI + (x - 0.5) * Math.log(t) - t + Math.log(a);
}

/** Regularized lower incomplete gamma P(s, x) = γ(s,x)/Γ(s). */
export function regularizedIncompleteGammaLower(s: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= s + 1) return 1 - regularizedIncompleteGammaUpper(s, x);
  const gln = logGamma(s);
  let ap = s;
  let sum = 1 / s;
  let del = sum;
  for (let n = 1; n <= 1000; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-15) break;
  }
  return sum * Math.exp(-x + s * Math.log(x) - gln);
}

function regularizedIncompleteGammaUpper(s: number, x: number): number {
  const gln = logGamma(s);
  let b = x + 1 - s;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 1000; i += 1) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + s * Math.log(x) - gln) * h;
}

/** Regularized incomplete beta I_x(a, b). */
export function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // Symmetry branch: when x is close to 1 the `front` term underflows
  // (log(1-x)*b → -∞), so evaluate the complement and flip. This keeps the
  // F / Student-t tails accurate for large quantiles.
  if (x > (a + 1) / (a + b + 2)) {
    return 1 - regularizedIncompleteBeta(1 - x, b, a);
  }
  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  const m2Max = 1000;
  for (let m = 1; m <= m2Max; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h * front;
}

/** Error function erf(x), via P(1/2, x^2). */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  return sign * regularizedIncompleteGammaLower(0.5, ax * ax);
}

/** Standard normal CDF. */
export function normalCdf(x: number, mu = 0, sigma = 1): number {
  return 0.5 * (1 + erf((x - mu) / (sigma * Math.SQRT2)));
}

/** Inverse standard normal CDF (quantile), Acklam's rational approximation. */
export function normalInv(p: number, mu = 0, sigma = 1): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q: number;
  let r: number;
  let z: number;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    z = horner(c, q) / (q * horner(d, q) + 1);
  } else if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    z = (horner(a, r) * q) / (r * horner(b, r) + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    z = -horner(c, q) / (q * horner(d, q) + 1);
  }
  return mu + sigma * z;
}

/** Horner evaluation of a polynomial (coefficients in ascending power order). */
function horner(coeffs: number[], x: number): number {
  let acc = coeffs[0]!;
  for (let i = 1; i < coeffs.length; i += 1) acc = acc * x + coeffs[i]!;
  return acc;
}

/** Student's-t CDF. */
export function studentTCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const ib = 0.5 * regularizedIncompleteBeta(x, df / 2, 0.5);
  return t > 0 ? 1 - ib : ib;
}

/** Student's-t quantile (inverse CDF) by bisection on `studentTCdf`. */
export function studentTInv(p: number, df: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  // Seed the bracket with the normal quantile, then widen.
  const z = normalInv(p);
  let lo = z - 20;
  let hi = z + 20;
  for (let i = 0; i < 300; i += 1) {
    const mid = (lo + hi) / 2;
    if (studentTCdf(mid, df) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Chi-square CDF with `k` degrees of freedom. */
export function chiSquareCdf(x: number, k: number): number {
  if (x <= 0) return 0;
  return regularizedIncompleteGammaLower(k / 2, x / 2);
}

/** Chi-square quantile by bisection on `chiSquareCdf`. */
export function chiSquareInv(p: number, k: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = 1e6;
  for (let i = 0; i < 300; i += 1) {
    const mid = (lo + hi) / 2;
    if (chiSquareCdf(mid, k) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** F-distribution CDF with `d1`, `d2` degrees of freedom. */
export function fCdf(x: number, d1: number, d2: number): number {
  if (x <= 0) return 0;
  const z = (d1 * x) / (d1 * x + d2);
  return regularizedIncompleteBeta(z, d1 / 2, d2 / 2);
}

/** F-distribution quantile by bisection on `fCdf`. */
export function fInv(p: number, d1: number, d2: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return Infinity;
  let lo = 0;
  let hi = 1e6;
  for (let i = 0; i < 300; i += 1) {
    const mid = (lo + hi) / 2;
    if (fCdf(mid, d1, d2) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
