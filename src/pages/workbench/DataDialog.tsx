// ==========================================================================
// Ergalics Studio — unified "示例" dialog (datasets + block pipelines)
//
// Merges the sample-dataset picker, flow pipelines, block samples, and code
// samples into one entry point with four tabs. Project data files have their
// own dedicated manager (ProjectFilesDialog) and no longer live here.
// ==========================================================================

import { useMemo, useRef, useState } from 'react';
import { useT, useLocale } from '@/i18n';
import { Modal } from '@/components/Modal';
import {
  BUILTIN_EXAMPLES,
  exampleToFile,
  exampleName,
  exampleDescription,
  type BuiltinExample,
} from '@/core/examples';
import { findBuiltin } from '@/plugins/builtin';
import { PLUGIN_DISCIPLINES, disciplineOf } from '@/plugins/categories';
import { usePluginStore, refreshParamDefs } from '@/stores/pluginStore';
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
import {
  CODE_SAMPLES,
  codeSampleName,
  codeSampleDescription,
} from '@/editor/code/samples';
import { makeProgram } from '@/editor/ir';
import { emit } from '@/core/events';
import { logger } from '@/core/logger';

interface DataDialogProps {
  open: boolean;
  onClose: () => void;
}

// Example categories for the datasets tab's left-hand type selector.
// Interactive-lab and chemistry samples get their own pinned categories at the
// top; everything else follows the plugin discipline taxonomy (physics /
// charts / stats / geo / data / fun) so the dialog's grouping matches the
// sidebar's plugin groups.
const EXAMPLE_CATS: { id: string; nameI18n: Record<string, string> }[] = [
  { id: 'lab', nameI18n: { 'zh-CN': '交互实验', 'en-US': 'Interactive Labs' } },
  { id: 'chem', nameI18n: { 'zh-CN': '化学', 'en-US': 'Chemistry' } },
  ...PLUGIN_DISCIPLINES,
];

export function DataDialog({ open, onClose }: DataDialogProps) {
  const t = useT();
  const { locale } = useLocale();
  const notify = useAppStore((s) => s.notify);
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const [tab, setTab] = useState<'datasets' | 'pipeline' | 'blocks' | 'code'>('datasets');
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
      const content = ex.loadContent ? await ex.loadContent() : ex.content;
      await plugin?.loadData?.(exampleToFile(ex, content));
      // The import stops any running simulation and may change the plugin's
      // parameter set — tell the panel to re-read its definitions so the
      // Start/Stop toggle reflects the halted run.
      refreshParamDefs(ex.pluginId);
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

  const loadCodeSample = (id: string) => {
    const sample = CODE_SAMPLES.find((s) => s.id === id);
    if (!sample) return;
    // Load the sample into a *fresh* code session so it never overwrites the
    // user's active work; the editor shows the sample text on activation.
    const sid = useEditorStore.getState().createSession('code', 'python').id;
    useEditorStore.getState().updateSessionIR(sid, makeProgram([], [], 'python'), sample.python);
    useEditorStore.getState().setActiveSession(sid);
    // Drop the previous run's results so a second sample never shows the
    // first one's output before the user re-runs.
    useEditorStore.getState().resetRunOutputs();
    if (mode !== 'code') setMode('code');
    notify('success', t('workbench.example.pipeline_loaded', { name: codeSampleName(sample, locale) }));
    onClose();
  };

  // Bucket the samples into the left-nav categories above. Empty categories
  // are dropped, and the selection defaults to the first visible one.
  const { exampleCats, catMap, firstCat } = useMemo(() => {
    const map: Record<string, BuiltinExample[]> = {};
    for (const ex of BUILTIN_EXAMPLES) {
      const cat = ex.group ?? disciplineOf(ex.pluginId);
      (map[cat] ??= []).push(ex);
    }
    const visible = EXAMPLE_CATS.filter((c) => (map[c.id]?.length ?? 0) > 0);
    return { exampleCats: visible, catMap: map, firstCat: visible[0]?.id ?? '' };
  }, []);
  const [activeCat, setActiveCat] = useState<string>(firstCat);

  const renderExampleCard = (ex: BuiltinExample) => (
    <div key={ex.id} className="plugin-card" data-example-id={ex.id}>
      <div className="plugin-card-main">
        <span className="plugin-icon">{ex.group === 'lab' ? '✦' : ex.group === 'chem' ? '⚗' : '▦'}</span>
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
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('workbench.example.title')}
      width={760}
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
            className={`data-dialog-tab${tab === 'code' ? ' is-active' : ''}`}
            onClick={() => setTab('code')}
          >
            {t('workbench.example.code_samples')}
          </button>
        </div>

        {tab === 'datasets' ? (
          <div className="example-layout">
            <div className="example-cat-list">
              {exampleCats.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={`example-cat${activeCat === cat.id ? ' is-active' : ''}`}
                  onClick={() => setActiveCat(cat.id)}
                >
                  <span className="example-cat-name">
                    {cat.nameI18n[locale] ?? cat.nameI18n['en-US']}
                  </span>
                  <span className="example-cat-count">{catMap[cat.id]?.length ?? 0}</span>
                </button>
              ))}
            </div>
            <div className="plugin-list-pane example-list-pane">
              {(catMap[activeCat] ?? []).map(renderExampleCard)}
              {(catMap[activeCat] ?? []).length === 0 && (
                <div className="empty-hint">{t('workbench.plugin.none')}</div>
              )}
            </div>
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
        ) : tab === 'blocks' ? (
          <div className="plugin-list-pane">
            {BLOCK_SAMPLES.map((sample) => (
              <div key={sample.id} className="plugin-card">
                <div className="plugin-card-main">
                  <span className="plugin-icon">◈</span>
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
        ) : (
          <div className="plugin-list-pane">
            {CODE_SAMPLES.map((sample) => (
              <div key={sample.id} className="plugin-card">
                <div className="plugin-card-main">
                  <span className="plugin-icon">▣</span>
                  <div className="plugin-card-info">
                    <div className="plugin-card-title">{codeSampleName(sample, locale)}</div>
                    <div className="plugin-card-meta">{codeSampleDescription(sample, locale)}</div>
                  </div>
                </div>
                <div className="plugin-card-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => loadCodeSample(sample.id)}
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
