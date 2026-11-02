// ==========================================================================
// Ergalics Studio — ETL pipeline page (/studio/etl).
//
// Standalone research tool over the pure core kernel (src/core/dataeng/etl):
// data sources (CSV/JSON upload + URL fetch + optional join table), a step
// chain editor (add/edit/remove/move), step-by-step execution with per-step
// row-count / wall-clock badges, a result preview table and code / DAG
// exports (pandas, R, SQL, flow-mode JSON). Academic, low-saturation style;
// all copy comes from the global i18n dictionary.
// ==========================================================================

import { useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import {
  applyStep,
  missingCellRate,
  parseJsonTable,
  parseTableAuto,
  stepsToFlowGraph,
  toPandasCode,
  toRCode,
  toSqlCode,
} from '@/core/dataeng/etl';
import type {
  AggFn,
  EtlStep,
  EtlStepKind,
  EtTable,
  FilterOp,
  ImputeMethod,
  NormalizeMethod,
  StepStat,
} from '@/core/dataeng/etl';
import { downloadBlob } from '@/core/download';
import { ToolShell } from '@/components/ToolShell';

const STEP_KINDS: readonly EtlStepKind[] = [
  'filter',
  'map',
  'reduce',
  'join',
  'groupBy',
  'pivot',
  'melt',
  'impute',
  'normalize',
  'coerceType',
];

const FILTER_OPS: readonly FilterOp[] = ['==', '!=', '>', '>=', '<', '<=', 'contains', 'startsWith', 'isMissing', 'notMissing'];
const AGG_FNS: readonly AggFn[] = ['sum', 'mean', 'min', 'max', 'count'];
const IMPUTE_METHODS: readonly ImputeMethod[] = ['mean', 'median', 'mode', 'constant'];
const NORMALIZE_METHODS: readonly NormalizeMethod[] = ['minmax', 'zscore'];
const COLUMN_TYPES: readonly string[] = ['number', 'string', 'boolean', 'date', 'unknown'];
const JOIN_HOWS: readonly string[] = ['inner', 'left'];

const PREVIEW_ROW_CAP = 100;

/** Default parameters for a freshly added step of each kind. */
function defaultStep(kind: EtlStepKind, columns: readonly string[]): EtlStep {
  const c0 = columns[0] ?? '';
  const c1 = columns[1] ?? c0;
  switch (kind) {
    case 'filter':
      return { kind, column: c0, op: '==', value: '' };
    case 'map':
      return { kind, name: 'computed', expression: '' };
    case 'reduce':
      return { kind, column: c0, fn: 'sum' };
    case 'join':
      return { kind, on: c0, how: 'left' };
    case 'groupBy':
      return { kind, keys: [c0], column: c1, fn: 'sum' };
    case 'pivot':
      return { kind, index: c0, columns: c1, value: c1, fn: 'sum' };
    case 'melt':
      return { kind, idColumns: [c0] };
    case 'impute':
      return { kind, column: c0, method: 'mean', value: '0' };
    case 'normalize':
      return { kind, column: c0, method: 'minmax' };
    case 'coerceType':
      return { kind, column: c0, type: 'number' };
  }
}

const fmtMs = (ms: number): string => (ms >= 100 ? ms.toFixed(0) : ms.toFixed(1));

export default function EtlPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);

  const [source, setSource] = useState<EtTable | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [joinTable, setJoinTable] = useState<EtTable | null>(null);
  const [joinName, setJoinName] = useState('');
  const [url, setUrl] = useState('');
  const [steps, setSteps] = useState<EtlStep[]>([]);
  const [result, setResult] = useState<EtTable | null>(null);
  const [stats, setStats] = useState<StepStat[]>([]);
  const [stepError, setStepError] = useState<{ index: number; message: string } | null>(null);
  const [totalMs, setTotalMs] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  const fileRef = useRef<HTMLInputElement | null>(null);
  const joinFileRef = useRef<HTMLInputElement | null>(null);
  const joinModeRef = useRef(false);

  const columnNames = (table: EtTable | null): string[] => (table?.columns ?? []).map((c) => c.name);

  // ---- data loading ---------------------------------------------------------

  const ingestText = (text: string, name: string, isJoin: boolean): void => {
    if (!text.trim()) {
      setError(t('etl.parse_failed', { name, msg: 'empty input' }));
      return;
    }
    try {
      const table = /\.json$/i.test(name) ? parseJsonTable(text) : parseTableAuto(text);
      if (table.rows.length === 0) throw new Error('no data rows found');
      if (isJoin) {
        setJoinTable(table);
        setJoinName(name);
      } else {
        setSource(table);
        setSourceName(name);
        setResult(null);
        setStats([]);
        setStepError(null);
      }
      setError('');
      notify('success', t('etl.loaded', { name, rows: table.rows.length }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t('etl.parse_failed', { name, msg }));
    }
  };

  const onPickFile = (isJoin: boolean): void => {
    joinModeRef.current = isJoin;
    (isJoin ? joinFileRef : fileRef).current?.click();
  };

  const onFileChosen = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    const text = await file.text();
    ingestText(text, file.name, joinModeRef.current);
  };

  const fetchUrl = async (): Promise<void> => {
    const target = url.trim();
    if (target === '') {
      setError(t('etl.empty_url'));
      return;
    }
    try {
      const res = await fetch(target);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      ingestText(text, target, false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(t('etl.fetch_failed', { msg }));
    }
  };

  // ---- step chain -----------------------------------------------------------

  const addStep = (kind: EtlStepKind): void => {
    setSteps((prev) => [...prev, defaultStep(kind, columnNames(source))]);
    setDirty(true);
  };

  const updateStep = (index: number, patch: Record<string, unknown>): void => {
    setSteps((prev) => prev.map((s, i) => (i === index ? ({ ...s, ...patch } as EtlStep) : s)));
    setDirty(true);
  };

  const removeStep = (index: number): void => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const moveStep = (index: number, delta: number): void => {
    setSteps((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });
    setDirty(true);
  };

  // ---- execution --------------------------------------------------------------

  const run = (): void => {
    if (!source || running) return;
    setRunning(true);
    // Step-by-step execution with per-step row counts and wall-clock cost;
    // the first failing step stops the chain (fail-fast, like the kernel).
    const started = performance.now();
    let table = source;
    const collected: StepStat[] = [];
    let failure: { index: number; message: string } | null = null;
    for (let i = 0; i < steps.length; i += 1) {
      const t0 = performance.now();
      try {
        table = applyStep(table, steps[i]!, { joinTable: joinTable ?? undefined });
        collected.push({ rows: table.rows.length, ms: performance.now() - t0 });
      } catch (err) {
        failure = { index: i, message: err instanceof Error ? err.message : String(err) };
        break;
      }
    }
    const elapsed = performance.now() - started;
    setRunning(false);
    setStats(collected);
    setTotalMs(elapsed);
    setStepError(failure);
    setResult(failure === null ? table : null);
    setDirty(false);
    if (failure) {
      notify('error', t('etl.step_failed', { n: failure.index + 1, msg: failure.message }));
    } else {
      notify('success', t('etl.done', { rows: table.rows.length, ms: fmtMs(elapsed) }));
    }
  };

  // ---- exports ----------------------------------------------------------------

  const exportCode = (lang: 'pandas' | 'r' | 'sql'): void => {
    if (steps.length === 0) {
      notify('warning', t('etl.export_none'));
      return;
    }
    const opts = {
      source: sourceName || 'data.csv',
      joinSource: joinName || 'join.csv',
      table: sourceName || 'source',
      joinTable: joinName || 'source2',
    };
    if (lang === 'pandas') {
      void downloadBlob('etl-pipeline.py', toPandasCode(steps, opts), 'text/plain');
    } else if (lang === 'r') {
      void downloadBlob('etl-pipeline.R', toRCode(steps, opts), 'text/plain');
    } else {
      void downloadBlob('etl-pipeline.sql', toSqlCode(steps, opts), 'text/plain');
    }
    notify('success', t('etl.export_done', { name: `etl-pipeline.${lang === 'pandas' ? 'py' : lang === 'r' ? 'R' : 'sql'}` }));
  };

  const exportFlow = (): void => {
    if (steps.length === 0) {
      notify('warning', t('etl.export_none'));
      return;
    }
    const graph = stepsToFlowGraph(steps, { source: sourceName || 'data.csv' });
    void downloadBlob('etl-flow.json', JSON.stringify(graph, null, 2), 'application/json');
    notify('success', t('etl.export_done', { name: 'etl-flow.json' }));
  };

  // ---- rendering ---------------------------------------------------------------

  const kindLabel = (kind: EtlStepKind): string => t(`etl.kind_${kind}`);
  const preview = result ?? source;
  const previewRows = preview ? preview.rows.slice(0, PREVIEW_ROW_CAP) : [];

  const statusParts: string[] = [];
  if (source) {
    statusParts.push(`${sourceName} · ${source.rows.length} ${t('etl.rows')} · ${source.columns.length} ${t('etl.cols')}`);
    statusParts.push(
      `${t('etl.upload_join')}: ${joinTable ? `${joinName} (${joinTable.rows.length} ${t('etl.rows')})` : t('etl.join_none')}`,
    );
  }
  if (stepError) statusParts.push(`#${stepError.index + 1} — ${stepError.message}`);
  else if (result) statusParts.push(`${result.rows.length} ${t('etl.rows')} · ${fmtMs(totalMs)} ms`);
  if (dirty) statusParts.push(t('etl.stale'));

  return (
    <ToolShell toolId="etl">
      <div className="analysis-body">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            void onFileChosen(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <input
          ref={joinFileRef}
          type="file"
          accept=".csv,.json"
          style={{ display: 'none' }}
          onChange={(e) => {
            void onFileChosen(e.target.files?.[0]);
            e.target.value = '';
          }}
        />

        <div className="analysis-row">
          <button type="button" className="btn" onClick={() => onPickFile(false)}>{t('etl.upload')}</button>
          <button type="button" className="btn" onClick={() => onPickFile(true)}>{t('etl.upload_join')}</button>
          <input
            className="input"
            type="text"
            placeholder={t('etl.url_placeholder')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="button" className="btn" onClick={() => void fetchUrl()}>{t('etl.fetch')}</button>
          <button type="button" className="btn btn-primary" disabled={!source || running} onClick={run}>
            {running ? t('etl.running') : t('etl.run')}
          </button>
        </div>

        {statusParts.length > 0 && (
          <p className="analysis-note">{statusParts.join('  |  ')}</p>
        )}
        {!source && !error && <p className="analysis-note">{t('etl.no_source')}</p>}
        {error && <p className="analysis-error">{error}</p>}

        <div className="etl-layout">
          <div className="etl-steps-panel">
            <h4 className="share-section-title">{t('etl.steps_title')}</h4>
            <div className="analysis-row">
              <select
                className="input"
                defaultValue="filter"
                onChange={(e) => {
                  addStep(e.target.value as EtlStepKind);
                  e.target.value = 'filter';
                }}
              >
                {STEP_KINDS.map((kind) => (
                  <option key={kind} value={kind}>{kindLabel(kind)}</option>
                ))}
              </select>
            </div>
            {steps.length === 0 && <p className="analysis-note">{t('etl.no_steps')}</p>}
            {steps.map((step, index) => (
              <div key={index} className="etl-step-card">
                <div className="etl-step-head">
                  <span className="etl-step-kind">{index + 1}. {kindLabel(step.kind)}</span>
                  <span className="etl-step-stat">
                    {stepError && stepError.index === index ? (
                      <span className="analysis-error">{stepError.message}</span>
                    ) : stats[index] ? (
                      `${stats[index]!.rows} ${t('etl.rows')} · ${fmtMs(stats[index]!.ms)} ms`
                    ) : (
                      ''
                    )}
                  </span>
                  <button type="button" className="btn btn-sm" disabled={index === 0} onClick={() => moveStep(index, -1)}>↑</button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={index === steps.length - 1}
                    onClick={() => moveStep(index, 1)}
                  >
                    ↓
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => removeStep(index)}>×</button>
                </div>
                <div className="etl-step-params">
                  <StepParams
                    step={step}
                    columns={columnNames(source)}
                    t={t}
                    onPatch={(patch) => updateStep(index, patch)}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="etl-preview-panel">
            <h4 className="share-section-title">
              {t('etl.preview')}
              {preview && (
                <span className="figures-panel-meta">
                  {' '}
                  {preview.rows.length} {t('etl.rows')} · {preview.columns.length} {t('etl.cols')} ·{' '}
                  {(missingCellRate(preview) * 100).toFixed(2)}% {t('etl.missing')}
                </span>
              )}
            </h4>
            <div className="etl-tablewrap">
              {preview && preview.columns.length > 0 ? (
                <table className="sweep-table">
                  <thead>
                    <tr>
                      {preview.columns.map((col) => (
                        <th key={col.name} title={`${col.name} · ${col.type}`}>{col.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i}>
                        {preview.columns.map((col) => {
                          const value = row[col.name];
                          return (
                            <td key={col.name} className={value === null || value === undefined ? 'etl-null' : undefined}>
                              {value === null || value === undefined ? '—' : String(value)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="analysis-note">{t('etl.no_source')}</p>
              )}
            </div>
          </div>
        </div>

        <div className="analysis-row">
          <button type="button" className="btn" onClick={() => exportCode('pandas')}>{t('etl.export_pandas')}</button>
          <button type="button" className="btn" onClick={() => exportCode('r')}>{t('etl.export_r')}</button>
          <button type="button" className="btn" onClick={() => exportCode('sql')}>{t('etl.export_sql')}</button>
          <button type="button" className="btn" onClick={exportFlow}>{t('etl.export_flow')}</button>
        </div>
      </div>
    </ToolShell>
  );
}

// ---- per-kind parameter editors -------------------------------------------------

interface StepParamsProps {
  step: EtlStep;
  columns: readonly string[];
  t: (key: string, params?: Record<string, string | number>) => string;
  onPatch: (patch: Record<string, unknown>) => void;
}

function StepParams({ step, columns, t, onPatch }: StepParamsProps) {
  const datalistId = 'etl-col-options';
  const listAttr = { list: datalistId };
  const colInput = (key: 'column' | 'on' | 'index' | 'columns' | 'value', value: string) => (
    <input
      className="input"
      type="text"
      aria-label={key}
      {...listAttr}
      value={value}
      onChange={(e) => onPatch({ [key]: e.target.value })}
    />
  );
  const text = (key: string, value: string) => (
    <input
      className="input"
      type="text"
      aria-label={key}
      value={value}
      onChange={(e) => onPatch({ [key]: e.target.value })}
    />
  );
  const select = (key: string, value: string, options: readonly string[]) => (
    <select className="input" value={value} onChange={(e) => onPatch({ [key]: e.target.value })}>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
  const csvList = (key: string, values: readonly string[]) => (
    <input
      className="input"
      type="text"
      aria-label={key}
      {...listAttr}
      value={values.join(', ')}
      onChange={(e) =>
        onPatch({ [key]: e.target.value.split(',').map((s) => s.trim()).filter((s) => s !== '') })
      }
    />
  );

  return (
    <>
      <datalist id={datalistId}>
        {columns.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {step.kind === 'filter' && (
        <>
          <Field label={t('etl.f_column')}>{colInput('column', step.column)}</Field>
          <Field label={t('etl.f_op')}>{select('op', step.op, FILTER_OPS)}</Field>
          <Field label={t('etl.f_value')}>{text('value', step.value)}</Field>
        </>
      )}
      {step.kind === 'map' && (
        <>
          <Field label={t('etl.f_name')}>{text('name', step.name)}</Field>
          <Field label={t('etl.f_expr')}>{text('expression', step.expression)}</Field>
        </>
      )}
      {step.kind === 'reduce' && (
        <>
          <Field label={t('etl.f_column')}>{colInput('column', step.column)}</Field>
          <Field label={t('etl.f_fn')}>{select('fn', step.fn, AGG_FNS)}</Field>
        </>
      )}
      {step.kind === 'join' && (
        <>
          <Field label={t('etl.f_on')}>{colInput('on', step.on)}</Field>
          <Field label={t('etl.f_how')}>{select('how', step.how, JOIN_HOWS)}</Field>
        </>
      )}
      {step.kind === 'groupBy' && (
        <>
          <Field label={t('etl.f_keys')}>{csvList('keys', step.keys)}</Field>
          <Field label={t('etl.f_valuecol')}>{colInput('column', step.column)}</Field>
          <Field label={t('etl.f_fn')}>{select('fn', step.fn, AGG_FNS)}</Field>
        </>
      )}
      {step.kind === 'pivot' && (
        <>
          <Field label={t('etl.f_index')}>{colInput('index', step.index)}</Field>
          <Field label={t('etl.f_colkey')}>{colInput('columns', step.columns)}</Field>
          <Field label={t('etl.f_valuecol')}>{colInput('value', step.value)}</Field>
          <Field label={t('etl.f_fn')}>{select('fn', step.fn, AGG_FNS)}</Field>
        </>
      )}
      {step.kind === 'melt' && (
        <Field label={t('etl.f_ids')}>{csvList('idColumns', step.idColumns)}</Field>
      )}
      {step.kind === 'impute' && (
        <>
          <Field label={t('etl.f_column')}>{colInput('column', step.column)}</Field>
          <Field label={t('etl.f_method')}>{select('method', step.method, IMPUTE_METHODS)}</Field>
          <Field label={t('etl.f_constant')}>{text('value', step.value)}</Field>
        </>
      )}
      {step.kind === 'normalize' && (
        <>
          <Field label={t('etl.f_column')}>{colInput('column', step.column)}</Field>
          <Field label={t('etl.f_method')}>{select('method', step.method, NORMALIZE_METHODS)}</Field>
        </>
      )}
      {step.kind === 'coerceType' && (
        <>
          <Field label={t('etl.f_column')}>{colInput('column', step.column)}</Field>
          <Field label={t('etl.f_type')}>{select('type', step.type, COLUMN_TYPES)}</Field>
        </>
      )}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="etl-field">
      <span className="etl-field-label">{label}</span>
      {children}
    </label>
  );
}
