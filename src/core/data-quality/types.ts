// ==========================================================================
// Data quality — expectation schema and report types
//
// Modelled on the industry-standard "expectations" pattern (Great
// Expectations / Pandera): declarative column- and table-level contracts,
// lazy evaluation that collects *every* failure in one pass, and row-level
// evidence (the exact rows that violate each expectation) so imported
// scientific data can be gated or quarantined instead of silently producing
// wrong results downstream (GIGO — validate at every boundary).
// ==========================================================================

import type { IssueSeverity } from '@/core/validation/types';

/** A row is a name → scalar value record (CSV/TSV/DataTable adaptation). */
export type Row = Record<string, unknown>;

/** Type inferred from observed values (profiling) or asserted by a contract. */
export type ColumnDataType = 'integer' | 'number' | 'boolean' | 'category' | 'string';
export type InferredColumnType = ColumnDataType | 'mixed' | 'unknown';

export interface ColumnExpectation {
  name: string;
  /** Asserted type; omitted → profiling/advisory only. */
  type?: ColumnDataType;
  /** Value must be present in every row (alias for maxMissingFraction: 0). */
  required?: boolean;
  /** Maximum tolerated missing fraction in [0, 1]. */
  maxMissingFraction?: number;
  // ---- numeric ----
  min?: number;
  max?: number;
  allowNaN?: boolean;
  allowInfinity?: boolean;
  // ---- categorical / textual ----
  allowedValues?: ReadonlyArray<unknown>;
  /** Regex source applied to string values. */
  pattern?: string;
  unique?: boolean;
  /** Override the default error severity for this column. */
  severity?: IssueSeverity;
}

export interface TableExpectations {
  columns?: ColumnExpectation[];
  /** Columns that must exist regardless of a full column expectation. */
  requiredColumns?: string[];
  /** Reject columns not declared in `columns` (default: tolerate them). */
  allowUnknownColumns?: boolean;
  minRows?: number;
  maxRows?: number;
  /** Composite uniqueness groups, e.g. `[['id'], ['time', 'sensor']]`. */
  uniqueKeys?: string[][];
}

export interface NumericProfile {
  /** Finite numeric values observed. */
  count: number;
  nanCount: number;
  positiveInfinityCount: number;
  negativeInfinityCount: number;
  min: number;
  max: number;
  mean: number;
  sampleSd: number;
  q1: number;
  median: number;
  q3: number;
  /** IQR (Tukey) outlier indices, capped; total in outlierCount. */
  outlierIndices: number[];
  outlierCount: number;
}

export interface CategoryProfile {
  distinct: number;
  top: Array<{ value: string; count: number }>;
}

export interface ColumnProfile {
  name: string;
  inferredType: InferredColumnType;
  present: number;
  missing: number;
  missingFraction: number;
  distinct: number;
  numeric?: NumericProfile;
  categories?: CategoryProfile;
  /** Up to 10 row indices whose values conflict with the inferred type. */
  typeConflictSamples: number[];
}

export interface TableProfile {
  rowCount: number;
  columnNames: string[];
  columns: ColumnProfile[];
}

export interface QualityIssue {
  code: string;
  message: string;
  severity: IssueSeverity;
  column?: string;
  /** First N offending row indices (cap configurable; total in rowCount). */
  rowIndices?: number[];
  rowCount?: number;
  expected?: unknown;
  actual?: unknown;
}

export interface ColumnQualityResult {
  name: string;
  expectation?: ColumnExpectation;
  profile?: ColumnProfile;
  issues: QualityIssue[];
  ok: boolean;
}

export interface QualitySummary {
  /** Atomic expectation checks evaluated. */
  checks: number;
  /** Checks that produced at least one error-severity issue. */
  failed: number;
  errors: number;
  warnings: number;
}

export interface QualityReport {
  ok: boolean;
  evaluatedAt: string;
  rowCount: number;
  columnNames: string[];
  summary: QualitySummary;
  tableIssues: QualityIssue[];
  columns: ColumnQualityResult[];
  /** All issues, table-level first. */
  issues: QualityIssue[];
  profile: TableProfile;
}

export interface QualityOptions {
  /** Values treated as missing (default null, undefined, NaN, ''). */
  missingTokens?: ReadonlyArray<unknown>;
  /** Maximum row indices attached to one issue (default 50). */
  rowIndexCap?: number;
  /** Sample size for outlier indices (default 50). */
  outlierIndexCap?: number;
}
