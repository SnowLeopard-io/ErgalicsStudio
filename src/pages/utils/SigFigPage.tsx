// ==========================================================================
// Ergalics Studio — Significant Figures (utility toolkit)
//
// String-based half-up rounding (no float artifacts): round by significant
// figures or by decimal places, and report both decimal and scientific
// notation plus the significant-digit count of the input.
//
// The rounding core lives in src/core/units/sigfig.ts — pure and unit-tested.
// ==========================================================================

import { useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { ToolShell } from '@/components/ToolShell';
import { NumField } from '@/components/NumField';
import { roundToDecimals, roundToSigFigs, type RoundResult } from '@/core/units/sigfig';

export default function SigFigPage() {
  const t = useT();
  const [raw, setRaw] = useState('');
  const [mode, setMode] = useState<'sf' | 'dec'>('sf');
  const [n, setN] = useState(3);

  const result = useMemo<RoundResult | null>(
    () => (mode === 'sf' ? roundToSigFigs(raw, n) : roundToDecimals(raw, n)),
    [raw, mode, n],
  );

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
