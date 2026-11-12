// ==========================================================================
// Ergalics Studio — data file picker dialog (block mode source fields)
//
// Mounted once by the workbench. Blockly's custom `field_data_file` cannot
// render a React dialog, so it dispatches PICK_DATA_FILE_EVENT; this host
// answers with a two-column picker (project data / bundled examples) and
// writes the choice back through the request's `select` callback.
// ==========================================================================

import { useEffect, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { collectProjectFiles, listDataFilesGrouped } from '@/core/dataFiles';
import { PICK_DATA_FILE_EVENT, type DataFilePickRequest } from '@/editor/block/data-file-picker';

interface DataFileGroups {
  project: string[];
  examples: string[];
}

/** Monochrome glyph per file format (mirrors the project file manager). */
function fileIcon(name: string): string {
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

export function DataFilePickerDialog() {
  const t = useT();
  const [request, setRequest] = useState<DataFilePickRequest | null>(null);
  const [groups, setGroups] = useState<DataFileGroups>({ project: [], examples: [] });

  useEffect(() => {
    const onPick = (event: Event) => {
      const detail = (event as CustomEvent<DataFilePickRequest>).detail;
      if (!detail) return;
      // Show the cached listing immediately, then refresh the workspace
      // snapshot so files created/imported this session are included.
      setGroups(listDataFilesGrouped());
      setRequest(detail);
      void collectProjectFiles().then(() => setGroups(listDataFilesGrouped()));
    };
    window.addEventListener(PICK_DATA_FILE_EVENT, onPick);
    return () => window.removeEventListener(PICK_DATA_FILE_EVENT, onPick);
  }, []);

  const choose = (name: string) => {
    request?.select(name);
    setRequest(null);
  };

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
    <Modal
      open={request !== null}
      title={t('block.data_file.title')}
      onClose={() => setRequest(null)}
      width={680}
    >
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
                  aria-selected={request?.value === name}
                  className={`data-file-picker-item${request?.value === name ? ' is-current' : ''}`}
                  title={name}
                  onClick={() => choose(name)}
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
    </Modal>
  );
}
