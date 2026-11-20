// ==========================================================================
// Ergalics Studio — shared data files window (floating window)
//
// One window for every data-file surface:
//  - pick mode: the two-column picker (project data / bundled examples) used
//    by block mode's `field_data_file` and the research tools' pick fields;
//  - manage mode: the project data manager (import, load into the active
//    plugin, delete, chunk preview) opened by the top bar's 数据 button.
// Both modes render the same two-column list; manage mode only layers the
// per-file actions on top, so the two surfaces never drift apart again.
// ==========================================================================

import { useEffect, useRef, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { FilesManagerModal } from './FilesManagerModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { DownloadIcon, TableIcon, TrashIcon } from '@/components/icons';
import {
  FilePickerPanel,
  fileIcon,
  type FilePickerColumn,
  type FilePickerItem,
} from '@/components/FilePicker';
import { collectProjectFiles, listDataFilesGrouped, resolveDataFile } from '@/core/dataFiles';
import { DATA_FILE_ACCEPT, isSupportedDataFileName } from '@/core/fileFormat';
import { downloadText } from '@/core/plot/export';
import { logger } from '@/core/logger';
import { formatBytes } from '@/core/storage';
import { useAppStore } from '@/stores/appStore';
import { useChunkStore } from '@/stores/chunkStore';
import { usePluginStore, refreshParamDefs } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
import type { FileEntry } from '@/types/project';

interface DataFileGroups {
  project: string[];
  examples: string[];
}

export { fileIcon };

/** Load the grouped listing, refreshing the workspace snapshot in the back. */
function useDataFileGroups(): [DataFileGroups, () => void] {
  const [groups, setGroups] = useState<DataFileGroups>(() => listDataFilesGrouped());
  const refresh = () => setGroups(listDataFilesGrouped());
  useEffect(() => {
    refresh();
    void collectProjectFiles().then(() => setGroups(listDataFilesGrouped()));
  }, []);
  return [groups, refresh];
}

interface PickerBodyProps {
  /** Currently selected file name, highlighted in the list. */
  value?: string;
  onChoose: (name: string) => void;
}

/** The two-column listing shared by the picker and the manager. */
export function DataFilePickerBody({ value, onChoose }: PickerBodyProps) {
  const t = useT();
  const [groups] = useDataFileGroups();

  const columns: FilePickerColumn[] = [
    {
      key: 'project',
      title: t('block.data_file.project'),
      items: groups.project.map((name) => ({ id: name, name })),
      empty: t('block.data_file.empty_project'),
    },
    {
      key: 'examples',
      title: t('block.data_file.examples'),
      items: groups.examples.map((name) => ({ id: name, name })),
      empty: t('block.data_file.empty_examples'),
    },
  ];

  return (
    <FilePickerPanel
      columns={columns}
      value={value}
      onChoose={(item) => onChoose(item.id)}
    />
  );
}

interface ManagerColumnArgs {
  t: (key: string, params?: Record<string, string | number>) => string;
  project: string[];
  examples: string[];
  entryOf: (name: string) => FileEntry | undefined;
  canChunk: (name: string) => boolean;
  loadIntoActive: (name: string) => void | Promise<void>;
  setDeleteFile: (entry: FileEntry) => void;
  startIngest: (entry: FileEntry, chunkSize: number) => unknown;
  chunkRunning: boolean;
  hasActivePlugin: boolean;
  /** Save a bundled example to disk (examples are not FileEntries). */
  downloadExample: (name: string) => void | Promise<void>;
}

/** Manager rows = picker rows + per-file actions. */
function managerColumns({
  t,
  project,
  examples,
  entryOf,
  canChunk,
  loadIntoActive,
  setDeleteFile,
  startIngest,
  chunkRunning,
  hasActivePlugin,
  downloadExample,
}: ManagerColumnArgs): FilePickerColumn[] {
  return [
    {
      key: 'project',
      title: t('block.data_file.project'),
      empty: t('workbench.example.files_empty'),
      items: project.map((name): FilePickerItem => {
        const entry = entryOf(name);
        return {
          id: name,
          name,
          meta: entry ? formatBytes(entry.size) : undefined,
          actions: (
            <>
              <button
                type="button"
                className="icon-btn"
                title={t('workbench.files.load')}
                aria-label={t('workbench.files.load')}
                disabled={!hasActivePlugin}
                onClick={() => void loadIntoActive(name)}
              >
                <DownloadIcon size={13} />
              </button>
              {entry && canChunk(name) && (
                <button
                  type="button"
                  className="icon-btn"
                  title={t('workbench.files.chunk_preview')}
                  aria-label={t('workbench.files.chunk_preview')}
                  disabled={chunkRunning}
                  onClick={() => void startIngest(entry, 1000)}
                >
                  <TableIcon size={13} />
                </button>
              )}
              {entry && (
                <button
                  type="button"
                  className="icon-btn"
                  title={t('common.delete')}
                  aria-label={t('common.delete')}
                  onClick={() => setDeleteFile(entry)}
                >
                  <TrashIcon size={13} />
                </button>
              )}
            </>
          ),
        };
      }),
    },
    {
      key: 'examples',
      title: t('block.data_file.examples'),
      empty: t('block.data_file.empty_examples'),
      // Same action set as project files: load into the active plugin and
      // download — examples resolve through the bundled data registry.
      items: examples.map((name): FilePickerItem => ({
        id: name,
        name,
        readonly: true,
        actions: (
          <>
            <button
              type="button"
              className="icon-btn"
              title={t('workbench.files.load')}
              aria-label={t('workbench.files.load')}
              disabled={!hasActivePlugin}
              onClick={() => void loadIntoActive(name)}
            >
              <DownloadIcon size={13} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t('workbench.files.download')}
              aria-label={t('workbench.files.download')}
              onClick={() => void downloadExample(name)}
            >
              <span aria-hidden="true" style={{ fontSize: 13, lineHeight: 1 }}>↓</span>
            </button>
          </>
        ),
      })),
    },
  ];
}

/** Manage mode: the same two-column list, plus import / load / delete. */
function DataFilesManagerBody() {
  const t = useT();
  const { locale } = useLocale();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const addDataFile = useProjectStore((s) => s.addDataFile);
  const removeDataFile = useProjectStore((s) => s.removeDataFile);
  const activeId = usePluginStore((s) => s.activeId);
  const registry = usePluginStore((s) => s.registry);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteFile, setDeleteFile] = useState<FileEntry | null>(null);
  // Names of the last import batch that replaced same-name files — shown as
  // an inline banner inside this window (not a global toast).
  const [replacedNames, setReplacedNames] = useState<string[]>([]);
  const chunkState = useChunkStore((s) => s.state);
  const canChunk = useChunkStore((s) => s.canChunk);
  const startIngest = useChunkStore((s) => s.startIngest);
  const cancelIngest = useChunkStore((s) => s.cancel);
  const resetChunk = useChunkStore((s) => s.reset);

  const [groups, refreshGroups] = useDataFileGroups();

  const chunkPreviewRows = chunkState?.preview ? Math.min(chunkState.preview.length, 8) : 0;
  const chunkColumns = chunkState?.preview?.columns ?? [];

  const activeEntry = registry.find((e) => e.id === activeId) ?? null;
  const activeName = activeEntry?.nameI18n?.[locale] ?? activeEntry?.name ?? '';

  /** Imported files carry their own entry (delete/chunk); workspace files don't. */
  const entryOf = (name: string): FileEntry | undefined =>
    project?.data.files.find((f) => f.name === name);

  const handleImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let ok = 0;
    const replaced: string[] = [];
    for (const file of Array.from(files)) {
      // Gate at the entry point: data files are parsed as text downstream, so
      // binary picks (xlsx, parquet, …) would only fail later as "unreadable".
      if (!isSupportedDataFileName(file.name)) {
        notify('error', t('workbench.files.unsupported_format', { name: file.name }));
        continue;
      }
      const duplicate = useProjectStore
        .getState()
        .project?.data.files.some((f) => f.name === file.name);
      try {
        await addDataFile(file);
        ok += 1;
        if (duplicate) replaced.push(file.name);
      } catch (err) {
        logger.error('data', `import failed ${file.name}`, err);
      }
    }
    setReplacedNames(replaced);
    refreshGroups();
    if (ok > 0) {
      notify('success', t('workbench.example.files_imported', { count: ok }));
    } else {
      notify('error', t('workbench.example.files_import_failed'));
    }
  };

  /** Send a project or workspace file into the currently active plugin. */
  const loadIntoActive = async (name: string) => {
    const plugin = activeEntry?.plugin;
    if (!plugin || typeof plugin.loadData !== 'function') {
      notify('warning', t('workbench.files.no_active_plugin'));
      return;
    }
    const entry = entryOf(name);
    try {
      const text = entry ? entry.content : await resolveDataFile(name);
      if (text === undefined) {
        notify('error', t('workbench.files.load_failed', { reason: name }));
        return;
      }
      const blob = new File([text], name, {
        type: entry?.mimeType ?? 'text/plain',
      });
      await plugin.loadData(blob);
      // The import may have changed the plugin's own parameter set.
      refreshParamDefs(activeEntry?.id ?? '');
      notify('success', t('workbench.files.loaded', { plugin: activeName || name }));
    } catch (err) {
      notify('error', t('workbench.files.load_failed', { reason: String(err) }));
    }
  };

  /** Save a bundled example to disk (examples are not FileEntries). */
  const downloadExample = async (name: string) => {
    try {
      const text = await resolveDataFile(name);
      if (text === undefined) {
        notify('error', t('workbench.files.load_failed', { reason: name }));
        return;
      }
      downloadText(text, name, 'text/plain');
    } catch (err) {
      logger.warn('data', `example download failed ${name}`, err);
      notify('error', t('workbench.files.load_failed', { reason: String(err) }));
    }
  };

  return (
    <>
      <div className="project-files-toolbar">
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => fileInputRef.current?.click()}
        >
          {t('workbench.example.files_import')}
        </button>
        <span className="project-files-hint">{t('workbench.example.files_hint')}</span>
      </div>
      <div className="project-files-hint">{t('workbench.files.load_hint')}</div>

        {replacedNames.length > 0 && (
          <div className="project-files-warning">
            ⚠ {t('workbench.files.duplicate_replaced', { names: replacedNames.join('、') })}
          </div>
        )}

        {/* Same two-column list as the picker — the manager only adds actions. */}
        <FilePickerPanel
          columns={managerColumns({
            t,
            project: groups.project,
            examples: groups.examples,
            entryOf,
            canChunk,
            loadIntoActive,
            setDeleteFile,
            startIngest,
            chunkRunning: Boolean(chunkState?.running),
            hasActivePlugin: Boolean(activeEntry?.plugin),
            downloadExample,
          })}
          onChoose={() => undefined}
        />

        {chunkState && (
          <div className="chunk-panel">
            <div className="chunk-panel-head">
              <span className="chunk-panel-title">{t('workbench.files.chunk_preview')}</span>
              <span className="chunk-panel-meta">
                {chunkState.running
                  ? t('workbench.files.chunk_running', { rows: chunkState.totalRows })
                  : t('workbench.files.chunk_done', {
                      rows: chunkState.totalRows,
                      chunks: chunkState.chunkCount,
                    })}
              </span>
              {chunkState.running ? (
                <button type="button" className="btn btn-sm" onClick={cancelIngest}>
                  {t('common.cancel')}
                </button>
              ) : (
                <button type="button" className="btn btn-sm" onClick={resetChunk}>
                  {t('common.close')}
                </button>
              )}
            </div>
            {chunkPreviewRows > 0 && (
              <div className="chunk-table-wrap">
                <table className="chunk-table">
                  <thead>
                    <tr>
                      {chunkColumns.map((c) => (
                        <th key={c.name}>{c.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: chunkPreviewRows }, (_, r) => (
                      <tr key={r}>
                        {chunkColumns.map((c) => {
                          const v = (chunkState.preview!.getColumn(c.name) as Float64Array)[r];
                          return <td key={c.name}>{Number.isNaN(v) ? '' : String(v)}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="chunk-panel-foot">{t('workbench.files.chunk_hash', { hash: chunkState.hash })}</div>
          </div>
        )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={`${DATA_FILE_ACCEPT},text/csv,text/tab-separated-values,text/plain,application/json,application/geo+json`}
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleImportFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <ConfirmDialog
        open={deleteFile !== null}
        title={t('common.delete')}
        message={t('workbench.files.delete_confirm')}
        name={deleteFile?.name}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (deleteFile) removeDataFile(deleteFile.id);
          refreshGroups();
        }}
        onClose={() => setDeleteFile(null)}
      />
    </>
  );
}

type DataFilesWindowMode = 'pick' | 'manage';

interface PickerModalProps {
  open: boolean;
  /** 'pick' (default) chooses a data source; 'manage' manages project files. */
  mode?: DataFilesWindowMode;
  value?: string;
  onChoose?: (name: string) => void;
  onClose: () => void;
}

/** Shared floating window: pick a file, or manage the project's data files. */
export function DataFilePickerModal({
  open,
  mode = 'pick',
  value,
  onChoose,
  onClose,
}: PickerModalProps) {
  const t = useT();
  if (!open) return null;
  const manage = mode === 'manage';
  // Both modes share the FilesManagerModal shell with the industrial file
  // window — same chrome, width and close footer for every file surface.
  return (
    <FilesManagerModal
      open={open}
      title={manage ? t('workbench.files.title') : t('block.data_file.title')}
      onClose={onClose}
      bodyClassName={manage ? 'project-files data-file-manager' : ''}
    >
      {manage ? (
        <DataFilesManagerBody />
      ) : (
        <DataFilePickerBody
          value={value}
          onChoose={(name) => {
            onChoose?.(name);
            onClose();
          }}
        />
      )}
    </FilesManagerModal>
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
