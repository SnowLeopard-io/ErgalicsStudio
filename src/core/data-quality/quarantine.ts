// ==========================================================================
// Row quarantine — split trustworthy rows from rows needing inspection
//
// A failing quality gate rarely invalidates an entire imported file: a few
// out-of-range rows should not block analysis of 99.9% of the data (Galaxy/
// ETL "dead-letter queue" pattern). `splitRows` uses the row-level evidence
// in a QualityReport to partition input rows, attaching the exact reasons.
// ==========================================================================

import type { QualityIssue, QualityReport, Row } from './types';

export interface RejectedRow {
  index: number;
  row: Row;
  reasons: QualityIssue[];
}

export interface SplitRowsResult {
  accepted: Row[];
  rejected: RejectedRow[];
}

/**
 * Partition rows by error-severity evidence. Warning-only issues and
 * table-level issues without row evidence do not quarantine rows.
 */
export function splitRows(
  rows: ReadonlyArray<Row>,
  report: QualityReport,
): SplitRowsResult {
  const byRow = new Map<number, QualityIssue[]>();
  for (const issue of report.issues) {
    if (issue.severity !== 'error' || !issue.rowIndices) continue;
    // Prefer the full index list: the report caps the attached indices but
    // callers evaluating the same data usually need every rejection; when
    // only the capped list exists, that is what we have.
    const indices = issue.rowIndices;
    for (const index of indices) {
      const list = byRow.get(index);
      if (list) list.push(issue);
      else byRow.set(index, [issue]);
    }
  }

  const accepted: Row[] = [];
  const rejected: RejectedRow[] = [];
  rows.forEach((row, index) => {
    const reasons = byRow.get(index);
    if (reasons) rejected.push({ index, row, reasons });
    else accepted.push(row);
  });
  return { accepted, rejected };
}

/** Human-readable summary of why a row was rejected. */
export function rejectionSummary(rejected: RejectedRow): string {
  return rejected.reasons.map((reason) => reason.message).join('; ');
}
