// ==========================================================================
// Ergalics Studio — shared two-column file picker
//
// The floating file window is domain-agnostic: callers hand it columns of
// items (project files, examples, industrial studies, …) and decide what a
// click means. The data-file surfaces and the industrial import window both
// render this exact component, so their layout never drifts apart.
// ==========================================================================

import { useState, type ReactNode } from 'react';
import { useT } from '@/i18n';

/** Monochrome glyph per file format. */
export function fileIcon(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'csv':
      return '▦';
    case 'json':
      return '▣';
    case 'xyz':
      return '◈';
    case 'dat':
      return '▤';
    case 'msh':
    case 'inp':
    case 'vtk':
    case 'vtu':
      return '◫';
    case 'dxf':
    case 'step':
    case 'stp':
      return '◇';
    default:
      return '▧';
  }
}

/** One row in a picker column. */
export interface FilePickerItem {
  /** Stable identifier (file path, example id, …). */
  id: string;
  /** Primary label. */
  name: string;
  /** Leading glyph; defaults to `fileIcon(name)`. */
  icon?: string;
  /** Right-aligned, single-line metadata (size, format, …). */
  meta?: string;
  /** Optional second line (example descriptions). */
  description?: string;
  /** Tooltip; defaults to `name`. */
  title?: string;
  disabled?: boolean;
  /** Non-clickable row (read-only catalogue entries). */
  readonly?: boolean;
  /** Inline row actions; when present the row itself is not clickable. */
  actions?: ReactNode;
}

/** One labelled column ("project files", "examples", …). */
export interface FilePickerColumn {
  key: string;
  title: string;
  items: FilePickerItem[];
  /** Shown when the column is empty. */
  empty: string;
}

interface FilePickerPanelProps {
  columns: FilePickerColumn[];
  /** Selected item id, highlighted in the list. */
  value?: string;
  onChoose: (item: FilePickerItem, column: FilePickerColumn) => void;
  className?: string;
}

/** Below this count a filter input costs more than scrolling. */
const FILTER_THRESHOLD = 12;

/** One column with an optional name filter (185 bundled examples made the
 *  plain list unusable). The filter matches names case-insensitively. */
function PickerColumn({
  column,
  value,
  onChoose,
}: {
  column: FilePickerColumn;
  value?: string;
  onChoose: (item: FilePickerItem, column: FilePickerColumn) => void;
}) {
  const t = useT();
  const [filter, setFilter] = useState('');
  const needle = filter.trim().toLowerCase();
  const items =
    needle === ''
      ? column.items
      : column.items.filter((item) => item.name.toLowerCase().includes(needle));
  return (
    <section className="data-file-picker-col">
      <div className="data-file-picker-head">
        <span>{column.title}</span>
        <span className="data-file-picker-count">{items.length}</span>
      </div>
      {column.items.length > FILTER_THRESHOLD && (
        <input
          type="search"
          className="input data-file-picker-filter"
          placeholder={t('files.filter_placeholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <div className="data-file-picker-list" role="listbox">
        {items.map((item) => {
          const current = value !== undefined && value === item.id;
          const className = [
            'data-file-picker-item',
            current ? 'is-current' : '',
            item.readonly ? 'is-readonly' : '',
            item.description ? 'has-description' : '',
          ]
            .filter(Boolean)
            .join(' ');
          const body = (
            <>
              <span className="data-file-picker-icon">{item.icon ?? fileIcon(item.name)}</span>
              <span className="data-file-picker-text">
                <span className="data-file-picker-name">{item.name}</span>
                {item.description && (
                  <span className="data-file-picker-desc">{item.description}</span>
                )}
              </span>
              {item.meta && <span className="data-file-row-meta">{item.meta}</span>}
            </>
          );

          if (item.actions) {
            return (
              <div key={item.id} className={className} title={item.title ?? item.name}>
                {body}
                <span className="data-file-row-actions">{item.actions}</span>
              </div>
            );
          }
          if (item.readonly) {
            return (
              <div key={item.id} className={className} title={item.title ?? item.name}>
                {body}
              </div>
            );
          }
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={current}
              className={className}
              disabled={item.disabled}
              title={item.title ?? item.name}
              onClick={() => onChoose(item, column)}
            >
              {body}
            </button>
          );
        })}
        {items.length === 0 && <div className="empty-hint">{column.empty}</div>}
      </div>
    </section>
  );
}

/** The two-column listing shared by every file window. */
export function FilePickerPanel({
  columns,
  value,
  onChoose,
  className,
}: FilePickerPanelProps) {
  return (
    <div className={className ? `data-file-picker ${className}` : 'data-file-picker'}>
      {columns.map((column) => (
        <PickerColumn key={column.key} column={column} value={value} onChoose={onChoose} />
      ))}
    </div>
  );
}
