// ==========================================================================
// Ergalics Studio — flow file editor (canvas editor tab, design doc P4)
//
// Edits a `*.flow.json` file (`{version, kind:'ergalics-flow', graph}`) as a
// live DAG inside a standard-mode canvas tab. A per-tab local block-graph
// store (emitEvents=false) feeds BlockPalette / BlockCanvas / ParamEditor
// through GraphStoreProvider, so editing the file never touches the flow-mode
// singleton, the IR hub or the project dirty flag. Viewport pans don't dirty
// the buffer — only instance/connection mutations do (compared by refs).
// ==========================================================================

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useT } from '@/i18n';
import { useAppStore, editorTabKey } from '@/stores/appStore';
import { createBlockGraphStore } from '@/stores/blockStore';
import { GraphStoreProvider } from '@/components/blocks/graphStore';
import { BlockPalette } from '@/components/blocks/BlockPalette';
import { BlockCanvas } from '@/components/blocks/BlockCanvas';
import { ParamEditor } from '@/components/blocks/ParamEditor';
import type { BlockGraphState } from '@/types/block';
import { parseFlowPayload, readRepoFileText } from './shared';
import { editorStoreOpenInMode } from './openInMode';
import { BrokenFileView, SaveButton } from './CodeFileEditor';

const PUSH_DEBOUNCE_MS = 300;

/** Wrap a graph into the on-disk flow file payload. */
function serializeFlowPayload(graph: BlockGraphState): string {
  return JSON.stringify({ version: 1, kind: 'ergalics-flow', graph }, null, 2);
}

export function FlowFileEditor({ path }: { path: string }) {
  const t = useT();
  const state = useAppStore((s) => s.editorFiles[editorTabKey(path)]);
  const fileOpsVersion = useAppStore((s) => s.fileOpsVersion);
  const updateEditorFile = useAppStore((s) => s.updateEditorFile);
  const saveEditorFile = useAppStore((s) => s.saveEditorFile);

  // One isolated graph store per file tab (never emits BLOCK_GRAPH_CHANGED).
  const store = useMemo(() => createBlockGraphStore(false), []);

  const rootRef = useRef<HTMLDivElement>(null);
  const pushTimer = useRef<number | null>(null);
  const opsSnapshot = useRef(fileOpsVersion);
  /** True while hydration (initial load / disk reload) fills the store —
   *  those instance/connection swaps must not mark the tab dirty. */
  const hydrating = useRef(false);

  /** Push the current graph into the buffer immediately (debounce bypass). */
  const pushNow = useCallback(() => {
    const g = store.getState().toJSON();
    updateEditorFile(path, serializeFlowPayload(g));
  }, [path, store, updateEditorFile]);

  const flush = useCallback(() => {
    if (pushTimer.current !== null) {
      window.clearTimeout(pushTimer.current);
      pushTimer.current = null;
    }
    pushNow();
  }, [pushNow]);

  const save = useCallback(() => {
    flush();
    void saveEditorFile(path);
  }, [flush, saveEditorFile, path]);

  // Hydrate the local store once from the file buffer, then watch the store:
  // only swaps of the instances/connections arrays are real edits — viewport
  // panning, selection and canvas resizing stay clean.
  useEffect(() => {
    const st = store.getState();
    hydrating.current = true;
    const parsed = parseFlowPayload(
      useAppStore.getState().editorFiles[editorTabKey(path)]?.payload ?? '',
    );
    if (parsed) {
      st.fromJSON({
        instances: parsed.graph.instances as BlockGraphState['instances'],
        connections: parsed.graph.connections as BlockGraphState['connections'],
        viewport: parsed.graph.viewport ?? { x: 0, y: 0, zoom: 1 },
      });
    }
    // Subscription below is synchronous: release the guard before it attaches.
    hydrating.current = false;

    const unsub = store.subscribe((s, prev) => {
      if (hydrating.current) return;
      if (s.instances === prev.instances && s.connections === prev.connections) return;
      if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
      pushTimer.current = window.setTimeout(() => {
        pushTimer.current = null;
        pushNow();
      }, PUSH_DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (pushTimer.current !== null) {
        window.clearTimeout(pushTimer.current);
        pushTimer.current = null;
        // Flush a pending debounced push so the buffer keeps the last edits.
        pushNow();
      }
    };
  }, [store, path, pushNow]);

  // Ctrl+S writes the graph back to the repo (hidden panes never steal it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      const el = rootRef.current;
      if (!el || el.offsetParent === null) return;
      e.preventDefault();
      save();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [save]);

  // External-change detection: reload a CLEAN buffer when the working tree
  // moves under it (a dirty buffer always wins).
  useEffect(() => {
    if (fileOpsVersion === opsSnapshot.current) return;
    opsSnapshot.current = fileOpsVersion;
    const cur = useAppStore.getState().editorFiles[editorTabKey(path)];
    if (!cur || cur.dirty) return;
    void readRepoFileText(path).then((text) => {
      if (text === null || text === cur.payload) return;
      updateEditorFile(path, text);
      const after = useAppStore.getState().editorFiles[editorTabKey(path)];
      // updateEditorFile marks dirty — restore the clean flag after a reload.
      if (after && after.dirty) {
        useAppStore.setState((s) => ({
          editorFiles: {
            ...s.editorFiles,
            [editorTabKey(path)]: { ...after, dirty: false },
          },
        }));
      }
      const parsed = parseFlowPayload(text);
      if (parsed) {
        hydrating.current = true;
        store.getState().fromJSON({
          instances: parsed.graph.instances as BlockGraphState['instances'],
          connections: parsed.graph.connections as BlockGraphState['connections'],
          viewport: parsed.graph.viewport ?? { x: 0, y: 0, zoom: 1 },
        });
        hydrating.current = false;
      }
    });
  }, [fileOpsVersion, path, updateEditorFile, store]);

  if (!state) return null;

  if (state.broken) {
    return <BrokenFileView name={state.name} payload={state.payload} />;
  }

  const openInFlowMode = () => editorStoreOpenInMode({ mode: 'flow', graph: store.getState().toJSON() });

  return (
    <GraphStoreProvider store={store}>
      <div ref={rootRef} className="central-file-editor central-file-editor-flow">
        <div className="central-file-editor-toolbar">
          <SaveButton dirty={state.dirty} onSave={save} />
          <button type="button" className="btn btn-sm" onClick={openInFlowMode} title={t('workbench.editor.open_in_mode_flow')}>
            {t('workbench.editor.open_in_mode')}
          </button>
        </div>
        <div className="central-file-editor-body">
          <div className="block-workbench">
            <div className="block-workbench-left">
              <BlockPalette />
            </div>
            <div className="block-workbench-center">
              <div className="block-workbench-canvas">
                <BlockCanvas />
              </div>
            </div>
            <div className="block-workbench-right">
              <ParamEditor />
            </div>
          </div>
        </div>
      </div>
    </GraphStoreProvider>
  );
}
