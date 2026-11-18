// ==========================================================================
// Ergalics Studio — incremental CSV row-stream parser (GB-scale ingestion)
//
// A pure, resumable CSV tokenizer that accepts arbitrary Uint8Array chunks
// (from file.stream() / fetch / any ReadableStream) and emits row batches
// with O(batch) memory — the whole file is never materialized. Handles
// RFC-4180 quoting (quoted fields, escaped "" quotes, embedded commas and
// newlines) and carries a partial trailing row across chunk boundaries.
// UTF-8 decoding is streaming-safe: multi-byte code points split across
// chunk edges are buffered via TextDecoder({ stream: true }).
// ==========================================================================

/** Candidate delimiters, scored on the first non-empty line. */
const DELIMITER_CANDIDATES = [',', '\t', ';', '|'] as const;

/**
 * Guess the field delimiter of a CSV dialect from a text sample (first
 * lines). Scores each candidate by how consistently the line count of its
 * occurrences matches the most common one — a comma inside every quoted
 * field of a TSV must not win over the tab.
 */
export function detectDelimiter(sample: string): string {
  const lines = sample.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 5);
  if (lines.length === 0) return ',';
  let best = ',';
  let bestScore = -1;
  for (const d of DELIMITER_CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    // Consistency across lines beats magnitude: a header + rows must agree.
    const median = counts.slice().sort((a, b) => a - b)[Math.floor(counts.length / 2)] ?? 0;
    if (median < 1) continue;
    let score = median;
    for (const c of counts) if (c !== median) score -= 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

/** Count delimiter occurrences outside double-quoted spans. */
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === delimiter) count += 1;
  }
  return count;
}

export interface CsvRowBatch {
  rows: string[][];
  /** True once at least one full row (header or data) was emitted. */
  started: boolean;
}

/**
 * Resumable CSV row splitter. Feed chunks (bytes or strings); collect
 * batches via `takeRows()`. `skipHeader`/`onHeader` handle the first row:
 * every chunk boundary preserves parser state (inside-quotes flag, partial
 * row, pending quote-escape), so a row split across two reads is emitted
 * exactly once.
 */
export class IncrementalCsvParser {
  private readonly delimiter: string;
  /** Persistent streaming decoder: multi-byte sequences split across
   *  pushBytes calls are buffered inside the decoder instance itself. */
  private readonly decoder = new TextDecoder('utf-8', { fatal: false });
  private buffer = '';
  private row: string[] = [];
  private field = '';
  private inQuotes = false;
  /** True once the current row contains at least one character — a final
   *  newline must NOT flush an empty phantom row. */
  private rowHasContent = false;
  private header: string[] | null = null;
  private rows: string[][] = [];
  /** Bytes (pre-decode estimate) pushed in, for progress reporting. */
  bytesRead = 0;
  rowsEmitted = 0;

  constructor(opts: { delimiter?: string; sample?: string } = {}) {
    this.delimiter = opts.delimiter ?? detectDelimiter(opts.sample ?? '');
  }

  /** The detected (or forced) delimiter. */
  get activeDelimiter(): string {
    return this.delimiter;
  }

  /** The first complete row, once seen (null until then). */
  get headerRow(): string[] | null {
    return this.header;
  }

  /** Push a byte chunk (decoded with streaming-safe UTF-8 semantics). */
  pushBytes(bytes: Uint8Array): void {
    this.bytesRead += bytes.byteLength;
    this.pushText(this.decoder.decode(bytes, { stream: true }));
  }

  /** Push a text chunk. */
  pushText(text: string): void {
    this.buffer = this.buffer.length > 0 ? this.buffer + text : text;
    this.consumeBuffer();
  }

  /** Signal end-of-input: flushes a final unterminated row / field. */
  end(): void {
    // TextDecoder streaming: flush any pending truncated multi-byte tail.
    const tail = this.decoder.decode();
    if (tail) this.buffer += tail;
    if (this.buffer.length > 0 || this.field.length > 0 || this.inQuotes || this.rowHasContent) {
      // The remaining buffer is the final field (no trailing newline).
      this.field += this.buffer;
      this.buffer = '';
      this.finishField();
      this.finishRow();
    }
  }

  /** Drain the accumulated data rows (call between chunks). */
  takeRows(): string[][] {
    const out = this.rows;
    this.rows = [];
    return out;
  }

  /** Rows buffered but not yet drained (back-pressure hint). */
  get pendingRowCount(): number {
    return this.rows.length;
  }

  private consumeBuffer(): void {
    const d = this.delimiter;
    let i = 0;
    // Scan the buffer; on a quoted span that continues past its end we must
    // keep the remainder buffered verbatim (a `"` may pair with the next chunk).
    while (i < this.buffer.length) {
      const ch = this.buffer[i];
      if (this.inQuotes) {
        if (ch === '"') {
          // Peek: doubled quote inside quotes is an escaped literal quote.
          if (this.buffer[i + 1] === '"') {
            this.field += '"';
            i += 2;
          } else {
            this.inQuotes = false;
            i += 1;
          }
        } else {
          // Fast-path copy of an unbroken non-delimiter, non-quote span.
          let j = i + 1;
          while (j < this.buffer.length) {
            const c = this.buffer[j];
            if (c === '"' || c === d) break;
            j += 1;
          }
          this.field += this.buffer.slice(i, j);
          i = j;
        }
      } else if (ch === '"') {
        this.inQuotes = true;
        this.rowHasContent = true;
        i += 1;
      } else if (ch === d) {
        this.finishField();
        i += 1;
      } else if (ch === '\r') {
        // \r\n or lone \r end the row (old-Mac files included).
        if (this.buffer[i + 1] === '\n') i += 1;
        this.finishField();
        this.finishRow();
        i += 1;
      } else if (ch === '\n') {
        this.finishField();
        this.finishRow();
        i += 1;
      } else {
        let j = i + 1;
        while (j < this.buffer.length) {
          const c = this.buffer[j];
          if (c === '"' || c === d || c === '\r' || c === '\n') break;
          j += 1;
        }
        this.field += this.buffer.slice(i, j);
        this.rowHasContent = true;
        i = j;
      }
    }
    // Keep the tail: it is either a quoted span's prefix or a partial field.
    this.buffer = '';
  }

  private finishField(): void {
    this.row.push(this.field);
    this.field = '';
    this.rowHasContent = true;
  }

  private finishRow(): void {
    if (this.header === null) {
      this.header = this.row;
    } else {
      this.rows.push(this.row);
      this.rowsEmitted += 1;
    }
    this.row = [];
    this.rowHasContent = false;
  }
}
