// ==========================================================================
// Ergalics Studio — Schema inference & validation page (/studio/schema).
//
// Standalone research tool over the pure core kernel (src/core/dataeng/schema):
// upload a CSV/JSON dataset, infer the table schema (types, missing/unique
// ratios, ranges, categories, primary-key candidates, functional
// dependencies, correlations), emit a draft-07 JSON Schema, validate a
// second dataset against it with a violation table, run schema-drift
// detection (colored by severity) and keep a serialisable data contract in
// localStorage. Academic, low-saturation style; global i18n only.
// ==========================================================================

import { useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import {
  deserializeContract,
  diffSchemas,
  inferSchema,
  parseDataRows,
  serializeContract,
  suggestContract,
  toJsonSchema,
  validateAgainstSchema,
} from '@/core/dataeng/schema';
import type { DataContract, DriftItem, TableSchema, ValidationResult } from '@/core/dataeng/schema';
import { downloadBlob } from '@/core/download';
import { ToolShell } from '@/components/ToolShell';

const CONTRACT_KEY = 'ergalics:schema-contract';

const fmtPct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** Severity → inline color (error red / warning amber / info neutral). */
function sevColor(severity: string): string {
  if (severity === 'error') return 'var(--color-error, #b4544a)';
  if (severity === 'warning') return 'var(--color-warning, #c9a97f)';
  return 'var(--color-text-tertiary, #8b98a8)';
}

function loadSavedContract(): DataContract | null {
  try {
    const raw = localStorage.getItem(CONTRACT_KEY);
    return raw ? deserializeContract(raw) : null;
  } catch {
    return null;
  }
}

export default function SchemaPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);

  const [schema, setSchema] = useState<TableSchema | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [error, setError] = useState('');
  const [secondName, setSecondName] = useState('');
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [drift, setDrift] = useState<DriftItem[] | null>(null);
  const [contract, setContract] = useState<DataContract | null>(loadSavedContract);
  const [contractSavedAt, setContractSavedAt] = useState('');

  const parseUpload = (text: string, format: 'csv' | 'json') => {
    try {
      return parseDataRows(text, format);
    } catch (err) {
      setError(t('schema.parse_failed', { msg: err instanceof Error ? err.message : String(err) }));
      return null;
    }
  };

  const onFirstFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setError('');
    const format = /\.json$/i.test(file.name) ? 'json' : 'csv';
    const rows = parseUpload(await file.text(), format);
    if (!rows) return;
    setSchema(inferSchema(rows));
    setSourceName(file.name);
    // A new reference schema invalidates the previous comparison results.
    setValidation(null);
    setDrift(null);
    setSecondName('');
  };

  const onSecondFile = async (file: File | undefined): Promise<void> => {
    if (!file || !schema) return;
    setError('');
    const format = /\.json$/i.test(file.name) ? 'json' : 'csv';
    const rows = parseUpload(await file.text(), format);
    if (!rows) return;
    setSecondName(file.name);
    setValidation(validateAgainstSchema(rows, schema));
    setDrift(diffSchemas(schema, inferSchema(rows)));
  };

  const downloadJsonSchema = (): void => {
    if (!schema) return;
    void downloadBlob(
      `${sourceName.replace(/\.[^.]+$/, '') || 'schema'}.schema.json`,
      JSON.stringify(toJsonSchema(schema), null, 2),
      'application/json',
    );
    notify('success', t('etl.export_done', { name: 'schema.json' }));
  };

  const saveContract = (): void => {
    if (!schema) return;
    const doc = suggestContract(schema);
    try {
      localStorage.setItem(CONTRACT_KEY, serializeContract(doc));
      setContract(doc);
      setContractSavedAt(new Date().toLocaleString());
      notify('success', t('schema.contract_saved_msg'));
    } catch {
      setError(t('schema.parse_failed', { msg: 'localStorage unavailable' }));
    }
  };

  const downloadContract = (): void => {
    if (!contract) return;
    void downloadBlob('data-contract.json', serializeContract(contract), 'application/json');
    notify('success', t('etl.export_done', { name: 'data-contract.json' }));
  };

  return (
    <ToolShell toolId="schema">
      <div className="analysis-body">
        <div className="analysis-row">
          <label className="btn">
            {t('schema.upload')}
            <input
              type="file"
              accept=".csv,.json"
              style={{ display: 'none' }}
              onChange={(e) => {
                void onFirstFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          {schema && (
            <span className="figures-panel-meta">
              {sourceName} · {t('schema.rows_label')} {schema.rowCount} · {t('schema.cols_label')}{' '}
              {schema.columnNames.length}
            </span>
          )}
        </div>
        {!schema && !error && <p className="analysis-note">{t('schema.no_source')}</p>}
        {error && <p className="analysis-error">{error}</p>}

        {schema && (
          <>
            <h4 className="share-section-title">
              {t('schema.overview')}
              <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={downloadJsonSchema}>
                {t('schema.json_schema')}
              </button>
            </h4>
            <div className="schema-tablewrap">
              <table className="sweep-table">
                <thead>
                  <tr>
                    <th>{t('schema.col_name')}</th>
                    <th>{t('schema.col_type')}</th>
                    <th>{t('schema.col_nullable')}</th>
                    <th>{t('schema.col_missing')}</th>
                    <th>{t('schema.col_unique')}</th>
                    <th>{t('schema.col_range')}</th>
                    <th>{t('schema.col_categories')}</th>
                    <th>{t('schema.col_pattern')}</th>
                    <th>{t('schema.col_pk')}</th>
                  </tr>
                </thead>
                <tbody>
                  {schema.columns.map((col) => (
                    <tr key={col.name}>
                      <td>{col.name}</td>
                      <td>{col.type}</td>
                      <td>{col.nullable ? t('common.yes') : t('common.no')}</td>
                      <td>{fmtPct(col.missingRatio)}</td>
                      <td>{fmtPct(col.uniqueRatio)}</td>
                      <td>
                        {col.min !== undefined || col.max !== undefined
                          ? `${String(col.min ?? '')} … ${String(col.max ?? '')}`
                          : '—'}
                      </td>
                      <td>{col.categories ? String(col.categories.length) : '—'}</td>
                      <td>{col.pattern ? <code>{col.pattern}</code> : '—'}</td>
                      <td>{col.primaryKeyCandidate ? '✓' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h4 className="share-section-title">{t('schema.fd_title')}</h4>
            {schema.functionalDependencies.length === 0 ? (
              <p className="analysis-note">{t('schema.fd_none')}</p>
            ) : (
              <ul className="schema-list">
                {schema.functionalDependencies.map((fd, i) => (
                  <li key={i}>
                    <code>{fd.determinant}</code> → <code>{fd.dependent}</code>
                  </li>
                ))}
              </ul>
            )}

            <h4 className="share-section-title">{t('schema.corr_title')}</h4>
            {schema.correlations.length === 0 ? (
              <p className="analysis-note">{t('schema.corr_none')}</p>
            ) : (
              <ul className="schema-list">
                {schema.correlations.map((c, i) => (
                  <li key={i}>
                    <code>{c.a}</code> × <code>{c.b}</code> — r={c.r.toFixed(3)}
                  </li>
                ))}
              </ul>
            )}

            <h4 className="share-section-title">
              {t('schema.contract_title')}
              <button type="button" className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={saveContract}>
                {t('schema.contract_save')}
              </button>
              {contract && (
                <button type="button" className="btn btn-sm" onClick={downloadContract}>
                  {t('schema.contract_download')}
                </button>
              )}
            </h4>
            {contract ? (
              <p className="analysis-note">
                {contractSavedAt ? t('schema.contract_saved', { time: contractSavedAt }) : t('schema.contract_exists')}{' '}
                {t('schema.contract_keys')}: {contract.constraints.uniqueKeys.map((k) => k.join('+')).join(', ') || '—'} ·{' '}
                {t('schema.contract_nonnull')}: {contract.constraints.nonNullColumns.length}
              </p>
            ) : (
              <p className="analysis-note">{t('schema.contract_none')}</p>
            )}

            <h4 className="share-section-title">{t('schema.second_title')}</h4>
            <div className="analysis-row">
              <label className="btn">
                {t('schema.upload_second')}
                <input
                  type="file"
                  accept=".csv,.json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    void onSecondFile(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>
              {secondName && <span className="figures-panel-meta">{secondName}</span>}
            </div>

            {validation && (
              <>
                <p className="analysis-note">
                  {t('schema.errors')}: <strong>{validation.errorCount}</strong> · {t('schema.warnings')}:{' '}
                  <strong>{validation.warningCount}</strong> · {t('schema.violating_rows')}:{' '}
                  {fmtPct(validation.violatingRowRatio)}
                </p>
                {validation.violations.length === 0 ? (
                  <p className="analysis-note">{t('schema.no_violations')}</p>
                ) : (
                  <div className="schema-tablewrap">
                    <table className="sweep-table">
                      <thead>
                        <tr>
                          <th>{t('schema.violation_row')}</th>
                          <th>{t('schema.violation_column')}</th>
                          <th>{t('schema.violation_code')}</th>
                          <th>{t('schema.violation_severity')}</th>
                          <th>{t('schema.violation_reason')}</th>
                          <th>{t('schema.violation_actual')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {validation.violations.slice(0, 200).map((v, i) => (
                          <tr key={i}>
                            <td>{v.row < 0 ? '—' : v.row + 1}</td>
                            <td>{v.column}</td>
                            <td><code>{v.code}</code></td>
                            <td style={{ color: sevColor(v.severity) }}>
                              {v.severity === 'error' ? t('schema.sev_error') : t('schema.sev_warning')}
                            </td>
                            <td>{v.reason}</td>
                            <td>{v.actual === null ? '—' : String(v.actual)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {drift && (
              <>
                <h4 className="share-section-title">{t('schema.drift_title')}</h4>
                {drift.length === 0 ? (
                  <p className="analysis-note">{t('schema.no_drift')}</p>
                ) : (
                  <div className="schema-tablewrap">
                    <table className="sweep-table">
                      <thead>
                        <tr>
                          <th>{t('schema.drift_kind')}</th>
                          <th>{t('schema.drift_column')}</th>
                          <th>{t('schema.violation_severity')}</th>
                          <th>{t('schema.drift_detail')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drift.map((d, i) => (
                          <tr key={i} className={d.severity === 'error' ? 'schema-drift-error' : undefined}>
                            <td><code>{d.kind}</code></td>
                            <td>{d.column}</td>
                            <td style={{ color: sevColor(d.severity) }}>
                              {d.severity === 'error'
                                ? t('schema.sev_error')
                                : d.severity === 'warning'
                                  ? t('schema.sev_warning')
                                  : t('schema.sev_info')}
                            </td>
                            <td>{d.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </ToolShell>
  );
}
