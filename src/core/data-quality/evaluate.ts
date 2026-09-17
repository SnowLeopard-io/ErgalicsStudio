// ==========================================================================
// Expectation evaluation — apply a declarative contract to row data
//
// Every check is evaluated and every failure is retained (lazy/Pandera
// semantics). Issues carry the offending row indices (capped for UI use,
// with the true total in `rowCount`), which is what lets the quarantine step
// separate trustworthy rows from rows a researcher must inspect.
// ==========================================================================

import { makeMissingChecker, profileTable } from './profile';
import type {
  ColumnExpectation,
  QualityIssue,
  QualityOptions,
  QualityReport,
  Row,
  TableExpectations,
} from './types';

// valueKey lives in profile.ts but is not exported there; re-declare locally
// to keep the evidence-keying contract in this module explicit.
function evidenceKey(value: unknown): string {
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

interface CheckCounter {
  checks: number;
  failed: number;
}

class IssueCollector {
  readonly issues: QualityIssue[] = [];
  constructor(private readonly counter: CheckCounter) {}

  /** Record one atomic check + its (possibly empty) error issues. */
  record(issues: QualityIssue[]): void {
    this.counter.checks += 1;
    const failed = issues.some((issue) => issue.severity === 'error');
    if (failed) this.counter.failed += 1;
    this.issues.push(...issues);
  }
}

function rowIssue(
  code: string,
  message: string,
  severity: 'error' | 'warning',
  indices: number[],
  cap: number,
  extra: Partial<QualityIssue> = {},
): QualityIssue {
  return {
    code,
    message,
    severity,
    rowIndices: indices.slice(0, cap),
    rowCount: indices.length,
    ...extra,
  };
}

// ---- column-level evaluation ------------------------------------------------

function evaluateColumn(
  expectation: ColumnExpectation,
  rows: ReadonlyArray<Row>,
  isMissing: (value: unknown) => boolean,
  cap: number,
  collector: IssueCollector,
): QualityIssue[] {
  const severity = expectation.severity ?? 'error';
  const { name } = expectation;
  const withColumn = (issue: QualityIssue): QualityIssue => ({ ...issue, column: name });
  const out: QualityIssue[] = [];

  // Presence check
  const missingIndices: number[] = [];
  rows.forEach((row, index) => {
    if (isMissing(row[name])) missingIndices.push(index);
  });
  const tolerated =
    expectation.maxMissingFraction !== undefined
      ? expectation.maxMissingFraction
      : expectation.required
        ? 0
        : undefined;
  const presentCount = rows.length - missingIndices.length;
  if (tolerated !== undefined && rows.length > 0) {
    const fraction = missingIndices.length / rows.length;
    const issues =
      fraction > tolerated
        ? [
            rowIssue(
              'column.missing',
              `Column "${name}" has ${missingIndices.length} missing value(s) (${(fraction * 100).toFixed(1)}%), tolerated ${(tolerated * 100).toFixed(1)}%`,
              severity,
              missingIndices,
              cap,
              { expected: tolerated, actual: fraction },
            ),
          ]
        : [];
    collector.record(issues);
    out.push(...issues.map(withColumn));
  }

  if (expectation.type) {
    const mismatch: number[] = [];
    const nanIndices: number[] = [];
    const infIndices: number[] = [];
    const nonInteger: number[] = [];
    rows.forEach((row, index) => {
      const value = row[name];
      if (isMissing(value)) return;
      switch (expectation.type) {
        case 'integer':
        case 'number': {
          if (typeof value !== 'number') mismatch.push(index);
          else if (Number.isNaN(value)) nanIndices.push(index);
          else if (!Number.isFinite(value)) infIndices.push(index);
          else if (expectation.type === 'integer' && !Number.isInteger(value)) nonInteger.push(index);
          break;
        }
        case 'boolean':
          if (typeof value !== 'boolean') mismatch.push(index);
          break;
        case 'string':
          if (typeof value !== 'string') mismatch.push(index);
          break;
        case 'category':
          if (!['string', 'number', 'boolean'].includes(typeof value)) mismatch.push(index);
          break;
      }
    });

    const typeIssues: QualityIssue[] = [];
    if (mismatch.length > 0) {
      typeIssues.push(
        rowIssue(
          'column.type_mismatch',
          `Column "${name}" contains ${mismatch.length} value(s) that are not ${expectation.type}`,
          severity,
          mismatch,
          cap,
          { expected: expectation.type },
        ),
      );
    }
    if (nanIndices.length > 0 && !expectation.allowNaN) {
      typeIssues.push(
        rowIssue('column.nan', `Column "${name}" contains NaN values`, severity, nanIndices, cap),
      );
    }
    if (infIndices.length > 0 && !expectation.allowInfinity) {
      typeIssues.push(
        rowIssue(
          'column.infinity',
          `Column "${name}" contains ±Infinity values`,
          severity,
          infIndices,
          cap,
        ),
      );
    }
    if (nonInteger.length > 0) {
      typeIssues.push(
        rowIssue(
          'column.not_integer',
          `Column "${name}" contains ${nonInteger.length} non-integer value(s)`,
          severity,
          nonInteger,
          cap,
        ),
      );
    }
    collector.record(typeIssues);
    out.push(...typeIssues.map(withColumn));
  }

  // Numeric range
  if (expectation.min !== undefined || expectation.max !== undefined) {
    const below: number[] = [];
    const above: number[] = [];
    rows.forEach((row, index) => {
      const value = row[name];
      if (typeof value !== 'number' || !Number.isFinite(value)) return;
      if (expectation.min !== undefined && value < expectation.min) below.push(index);
      if (expectation.max !== undefined && value > expectation.max) above.push(index);
    });
    const rangeIssues: QualityIssue[] = [];
    if (below.length > 0) {
      rangeIssues.push(
        rowIssue(
          'column.min',
          `Column "${name}" has ${below.length} value(s) below ${expectation.min}`,
          severity,
          below,
          cap,
          { expected: `>= ${expectation.min}` },
        ),
      );
    }
    if (above.length > 0) {
      rangeIssues.push(
        rowIssue(
          'column.max',
          `Column "${name}" has ${above.length} value(s) above ${expectation.max}`,
          severity,
          above,
          cap,
          { expected: `<= ${expectation.max}` },
        ),
      );
    }
    collector.record(rangeIssues);
    out.push(...rangeIssues.map(withColumn));
  }

  // Allowed value set
  if (expectation.allowedValues) {
    const allowed = new Set(expectation.allowedValues);
    const offenders = rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => !isMissing(row[name]) && !allowed.has(row[name]));
    const issues =
      offenders.length > 0
        ? [
            rowIssue(
              'column.allowed_values',
              `Column "${name}" has ${offenders.length} value(s) outside the allowed set`,
              severity,
              offenders.map((o) => o.index),
              cap,
              { expected: [...allowed] },
            ),
          ]
        : [];
    collector.record(issues);
    out.push(...issues.map(withColumn));
  }

  // Regex pattern
  if (expectation.pattern) {
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(expectation.pattern);
    } catch {
      regex = null;
    }
    if (regex) {
      const offenders: number[] = [];
      rows.forEach((row, index) => {
        const value = row[name];
        if (typeof value === 'string' && !regex!.test(value)) offenders.push(index);
      });
      const issues =
        offenders.length > 0
          ? [
              rowIssue(
                'column.pattern',
                `Column "${name}" has ${offenders.length} value(s) not matching ${expectation.pattern}`,
                severity,
                offenders,
                cap,
                { expected: expectation.pattern },
              ),
            ]
          : [];
      collector.record(issues);
      out.push(...issues.map(withColumn));
    }
  }

  // Uniqueness
  if (expectation.unique && presentCount > 0) {
    const seen = new Map<string, number>();
    const reportedFirst = new Set<string>();
    const duplicates: number[] = [];
    rows.forEach((row, index) => {
      const value = row[name];
      if (isMissing(value)) return;
      const key = evidenceKey(value);
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, index);
      } else {
        if (!reportedFirst.has(key)) {
          duplicates.push(first);
          reportedFirst.add(key);
        }
        duplicates.push(index);
      }
    });
    const issues =
      duplicates.length > 0
        ? [
            rowIssue(
              'column.duplicate',
              `Column "${name}" contains duplicate values`,
              severity,
              duplicates,
              cap,
            ),
          ]
        : [];
    collector.record(issues);
    out.push(...issues.map(withColumn));
  }

  return out;
}

// ---- public API -------------------------------------------------------------

/**
 * Evaluate an expectation contract against row data. The returned report is
 * fully serialisable and always includes the data profile, even when the
 * contract is empty.
 */
export function evaluateQuality(
  expectations: TableExpectations,
  rows: ReadonlyArray<Row>,
  options: QualityOptions = {},
): QualityReport {
  const cap = options.rowIndexCap ?? 50;
  const isMissing = makeMissingChecker(options.missingTokens);
  const profile = profileTable(rows, options);
  const counter: CheckCounter = { checks: 0, failed: 0 };
  const collector = new IssueCollector(counter);
  const tableIssues: QualityIssue[] = [];

  const pushTable = (issues: QualityIssue[]): void => {
    collector.record(issues);
    tableIssues.push(...issues);
  };

  /** Per-column table rules: each issue is one independent check. */
  const pushTableEach = (issues: QualityIssue[]): void => {
    for (const issue of issues) pushTable([issue]);
  };

  // Row-count bounds
  if (expectations.minRows !== undefined) {
    pushTable(
      rows.length < expectations.minRows
        ? [
            {
              code: 'table.min_rows',
              message: `Expected at least ${expectations.minRows} row(s), got ${rows.length}`,
              severity: 'error',
              expected: expectations.minRows,
              actual: rows.length,
            },
          ]
        : [],
    );
  }
  if (expectations.maxRows !== undefined) {
    pushTable(
      rows.length > expectations.maxRows
        ? [
            {
              code: 'table.max_rows',
              message: `Expected at most ${expectations.maxRows} row(s), got ${rows.length}`,
              severity: 'error',
              expected: expectations.maxRows,
              actual: rows.length,
            },
          ]
        : [],
    );
  }

  const columnSet = new Set(profile.columnNames);

  // Required columns (explicit + implied by a column expectation)
  const required = new Set<string>(expectations.requiredColumns ?? []);
  for (const column of expectations.columns ?? []) required.add(column.name);
  const missingColumns = [...required].filter((name) => !columnSet.has(name));
  pushTableEach(
    missingColumns.map((name) => ({
      code: 'table.missing_column',
      message: `Required column "${name}" is absent`,
      severity: 'error' as const,
      column: name,
    })),
  );

  // Unknown columns in strict mode
  if (expectations.allowUnknownColumns === false) {
    const declared = new Set(expectations.columns?.map((c) => c.name) ?? []);
    const unknown = profile.columnNames.filter((name) => !declared.has(name));
    pushTableEach(
      unknown.map((name) => ({
        code: 'table.unknown_column',
        message: `Unexpected column "${name}"`,
        severity: 'error' as const,
        column: name,
      })),
    );
  }

  // Composite unique keys
  for (const group of expectations.uniqueKeys ?? []) {
    const absent = group.filter((key) => !columnSet.has(key));
    if (absent.length > 0) {
      pushTable([
        {
          code: 'table.missing_key_column',
          message: `Unique key (${group.join(', ')}) references missing column(s): ${absent.join(', ')}`,
          severity: 'error',
        },
      ]);
      continue;
    }
    const seen = new Map<string, number>();
    const reportedFirst = new Set<string>();
    const duplicates: number[] = [];
    rows.forEach((row, index) => {
      const key = group.map((column) => evidenceKey(row[column])).join('|');
      const first = seen.get(key);
      if (first === undefined) {
        seen.set(key, index);
      } else {
        if (!reportedFirst.has(key)) {
          duplicates.push(first);
          reportedFirst.add(key);
        }
        duplicates.push(index);
      }
    });
    pushTable(
      duplicates.length > 0
        ? [
            rowIssue(
              'table.duplicate_key',
              `Unique key (${group.join(', ')}) has duplicate rows`,
              'error',
              duplicates,
              cap,
            ),
          ]
        : [],
    );
  }

  // Column-level checks
  const columns = (expectations.columns ?? [])
    .filter((expectation) => columnSet.has(expectation.name))
    .map((expectation) => {
      const columnProfile = profile.columns.find((c) => c.name === expectation.name);
      const issues = evaluateColumn(expectation, rows, isMissing, cap, collector);
      const ok = !issues.some((issue) => issue.severity === 'error');
      return { name: expectation.name, expectation, profile: columnProfile, issues, ok };
    });

  const allIssues = [...tableIssues, ...columns.flatMap((c) => c.issues)];
  const errors = allIssues.filter((issue) => issue.severity === 'error').length;
  const warnings = allIssues.filter((issue) => issue.severity === 'warning').length;

  return {
    ok: errors === 0,
    evaluatedAt: new Date().toISOString(),
    rowCount: rows.length,
    columnNames: profile.columnNames,
    summary: {
      checks: counter.checks,
      failed: counter.failed,
      errors,
      warnings,
    },
    tableIssues,
    columns,
    issues: allIssues,
    profile,
  };
}
