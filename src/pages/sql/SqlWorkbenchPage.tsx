// ==========================================================================
// SQL Workbench page (F7) — DuckDB-powered queries over the project's data
// files. Tables auto-register from every resolvable data file; the sidebar
// lists schemas for click-to-insert; results preview inline and can be
// saved back as a project CSV (run recorded for lineage: source files →
// SQL run → derived file).
// ==========================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { listDataFilesGrouped, resolveDataFile, DATA_EXTS_SERIES } from '@/core/dataFiles';
import {
  getSqlEngine,
  uniqueTableNames,
  trimHistory,
  type SqlEngine,
  type SqlHistoryEntry,
  type SqlQueryResult,
  type SqlTableSchema,
} from '@/core/sql/engine';
import { toCsv } from '../research/researchUi';
import { ToolShell } from '@/components/ToolShell';
import { VirtualTable } from '@/components/VirtualTable';

/** Display cap: beyond this, the preview downsamples (export stays full). */
const VIRTUAL_DOWNSAMPLE_THRESHOLD = 5000;
/** CSV export guard from the spec: results ≤ 1e6 rows can be saved. */
const MAX_SAVE_ROWS = 1_000_000;

const SAMPLE_SQL = `-- Join / aggregate examples over the registered tables
SELECT c.customer, COUNT(*) AS orders
FROM orders o JOIN customers c ON o.customer_id = c.id
GROUP BY c.customer
ORDER BY orders DESC`;

type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export default function SqlWorkbenchPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const addDataFile = useProjectStore((s) => s.addDataFile);
  const recordRun = useExperimentStore((s) => s.recordRun);

  const groups = useMemo(() => listDataFilesGrouped(DATA_EXTS_SERIES), [project?.data.files]);
  const allFileNames = useMemo(
    () => [...groups.project, ...groups.examples],
    [groups.project, groups.examples],
  );
  const filesKey = useMemo(() => allFileNames.join('\n'), [allFileNames]);

  const [status, setStatus] = useState<EngineStatus>('idle');
  const [statusNote, setStatusNote] = useState('');
  const [schemas, setSchemas] = useState<SqlTableSchema[]>([]);
  const [sql, setSql] = useState(SAMPLE_SQL);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [history, setHistory] = useState<SqlHistoryEntry[]>([]);
  const [saveName, setSaveName] = useState('');

  const engineRef = useRef<SqlEngine | null>(null);
  const registeredKeyRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  /** Load the engine (once) and (re)register the file set when it changes. */
  const prepareEngine = async (): Promise<SqlEngine | null> => {
    try {
      if (engineRef.current?.isTerminated) {
        engineRef.current = null;
        registeredKeyRef.current = '';
      }
      let engine = engineRef.current;
      if (!engine) {
        setStatus('loading');
        setStatusNote('');
        engine = await getSqlEngine();
        engineRef.current = engine;
        registeredKeyRef.current = '';
        setStatus('ready');
      }
      if (registeredKeyRef.current !== filesKey) {
        const files = allFileNames
          .map((name) => ({ name, text: resolveDataFile(name) }))
          .filter((f): f is { name: string; text: string } => f.text !== undefined);
        setSchemas(await engine.registerFiles(files));
        registeredKeyRef.current = filesKey;
        setStatus('ready');
        setStatusNote(String(files.length));
      }
      return engine;
    } catch (err) {
      setStatus('error');
      setStatusNote(err instanceof Error ? err.message : String(err));
      return null;
    }
  };

  useEffect(() => {
    if (project) void prepareEngine();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, filesKey]);

  const fileNameToTable = useMemo(() => {
    const map = uniqueTableNames(allFileNames);
    return new Map(Array.from(map, ([file, table]) => [table, file]));
  }, [allFileNames]);

  const insertToken = (token: string) => {
    const el = editorRef.current;
    if (!el) {
      setSql((s) => (s ? `${s} ${token}` : token));
      return;
    }
    const start = el.selectionStart ?? sql.length;
    const end = el.selectionEnd ?? sql.length;
    setSql(sql.slice(0, start) + token + sql.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + token.length;
    });
  };

  const runQuery = async () => {
    if (!sql.trim() || running) return;
    const engine = await prepareEngine();
    if (!engine) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError('');
    try {
      const r = await engine.query(sql, { signal: controller.signal });
      setResult(r);
      setHistory((h) => trimHistory(h, sql));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const cancelQuery = () => abortRef.current?.abort();

  /** Project files whose registered table name appears in the SQL text. */
  const referencedProjectFileIds = (): string[] => {
    if (!project) return [];
    const lower = sql.toLowerCase();
    return project.data.files
      .filter((f) => {
        const table = fileNameToTable.get(f.name);
        return table !== undefined && lower.includes(table.toLowerCase());
      })
      .map((f) => f.id);
  };

  const saveResult = async () => {
    if (!project || !result || result.rows.length === 0 || running) return;
    if (result.rowCount > MAX_SAVE_ROWS) {
      notify('error', t('sql.too_large'));
      return;
    }
    const base = saveName.trim() || `sql_result_${new Date().toISOString().slice(0, 19).replace(/[:T-]/g, '')}`;
    const name = base.toLowerCase().endsWith('.csv') ? base : `${base}.csv`;
    try {
      const csv = toCsv(result.columns.map((c) => c.name), result.rows);
      const fileId = await addDataFile(new File([csv], name, { type: 'text/csv' }));
      await recordRun({
        source: 'sql',
        label: name,
        params: { sql: sql.slice(0, 2000), sourceFiles: referencedProjectFileIds().length },
        inputFileIds: referencedProjectFileIds(),
        outputFileIds: fileId ? [fileId] : [],
        metrics: { rows: result.rowCount, columns: result.columns.length },
        durationMs: Math.round(result.durationMs),
        seed: null,
      });
      setSaveName('');
      notify('success', t('sql.saved', { name }));
    } catch (err) {
      notify('error', err instanceof Error ? err.message : String(err));
    }
  };

  const statusChip =
    status === 'loading' ? (
      <span className="sql-status-chip sql-status-loading">{t('sql.engine_loading')}</span>
    ) : status === 'ready' ? (
      <span className="sql-status-chip sql-status-ready">
        {t('sql.engine_ready', { tables: String(schemas.length) })}
      </span>
    ) : status === 'error' ? (
      <span className="sql-status-chip sql-status-error" title={statusNote}>
        {t('sql.engine_failed')}
        <button type="button" className="btn" onClick={() => void prepareEngine()}>
          {t('sql.retry')}
        </button>
      </span>
    ) : null;

  return (
    <ToolShell toolId="sql">
      {!project ? (
        <div className="empty-hint">{t('sql.need_project')}</div>
      ) : (
        <div className="sql-layout">
          <aside className="sql-sidebar">
            {statusChip}
            <h3 className="sql-side-title">{t('sql.tables')}</h3>
            {schemas.length === 0 ? (
              <div className="sql-side-note">
                {status === 'loading' ? t('sql.engine_loading') : t('sql.tables_empty')}
              </div>
            ) : (
              <div className="sql-table-list">
                {schemas.map((schema) => (
                  <div key={schema.table} className="sql-table-item">
                    <button
                      type="button"
                      className="sql-table-name"
                      title={t('sql.insert_hint')}
                      onClick={() => insertToken(schema.table)}
                    >
                      {schema.table}
                    </button>
                    <ul className="sql-col-list">
                      {schema.columns.map((col) => (
                        <li key={col.name}>
                          <button
                            type="button"
                            className="sql-col-name"
                            title={col.type}
                            onClick={() => insertToken(col.name)}
                          >
                            {col.name}
                            <span className="sql-col-type">{col.type}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {history.length > 0 && (
              <>
                <h3 className="sql-side-title">{t('sql.history')}</h3>
                <div className="sql-history">
                  {history.map((h) => (
                    <button
                      key={h.ts}
                      type="button"
                      className="sql-history-item"
                      title={h.sql}
                      onClick={() => setSql(h.sql)}
                    >
                      {h.sql.replace(/\s+/g, ' ').slice(0, 60)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </aside>

          <section className="sql-main">
            <textarea
              ref={editorRef}
              className="sql-editor input"
              value={sql}
              spellCheck={false}
              placeholder={SAMPLE_SQL}
              onChange={(e) => setSql(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void runQuery();
                }
              }}
            />
            <div className="sql-actions">
              <button
                type="button"
                className="btn sql-run-btn"
                disabled={running || status === 'loading'}
                onClick={() => void runQuery()}
              >
                {t('sql.run')}
              </button>
              {running && (
                <button type="button" className="btn" onClick={cancelQuery}>
                  {t('sql.cancel')}
                </button>
              )}
            </div>

            {error && <pre className="sql-error">{error}</pre>}

            {result && (
              <div className="sql-result">
                <div className="sql-result-meta">
                  {t('sql.result_meta', {
                    rows: result.rowCount,
                    cols: result.columns.length,
                    ms: Math.round(result.durationMs),
                  })}
                  {result.rows.length > VIRTUAL_DOWNSAMPLE_THRESHOLD && (
                    <span className="sql-preview-note">
                      {t('store2.downsampled', { n: VIRTUAL_DOWNSAMPLE_THRESHOLD })}
                    </span>
                  )}
                </div>
                {result.rows.length === 0 ? (
                  <div className="empty-hint">{t('sql.result_empty')}</div>
                ) : (
                  <VirtualTable
                    columns={result.columns.map((c) => ({ name: c.name, title: c.type }))}
                    rows={
                      result.rows.length > VIRTUAL_DOWNSAMPLE_THRESHOLD
                        ? result.rows.slice(0, VIRTUAL_DOWNSAMPLE_THRESHOLD)
                        : result.rows
                    }
                  />
                )}
                <div className="sql-save-row">
                  <input
                    className="input sql-save-name"
                    value={saveName}
                    placeholder={t('sql.save_name')}
                    onChange={(e) => setSaveName(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn"
                    disabled={result.rows.length === 0 || result.rowCount > MAX_SAVE_ROWS}
                    onClick={() => void saveResult()}
                  >
                    {t('sql.save')}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </ToolShell>
  );
}
