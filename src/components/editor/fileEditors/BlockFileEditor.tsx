// ==========================================================================
// Ergalics Studio — block file editor (canvas editor tab, design doc P3)
//
// Edits a `*.block.json` file (`{version, kind:'ergalics-block', ir}`) on a
// Blockly workspace inside a standard-mode canvas tab. Edits debounce back
// into appStore.editorFiles; Ctrl+S / the save chip writes through to the
// repo; a clean buffer reloads when the file changes externally. The tab
// never touches the editorStore session IR — "open in block mode" bridges
// the buffer over explicitly.
// ==========================================================================

import { useCallback, useEffect, useRef } from 'react';
import type * as BlocklyNS from 'blockly/core';
import { useLocale, useT } from '@/i18n';
import { useTheme } from '@/theme';
import { useAppStore, editorTabKey } from '@/stores/appStore';
import {
  initBlocklyEngine,
  createWorkspace,
  workspaceToIR,
  loadIRIntoWorkspace,
  disposeWorkspace,
} from '@/editor/block';
import type { IRProgram } from '@/editor/ir';
import { parseBlockPayload, readRepoFileText } from './shared';
import { editorStoreOpenInMode } from './openInMode';
import { BrokenFileView, SaveButton } from './CodeFileEditor';

const PUSH_DEBOUNCE_MS = 300;

/** Wrap an IR program into the on-disk block file payload. */
function serializeBlockPayload(ir: IRProgram): string {
  return JSON.stringify({ version: 1, kind: 'ergalics-block', ir }, null, 2);
}

export function BlockFileEditor({ path }: { path: string }) {
  const t = useT();
  const { locale } = useLocale();
  const { resolved } = useTheme();
  const dark = resolved === 'dark';

  const state = useAppStore((s) => s.editorFiles[editorTabKey(path)]);
  const fileOpsVersion = useAppStore((s) => s.fileOpsVersion);
  const updateEditorFile = useAppStore((s) => s.updateEditorFile);
  const saveEditorFile = useAppStore((s) => s.saveEditorFile);

  const divRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<BlocklyNS.WorkspaceSvg | null>(null);
  const pushTimer = useRef<number | null>(null);
  const opsSnapshot = useRef(fileOpsVersion);
  /** True while hydration (initial load / disk reload / workspace rebuild)
   *  fills the workspace — those change events must not mark the tab dirty. */
  const hydrating = useRef(true);
  /** Latest serialized IR, used to carry unsaved edits across workspace
   *  rebuilds (locale / theme switch) where the store buffer is 300ms behind. */
  const lastIR = useRef<IRProgram | null>(null);

  const flush = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    if (pushTimer.current !== null) {
      window.clearTimeout(pushTimer.current);
      pushTimer.current = null;
    }
    updateEditorFile(path, serializeBlockPayload(workspaceToIR(ws)));
  }, [path, updateEditorFile]);

  const save = useCallback(() => {
    flush();
    void saveEditorFile(path);
  }, [flush, saveEditorFile, path]);

  // Workspace lifecycle: recreated on locale / theme change so block labels
  // and colours follow the app language and dark mode.
  useEffect(() => {
    initBlocklyEngine(locale, dark);
    const div = divRef.current;
    if (!div) return;
    hydrating.current = true;
    const ws = createWorkspace(div);
    wsRef.current = ws;

    // Boot content: unsaved edits carried over a rebuild win over the store
    // buffer (which a pending debounce may not have caught up with yet).
    const bootIR =
      lastIR.current ??
      (parseBlockPayload(useAppStore.getState().editorFiles[editorTabKey(path)]?.payload ?? '')
        ?.ir as IRProgram | undefined) ??
      null;
    if (bootIR) loadIRIntoWorkspace(ws, bootIR);

    ws.addChangeListener((e) => {
      // Hydration and pure UI events (pan / select / trashcan) never dirty
      // the buffer — only real structural edits do.
      if (hydrating.current || e.isUiEvent) return;
      if (pushTimer.current !== null) window.clearTimeout(pushTimer.current);
      pushTimer.current = window.setTimeout(() => {
        pushTimer.current = null;
        const live = wsRef.current;
        if (!live) return;
        const ir = workspaceToIR(live);
        lastIR.current = ir;
        useAppStore.getState().updateEditorFile(path, serializeBlockPayload(ir));
      }, PUSH_DEBOUNCE_MS);
    });

    // Blockly events are disabled during loadIRIntoWorkspace, so release the
    // hydration guard one frame after the injection settles.
    window.requestAnimationFrame(() => {
      hydrating.current = false;
    });

    return () => {
      // A pending debounce means the user just edited: snapshot the live
      // workspace so the next workspace (or nothing, on unmount) loses it.
      if (pushTimer.current !== null) {
        window.clearTimeout(pushTimer.current);
        pushTimer.current = null;
        const live = wsRef.current;
        if (live) lastIR.current = workspaceToIR(live);
      }
      disposeWorkspace(ws);
      wsRef.current = null;
    };
  }, [locale, dark, path]);

  // Ctrl+S writes the workspace back to the repo. The visibility guard keeps
  // hidden tabs (all panes stay mounted) from stealing the keystroke.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      const div = divRef.current;
      if (!div || div.offsetParent === null) return;
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
      const parsed = parseBlockPayload(text);
      const ws = wsRef.current;
      if (parsed && ws) {
        hydrating.current = true;
        lastIR.current = parsed.ir as IRProgram;
        loadIRIntoWorkspace(ws, parsed.ir as IRProgram);
        window.requestAnimationFrame(() => {
          hydrating.current = false;
        });
      }
    });
  }, [fileOpsVersion, path, updateEditorFile]);

  if (!state) return null;

  if (state.broken) {
    return <BrokenFileView name={state.name} payload={state.payload} />;
  }

  const openInBlockMode = () => {
    const ws = wsRef.current;
    const ir = ws
      ? workspaceToIR(ws)
      : (parseBlockPayload(state.payload)?.ir as IRProgram | undefined);
    if (ir) editorStoreOpenInMode({ mode: 'block', ir });
  };

  return (
    <div className="central-file-editor">
      <div className="central-file-editor-toolbar">
        <SaveButton dirty={state.dirty} onSave={save} />
        <button type="button" className="btn btn-sm" onClick={openInBlockMode} title={t('workbench.editor.open_in_mode_block')}>
          {t('workbench.editor.open_in_mode')}
        </button>
      </div>
      <div ref={divRef} className="central-file-editor-blockly" />
    </div>
  );
}
