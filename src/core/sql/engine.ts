// ==========================================================================
// Ergalics Studio — SQL Workbench engine (DuckDB-WASM, F7)
//
// The DuckDB-WASM bundle is loaded lazily on first use (the heavy JS is a
// dynamic import, so the workbench chunk never enters the main bundle).
// Project data files (CSV/TSV/JSON/…) are registered into the DuckDB virtual
// file system and exposed as tables via read_csv_auto / read_json_auto.
//
// Queries carry an optional timeout and AbortSignal; on abort or timeout the
// worker is terminated and the singleton is dropped, so the next call spins
// up a fresh instance (FR7.2 "cancel unblocks the UI"). DuckDB cannot be
// instantiated under Node/vitest, so tests cover the pure helpers only —
// keep every piece of logic that is worth testing out here, not inside the
// browser-only class.
// ==========================================================================

// Bundle URLs are resolved at build time by Vite (`?url` emits asset URLs,
// not the payloads themselves — no bytes are loaded until instantiation).
import duckdbMvpWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import duckdbEhWasmUrl from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import duckdbMvpWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdbEhWorkerUrl from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';
import type * as duckdb from '@duckdb/duckdb-wasm';

// ---- Result / schema models ----------------------------------------------

export interface SqlQueryColumn {
  name: string;
  /** DuckDB type string, e.g. `VARCHAR`, `DOUBLE`, `BIGINT`. */
  type: string;
}

export interface SqlQueryResult {
  columns: SqlQueryColumn[];
  rows: unknown[][];
  rowCount: number;
  durationMs: number;
}

export interface SqlTableSchema {
  table: string;
  columns: SqlQueryColumn[];
}

export interface SqlHistoryEntry {
  sql: string;
  ts: number;
}

export const SQL_MAX_HISTORY = 20;
export const SQL_DEFAULT_TIMEOUT_MS = 30_000;

// ---- Pure helpers (unit-tested under Node) --------------------------------

/**
 * Derive a valid SQL table name from a file name: extension stripped,
 * non-identifier characters folded to `_`, leading digit prefixed (DuckDB
 * would otherwise reject / case-fold it), never empty.
 */
export function sanitizeTableName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  let cleaned = base.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  if (/^[0-9]/.test(cleaned)) cleaned = `_${cleaned}`;
  return cleaned || 'data';
}

/**
 * File name → table name map, deduplicating collisions with `_2`, `_3`…
 * suffixes so two `data.csv` files (e.g. project + example) never clash.
 */
export function uniqueTableNames(fileNames: string[]): Map<string, string> {
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const fileName of fileNames) {
    // The same file listed twice must keep one table — first occurrence wins.
    if (out.has(fileName)) continue;
    const base = sanitizeTableName(fileName);
    let candidate = base;
    let k = 2;
    while (used.has(candidate)) {
      candidate = `${base}_${k}`;
      k += 1;
    }
    used.add(candidate);
    out.set(fileName, candidate);
  }
  return out;
}

/**
 * CREATE TABLE statement registering a virtual file as a table. JSON files
 * use read_json_auto, everything else read_csv_auto (auto-detects delimiter
 * and header for CSV/TSV/TXT/XYZ dumps).
 */
export function registerStatement(tableName: string, fileName: string): string {
  const reader = fileName.toLowerCase().endsWith('.json') ? 'read_json_auto' : 'read_csv_auto';
  const literal = fileName.replace(/'/g, "''");
  return `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM ${reader}('${literal}')`;
}

/** Session query history: dedupe identical SQL (move to front), cap length. */
export function trimHistory(
  history: SqlHistoryEntry[],
  sql: string,
  max: number = SQL_MAX_HISTORY,
): SqlHistoryEntry[] {
  const next = [{ sql, ts: Date.now() }, ...history.filter((h) => h.sql !== sql)];
  return next.slice(0, max);
}

// ---- Arrow result conversion ----------------------------------------------

/** Minimal structural view of an apache-arrow Table (testable without the DB). */
export interface ArrowTableLike {
  numRows: number;
  schema: { fields: { name: string; type: unknown }[] };
  /** Table.toArray(): StructRowProxy rows — validity bitmaps already applied. */
  toArray(): ArrayLike<Record<string, unknown>>;
}

/** Coerce one Arrow cell to a JSON/CSV-friendly value. */
export function normalizeSqlValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  if (typeof v === 'bigint') {
    return v >= BigInt(Number.MIN_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(v)
      : v.toString();
  }
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return `[blob ${v.byteLength}B]`;
  return v;
}

/** Convert an Arrow query result into plain columns + row arrays. */
export function arrowTableToResult(table: ArrowTableLike, durationMs = 0): SqlQueryResult {
  const columns: SqlQueryColumn[] = table.schema.fields.map((f) => ({
    name: f.name,
    type: String(f.type),
  }));
  const rowsProxy = table.toArray();
  const rows: unknown[][] = [];
  for (let i = 0; i < table.numRows; i += 1) {
    const row = rowsProxy[i];
    rows.push(columns.map((c) => normalizeSqlValue(row?.[c.name])));
  }
  return { columns, rows, rowCount: table.numRows, durationMs };
}

// ---- Browser engine ---------------------------------------------------------

export interface SqlEngineQueryOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SqlEngine {
  /** Increments across instances — pages use it to detect a reset. */
  readonly id: number;
  /** True once the worker was terminated (abort/timeout) — instance is dead. */
  readonly isTerminated: boolean;
  readonly schemas: SqlTableSchema[];
  /** Registered virtual file names (already uploaded in this instance). */
  readonly registeredFiles: readonly string[];
  /**
   * Register data files as tables. Idempotent: re-registering the same file
   * replaces its table. Returns the refreshed schema list.
   */
  registerFiles(files: { name: string; text: string }[]): Promise<SqlTableSchema[]>;
  query(sql: string, opts?: SqlEngineQueryOptions): Promise<SqlQueryResult>;
  /** Terminate the DuckDB worker (abort/timeout recovery or manual reset). */
  reset(): Promise<void>;
}

type DuckDbModule = typeof duckdb;

interface DuckDbBundle {
  mainModule: string;
  mainWorker: string;
  pthreadWorker?: string;
}

let enginePromise: Promise<SqlEngine> | null = null;
let nextEngineId = 1;

/** Lazily create (or return) the shared DuckDB engine. Browser only. */
export function getSqlEngine(): Promise<SqlEngine> {
  if (!enginePromise) {
    enginePromise = createEngine().catch((err) => {
      enginePromise = null; // allow a retry after a failed load
      throw err;
    });
  }
  return enginePromise;
}

async function createEngine(): Promise<SqlEngine> {
  // Dynamic import: the DuckDB JS bundle (~1MB) stays out of the page chunk
  // and is fetched the first time the workbench is actually used (FR7.1).
  const duckdb = (await import('@duckdb/duckdb-wasm')) as DuckDbModule;
  const bundles: { mvp: DuckDbBundle; eh: DuckDbBundle } = {
    mvp: { mainModule: duckdbMvpWasmUrl, mainWorker: duckdbMvpWorkerUrl },
    eh: { mainModule: duckdbEhWasmUrl, mainWorker: duckdbEhWorkerUrl },
  };
  const bundle = await duckdb.selectBundle(bundles as Parameters<typeof duckdb.selectBundle>[0]);
  if (!bundle.mainWorker) throw new Error('DuckDB worker bundle not found');
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  const db = new duckdb.AsyncDuckDB(logger, new Worker(bundle.mainWorker));
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  const conn = await db.connect();

  const id = nextEngineId;
  nextEngineId += 1;
  const tables = new Map<string, string>(); // fileName → tableName
  let schemas: SqlTableSchema[] = [];
  let terminated = false;

  const engine: SqlEngine = {
    id,
    get isTerminated() {
      return terminated;
    },
    get schemas() {
      return schemas;
    },
    get registeredFiles() {
      return Array.from(tables.keys());
    },

    async registerFiles(files) {
      // Compute stable names for every requested file (deduped against each
      // other); already-registered files keep their previous table name.
      const pending = files.filter((f) => !tables.has(f.name));
      const names = uniqueTableNames([...tables.keys(), ...pending.map((f) => f.name)]);
      for (const file of pending) {
        await db.registerFileText(file.name, file.text);
        const tableName = names.get(file.name)!;
        await conn.query(registerStatement(tableName, file.name));
        tables.set(file.name, tableName);
      }
      schemas = await refreshSchemas(conn, Array.from(tables.values()));
      return schemas;
    },

    async query(sql, opts) {
      const started = performance.now();
      const timeoutMs = opts?.timeoutMs ?? SQL_DEFAULT_TIMEOUT_MS;
      const signal = opts?.signal;
      if (signal?.aborted) {
        await hardReset(db);
        throw new Error('query cancelled');
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      let rejectAborted: ((reason: Error) => void) | null = null;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(new Error(`query timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });
      const aborted = new Promise<never>((_, reject) => {
        rejectAborted = reject;
      });
      const onAbort = () => rejectAborted?.(new Error('query cancelled'));
      signal?.addEventListener('abort', onAbort, { once: true });
      try {
        // A timed-out or aborted query may still be running inside the
        // worker — terminate the instance so the UI can immediately issue
        // new queries (the next getSqlEngine() call spins up a fresh one).
        // duckdb-wasm bundles its own apache-arrow copy — the types do not
        // overlap with the workspace's, hence the double cast.
        const table = (await Promise.race([
          conn.query(sql),
          timeout,
          aborted,
        ])) as unknown as ArrowTableLike;
        return arrowTableToResult(table, performance.now() - started);
      } catch (err) {
        if (timedOut || signal?.aborted) await hardReset(db);
        throw err;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    },

    async reset() {
      await hardReset(db);
    },
  };

  return engine;

  async function hardReset(db: duckdb.AsyncDuckDB): Promise<void> {
    terminated = true;
    try {
      await db.terminate();
    } catch {
      /* ignore double-terminate */
    }
    enginePromise = null;
  }
}

/** One information_schema scan grouped into per-table column lists. */
async function refreshSchemas(
  conn: duckdb.AsyncDuckDBConnection,
  tableNames: string[],
): Promise<SqlTableSchema[]> {
  const byTable = new Map<string, SqlQueryColumn[]>();
  const result = await conn.query(
    `SELECT table_name, column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'main' ORDER BY table_name, ordinal_position`,
  );
  const rows = arrowTableToResult(result as unknown as ArrowTableLike).rows;
  const index = new Map(tableNames.map((t) => [t.toLowerCase(), t]));
  for (const row of rows) {
    const name = String(row[0]);
    const table = index.get(name.toLowerCase());
    if (!table) continue; // internal catalogs / dropped temp tables
    const list = byTable.get(table) ?? [];
    list.push({ name: String(row[1]), type: String(row[2]) });
    byTable.set(table, list);
  }
  return tableNames
    .filter((t) => byTable.has(t))
    .map((t) => ({ table: t, columns: byTable.get(t)! }));
}
