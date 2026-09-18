// ==========================================================================
// Ergalics Studio — FR-14 data-cleaning wizard: table model (pure TS)
//
// A small row-oriented cell table the wizard can fully represent: every cell
// is a string / number / boolean / null (missing). It is deliberately NOT the
// columnar DataTable — cleaning must see ragged text data, blanks and mixed
// types before conversion. Parsing dispatches on the file extension the same
// way `@/blocks/fileData` does (CSV/TSV/whitespace delimited + JSON records),
// but keeps non-numeric cells intact so the type-conversion step has work to
// do. No DOM / React imports.
// ==========================================================================

export type Cell = string | number | boolean | null;

export interface CleaningTable {
  columns: string[];
  rows: Cell[][];
}

/** Tokens (case-insensitive, trimmed) that count as missing values. */
export const MISSING_TOKENS: readonly string[] = ['na', 'n/a', 'nan', 'null', 'none', '.', '-'];

/** Is this cell missing (blank / null / a recognised NA token)? */
export function isMissing(cell: Cell): boolean {
  if (cell === null || cell === undefined) return true;
  if (typeof cell === 'number') return !Number.isFinite(cell);
  if (typeof cell === 'string') {
    const s = cell.trim();
    return s === '' || MISSING_TOKENS.includes(s.toLowerCase());
  }
  return false;
}

/** Coerce a cell to a finite number, or null when it is not numeric. */
export function toNumber(cell: Cell): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  if (typeof cell === 'boolean') return cell ? 1 : 0;
  const s = String(cell).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Coerce a cell to a boolean ('true'/'1'/'yes' → true; 'false'/'0'/'no' → false). */
export function toBoolean(cell: Cell): boolean | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'boolean') return cell;
  if (typeof cell === 'number') return cell === 0 ? false : Number.isNaN(cell) ? null : true;
  const s = String(cell).trim().toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
  if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
  return null;
}

export function emptyTable(): CleaningTable {
  return { columns: [], rows: [] };
}

export function cloneTable(table: CleaningTable): CleaningTable {
  return {
    columns: [...table.columns],
    rows: table.rows.map((r) => [...r]),
  };
}

// ---- parsing ---------------------------------------------------------------

/** RFC4180-ish line splitter: quoted fields keep commas, `""` escapes a quote. */
function splitDelimited(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  let quoted = false;
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
    if (ch === delimiter) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || quoted || line.endsWith(delimiter)) out.push(cur);
  return out;
}

/** Split on comma / semicolon / whitespace runs (first delimiter seen wins). */
function splitLoose(line: string): string[] {
  let delimiter = ',';
  if (!line.includes(',') && line.includes(';')) delimiter = ';';
  if (!line.includes(',') && !line.includes(';') && /\s/.test(line.trim())) {
    return line.trim().split(/\s+/);
  }
  return splitDelimited(line, delimiter);
}

function normalizeCell(raw: string | undefined): Cell {
  if (raw === undefined) return null;
  const s = raw.trim();
  if (isMissing(s)) return null;
  return s;
}

/** Parse a JSON payload (row records or `{ columns: [{name, data}] }`). */
function parseJsonTable(text: string): CleaningTable {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed) && parsed.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    const records = parsed as Array<Record<string, unknown>>;
    const columns: string[] = [];
    for (const r of records) {
      for (const key of Object.keys(r)) if (!columns.includes(key)) columns.push(key);
    }
    const rows = records.map((r) =>
      columns.map((c) => {
        const v = r[c];
        if (v === null || v === undefined) return null;
        if (typeof v === 'number' || typeof v === 'boolean') return v;
        return String(v);
      }),
    );
    return { columns, rows };
  }
  if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { columns?: unknown }).columns)) {
    const cols = (parsed as { columns: Array<{ name?: unknown; data?: unknown }> }).columns;
    const columns = cols.map((c, i) => String(c?.name ?? `c${i}`));
    const data = cols.map((c) => (Array.isArray(c?.data) ? (c.data as unknown[]) : []));
    const rowCount = data.reduce((m, d) => Math.max(m, d.length), 0);
    const rows: Cell[][] = [];
    for (let i = 0; i < rowCount; i += 1) {
      rows.push(
        data.map((d) => {
          const v = d[i];
          if (v === null || v === undefined) return null;
          if (typeof v === 'number' || typeof v === 'boolean') return v;
          return String(v);
        }),
      );
    }
    return { columns, rows };
  }
  throw new Error('cleaning: unsupported JSON shape (expected row records or { columns: [...] })');
}

/**
 * Parse file text into a CleaningTable. CSV/TSV/TXT/DAT go through the
 * delimited path (first non-empty line is the header when it has any
 * non-numeric token, else columns are named `c0..`); JSON goes through
 * `parseJsonTable`. Throws on empty / unparseable input.
 */
export function parseTableText(text: string, fileName: string): CleaningTable {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.json')) {
    const table = parseJsonTable(text);
    if (table.columns.length === 0) throw new Error('cleaning: JSON dataset has no columns');
    return table;
  }
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error('cleaning: file is empty');

  const headerTokens = splitLoose(lines[0]!);
  const headerIsNames =
    lines.length > 1 &&
    headerTokens.some((tok) => tok !== '' && !Number.isFinite(Number(tok)));
  const columns = headerIsNames
    ? headerTokens.map((tok, i) => (tok.trim() === '' ? `c${i}` : tok.trim()))
    : headerTokens.map((_, i) => `c${i}`);
  const dataLines = headerIsNames ? lines.slice(1) : lines;

  const rows: Cell[][] = dataLines.map((line) => {
    const tokens = splitLoose(line);
    const row: Cell[] = [];
    for (let i = 0; i < columns.length; i += 1) row.push(normalizeCell(tokens[i]));
    return row;
  });
  return { columns, rows };
}

/** Serialize back to CSV text (missing → empty field; strings quoted when needed). */
export function tableToCsv(table: CleaningTable): string {
  const fmt = (cell: Cell): string => {
    if (cell === null || cell === undefined) return '';
    const s = String(cell);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [table.columns.map(fmt).join(',')];
  for (const row of table.rows) lines.push(row.map(fmt).join(','));
  return lines.join('\n');
}

// ---- shared stats helpers (used by steps + script parity tests) ------------

/** Column index of a name, or -1. */
export function columnIndex(table: CleaningTable, name: string): number {
  return table.columns.indexOf(name);
}

/** Linear-interpolated quantile (type 7 — matches numpy default). */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function median(values: number[]): number {
  return quantile(values, 0.5);
}
