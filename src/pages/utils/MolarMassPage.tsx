// ==========================================================================
// Ergalics Studio — Molar Mass (utility toolkit)
//
// Parses a chemical formula (nested parentheses / brackets, hydrate
// separators · · * ., leading multipliers) against a standard atomic weight
// table (IUPAC 2021 conventional values, 118 elements) and reports the
// molar mass plus per-element mass fractions.
// ==========================================================================

import { useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';

/** Standard atomic weights (IUPAC 2021 conventional values), keyed by symbol. */
const ATOMIC_MASS: Record<string, number> = {
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

function tokenizeFormula(src: string): Tok[] {
  const s = src
    .replaceAll(/[·⋅*]/g, '.')
    .replace(/[\^]?[0-9]*[+-]$/, '') // strip a trailing charge like ^2- / + / 3+
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
        // Multiplier in front of a unit: 2H2O, CuSO4·5H2O.
        this.pos += 1;
        const mult = t.v * scale;
        const nt = this.toks[this.pos];
        if (nt?.k === 'elem') {
          this.pos += 1;
          const c = this.peekCount();
          add(nt.sym, mult * c);
        } else if (nt?.k === 'lp') {
          this.pos += 1;
          const inner = this.group(mult);
          this.expectRp();
          const c = this.peekCount();
          for (const [sym, n] of inner) add(sym, n * c);
        } else {
          throw new Error('dangling multiplier');
        }
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

export function analyzeFormula(src: string): { total: number; items: ElementBreakdown[] } {
  const counts = new FormulaParser(tokenizeFormula(src)).parse();
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

const SAMPLES = ['CuSO4·5H2O', 'Ca(OH)2', 'C6H12O6', '(NH4)2SO4', 'KMnO4', 'NaCl'];

export default function MolarMassPage() {
  const t = useT();
  const [formula, setFormula] = useState('');
  const [attempt, setAttempt] = useState('');

  const parsed = useMemo(() => {
    if (attempt.trim() === '') return { ok: false as const, kind: 'empty' as const };
    try {
      const { total, items } = analyzeFormula(attempt);
      return { ok: true as const, total, items };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const unknown = /^unknown:(.+)$/.exec(msg);
      if (unknown) return { ok: false as const, kind: 'unknown' as const, symbol: unknown[1] };
      return { ok: false as const, kind: 'syntax' as const };
    }
  }, [attempt]);

  return (
    <ToolShell toolId="molar-mass">
      <div className="util-page">
        <div className="util-card">
          <div className="util-row">
            <label className="field-label" htmlFor="mm-input">{t('mm.formula')}</label>
            <input
              id="mm-input"
              className="input util-mono util-grow"
              type="text"
              value={formula}
              placeholder={t('mm.placeholder')}
              spellCheck={false}
              onChange={(e) => setFormula(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setAttempt(formula); }}
            />
            <button type="button" className="btn btn-primary" onClick={() => setAttempt(formula)}>
              =
            </button>
          </div>

          <div className="util-row">
            <span className="util-note">{t('mm.samples')}</span>
            {SAMPLES.map((s) => (
              <button key={s} type="button" className="util-chip" onClick={() => { setFormula(s); setAttempt(s); }}>
                {s}
              </button>
            ))}
          </div>

          {parsed.ok && (
            <>
              <div className="sf-out">
                <span className="util-card-title">{t('mm.result')}</span>
                <span className="util-readout">
                  {Number(parsed.total.toPrecision(6))} g/mol
                </span>
              </div>
              <div className="util-table-wrap">
                <table className="util-table">
                  <thead>
                    <tr>
                      <th>{t('mm.col.element')}</th>
                      <th>{t('mm.col.count')}</th>
                      <th>{t('mm.col.mass')}</th>
                      <th>{t('mm.col.share')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.items.map((item) => (
                      <tr key={item.sym}>
                        <td className="util-mono">{item.sym}</td>
                        <td className="util-mono">{item.count}</td>
                        <td className="util-mono">{Number(item.mass.toPrecision(6))}</td>
                        <td className="util-mono">{(item.share * 100).toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {!parsed.ok && parsed.kind === 'unknown' && (
            <p className="util-error">{t('mm.error_unknown', { symbol: parsed.symbol ?? '' })}</p>
          )}
          {!parsed.ok && parsed.kind === 'syntax' && <p className="util-error">{t('mm.error_syntax')}</p>}
        </div>
      </div>
    </ToolShell>
  );
}
