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

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { resolvePluginDataSchemas } from '@/core/data-schema/presets';
import { assessFileCompatibility } from '@/core/data-schema/profile-cache';
import { downloadText } from '@/core/plot/export';
import { logger } from '@/core/logger';
import { formatBytes } from '@/core/storage';
import { useAppStore } from '@/stores/appStore';
import { useChunkStore } from '@/stores/chunkStore';
import { useDataEditorStore } from '@/stores/dataEditorStore';
import { usePluginStore, refreshParamDefs } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
import { capturePluginInput } from '@/core/result/inputCapture';
import type { CompatibilityAssessment, PluginDataSchema } from '@/types/dataSchema';
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
  zh: boolean;
  project: string[];
  examples: string[];
  entryOf: (name: string) => FileEntry | undefined;
  compatOf: (name: string) => CompatibilityAssessment | null;
  canChunk: (name: string) => boolean;
  loadIntoActive: (name: string) => void | Promise<void>;
  editFile: (entry: FileEntry) => void;
  setDeleteFile: (entry: FileEntry) => void;
  startIngest: (entry: FileEntry, chunkSize: number) => unknown;
  chunkRunning: boolean;
  /** Save a bundled example to disk (examples are not FileEntries). */
  downloadExample: (name: string) => void | Promise<void>;
}

function CompatBadge({ compat, zh }: { compat: CompatibilityAssessment; zh: boolean }) {
  if (compat.level === 'compatible') {
    return (
      <span className="pds-compat-badge is-ok" title={compat.reason}>
        {zh ? '✓ 兼容' : '✓ Compatible'}
      </span>
    );
  }
  if (compat.level === 'needs_mapping') {
    return (
      <span className="pds-compat-badge is-map" title={compat.reason}>
        {zh ? '⇄ 需映射' : '⇄ Map Cols'}
      </span>
    );
  }
  return (
    <span className="pds-compat-badge is-bad" title={compat.reason}>
      {zh ? '✕ 不匹配' : '✕ Mismatch'}
    </span>
  );
}

/** Manager rows = picker rows + per-file actions. */
function managerColumns({
  t,
  zh,
  project,
  examples,
  entryOf,
  compatOf,
  canChunk,
  loadIntoActive,
  editFile,
  setDeleteFile,
  startIngest,
  chunkRunning,
  downloadExample,
}: ManagerColumnArgs): FilePickerColumn[] {
  return [
    {
      key: 'project',
      title: t('block.data_file.project'),
      empty: t('workbench.example.files_empty'),
      items: project.map((name): FilePickerItem => {
        const entry = entryOf(name);
        const compat = compatOf(name);
        return {
          id: name,
          name,
          meta: entry ? formatBytes(entry.size) : undefined,
          actions: (
            <>
              {compat && <CompatBadge compat={compat} zh={zh} />}
              {entry && (
                <button
                  type="button"
                  className="icon-btn"
                  title={zh ? '在线编辑' : 'Edit online'}
                  aria-label={zh ? '在线编辑' : 'Edit online'}
                  onClick={() => editFile(entry)}
                >
                  <span aria-hidden="true" style={{ fontSize: 12, lineHeight: 1 }}>✎</span>
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                title={t('workbench.files.load')}
                aria-label={t('workbench.files.load')}
                // Deliberately not disabled: with no active plugin the click
                // still fires and explains what to do, instead of a silent
                // dead button.
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

/** Manage mode: the same two-column list, plus import / load / edit / delete. */
function DataFilesManagerBody({ onClose }: { onClose: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const zh = locale.toLowerCase().startsWith('zh');
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const addDataFile = useProjectStore((s) => s.addDataFile);
  const removeDataFile = useProjectStore((s) => s.removeDataFile);
  const activeId = usePluginStore((s) => s.activeId);
  const registry = usePluginStore((s) => s.registry);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteFile, setDeleteFile] = useState<FileEntry | null>(null);
  const [onlyCompatible, setOnlyCompatible] = useState(false);
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
  const activeSchemas = useMemo(
    () => resolvePluginDataSchemas(activeEntry?.plugin?.manifest),
    [activeEntry],
  );
  const primarySchema: PluginDataSchema | null = activeSchemas[0] ?? null;

  /** Imported files carry their own entry (delete/chunk); workspace files don't. */
  const entryOf = (name: string): FileEntry | undefined =>
    project?.data.files.find((f) => f.name === name);

  /** Best compatibility assessment across all schemas declared by the active plugin. */
  const compatOf = (name: string): CompatibilityAssessment | null => {
    if (activeSchemas.length === 0) return null;
    const entry = entryOf(name);
    if (!entry) return null;
    let best: CompatibilityAssessment | null = null;
    for (const s of activeSchemas) {
      const a = assessFileCompatibility(entry.name, entry.content, s, locale);
      if (!best || a.score > best.score) best = a;
    }
    return best;
  };

  const visibleProjectFiles = useMemo(() => {
    if (!onlyCompatible || activeSchemas.length === 0) return groups.project;
    return groups.project.filter((name) => {
      const entry = project?.data.files.find((f) => f.name === name);
      if (!entry) return true;
      return activeSchemas.some(
        (s) => assessFileCompatibility(entry.name, entry.content, s, locale).level !== 'incompatible',
      );
    });
  }, [onlyCompatible, activeSchemas, groups.project, project, locale]);

  const editFile = (entry: FileEntry) => {
    const ext = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    const matchedSchema =
      activeSchemas.find((s) => s.extensions.map((e) => e.toLowerCase()).includes(ext)) ??
      null;
    useDataEditorStore.getState().openEditor({
      pluginId: matchedSchema && activeEntry ? activeEntry.id : null,
      schema: matchedSchema,
      fileName: entry.name,
      text: entry.content,
      origin: 'project-file',
      fileId: entry.id,
      layout: 'modal',
    });
    onClose();
  };

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
    if (
      !plugin ||
      (typeof plugin.loadData !== 'function' && typeof plugin.loadValidatedData !== 'function')
    ) {
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
      if (activeSchemas.length > 0 && activeEntry) {
        const outcome = await useDataEditorStore.getState().ingestForPlugin({
          pluginId: activeEntry.id,
          fileName: name,
          text,
          origin: entry ? 'project-file' : 'example',
          fileId: entry?.id,
        });
        if (outcome.pending) onClose();
        return;
      }
      const blob = new File([text], name, {
        type: entry?.mimeType ?? 'text/plain',
      });
      // FR-1: plugins without a data schema get the file directly, so this
      // branch is its own capture point.
      await capturePluginInput({
        pluginId: activeEntry.id,
        fileName: name,
        text,
        fileId: entry?.id,
        origin: entry ? 'project-file' : 'example',
      });
      await plugin.loadData?.(blob);
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

        {primarySchema && (
          <div className="pds-compat-banner">
            <span className="pds-compat-info">
              <span className="pds-card-dot" aria-hidden="true" />
              <span>
                {zh ? '当前插件' : 'Active plugin'}: <strong>{activeName}</strong> ·{' '}
                {primarySchema.titleI18n?.[locale] ?? primarySchema.title}
              </span>
            </span>
            <label className="pds-livesync-toggle">
              <input
                type="checkbox"
                checked={onlyCompatible}
                onChange={(e) => setOnlyCompatible(e.target.checked)}
              />
              <span>{zh ? '仅显示兼容文件' : 'Compatible only'}</span>
            </label>
          </div>
        )}

        {replacedNames.length > 0 && (
          <div className="project-files-warning">
            ⚠ {t('workbench.files.duplicate_replaced', { names: replacedNames.join('、') })}
          </div>
        )}

        {/* Same two-column list as the picker — the manager only adds actions. */}
        <FilePickerPanel
          columns={managerColumns({
            t,
            zh,
            project: visibleProjectFiles,
            examples: groups.examples,
            entryOf,
            compatOf,
            canChunk,
            loadIntoActive,
            editFile,
            setDeleteFile,
            startIngest,
            chunkRunning: Boolean(chunkState?.running),
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
        <DataFilesManagerBody onClose={onClose} />
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
