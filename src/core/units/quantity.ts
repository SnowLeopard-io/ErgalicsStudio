// ==========================================================================
// Ergalics Studio — physical quantities & unit algebra (core)
//
// A linear SI unit system: parse unit expressions ("km/h", "m/s^2",
// "J/(mol·K)"), carry dimension vectors, and convert between compatible
// units. Pure TypeScript — no React, no stores, no DOM.
//
// Temperature note: "°C"/"°F" are parsed as *differences* (Δ°C ≡ K, Δ°F ≡
// 5/9 K). Absolute (offset-based) temperature conversion is intentionally
// out of scope — mixing offsets with linear algebra is unsound.
// ==========================================================================

/** SI base dimension symbols, indexed 0..6. */
export const BASE_DIMENSIONS = ['m', 'kg', 's', 'A', 'K', 'mol', 'cd'] as const;

/** Dimension exponent vector, one entry per BASE_DIMENSIONS. */
export type Dims = Float64Array;

/** A parsed unit expression: SI-coherent scale factor + dimension vector. */
export interface ParsedUnit {
  /** Normalized expression (whitespace removed, '·'/'×' folded to '*'). */
  expr: string;
  /** Multiplicative factor from this unit to its SI-coherent base unit. */
  scale: number;
  /** Dimension exponents per BASE_DIMENSIONS. */
  dims: Dims;
}

/** A physical quantity: a numeric value plus the unit it is expressed in. */
export interface Quantity extends ParsedUnit {
  value: number;
}

// ---- unit tables -----------------------------------------------------------

const PREFIXES: Record<string, number> = {
  Q: 1e30, R: 1e27, Y: 1e24, Z: 1e21, E: 1e18, P: 1e15, T: 1e12,
  G: 1e9, M: 1e6, k: 1e3, h: 1e2, da: 1e1,
  d: 1e-1, c: 1e-2, m: 1e-3, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6,
  n: 1e-9, p: 1e-12, f: 1e-15, a: 1e-18, z: 1e-21, y: 1e-24,
};

// Longest prefixes first so "da" wins over "d"+"a…" lookups.
const PREFIX_ENTRIES = Object.keys(PREFIXES).sort((a, b) => b.length - a.length);

/** dims tuples are ordered [m, kg, s, A, K, mol, cd]. */
interface UnitDef {
  dims: number[];
  scale: number;
}

const UNITS: Record<string, UnitDef> = {
  // SI base
  m: { dims: [1, 0, 0, 0, 0, 0, 0], scale: 1 },
  kg: { dims: [0, 1, 0, 0, 0, 0, 0], scale: 1 },
  g: { dims: [0, 1, 0, 0, 0, 0, 0], scale: 1e-3 },
  s: { dims: [0, 0, 1, 0, 0, 0, 0], scale: 1 },
  A: { dims: [0, 0, 0, 1, 0, 0, 0], scale: 1 },
  K: { dims: [0, 0, 0, 0, 1, 0, 0], scale: 1 },
  mol: { dims: [0, 0, 0, 0, 0, 1, 0], scale: 1 },
  cd: { dims: [0, 0, 0, 0, 0, 0, 1], scale: 1 },
  // angles & dimensionless ratios
  rad: { dims: [0, 0, 0, 0, 0, 0, 0], scale: 1 },
  sr: { dims: [0, 0, 0, 0, 0, 0, 0], scale: 1 },
  '°': { dims: [0, 0, 0, 0, 0, 0, 0], scale: Math.PI / 180 },
  '%': { dims: [0, 0, 0, 0, 0, 0, 0], scale: 1e-2 },
  ppm: { dims: [0, 0, 0, 0, 0, 0, 0], scale: 1e-6 },
  // derived mechanical
  Hz: { dims: [0, 0, -1, 0, 0, 0, 0], scale: 1 },
  N: { dims: [1, 1, -2, 0, 0, 0, 0], scale: 1 },
  Pa: { dims: [-1, 1, -2, 0, 0, 0, 0], scale: 1 },
  bar: { dims: [-1, 1, -2, 0, 0, 0, 0], scale: 1e5 },
  atm: { dims: [-1, 1, -2, 0, 0, 0, 0], scale: 101325 },
  mmHg: { dims: [-1, 1, -2, 0, 0, 0, 0], scale: 133.322387415 },
  J: { dims: [2, 1, -2, 0, 0, 0, 0], scale: 1 },
  cal: { dims: [2, 1, -2, 0, 0, 0, 0], scale: 4.184 },
  eV: { dims: [2, 1, -2, 0, 0, 0, 0], scale: 1.602176634e-19 },
  W: { dims: [2, 1, -3, 0, 0, 0, 0], scale: 1 },
  // electromagnetic
  C: { dims: [0, 0, 1, 1, 0, 0, 0], scale: 1 },
  V: { dims: [2, 1, -3, -1, 0, 0, 0], scale: 1 },
  'Ω': { dims: [2, 1, -3, -2, 0, 0, 0], scale: 1 },
  ohm: { dims: [2, 1, -3, -2, 0, 0, 0], scale: 1 },
  S: { dims: [-2, -1, 3, 2, 0, 0, 0], scale: 1 },
  F: { dims: [-2, -1, 4, 2, 0, 0, 0], scale: 1 },
  T: { dims: [0, 1, -2, -1, 0, 0, 0], scale: 1 },
  Wb: { dims: [2, 1, -2, -1, 0, 0, 0], scale: 1 },
  H: { dims: [2, 1, -2, -2, 0, 0, 0], scale: 1 },
  // optical & radioactivity
  lm: { dims: [0, 0, 0, 0, 0, 0, 1], scale: 1 },
  lx: { dims: [-2, 0, 0, 0, 0, 0, 1], scale: 1 },
  Bq: { dims: [0, 0, -1, 0, 0, 0, 0], scale: 1 },
  Gy: { dims: [2, 0, -2, 0, 0, 0, 0], scale: 1 },
  // time
  min: { dims: [0, 0, 1, 0, 0, 0, 0], scale: 60 },
  h: { dims: [0, 0, 1, 0, 0, 0, 0], scale: 3600 },
  day: { dims: [0, 0, 1, 0, 0, 0, 0], scale: 86400 },
  yr: { dims: [0, 0, 1, 0, 0, 0, 0], scale: 31557600 },
  // volume & mass
  L: { dims: [3, 0, 0, 0, 0, 0, 0], scale: 1e-3 },
  t: { dims: [0, 1, 0, 0, 0, 0, 0], scale: 1e3 },
  Da: { dims: [0, 1, 0, 0, 0, 0, 0], scale: 1.66053906892e-27 },
  // temperature differences (see module note)
  '°C': { dims: [0, 0, 0, 0, 1, 0, 0], scale: 1 },
  '°F': { dims: [0, 0, 0, 0, 1, 0, 0], scale: 5 / 9 },
};

// ---- tokenizer -------------------------------------------------------------

/** Characters that may appear inside a unit name (letters, µ, °, %, Ω). */
const NAME_CHAR = /[A-Za-zµμ°%Ω]/;

interface Tok {
  kind: 'name' | 'mul' | 'div' | 'lparen' | 'rparen' | 'exp';
  text?: string;
  value?: number;
}

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (ch === '*' || ch === '·' || ch === '×') {
      toks.push({ kind: 'mul' });
      i += 1;
      continue;
    }
    if (ch === '/') {
      toks.push({ kind: 'div' });
      i += 1;
      continue;
    }
    if (ch === '(') {
      toks.push({ kind: 'lparen' });
      i += 1;
      continue;
    }
    if (ch === ')') {
      toks.push({ kind: 'rparen' });
      i += 1;
      continue;
    }
    if (ch === '^') {
      i += 1;
      let sign = 1;
      if (src[i] === '-') {
        sign = -1;
        i += 1;
      }
      const start = i;
      while (i < src.length && src[i] !== undefined && /[0-9]/.test(src[i]!)) i += 1;
      if (i === start) throw new Error(`unit parse error in "${src}": expected an exponent after "^"`);
      toks.push({ kind: 'exp', value: sign * Number(src.slice(start, i)) });
      continue;
    }
    if (NAME_CHAR.test(ch)) {
      const start = i;
      while (i < src.length && NAME_CHAR.test(src[i]!)) i += 1;
      toks.push({ kind: 'name', text: src.slice(start, i) });
      continue;
    }
    throw new Error(`unit parse error in "${src}": unexpected character "${ch}"`);
  }
  return toks;
}

// ---- parser ----------------------------------------------------------------

function zeros(): Dims {
  return new Float64Array(7);
}

function dimsFrom(list: number[]): Dims {
  const d = new Float64Array(7);
  for (let i = 0; i < 7; i += 1) d[i] = list[i] ?? 0;
  return d;
}

function scaleDims(d: Dims, exp: number): Dims {
  const out = new Float64Array(7);
  for (let i = 0; i < 7; i += 1) out[i] = d[i]! * exp;
  return out;
}

function combineDims(a: Dims, b: Dims, sign: 1 | -1): Dims {
  const out = new Float64Array(7);
  for (let i = 0; i < 7; i += 1) out[i] = a[i]! + sign * b[i]!;
  return out;
}

/** Resolve a raw name token into (dims, scale) — whole-unit match first,
 *  then one SI prefix. "m" is a meter, not a bare prefix; "mm" is milli·m. */
function resolveName(src: string, name: string): { dims: Dims; scale: number } {
  const whole = UNITS[name];
  if (whole) return { dims: dimsFrom(whole.dims), scale: whole.scale };
  for (const p of PREFIX_ENTRIES) {
    if (name.startsWith(p) && name.length > p.length) {
      const rest = UNITS[name.slice(p.length)];
      if (rest) return { dims: dimsFrom(rest.dims), scale: PREFIXES[p]! * rest.scale };
    }
  }
  throw new Error(`unknown unit "${name}" in "${src}"`);
}

class Parser {
  private pos = 0;

  constructor(
    private readonly src: string,
    private readonly toks: Tok[],
  ) {}

  static parse(src: string): ParsedUnit {
    const p = new Parser(src, tokenize(src));
    if (p.toks.length === 0) {
      return { expr: '', scale: 1, dims: zeros() };
    }
    const out = p.expr();
    if (p.pos !== p.toks.length) {
      throw new Error(`unit parse error in "${src}": unexpected trailing input`);
    }
    return { expr: src.replace(/[\s·×]/g, (m) => (m === '·' || m === '×' ? '*' : '')), scale: out.scale, dims: out.dims };
  }

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  private next(): Tok | undefined {
    return this.toks[this.pos++];
  }

  /** expr := term (('*'|'/') term)* */
  private expr(): { dims: Dims; scale: number } {
    let acc = this.term();
    for (;;) {
      const tok = this.peek();
      if (tok?.kind === 'mul') {
        this.pos += 1;
        const rhs = this.term();
        acc = { dims: combineDims(acc.dims, rhs.dims, 1), scale: acc.scale * rhs.scale };
      } else if (tok?.kind === 'div') {
        this.pos += 1;
        const rhs = this.term();
        acc = { dims: combineDims(acc.dims, rhs.dims, -1), scale: acc.scale / rhs.scale };
      } else {
        return acc;
      }
    }
  }

  /** term := ( '(' expr ')' | NAME ) ('^' int)? */
  private term(): { dims: Dims; scale: number } {
    let out: { dims: Dims; scale: number };
    const tok = this.next();
    if (tok?.kind === 'lparen') {
      out = this.expr();
      const close = this.next();
      if (close?.kind !== 'rparen') {
        throw new Error(`unit parse error in "${this.src}": expected ")"`);
      }
    } else if (tok?.kind === 'name' && tok.text) {
      out = resolveName(this.src, tok.text);
    } else {
      throw new Error(`unit parse error in "${this.src}": expected a unit name`);
    }
    const exp = this.peek();
    if (exp?.kind === 'exp') {
      this.pos += 1;
      out = { dims: scaleDims(out.dims, exp.value!), scale: Math.pow(out.scale, exp.value!) };
    }
    return out;
  }
}

// ---- public API ------------------------------------------------------------

/**
 * Parse a unit expression into an SI-coherent scale + dimension vector.
 * Supports `*` (or `·`/`×`), `/`, parentheses, integer exponents (`^2`,
 * `^-3`) and SI prefixes on any known unit.
 */
export function parseUnitExpr(expr: string): ParsedUnit {
  return Parser.parse(expr.trim());
}

/** Build a Quantity from a numeric value and a unit expression. */
export function quantity(value: number, unit: string): Quantity {
  const parsed = parseUnitExpr(unit);
  return { ...parsed, value };
}

/** True when two units share the same dimension vector. */
export function dimsMatch(a: Dims, b: Dims): boolean {
  for (let i = 0; i < 7; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Element-wise sum of two dimension vectors. */
export function dimsAdd(a: Dims, b: Dims): Dims {
  return combineDims(a, b, 1);
}

/** Element-wise difference of two dimension vectors. */
export function dimsSub(a: Dims, b: Dims): Dims {
  return combineDims(a, b, -1);
}

/** Product of two quantities; the resulting unit string is a·b verbatim. */
export function mulQty(a: Quantity, b: Quantity): Quantity {
  return {
    value: a.value * b.value,
    expr: a.expr ? `${a.expr}*${b.expr}` : b.expr,
    scale: a.scale * b.scale,
    dims: dimsAdd(a.dims, b.dims),
  };
}

/** Quotient of two quantities; the resulting unit string is a/b verbatim. */
export function divQty(a: Quantity, b: Quantity): Quantity {
  return {
    value: a.value / b.value,
    expr: b.expr ? `${a.expr}/${b.expr}` : a.expr,
    scale: a.scale / b.scale,
    dims: dimsSub(a.dims, b.dims),
  };
}

/** Sum of two quantities. `b` is converted into `a`'s unit; throws on
 *  dimension mismatch. */
export function addQty(a: Quantity, b: Quantity): Quantity {
  if (!dimsMatch(a.dims, b.dims)) {
    throw new Error(`cannot add "${a.expr}" and "${b.expr}": incompatible dimensions`);
  }
  return { ...a, value: a.value + b.value * (b.scale / a.scale) };
}

/** Dimension compatibility check between two parsed units/quantities. */
export function checkCompatible(a: ParsedUnit, b: ParsedUnit): boolean {
  return dimsMatch(a.dims, b.dims);
}

/** Convert a quantity to another unit of the same dimension; throws with a
 *  descriptive message when the dimensions do not match. */
export function convert(q: Quantity, target: string): Quantity {
  const t = parseUnitExpr(target);
  if (!dimsMatch(q.dims, t.dims)) {
    throw new Error(`cannot convert "${q.expr}" to "${t.expr}": incompatible dimensions`);
  }
  return { expr: t.expr, scale: t.scale, dims: t.dims, value: q.value * (q.scale / t.scale) };
}

/** Scale factor taking a value in unit `from` to unit `to` (same dimension). */
export function conversionFactor(from: string, to: string): number {
  const f = parseUnitExpr(from);
  const t = parseUnitExpr(to);
  if (!dimsMatch(f.dims, t.dims)) {
    throw new Error(`cannot convert "${from}" to "${to}": incompatible dimensions`);
  }
  return f.scale / t.scale;
}

/** Format a quantity for display, e.g. `9.81 m/s^2`. Values far from 1 fall
 *  back to exponential notation; trailing zeros are trimmed. */
export function formatQty(q: Quantity, digits = 6): string {
  const v = q.value;
  const num =
    Number.isFinite(v) && v !== 0 && (Math.abs(v) >= 1e6 || Math.abs(v) < 1e-4)
      ? v.toExponential(Math.max(0, digits - 1)).replace(/\.?0+e/, 'e')
      : Number(v.toPrecision(digits)).toString();
  return q.expr ? `${num} ${q.expr}` : num;
}
