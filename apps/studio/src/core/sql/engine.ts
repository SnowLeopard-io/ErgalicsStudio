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

import { IncrementalCsvParser } from '../bigdata/csv-stream';
import { ProfileBuilder, type ColumnKind } from '../bigdata/stream-stats';
import {
  TYPE_SAMPLE_ROWS,
  createTableStatement,
  encodeArrowBatch,
  inferColumnKinds,
  rowsToArrowTable,
} from '../bigdata/arrow-batch';

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
 * Content fingerprint of a file (FNV-1a). The engine is a process-wide
 * singleton, so a file NAME alone does not identify its content — two
 * projects can both hold `data/foo.csv` with different rows.
 */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${text.length.toString(36)}-${(h >>> 0).toString(36)}`;
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

// ---- Large-file (GB-scale) ingestion ----------------------------------------

/** Bytes above which a file takes the streaming path instead of full text. */
export const LARGE_FILE_THRESHOLD_BYTES = 24 * 1024 * 1024;
/** Rows per Arrow batch in the streaming ingestion fallback (~a few MB). */
export const LARGE_FILE_BATCH_ROWS = 32_768;

export interface SqlLargeFileRequest {
  name: string;
  /** Total size in bytes (progress + threshold decisions). */
  size: number;
  /**
   * A fresh byte stream per call. The engine never materializes the file —
   * chunks flow straight into DuckDB via Arrow batches.
   */
  open: () => ReadableStream<Uint8Array>;
  /**
   * Chromium-only fast path: a real file handle lets DuckDB read the file
   * directly inside WASM (its own memory budget + spilling), no JS copies.
   * When provided, `open` is never called.
   */
  handle?: FileSystemFileHandle;
}

export interface SqlLargeFileProgress {
  phase: 'schema' | 'ingest' | 'finalize';
  /** Rows ingested so far (exact on the fallback path, counted at finalize on the handle path). */
  rows: number;
  bytes: number;
  totalBytes: number;
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
  /**
   * Register a large file without ever materializing it: DuckDB reads
   * through the file handle when one is provided (Chromium), otherwise the
   * stream is chunked into Arrow batches. Reports progress; returns the
   * refreshed schema list.
   */
  registerLargeFile(
    file: SqlLargeFileRequest,
    onProgress?: (p: SqlLargeFileProgress) => void,
  ): Promise<SqlTableSchema[]>;
  /** Exact row count of a registered table once known (undefined until). */
  rowsFor(fileName: string): number | undefined;
  /**
   * The table name a file was registered under (undefined when it is not
   * registered). The engine owns the naming — a caller that recomputes the
   * names itself can disagree with the real tables.
   */
  tableFor(fileName: string): string | undefined;
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
  // GB-scale headroom: let DuckDB manage its own budget and spill to disk
  // (OPFS temp files) instead of dying on a 2GB WASM heap OOM. Best-effort —
  // older bundles may reject the pragma.
  try {
    await conn.query(`SET memory_limit='2GB'`);
    await conn.query(`SET threads=-1`);
  } catch {
    /* pragma unsupported — default limits still apply */
  }

  const id = nextEngineId;
  nextEngineId += 1;
  const tables = new Map<string, string>(); // fileName → tableName
  /** Content fingerprint per registered file — the engine is a process-wide
   *  singleton, so a file NAME alone does not identify its content: two
   *  projects can both hold `data/foo.csv` with different rows. */
  const fingerprints = new Map<string, string>();
  /** Exact row counts, filled right after each large-file registration. */
  const rowCounts = new Map<string, number>();
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

    tableFor(fileName) {
      return tables.get(fileName);
    },

    rowsFor(fileName) {
      return rowCounts.get(fileName);
    },

    async registerLargeFile(file, onProgress) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.json')) {
        throw new Error('streaming import supports CSV/TSV only — convert JSON first');
      }
      const names = uniqueTableNames([...tables.keys(), file.name]);
      const tableName = names.get(file.name)!;
      const progress: SqlLargeFileProgress = {
        phase: 'schema',
        rows: 0,
        bytes: 0,
        totalBytes: file.size,
      };
      const report = () => onProgress?.({ ...progress });

      // Drop any previous table/VFS entry with this name (re-import).
      await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
      tables.delete(file.name);
      fingerprints.delete(file.name);
      rowCounts.delete(file.name);
      try {
        await db.dropFile(file.name);
      } catch {
        /* not registered — fine */
      }

      let usedSchema: SqlTableSchema[] = [];
      if (file.handle) {
        // ---- Fast path (Chromium): DuckDB reads the file directly inside
        // WASM with its own memory budget and spilling — no JS copies at all.
        await db.registerFileHandle(
          file.name,
          file.handle,
          duckdb.DuckDBDataProtocol.BROWSER_FSACCESS,
          true, // direct IO: bypass the browser read cache for big files
        );
        const literal = file.name.replace(/'/g, "''");
        await conn.query(
          `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM read_csv_auto('${literal}', header=true, sample_size=20000)`,
        );
        progress.phase = 'finalize';
        report();
        usedSchema = await finishLargeImport(file.name, tableName, progress, report);
        return usedSchema;
      }

      // ---- Fallback path: stream → incremental CSV → Arrow batches → DuckDB.
      const parser = new IncrementalCsvParser();
      const profiler = new ProfileBuilder();
      let types: ColumnKind[] | null = null;
      let header: string[] = [];
      const warmup: string[][] = [];

      const reader = file.open().getReader();
      const ingestBatch = async (rows: string[][]) => {
        if (rows.length === 0) return;
        const table = rowsToArrowTable(rows, header, types!);
        await conn.insertArrowFromIPCStream(encodeArrowBatch(table), { name: tableName });
        progress.rows += rows.length;
      };

      // Freeze the schema from the warm-up sample and create the table.
      const initSchema = async () => {
        header = parser.headerRow ?? [];
        types = inferColumnKinds(warmup, header.length);
        profiler.initColumns(header);
        for (const row of warmup) profiler.pushRow(row);
        warmup.length = 0;
        await conn.query(createTableStatement(tableName, header, types));
        progress.phase = 'ingest';
        report();
      };

      // Route a drained batch of rows: warm-up until the schema is frozen,
      // then convert + insert in LARGE_FILE_BATCH_ROWS-sized Arrow chunks.
      const processRows = async (rows: string[][]) => {
        let i = 0;
        while (i < rows.length && types === null) {
          const row = rows[i];
          if (row !== undefined) warmup.push(row);
          i += 1;
          if (warmup.length >= TYPE_SAMPLE_ROWS) await initSchema();
        }
        if (types === null) return;
        while (i < rows.length) {
          const batch: string[][] = [];
          while (i < rows.length && batch.length < LARGE_FILE_BATCH_ROWS) {
            const row = rows[i];
            if (row !== undefined) {
              profiler.pushRow(row);
              batch.push(row);
            }
            i += 1;
          }
          await ingestBatch(batch);
        }
        progress.bytes = parser.bytesRead;
        report();
      };

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.pushBytes(value);
          await processRows(parser.takeRows());
        }
        parser.end();
        // The tail may hold one final buffered row.
        await processRows(parser.takeRows());
        reader.releaseLock();
      } catch (err) {
        reader.releaseLock();
        // Partial imports must not leave a half-filled table behind.
        try {
          await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
        } catch {
          /* engine may be dead — re-registration rebuilds it anyway */
        }
        tables.delete(file.name);
        rowCounts.delete(file.name);
        throw err;
      }

      progress.phase = 'finalize';
      progress.bytes = parser.bytesRead;
      report();
      usedSchema = await finishLargeImport(file.name, tableName, progress, report);
      return usedSchema;
    },

    async registerFiles(files) {
      // Compute stable names for every requested file (deduped against each
      // other); already-registered files keep their previous table name.
      const names = uniqueTableNames([...tables.keys(), ...files.map((f) => f.name)]);
      const present = new Set<string>();
      for (const file of files) {
        present.add(file.name);
        const hash = hashText(file.text);
        if (fingerprints.get(file.name) === hash) continue;
        const tableName = names.get(file.name)!;
        // The file may already be registered (a re-import with the same name
        // carries new content) → replace the table instead of skipping it.
        await db.registerFileText(file.name, file.text);
        await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
        await conn.query(registerStatement(tableName, file.name));
        tables.set(file.name, tableName);
        fingerprints.set(file.name, hash);
      }
      // Files that vanished (deleted / renamed) must not stay queryable —
      // the engine is shared, so a stale table leaked the old project's data.
      for (const name of [...tables.keys()]) {
        if (present.has(name)) continue;
        const tableName = tables.get(name)!;
        await conn.query(`DROP TABLE IF EXISTS "${tableName}"`);
        tables.delete(name);
        fingerprints.delete(name);
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

  /**
   * Finalize a large-file import: register the file→table mapping, count the
   * rows exactly (cheap for DuckDB), refresh the schema list and report.
   */
  async function finishLargeImport(
    fileName: string,
    tableName: string,
    progress: SqlLargeFileProgress,
    report: () => void,
  ): Promise<SqlTableSchema[]> {
    tables.set(fileName, tableName);
    const countResult = await conn.query(`SELECT COUNT(*)::BIGINT AS n FROM "${tableName}"`);
    const rows = Number(arrowTableToResult(countResult as unknown as ArrowTableLike).rows[0]?.[0] ?? 0);
    rowCounts.set(fileName, rows);
    progress.rows = rows;
    report();
    schemas = await refreshSchemas(conn, Array.from(tables.values()));
    return schemas;
  }

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
