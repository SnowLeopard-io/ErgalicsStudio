// ==========================================================================
// Ergalics Studio — Formula Calculator (utility toolkit)
//
// A small recursive-descent expression evaluator (tokenizer + parser, no
// eval) with implicit multiplication, a deg/rad angle toggle and a library
// of CODATA physical constants insertable as chips.
// ==========================================================================

import { useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { TrashIcon } from '@/components/icons';

// ---- tokenizer -------------------------------------------------------------

type TokKind = 'num' | 'id' | 'op' | 'lp' | 'rp' | 'comma';
interface Tok { kind: TokKind; text: string }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src.charAt(i);
    if (/\s/.test(ch)) { i += 1; continue; }
    if (ch === '(' || ch === '[') { toks.push({ kind: 'lp', text: '(' }); i += 1; continue; }
    if (ch === ')' || ch === ']') { toks.push({ kind: 'rp', text: ')' }); i += 1; continue; }
    if (ch === ',') { toks.push({ kind: 'comma', text: ',' }); i += 1; continue; }
    if (/[0-9.]/.test(ch)) {
      const m = /^[0-9]*\.?[0-9]+(?:[eE][+-]?[0-9]+)?/.exec(src.slice(i));
      if (!m) throw new Error('bad number');
      toks.push({ kind: 'num', text: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      toks.push({ kind: 'id', text: m[0] });
      i += m[0].length;
      continue;
    }
    const canon = { '+': '+', '-': '-', '−': '-', '*': '*', '×': '*', '·': '*', '/': '/', '÷': '/', '^': '^', '%': '%' }[ch];
    if (!canon) throw new Error(`unexpected "${ch}"`);
    toks.push({ kind: 'op', text: canon });
    i += 1;
  }
  return toks;
}

// ---- constants -------------------------------------------------------------

export interface SciConstant {
  sym: string;
  value: number;
  unit: string;
}

/** CODATA-2018 self-consistent set + common geophysical values. */
export const CONSTANTS: SciConstant[] = [
  { sym: 'pi', value: Math.PI, unit: '' },
  { sym: 'e', value: Math.E, unit: '' },
  { sym: 'c', value: 299792458, unit: 'm/s' },
  { sym: 'g', value: 9.80665, unit: 'm/s²' },
  { sym: 'h', value: 6.62607015e-34, unit: 'J·s' },
  { sym: 'hbar', value: 1.054571817e-34, unit: 'J·s' },
  { sym: 'NA', value: 6.02214076e23, unit: 'mol⁻¹' },
  { sym: 'kB', value: 1.380649e-23, unit: 'J/K' },
  { sym: 'R', value: 8.314462618, unit: 'J/(mol·K)' },
  { sym: 'F', value: 96485.33212, unit: 'C/mol' },
  { sym: 'qe', value: 1.602176634e-19, unit: 'C' },
  { sym: 'me', value: 9.1093837015e-31, unit: 'kg' },
  { sym: 'mp', value: 1.67262192369e-27, unit: 'kg' },
  { sym: 'mn', value: 1.67492749804e-27, unit: 'kg' },
  { sym: 'u', value: 1.6605390666e-27, unit: 'kg' },
  { sym: 'G', value: 6.6743e-11, unit: 'N·m²/kg²' },
  { sym: 'eps0', value: 8.8541878128e-12, unit: 'F/m' },
  { sym: 'mu0', value: 1.25663706212e-6, unit: 'N/A²' },
  { sym: 'sigma', value: 5.670374419e-8, unit: 'W/(m²·K⁴)' },
  { sym: 'atm', value: 101325, unit: 'Pa' },
];

// ---- parser ----------------------------------------------------------------

type AngleMode = 'deg' | 'rad';

// ULP (spacing to the adjacent double) of a finite non-zero value.
const ulp = (x: number): number => {
  if (!Number.isFinite(x) || x === 0) return 0;
  return Math.pow(2, Math.floor(Math.log2(Math.abs(x))) - 52);
};

// Trig of constants like pi carries the argument's own representation error
// into the result (sin(pi) -> 1.2246e-16). When the result is below the
// argument's ULP the input noise dominates and the value is indistinguishable
// from exact zero, so snap it. Genuinely small results (sin(1e-16) ~= 1e-16,
// far above ulp(1e-16) ~= 1e-32) are preserved.
const cleanTrig = (x: number, v: number): number => (Math.abs(v) < ulp(x) ? 0 : v);

function makeFnMap(mode: AngleMode): Record<string, (...args: number[]) => number> {
  const toRad = (v: number) => (mode === 'deg' ? (v * Math.PI) / 180 : v);
  const fromRad = (v: number) => (mode === 'deg' ? (v * 180) / Math.PI : v);
  const trig = (f: (x: number) => number) => (v: number) => {
    const x = toRad(v);
    return cleanTrig(x, f(x));
  };
  return {
    sin: trig(Math.sin),
    cos: trig(Math.cos),
    tan: trig(Math.tan),
    asin: (v) => fromRad(Math.asin(v)),
    acos: (v) => fromRad(Math.acos(v)),
    atan: (v) => fromRad(Math.atan(v)),
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs,
    ln: Math.log, log: Math.log10, log2: Math.log2,
    exp: Math.exp, floor: Math.floor, ceil: Math.ceil,
    round: Math.round, sign: Math.sign,
    min: (...a) => Math.min(...a), max: (...a) => Math.max(...a),
  };
}

class Parser {
  private pos = 0;

  constructor(
    private readonly toks: Tok[],
    private readonly fns: Record<string, (...args: number[]) => number>,
  ) {}

  static evaluate(src: string, mode: AngleMode): number {
    const toks = tokenize(src);
    const p = new Parser(toks, makeFnMap(mode));
    const v = p.expr();
    if (p.pos !== toks.length) throw new Error('trailing input');
    return v;
  }

  private peek(): Tok | undefined { return this.toks[this.pos]; }

  private expr(): number {
    let v = this.term();
    for (;;) {
      const t = this.peek();
      if (t?.kind === 'op' && (t.text === '+' || t.text === '-')) {
        this.pos += 1;
        const rhs = this.term();
        v = t.text === '+' ? v + rhs : v - rhs;
      } else return v;
    }
  }

  private term(): number {
    let v = this.unary();
    for (;;) {
      const t = this.peek();
      if (t?.kind === 'op' && (t.text === '*' || t.text === '/' || t.text === '%')) {
        this.pos += 1;
        const rhs = this.unary();
        if (t.text === '*') v *= rhs;
        else if (t.text === '/') v /= rhs;
        else v %= rhs;
      } else if (t && (t.kind === 'num' || t.kind === 'id' || t.kind === 'lp')) {
        // Implicit multiplication: 2pi, 3(4+5), (1+2)(3+4).
        v *= this.unary();
      } else return v;
    }
  }

  private unary(): number {
    const t = this.peek();
    if (t?.kind === 'op' && (t.text === '-' || t.text === '+')) {
      this.pos += 1;
      const v = this.unary();
      return t.text === '-' ? -v : v;
    }
    return this.power();
  }

  private power(): number {
    const base = this.atom();
    const t = this.peek();
    if (t?.kind === 'op' && t.text === '^') {
      this.pos += 1;
      return Math.pow(base, this.unary());
    }
    return base;
  }

  private atom(): number {
    const t = this.peek();
    if (!t) throw new Error('unexpected end');
    if (t.kind === 'num') {
      this.pos += 1;
      return Number(t.text);
    }
    if (t.kind === 'lp') {
      this.pos += 1;
      const v = this.expr();
      if (this.peek()?.kind !== 'rp') throw new Error('missing )');
      this.pos += 1;
      return v;
    }
    if (t.kind === 'id') {
      this.pos += 1;
      const name = t.text;
      if (this.peek()?.kind === 'lp') {
        const fn = this.fns[name];
        if (!fn) throw new Error(`unknown function "${name}"`);
        this.pos += 1;
        const args: number[] = [];
        if (this.peek()?.kind !== 'rp') {
          args.push(this.expr());
          while (this.peek()?.kind === 'comma') {
            this.pos += 1;
            args.push(this.expr());
          }
        }
        if (this.peek()?.kind !== 'rp') throw new Error('missing )');
        this.pos += 1;
        return fn(...args);
      }
      const c = CONSTANTS.find((x) => x.sym === name);
      if (c) return c.value;
      throw new Error(`unknown symbol "${name}"`);
    }
    throw new Error(`unexpected "${t.text}"`);
  }
}

/** Instrument-style result formatting: 12 significant digits, trimmed. */
function fmtResult(v: number): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : Number.isNaN(v) ? 'NaN' : '−∞';
  return String(Number(v.toPrecision(12)));
}

const FN_CHIPS = ['sin', 'cos', 'tan', 'ln', 'log', 'sqrt', '^', '(', ')', 'pi'];

export default function CalcPage() {
  const t = useT();
  const [expr, setExpr] = useState('');
  const [mode, setMode] = useState<AngleMode>('deg');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Array<{ expr: string; result: string }>>([]);

  const evaluate = (source = expr, angleMode = mode) => {
    const trimmed = source.trim();
    if (!trimmed) return;
    try {
      const v = Parser.evaluate(trimmed, angleMode);
      const text = fmtResult(v);
      setResult(text);
      setError('');
      setHistory((h) => [{ expr: trimmed, result: text }, ...h].slice(0, 30));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    }
  };

  const insert = (text: string) => {
    const next = expr + text;
    setExpr(next);
  };

  const rows = useMemo(
    () => CONSTANTS.map((c) => ({ ...c, display: String(Number(c.value.toPrecision(6))) })),
    [],
  );

  return (
    <ToolShell toolId="calc">
      <div className="util-page">
        <div className="util-card">
          <div className="util-row util-between">
            <div className="seg" role="radiogroup" aria-label="angle">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'deg'}
                className={`seg-btn${mode === 'deg' ? ' seg-btn-on' : ''}`}
                onClick={() => setMode('deg')}
              >
                {t('calc.deg')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'rad'}
                className={`seg-btn${mode === 'rad' ? ' seg-btn-on' : ''}`}
                onClick={() => setMode('rad')}
              >
                {t('calc.rad')}
              </button>
            </div>
            {history.length > 0 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setHistory([])}>
                <TrashIcon size={13} /> {t('calc.history')}
              </button>
            )}
          </div>

          <div className="util-row">
            <input
              className="input util-mono util-grow"
              type="text"
              value={expr}
              placeholder={t('calc.empty')}
              spellCheck={false}
              onChange={(e) => setExpr(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) evaluate(); }}
              aria-label={t('calc.result')}
            />
            <button type="button" className="btn btn-primary" onClick={() => evaluate()}>
              =
            </button>
          </div>

          <div className="util-chiprow" role="toolbar" aria-label="functions">
            {FN_CHIPS.map((f) => (
              <button key={f} type="button" className="util-chip" onClick={() => insert(f)}>{f}</button>
            ))}
          </div>

          <p className="util-note">{t('calc.hint')}</p>
          {error && <p className="util-error">{t('calc.error')} — {error}</p>}
          {result !== null && !error && (
            <div className="calc-result">
              <span className="util-card-title">{t('calc.result')}</span>
              <span className="util-readout">{result}</span>
            </div>
          )}
        </div>

        {history.length > 0 && (
          <div className="util-card">
            <h2 className="util-card-title">{t('calc.history')}</h2>
            <div className="util-table-wrap">
              <table className="util-table">
                <tbody>
                  {history.map((h, idx) => (
                    <tr
                      key={`${idx}-${h.expr}`}
                      className="calc-history-row"
                      onClick={() => { setExpr(h.expr); setResult(h.result); setError(''); }}
                    >
                      <td className="util-mono">{h.expr}</td>
                      <td className="util-mono calc-history-val">= {h.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="util-card">
          <h2 className="util-card-title">{t('calc.constants')}</h2>
          <div className="util-table-wrap">
            <table className="util-table">
              <tbody>
                {rows.map((c) => (
                  <tr key={c.sym} className="calc-history-row" onClick={() => insert(c.sym)}>
                    <td className="util-mono calc-const-sym">{c.sym}</td>
                    <td className="util-mono">{c.display}</td>
                    <td className="util-mono calc-const-unit">{c.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
