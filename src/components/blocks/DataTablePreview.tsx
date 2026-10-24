// ==========================================================================
// Ergalics Studio — DataTable preview (block system)
//
// Renders a DataTable output as a read-only table so statistical blocks
// (summary, histogram bins, ...) have a visible result too, not just the
// `viz.*` blocks. Pure presentational; no store coupling.
// ==========================================================================

import { useT } from '@/i18n';
import type { DataTable } from '@/types/datatable';

const MAX_ROWS = 20;

function formatCell(value: unknown): string {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN';
    if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
    return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, '');
  }
  if (value === undefined || value === null) return '';
  return String(value);
}

export function DataTablePreview({ table }: { table: DataTable }) {
  const t = useT();
  const columns = table.columns;
  const rows = Math.min(table.length, MAX_ROWS);
  const headers = columns.map((c) => `${c.name}`);
  const body: string[][] = [];
  for (let i = 0; i < rows; i += 1) {
    body.push(columns.map((c) => formatCell(table.getColumn(c.name)?.[i])));
  }

  return (
    <div className="dt-preview">
      <div className="dt-preview-meta">
        {t('blocks.table.meta', { rows: table.length, cols: columns.length })}
        {table.provenance ? <span className="dt-preview-prov"> · {table.provenance}</span> : null}
      </div>
      <div className="dt-preview-scroll">
        <table className="dt-preview-table">
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, i) => (
              <tr key={i}>
                {row.map((v, j) => (
                  <td key={j}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.length > rows && (
        <div className="dt-preview-note">
          {t('blocks.table.note', { rows, total: table.length })}
        </div>
      )}
    </div>
  );
}
