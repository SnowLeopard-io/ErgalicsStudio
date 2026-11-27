// ==========================================================================
// Ergalics Studio — numerics: scalar root finding
//
// Classic Brent-Dekker root finder (the `zeroin` algorithm from Brent 1973 /
// Forsythe-Malcolm-Moler): a guarded mixture of inverse quadratic
// interpolation, the secant rule and bisection. Guaranteed to converge for a
// continuous function on a sign-change bracket, at worst linearly (bisection)
// and typically superlinearly.
// ==========================================================================

import { NumericsError, assertFinite } from '../errors';

export interface BrentOptions {
  /** Absolute tolerance on the root location. Default 1e-12. */
  xtol?: number;
  /** Relative tolerance on the root location. Default 4 * machine epsilon. */
  rtol?: number;
  /** Maximum number of function evaluations. Default 100. */
  maxIter?: number;
}

export interface BrentResult {
  /** Located root. */
  x: number;
  /** Function value at the root (small but generally non-zero). */
  fx: number;
  /** Function evaluations consumed. */
  iterations: number;
  /** True when the bracket was reduced below the requested tolerance. */
  converged: boolean;
}

/**
 * Find a root of `f` on the bracket `[a, b]`.
 *
 * Throws `numerics/no-bracket` when f(a) and f(b) do not straddle zero
 * (the classic behaviour of `zeroin`), and `numerics/non-finite` if the
 * function returns NaN/Infinity anywhere in the bracket.
 */
export function brent(f: (x: number) => number, a: number, b: number, opts: BrentOptions = {}): BrentResult {
  requireNumbers(a, b);
  const xtol = opts.xtol ?? 1e-12;
  const rtol = opts.rtol ?? 4 * Number.EPSILON;
  const maxIter = opts.maxIter ?? 100;
  if (!(xtol >= 0) || !(rtol >= 0)) {
    throw new NumericsError('numerics/invalid-input', 'brent: xtol and rtol must be non-negative');
  }

  let fa = f(a);
  let fb = f(b);
  assertFinite([fa, fb], 'brent endpoints');
  if (fa === 0) return { x: a, fx: fa, iterations: 1, converged: true };
  if (fb === 0) return { x: b, fx: fb, iterations: 2, converged: true };
  if (fa * fb > 0) {
    throw new NumericsError('numerics/no-bracket', 'brent: f(a) and f(b) must have opposite signs', {
      a,
      b,
      fa,
      fb,
    });
  }

  // Classic Brent-Dekker state: b is the best estimate, c the previous
  // iterate (with f(c) of opposite sign to f(b)), e and d the step sizes of
  // the last two iterations.
  let c = a;
  let fc = fa;
  let d = b - a;
  let e = d;
  let iter = 2;

  for (iter = 2; iter <= maxIter; iter++) {
    if (fb * fc > 0) {
      // f(b) and f(c) same sign: reset the opposite-sign point to a.
      c = a;
      fc = fa;
      d = b - a;
      e = d;
    }
    if (Math.abs(fc) < Math.abs(fb)) {
      a = b;
      b = c;
      c = a;
      fa = fb;
      fb = fc;
      fc = fa;
    }
    const tol1 = 2 * rtol * Math.abs(b) + 0.5 * xtol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || fb === 0) {
      return { x: b, fx: fb, iterations: iter, converged: true };
    }

    // Try inverse quadratic interpolation / secant.
    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p: number;
      let q: number;
      if (a === c) {
        p = 2 * xm * s;
        q = 1 - s;
      } else {
        q = fa / fc;
        const r = fb / fc;
        p = s * (2 * xm * q * (q - r) - (b - a) * (r - 1));
        q = (q - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q;
      p = Math.abs(p);
      const min1 = 3 * xm * q - Math.abs(tol1 * q);
      const min2 = Math.abs(e * q);
      if (2 * p < Math.min(min1, min2)) {
        e = d;
        d = p / q;
      } else {
        d = xm;
        e = d;
      }
    } else {
      // Bisection.
      d = xm;
      e = d;
    }

    a = b;
    fa = fb;
    if (Math.abs(d) > tol1) b += d;
    else b += xm > 0 ? Math.abs(tol1) : -Math.abs(tol1);
    fb = f(b);
    assertFinite([fb], 'brent');
  }

  return { x: b, fx: fb, iterations: maxIter, converged: false };
}

/**
 * Find a bracket `[lo, hi]` around a root of `f`, expanding geometrically
 * from `x0` in both directions. Useful before calling `brent` when only a
 * starting point is known. Throws `numerics/no-bracket` if no sign change
 * is found within `maxExpand` doublings.
 */
export function findBracket(
  f: (x: number) => number,
  x0: number,
  initialStep = 1,
  maxExpand = 60,
): { lo: number; hi: number } {
  if (!Number.isFinite(x0)) {
    throw new NumericsError('numerics/invalid-input', 'findBracket: x0 must be finite');
  }
  const f0 = f(x0);
  assertFinite([f0], 'findBracket');
  if (f0 === 0) return { lo: x0, hi: x0 };
  let step = Math.abs(initialStep) > 0 ? Math.abs(initialStep) : 1;
  for (let i = 0; i < maxExpand; i++) {
    step *= 2;
    const right = x0 + step;
    const fHi = f(right);
    assertFinite([fHi], 'findBracket');
    if (f0 * fHi < 0) return { lo: x0, hi: right };
    const left = x0 - step;
    const fLo = f(left);
    assertFinite([fLo], 'findBracket');
    if (f0 * fLo < 0) return { lo: left, hi: x0 };
  }
  throw new NumericsError('numerics/no-bracket', 'findBracket: no sign change found', { x0, maxExpand });
}

function requireNumbers(...xs: number[]): void {
  for (const x of xs) {
    if (!Number.isFinite(x)) {
      throw new NumericsError('numerics/invalid-input', `brent: interval endpoints must be finite (got ${x})`);
    }
  }
}
