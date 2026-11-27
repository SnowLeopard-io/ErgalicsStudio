// ==========================================================================
// Ergalics Studio — Tabular Parsing, Smart Column Mapping & Serialization
//
// Parses CSV/TSV/DAT/whitespace tables using the single shared splitter
// (`src/core/io/delimited.ts`), scores candidate header mappings using a
// 4-tier strategy (exact key -> aliases/i18n -> type/role inference ->
// positional fallback), and serializes validated rows to normalized CSV/TSV.
// ==========================================================================

import { splitDelimitedLine, splitLooseTokens } from '@ergalics/sci-kernels/io/delimited';
import { parseNumericText } from '@/core/validation/parse';
import type {
  ErgalicsColumnRole,
  TabularDataSchema,
  TabularDelimiter,
  TabularRow,
} from '@ergalics/plugin-sdk/types';
import { extractTabularColumns, type TabularColumnDescriptor } from './presets';

export interface ParsedRawTable {
  headers: string[];
  headerless: boolean;
  delimiter: TabularDelimiter;
  /** Data rows (excluding header row when present). */
  rows: string[][];
}

export interface SourceColumnStats {
  header: string;
  index: number;
  inferredType: 'integer' | 'number' | 'boolean' | 'string' | 'empty';
  samples: string[];
  min?: number;
  max?: number;
  isBinary01: boolean;
}

export interface ColumnMappingSuggestion {
  /** Target column key -> chosen source header name. */
  mapping: Record<string, string>;
  /** Match score per target column key. */
  scores: Record<string, number>;
  /** Target required columns that could not be matched. */
  missingRequired: string[];
  /** True when user confirmation in ColumnMappingModal is recommended. */
  needsConfirmation: boolean;
  /** True when every required column matched by exact key name. */
  isExactHeaderMatch: boolean;
  /** Summary statistics for each source column (shown in the mapping UI). */
  sourceStats: SourceColumnStats[];
}

function detectDelimiter(
  sampleLines: string[],
  allowed: ReadonlyArray<TabularDelimiter>,
): TabularDelimiter {
  const first = sampleLines[0] ?? '';
  if (allowed.includes('\t') && first.includes('\t')) return '\t';
  if (allowed.includes(',') && first.includes(',')) return ',';
  if (allowed.includes(';') && first.includes(';')) return ';';
  if (allowed.includes('whitespace')) return 'whitespace';
  return allowed[0] ?? ',';
}

function splitLine(line: string, delimiter: TabularDelimiter): string[] {
  if (delimiter === 'whitespace') return splitLooseTokens(line);
  return splitDelimitedLine(line, delimiter).map((c) => c.trim());
}

/** Parse delimited text into headers + string row matrix, skipping comments/blanks. */
export function parseRawTabularText(
  text: string,
  opts?: Pick<TabularDataSchema, 'delimiters' | 'allowHeaderless'>,
): ParsedRawTable {
  const allowed: ReadonlyArray<TabularDelimiter> = opts?.delimiters ?? [
    ',',
    '\t',
    ';',
    'whitespace',
  ];
  const rawLines = text
    .replace(/^\uFEFF/, '') // Strip UTF-8 BOM
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));

  if (rawLines.length === 0) {
    return { headers: [], headerless: false, delimiter: ',', rows: [] };
  }

  const delimiter = detectDelimiter(rawLines.slice(0, 5), allowed);
  const matrix = rawLines.map((l) => splitLine(l, delimiter));
  const firstRow = matrix[0] ?? [];

  // Headerless detection: every non-empty cell in the first row is a strict finite number.
  const firstRowAllNumeric =
    firstRow.length > 0 &&
    firstRow.every((cell) => cell.length > 0 && parseNumericText(cell).ok);

  if (firstRowAllNumeric && opts?.allowHeaderless !== false) {
    const colCount = matrix.reduce((m, r) => Math.max(m, r.length), 0);
    const headers = Array.from({ length: colCount }, (_, i) => `col_${i + 1}`);
    return { headers, headerless: true, delimiter, rows: matrix };
  }

  // Deduplicate blank or repeated header names cleanly.
  const seen = new Map<string, number>();
  const headers = firstRow.map((h, i) => {
    const base = h.trim() || `col_${i + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });

  return {
    headers,
    headerless: false,
    delimiter,
    rows: matrix.slice(1),
  };
}

/** Normalize header/alias tokens for case/punctuation-insensitive matching. */
function normalizeHeader(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, '');
}

const MISSING_SET = new Set(['', 'na', 'n/a', 'nan', 'null', 'none', '-']);
const BOOL_SET = new Set(['true', 'false', 'yes', 'no', '0', '1']);

/** Inspect up to 200 sample rows to infer each source column's type and range. */
export function computeSourceColumnStats(parsed: ParsedRawTable): SourceColumnStats[] {
  const sampleRows = parsed.rows.slice(0, 200);
  return parsed.headers.map((header, index): SourceColumnStats => {
    let nonEmpty = 0;
    let numCount = 0;
    let intCount = 0;
    let boolCount = 0;
    let min = Infinity;
    let max = -Infinity;
    const distinctInts = new Set<number>();
    const samples: string[] = [];

    for (const row of sampleRows) {
      const raw = (row[index] ?? '').trim();
      if (raw.length > 0 && samples.length < 3) samples.push(raw);
      if (MISSING_SET.has(raw.toLowerCase())) continue;
      nonEmpty += 1;

      const parsedNum = parseNumericText(raw);
      if (parsedNum.ok) {
        numCount += 1;
        if (parsedNum.value < min) min = parsedNum.value;
        if (parsedNum.value > max) max = parsedNum.value;
        if (Number.isInteger(parsedNum.value)) {
          intCount += 1;
          if (distinctInts.size <= 4) distinctInts.add(parsedNum.value);
        }
      }
      if (BOOL_SET.has(raw.toLowerCase())) boolCount += 1;
    }

    let inferredType: SourceColumnStats['inferredType'] = 'empty';
    if (nonEmpty > 0) {
      const ratio = 0.85;
      if (intCount / nonEmpty >= ratio) inferredType = 'integer';
      else if (numCount / nonEmpty >= ratio) inferredType = 'number';
      else if (boolCount / nonEmpty >= ratio) inferredType = 'boolean';
      else inferredType = 'string';
    }

    const isBinary01 =
      inferredType === 'integer' &&
      distinctInts.size > 0 &&
      Array.from(distinctInts).every((v) => v === 0 || v === 1);

    return {
      header,
      index,
      inferredType,
      samples,
      ...(Number.isFinite(min) ? { min, max } : {}),
      isBinary01,
    };
  });
}

function isTypeCompatible(
  target: TabularColumnDescriptor,
  src: SourceColumnStats,
): 'exact' | 'compatible' | 'incompatible' {
  if (src.inferredType === 'empty') return 'compatible';
  if (target.displayType === 'any') return 'compatible';
  if (target.displayType === 'string' || target.displayType === 'date') {
    return src.inferredType === 'string' ? 'exact' : 'compatible';
  }
  if (target.displayType === 'number') {
    if (src.inferredType === 'number' || src.inferredType === 'integer') return 'exact';
    return 'incompatible';
  }
  if (target.displayType === 'integer') {
    if (src.inferredType === 'integer') return 'exact';
    return 'incompatible';
  }
  if (target.displayType === 'boolean') {
    if (src.inferredType === 'boolean' || src.isBinary01) return 'exact';
    return 'incompatible';
  }
  if (target.displayType === 'enum') {
    const allowed = target.schema.enum ?? [];
    const allNum = allowed.every((v) => typeof v === 'number');
    if (allNum) {
      if (src.inferredType === 'integer' || src.inferredType === 'number') return 'exact';
      return 'incompatible';
    }
    return 'compatible';
  }
  return 'compatible';
}

function roleBoost(role: ErgalicsColumnRole | undefined, src: SourceColumnStats): number {
  if (!role) return 0;
  if (role === 'event' && src.isBinary01) return 20;
  if (role === 'lat' && src.min !== undefined && src.max !== undefined && src.min >= -90 && src.max <= 90) {
    return 15;
  }
  if (role === 'lon' && src.min !== undefined && src.max !== undefined && src.min >= -180 && src.max <= 180) {
    return 15;
  }
  if ((role === 'source' || role === 'target' || role === 'category') && src.inferredType === 'string') {
    return 12;
  }
  if ((role === 'x' || role === 'y' || role === 'z' || role === 'weight') && (src.inferredType === 'number' || src.inferredType === 'integer')) {
    return 10;
  }
  return 0;
}

function scorePair(
  target: TabularColumnDescriptor,
  targetIndex: number,
  src: SourceColumnStats,
  headerless: boolean,
): { score: number; exactKey: boolean } {
  const typeCompat = isTypeCompatible(target, src);

  let score = 0;
  let exactKey = false;
  let aliasMatched = false;

  if (!headerless) {
    const normSrc = normalizeHeader(src.header);
    const normKey = normalizeHeader(target.key);
    if (normSrc === normKey) {
      score += 100;
      exactKey = true;
    } else {
      const aliasPool = [
        ...(target.meta.aliases ?? []),
        ...Object.values(target.meta.labelI18n ?? {}),
        ...(target.schema.title ? [target.schema.title] : []),
      ].map(normalizeHeader);

      if (aliasPool.includes(normSrc)) {
        score += 85;
        aliasMatched = true;
      } else if (
        normKey.length >= 2 &&
        (normSrc.includes(normKey) || normKey.includes(normSrc))
      ) {
        score += 60;
      } else if (
        aliasPool.some((a) => a.length >= 2 && (normSrc.includes(a) || a.includes(normSrc)))
      ) {
        score += 55;
      }
    }
  } else if (targetIndex === src.index) {
    // Headerless numeric files map cleanly by schema column order.
    score += 90;
  }

  // Only hard-reject incompatible types when guessing non-exact / non-alias columns.
  // An exact header match (e.g. column named "value" with 1 typo "abc" out of 4 rows)
  // MUST still map to "value" so row-level Zod validation reports the exact bad cell
  // instead of falsely asking the user for column mapping.
  if (typeCompat === 'incompatible') {
    if (!exactKey && !aliasMatched) {
      return { score: -80, exactKey: false };
    }
    return { score: exactKey ? 90 : 80, exactKey };
  }

  // Type & semantic boosts.
  if (typeCompat === 'exact') score += 25;
  else if (typeCompat === 'compatible') score += 10;
  score += roleBoost(target.meta.role, src);

  // Positional tie-breaker when no name match was found.
  if (!headerless && score < 50 && targetIndex === src.index) {
    score += 20;
  }

  return { score, exactKey };
}

/**
 * Compute optimal suggested column mapping (`targetKey -> sourceHeader`) using
 * a 4-tier scoring strategy + greedy bipartite assignment.
 */
export function suggestColumnMapping(
  parsed: ParsedRawTable,
  schema: TabularDataSchema,
): ColumnMappingSuggestion {
  const targetCols = extractTabularColumns(schema);
  const sourceStats = computeSourceColumnStats(parsed);

  interface Candidate {
    targetKey: string;
    sourceHeader: string;
    score: number;
    exactKey: boolean;
  }

  const candidates: Candidate[] = [];
  targetCols.forEach((target, tIdx) => {
    for (const src of sourceStats) {
      const { score, exactKey } = scorePair(target, tIdx, src, parsed.headerless);
      if (score > 0) {
        candidates.push({
          targetKey: target.key,
          sourceHeader: src.header,
          score,
          exactKey,
        });
      }
    }
  });

  // Sort by highest score, preferring exact key matches on ties.
  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return Number(b.exactKey) - Number(a.exactKey);
  });

  const mapping: Record<string, string> = {};
  const scores: Record<string, number> = {};
  const exactMap: Record<string, boolean> = {};
  const usedTargets = new Set<string>();
  const usedSources = new Set<string>();

  for (const c of candidates) {
    if (usedTargets.has(c.targetKey) || usedSources.has(c.sourceHeader)) continue;
    // Only auto-assign optional columns when they have a genuine name/headerless signal.
    const isRequired = targetCols.find((t) => t.key === c.targetKey)?.required ?? false;
    if (!isRequired && c.score < 70) continue;
    mapping[c.targetKey] = c.sourceHeader;
    scores[c.targetKey] = c.score;
    exactMap[c.targetKey] = c.exactKey;
    usedTargets.add(c.targetKey);
    usedSources.add(c.sourceHeader);
  }

  const requiredCols = targetCols.filter((c) => c.required);
  const missingRequired = requiredCols
    .filter((c) => !(c.key in mapping))
    .map((c) => c.key);

  const isExactHeaderMatch =
    missingRequired.length === 0 &&
    requiredCols.every((c) => exactMap[c.key] === true);

  // Require confirmation when any required column is missing or confidence is below 85.
  const lowConfidenceRequired = requiredCols.some((c) => (scores[c.key] ?? 0) < 85);
  const needsConfirmation = missingRequired.length > 0 || lowConfidenceRequired;

  return {
    mapping,
    scores,
    missingRequired,
    needsConfirmation,
    isExactHeaderMatch,
    sourceStats,
  };
}

/** Project raw string rows into target-keyed objects using a column mapping. */
export function applyColumnMapping(
  parsed: ParsedRawTable,
  mapping: Record<string, string>,
  schema: TabularDataSchema,
): Array<Record<string, string>> {
  const headerToIndex = new Map<string, number>();
  parsed.headers.forEach((h, i) => headerToIndex.set(h, i));

  const usedSourceIndices = new Set<number>();
  const targetEntries: Array<[string, number]> = [];
  for (const [targetKey, srcHeader] of Object.entries(mapping)) {
    const idx = headerToIndex.get(srcHeader);
    if (idx !== undefined) {
      targetEntries.push([targetKey, idx]);
      usedSourceIndices.add(idx);
    }
  }

  const allowExtra = schema.allowExtraColumns ?? false;
  const extraEntries: Array<[string, number]> = allowExtra
    ? parsed.headers
        .map((h, i): [string, number] => [h, i])
        .filter(([, i]) => !usedSourceIndices.has(i))
    : [];

  return parsed.rows.map((row) => {
    const obj: Record<string, string> = {};
    for (const [targetKey, idx] of targetEntries) {
      obj[targetKey] = row[idx] ?? '';
    }
    for (const [extraHeader, idx] of extraEntries) {
      if (!(extraHeader in obj)) {
        obj[extraHeader] = row[idx] ?? '';
      }
    }
    return obj;
  });
}

function escapeCsvCell(val: unknown, delimiter: string): string {
  if (val === undefined || val === null) return '';
  const str = String(val);
  if (
    str.includes(delimiter) ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r')
  ) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Serialize validated/mapped tabular rows into normalized RFC4180 CSV or TSV
 * with headers ordered according to `schema` (followed by any extra columns).
 */
export function serializeTabularRows(
  rows: ReadonlyArray<TabularRow>,
  schema: TabularDataSchema,
  format?: 'csv' | 'tsv',
): string {
  const fmt = format ?? schema.defaultExportFormat ?? 'csv';
  const delim = fmt === 'tsv' ? '\t' : ',';
  const schemaCols = extractTabularColumns(schema).map((c) => c.key);
  const colSet = new Set<string>(schemaCols);

  if (schema.allowExtraColumns) {
    for (const row of rows) {
      for (const k of Object.keys(row)) {
        if (!colSet.has(k)) {
          colSet.add(k);
          schemaCols.push(k);
        }
      }
    }
  }

  // Drop schema columns that exist but are EMPTY in every row: they only
  // produce trailing commas (`0.00,101.4,`) that downstream numeric parsers
  // treat as malformed rows. Columns absent from the schema keys entirely
  // were already handled above; a fully-empty optional column carries no
  // information, so omitting it loses nothing.
  const used = schemaCols.filter((k) => rows.some((row) => String(row[k] ?? '').trim() !== ''));
  const lines: string[] = [used.map((h) => escapeCsvCell(h, delim)).join(delim)];
  for (const row of rows) {
    lines.push(used.map((k) => escapeCsvCell(row[k], delim)).join(delim));
  }
  return lines.join('\n');
}
