// ==========================================================================
// math-domaincolor — complex function numerics (pure, dependency-free, testable)
//
// A small complex-arithmetic layer, a recursive-descent parser that compiles
// complex-valued expressions in z into closure trees (so per-pixel evaluation
// is a chain of closures, no re-parsing), the argument-principle winding
// number of f along a circle, and the HSV domain-coloring map (hue = arg f,
// value = log₂|f| bands with optional iso-line darkening).
//
// All functions are pure so the kernel unit-tests without a canvas or DOM.
// ==========================================================================

// ---- complex arithmetic -----------------------------------------------------

export interface Complex {
  re: number;
  im: number;
}

export function cx(re: number, im: number): Complex {
  return { re, im };
}

export const C_ZERO: Complex = cx(0, 0);
export const C_ONE: Complex = cx(1, 0);

export function cAdd(a: Complex, b: Complex): Complex {
  return cx(a.re + b.re, a.im + b.im);
}
export function cSub(a: Complex, b: Complex): Complex {
  return cx(a.re - b.re, a.im - b.im);
}
export function cMul(a: Complex, b: Complex): Complex {
  return cx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
}
export function cScale(a: Complex, k: number): Complex {
  return cx(a.re * k, a.im * k);
}
/** Smith's algorithm — numerically robust division. */
export function cDiv(a: Complex, b: Complex): Complex {
  if (Math.abs(b.re) >= Math.abs(b.im)) {
    const r = b.im / b.re;
    const d = b.re + r * b.im;
    return cx((a.re + r * a.im) / d, (a.im - r * a.re) / d);
  }
  const r = b.re / b.im;
  const d = b.im + r * b.re;
  return cx((a.re * r + a.im) / d, (a.im * r - a.re) / d);
}
export function cNeg(a: Complex): Complex {
  return cx(-a.re, -a.im);
}
export function cAbs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}
export function cArg(a: Complex): number {
  return Math.atan2(a.im, a.re);
}

/** Principal complex exponential e^z. */
export function cExp(a: Complex): Complex {
  const m = Math.exp(a.re);
  return cx(m * Math.cos(a.im), m * Math.sin(a.im));
}
/** Principal branch of the complex logarithm (arg ∈ (−π, π]). */
export function cLog(a: Complex): Complex {
  return cx(Math.log(cAbs(a)), cArg(a));
}
export function cSin(a: Complex): Complex {
  return cx(Math.sin(a.re) * Math.cosh(a.im), Math.cos(a.re) * Math.sinh(a.im));
}
export function cCos(a: Complex): Complex {
  return cx(Math.cos(a.re) * Math.cosh(a.im), -Math.sin(a.re) * Math.sinh(a.im));
}
export function cTan(a: Complex): Complex {
  return cDiv(cSin(a), cCos(a));
}
export function cSinh(a: Complex): Complex {
  return cx(Math.sinh(a.re) * Math.cos(a.im), Math.cosh(a.re) * Math.sin(a.im));
}
export function cCosh(a: Complex): Complex {
  return cx(Math.cosh(a.re) * Math.cos(a.im), Math.sinh(a.re) * Math.sin(a.im));
}
export function cTanh(a: Complex): Complex {
  return cDiv(cSinh(a), cCosh(a));
}
export function cSqrt(a: Complex): Complex {
  const r = cAbs(a);
  if (r === 0) return C_ZERO;
  const re = Math.sqrt((r + a.re) / 2);
  const im = Math.sign(a.im || 1) * Math.sqrt((r - a.re) / 2);
  return cx(re, im);
}
export function cConj(a: Complex): Complex {
  return cx(a.re, -a.im);
}

/**
 * Complex power a^b. Integer exponents use exact repeated multiplication
 * (binary exponentiation) so z^3 never touches the log branch cut; general
 * exponents go through the principal logarithm.
 */
export function cPow(a: Complex, b: Complex): Complex {
  if (b.im === 0 && Number.isInteger(b.re) && Math.abs(b.re) <= 512) {
    const n = b.re;
    if (n === 0) return C_ONE;
    if (n < 0) {
      // 0^(−n) = +∞ on the positive real axis; going through cDiv would
      // produce a NaN instead of the mathematically correct limit.
      if (a.re === 0 && a.im === 0) return { re: Infinity, im: 0 };
      return cPow(cDiv(C_ONE, a), cx(-n, 0));
    }
    let result = C_ONE;
    let base = a;
    let k = n;
    while (k > 0) {
      if (k % 2 === 1) result = cMul(result, base);
      base = cMul(base, base);
      k = Math.floor(k / 2);
    }
    return result;
  }
  if (a.re === 0 && a.im === 0) return C_ZERO;
  return cExp(cMul(b, cLog(a)));
}

// ---- expression parser (recursive descent → closure tree) ---------------------

type Node = (z: Complex) => Complex;

interface Token {
  kind: 'num' | 'ident' | 'op' | 'lparen' | 'rparen';
  text: string;
  value?: number;
}

const FUNCTIONS: Record<string, (z: Complex) => Complex> = {
  exp: cExp,
  ln: cLog,
  log: cLog,
  sin: cSin,
  cos: cCos,
  tan: cTan,
  sinh: cSinh,
  cosh: cCosh,
  tanh: cTanh,
  sqrt: cSqrt,
  abs: (z) => cx(cAbs(z), 0),
  arg: (z) => cx(cArg(z), 0),
  conj: cConj,
  re: (z) => cx(z.re, 0),
  im: (z) => cx(z.im, 0),
};

const CONSTANTS: Record<string, Complex> = {
  i: cx(0, 1),
  pi: cx(Math.PI, 0),
  e: cx(Math.E, 0),
};

function tokenize(src: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const match = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!match) return null;
      tokens.push({ kind: 'num', text: match[0], value: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (/[a-zA-Z_]/.test(ch)) {
      const match = /^[a-zA-Z_][a-zA-Z_0-9]*/.exec(src.slice(i))!;
      tokens.push({ kind: 'ident', text: match[0].toLowerCase() });
      i += match[0].length;
      continue;
    }
    if ('+-*/^'.includes(ch)) {
      tokens.push({ kind: 'op', text: ch });
      i += 1;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', text: ch });
      i += 1;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', text: ch });
      i += 1;
      continue;
    }
    return null; // unsupported character
  }
  return tokens;
}

/**
 * Parse a complex-valued expression in `z` into an evaluation closure.
 * Grammar (right-associative ^, unary ±, implicit multiplication for
 * `2i`, `2(z…)` and `) (` forms):
 *   expr   := term (('+'|'-') term)*
 *   term   := unary (('*'|'/') unary | <implicit> unary)*
 *   unary  := ('+'|'-') unary | power
 *   power  := primary ('^' unary)?
 *   primary:= number | ident | ident '(' expr ')' | '(' expr ')'
 * Supported identifiers: z, i, pi, e and the FUNCTIONS above.
 */
export function compileComplex(src: string): { ok: true; fn: (z: Complex) => Complex } | { ok: false; error: string } {
  const tokens = tokenize(src);
  if (!tokens || tokens.length === 0) return { ok: false, error: 'invalid or empty expression' };
  let pos = 0;

  const peek = (): Token | undefined => tokens[pos];
  const next = (): Token | undefined => tokens[pos++];

  const parseExpr = (): Node | string => {
    let left = parseTerm();
    if (typeof left === 'string') return left;
    for (;;) {
      const t = peek();
      if (t && t.kind === 'op' && (t.text === '+' || t.text === '-')) {
        next();
        const right = parseTerm();
        if (typeof right === 'string') return right;
        const l: Node = left;
        const r: Node = right;
        left = t.text === '+' ? (z) => cAdd(l(z), r(z)) : (z) => cSub(l(z), r(z));
      } else {
        return left;
      }
    }
  };

  const startsPrimary = (t: Token | undefined): boolean =>
    !!t && (t.kind === 'num' || t.kind === 'ident' || t.kind === 'lparen');

  const parseTerm = (): Node | string => {
    let left = parseUnary();
    if (typeof left === 'string') return left;
    for (;;) {
      const t = peek();
      if (t && t.kind === 'op' && (t.text === '*' || t.text === '/')) {
        next();
        const right = parseUnary();
        if (typeof right === 'string') return right;
        const l: Node = left;
        const r: Node = right;
        left = t.text === '*' ? (z) => cMul(l(z), r(z)) : (z) => cDiv(l(z), r(z));
      } else if (startsPrimary(t)) {
        // implicit multiplication: 2i, 2z, z(z+1), (z+1)(z-1), 2pi …
        const right = parseUnary();
        if (typeof right === 'string') return right;
        const l: Node = left;
        const r: Node = right;
        left = (z) => cMul(l(z), r(z));
      } else {
        return left;
      }
    }
  };

  const parseUnary = (): Node | string => {
    const t = peek();
    if (t && t.kind === 'op' && (t.text === '-' || t.text === '+')) {
      next();
      const operand = parseUnary();
      if (typeof operand === 'string') return operand;
      return t.text === '-' ? (z) => cNeg(operand(z)) : operand;
    }
    return parsePower();
  };

  const parsePower = (): Node | string => {
    const base = parsePrimary();
    if (typeof base === 'string') return base;
    const t = peek();
    if (t && t.kind === 'op' && t.text === '^') {
      next();
      // right-associative; allow -z^2 = -(z^2) via unary on the exponent
      const exp = parseUnary();
      if (typeof exp === 'string') return exp;
      return (z) => cPow(base(z), exp(z));
    }
    return base;
  };

  const parsePrimary = (): Node | string => {
    const t = next();
    if (!t) return 'unexpected end of expression';
    if (t.kind === 'num') {
      const v = t.value ?? 0;
      return () => cx(v, 0);
    }
    if (t.kind === 'ident') {
      const name = t.text;
      if (name === 'z') return (z) => z;
      if (name in CONSTANTS) {
        const c = CONSTANTS[name]!;
        return () => c;
      }
      if (name in FUNCTIONS) {
        if (!peek() || peek()!.kind !== 'lparen') return `function '${name}' needs parentheses`;
        next(); // consume '('
        const arg = parseExpr();
        if (typeof arg === 'string') return arg;
        if (!peek() || peek()!.kind !== 'rparen') return `missing ')' after ${name}(…`;
        next();
        const f = FUNCTIONS[name]!;
        return (z) => f(arg(z));
      }
      return `unknown identifier '${t.text}'`;
    }
    if (t.kind === 'lparen') {
      const inner = parseExpr();
      if (typeof inner === 'string') return inner;
      if (!peek() || peek()!.kind !== 'rparen') return "missing ')'";
      next();
      return inner;
    }
    return `unexpected token '${t.text}'`;
  };

  const root = parseExpr();
  if (typeof root === 'string') return { ok: false, error: root };
  if (pos !== tokens.length) return { ok: false, error: `unexpected token '${tokens[pos]!.text}'` };
  return { ok: true, fn: root };
}

// ---- argument principle --------------------------------------------------------

/**
 * Winding number of f around 0 along the circle |z − center| = radius,
 * computed by sampled unwrapped argument accumulation (argument principle):
 * W = Δarg f / 2π = #zeros − #poles inside the loop.
 * Returns NaN when f is zero or non-finite on the sampled loop.
 */
export function windingNumber(
  f: (z: Complex) => Complex,
  center: Complex,
  radius: number,
  samples = 720,
): number {
  let prev = NaN;
  let total = 0;
  for (let k = 0; k <= samples; k += 1) {
    const th = (2 * Math.PI * (k % samples)) / samples;
    const z = cx(center.re + radius * Math.cos(th), center.im + radius * Math.sin(th));
    const v = f(z);
    const mag2 = v.re * v.re + v.im * v.im;
    // The argument principle needs f finite and nonvanishing on the loop.
    // |f| beyond 1e12 (numerically on a pole) or below 1e-12 (numerically on
    // a zero — floating point rarely hits either exactly) means the loop
    // choice is invalid, so report NaN instead of a meaningless count.
    if (!Number.isFinite(mag2) || mag2 > 1e24 || mag2 < 1e-24) return NaN;
    const a = cArg(v);
    if (k === 0) {
      prev = a;
      continue;
    }
    let d = a - prev;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d <= -Math.PI) d += 2 * Math.PI;
    total += d;
    prev = a;
  }
  return total / (2 * Math.PI);
}

/** Rounded winding count (zeros − poles inside the loop); NaN passes through. */
export function windingCount(f: (z: Complex) => Complex, center: Complex, radius: number, samples = 720): number {
  const w = windingNumber(f, center, radius, samples);
  if (!Number.isFinite(w)) return NaN;
  const r = Math.round(w);
  return r === 0 ? 0 : r; // normalize −0 from rounding tiny negative noise
}

// ---- domain coloring ------------------------------------------------------------

/** HSV → RGB, all inputs in [0, 1); returns 8-bit channels. */
export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 1) + 1) % 1;
  const i = Math.floor(hh * 6);
  const f = hh * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  let r = 0;
  let g = 0;
  let b = 0;
  switch (i % 6) {
    case 0:
      r = v;
      g = t;
      b = p;
      break;
    case 1:
      r = q;
      g = v;
      b = p;
      break;
    case 2:
      r = p;
      g = v;
      b = t;
      break;
    case 3:
      r = p;
      g = q;
      b = v;
      break;
    case 4:
      r = t;
      g = p;
      b = v;
      break;
    default:
      r = v;
      g = p;
      b = q;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * Domain-coloring shade of one value f(z):
 *   hue   = arg f mapped over the color wheel,
 *   value = 0.55 + 0.45·frac(log₂|f|) — brightness bands repeat every factor
 *           of two in magnitude (log-dark contour rings),
 *   with `contour` on, thin dark lines are added at |f| = 2^k and at
 *   arg f = k·π/8 (constant-phase sectors).
 * Poles render white, zeros render black.
 */
export function shadePixel(fz: Complex, contour: boolean): [number, number, number] {
  if (!Number.isFinite(fz.re) || !Number.isFinite(fz.im)) return [255, 255, 255];
  const mag = Math.hypot(fz.re, fz.im);
  if (mag === 0) return [0, 0, 0];
  const arg = Math.atan2(fz.im, fz.re);
  const hue = (arg + Math.PI) / (2 * Math.PI);
  const s = Math.log2(mag);
  const frac = s - Math.floor(s);
  let v = 0.55 + 0.45 * frac;
  if (contour) {
    const edge = Math.min(frac, 1 - frac);
    v *= 0.45 + 0.55 * Math.min(1, edge * 12);
    const sector = arg / (Math.PI / 8);
    const sf = sector - Math.round(sector);
    v *= 0.75 + 0.25 * Math.min(1, Math.abs(sf) * 8);
  }
  return hsvToRgb(hue, 0.85, Math.min(1, v));
}

// ---- embedded validation benchmarks ------------------------------------------------

export const DOMAINCOLOR_BENCHMARK_ID = 'domaincolor-benchmarks';

export interface DomaincolorBenchmark {
  id: string;
  labelEn: string;
  labelZh: string;
  passed: boolean;
  /** Unified relative error |computed − analytic|/|analytic|. */
  relErr: number;
  measured: number;
  reference: number;
  detailEn: string;
  detailZh: string;
}

interface ParserCheck {
  expr: string;
  re: number;
  im: number;
}

/** f(i) = re + i·im closed-form reference values for the parser benchmark. */
const PARSER_CHECKS: ParserCheck[] = [
  { expr: 'z^3 - 1', re: -1, im: -1 },
  { expr: 'exp(1/z)', re: Math.cos(1), im: -Math.sin(1) },
  { expr: 'sin(z)/z', re: Math.sinh(1), im: 0 },
  { expr: '2i + 1', re: 1, im: 2 },
  { expr: 'exp(pi*i)', re: -1, im: 0 },
  { expr: 'sqrt(4*i*i)', re: 0, im: 2 }, // sqrt(−4) = 2i (principal branch)
  { expr: 'pi*e', re: Math.PI * Math.E, im: 0 },
];

/**
 * Run the embedded validation suite: argument-principle winding counts and
 * parser correctness. All checks use |computed − analytic|/|analytic|.
 */
export function runDomaincolorBenchmarks(): DomaincolorBenchmark[] {
  const out: DomaincolorBenchmark[] = [];

  // ① Winding of z³−1 on a circle enclosing its three unit-modulus zeros.
  const f1 = compileComplex('z^3 - 1');
  const w1 = f1.ok ? windingCount(f1.fn, cx(0, 0), 1.2, 1024) : NaN;
  out.push({
    id: 'winding-z3m1',
    labelEn: 'Argument principle: wind(z³−1) = 3',
    labelZh: '辐角原理：wind(z³−1) = 3',
    passed: w1 === 3,
    relErr: Number.isFinite(w1) ? Math.abs(w1 - 3) / 3 : NaN,
    measured: w1,
    reference: 3,
    detailEn: `winding on |z| = 1.2 loop enclosing the three unit zeros: ${w1} (Cauchy's argument principle)`,
    detailZh: `沿 |z| = 1.2 回路（包围三个模 1 零点）的绕数：${w1}（Cauchy 辐角原理）`,
  });

  // ② exp(z)/z: exp is zero-free and the division contributes one simple
  // pole at 0 → the argument principle gives Z − P = 0 − 1 = −1.
  const f2 = compileComplex('exp(z)/z');
  const w2 = f2.ok ? windingCount(f2.fn, cx(0, 0), 1, 1024) : NaN;
  out.push({
    id: 'winding-expz',
    labelEn: 'Argument principle: wind(exp z / z) = −1',
    labelZh: '辐角原理：wind(exp z / z) = −1',
    passed: w2 === -1,
    relErr: Number.isFinite(w2) ? Math.abs(w2 + 1) : NaN,
    measured: w2,
    reference: -1,
    detailEn: '0 zeros (exp is zero-free) − 1 pole (z=0) → winding −1; measured ' + String(w2),
    detailZh: '零点 0 个（exp 无零点）− 极点 1 个（z=0）→ 绕数 −1；实测 ' + String(w2),
  });

  // ③ (z²−1)/(z²+1): two zeros (±1), two poles (±i) → net winding 0.
  const f3 = compileComplex('(z^2 - 1)/(z^2 + 1)');
  const w3 = f3.ok ? windingCount(f3.fn, cx(0, 0), 1.3, 1024) : NaN;
  out.push({
    id: 'winding-rational',
    labelEn: 'Argument principle: wind((z²−1)/(z²+1)) = 0',
    labelZh: '辐角原理：wind((z²−1)/(z²+1)) = 0',
    passed: w3 === 0,
    relErr: Number.isFinite(w3) ? Math.abs(w3) : NaN,
    measured: w3,
    reference: 0,
    detailEn: '2 zeros (±1) − 2 poles (±i) inside |z| = 1.3 → net winding 0; measured ' + String(w3),
    detailZh: '|z| = 1.3 内 2 个零点（±1）− 2 个极点（±i）→ 净绕数 0；实测 ' + String(w3),
  });

  // ④ Parser correctness: f(i) (and two special points) vs closed forms.
  let parserErr = 0;
  let parserOk = true;
  const special: Array<{ expr: string; z: Complex; re: number; im: number }> = [
    { expr: '(z^2 - 1)/(z^2 + 1)', z: cx(0, 2), re: 5 / 3, im: 0 },
    { expr: 'z^2', z: cx(1, 1), re: 0, im: 2 },
  ];
  for (const chk of PARSER_CHECKS) {
    const compiled = compileComplex(chk.expr);
    if (!compiled.ok) {
      parserOk = false;
      parserErr = Infinity;
      break;
    }
    const v = compiled.fn(cx(0, 1));
    const scale = Math.max(1, Math.hypot(chk.re, chk.im));
    parserErr = Math.max(parserErr, Math.hypot(v.re - chk.re, v.im - chk.im) / scale);
  }
  for (const sp of special) {
    const compiled = compileComplex(sp.expr);
    if (!compiled.ok) {
      parserOk = false;
      parserErr = Infinity;
      break;
    }
    const v = compiled.fn(sp.z);
    const scale = Math.max(1, Math.hypot(sp.re, sp.im));
    parserErr = Math.max(parserErr, Math.hypot(v.re - sp.re, v.im - sp.im) / scale);
  }
  out.push({
    id: 'parser-closed-form',
    labelEn: 'Parser f(i) vs closed forms (< 1e-12)',
    labelZh: '解析器 f(i) 闭式对照（< 1e-12）',
    passed: parserOk && parserErr < 1e-12,
    relErr: parserErr,
    measured: parserErr,
    reference: 0,
    detailEn: `max relative deviation over ${PARSER_CHECKS.length + special.length} expressions: ${parserErr.toExponential(2)}`,
    detailZh: `${PARSER_CHECKS.length + special.length} 个表达式的最大相对偏差：${parserErr.toExponential(2)}`,
  });

  return out;
}
