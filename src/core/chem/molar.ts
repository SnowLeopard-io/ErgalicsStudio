// ==========================================================================
// Ergalics Studio — chemical formula parsing (molar mass core)
//
// Pure, testable core of the Molar Mass utility: tokenizes a formula
// (nested parentheses / brackets, hydrate separators · · * ., leading
// multipliers, ionic charges) and resolves it against a standard atomic
// weight table (IUPAC 2021 conventional values, 118 elements).
//
// Two rules that are easy to get wrong and were wrong before:
//
//   * A leading multiplier scales the WHOLE formula unit that follows:
//     `2H2O` = 2 × H2O and `CuSO4·5H2O` = CuSO4 + 5 × H2O. Scaling only
//     the first element silently dropped the trailing oxygen.
//   * A trailing charge sign must not eat the stoichiometric subscript:
//     `NO3-` is nitrate (NO3), not NO. Only an explicit caret charge
//     (`SO4^2-`) may carry a number.
// ==========================================================================

/** Standard atomic weights (IUPAC 2021 conventional values), keyed by symbol. */
export const ATOMIC_MASS: Record<string, number> = {
  H: 1.008, He: 4.002602, Li: 6.94, Be: 9.0121831, B: 10.81, C: 12.011,
  N: 14.007, O: 15.999, F: 18.998403163, Ne: 20.1797, Na: 22.98976928,
  Mg: 24.305, Al: 26.9815385, Si: 28.085, P: 30.973761998, S: 32.06,
  Cl: 35.45, Ar: 39.948, K: 39.0983, Ca: 40.078, Sc: 44.955908,
  Ti: 47.867, V: 50.9415, Cr: 51.9961, Mn: 54.938044, Fe: 55.845,
  Co: 58.933194, Ni: 58.6934, Cu: 63.546, Zn: 65.38, Ga: 69.723,
  Ge: 72.63, As: 74.921595, Se: 78.971, Br: 79.904, Kr: 83.798,
  Rb: 85.4678, Sr: 87.62, Y: 88.90584, Zr: 91.224, Nb: 92.90637,
  Mo: 95.95, Tc: 98, Ru: 101.07, Rh: 102.9055, Pd: 106.42, Ag: 107.8682,
  Cd: 112.414, In: 114.818, Sn: 118.71, Sb: 121.76, Te: 127.6,
  I: 126.90447, Xe: 131.293, Cs: 132.90545196, Ba: 137.327, La: 138.90547,
  Ce: 140.116, Pr: 140.90766, Nd: 144.242, Pm: 145, Sm: 150.36,
  Eu: 151.964, Gd: 157.25, Tb: 158.92535, Dy: 162.5, Ho: 164.93033,
  Er: 167.259, Tm: 168.93422, Yb: 173.045, Lu: 174.9668, Hf: 178.49,
  Ta: 180.94788, W: 183.84, Re: 186.207, Os: 190.23, Ir: 192.217,
  Pt: 195.084, Au: 196.966569, Hg: 200.592, Tl: 204.38, Pb: 207.2,
  Bi: 208.9804, Po: 209, At: 210, Rn: 222, Fr: 223, Ra: 226,
  Ac: 227, Th: 232.0377, Pa: 231.03588, U: 238.02891, Np: 237,
  Pu: 244, Am: 243, Cm: 247, Bk: 247, Cf: 251, Es: 252, Fm: 257,
  Md: 258, No: 259, Lr: 262, Rf: 267, Db: 268, Sg: 269, Bh: 270,
  Hs: 269, Mt: 278, Ds: 281, Rg: 282, Cn: 285, Nh: 286, Fl: 289,
  Mc: 290, Lv: 293, Ts: 294, Og: 294,
};

type Tok =
  | { k: 'elem'; sym: string }
  | { k: 'num'; v: number }
  | { k: 'lp' }
  | { k: 'rp' }
  | { k: 'sep' };

export function tokenizeFormula(src: string): Tok[] {
  const s = src
    .replaceAll(/[·⋅*]/g, '.')
    // Strip a trailing charge. Only an EXPLICIT caret charge may carry a
    // number (SO4^2-); a bare sign keeps the stoichiometric subscript that
    // belongs to the element (NO3- must not become NO, NH4+ must not
    // become NH).
    .replace(/\^(?:\d+)?[+-]$/, '')
    .replace(/(\d)([+-])$/, '$1')
    .replace(/[+-]$/, '')
    .replaceAll(/\s+/g, '');
  if (s === '') throw new Error('empty');
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s.charAt(i);
    if (ch === '(' || ch === '[') { toks.push({ k: 'lp' }); i += 1; continue; }
    if (ch === ')' || ch === ']') { toks.push({ k: 'rp' }); i += 1; continue; }
    if (ch === '.') { toks.push({ k: 'sep' }); i += 1; continue; }
    if (/[0-9]/.test(ch)) {
      const m = /^[0-9]+/.exec(s.slice(i))!;
      toks.push({ k: 'num', v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Z]/.test(ch)) {
      // Case-sensitive greedy match: "Co" is cobalt, "CO" is C + O.
      const m = /^[A-Z][a-z]?/.exec(s.slice(i))!;
      toks.push({ k: 'elem', sym: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error(`unexpected "${ch}"`);
  }
  return toks;
}

class FormulaParser {
  private pos = 0;

  constructor(private readonly toks: Tok[]) {}

  parse(): Map<string, number> {
    const counts = this.group(1);
    if (this.pos !== this.toks.length) throw new Error('trailing tokens');
    return counts;
  }

  /** Parse a sequence until rparen/end. `scale` multiplies every atom in it. */
  private group(scale: number): Map<string, number> {
    const acc = new Map<string, number>();
    const add = (sym: string, n: number) => acc.set(sym, (acc.get(sym) ?? 0) + n);
    while (this.pos < this.toks.length) {
      const t = this.toks[this.pos];
      if (!t) return acc;
      if (t.k === 'rp') return acc;
      if (t.k === 'sep') { this.pos += 1; continue; }
      if (t.k === 'num') {
        // A leading multiplier scales the WHOLE formula unit that follows
        // (2H2O = 2 × H2O, CuSO4·5H2O = CuSO4 + 5 × H2O) — not just its
        // first element, which used to drop the trailing oxygen.
        this.pos += 1;
        const mult = t.v * scale;
        for (const [sym, n] of this.unit(mult)) add(sym, n);
        continue;
      }
      if (t.k === 'lp') {
        this.pos += 1;
        const inner = this.group(scale);
        this.expectRp();
        const c = this.peekCount();
        for (const [sym, n] of inner) add(sym, n * c);
        continue;
      }
      if (t.k === 'elem') {
        this.pos += 1;
        const c = this.peekCount();
        add(t.sym, scale * c);
        continue;
      }
    }
    return acc;
  }

  /**
   * Parse the atoms of ONE formula unit — elements and parenthesised groups,
   * each with its own count — up to a separator, a closing parenthesis or the
   * end of the input. `scale` multiplies every atom it produces.
   */
  private unit(scale: number): Map<string, number> {
    const acc = new Map<string, number>();
    const add = (sym: string, n: number) => acc.set(sym, (acc.get(sym) ?? 0) + n);
    while (this.pos < this.toks.length) {
      const t = this.toks[this.pos];
      if (!t || t.k === 'sep' || t.k === 'rp') return acc;
      if (t.k === 'lp') {
        this.pos += 1;
        const inner = this.group(scale);
        this.expectRp();
        const c = this.peekCount();
        for (const [sym, n] of inner) add(sym, n * c);
        continue;
      }
      if (t.k === 'elem') {
        this.pos += 1;
        const c = this.peekCount();
        add(t.sym, scale * c);
        continue;
      }
      if (t.k === 'num') {
        // A multiplier inside the unit (H2O in 5H2O) scales the rest of it.
        const mult = t.v * scale;
        this.pos += 1;
        for (const [sym, n] of this.unit(mult)) add(sym, n);
        continue;
      }
      return acc;
    }
    return acc;
  }

  private peekCount(): number {
    const t = this.toks[this.pos];
    if (t?.k === 'num') {
      this.pos += 1;
      return t.v;
    }
    return 1;
  }

  private expectRp(): void {
    if (this.toks[this.pos]?.k !== 'rp') throw new Error('missing )');
    this.pos += 1;
  }
}

export interface ElementBreakdown {
  sym: string;
  count: number;
  mass: number;
  share: number;
}

/** Element counts of a formula string (throws on an invalid formula). */
export function parseFormula(src: string): Map<string, number> {
  return new FormulaParser(tokenizeFormula(src)).parse();
}

/** Molar mass + per-element mass fractions of a formula string. */
export function analyzeFormula(src: string): { total: number; items: ElementBreakdown[] } {
  const counts = parseFormula(src);
  if (counts.size === 0) throw new Error('empty');
  const items: ElementBreakdown[] = [];
  let total = 0;
  for (const [sym, count] of counts) {
    const mass = ATOMIC_MASS[sym];
    if (mass === undefined) throw new Error(`unknown:${sym}`);
    total += mass * count;
    items.push({ sym, count, mass, share: 0 });
  }
  items.sort((a, b) => b.mass * b.count - a.mass * a.count);
  for (const item of items) item.share = total > 0 ? (item.mass * item.count) / total : 0;
  return { total, items };
}
