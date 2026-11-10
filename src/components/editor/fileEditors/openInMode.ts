// ==========================================================================
// Ergalics Studio — "open in workbench mode" bridge (file-bound surfaces)
//
// Hands an editable file buffer to its workbench surface. Each file gets its
// own surface tab (`surface:<mode>:<path>`) and its own editor session, so a
// Python file, a block file and a flow file — or several Python files — can
// stay open at the same time without fighting over one shared buffer.
// ==========================================================================

import { useAppStore, type CanvasTab } from '@/stores/appStore';
import { useEditorStore } from '@/stores/editorStore';
import { flowToIR } from '@/editor/flow/convert';
import type { IRProgram } from '@/editor/ir';
import type { BlockGraphState } from '@/types/block';
import { codeLanguageForFile } from './shared';

type OpenInModeRequest =
  | { mode: 'code'; language: 'python' | 'r' | 'js'; code?: string; path?: string }
  | { mode: 'block'; ir: IRProgram; path?: string }
  | { mode: 'flow'; graph: BlockGraphState; path?: string };

export function editorStoreOpenInMode(req: OpenInModeRequest): void {
  // One session per file: reopening / reactivating a file must resume its own
  // program instead of overwriting whatever the active session held.
  const existing = req.path
    ? useEditorStore.getState().sessions.find((s) => s.filePath === req.path)
    : undefined;
  let sid = existing?.id;
  if (!sid) {
    const created = useEditorStore
      .getState()
      .createSession(
        req.mode === 'block' ? 'block' : 'code',
        req.mode === 'code' ? req.language : 'python',
      );
    sid = created.id;
  }
  useEditorStore.getState().setActiveSession(sid);

  const st = useEditorStore.getState();
  if (req.mode === 'code') {
    if (req.code !== undefined) {
      st.applyLanguageWithCode(sid, req.language, req.code);
      // The code surface may already be mounted (same session + language), in
      // which case the session effect above does not reload Monaco — push the
      // verbatim source explicitly so switching files swaps the buffer.
      st.requestCodeLoad(req.code);
    }
    // Remember where this buffer came from so later code-mode edits can be
    // mirrored back into the file.
    st.setSessionFilePath(sid, req.path ?? null);
  } else if (req.mode === 'block') {
    st.setSessionFilePath(sid, req.path ?? null);
    st.updateSessionIR(sid, req.ir);
    // requestLoad guarantees the (possibly already-mounted) workspace reloads
    // this IR even when the session id did not change.
    st.requestLoad(req.ir);
  } else {
    // A flow file carries the exact DAG — hand it to the canvas verbatim.
    // Rebuilding the DAG from the IR would silently drop blocks IR cannot
    // represent (stats.*, units.*, viz.geo_*, plot.bar, …), which made a
    // saved flow look empty after closing and reopening it.
    st.setSessionFilePath(sid, req.path ?? null);
    st.updateSessionIR(sid, flowToIR(req.graph));
    st.requestFlowLoad(req.graph);
  }

  // One file = one tab: the surface IS the editor for this file, so drop any
  // preview/editor tab opened for the same path.
  const app = useAppStore.getState();
  if (req.path) {
    for (const tab of app.canvasTabs) {
      if ((tab.kind === 'file' || tab.kind === 'editor') && tab.path === req.path) {
        app.closeTab(tab.key);
      }
    }
  }
  app.setMode(req.mode, req.path);
}

/** Re-activate a file-bound surface tab and swap the editor session to the
 *  one that belongs to its file (tab switching must not leak another file's
 *  program into this tab). */
export function syncSurfaceTabSession(tab: CanvasTab): void {
  if (tab.kind !== 'surface' || !tab.path) return;
  const st = useEditorStore.getState();
  const session = st.sessions.find((s) => s.filePath === tab.path);
  if (session) {
    st.setActiveSession(session.id);
    return;
  }
  // No session yet (e.g. a tab restored after reload): re-hydrate from the
  // file for code surfaces, whose content lives in the buffer.
  if (tab.mode !== 'code') return;
  const language = codeLanguageForFile(tab.path.split('/').pop() ?? '');
  if (!language) return;
  editorStoreOpenInMode({ mode: 'code', language, path: tab.path });
}
