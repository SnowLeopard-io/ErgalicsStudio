// ==========================================================================
// Data quality engine — public surface
//
// Typical boundary flow after parsing an imported file:
//
//   const profile = profileTable(rows);           // describe the data
//   const schema = suggestExpectations(profile);  // draft a contract
//   const report = evaluateQuality(schema, rows); // gate the data
//   if (!report.ok) {
//     const { accepted, rejected } = splitRows(rows, report);
//   }
// ==========================================================================

export {
  makeMissingChecker,
  profileColumn,
  profileTable,
  collectColumnNames,
  suggestExpectations,
} from './profile';

export { evaluateQuality } from './evaluate';

export { splitRows, rejectionSummary } from './quarantine';
export type { RejectedRow, SplitRowsResult } from './quarantine';

export { tableToRows } from './datatable';

export type {
  Row,
  ColumnDataType,
  InferredColumnType,
  ColumnExpectation,
  TableExpectations,
  NumericProfile,
  CategoryProfile,
  ColumnProfile,
  TableProfile,
  QualityIssue,
  ColumnQualityResult,
  QualitySummary,
  QualityReport,
  QualityOptions,
} from './types';
