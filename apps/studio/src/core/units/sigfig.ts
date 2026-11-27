// ==========================================================================
// Ergalics Studio — significant-figure rounding (utility core)
//
// String-based half-up rounding (no float artifacts): round by significant
// figures or by decimal places, and report both decimal and scientific
// notation plus the significant-digit count of the input.
//
// The invariant everything rests on: value = ±(digits as an integer) × 10^exp.
// When the digit string is re-aligned (padded to n digits, or n+1 after a
// carry) the exponent must shift with it — using the original exponent made
// every result that was not already "full width" wrong by a power of ten
// (1.5 → "15.0" instead of "1.50").
// ==========================================================================

/** Decomposed decimal literal: value = ±(digits as an integer) × 10^exp.
 *  digits never has leading zeros; for integer mantissas (no '.') trailing
 *  zeros are folded into the exponent so they stay insignificant. */
export interface Decomp {
  neg: boolean;
  digits: string;
  exp: number;
  /** Whether the mantissa carried an explicit decimal point. */
  hasPoint: boolean;
}

export function decompose(raw: string): Decomp | null {
  let s = raw.trim().replaceAll(/[,\s_]/g, '');
  if (s === '') return null;
  const neg = s.startsWith('-');
  if (neg || s.startsWith('+')) s = s.slice(1);
  // The decimal POINT is captured separately from the fraction: "1200." has
  // an empty fraction but the point makes its trailing zeros significant
  // (1200. → 4 digits, 1200 → 2).
  const m = /^(\d*)(?:(\.)(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) return null;
  const intPart = m[1] ?? '';
  const hasPoint = m[2] === '.';
  const fracPart = m[3] ?? '';
  if (intPart === '' && fracPart === '') return null;
  let exp = (m[4] ? Number(m[4]) : 0) - fracPart.length;
  let digits = (intPart + fracPart).replace(/^0+/, '') || '0';
  // Integer mantissa without a decimal point: trailing zeros carry no
  // significance — move them into the exponent (1200 → 12 × 10², count = 2).
  if (!hasPoint) {
    while (digits.length > 1 && digits.endsWith('0')) {
      digits = digits.slice(0, -1);
      exp += 1;
    }
  }
  return { neg, digits, exp, hasPoint };
}

/** Significant-digit count. Integer trailing zeros count only with an
 *  explicit decimal point (e.g. 1200 → 2, 1200. → 4, 1.200e3 → 4). */
export function sigCount(d: Decomp): number {
  const digits = d.hasPoint ? d.digits : d.digits.replace(/0+$/, '') || '0';
  return digits === '0' ? 1 : digits.length;
}

function addOne(digits: string): string {
  const out = digits.split('');
  let i = out.length - 1;
  for (; i >= 0; i -= 1) {
    if (out[i] === '9') out[i] = '0';
    else { out[i] = String(Number(out[i]) + 1); break; }
  }
  if (i < 0) out.unshift('1');
  return out.join('');
}

/** Round the significant digits of d to n digits, half-up. Returns the
 *  rounded digit string (n or n+1 chars when the carry overflows). */
export function roundSigDigits(d: Decomp, n: number): string {
  const D = d.digits;
  if (D === '0') return '0'.repeat(Math.max(1, n));
  let kept = D.slice(0, n);
  const next = D[n] ?? '0';
  if (next >= '5') kept = addOne(kept); // half-up
  while (kept.length < n) kept += '0';
  return kept;
}

/** Render R × 10^X as a plain decimal string. */
export function toDecimalString(R: string, X: number, neg: boolean): string {
  if (/^0+$/.test(R)) return '0';
  let out: string;
  if (X >= 0) {
    out = R + '0'.repeat(X);
  } else {
    const lead = -X - R.length;
    out = lead >= 0 ? `0.${'0'.repeat(lead)}${R}` : `${R.slice(0, R.length + X)}.${R.slice(R.length + X)}`;
  }
  return (neg ? '-' : '') + out;
}

/** Render R × 10^X as d.ddd × 10^E. */
export function toSciString(R: string, X: number, neg: boolean): string {
  if (/^0+$/.test(R)) return '0';
  const mant = `${R[0]}.${R.slice(1)}`;
  const E = X + R.length - 1;
  return `${neg ? '−' : ''}${mant} × 10^${E}`;
}

/** Round d to n decimal places, half-up. Result = R × 10^X with X = −n. */
export function roundDecimals(d: Decomp, n: number): { R: string; X: number } {
  const X = d.exp + n; // value × 10^n = digits × 10^X
  let Q: string;
  if (/^0+$/.test(d.digits)) {
    Q = '0';
  } else if (X >= 0) {
    Q = d.digits + '0'.repeat(X);
  } else {
    const cut = d.digits.length + X;
    if (cut > 0) {
      const kept = d.digits.slice(0, cut);
      const next = d.digits[cut] ?? '0';
      Q = next >= '5' ? addOne(kept) : kept;
    } else {
      // Whole value sits below the rounding position: half-up against 0.5,
      // i.e. digits × 10^X ≥ 5 × 10^(−X−1).
      Q = Number(d.digits) >= Number(`5e${-X - 1}`) ? '1' : '0';
    }
  }
  return { R: Q, X: -n };
}

export interface RoundResult {
  inputSf: number;
  decimal: string;
  sci: string;
  resultSf?: number;
}

/** Round a literal to n significant figures (half-up). */
export function roundToSigFigs(raw: string, n: number): RoundResult | null {
  const d = decompose(raw);
  if (!d) return null;
  const count = Math.min(Math.max(n, 1), 12);
  const R = roundSigDigits(d, count);
  // The invariant is value = digits × 10^exp. `R` is re-aligned to `count`
  // digits (padded with zeros, or count+1 after a carry), so the exponent
  // must shift by len(digits) − count to keep the value.
  const exp = d.exp + d.digits.length - count;
  return {
    inputSf: sigCount(d),
    decimal: toDecimalString(R, exp, d.neg),
    sci: toSciString(R, exp, d.neg),
  };
}

/** Round a literal to n decimal places (half-up). */
export function roundToDecimals(raw: string, n: number): RoundResult | null {
  const d = decompose(raw);
  if (!d) return null;
  const places = Math.min(Math.max(n, 0), 12);
  const { R, X } = roundDecimals(d, places);
  return {
    inputSf: sigCount(d),
    decimal: toDecimalString(R, X, d.neg),
    sci: toSciString(R, X, d.neg),
    resultSf: sigCount({ neg: d.neg, digits: R, exp: X, hasPoint: true }),
  };
}
