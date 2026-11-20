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
import { FilesManagerModal } from '@/components/FilesManagerModal';
import {
  FilePickerPanel,
  fileIcon,
  type FilePickerColumn,
  type FilePickerItem,
} from '@/components/FilePicker';
import { DownloadIcon, FileIcon, FolderOpenIcon, PlusIcon } from '@/components/icons';
import { useLocale, useT } from '@/i18n';
import { ENGINEERING_EXTENSIONS, isEngineeringExtension, isGeometryExtension } from '@/core/engineering';
import { INDUSTRIAL_EXAMPLES } from '@/core/engineering/examples';
import { studyDocument } from '@/core/engineering/export';
import { openProjectFile } from '@/core/workspace/open-file';
import { saveTextArtifact } from '@/core/workspace-artifacts';
import { formatBytes } from '@/core/storage';
import { getVfs } from '@/core/vfs';
import { logger } from '@/core/logger';
import { useAppStore } from '@/stores/appStore';
import { useEngineeringStore } from '@/stores/engineeringStore';
import { getProjectRepoPath, useProjectStore } from '@/stores/projectStore';
import { safeName } from './artifacts';

/** Workspace folders that hold engineering source files. */
const ENGINEERING_FOLDERS = ['geometry', 'mesh'] as const;

/** File extension shown next to each industrial example. */
const FORMAT_EXTENSION: Record<string, string> = {
  gmsh: '.msh',
  abaqus: '.inp',
  vtk: '.vtk',
  vtu: '.vtu',
  dxf: '.dxf',
  step: '.step',
  nastran: '.bdf',
  ansys: '.cdb',
  openfoam: '.foam',
};

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
  const walk = async (folder: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await vfs.readDir(root, folder);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isDir) {
        // Users organise large studies as geometry/source/… and mesh/parts/…;
        // show nested files too, but cap the walk so a pathological tree
        // cannot stall the dialog.
        if (depth < 3) await walk(entry.path, depth + 1);
        continue;
      }
      if (!isEngineeringExtension(entry.name)) continue;
      files.push({ path: entry.path, name: entry.name, folder, size: entry.size });
    }
  };
  for (const folder of ENGINEERING_FOLDERS) await walk(folder, 0);
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
  const setStudy = useEngineeringStore((s) => s.setStudy);
  const studyName = useEngineeringStore((s) => s.study?.name ?? '');

  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<ProjectEngineeringFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [replaced, setReplaced] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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

  /**
   * Delegate project-file opening to the workspace kernel, so a click here
   * behaves exactly like double-clicking the file in the explorer: the same
   * parser, the same tool routing and the same reveal/selection in the tree.
   */
  const loadProjectFile = async (item: FilePickerItem) => {
    const entry = files.find((file) => file.path === item.id);
    if (!entry || !useProjectStore.getState().project) return;
    close();
    const before = useEngineeringStore.getState().study;
    try {
      await openProjectFile(entry.path);
      const after = useEngineeringStore.getState().study;
      if (after && after !== before) {
        notify('success', t('industrial.imported', { name: entry.name }));
      }
    } catch (err) {
      notify('error', t('workbench.files.load_failed', { reason: String(err) }));
    }
  };

  /** Hand file management back to the explorer instead of duplicating delete
   *  (and its confirmation) inside the import window. */
  const revealProjectFile = (entry: ProjectEngineeringFile) => {
    useAppStore.getState().setRevealFilePath(entry.path);
    close();
  };

  const loadExample = (item: FilePickerItem) => {
    const example = INDUSTRIAL_EXAMPLES.find((candidate) => candidate.id === item.id);
    if (!example) return;
    setStudy(example.build());
    // Geometry samples carry a canvas hint (DXF / STEP open the geometry tool);
    // everything else falls back to the mesh viewer.
    useAppStore.getState().setEmbeddedTool(example.toolId ?? 'mesh-viewer');
    notify('success', t('industrial.example_loaded', {
      name: example.nameI18n[locale] ?? example.nameI18n['en-US'],
    }));
    close();
  };

  /** Persist a bundled sample as a study JSON inside the project workspace so
   *  it shows up in the explorer and the left-hand column like any import. */
  const saveExampleToProject = async (item: FilePickerItem) => {
    const example = INDUSTRIAL_EXAMPLES.find((candidate) => candidate.id === item.id);
    if (!example) return;
    try {
      let project = useProjectStore.getState().project;
      if (!project) project = await useProjectStore.getState().createProject('');
      const name = `${safeName(example.id)}-study.json`;
      await saveTextArtifact(project, 'study', name, studyDocument(example.build()));
      notify('success', t('industrial.example_saved', { name }));
      void refresh();
    } catch (err) {
      logger.warn('engineering', 'example save failed', err);
      notify('error', t('industrial.example_save_failed', { reason: String(err) }));
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
              title={t('industrial.reveal_in_explorer')}
              aria-label={t('industrial.reveal_in_explorer')}
              onClick={() => revealProjectFile(file)}
            >
              <FolderOpenIcon size={13} />
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
        icon: fileIcon(FORMAT_EXTENSION[example.format] ?? '.msh'),
        meta: example.format.toUpperCase(),
        actions: (
          <>
            <button
              type="button"
              className="icon-btn"
              title={t('common.load')}
              aria-label={t('common.load')}
              onClick={() => loadExample({ id: example.id, name: '' })}
            >
              <DownloadIcon size={13} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t('industrial.example_save_project')}
              aria-label={t('industrial.example_save_project')}
              onClick={() => void saveExampleToProject({ id: example.id, name: '' })}
            >
              <PlusIcon size={13} />
            </button>
          </>
        ),
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
          <span className="data-file-picker-icon">
            {studyName ? <FileIcon size={13} /> : '▾'}
          </span>
          <span className="data-file-field-name">{studyName || t('industrial.select_file')}</span>
        </button>
      </span>

      <FilesManagerModal
        open={open}
        title={t('industrial.import_title')}
        onClose={close}
        bodyClassName={`project-files${dragOver ? ' is-dragover' : ''}`}
        bodyProps={{
          onDragOver: (event) => {
            if (!event.dataTransfer.types.includes('Files')) return;
            event.preventDefault();
            event.stopPropagation();
            setDragOver(true);
          },
          onDragLeave: (event) => {
            // Ignore bubbling from child rows; only clear when leaving the host.
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
            setDragOver(false);
          },
          onDrop: (event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragOver(false);
            void handleImport(event.dataTransfer.files);
          },
        }}
      >
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
      </FilesManagerModal>
    </>
  );
}
