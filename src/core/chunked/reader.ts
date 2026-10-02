// ==========================================================================
// Ergalics Studio — chunked reader for large delimited files (core)
//
// Row-windowed reading over project file text: parses only the lines of the
// requested window, keeping the working set at one chunk instead of the whole
// file. Applicable to the delimited family (csv/tsv/dat/xyz/txt); other
// formats (json/parquet/hdf5/…) stay on whole-file io. Pure TypeScript — no
// React, no stores, no DOM.
// ==========================================================================

import { createDataTable } from '@/types/datatable';
import type { DataTable } from '@/types/datatable';
import { hashString } from '@/core/repro/random';
import { listFileChunks } from '@/core/storage';
import { OpfsChunkStore } from '@/core/opfs';
import { isNumericToken } from '@/core/io/numericToken';

export interface ChunkedReadOptions {
  /** Rows per chunk (default 50_000). */
  chunkRows?: number;
  /** Column projection — only these columns are parsed/emitted. */
  columns?: string[];
  /**
   * FR-17: where stored chunks are read from (chunkedReadStored only).
   * 'idb' = legacy IndexedDB `fileChunks` store, 'opfs' = Origin Private
   * File System. Default 'idb'.
   */
  backend?: 'idb' | 'opfs';
  /** Injectable OPFS store for `backend: 'opfs'` (tests / custom roots). */
  store?: OpfsChunkStore;
}

export interface ChunkedChunk {
  /** Parsed rows, or null when the chunk is an empty done-marker. */
  table: DataTable | null;
  /** 0-based chunk index within the file. */
  index: number;
  /** Data rows in this chunk. */
  rows: number;
  /** Cumulative data rows including this chunk. */
  totalRows: number;
  /** True on the final chunk. */
  done: boolean;
}

const DEFAULT_CHUNK_ROWS = 50_000;

/** Extensions handled by the chunked (line-windowed) reader. */
const CHUNKABLE = new Set(['csv', 'tsv', 'dat', 'xyz', 'txt', 'text']);

export function isChunkable(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return true; // extensionless → whitespace-delimited family
  return CHUNKABLE.has(fileName.slice(dot + 1).toLowerCase());
}

/** Drop a leading UTF-8 BOM so it can't poison the first header token. */
function stripBOM(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ---- tokenizer -------------------------------------------------------------

/**
 * Split a delimited line into tokens (RFC4180-style quotes; a comma always
 * closes a field; whitespace runs collapse into one separator). Mirrors the
 * semantics of blocks/fileData.ts but kept local: core must not import the
 * blocks layer.
 */
function splitTokens(line: string): string[] {
  const tokens: string[] = [];
  let cur = '';
  let inQuotes = false;
  let quoted = false;
  let afterComma = false;

  const flush = (force: boolean) => {
    if (force || quoted || cur.length > 0) tokens.push(cur);
    cur = '';
    quoted = false;
    afterComma = false;
  };

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (ch === ',') {
      flush(true);
      afterComma = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur.length > 0 || quoted) flush(false);
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || quoted || afterComma) tokens.push(cur);
  return tokens;
}

// ---- header / column model -------------------------------------------------

/** Data rows inspected before column types are locked (schema sample). */
const SCHEMA_SAMPLE_ROWS = 1000;

interface ChunkerState {
  names: string[];
  /** Projection: parsed-column index → output slot (−1 = dropped). */
  take: number[];
  width: number;
  started: boolean;
  /**
   * Per-parsed-column type, locked after inspecting the schema sample
   * (mirrors the whole-file parser: a column with at least one finite
   * numeric token is f64, otherwise it is a string/label column). Null
   * while the first rows are still being sampled.
   */
  kinds: ('f64' | 'string')[] | null;
}

/** Decide whether the first data-bearing line is a header. */
function isHeaderLine(tokens: string[]): boolean {
  // NaN / Infinity / overflowing literals are numeric cells, not header
  // evidence — only genuinely non-numeric tokens (labels, ids) count (EG1-105).
  return tokens.some((t) => t !== '' && !isNumericToken(t));
}

function initState(headerTokens: string[] | null, firstRow: string[], projection: string[]): ChunkerState {
  const width = firstRow.length;
  const names: string[] = [];
  if (headerTokens) {
    for (let i = 0; i < width; i += 1) names.push(headerTokens[i] ?? `c${i}`);
  } else {
    // Headerless scientific data is conventionally x, y, z, w, then c4…
    for (let i = 0; i < width; i += 1) names.push(['x', 'y', 'z', 'w'][i] ?? `c${i}`);
  }
  const take: number[] = [];
  if (projection.length === 0) {
    for (let i = 0; i < width; i += 1) take.push(i);
  } else {
    for (let i = 0; i < width; i += 1) take.push(projection.includes(names[i]!) ? i : -1);
  }
  return { names, take, width, started: true, kinds: null };
}

/** Iterate data-bearing lines lazily (no whole-file split allocation). */
function* dataLines(text: string): Generator<string> {
  const src = stripBOM(text);
  const len = src.length;
  let start = 0;
  while (start <= len) {
    let end = src.indexOf('\n', start);
    if (end < 0) end = len;
    const line = start < end ? src.slice(start, end) : '';
    const trimmed = line.trim();
    if (trimmed.length > 0) yield trimmed;
    if (end >= len) break;
    start = end + 1;
  }
}

function buildChunkTable(
  state: ChunkerState,
  numeric: number[][],
  strings: string[][],
  index: number,
): DataTable {
  const kinds = state.kinds!;
  const specs = state.take
    .filter((i) => i >= 0)
    .map((i) =>
      kinds[i] === 'string'
        ? {
            name: state.names[i]!,
            type: 'string' as const,
            data: strings[i]!,
          }
        : {
            name: state.names[i]!,
            type: 'f64' as const,
            data: Float64Array.from(numeric[i]!),
          },
    );
  return createDataTable(`chunk-${index}`, specs, { provenance: 'chunked' });
}

/**
 * Read a delimited file in row windows. Yields one `ChunkedChunk` per window;
 * only the window's lines are held/parsed at a time. Semantics mirror the
 * whole-file delimited parser: header detection from the first data line,
 * column typing from a leading sample (f64 when the column holds any finite
 * numeric token, string/label otherwise), non-finite or missing numeric cells
 * become NaN, short rows NaN/''-padded, and only genuinely over-long rows are
 * skipped.
 */
export async function* chunkedRead(
  text: string,
  opts: ChunkedReadOptions = {},
): AsyncGenerator<ChunkedChunk> {
  yield* chunkedReadFromLines(toAsync(dataLines(text)), opts);
}

function toAsync<T>(iterable: Iterable<T>): AsyncGenerator<T> {
  return (async function* () {
    for (const value of iterable) yield value;
  })();
}

/**
 * Shared row-window engine: consumes an async iterable of data-bearing
 * (already trimmed, non-empty) lines. Both the whole-text reader and the
 * stored-chunk reader (FR-17) feed through here so chunk semantics stay
 * identical across backends.
 */
async function* chunkedReadFromLines(
  lines: AsyncIterable<string>,
  opts: ChunkedReadOptions = {},
): AsyncGenerator<ChunkedChunk> {
  const chunkRows = Math.max(1, Math.floor(opts.chunkRows ?? DEFAULT_CHUNK_ROWS));
  const projection = opts.columns ?? [];
  // Lock column types after this many data rows (or the whole file when it
  // is shorter); small windows (previews) lock earlier so a preview never
  // exceeds its requested size.
  const sampleRows = Math.min(SCHEMA_SAMPLE_ROWS, chunkRows);

  let headerTokens: string[] | null = null;
  // Header detection is a one-shot decision on the first data-bearing line.
  // Gating it on `!state` let label-like data rows ('s1,a,1.5') be re-eaten
  // as headers forever, so a categorical-first file yielded zero rows (EG2-20).
  let headerDecided = false;
  let state: ChunkerState | null = null;
  // Pre-lock: raw token rows buffered for schema inference.
  let sample: string[][] = [];
  // Per-parsed-column accumulation buffers (post-lock).
  let numeric: number[][] = [];
  let strings: string[][] = [];
  let chunkIndex = 0;
  let totalRows = 0;
  let buffered = 0;

  /** Infer column kinds from the sample, then replay it into the buffers. */
  const lockSchema = (): void => {
    const kinds: ('f64' | 'string')[] = [];
    for (let i = 0; i < state!.width; i += 1) {
      let hasFinite = false;
      for (const row of sample) {
        const t = row[i];
        if (t !== undefined && t !== '' && Number.isFinite(Number(t))) {
          hasFinite = true;
          break;
        }
      }
      kinds.push(hasFinite ? 'f64' : 'string');
    }
    state!.kinds = kinds;
    numeric = state!.width ? Array.from({ length: state!.width }, () => [] as number[]) : [];
    strings = state!.width ? Array.from({ length: state!.width }, () => [] as string[]) : [];
    for (const tokens of sample) appendRow(tokens);
    sample = [];
  };

  /** Type one data row into the buffers (EG2-20: rows are never dropped for
   * their cell values — non-finite/missing numeric cells become NaN). */
  const appendRow = (tokens: string[]): void => {
    for (let i = 0; i < state!.width; i += 1) {
      const t = i < tokens.length ? tokens[i]! : '';
      if (state!.kinds![i] === 'string') {
        strings[i]!.push(t);
      } else {
        const n = t === '' ? NaN : Number(t);
        numeric[i]!.push(Number.isFinite(n) ? n : NaN);
      }
    }
    buffered += 1;
    totalRows += 1;
  };

  const flush = (done: boolean): ChunkedChunk => {
    const index = chunkIndex;
    chunkIndex += 1;
    const rows = buffered;
    buffered = 0;
    const table =
      state && state.kinds !== null && rows > 0
        ? buildChunkTable(state, numeric, strings, index)
        : null;
    if (state && state.kinds !== null) {
      numeric = numeric.map(() => []);
      strings = strings.map(() => []);
    }
    return { table, index, rows, totalRows, done };
  };

  for await (const line of lines) {
    const tokens = splitTokens(line);
    // Separator-only lines (`,,` / blank runs) carry no data.
    if (tokens.length === 0 || tokens.every((t) => t === '')) continue;

    // Only the first data-bearing line can be a header; later label-like
    // lines flow through as string cells instead of being dropped (the
    // whole-file parser keeps them too).
    if (!headerDecided) {
      headerDecided = true;
      if (isHeaderLine(tokens)) {
        headerTokens = tokens;
        continue;
      }
    }

    if (!state) {
      state = initState(headerTokens, tokens, projection);
    }

    // An empty cell means "missing" (NaN), not zero; over-long rows are
    // malformed and skipped; short rows keep their cells and are padded.
    if (tokens.length > state.width) continue;

    if (state.kinds === null) {
      sample.push(tokens);
      if (sample.length >= sampleRows) lockSchema();
    } else {
      appendRow(tokens);
    }

    if (buffered >= chunkRows) {
      yield flush(false);
    }
  }

  if (state && state.kinds === null) lockSchema();
  if (buffered > 0 || chunkIndex === 0) {
    // Trailing partial chunk — or a single done-marker for a dataless file.
    yield flush(true);
  } else {
    yield { table: null, index: chunkIndex, rows: 0, totalRows, done: true };
  }
}

/**
 * FR-17: read a *stored* file (written as binary chunks by the ingestion
 * pipeline) in row windows, lazily pulling one chunk at a time from the
 * chosen backend ('idb' legacy store or OPFS). Chunk boundaries may split a
 * line or even a UTF-8 sequence — a carry-over buffer keeps the parse
 * identical to `chunkedRead` on the whole text.
 */
export async function* chunkedReadStored(
  projectId: string,
  fileId: string,
  opts: ChunkedReadOptions = {},
): AsyncGenerator<ChunkedChunk> {
  const backend = opts.backend ?? 'idb';
  let count: number;
  let readChunkAt: (index: number) => Promise<Uint8Array>;

  if (backend === 'opfs') {
    const store = opts.store ?? new OpfsChunkStore();
    const sizes = await store.getChunkSizes(projectId, fileId);
    count = sizes.length;
    readChunkAt = (index) => store.readChunk(projectId, fileId, index);
  } else {
    const chunks = await listFileChunks(projectId, fileId);
    count = chunks.length;
    readChunkAt = async (index) => chunks[index]!;
  }

  async function* storedLines(): AsyncGenerator<string> {
    const decoder = new TextDecoder('utf-8');
    let pending = '';
    for (let i = 0; i < count; i += 1) {
      const text = pending + decoder.decode(await readChunkAt(i), { stream: true });
      const parts = text.split('\n');
      pending = parts.pop() ?? '';
      for (const part of parts) {
        const trimmed = stripBOM(part).trim();
        if (trimmed.length > 0) yield trimmed;
      }
    }
    const tail = stripBOM(pending + decoder.decode()).trim();
    if (tail.length > 0) yield tail;
  }

  yield* chunkedReadFromLines(storedLines(), opts);
}

/**
 * Grab the first `n` data rows as a preview table (single small chunk).
 * Returns null when nothing could be parsed.
 */
export async function previewSample(
  text: string,
  n = 20,
  opts: ChunkedReadOptions = {},
): Promise<DataTable | null> {
  for await (const chunk of chunkedRead(text, { ...opts, chunkRows: n })) {
    return chunk.rows > 0 ? chunk.table : null;
  }
  return null;
}

/**
 * Stable, cheap fingerprint of a large file: FNV-1a over the first content
 * window (64 KB) plus the total size — enough to detect re-imports without
 * hashing every byte.
 */
export function fingerprint(text: string): string {
  const window = text.length > 65_536 ? text.slice(0, 65_536) : text;
  return hashString(`${window.length}:${window}:${text.length}`);
}
