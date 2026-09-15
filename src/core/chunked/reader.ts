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

export interface ChunkedReadOptions {
  /** Rows per chunk (default 50_000). */
  chunkRows?: number;
  /** Column projection — only these columns are parsed/emitted. */
  columns?: string[];
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

interface ChunkerState {
  names: string[];
  /** Projection: parsed-column index → output slot (−1 = dropped). */
  take: number[];
  width: number;
  started: boolean;
}

/** Decide whether the first data-bearing line is a header. */
function isHeaderLine(tokens: string[]): boolean {
  return tokens.some((t) => t !== '' && !Number.isFinite(Number(t)));
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
  return { names, take, width, started: true };
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
  columns: number[][],
  index: number,
): DataTable {
  const specs = state.take
    .filter((i) => i >= 0)
    .map((i) => ({
      name: state.names[i]!,
      type: 'f64' as const,
      data: Float64Array.from(columns[i]!),
    }));
  return createDataTable(`chunk-${index}`, specs, { provenance: 'chunked' });
}

/**
 * Read a delimited file in row windows. Yields one `ChunkedChunk` per window;
 * only the window's lines are held/parsed at a time. Semantics mirror the
 * whole-file delimited parser: header detection from the first data line,
 * malformed rows skipped, short rows NaN-padded, width from the first row.
 */
export async function* chunkedRead(
  text: string,
  opts: ChunkedReadOptions = {},
): AsyncGenerator<ChunkedChunk> {
  const chunkRows = Math.max(1, Math.floor(opts.chunkRows ?? DEFAULT_CHUNK_ROWS));
  const projection = opts.columns ?? [];

  let headerTokens: string[] | null = null;
  let state: ChunkerState | null = null;
  let columns: number[][] = [];
  let chunkIndex = 0;
  let totalRows = 0;
  let buffered = 0;

  const flush = (done: boolean): ChunkedChunk => {
    const index = chunkIndex;
    chunkIndex += 1;
    const rows = buffered;
    buffered = 0;
    const table =
      state && rows > 0 ? buildChunkTable(state, columns, index) : null;
    columns = state ? state.take.map(() => []) : [];
    return { table, index, rows, totalRows, done };
  };

  for (const line of dataLines(text)) {
    const tokens = splitTokens(line);
    // Separator-only lines (`,,` / blank runs) carry no data.
    if (tokens.length === 0 || tokens.every((t) => t === '')) continue;

    // Only the first data-bearing line can be a header; once parsing has
    // started, non-numeric lines fall through and are skipped as malformed.
    if (!state && isHeaderLine(tokens)) {
      headerTokens = tokens;
      continue;
    }

    if (!state) {
      state = initState(headerTokens, tokens, projection);
      columns = state.take.map(() => []);
    }

    // An empty cell means "missing" (NaN), not zero; over-long rows are
    // malformed and skipped; short rows keep their cells and NaN-pad.
    const values = tokens.map((t) => (t === '' ? NaN : Number(t)));
    const malformed = tokens.some((t, i) => t !== '' && !Number.isFinite(values[i]!));
    if (malformed || tokens.length > state.width) continue;

    for (let i = 0; i < state.width; i += 1) {
      columns[i]!.push(i < tokens.length ? values[i]! : NaN);
    }
    buffered += 1;
    totalRows += 1;

    if (buffered >= chunkRows) {
      yield flush(false);
    }
  }

  if (buffered > 0 || chunkIndex === 0) {
    // Trailing partial chunk — or a single done-marker for a dataless file.
    yield flush(true);
  } else {
    yield { table: null, index: chunkIndex, rows: 0, totalRows, done: true };
  }
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
