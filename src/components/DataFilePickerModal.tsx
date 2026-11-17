// ==========================================================================
// Ergalics Studio — shared data file picker (floating window)
//
// The two-column picker (project data / bundled examples) originally built
// for block mode's `field_data_file` is reused everywhere a data source is
// chosen: `DataFilePickerModal` is the floating window itself and
// `DataFilePickField` is a button-shaped field that opens it, replacing the
// old dropdown selects on the research tool pages.
// ==========================================================================

import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { collectProjectFiles, listDataFilesGrouped } from '@/core/dataFiles';

interface DataFileGroups {
  project: string[];
  examples: string[];
}

/** Monochrome glyph per file format (mirrors the project file manager). */
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
    default:
      return '▧';
  }
}

interface PickerBodyProps {
  /** Currently selected file name, highlighted in the list. */
  value?: string;
  onChoose: (name: string) => void;
}

/** The two-column listing shared by the event-driven dialog and the modal. */
export function DataFilePickerBody({ value, onChoose }: PickerBodyProps) {
  const t = useT();
  const [groups, setGroups] = useState<DataFileGroups>(() => listDataFilesGrouped());

  // Show the cached listing immediately, then refresh the workspace snapshot
  // so files created/imported this session are included.
  useEffect(() => {
    setGroups(listDataFilesGrouped());
    void collectProjectFiles().then(() => setGroups(listDataFilesGrouped()));
  }, []);

  const columns = [
    {
      key: 'project',
      title: t('block.data_file.project'),
      names: groups.project,
      empty: t('block.data_file.empty_project'),
    },
    {
      key: 'examples',
      title: t('block.data_file.examples'),
      names: groups.examples,
      empty: t('block.data_file.empty_examples'),
    },
  ];

  return (
    <div className="data-file-picker">
      {columns.map((column) => (
        <section key={column.key} className="data-file-picker-col">
          <div className="data-file-picker-head">
            <span>{column.title}</span>
            <span className="data-file-picker-count">{column.names.length}</span>
          </div>
          <div className="data-file-picker-list" role="listbox">
            {column.names.map((name) => (
              <button
                key={name}
                type="button"
                role="option"
                aria-selected={value === name}
                className={`data-file-picker-item${value === name ? ' is-current' : ''}`}
                title={name}
                onClick={() => onChoose(name)}
              >
                <span className="data-file-picker-icon">{fileIcon(name)}</span>
                <span className="data-file-picker-name">{name}</span>
              </button>
            ))}
            {column.names.length === 0 && (
              <div className="empty-hint">{column.empty}</div>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}

interface PickerModalProps extends PickerBodyProps {
  open: boolean;
  onClose: () => void;
}

/** Floating window wrapper around `DataFilePickerBody`. */
export function DataFilePickerModal({ open, value, onChoose, onClose }: PickerModalProps) {
  const t = useT();
  if (!open) return null;
  return (
    <Modal
      open={open}
      title={t('block.data_file.title')}
      onClose={onClose}
      width={680}
    >
      <DataFilePickerBody
        value={value}
        onChoose={(name) => {
          onChoose(name);
          onClose();
        }}
      />
    </Modal>
  );
}

interface PickFieldProps {
  /** Selected file name ('' = nothing selected). */
  value: string;
  onChange: (name: string) => void;
  /** i18n key shown when nothing is selected (default: analysis.select_file). */
  placeholderKey?: string;
  disabled?: boolean;
  /** Extra class(es) for the wrapper, e.g. to inherit row layout rules. */
  className?: string;
  /** Show a ✕ button that resets to '' (the old dropdown's empty option). */
  allowClear?: boolean;
  /** Optional tour anchor attribute on the trigger button. */
  dataTour?: string;
}

/**
 * Button-shaped field that opens the shared picker modal. Replaces the
 * former grouped dropdown selects: the floating window shows every
 * resolvable file with icons and grouping, regardless of list length.
 */
export function DataFilePickField({
  value,
  onChange,
  placeholderKey = 'analysis.select_file',
  disabled = false,
  className,
  allowClear = true,
  dataTour,
}: PickFieldProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <span className={className ? `data-file-field ${className}` : 'data-file-field'}>
        <button
          type="button"
          className="data-file-field-btn"
          disabled={disabled}
          title={value || undefined}
          data-tour={dataTour}
          onClick={() => setOpen(true)}
        >
          <span className="data-file-picker-icon">{value ? fileIcon(value) : '▾'}</span>
          <span className="data-file-field-name">{value || t(placeholderKey)}</span>
        </button>
        {allowClear && value && !disabled && (
          <button
            type="button"
            className="data-file-field-clear"
            aria-label={t('common.clear')}
            title={t('common.clear')}
            onClick={() => onChange('')}
          >
            ✕
          </button>
        )}
      </span>
      <DataFilePickerModal
        open={open}
        value={value}
        onChoose={onChange}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
