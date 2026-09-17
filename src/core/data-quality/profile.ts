// ==========================================================================
// Column/table profiling — infer types and statistics in one pass per column
//
// A profile is the descriptive counterpart of an expectation contract: it
// powers "suggest a schema from this CSV" workflows (the Pandera/GX
// infer-schema pattern) and feeds advisory checks such as IQR outlier
// detection. Complexity is O(rows × columns) with a second short pass only
// over numeric columns for outlier localisation.
// ==========================================================================

import type {
  ColumnExpectation,
  ColumnProfile,
  NumericProfile,
  QualityOptions,
  Row,
  TableExpectations,
  TableProfile,
} from './types';

const DEFAULT_MISSING: unknown[] = [null, undefined, Number.NaN, ''];
const CATEGORY_MAX_DISTINCT = 20;
const TOP_CATEGORIES = 10;
const TYPE_CONFLICT_SAMPLE = 10;

/** Build a missing-value checker. Set.has uses SameValueZero, so NaN matches. */
export function makeMissingChecker(tokens?: ReadonlyArray<unknown>): (value: unknown) => boolean {
  const set = new Set<unknown>(tokens ?? DEFAULT_MISSING);
  return (value: unknown) => set.has(value);
}

function quantile(sorted: ReadonlyArray<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0]!;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (h - lo);
}

interface ColumnAccumulator {
  name: string;
  present: number;
  missing: number;
  finite: number[];
  nanCount: number;
  posInf: number;
  negInf: number;
  boolCount: number;
  stringCount: number;
  otherCount: number;
  conflictSamples: number[];
  valueCounts: Map<string, { count: number; value: unknown }>;
}

function accumulate(
  name: string,
  rows: ReadonlyArray<Row>,
  isMissing: (value: unknown) => boolean,
): ColumnAccumulator {
  const acc: ColumnAccumulator = {
    name,
    present: 0,
    missing: 0,
    finite: [],
    nanCount: 0,
    posInf: 0,
    negInf: 0,
    boolCount: 0,
    stringCount: 0,
    otherCount: 0,
    conflictSamples: [],
    valueCounts: new Map(),
  };
  rows.forEach((row, index) => {
    const value = row[name];
    if (isMissing(value)) {
      acc.missing += 1;
      return;
    }
    acc.present += 1;
    if (typeof value === 'number') {
      if (Number.isNaN(value)) acc.nanCount += 1;
      else if (value === Number.POSITIVE_INFINITY) acc.posInf += 1;
      else if (value === Number.NEGATIVE_INFINITY) acc.negInf += 1;
      else acc.finite.push(value);
    } else if (typeof value === 'boolean') {
      acc.boolCount += 1;
    } else if (typeof value === 'string') {
      acc.stringCount += 1;
    } else {
      acc.otherCount += 1;
      if (acc.conflictSamples.length < TYPE_CONFLICT_SAMPLE) acc.conflictSamples.push(index);
    }
    const key = valueKey(value);
    const entry = acc.valueCounts.get(key);
    if (entry) entry.count += 1;
    else acc.valueCounts.set(key, { count: 1, value });
  });
  return acc;
}

function valueKey(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'nan:NaN';
  if (value === null) return 'null:null';
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    try {
      return `obj:${JSON.stringify(value)}`;
    } catch {
      return `obj:${String(value)}`;
    }
  }
  return `${typeof value}:${String(value)}`;
}

function inferType(acc: ColumnAccumulator): ColumnProfile['inferredType'] {
  if (acc.present === 0) return 'unknown';
  if (acc.boolCount === acc.present) return 'boolean';
  const numericLike = acc.finite.length + acc.nanCount + acc.posInf + acc.negInf;
  if (numericLike === acc.present) {
    const nonFinite = acc.nanCount + acc.posInf + acc.negInf;
    if (nonFinite === 0 && acc.finite.every(Number.isInteger)) return 'integer';
    return 'number';
  }
  if (acc.stringCount === acc.present) {
    return acc.valueCounts.size <= CATEGORY_MAX_DISTINCT ? 'category' : 'string';
  }
  return 'mixed';
}

function buildNumericProfile(
  acc: ColumnAccumulator,
  rows: ReadonlyArray<Row>,
  outlierCap: number,
): NumericProfile | undefined {
  if (acc.finite.length === 0 && acc.nanCount + acc.posInf + acc.negInf === 0) return undefined;
  const sorted = [...acc.finite].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = n > 0 ? sorted.reduce((sum, v) => sum + v, 0) / n : Number.NaN;
  const variance =
    n >= 2 ? sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (n - 1) : 0;
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;

  const outlierIndices: number[] = [];
  let outlierCount = 0;
  if (Number.isFinite(low) && Number.isFinite(high)) {
    rows.forEach((row, index) => {
      const value = row[acc.name];
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      if (value < low || value > high) {
        outlierCount += 1;
        if (outlierIndices.length < outlierCap) outlierIndices.push(index);
      }
    });
  }
  return {
    count: n,
    nanCount: acc.nanCount,
    positiveInfinityCount: acc.posInf,
    negativeInfinityCount: acc.negInf,
    min: n > 0 ? sorted[0]! : Number.NaN,
    max: n > 0 ? sorted[n - 1]! : Number.NaN,
    mean,
    sampleSd: Math.sqrt(variance),
    q1,
    median,
    q3,
    outlierIndices,
    outlierCount,
  };
}

export function profileColumn(
  name: string,
  rows: ReadonlyArray<Row>,
  options: QualityOptions = {},
): ColumnProfile {
  const isMissing = makeMissingChecker(options.missingTokens);
  const acc = accumulate(name, rows, isMissing);
  const inferredType = inferType(acc);
  const total = rows.length;
  const top = [...acc.valueCounts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, TOP_CATEGORIES)
    .map((entry) => ({ value: String(entry.value), count: entry.count }));
  return {
    name,
    inferredType,
    present: acc.present,
    missing: acc.missing,
    missingFraction: total > 0 ? acc.missing / total : 0,
    distinct: acc.valueCounts.size,
    ...(inferredType === 'number' || inferredType === 'integer'
      ? {
          numeric: buildNumericProfile(
            acc,
            rows,
            options.outlierIndexCap ?? 50,
          ),
        }
      : {}),
    ...(inferredType === 'category' ? { categories: { distinct: acc.valueCounts.size, top } } : {}),
    typeConflictSamples: acc.conflictSamples,
  };
}

/** Union of every column name seen across rows (first-seen order). */
export function collectColumnNames(rows: ReadonlyArray<Row>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        ordered.push(key);
      }
    }
  }
  return ordered;
}

export function profileTable(rows: ReadonlyArray<Row>, options: QualityOptions = {}): TableProfile {
  const columnNames = collectColumnNames(rows);
  return {
    rowCount: rows.length,
    columnNames,
    columns: columnNames.map((name) => profileColumn(name, rows, options)),
  };
}

/**
 * Suggest an expectation contract from a profile. Numeric bounds mirror the
 * observed range; categories enumerate their values; columns without data
 * produce no assertion. Callers tighten the generated contract (e.g. remove
 * `allowNaN`) before using it as a gate.
 */
export function suggestExpectations(profile: TableProfile): TableExpectations {
  const columns = profile.columns
    .filter((column) => column.inferredType !== 'unknown')
    .map((column): ColumnExpectation => {
      const base: ColumnExpectation = {
        name: column.name,
        required: column.missing === 0,
      };
      if (column.numeric) {
        base.type = column.inferredType === 'integer' ? 'integer' : 'number';
        if (Number.isFinite(column.numeric.min)) base.min = column.numeric.min;
        if (Number.isFinite(column.numeric.max)) base.max = column.numeric.max;
        if (column.numeric.nanCount > 0) base.allowNaN = true;
        if (column.numeric.positiveInfinityCount + column.numeric.negativeInfinityCount > 0) {
          base.allowInfinity = true;
        }
      } else if (column.inferredType === 'boolean') {
        base.type = 'boolean';
      } else if (column.inferredType === 'category' && column.categories) {
        base.type = 'category';
        base.allowedValues = column.categories.top.map((entry) => entry.value);
      } else if (column.inferredType === 'string') {
        base.type = 'string';
      } else {
        // 'mixed' — no type assertion, presence only.
        base.type = undefined;
      }
      return base;
    });
  return { columns, allowUnknownColumns: true };
}
