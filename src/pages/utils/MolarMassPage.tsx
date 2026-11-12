// ==========================================================================
// Ergalics Studio — Molar Mass (utility toolkit)
//
// Parses a chemical formula (nested parentheses / brackets, hydrate
// separators · · * ., leading multipliers) against a standard atomic weight
// table (IUPAC 2021 conventional values, 118 elements) and reports the
// molar mass plus per-element mass fractions.
//
// The parser itself lives in src/core/chem/molar.ts — pure and unit-tested.
// ==========================================================================

import { useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { analyzeFormula } from '@/core/chem/molar';

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
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) setAttempt(formula); }}
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
