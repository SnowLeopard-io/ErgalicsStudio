// ==========================================================================
// FR-16 — windowed result table
//
// Renders only the rows intersecting the scroll viewport (plus an overscan
// band); the off-screen head/tail are replaced by two spacer rows that carry
// the collapsed height. Pure props — no stores — so any page can drop it in.
// ==========================================================================

import { useMemo, useState } from 'react';
import type { UIEvent } from 'react';

export interface VirtualTableColumn {
  name: string;
  title?: string;
}

interface VirtualTableProps {
  columns: VirtualTableColumn[];
  rows: unknown[][];
  /** Fixed row height in px (must roughly match the CSS row height). */
  rowHeight?: number;
  /** Viewport height in px. */
  height?: number;
  /** Extra rows rendered above/below the viewport. */
  overscan?: number;
  emptyText?: string;
}

export function VirtualTable({
  columns,
  rows,
  rowHeight = 28,
  height = 360,
  overscan = 8,
  emptyText,
}: VirtualTableProps) {
  const [scrollTop, setScrollTop] = useState(0);

  const { first, last } = useMemo(() => {
    const visible = Math.ceil(height / rowHeight);
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const end = Math.min(rows.length, start + visible + overscan * 2);
    return { first: start, last: end };
  }, [scrollTop, rows.length, height, rowHeight, overscan]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  if (rows.length === 0 && emptyText) {
    return <div className="empty-hint">{emptyText}</div>;
  }

  const slice = rows.slice(first, last);
  const topPad = first * rowHeight;
  const bottomPad = Math.max(0, (rows.length - last) * rowHeight);

  return (
    <div className="virtual-table-scroll sql-result-scroll" style={{ height }} onScroll={onScroll}>
      <table className="virtual-table sql-result-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.name} title={c.title}>
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {topPad > 0 && (
            <tr aria-hidden="true" style={{ height: topPad }}>
              <td colSpan={columns.length} style={{ padding: 0, border: 'none' }} />
            </tr>
          )}
          {slice.map((row, i) => (
            <tr key={first + i}>
              {row.map((cell, j) => (
                <td key={j}>{cell === null ? 'NULL' : String(cell)}</td>
              ))}
            </tr>
          ))}
          {bottomPad > 0 && (
            <tr aria-hidden="true" style={{ height: bottomPad }}>
              <td colSpan={columns.length} style={{ padding: 0, border: 'none' }} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
