// ==========================================================================
// SQL Workbench page (F7) — DuckDB-powered queries over the project's data
// files. Tables auto-register from every resolvable data file; the sidebar
// lists schemas for click-to-insert; results preview inline and can be
// saved back as a project CSV (run recorded for lineage: source files →
// SQL run → derived file).
// ==========================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { EmptyState } from '@/components/EmptyState';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { listDataFilesGrouped, resolveDataFile, DATA_EXTS_SERIES } from '@/core/dataFiles';
import { formatBytes } from '@/core/storage';
import {
  getSqlEngine,
  hashText,
  trimHistory,
  type SqlEngine,
  type SqlHistoryEntry,
  type SqlLargeFileProgress,
  type SqlQueryResult,
  type SqlTableSchema,
} from '@/core/sql/engine';
import { toCsv } from '@ergalics/plugin-sdk/tools';
import { ToolShell } from '@/components/ToolShell';
import { VirtualTable } from '@/components/VirtualTable';

/** Display cap: beyond this, the preview downsamples (export stays full). */
const VIRTUAL_DOWNSAMPLE_THRESHOLD = 5000;
/** CSV export guard from the spec: results ≤ 1e6 rows can be saved. */
const MAX_SAVE_ROWS = 1_000_000;

const SAMPLE_SQL = `-- Query the registered tables (names in the sidebar)
SELECT *
FROM my_table
LIMIT 20`;

type EngineStatus = 'idle' | 'loading' | 'ready' | 'error';

export default function SqlWorkbenchPage() {
  const t = useT();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const addDataFile = useProjectStore((s) => s.addDataFile);
  const recordRun = useExperimentStore((s) => s.recordRun);

  // project?.data.files is an intentional invalidation trigger for the
  // registry-backed file list (listDataFilesGrouped reads store state directly).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => listDataFilesGrouped(DATA_EXTS_SERIES), [project?.data.files]);
  const allFileNames = useMemo(
    () => [...groups.project, ...groups.examples],
    [groups.project, groups.examples],
  );
  const filesKey = useMemo(() => allFileNames.join('\n'), [allFileNames]);

  const [status, setStatus] = useState<EngineStatus>('idle');
  const [statusNote, setStatusNote] = useState('');
  const [schemas, setSchemas] = useState<SqlTableSchema[]>([]);
  /** Sidebar filter over table (and column) names — 160+ registered tables
   *  made the list unusable without one. */
  const [tableFilter, setTableFilter] = useState('');
  const [sql, setSql] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SqlQueryResult | null>(null);
  const [history, setHistory] = useState<SqlHistoryEntry[]>([]);
  const [saveName, setSaveName] = useState('');
  const [importProgress, setImportProgress] = useState<SqlLargeFileProgress | null>(null);
  const [importName, setImportName] = useState('');

  const engineRef = useRef<SqlEngine | null>(null);
  const registeredKeyRef = useRef('');
  const abortRef = useRef<AbortController | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  /** The generated starter query is filled in at most once per page load. */
  const sampleFilledRef = useRef(false);

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
      // Resolve the file set on every prepare: the CONTENT decides whether
      // the tables must be re-registered. A name-only key missed re-imports
      // (same name, new rows) and let the engine keep the previous
      // project's table.
      const files = (
        await Promise.all(
          allFileNames.map(async (name) => ({
            name,
            text: await resolveDataFile(name),
          })),
        )
      ).filter((f): f is { name: string; text: string } => f.text !== undefined);
      const contentKey = files.map((f) => `${f.name}:${hashText(f.text)}`).join('\n');
      if (registeredKeyRef.current !== contentKey) {
        const registered = await engine.registerFiles(files);
        setSchemas(registered);
        registeredKeyRef.current = contentKey;
        // A fresh visit must not greet the user with a "table not found"
        // error: once a table exists, seed an editor that actually runs.
        if (registered.length > 0 && !sampleFilledRef.current) {
          const firstTable = registered[0]?.table;
          if (firstTable) {
            sampleFilledRef.current = true;
            setSql(
              (prev) =>
                prev ||
                `-- Preview the first rows of a registered table\nSELECT *\nFROM ${firstTable}\nLIMIT 20`,
            );
          }
        }
        // The engine owns the table naming — ask it instead of recomputing
        // the names locally (the two could disagree after a removal).
        // Keyed by FILE name → table name.
        const map = new Map<string, string>();
        for (const f of files) {
          const table = engine.tableFor(f.name);
          if (table) map.set(f.name, table);
        }
        setTableByFile(map);
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

  /** File name → table name, as registered by the engine. */
  const [tableByFile, setTableByFile] = useState<Map<string, string>>(new Map());

  /** Project files whose registered table name appears in the SQL text. */
  const referencedProjectFileIds = (): string[] => {
    if (!project) return [];
    // Match IDENTIFIERS, not raw substrings: a table named `data` matched
    // every query containing "metadata", and `a` matched almost anything.
    const used = new Set<string>();
    for (const m of sql.matchAll(/\b[A-Za-z_][A-Za-z0-9_]*\b/g)) {
      used.add(m[0].toLowerCase());
    }
    return project.data.files
      .filter((f) => {
        const table = tableByFile.get(f.name);
        return table !== undefined && used.has(table.toLowerCase());
      })
      .map((f) => f.id);
  };
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

  // ---- Large-file (GB-scale) streaming import ------------------------------

  const importFileRef = useRef<HTMLInputElement | null>(null);

  /** Stream a big CSV/TSV straight into DuckDB (never materialized in JS). */
  const importLargeFile = async (file: File, handle?: FileSystemFileHandle) => {
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json')) {
      notify('error', t('sql.import_large_hint'));
      return;
    }
    const engine = await prepareEngine();
    if (!engine) return;
    setImportName(file.name);
    setImportProgress({ phase: 'schema', rows: 0, bytes: 0, totalBytes: file.size });
    try {
      const registered = await engine.registerLargeFile(
        {
          name: file.name,
          size: file.size,
          open: () => file.stream(),
          handle,
        },
        (p) => setImportProgress(p),
      );
      setSchemas(registered);
      const map = new Map(tableByFile);
      const table = engine.tableFor(file.name);
      if (table) map.set(file.name, table);
      setTableByFile(map);
      notify('success', t('sql.import_done', { rows: engine.rowsFor(file.name) ?? 0, name: file.name }));
    } catch (err) {
      // A failed import may have terminated the engine (abort semantics) —
      // drop it so the next prepare spins up a fresh instance.
      if (engine.isTerminated) {
        engineRef.current = null;
        registeredKeyRef.current = '';
      }
      notify('error', t('sql.import_failed', { msg: err instanceof Error ? err.message : String(err) }));
    } finally {
      setImportProgress(null);
      setImportName('');
    }
  };

  /** Chromium: pick via showOpenFilePicker to get a direct-read file handle. */
  const pickLargeFile = async () => {
    type PickerWindow = Window & {
      showOpenFilePicker?: (opts?: { types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandle[]>;
    };
    const w = window as PickerWindow;
    if (w.showOpenFilePicker) {
      try {
        const [handle] = await w.showOpenFilePicker({
          types: [{ description: 'CSV/TSV', accept: { 'text/csv': ['.csv', '.tsv'] } }],
        });
        if (!handle) return;
        const file = await handle.getFile();
        await importLargeFile(file, handle);
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return; // user cancelled
        // fall through to the plain input path
      }
    }
    importFileRef.current?.click();
  };

  const onImportInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await importLargeFile(file);
  };

  const importPhaseText = (p: SqlLargeFileProgress): string =>
    p.phase === 'schema'
      ? t('sql.import_phase_schema')
      : p.phase === 'ingest'
        ? t('sql.import_phase_ingest')
        : t('sql.import_phase_finalize');

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

  /** Table name → exact row count for large-file tables (engine-tracked). */
  const rowsByTable = useMemo(() => {
    const m = new Map<string, number>();
    const engine = engineRef.current;
    if (!engine) return m;
    const rev = new Map([...tableByFile].map(([f, t]) => [t, f]));
    for (const s of schemas) {
      const file = rev.get(s.table);
      const n = file !== undefined ? engine.rowsFor(file) : undefined;
      if (n !== undefined) m.set(s.table, n);
    }
    return m;
  }, [schemas, tableByFile]);

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
        <EmptyState title={t('sql.need_project')} />
      ) : (
        <div className="sql-layout">
          <aside className="sql-sidebar">
            {statusChip}
            <h3 className="sql-side-title">{t('sql.tables')}</h3>
            {schemas.length > 6 && (
              <input
                type="search"
                className="input sql-table-filter"
                placeholder={t('sql.filter_tables')}
                value={tableFilter}
                onChange={(e) => setTableFilter(e.target.value)}
              />
            )}
            {schemas.length === 0 ? (
              <div className="sql-side-note">
                {status === 'loading' ? t('sql.engine_loading') : t('sql.tables_empty')}
              </div>
            ) : (
              <div className="sql-table-list">
                {schemas
                  .filter((schema) =>
                    tableFilter.trim() === ''
                      ? true
                      : schema.table.toLowerCase().includes(tableFilter.trim().toLowerCase()) ||
                        schema.columns.some((col) =>
                          col.name.toLowerCase().includes(tableFilter.trim().toLowerCase()),
                        ),
                  )
                  .map((schema) => (
                  <div key={schema.table} className="sql-table-item">
                    <button
                      type="button"
                      className="sql-table-name"
                      title={t('sql.insert_hint')}
                      onClick={() => insertToken(schema.table)}
                    >
                      {schema.table}
                    </button>
                    {rowsByTable.has(schema.table) && (
                      <span className="sql-col-type sql-rows-note">
                        {t('sql.rows_known', { rows: rowsByTable.get(schema.table) ?? 0 })}
                      </span>
                    )}
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
                disabled={running || status === 'loading' || importProgress !== null}
                onClick={() => void runQuery()}
              >
                {t('sql.run')}
              </button>
              {running && (
                <button type="button" className="btn" onClick={cancelQuery}>
                  {t('sql.cancel')}
                </button>
              )}
              <button
                type="button"
                className="btn"
                disabled={running || importProgress !== null}
                title={t('sql.import_large_hint')}
                onClick={() => void pickLargeFile()}
              >
                {t('sql.import_large')}
              </button>
              <input
                ref={importFileRef}
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values"
                aria-label={t('sql.import_large')}
                className="sql-import-input"
                hidden
                onChange={(e) => void onImportInput(e)}
              />
            </div>

            {importProgress && (
              <div className="sql-import-progress">
                <div className="sql-import-label">
                  {importPhaseText(importProgress)} · {importName} · {formatBytes(importProgress.bytes)} /{' '}
                  {formatBytes(importProgress.totalBytes)}
                  {importProgress.rows > 0 && ` · ${importProgress.rows.toLocaleString()} rows`}
                </div>
                <progress
                  className="sql-import-bar"
                  max={importProgress.totalBytes || 1}
                  value={importProgress.bytes}
                />
              </div>
            )}

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
                  <EmptyState className="empty-state-inline" title={t('sql.result_empty')} />
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
