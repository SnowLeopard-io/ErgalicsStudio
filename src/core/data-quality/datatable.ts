// ==========================================================================
// DataTable adapter — connect the block system's columnar table to the
// row-oriented quality engine without changing either type.
// ==========================================================================

import type { DataTable } from '@/types/datatable';
import type { Row } from './types';

/**
 * Materialise a DataTable's rows as plain records. Typed-array elements are
 * read directly (no numeric coercion — the storage types already guarantee
 * numbers). Intended for validation/preview-scale tables; chunked ingestion
 * stays the path for very large files.
 */
export function tableToRows(table: DataTable): Row[] {
  const names = table.columnNames();
  const columns = names.map((name) => table.getColumn(name));
  const rows: Row[] = new Array(table.length);
  for (let i = 0; i < table.length; i += 1) {
    const row: Row = {};
    columns.forEach((data, columnIndex) => {
      if (data) row[names[columnIndex]!] = data[i];
    });
    rows[i] = row;
  }
  return rows;
}
