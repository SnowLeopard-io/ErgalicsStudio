// ==========================================================================
// Ergalics Studio — project data file manager (独立"项目文件"弹窗)
//
// Project-owned data files (csv/dat/xyz/json/txt) live in the project and
// are consumed by flow/block sources and plugin loadData. This dialog is the
// dedicated management surface: import, delete, and load a file straight
// into the active plugin.
// ==========================================================================

import { useRef } from 'react';
import { useT, useLocale } from '@/i18n';
import { Modal } from '@/components/Modal';
import { useAppStore } from '@/stores/appStore';
import { usePluginStore, refreshParamDefs } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChunkStore } from '@/stores/chunkStore';
import { logger } from '@/core/logger';

interface ProjectFilesDialogProps {
  open: boolean;
  onClose: () => void;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

/** Monochrome glyph per file format (mirrors the data-dialog icons). */
function formatIcon(format: string): string {
  switch (format) {
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

export function ProjectFilesDialog({ open, onClose }: ProjectFilesDialogProps) {
  const t = useT();
  const { locale } = useLocale();
  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const addDataFile = useProjectStore((s) => s.addDataFile);
  const removeDataFile = useProjectStore((s) => s.removeDataFile);
  const activeId = usePluginStore((s) => s.activeId);
  const registry = usePluginStore((s) => s.registry);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chunkState = useChunkStore((s) => s.state);
  const canChunk = useChunkStore((s) => s.canChunk);
  const startIngest = useChunkStore((s) => s.startIngest);
  const cancelIngest = useChunkStore((s) => s.cancel);
  const resetChunk = useChunkStore((s) => s.reset);

  const chunkPreviewRows = chunkState?.preview ? Math.min(chunkState.preview.length, 8) : 0;
  const chunkColumns = chunkState?.preview?.columns ?? [];

  const activeEntry = registry.find((e) => e.id === activeId) ?? null;
  const activeName = activeEntry?.nameI18n?.[locale] ?? activeEntry?.name ?? '';

  const handleImportFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        await addDataFile(file);
        ok += 1;
      } catch (err) {
        logger.error('data', `import failed ${file.name}`, err);
      }
    }
    if (ok > 0) {
      notify('success', t('workbench.example.files_imported', { count: ok }));
    } else {
      notify('error', t('workbench.example.files_import_failed'));
    }
  };

  /** Load a project file into the currently active plugin (like examples). */
  const loadIntoActive = async (id: string) => {
    const file = project?.data.files.find((f) => f.id === id);
    const plugin = activeEntry?.plugin;
    if (!file || !plugin) {
      notify('warning', t('workbench.files.no_active_plugin'));
      return;
    }
    if (typeof plugin.loadData !== 'function') {
      notify('warning', t('workbench.files.no_active_plugin'));
      return;
    }
    try {
      const blob = new File([file.content], file.name, { type: file.mimeType });
      await plugin.loadData(blob);
      // The import may have changed the plugin's own parameter set.
      refreshParamDefs(activeEntry?.id ?? '');
      notify('success', t('workbench.files.loaded', { plugin: activeName || file.name }));
    } catch (err) {
      notify('error', t('workbench.files.load_failed', { reason: String(err) }));
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('workbench.files.title')}
      width={560}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="project-files">
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

        {(!project || project.data.files.length === 0) && (
          <div className="empty-hint">{t('workbench.example.files_empty')}</div>
        )}

        <ul className="project-files-list">
          {project?.data.files.map((f) => (
            <li key={f.id} className="project-file-item">
              <span className="project-file-icon">{formatIcon(f.format)}</span>
              <div className="project-file-info">
                <div className="project-file-name" title={f.name}>{f.name}</div>
                <div className="project-file-meta">
                  {f.format} · {formatBytes(f.size)}
                </div>
              </div>
              <div className="project-file-actions">
                {canChunk(f.name) && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    title={t('workbench.files.chunk_preview')}
                    onClick={() => void startIngest(f, 1000)}
                  >
                    {t('workbench.files.chunk_preview')}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-sm"
                  title={t('workbench.files.load')}
                  disabled={!activeEntry?.plugin}
                  onClick={() => void loadIntoActive(f.id)}
                >
                  {t('workbench.files.load')}
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  title={t('common.delete')}
                  onClick={() => removeDataFile(f.id)}
                >
                  {t('common.delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>

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
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".csv,.dat,.xyz,.json,.txt,text/csv,text/plain,application/json,application/octet-stream"
        style={{ display: 'none' }}
        onChange={(e) => {
          void handleImportFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </Modal>
  );
}
