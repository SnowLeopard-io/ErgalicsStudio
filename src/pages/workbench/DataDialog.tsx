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

export function DataDialog({ open, onClose }: DataDialogProps) {
  const t = useT();
  const { locale } = useLocale();
  const notify = useAppStore((s) => s.notify);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const [tab, setTab] = useState<'datasets' | 'pipeline' | 'blocks'>('datasets');
  // A plain object literal here would be recreated on every render, making the
  // re-entrancy guard below useless (double-click would launch two loads).
  const loadingRef = useRef(false);

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
    let sid = useEditorStore.getState().activeSessionId;
    if (!sid) sid = useEditorStore.getState().createSession('block', 'python').id;
    // Persist the program into the active session, then request the (possibly
    // already-mounted) BlockEditor to load it into its workspace.
    useEditorStore.getState().updateSessionIR(sid, program);
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
    </Modal>
  );
}
