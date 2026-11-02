// ==========================================================================
// Schema Inference & Validator kernel — pure, deterministic functions.
//
// Complements (rather than duplicates) the core data-quality engine: missing
// tokens, column discovery and the Row model are reused from
// `@/core/data-quality`, while this module adds what the core profiler
// deliberately does not model:
//   - date / datetime column typing and ISO-string range statistics
//   - regex fingerprints of fixed-format string columns (e.g. 'dddd-dd-dd')
//   - primary-key candidates, functional dependencies (A → B) and
//     numeric column correlations
//   - draft-07 JSON Schema emission, row-level validation with error /
//     warning grading, schema-drift diffing and serialisable data contracts
//
// No DOM, no clock, no randomness: identical inputs yield identical outputs.
// ==========================================================================

import { collectColumnNames, makeMissingChecker } from '@/core/data-quality';
import type { Row } from '@/core/data-quality';

// ---- schema model -----------------------------------------------------------

export type SchemaColumnType =
  | 'integer'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'string'
  | 'categorical';

export interface CategoryCount {
  value: string;
  count: number;
}

export interface ColumnSchema {
  name: string;
  type: SchemaColumnType;
  nullable: boolean;
  /** distinct non-missing values / non-missing values, in [0, 1]. */
  uniqueRatio: number;
  /** missing values / rows, in [0, 1]. */
  missingRatio: number;
  /** Observed range; numbers for numeric columns, ISO strings for dates. */
  min?: number | string;
  max?: number | string;
  /** Sample mean of a numeric column (for 3-sigma outlier warnings). */
  mean?: number;
  /** Sample standard deviation of a numeric column. */
  sd?: number;
  /** Category values with frequencies (categorical columns only). */
  categories?: CategoryCount[];
  /** Regex fingerprint shared by every value of a string column. */
  pattern?: string;
  /** uniqueRatio === 1 with no missing value. */
  primaryKeyCandidate: boolean;
}

export interface FunctionalDependency {
  /** Column A whose value uniquely determines column B (A → B). */
  determinant: string;
  dependent: string;
}

export interface ColumnCorrelation {
  a: string;
  b: string;
  /** Pearson r over rows where both columns are present. */
  r: number;
}

export interface TableSchema {
  rowCount: number;
  columnNames: string[];
  columns: ColumnSchema[];
  functionalDependencies: FunctionalDependency[];
  correlations: ColumnCorrelation[];
}

// ---- tuning constants ---------------------------------------------------------

/** Distinct-value cap for the string → categorical promotion (mirrors core). */
const CATEGORY_MAX_DISTINCT = 20;
/** Ordered pairs above this column count make O(c² · n) FD search prohibitive. */
const FD_MAX_COLUMNS = 40;
/** |Pearson r| at which two numeric columns are reported as correlated. */
const CORRELATION_THRESHOLD = 0.7;
/** Default relative tolerance for range drift (5 % of the observed span). */
export const DEFAULT_RANGE_TOLERANCE = 0.05;

// ---- cell classification -------------------------------------------------------

const INT_RE = /^[+-]?\d+$/;
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const DATETIME_RE =
  /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[T ]([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):?[0-5]\d)?$/;

type CellKind = 'int' | 'num' | 'bool' | 'date' | 'datetime' | 'str';

function classifyString(t: string): CellKind | null {
  if (INT_RE.test(t)) return 'int';
  if (NUM_RE.test(t)) return 'num';
  if (/^(true|false)$/i.test(t)) return 'bool';
  if (DATE_RE.test(t)) return 'date';
  if (DATETIME_RE.test(t)) return 'datetime';
  return 'str';
}

/**
 * Normalise one raw scalar for inference: returns `null` for missing values
 * (null / undefined / NaN / '' / non-finite numbers) and otherwise a typed
 * value plus its kind.
 */
export function classifyCell(value: unknown): { kind: CellKind; value: unknown } | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null; // NaN / ±Infinity: unusable
    return { kind: Number.isInteger(value) ? 'int' : 'num', value };
  }
  if (typeof value === 'boolean') return { kind: 'bool', value };
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return null;
    const kind = classifyString(t);
    if (kind === 'int' || kind === 'num') return { kind, value: Number(t) };
    return { kind: kind ?? 'str', value: t };
  }
  // Objects / arrays from JSON sources: keep a stable string form.
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return { kind: 'str', value: text };
}

// ---- CSV / JSON ingestion -------------------------------------------------------

export interface RawTable {
  columns: string[];
  rows: string[][];
}

/** Split one CSV line honouring double-quoted cells with escaped quotes. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
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
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/** Parse CSV text into a header + string-cell table. `null` when empty. */
export function parseCsvTable(text: string): RawTable | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 1) return null;
  const raw = splitCsvLine(lines[0]!).map((c) => c.trim());
  const seen = new Set<string>();
  const columns = raw.map((h, i) => {
    let name = h || `col${i + 1}`;
    let k = 2;
    while (seen.has(name)) {
      name = `${h || 'col'}_${k}`;
      k += 1;
    }
    seen.add(name);
    return name;
  });
  const rows = lines.slice(1).map((l) => splitCsvLine(l));
  return { columns, rows };
}

/** Coerce one CSV string cell: '' / number / boolean / trimmed string. */
export function coerceCell(cell: string): unknown {
  const t = cell.trim();
  if (t === '') return '';
  if (INT_RE.test(t) || NUM_RE.test(t)) return Number(t);
  if (/^true$/i.test(t)) return true;
  if (/^false$/i.test(t)) return false;
  return t;
}

export function tableToTypedRows(table: RawTable): Row[] {
  return table.rows.map((cells) => {
    const row: Row = {};
    table.columns.forEach((name, i) => {
      row[name] = coerceCell(cells[i] ?? '');
    });
    return row;
  });
}

/**
 * Parse an uploaded data file into typed rows. CSV cells are coerced
 * (numbers / booleans / trimmed strings); JSON input must be an array of
 * flat row objects. Throws an `Error` with a user-facing message on
 * malformed input.
 */
export function parseDataRows(text: string, format: 'csv' | 'json'): Row[] {
  if (format === 'csv') {
    const table = parseCsvTable(text);
    if (!table) throw new Error('CSV input is empty');
    return tableToTypedRows(table);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error('JSON input must be an array of row objects');
  }
  return parsed.filter(
    (item): item is Row => typeof item === 'object' && item !== null && !Array.isArray(item),
  );
}

// ---- fingerprint ----------------------------------------------------------------

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/;

function charClass(ch: string): 'd' | 'a' | 'A' | null {
  if (ch >= '0' && ch <= '9') return 'd';
  if (ch >= 'a' && ch <= 'z') return 'a';
  if (ch >= 'A' && ch <= 'Z') return 'A';
  return null;
}

/**
 * Regex fingerprint of one string as a *usable* regular expression, e.g.
 * `'2024-01-02'` → `\d{4}-\d{2}-\d{2}`, `'AB-1234'` → `[A-Z]{2}-\d{4}`.
 * Digit / lower-case / upper-case runs become `\d` / `[a-z]` / `[A-Z]`
 * classes with an explicit `{n}` quantifier; other characters are kept as
 * escaped literals so the result validates every value it was derived from.
 */
export function fingerprintOf(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    const cls = charClass(ch);
    let j = i + 1;
    while (j < s.length) {
      const next = s[j]!;
      if (cls === null ? next !== ch : charClass(next) !== cls) break;
      j += 1;
    }
    const n = j - i;
    if (cls === null) {
      const esc = REGEX_SPECIAL.test(ch) ? `\\${ch}` : ch;
      out += esc + (n > 1 ? `{${n}}` : '');
    } else {
      const clsRe = cls === 'd' ? '\\d' : cls === 'a' ? '[a-z]' : '[A-Z]';
      out += n > 1 ? `${clsRe}{${n}}` : clsRe;
    }
    i = j;
  }
  return out;
}

// ---- inference --------------------------------------------------------------------

interface DistinctEntry {
  count: number;
  str: string;
}

interface ColumnAcc {
  name: string;
  missing: number;
  present: number;
  kinds: Record<CellKind, number>;
  distinct: Map<string, DistinctEntry>;
  numeric: number[];
  dates: string[];
  fingerprints: Map<string, number>;
}

function keyOf(kind: CellKind, value: unknown): string {
  return `${kind[0]}:${String(value)}`;
}

function emptyAcc(name: string): ColumnAcc {
  return {
    name,
    missing: 0,
    present: 0,
    kinds: { int: 0, num: 0, bool: 0, date: 0, datetime: 0, str: 0 },
    distinct: new Map(),
    numeric: [],
    dates: [],
    fingerprints: new Map(),
  };
}

function accumulate(name: string, rows: ReadonlyArray<Row>): ColumnAcc {
  const acc = emptyAcc(name);
  for (const row of rows) {
    const cell = classifyCell(row[name]);
    if (!cell) {
      acc.missing += 1;
      continue;
    }
    acc.present += 1;
    acc.kinds[cell.kind] += 1;
    const key = keyOf(cell.kind, cell.value);
    const entry = acc.distinct.get(key);
    if (entry) entry.count += 1;
    else acc.distinct.set(key, { count: 1, str: String(cell.value) });
    if (cell.kind === 'int' || cell.kind === 'num') acc.numeric.push(cell.value as number);
    else if (cell.kind === 'date' || cell.kind === 'datetime') acc.dates.push(cell.value as string);
    else if (cell.kind === 'str') {
      const fp = fingerprintOf(cell.value as string);
      acc.fingerprints.set(fp, (acc.fingerprints.get(fp) ?? 0) + 1);
    }
  }
  return acc;
}

function decideType(acc: ColumnAcc): SchemaColumnType {
  const k = acc.kinds;
  const { present } = acc;
  if (present === 0) return 'string';
  if (k.bool === present) return 'boolean';
  if (k.int + k.num === present) return k.num > 0 ? 'number' : 'integer';
  if (k.date === present) return 'date';
  if (k.date + k.datetime === present) return 'datetime';
  if (k.str === present) {
    return acc.distinct.size <= CATEGORY_MAX_DISTINCT ? 'categorical' : 'string';
  }
  return 'string'; // mixed kinds cannot be typed precisely
}

function buildColumnSchema(acc: ColumnAcc, rowCount: number): ColumnSchema {
  const type = decideType(acc);
  const nullable = acc.missing > 0;
  const uniqueRatio = acc.present > 0 ? acc.distinct.size / acc.present : 0;
  const missingRatio = rowCount > 0 ? acc.missing / rowCount : 0;
  const primaryKeyCandidate = rowCount > 0 && acc.present === rowCount && acc.distinct.size === acc.present;

  const schema: ColumnSchema = {
    name: acc.name,
    type,
    nullable,
    uniqueRatio,
    missingRatio,
    primaryKeyCandidate,
  };

  if (type === 'integer' || type === 'number') {
    const values = acc.numeric;
    if (values.length > 0) {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      let sum = 0;
      for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      const mean = sum / values.length;
      schema.min = min;
      schema.max = max;
      schema.mean = mean;
      if (values.length >= 2) {
        let ss = 0;
        for (const v of values) ss += (v - mean) ** 2;
        schema.sd = Math.sqrt(ss / (values.length - 1));
      }
    }
  } else if (type === 'date' || type === 'datetime') {
    if (acc.dates.length > 0) {
      // ISO-8601 strings sort lexicographically in chronological order.
      let min = acc.dates[0]!;
      let max = min;
      for (const v of acc.dates) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      schema.min = min;
      schema.max = max;
    }
  } else if (type === 'categorical') {
    schema.categories = [...acc.distinct.values()]
      .map((e) => ({ value: e.str, count: e.count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  }

  if (type === 'string' || type === 'categorical') {
    if (acc.fingerprints.size > 0 && acc.present > 0) {
      for (const [fp, count] of acc.fingerprints) {
        if (count === acc.present) {
          schema.pattern = fp;
          break;
        }
      }
    }
  }
  return schema;
}

/** true when every non-missing (a, b) pair respects a → b. */
function determines(
  rows: ReadonlyArray<Row>,
  a: string,
  b: string,
): boolean {
  const mapping = new Map<string, string>();
  for (const row of rows) {
    const ca = classifyCell(row[a]);
    const cb = classifyCell(row[b]);
    if (!ca || !cb) continue; // missing on either side: not evidence
    const ka = keyOf(ca.kind, ca.value);
    const kb = keyOf(cb.kind, cb.value);
    const prev = mapping.get(ka);
    if (prev === undefined) mapping.set(ka, kb);
    else if (prev !== kb) return false;
  }
  return true;
}

/**
 * Infer a table schema: per-column typing / statistics, primary-key
 * candidates, functional dependencies (determinants must be non-key and
 * non-constant so trivial `id → x` implications are excluded) and strongly
 * correlated numeric column pairs.
 */
export function inferSchema(rows: ReadonlyArray<Row>): TableSchema {
  const columnNames = collectColumnNames(rows);
  const accs = columnNames.map((name) => accumulate(name, rows));
  const columns = accs.map((acc) => buildColumnSchema(acc, rows.length));

  // Functional dependencies (quadratic in columns; skip on very wide tables).
  const functionalDependencies: FunctionalDependency[] = [];
  if (columnNames.length > 1 && columnNames.length <= FD_MAX_COLUMNS) {
    for (let i = 0; i < accs.length; i += 1) {
      const a = accs[i]!;
      const detSchema = columns[i]!;
      if (a.distinct.size < 2 || detSchema.primaryKeyCandidate) continue;
      for (let j = 0; j < accs.length; j += 1) {
        if (i === j) continue;
        const b = accs[j]!;
        if (b.distinct.size < 2) continue; // constant dependent: trivial
        if (determines(rows, a.name, b.name)) {
          functionalDependencies.push({ determinant: a.name, dependent: b.name });
        }
      }
    }
  }

  // Correlated numeric column pairs.
  const correlations: ColumnCorrelation[] = [];
  const numericCols = columns
    .map((c, i) => ({ c, acc: accs[i]! }))
    .filter(({ c }) => c.type === 'integer' || c.type === 'number');
  if (numericCols.length > 1) {
    const series = numericCols.map(({ acc }) =>
      rows.map((row) => {
        const cell = classifyCell(row[acc.name]);
        return cell && (cell.kind === 'int' || cell.kind === 'num') ? (cell.value as number) : Number.NaN;
      }),
    );
    for (let i = 0; i < series.length; i += 1) {
      for (let j = i + 1; j < series.length; j += 1) {
        const r = pearson(series[i]!, series[j]!);
        if (r !== null && Math.abs(r) >= CORRELATION_THRESHOLD) {
          correlations.push({
            a: numericCols[i]!.c.name,
            b: numericCols[j]!.c.name,
            r,
          });
        }
      }
    }
  }

  return {
    rowCount: rows.length,
    columnNames,
    columns,
    functionalDependencies,
    correlations,
  };
}

/** Pearson r, or `null` when fewer than 3 paired values or zero variance. */
function pearson(xs: ReadonlyArray<number>, ys: ReadonlyArray<number>): number | null {
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i += 1) {
    const x = xs[i]!;
    const y = ys[i]!;
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push([x, y]);
  }
  const n = pairs.length;
  if (n < 3) return null;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pairs) {
    sx += x;
    sy += y;
  }
  const mx = sx / n;
  const my = sy / n;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (const [x, y] of pairs) {
    const dx = x - mx;
    const dy = y - my;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  if (vx <= 0 || vy <= 0) return null;
  return cov / Math.sqrt(vx * vy);
}

// ---- JSON Schema (draft-07) ---------------------------------------------------------

const JSON_SCHEMA_DIALECT = 'http://json-schema.org/draft-07/schema#';

/**
 * Emit a draft-07 JSON Schema for the inferred schema. Nullable columns use
 * the `['<type>', 'null']` union convention; categorical columns become
 * `enum`s; date / datetime columns get `format`; numeric columns get
 * `minimum` / `maximum`. `required` lists every non-nullable column.
 */
export function toJsonSchema(schema: TableSchema): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const col of schema.columns) {
    const prop: Record<string, unknown> = {};
    const baseType =
      col.type === 'integer' || col.type === 'number' || col.type === 'boolean'
        ? col.type
        : 'string'; // date / datetime / string / categorical are strings in JSON
    prop.type = col.nullable ? [baseType, 'null'] : baseType;
    if (col.type === 'date') prop.format = 'date';
    else if (col.type === 'datetime') prop.format = 'date-time';
    if (col.type === 'categorical' && col.categories) {
      const values: unknown[] = col.categories.map((c) => c.value);
      if (col.nullable) values.push(null);
      prop.enum = values;
    }
    if (col.type === 'string' && col.pattern) prop.pattern = col.pattern;
    if ((col.type === 'integer' || col.type === 'number') && typeof col.min === 'number') {
      prop.minimum = col.min;
    }
    if ((col.type === 'integer' || col.type === 'number') && typeof col.max === 'number') {
      prop.maximum = col.max;
    }
    properties[col.name] = prop;
    if (!col.nullable) required.push(col.name);
  }
  return {
    $schema: JSON_SCHEMA_DIALECT,
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

// ---- validation ----------------------------------------------------------------------

export type ViolationCode =
  | 'MISSING_REQUIRED'
  | 'TYPE_MISMATCH'
  | 'OUT_OF_RANGE'
  | 'INVALID_CATEGORY'
  | 'PATTERN_MISMATCH'
  | 'OUTLIER_3SIGMA'
  | 'UNKNOWN_COLUMN'
  | 'UNIQUE_KEY_VIOLATION';

export interface Violation {
  /** Row index; -1 marks a column-level (not row-localisable) finding. */
  row: number;
  column: string;
  code: ViolationCode;
  severity: 'error' | 'warning';
  /** Short English reason; the UI maps `code` to locale text. */
  reason: string;
  actual: unknown;
}

export interface ValidationResult {
  rowCount: number;
  violations: Violation[];
  errorCount: number;
  warningCount: number;
  /** Fraction of rows carrying at least one error-severity violation. */
  violatingRowRatio: number;
}

export interface ValidateOptions {
  /** Sigma multiplier for outlier warnings (default 3). */
  outlierSigma?: number;
  /** Suppress UNKNOWN_COLUMN findings (used by permissive contracts). */
  ignoreUnknownColumns?: boolean;
}

function matchesType(type: SchemaColumnType, value: unknown): boolean {
  switch (type) {
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value);
    case 'datetime':
      return typeof value === 'string' && DATETIME_RE.test(value);
    case 'string':
    case 'categorical':
      return typeof value === 'string';
    default:
      return false;
  }
}

/**
 * Validate rows against an inferred schema. Every finding is collected
 * (lazy/Pandera semantics): type mismatches, range and category-domain
 * breaches, pattern violations and required-but-missing values are errors;
 * 3-sigma outliers and schema-unknown columns are warnings.
 */
export function validateAgainstSchema(
  rows: ReadonlyArray<Row>,
  schema: TableSchema,
  options: ValidateOptions = {},
): ValidationResult {
  const isMissing = makeMissingChecker();
  const sigma = options.outlierSigma ?? 3;
  const violations: Violation[] = [];
  const violatingRows = new Set<number>();
  const knownColumns = new Set(schema.columnNames);

  const patternRes = new Map<string, RegExp>();
  for (const col of schema.columns) {
    if (col.pattern) {
      try {
        patternRes.set(col.name, new RegExp(col.pattern));
      } catch {
        // An unusable fingerprint must never break validation.
      }
    }
  }

  for (const col of schema.columns) {
    const rangeSet = typeof col.min === typeof col.max;
    const categories =
      col.type === 'categorical' && col.categories
        ? new Set(col.categories.map((c) => c.value))
        : null;
    const patternRe = patternRes.get(col.name);
    rows.forEach((row, rowIndex) => {
      const raw = row[col.name];
      if (isMissing(raw)) {
        if (!col.nullable) {
          violations.push({
            row: rowIndex,
            column: col.name,
            code: 'MISSING_REQUIRED',
            severity: 'error',
            reason: 'required value is missing',
            actual: raw,
          });
          violatingRows.add(rowIndex);
        }
        return;
      }
      if (!matchesType(col.type, raw)) {
        violations.push({
          row: rowIndex,
          column: col.name,
          code: 'TYPE_MISMATCH',
          severity: 'error',
          reason: `expected ${col.type}`,
          actual: raw,
        });
        violatingRows.add(rowIndex);
        return;
      }
      if (rangeSet) {
        if (
          (typeof col.min === 'number' && typeof raw === 'number' && (raw < col.min || raw > (col.max as number))) ||
          (typeof col.min === 'string' && typeof raw === 'string' && (raw < col.min || raw > (col.max as string)))
        ) {
          violations.push({
            row: rowIndex,
            column: col.name,
            code: 'OUT_OF_RANGE',
            severity: 'error',
            reason: `value outside observed range [${String(col.min)}, ${String(col.max)}]`,
            actual: raw,
          });
          violatingRows.add(rowIndex);
          return;
        }
      }
      if (categories && !categories.has(raw as string)) {
        violations.push({
          row: rowIndex,
          column: col.name,
          code: 'INVALID_CATEGORY',
          severity: 'error',
          reason: 'value outside the inferred category domain',
          actual: raw,
        });
        violatingRows.add(rowIndex);
        return;
      }
      if (patternRe && typeof raw === 'string' && !patternRe.test(raw)) {
        violations.push({
          row: rowIndex,
          column: col.name,
          code: 'PATTERN_MISMATCH',
          severity: 'error',
          reason: `value does not match pattern ${col.pattern}`,
          actual: raw,
        });
        violatingRows.add(rowIndex);
        return;
      }
      if (
        (col.type === 'integer' || col.type === 'number') &&
        typeof raw === 'number' &&
        typeof col.mean === 'number' &&
        typeof col.sd === 'number' &&
        col.sd > 0 &&
        Math.abs(raw - col.mean) > sigma * col.sd
      ) {
        violations.push({
          row: rowIndex,
          column: col.name,
          code: 'OUTLIER_3SIGMA',
          severity: 'warning',
          reason: `value deviates more than ${sigma} sample deviations from the mean`,
          actual: raw,
        });
      }
    });
  }

  if (!options.ignoreUnknownColumns) {
    const unknown = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!knownColumns.has(key)) unknown.add(key);
      }
    }
    for (const name of unknown) {
      violations.push({
        row: -1,
        column: name,
        code: 'UNKNOWN_COLUMN',
        severity: 'warning',
        reason: 'column is not declared in the schema',
        actual: null,
      });
    }
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const v of violations) {
    if (v.severity === 'error') errorCount += 1;
    else warningCount += 1;
  }
  return {
    rowCount: rows.length,
    violations,
    errorCount,
    warningCount,
    violatingRowRatio: rows.length > 0 ? violatingRows.size / rows.length : 0,
  };
}

// ---- schema drift -----------------------------------------------------------------------

export type DriftKind =
  | 'added-column'
  | 'removed-column'
  | 'type-changed'
  | 'nullable-changed'
  | 'category-expanded'
  | 'category-contracted'
  | 'range-drift';

export type DriftSeverity = 'info' | 'warning' | 'error';

export interface DriftItem {
  kind: DriftKind;
  column: string;
  severity: DriftSeverity;
  detail: string;
  oldValue?: unknown;
  newValue?: unknown;
}

export interface DiffOptions {
  /** Relative tolerance for numeric range drift (default 0.05 = 5 % span). */
  rangeTolerance?: number;
}

function summarizeValues(values: string[], cap = 5): string {
  const shown = values.slice(0, cap).join(', ');
  return values.length > cap ? `${shown}, …` : shown;
}

/**
 * Compare two inferred schemas of the same logical table. Additions are
 * informational, tightened nullability / removals / type changes are
 * breaking (error), and category-domain or range widening is a warning.
 */
export function diffSchemas(
  oldSchema: TableSchema,
  newSchema: TableSchema,
  options: DiffOptions = {},
): DriftItem[] {
  const tolerance = options.rangeTolerance ?? DEFAULT_RANGE_TOLERANCE;
  const drift: DriftItem[] = [];
  const oldByName = new Map(oldSchema.columns.map((c) => [c.name, c]));
  const newByName = new Map(newSchema.columns.map((c) => [c.name, c]));

  for (const col of newSchema.columns) {
    if (!oldByName.has(col.name)) {
      drift.push({
        kind: 'added-column',
        column: col.name,
        severity: 'info',
        detail: `column is new in the latest data (type ${col.type})`,
        newValue: col.type,
      });
    }
  }
  for (const col of oldSchema.columns) {
    const next = newByName.get(col.name);
    if (!next) {
      drift.push({
        kind: 'removed-column',
        column: col.name,
        severity: 'error',
        detail: `column present in the reference schema is missing (was ${col.type})`,
        oldValue: col.type,
      });
      continue;
    }

    if (col.type !== next.type) {
      drift.push({
        kind: 'type-changed',
        column: col.name,
        severity: 'error',
        detail: `column type changed from ${col.type} to ${next.type}`,
        oldValue: col.type,
        newValue: next.type,
      });
    } else {
      // Range drift only makes sense between comparable types.
      if (
        (col.type === 'integer' || col.type === 'number') &&
        typeof col.min === 'number' &&
        typeof col.max === 'number' &&
        typeof next.min === 'number' &&
        typeof next.max === 'number'
      ) {
        const span = Math.abs(col.max - col.min);
        const tol = tolerance * Math.max(span, 1e-12);
        if (next.min < col.min - tol || next.max > col.max + tol) {
          drift.push({
            kind: 'range-drift',
            column: col.name,
            severity: 'warning',
            detail: `observed range widened from [${col.min}, ${col.max}] to [${next.min}, ${next.max}] (tolerance ${(tolerance * 100).toFixed(1)}%)`,
            oldValue: [col.min, col.max],
            newValue: [next.min, next.max],
          });
        }
      }
      if (
        (col.type === 'date' || col.type === 'datetime') &&
        typeof col.min === 'string' &&
        typeof col.max === 'string' &&
        typeof next.min === 'string' &&
        typeof next.max === 'string' &&
        (next.min < col.min || next.max > col.max)
      ) {
        drift.push({
          kind: 'range-drift',
          column: col.name,
          severity: 'warning',
          detail: `date range widened from [${col.min}, ${col.max}] to [${next.min}, ${next.max}]`,
          oldValue: [col.min, col.max],
          newValue: [next.min, next.max],
        });
      }
    }

    if (col.nullable !== next.nullable) {
      drift.push({
        kind: 'nullable-changed',
        column: col.name,
        severity: next.nullable ? 'info' : 'error',
        detail: next.nullable
          ? 'column became nullable (requirement relaxed)'
          : 'column became non-nullable (new required values)',
        oldValue: col.nullable,
        newValue: next.nullable,
      });
    }

    if (col.categories && next.categories) {
      const oldValues = new Set(col.categories.map((c) => c.value));
      const newValues = new Set(next.categories.map((c) => c.value));
      const added = next.categories.map((c) => c.value).filter((v) => !oldValues.has(v));
      const removed = col.categories.map((c) => c.value).filter((v) => !newValues.has(v));
      if (added.length > 0) {
        drift.push({
          kind: 'category-expanded',
          column: col.name,
          severity: 'warning',
          detail: `new category values observed: ${summarizeValues(added)}`,
          newValue: added,
        });
      }
      if (removed.length > 0) {
        drift.push({
          kind: 'category-contracted',
          column: col.name,
          severity: 'warning',
          detail: `previously observed categories absent: ${summarizeValues(removed)}`,
          oldValue: removed,
        });
      }
    }
  }
  return drift;
}

// ---- data contract -------------------------------------------------------------------------

export interface DataContractConstraints {
  /** Column groups whose combined values must be unique per row. */
  uniqueKeys: string[][];
  /** Columns that must be present and non-missing in every row. */
  nonNullColumns: string[];
  /** When false, columns outside the schema are flagged. */
  allowExtraColumns: boolean;
}

export interface DataContract {
  contractVersion: 1;
  createdAt: string;
  schema: TableSchema;
  constraints: DataContractConstraints;
  tolerances: { rangeTolerance: number };
}

/**
 * Draft a contract from an inferred schema: single-column primary-key
 * candidates become unique keys, non-nullable columns become non-null
 * constraints and the default range tolerance is applied.
 */
export function suggestContract(
  schema: TableSchema,
  options: { rangeTolerance?: number; allowExtraColumns?: boolean } = {},
): DataContract {
  return {
    contractVersion: 1,
    createdAt: new Date().toISOString(),
    schema,
    constraints: {
      uniqueKeys: schema.columns.filter((c) => c.primaryKeyCandidate).map((c) => [c.name]),
      nonNullColumns: schema.columns.filter((c) => !c.nullable).map((c) => c.name),
      allowExtraColumns: options.allowExtraColumns ?? false,
    },
    tolerances: { rangeTolerance: options.rangeTolerance ?? DEFAULT_RANGE_TOLERANCE },
  };
}

/** Serialise a contract to pretty JSON (for `setParam` / export). */
export function serializeContract(contract: DataContract): string {
  return JSON.stringify(contract, null, 2);
}

/** Parse a serialised contract; throws `Error` with a clear message when malformed. */
export function deserializeContract(text: string): DataContract {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`contract is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  const c = parsed as Partial<DataContract> | null;
  if (
    !c ||
    typeof c !== 'object' ||
    c.contractVersion !== 1 ||
    !c.schema ||
    !Array.isArray(c.schema.columns) ||
    !c.constraints ||
    !Array.isArray(c.constraints.uniqueKeys) ||
    !Array.isArray(c.constraints.nonNullColumns) ||
    typeof c.constraints.allowExtraColumns !== 'boolean' ||
    !c.tolerances ||
    typeof c.tolerances.rangeTolerance !== 'number'
  ) {
    throw new Error('malformed data contract (expected contractVersion 1 with schema, constraints and tolerances)');
  }
  return parsed as DataContract;
}

/**
 * Validate rows against a data contract: schema validation plus contract
 * constraints (non-null columns, unique keys). Extra columns are honoured
 * via `constraints.allowExtraColumns`.
 */
export function validateContract(
  rows: ReadonlyArray<Row>,
  contract: DataContract,
  options: ValidateOptions = {},
): ValidationResult {
  const base = validateAgainstSchema(rows, contract.schema, {
    ...options,
    ignoreUnknownColumns: contract.constraints.allowExtraColumns,
  });
  const isMissing = makeMissingChecker();
  const seen = new Set(base.violations.map((v) => `${v.row}|${v.column}|${v.code}`));
  const violations = [...base.violations];
  const violatingRows = new Set<number>();
  for (const v of base.violations) {
    if (v.severity === 'error' && v.row >= 0) violatingRows.add(v.row);
  }

  const push = (violation: Violation): void => {
    const key = `${violation.row}|${violation.column}|${violation.code}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push(violation);
    if (violation.severity === 'error' && violation.row >= 0) violatingRows.add(violation.row);
  };

  for (const name of contract.constraints.nonNullColumns) {
    rows.forEach((row, rowIndex) => {
      if (isMissing(row[name])) {
        push({
          row: rowIndex,
          column: name,
          code: 'MISSING_REQUIRED',
          severity: 'error',
          reason: 'contract requires this column to be non-missing',
          actual: row[name],
        });
      }
    });
  }

  for (const keyColumns of contract.constraints.uniqueKeys) {
    if (keyColumns.length === 0) continue;
    const firstSeen = new Map<string, number>();
    rows.forEach((row, rowIndex) => {
      const parts: string[] = [];
      let complete = true;
      for (const name of keyColumns) {
        const cell = classifyCell(row[name]);
        if (!cell) {
          complete = false; // missing key component: uniqueness not judgeable
          break;
        }
        parts.push(`${name}=${String(cell.value)}`);
      }
      if (!complete) return;
      const key = parts.join('\u001f');
      const first = firstSeen.get(key);
      if (first === undefined) firstSeen.set(key, rowIndex);
      else {
        push({
          row: rowIndex,
          column: keyColumns.join('+'),
          code: 'UNIQUE_KEY_VIOLATION',
          severity: 'error',
          reason: `duplicate unique key (first seen in row ${first})`,
          actual: parts.join(', '),
        });
      }
    });
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const v of violations) {
    if (v.severity === 'error') errorCount += 1;
    else warningCount += 1;
  }
  return {
    rowCount: rows.length,
    violations,
    errorCount,
    warningCount,
    violatingRowRatio: rows.length > 0 ? violatingRows.size / rows.length : 0,
  };
}
