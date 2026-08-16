// ==========================================================================
// Ergalics Studio — unified "示例" dialog (datasets + block pipelines)
//
// Merges the sample-dataset picker and the block-pipeline samples into one
// entry point with two tabs, per user request.
// ==========================================================================

import { useRef, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { Modal } from '@/components/Modal';
import {
  BUILTIN_EXAMPLES,
  exampleToFile,
  exampleName,
  exampleDescription,
} from '@/core/examples';
import { findBuiltin } from '@/plugins/builtin';
import { usePluginStore } from '@/stores/pluginStore';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import { BLOCK_GRAPH_CHANGED, useBlockStore } from '@/stores/blockStore';
import { useEditorStore } from '@/stores/editorStore';
import { SAMPLE_PIPELINES, sampleDescription, sampleName } from '@/blocks/sample';
import {
  BLOCK_SAMPLES,
  sampleProgram,
  sampleName as blockSampleName,
  sampleDescription as blockSampleDescription,
} from '@/editor/block/samples';
import { emit } from '@/core/events';
import { logger } from '@/core/logger';

interface DataDialogProps {
  open: boolean;
  onClose: () => void;
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function DataDialog({ open, onClose }: DataDialogProps) {
  const t = useT();
  const { locale } = useLocale();
  const notify = useAppStore((s) => s.notify);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const project = useProjectStore((s) => s.project);
  const addDataFile = useProjectStore((s) => s.addDataFile);
  const removeDataFile = useProjectStore((s) => s.removeDataFile);
  const [tab, setTab] = useState<'datasets' | 'pipeline' | 'blocks' | 'files'>('datasets');
  // A plain object literal here would be recreated on every render, making the
  // re-entrancy guard below useless (double-click would launch two loads).
  const loadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const loadExample = async (id: string) => {
    const ex = BUILTIN_EXAMPLES.find((e) => e.id === id);
    if (!ex || loadingRef.current) return;
    loadingRef.current = true;
    try {
      const store = usePluginStore.getState();
      if (!store.isLoaded(ex.pluginId)) {
        const info = findBuiltin(ex.pluginId);
        if (!info) throw new Error(`unknown builtin plugin ${ex.pluginId}`);
        const plugin = await info.load();
        await store.load(plugin);
      }
      const current = usePluginStore.getState();
      if (current.activeId !== ex.pluginId) {
        await current.activate(ex.pluginId);
      }
      const plugin = usePluginStore
        .getState()
        .registry.find((e) => e.id === ex.pluginId)?.plugin;
      await plugin?.loadData?.(exampleToFile(ex));
      notify('success', t('workbench.example_data.loaded'));
      onClose();
    } catch (err) {
      logger.error('example', `load failed ${id}`, err);
      notify('error', `${t('workbench.example_data.load_failed')}: ${String(err)}`);
    } finally {
      loadingRef.current = false;
    }
  };

  const loadPipeline = (id: string) => {
    const sample = SAMPLE_PIPELINES.find((s) => s.id === id);
    if (!sample) return;
    if (mode !== 'flow') setMode('flow');
    useBlockStore.getState().fromJSON(sample.graph);
    emit(BLOCK_GRAPH_CHANGED, undefined);
    notify('success', t('workbench.example.pipeline_loaded', { name: sampleName(sample, locale) }));
    onClose();
  };

  const loadBlockSample = (id: string) => {
    const sample = BLOCK_SAMPLES.find((s) => s.id === id);
    if (!sample) return;
    const program = sampleProgram(sample);
    // Load the sample into a *fresh* session so it never overwrites the user's
    // active work; the sample dialog is a "start from here", not a replace.
    const sid = useEditorStore.getState().createSession('block', 'python').id;
    useEditorStore.getState().updateSessionIR(sid, program);
    useEditorStore.getState().setActiveSession(sid);
    // Drop the previous run's results (variables/console/error) and any stale
    // preview frame so loading a second sample never shows the first one's
    // output before the user re-runs.
    useEditorStore.getState().resetRunOutputs();
    useEditorStore.getState().requestLoad(program);
    if (mode !== 'block') setMode('block');
    notify('success', t('workbench.example.pipeline_loaded', { name: blockSampleName(sample, locale) }));
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('workbench.example.title')}
      width={640}
      footer={
        <button type="button" className="btn" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="data-dialog">
        <div className="data-dialog-tabs">
          <button
            type="button"
            className={`data-dialog-tab${tab === 'datasets' ? ' is-active' : ''}`}
            onClick={() => setTab('datasets')}
          >
            {t('workbench.example.datasets')}
          </button>
          <button
            type="button"
            className={`data-dialog-tab${tab === 'pipeline' ? ' is-active' : ''}`}
            onClick={() => setTab('pipeline')}
          >
            {t('workbench.example.pipelines')}
          </button>
          <button
            type="button"
            className={`data-dialog-tab${tab === 'blocks' ? ' is-active' : ''}`}
            onClick={() => setTab('blocks')}
          >
            {t('workbench.example.blocks')}
          </button>
          <button
            type="button"
            className={`data-dialog-tab${tab === 'files' ? ' is-active' : ''}`}
            onClick={() => setTab('files')}
          >
            {t('workbench.example.files')}
          </button>
        </div>

        {tab === 'datasets' ? (
          <div className="plugin-list-pane">
            {BUILTIN_EXAMPLES.map((ex) => (
              <div key={ex.id} className="plugin-card">
                <div className="plugin-card-main">
                  <span className="plugin-icon">▦</span>
                  <div className="plugin-card-info">
                    <div className="plugin-card-title">{exampleName(ex, locale)}</div>
                    <div className="plugin-card-meta">{exampleDescription(ex, locale)}</div>
                    <div className="example-data-tags">
                      <span className="tag tag-muted">{ex.filename}</span>
                      <span className="tag tag-primary">{ex.format}</span>
                      <span className="tag tag-muted">{ex.pluginId}</span>
                    </div>
                  </div>
                </div>
                <div className="plugin-card-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => void loadExample(ex.id)}
                  >
                    {t('workbench.example_data.load')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : tab === 'pipeline' ? (
          <div className="plugin-list-pane">
            {SAMPLE_PIPELINES.map((sample) => (
              <div key={sample.id} className="plugin-card">
                <div className="plugin-card-main">
                  <span className="plugin-icon">▣</span>
                  <div className="plugin-card-info">
                    <div className="plugin-card-title">{sampleName(sample, locale)}</div>
                    <div className="plugin-card-meta">{sampleDescription(sample, locale)}</div>
                  </div>
                </div>
                <div className="plugin-card-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => loadPipeline(sample.id)}
                  >
                    {t('common.load')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : tab === 'files' ? (
          <div className="plugin-list-pane">
            <div className="data-files-toolbar">
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                {t('workbench.example.files_import')}
              </button>
              <span className="data-files-hint">{t('workbench.example.files_hint')}</span>
            </div>
            {(!project || project.data.files.length === 0) && (
              <div className="empty-hint">{t('workbench.example.files_empty')}</div>
            )}
            {project?.data.files.map((f) => (
              <div key={f.id} className="plugin-card">
                <div className="plugin-card-main">
                  <span className="plugin-icon">▤</span>
                  <div className="plugin-card-info">
                    <div className="plugin-card-title">{f.name}</div>
                    <div className="plugin-card-meta">
                      {f.format} · {formatBytes(f.size)}
                    </div>
                  </div>
                </div>
                <div className="plugin-card-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    onClick={() => removeDataFile(f.id)}
                  >
                    {t('common.delete')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="plugin-list-pane">
            {BLOCK_SAMPLES.map((sample) => (
              <div key={sample.id} className="plugin-card">
                <div className="plugin-card-main">
                  <span className="plugin-icon">🧩</span>
                  <div className="plugin-card-info">
                    <div className="plugin-card-title">{blockSampleName(sample, locale)}</div>
                    <div className="plugin-card-meta">{blockSampleDescription(sample, locale)}</div>
                  </div>
                </div>
                <div className="plugin-card-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => loadBlockSample(sample.id)}
                  >
                    {t('common.load')}
                  </button>
                </div>
              </div>
            ))}
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
