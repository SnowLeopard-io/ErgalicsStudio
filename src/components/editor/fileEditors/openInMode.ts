// ==========================================================================
// Ergalics Studio — "open in workbench mode" bridge (file editor tabs)
//
// Hands an editable file buffer to the fullscreen workbench modes (design
// doc P5): code text lands in the code-mode session, a block IR goes to the
// Blockly session, a flow graph becomes the IR hub and hydrates the DAG on
// mode entry (via useFlowSync).
// ==========================================================================

import { useAppStore } from '@/stores/appStore';
import { useEditorStore } from '@/stores/editorStore';
import { flowToIR } from '@/editor/flow/convert';
import type { IRProgram } from '@/editor/ir';
import type { BlockGraphState } from '@/types/block';

type OpenInModeRequest =
  | { mode: 'code'; language: 'python' | 'r' | 'js'; code: string; path?: string }
  | { mode: 'block'; ir: IRProgram; path?: string }
  | { mode: 'flow'; graph: BlockGraphState; path?: string };

export function editorStoreOpenInMode(req: OpenInModeRequest): void {
  const st = useEditorStore.getState();
  // Reuse the active session so switching back and forth keeps one program
  // hub; create one lazily when no session exists yet.
  const sid = st.activeSessionId ?? st.createSession(req.mode === 'block' ? 'block' : 'code', req.mode === 'block' ? 'python' : req.mode === 'code' ? req.language : 'python').id;

  if (req.mode === 'code') {
    st.applyLanguageWithCode(sid, req.language, req.code);
    // Remember where this buffer came from so later code-mode edits can be
    // mirrored back into the file tab (they used to live only in the IR hub).
    st.setSessionFilePath(sid, req.path ?? null);
    // The code surface may already be mounted (same session + language), in
    // which case the session effect above does not reload Monaco — push the
    // verbatim source explicitly so switching files swaps the buffer.
    st.requestCodeLoad(req.code);
  } else if (req.mode === 'block') {
    st.setSessionFilePath(sid, req.path ?? null);
    st.updateSessionIR(sid, req.ir);
    // requestLoad guarantees the (possibly already-mounted) workspace reloads
    // this IR even when the session id did not change.
    st.requestLoad(req.ir);
  } else {
    // Flow mode hydrates its DAG from the IR hub on entry (useFlowSync).
    st.setSessionFilePath(sid, req.path ?? null);
    st.updateSessionIR(sid, flowToIR(req.graph));
  }
  // One file = one tab: the mode surface IS the editor for this file, so drop
  // any preview/editor tab that was opened for the same path (otherwise the
  // strip shows both `coupler.py` and `代码` side by side).
  const app = useAppStore.getState();
  if (req.path) {
    for (const tab of app.canvasTabs) {
      if ((tab.kind === 'file' || tab.kind === 'editor') && tab.path === req.path) {
        app.closeTab(tab.key);
      }
    }
  }
  app.setMode(req.mode);
}
