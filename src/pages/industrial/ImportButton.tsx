// ==========================================================================
// Ergalics Studio — industrial file import window
//
// Uses the shared two-column file picker (see components/FilePicker.tsx):
//   left  — engineering files already inside the project workspace
//           (geometry/ and mesh/), loadable into the active study;
//   right — the bundled industrial samples.
// The same window also carries the "import a file" toolbar, so the industrial
// pages rely on this shared surface instead of their own file inputs.
// ==========================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Modal } from '@/components/Modal';
import {
  FilePickerPanel,
  fileIcon,
  type FilePickerColumn,
  type FilePickerItem,
} from '@/components/FilePicker';
import { DownloadIcon, TrashIcon } from '@/components/icons';
import { useLocale, useT } from '@/i18n';
import { ENGINEERING_EXTENSIONS, isEngineeringExtension, isGeometryExtension } from '@/core/engineering';
import { INDUSTRIAL_EXAMPLES } from '@/core/engineering/examples';
import { formatBytes } from '@/core/storage';
import { getVfs } from '@/core/vfs';
import { logger } from '@/core/logger';
import { useAppStore } from '@/stores/appStore';
import { useEngineeringStore } from '@/stores/engineeringStore';
import { getProjectRepoPath, useProjectStore } from '@/stores/projectStore';

/** Workspace folders that hold engineering source files. */
const ENGINEERING_FOLDERS = ['geometry', 'mesh'] as const;

interface ProjectEngineeringFile {
  /** Workspace-relative path ('mesh/plate.msh'). */
  path: string;
  name: string;
  folder: string;
  size: number;
}

async function listProjectEngineeringFiles(root: string): Promise<ProjectEngineeringFile[]> {
  const vfs = getVfs();
  const files: ProjectEngineeringFile[] = [];
  for (const folder of ENGINEERING_FOLDERS) {
    let entries;
    try {
      entries = await vfs.readDir(root, folder);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDir || !isEngineeringExtension(entry.name)) continue;
      files.push({ path: entry.path, name: entry.name, folder, size: entry.size });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

interface EngineeringImportButtonProps {
  /** Optional format hint shown next to the import button. */
  hint?: string;
}

/**
 * Shared entry point for industrial imports. Renders the trigger button plus
 * the floating picker window.
 */
export function EngineeringImportButton({ hint }: EngineeringImportButtonProps) {
  const t = useT();
  const { locale } = useLocale();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const fileOpsVersion = useAppStore((s) => s.fileOpsVersion);
  const importFile = useEngineeringStore((s) => s.importFile);
  const importText = useEngineeringStore((s) => s.importText);
  const setStudy = useEngineeringStore((s) => s.setStudy);
  const studyName = useEngineeringStore((s) => s.study?.name ?? '');

  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<ProjectEngineeringFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [replaced, setReplaced] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteFile, setDeleteFile] = useState<ProjectEngineeringFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const current = useProjectStore.getState().project;
    if (!current) {
      setFiles([]);
      return;
    }
    setFiles(await listProjectEngineeringFiles(getProjectRepoPath(current)));
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh, fileOpsVersion, project?.id]);

  const close = () => {
    setOpen(false);
    setReplaced(null);
    setError(null);
  };

  const handleImport = async (picked: FileList | null) => {
    const file = picked?.[0];
    if (!file) return;
    if (!isEngineeringExtension(file.name)) {
      notify('error', t('industrial.unsupported', { name: file.name }));
      return;
    }
    const duplicate = files.some((item) => item.name === file.name);
    setBusy(true);
    setError(null);
    try {
      if (!useProjectStore.getState().project) {
        await useProjectStore.getState().createProject('');
      }
      const study = await importFile(file);
      if (!study) {
        const reason = useEngineeringStore.getState().error ?? file.name;
        setError(reason);
        notify('error', t('industrial.import_failed', { reason }));
        return;
      }
      await refresh();
      setReplaced(duplicate ? file.name : null);
      notify('success', t('industrial.imported', { name: file.name }));
      // Importing an engineering file makes the industrial workspace the
      // relevant surface; jump to the page that best shows what was read.
      const app = useAppStore.getState();
      app.setMode('standard');
      app.setSidebarView('industrial');
      app.setEmbeddedTool(isGeometryExtension(file.name) ? 'geometry-import' : 'mesh-viewer');
    } catch (err) {
      logger.warn('engineering', 'import failed', err);
      const reason = err instanceof Error ? err.message : String(err);
      setError(reason);
      notify('error', t('industrial.import_failed', { reason }));
    } finally {
      setBusy(false);
    }
  };

  const loadProjectFile = async (item: FilePickerItem) => {
    const entry = files.find((file) => file.path === item.id);
    const current = useProjectStore.getState().project;
    if (!entry || !current) return;
    try {
      const text = await getVfs().readFile(getProjectRepoPath(current), entry.path);
      const study = importText(text, entry.name, entry.path);
      if (!study) {
        const reason = useEngineeringStore.getState().error ?? entry.name;
        setError(reason);
        notify('error', t('workbench.files.load_failed', { reason }));
        return;
      }
      notify('success', t('industrial.imported', { name: entry.name }));
      close();
    } catch (err) {
      logger.warn('engineering', 'project file load failed', err);
      notify('error', t('workbench.files.load_failed', { reason: String(err) }));
    }
  };

  const loadExample = (item: FilePickerItem) => {
    const example = INDUSTRIAL_EXAMPLES.find((candidate) => candidate.id === item.id);
    if (!example) return;
    setStudy(example.build());
    notify('success', t('industrial.example_loaded', {
      name: example.nameI18n[locale] ?? example.nameI18n['en-US'],
    }));
    close();
  };

  const removeProjectFile = async (entry: ProjectEngineeringFile) => {
    const current = useProjectStore.getState().project;
    if (!current) return;
    try {
      await getVfs().deleteEntry(getProjectRepoPath(current), entry.path, false);
      useAppStore.getState().bumpFileOps();
      await refresh();
      notify('success', t('industrial.file_deleted', { name: entry.name }));
    } catch (err) {
      logger.warn('engineering', 'project file delete failed', err);
      notify('error', t('industrial.delete_failed', { name: entry.name }));
    }
  };

  const columns: FilePickerColumn[] = [
    {
      key: 'project',
      title: t('industrial.project_files'),
      empty: t('industrial.project_files_empty'),
      items: files.map((file) => ({
        id: file.path,
        name: file.name,
        icon: fileIcon(file.name),
        meta: formatBytes(file.size),
        title: file.path,
        actions: (
          <>
            <button
              type="button"
              className="icon-btn"
              title={t('common.load')}
              aria-label={t('common.load')}
              onClick={() => void loadProjectFile({ id: file.path, name: file.name })}
            >
              <DownloadIcon size={13} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t('common.delete')}
              aria-label={t('common.delete')}
              onClick={() => setDeleteFile(file)}
            >
              <TrashIcon size={13} />
            </button>
          </>
        ),
      })),
    },
    {
      key: 'examples',
      title: t('industrial.examples'),
      empty: t('industrial.examples_empty'),
      items: INDUSTRIAL_EXAMPLES.map((example) => ({
        id: example.id,
        name: example.nameI18n[locale] ?? example.nameI18n['en-US'],
        description: example.descriptionI18n[locale] ?? example.descriptionI18n['en-US'],
        icon: fileIcon(example.format === 'gmsh' ? '.msh' : '.dxf'),
        meta: example.format.toUpperCase(),
      })),
    },
  ];

  return (
    <>
      {/* Same inline field shape as the research suite's DataFilePickField so
          the import entry lives in one consistent place across both domains. */}
      <span className="data-file-field ind-import-field">
        <span className="analysis-label">{t('industrial.data_file')}</span>
        <button
          type="button"
          className="data-file-field-btn"
          title={studyName || (hint ?? t('industrial.import_exts'))}
          onClick={() => setOpen(true)}
        >
          <span className="data-file-picker-icon">{studyName ? '▣' : '▾'}</span>
          <span className="data-file-field-name">{studyName || t('industrial.select_file')}</span>
        </button>
      </span>

      <Modal
        open={open}
        title={t('industrial.import_title')}
        onClose={close}
        width={760}
        footer={
          <button type="button" className="btn" onClick={close}>
            {t('common.close')}
          </button>
        }
      >
        <div className="project-files">
          <div className="project-files-toolbar">
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? <span className="spinner" /> : t('industrial.import')}
            </button>
            <span className="project-files-hint">{t('industrial.import_drop')}</span>
          </div>
          <div className="project-files-hint">{t('industrial.import_exts')}</div>

          {replaced && (
            <div className="project-files-warning">
              ⚠ {t('industrial.import_replaced', { name: replaced })}
            </div>
          )}
          {error && <div className="project-files-warning">⚠ {error}</div>}

          <FilePickerPanel
            columns={columns}
            onChoose={(item, column) => {
              if (column.key === 'examples') loadExample(item);
              else void loadProjectFile(item);
            }}
          />
        </div>

        <input
          ref={inputRef}
          type="file"
          aria-label={t('industrial.import')}
          accept={ENGINEERING_EXTENSIONS.join(',')}
          style={{ display: 'none' }}
          onChange={(e) => {
            void handleImport(e.target.files);
            e.target.value = '';
          }}
        />
      </Modal>

      <ConfirmDialog
        open={deleteFile !== null}
        title={t('common.delete')}
        message={t('workbench.files.delete_confirm')}
        name={deleteFile?.name}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          if (deleteFile) void removeProjectFile(deleteFile);
        }}
        onClose={() => setDeleteFile(null)}
      />
    </>
  );
}
