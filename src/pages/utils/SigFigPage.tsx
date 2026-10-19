// ==========================================================================
// Ergalics Studio — Significant Figures (utility toolkit)
//
// String-based half-up rounding (no float artifacts): round by significant
// figures or by decimal places, and report both decimal and scientific
// notation plus the significant-digit count of the input.
// ==========================================================================

import { useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { NumField } from '@/components/NumField';

/** Decomposed decimal literal: value = ±(digits as an integer) × 10^exp.
 *  digits never has leading zeros; for integer mantissas (no '.') trailing
 *  zeros are folded into the exponent so they stay insignificant. */
interface Decomp {
  neg: boolean;
  digits: string;
  exp: number;
  /** Whether the mantissa carried an explicit decimal point. */
  hasPoint: boolean;
}

function decompose(raw: string): Decomp | null {
  let s = raw.trim().replaceAll(/[,\s_]/g, '');
  if (s === '') return null;
  const neg = s.startsWith('-');
  if (neg || s.startsWith('+')) s = s.slice(1);
  const m = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m) return null;
  const intPart = m[1] ?? '';
  const fracPart = m[2] ?? '';
  if (intPart === '' && fracPart === '') return null;
  let exp = (m[3] ? Number(m[3]) : 0) - fracPart.length;
  let digits = (intPart + fracPart).replace(/^0+/, '') || '0';
  // Integer mantissa: trailing zeros carry no significance — move them into
  // the exponent (1200 → 12 × 10², count = 2).
  if (fracPart === '') {
    while (digits.length > 1 && digits.endsWith('0')) {
      digits = digits.slice(0, -1);
      exp += 1;
    }
  }
  return { neg, digits, exp, hasPoint: fracPart !== '' };
}

/** Significant-digit count. Integer trailing zeros count only with an
 *  explicit decimal point (e.g. 1200 → 2, 1200. → 4, 1.200e3 → 4). */
function sigCount(d: Decomp): number {
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
function roundSigDigits(d: Decomp, n: number): string {
  const D = d.digits;
  if (D === '0') return '0'.repeat(Math.max(1, n));
  let kept = D.slice(0, n);
  const next = D[n] ?? '0';
  if (next >= '5') kept = addOne(kept); // half-up
  while (kept.length < n) kept += '0';
  return kept;
}

/** Render R × 10^X as a plain decimal string. */
function toDecimalString(R: string, X: number, neg: boolean): string {
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
function toSciString(R: string, X: number, neg: boolean): string {
  if (/^0+$/.test(R)) return '0';
  const mant = `${R[0]}.${R.slice(1)}`;
  const E = X + R.length - 1;
  return `${neg ? '−' : ''}${mant} × 10^${E}`;
}

/** Round d to n decimal places, half-up. Result = R × 10^X with X = −n. */
function roundDecimals(d: Decomp, n: number): { R: string; X: number } {
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

interface RoundResult {
  inputSf: number;
  decimal: string;
  sci: string;
  resultSf?: number;
}

export default function SigFigPage() {
  const t = useT();
  const [raw, setRaw] = useState('');
  const [mode, setMode] = useState<'sf' | 'dec'>('sf');
  const [n, setN] = useState(3);

  const result = useMemo<RoundResult | null>(() => {
    const d = decompose(raw);
    if (!d) return null;
    if (mode === 'sf') {
      const count = Math.min(Math.max(n, 1), 12);
      const R = roundSigDigits(d, count);
      return {
        inputSf: sigCount(d),
        decimal: toDecimalString(R, d.exp, d.neg),
        sci: toSciString(R, d.exp, d.neg),
      };
    }
    const places = Math.min(Math.max(n, 0), 12);
    const { R, X } = roundDecimals(d, places);
    return {
      inputSf: sigCount(d),
      decimal: toDecimalString(R, X, d.neg),
      sci: toSciString(R, X, d.neg),
      resultSf: sigCount({ neg: d.neg, digits: R, exp: X, hasPoint: true }),
    };
  }, [raw, mode, n]);

  const invalid = raw.trim() !== '' && result === null;

  return (
    <ToolShell toolId="sigfig">
      <div className="util-page">
        <div className="util-card">
          <div className="util-row">
            <label className="field-label" htmlFor="sf-input">{t('sf.input')}</label>
            <input
              id="sf-input"
              className="input util-mono util-grow"
              type="text"
              inputMode="decimal"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="1.23456 / −0.00250 / 6.02e23"
              spellCheck={false}
            />
          </div>

          <div className="util-row">
            <div className="seg" role="radiogroup" aria-label={t('sf.rounded')}>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'sf'}
                className={`seg-btn${mode === 'sf' ? ' seg-btn-on' : ''}`}
                onClick={() => setMode('sf')}
              >
                {t('sf.mode.sf')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'dec'}
                className={`seg-btn${mode === 'dec' ? ' seg-btn-on' : ''}`}
                onClick={() => setMode('dec')}
              >
                {t('sf.mode.dec')}
              </button>
            </div>
            <label className="field-label" htmlFor="sf-n">{mode === 'sf' ? t('sf.digits') : t('sf.decimals')}</label>
            <NumField
              id="sf-n"
              className="input util-mono sf-n-input"
              value={n}
              ariaLabel={mode === 'sf' ? t('sf.digits') : t('sf.decimals')}
              onChange={(v) => setN(v)}
            />
          </div>

          {invalid && <p className="util-error">{t('sf.error')}</p>}
          {result && (
            <>
              <div className="sf-out">
                <span className="util-card-title">{t('sf.rounded')}</span>
                <span className="util-readout">{result.decimal}</span>
              </div>
              <div className="util-table-wrap">
                <table className="util-table">
                  <tbody>
                    <tr>
                      <td>{t('sf.scientific')}</td>
                      <td className="util-mono">{result.sci}</td>
                    </tr>
                    <tr>
                      <td>{t('sf.decimal')}</td>
                      <td className="util-mono">{result.decimal}</td>
                    </tr>
                    <tr>
                      <td>{t('sf.input_sf')}</td>
                      <td className="util-mono">{result.inputSf}</td>
                    </tr>
                    {result.resultSf !== undefined && (
                      <tr>
                        <td>{t('sf.digits')}</td>
                        <td className="util-mono">{result.resultSf}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <p className="util-note">{t('sf.rule')}</p>
        </div>
      </div>
    </ToolShell>
  );
}
