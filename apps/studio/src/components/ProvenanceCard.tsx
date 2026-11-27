import { useState } from 'react';
import { useT } from '@/i18n';
import { useResultStore } from '@/stores/resultStore';
import { downloadBlob } from '@/core/download';
import {
  bilingualMethodDescription,
  buildReproductionScript,
  metricDisplayText,
  reproduceResult,
  type ReproductionOutcome,
} from '@/core/result';

interface Props {
  resultId: string;
  onClose: () => void;
}

type CopyKind = 'method' | 'id' | 'hash';

/** FR-3: full, two-click provenance for one computation. */
export function ProvenanceCard({ resultId, onClose }: Props) {
  const t = useT();
  const record = useResultStore((s) => s.records.find((r) => r.resultId === resultId));
  const publishResult = useResultStore((s) => s.publishResult);
  const [outcome, setOutcome] = useState<ReproductionOutcome | null>(null);
  const [copied, setCopied] = useState<CopyKind | null>(null);
  const [paramsOpen, setParamsOpen] = useState(false);

  const copyText = async (text: string, kind: CopyKind) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied((c) => (c === kind ? null : c)), 1600);
    } catch {
      void downloadBlob(
        `${record?.resultId ?? 'result'}-${kind}.txt`,
        text,
        'text/plain;charset=utf-8',
      );
    }
  };

  if (!record) {
    return (
      <div className="modal-overlay" onMouseDown={onClose}>
        <div className="modal prov-modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="prov-head">
            <div className="prov-head-text">
              <div className="prov-eyebrow">{t('prov.title')}</div>
              <div className="prov-head-sub">{t('prov.noRecord')}</div>
            </div>
            <button type="button" className="prov-close" onClick={onClose} aria-label={t('prov.close')}>
              ×
            </button>
          </div>
          <div className="modal-footer prov-footer">
            <button type="button" className="btn" onClick={onClose}>{t('prov.close')}</button>
          </div>
        </div>
      </div>
    );
  }

  const warnings = record.metrics.filter((m) => m.severity === 'warn' || m.severity === 'error');
  const copyMethod = () => void copyText(bilingualMethodDescription(record), 'method');
  const reproduce = () => setOutcome(reproduceResult(record, publishResult));
  const downloadScript = () =>
    void downloadBlob(
      `reproduce-${record.resultId}.py`,
      buildReproductionScript(record),
      'text/x-python;charset=utf-8',
    );

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="modal prov-modal" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <header className="prov-head">
          <div className="prov-head-text">
            <div className="prov-eyebrow">{t('prov.title')}</div>
            <div className="prov-head-title">
              <span className="prov-plugin-id" title={record.pluginId}>{record.pluginId}</span>
              <span className="prov-pill">v{record.pluginVersion}</span>
              <span className="prov-pill prov-pill-backend">{record.environment.backend}</span>
            </div>
            <div className="prov-head-sub">{t('prov.subtitle')}</div>
          </div>
          <button type="button" className="prov-close" onClick={onClose} aria-label={t('prov.close')}>
            ×
          </button>
        </header>

        <div className="modal-body prov-body">
          <section className="prov-section">
            <div className="prov-section-head">{t('prov.overview')}</div>
            <div className="prov-section-body prov-rows">
              <div className="prov-row">
                <span className="prov-row-label">resultId</span>
                <code className="prov-row-value prov-mono prov-ellipsis" title={record.resultId}>
                  {record.resultId}
                </code>
                <button
                  type="button"
                  className="prov-mini"
                  onClick={() => void copyText(record.resultId, 'id')}
                >
                  {copied === 'id' ? t('prov.copiedShort') : t('prov.copy')}
                </button>
              </div>
              <div className="prov-row">
                <span className="prov-row-label">{t('prov.createdAt')}</span>
                <span className="prov-row-value">{new Date(record.createdAt).toLocaleString()}</span>
              </div>
              <div className="prov-row">
                <span className="prov-row-label">{t('prov.seed')}</span>
                <span className="prov-row-value prov-mono">{record.seed ?? '—'}</span>
              </div>
              <div className="prov-row">
                <span className="prov-row-label">{t('prov.environment')}</span>
                <span className="prov-row-value prov-muted-text">
                  {record.environment.appVersion} · {record.environment.backend} · {record.environment.locale}
                </span>
              </div>
            </div>
          </section>

          <section className="prov-section">
            <div className="prov-section-head">{t('prov.input')}</div>
            <div className="prov-section-body">
              <div className="prov-hash-row">
                <span className="prov-row-label">{t('prov.dataHash')}</span>
                <code className="prov-hash" title={record.input.dataHash}>
                  {record.input.dataHash || '—'}
                </code>
                {record.input.dataHash && (
                  <button
                    type="button"
                    className="prov-mini"
                    onClick={() => void copyText(record.input.dataHash, 'hash')}
                  >
                    {copied === 'hash' ? t('prov.copiedShort') : t('prov.copy')}
                  </button>
                )}
              </div>
              {record.input.sources.length > 0 && (
                <ul className="prov-list prov-plain">
                  {record.input.sources.map((s) => (
                    <li key={`${s.name}:${s.hash}`} className="prov-source">
                      <span className="prov-source-name">{s.name}</span>
                      <code className="prov-mono prov-muted-text">{s.hash}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="prov-section">
            <div className="prov-section-head">{t('prov.metrics')}</div>
            <div className="prov-section-body">
              <ul className="prov-list prov-plain">
                {record.metrics.map((m) => (
                  <li key={m.key} className={`prov-metric sev-${m.severity ?? 'info'}`}>
                    <span className="prov-metric-dot" aria-hidden="true" />
                    <span className="prov-metric-label">{m.label}</span>
                    <span className="prov-metric-value prov-mono">{metricDisplayText(m)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className={`prov-section ${warnings.length ? 'prov-section-warn' : ''}`}>
            <div className="prov-section-head">{t('prov.warnings')}</div>
            <div className="prov-section-body">
              {warnings.length === 0 ? (
                <p className="prov-muted-text prov-none">{t('prov.noWarnings')}</p>
              ) : (
                <ul className="prov-list prov-plain">
                  {warnings.map((m) => (
                    <li key={m.key} className={`prov-metric sev-${m.severity ?? 'warn'}`}>
                      <span className="prov-metric-dot" aria-hidden="true" />
                      <span className="prov-metric-label">
                        {m.label}
                        {m.hint ? <span className="prov-metric-hint"> — {m.hint}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="prov-section">
            <button
              type="button"
              className="prov-section-head prov-section-toggle"
              onClick={() => setParamsOpen((v) => !v)}
              aria-expanded={paramsOpen}
            >
              <span>{t('prov.params')}</span>
              <span className="prov-caret">{paramsOpen ? '▾' : '▸'}</span>
            </button>
            {paramsOpen && (
              <div className="prov-section-body">
                <pre className="prov-pre">{JSON.stringify(record.params, null, 2)}</pre>
              </div>
            )}
          </section>

          {(record.artifacts.length > 0 || (record.benchmarks && record.benchmarks.length > 0)) && (
            <section className="prov-section">
              <div className="prov-section-head">{t('prov.artifacts')}</div>
              <div className="prov-section-body prov-rows">
                {record.artifacts.map((a) => (
                  <div key={`${a.kind}:${a.name}`} className="prov-row">
                    <span className="prov-row-label prov-kind">{a.kind}</span>
                    <span className="prov-row-value prov-ellipsis" title={a.name}>{a.name}</span>
                    <code className="prov-mono prov-muted-text prov-ellipsis" title={a.hash}>{a.hash}</code>
                  </div>
                ))}
                {record.benchmarks?.map((b) => (
                  <div key={b.id} className="prov-row">
                    <span className="prov-row-label">{b.id}</span>
                    <span className="prov-row-value prov-muted-text">{b.detail}</span>
                    <span className={`prov-badge ${b.passed ? 'prov-badge-ok' : 'prov-badge-fail'}`}>
                      {b.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="prov-section">
            <div className="prov-section-head prov-section-head-row">
              <span>{t('prov.methods')}</span>
              <button type="button" className="prov-mini" onClick={copyMethod}>
                {copied === 'method' ? t('prov.copiedShort') : t('prov.copy')}
              </button>
            </div>
            <div className="prov-section-body">
              <pre className="prov-pre prov-method">{bilingualMethodDescription(record)}</pre>
            </div>
          </section>

          {outcome && (
            <section className="prov-section">
              <div className="prov-section-head">{t('prov.reproducedAs')}</div>
              <div className="prov-section-body">
                <p className="prov-repro-id">
                  <code className="prov-mono">{outcome.record.resultId}</code>
                </p>
                <table className="prov-table">
                  <thead>
                    <tr><th>{t('prov.metrics')}</th><th>{t('prov.comparison')}</th><th>{t('prov.matched')}</th></tr>
                  </thead>
                  <tbody>
                    {outcome.comparison.map((row) => (
                      <tr key={row.key} className={row.matched ? '' : 'prov-row-mismatch'}>
                        <td>{row.label}</td>
                        <td className="prov-mono">{row.original} → {row.reproduced}</td>
                        <td>{row.matched ? t('prov.matched') : t('prov.mismatched')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {outcome.unverifiable.length > 0 && (
                  <>
                    <h4 className="prov-subhead">{t('prov.unverifiable')}</h4>
                    <ul className="prov-list prov-plain prov-warn-list">
                      {outcome.unverifiable.map((note) => <li key={note}>{note}</li>)}
                    </ul>
                  </>
                )}
              </div>
            </section>
          )}
        </div>

        <div className="modal-footer prov-footer">
          <button type="button" className="btn btn-primary" onClick={copyMethod}>
            {copied === 'method' ? t('prov.copied') : t('prov.copyMethod')}
          </button>
          <button type="button" className="btn" onClick={reproduce}>{t('prov.reproduce')}</button>
          <button type="button" className="btn" onClick={downloadScript}>{t('prov.downloadScript')}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>{t('prov.close')}</button>
        </div>
      </div>
    </div>
  );
}
