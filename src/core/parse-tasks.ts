// ==========================================================================
// FR-16 — parse task definitions + the shared runner
//
// The exact same task union runs either inside a pool worker or inline on
// the caller's thread (worker-pool falls back when Workers are unavailable).
// Everything here is pure TypeScript (no DOM) and every result is plain
// structured-cloneable data — DataTable instances cannot cross the
// postMessage boundary, so chunk columns come back as number arrays.
// ==========================================================================

import { chunkedRead, fingerprint } from '@/core/chunked/reader';
import { profileRows } from '@/core/profiler/profile';
import type { ColumnSpec, TableProfile } from '@/core/profiler/profile';

/** Soft ceiling on text a single parse task may hold (~200M chars). */
export const MEMORY_SOFT_LIMIT = 200_000_000;

export type ParseTask =
  | { kind: 'parse'; text: string; chunkRows?: number }
  | { kind: 'fingerprint'; text: string }
  | { kind: 'profile'; rows: Array<Array<string | number | null | undefined>>; columns: ColumnSpec[] | string[] }
  | { kind: 'ingest'; text: string; chunkRows?: number };

export interface PoolProgress {
  done: number;
  total: number;
}

/** Chunked parse result in clone-safe form (columns as plain arrays). */
export interface ParseResult {
  columnNames: string[];
  /** Columns of the LAST non-empty chunk (inspection data). */
  columnData: number[][];
  /** Rows in the last chunk. */
  rows: number;
  /** Cumulative data rows across all chunks. */
  totalRows: number;
  /** Chunks emitted. */
  chunks: number;
}

export type ParseTaskResult = ParseResult | string | TableProfile;

function checkMemory(text: string): void {
  if (text.length > MEMORY_SOFT_LIMIT) {
    throw new Error(
      `memory limit exceeded: ${text.length} chars > ${MEMORY_SOFT_LIMIT} — import the file in chunks or lower the chunk size`,
    );
  }
}

/** Rough data-line estimate for progress reporting (newline count). */
function estimateLines(text: string): number {
  let n = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) n += 1;
  }
  return n;
}

async function runChunked(
  task: { text: string; chunkRows?: number },
  onProgress?: (p: PoolProgress) => void,
): Promise<ParseResult> {
  checkMemory(task.text);
  const total = estimateLines(task.text);
  const result: ParseResult = {
    columnNames: [],
    columnData: [],
    rows: 0,
    totalRows: 0,
    chunks: 0,
  };
  for await (const chunk of chunkedRead(task.text, { chunkRows: task.chunkRows })) {
    result.totalRows = chunk.totalRows;
    if (chunk.rows > 0) {
      // The trailing done-marker (rows=0) is not a data chunk.
      result.chunks = chunk.index + 1;
      result.rows = chunk.rows;
      result.columnNames = chunk.table!.columnNames();
      result.columnData = result.columnNames.map((name) =>
        Array.from(chunk.table!.getColumn(name) as ArrayLike<number>),
      );
    }
    onProgress?.({ done: Math.min(chunk.totalRows, total), total });
  }
  return result;
}

/** Execute a task on the calling thread. Throws on invalid input. */
export async function runParseTask(
  task: ParseTask,
  onProgress?: (p: PoolProgress) => void,
): Promise<ParseTaskResult> {
  switch (task.kind) {
    case 'parse':
    case 'ingest':
      return runChunked(task, onProgress);
    case 'fingerprint':
      checkMemory(task.text);
      return fingerprint(task.text);
    case 'profile':
      return profileRows(task.rows, task.columns);
    default:
      throw new Error(`unknown parse task kind: ${String((task as { kind?: string }).kind)}`);
  }
}
