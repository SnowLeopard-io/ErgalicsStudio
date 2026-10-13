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
  | { mode: 'code'; language: 'python' | 'r' | 'js'; code: string }
  | { mode: 'block'; ir: IRProgram }
  | { mode: 'flow'; graph: BlockGraphState };

export function editorStoreOpenInMode(req: OpenInModeRequest): void {
  const st = useEditorStore.getState();
  // Reuse the active session so switching back and forth keeps one program
  // hub; create one lazily when no session exists yet.
  const sid = st.activeSessionId ?? st.createSession(req.mode === 'block' ? 'block' : 'code', req.mode === 'block' ? 'python' : req.mode === 'code' ? req.language : 'python').id;

  if (req.mode === 'code') {
    st.applyLanguageWithCode(sid, req.language, req.code);
  } else if (req.mode === 'block') {
    st.updateSessionIR(sid, req.ir);
    // requestLoad guarantees the (possibly already-mounted) workspace reloads
    // this IR even when the session id did not change.
    st.requestLoad(req.ir);
  } else {
    // Flow mode hydrates its DAG from the IR hub on entry (useFlowSync).
    st.updateSessionIR(sid, flowToIR(req.graph));
  }
  useAppStore.getState().setMode(req.mode);
}
