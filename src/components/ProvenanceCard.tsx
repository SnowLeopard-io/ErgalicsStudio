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

/** FR-3: full, two-click provenance for one computation. */
export function ProvenanceCard({ resultId, onClose }: Props) {
  const t = useT();
  const record = useResultStore((s) => s.records.find((r) => r.resultId === resultId));
  const publishResult = useResultStore((s) => s.publishResult);
  const [outcome, setOutcome] = useState<ReproductionOutcome | null>(null);
  const [copied, setCopied] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);

  if (!record) {
    return (
      <div className="modal-overlay" onMouseDown={onClose}>
        <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
          <div className="modal-header">
            <span className="modal-title">{t('prov.title')}</span>
          </div>
          <div className="modal-body">{t('prov.noRecord')}</div>
          <div className="modal-footer">
            <button type="button" className="btn" onClick={onClose}>{t('prov.close')}</button>
          </div>
        </div>
      </div>
    );
  }

  const warnings = record.metrics.filter((m) => m.severity === 'warn' || m.severity === 'error');
  const copyMethod = async () => {
    const text = bilingualMethodDescription(record);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      void downloadBlob(`${record.resultId}-method.txt`, text, 'text/plain;charset=utf-8');
    }
  };
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
        <div className="modal-header">
          <span className="modal-title">{t('prov.title')}</span>
          <span className="prov-id">{record.resultId}</span>
        </div>
        <div className="modal-body prov-body">
          <p className="prov-subtitle">{t('prov.subtitle')}</p>

          <dl className="prov-grid">
            <dt>{t('prov.plugin')}</dt><dd>{record.pluginId}</dd>
            <dt>{t('prov.version')}</dt><dd>{record.pluginVersion}</dd>
            <dt>{t('prov.createdAt')}</dt><dd>{record.createdAt}</dd>
            <dt>{t('prov.seed')}</dt><dd>{record.seed ?? '—'}</dd>
            <dt>{t('prov.dataHash')}</dt><dd className="prov-hash">{record.input.dataHash || '—'}</dd>
            <dt>{t('prov.environment')}</dt>
            <dd>
              {record.environment.appVersion} · {record.environment.backend} · {record.environment.locale}
            </dd>
          </dl>

          <h4>{t('prov.metrics')}</h4>
          <ul className="prov-list">
            {record.metrics.map((m) => (
              <li key={m.key}>
                  <span className={`science-metric sev-${m.severity ?? 'info'}`}>
                    {m.label}: {metricDisplayText(m)}
                  </span>
              </li>
            ))}
          </ul>

          <h4>{t('prov.warnings')}</h4>
          {warnings.length === 0 ? (
            <p className="prov-muted">{t('prov.noWarnings')}</p>
          ) : (
            <ul className="prov-list prov-warnings">
              {warnings.map((m) => (
                <li key={m.key}>{m.label}: {m.display ?? String(m.value)}{m.hint ? ` — ${m.hint}` : ''}</li>
              ))}
            </ul>
          )}

          <h4>
            <button type="button" className="prov-toggle" onClick={() => setParamsOpen((v) => !v)}>
              {t('prov.params')} {paramsOpen ? '▾' : '▸'}
            </button>
          </h4>
          {paramsOpen && <pre className="prov-pre">{JSON.stringify(record.params, null, 2)}</pre>}

          {record.input.sources.length > 0 && (
            <>
              <h4>{t('prov.dataHash')}</h4>
              <ul className="prov-list">
                {record.input.sources.map((s) => (
                  <li key={`${s.name}:${s.hash}`}>{s.name} · {s.hash}</li>
                ))}
              </ul>
            </>
          )}
          {record.artifacts.length > 0 && (
            <>
              <h4>{t('prov.artifacts')}</h4>
              <ul className="prov-list">
                {record.artifacts.map((a) => <li key={`${a.kind}:${a.name}`}>{a.name} · {a.hash}</li>)}
              </ul>
            </>
          )}
          {record.benchmarks && record.benchmarks.length > 0 && (
            <>
              <h4>{t('prov.benchmarks')}</h4>
              <ul className="prov-list">
                {record.benchmarks.map((b) => (
                  <li key={b.id}>{b.id}: {b.passed ? 'PASS' : 'FAIL'} — {b.detail}</li>
                ))}
              </ul>
            </>
          )}

          <h4>{t('prov.methods')}</h4>
          <pre className="prov-pre prov-method">{bilingualMethodDescription(record)}</pre>

          {outcome && (
            <div className="prov-repro">
              <p>{t('prov.reproducedAs')}: <code>{outcome.record.resultId}</code></p>
              <h4>{t('prov.comparison')}</h4>
              <table className="prov-table">
                <thead><tr><th>{t('prov.metrics')}</th><th>{t('prov.comparison')}</th><th>{t('prov.matched')}</th></tr></thead>
                <tbody>
                  {outcome.comparison.map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.original} → {row.reproduced}</td>
                      <td>{row.matched ? t('prov.matched') : t('prov.mismatched')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {outcome.unverifiable.length > 0 && (
                <>
                  <h4>{t('prov.unverifiable')}</h4>
                  <ul className="prov-list prov-warnings">
                    {outcome.unverifiable.map((note) => <li key={note}>{note}</li>)}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
        <div className="modal-footer prov-footer">
          <button type="button" className="btn" onClick={() => void copyMethod()}>
            {copied ? t('prov.copied') : t('prov.copyMethod')}
          </button>
          <button type="button" className="btn" onClick={reproduce}>{t('prov.reproduce')}</button>
          <button type="button" className="btn" onClick={downloadScript}>{t('prov.downloadScript')}</button>
          <button type="button" className="btn" onClick={onClose}>{t('prov.close')}</button>
        </div>
      </div>
    </div>
  );
}
