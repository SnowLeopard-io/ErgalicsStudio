// ==========================================================================
// Ergalics Studio — editor session store (block/code modes)
//
// Holds the editor sessions (the IR-based block/code documents), the active
// session, the run-time variable snapshot and the console. Persistence flows
// through `useProjectStore.applyEditor()` / `restoreEditor()` so sessions
// round-trip inside a `.clproj` (editor architecture §9.2).
//
// Phase 0 establishes the state shape; the sync engine and run orchestration
// land in Phase 1/2.
// ==========================================================================

import { create } from 'zustand';
import { emit } from '@/core/events';
import { makeProgram, type IRProgram } from '@/editor/ir';
import {
  createEditorSession,
  type EditorSession,
  type ConsoleEntry,
  type CodeLanguage,
  type SyncState,
} from '@/types/editor';
import type { DataValue } from '@/types/datatable';
import type { BlockGraphState } from '@/types/block';
import { codegen } from '@/editor/codegen';
import { parseCodeToIR } from '@/editor/code/parse';
import { irToWorkspaceJSON } from '@/editor/block/convert';
import { irToFlow, flowToIR } from '@/editor/flow/convert';

/** Emitted whenever a session's persisted shape mutates (for dirty tracking). */
export const EDITOR_STATE_CHANGED = 'editor:state:changed';

/** Cap on console entries so long-running sessions cannot grow unboundedly. */
const MAX_CONSOLE_ENTRIES = 1000;

/** The three editable surfaces that round-trip through the IR hub. */
export type SyncOrigin = 'block' | 'flow' | 'code';

export interface EditorStore {
  sessions: EditorSession[];
  activeSessionId: string | null;
  /** Top-level variable snapshot from the last run (VariablePanel). */
  variables: Record<string, DataValue>;
  console: ConsoleEntry[];
  isRunning: boolean;
  error: string | null;
  /** A program an external caller (e.g. the samples dialog) asked to load. */
  pendingLoad: IRProgram | null;

  createSession: (mode: 'block' | 'code', language: CodeLanguage) => EditorSession;
  setActiveSession: (id: string) => void;
  updateSessionIR: (id: string, ir: IRProgram, lastCode?: string) => void;
  removeSession: (id: string) => void;
  setVariables: (variables: Record<string, DataValue>) => void;
  appendConsole: (entry: Omit<ConsoleEntry, 'timestamp'>) => void;
  clearConsole: () => void;
  setRunning: (running: boolean) => void;
  setError: (error: string | null) => void;
  requestLoad: (program: IRProgram) => void;
  consumeLoad: () => void;
  /** Clear every run output (variables / console / error) so a newly-loaded
   *  program does not linger over the previous run's results. */
  resetRunOutputs: () => void;

  // ---- 三向往返同步引擎（區塊 ⇄ 流程 ⇄ 程式碼，皆經由 IR） ----
  /** 將規範 IR 推入工作階段，並重新生成所有其他介面。 */
  applyIR: (id: string, ir: IRProgram, origin: SyncOrigin) => void;
  /** 由 IR 重新生成衍生介面（程式碼文字／區塊 JSON／流程 DAG）。 */
  regenerate: (id: string) => void;
  /** 讀取工作階段目前生成的程式碼文字（不修改狀態）。 */
  getCode: (id: string) => string;
  /** 區塊模式編輯了其 IR → 由它重建流程與程式碼。 */
  syncFromBlock: (id: string, ir: IRProgram) => void;
  /** 程式碼模式編輯了文字 → 解析為 IR → 同步區塊與流程。 */
  syncFromCode: (id: string, code: string) => void;
  /** 流程模式編輯了其 DAG → 重建 IR → 同步區塊與程式碼。 */
  syncFromFlow: (id: string, flowGraph: BlockGraphState) => void;

  toJSON: () => { sessions: EditorSession[]; activeSessionId: string | null };
  fromJSON: (state: { sessions?: EditorSession[]; activeSessionId?: string | null }) => void;
}

function emptyProgram(): IRProgram {
  return makeProgram([]);
}

function notifyChanged(): void {
  emit(EDITOR_STATE_CHANGED, undefined);
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  variables: {},
  console: [],
  isRunning: false,
  error: null,
  pendingLoad: null,

  createSession: (mode, language) => {
    const session = createEditorSession(mode, language, emptyProgram());
    set((s) => ({ sessions: [...s.sessions, session], activeSessionId: session.id }));
    notifyChanged();
    return session;
  },

  setActiveSession: (id) => {
    if (!get().sessions.some((s) => s.id === id)) return;
    set({ activeSessionId: id });
  },

  updateSessionIR: (id, ir, lastCode) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id
          ? { ...sess, ir, lastCode: lastCode ?? sess.lastCode, updatedAt: Date.now() }
          : sess,
      ),
    }));
    notifyChanged();
  },

  // ---- 三向往返同步引擎（區塊 ⇄ 流程 ⇄ 程式碼，皆經由 IR） ----
  //
  // IR 程式是唯一的真相來源。任一介面的編輯都會先轉換為 IR，再由該 IR
  // 重新生成另外兩個介面。這保證三種模式永遠描述同一份程式；由於重新生成
  // 是純函式（IR → 文字 / IR → DAG），模式之間不可能產生不同步的漂移。
  applyIR: (id, ir, origin) => {
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== id) return sess;
        const code = codegen(ir, sess.language === 'js' ? 'js' : sess.language === 'r' ? 'r' : 'python');
        const blockGraph = irToWorkspaceJSON(ir);
        const flowGraph = irToFlow(ir);
        const dirty: SyncState =
          origin === 'block' ? 'block-dirty' : origin === 'code' ? 'code-dirty' : 'flow-dirty';
        return {
          ...sess,
          ir,
          lastCode: code,
          blockGraph,
          flowGraph,
          syncState: dirty,
          updatedAt: Date.now(),
        };
      }),
    }));
    notifyChanged();
  },

  regenerate: (id) => {
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== id) return sess;
        const code = codegen(sess.ir, sess.language === 'js' ? 'js' : sess.language === 'r' ? 'r' : 'python');
        const blockGraph = irToWorkspaceJSON(sess.ir);
        const flowGraph = irToFlow(sess.ir);
        return { ...sess, lastCode: code, blockGraph, flowGraph, updatedAt: Date.now() };
      }),
    }));
    notifyChanged();
  },

  getCode: (id) => {
    const sess = get().sessions.find((s) => s.id === id);
    if (!sess) return '';
    return codegen(sess.ir, sess.language === 'js' ? 'js' : sess.language === 'r' ? 'r' : 'python');
  },

  syncFromBlock: (id, ir) => {
    get().applyIR(id, ir, 'block');
  },

  syncFromCode: (id, code) => {
    const sess = get().sessions.find((s) => s.id === id);
    const lang = sess ? (sess.language === 'js' ? 'js' : sess.language === 'r' ? 'r' : 'python') : 'python';
    const { program } = parseCodeToIR(code, lang);
    get().applyIR(id, program, 'code');
  },

  syncFromFlow: (id, flowGraph) => {
    const ir = flowToIR(flowGraph);
    get().applyIR(id, ir, 'flow');
  },


  removeSession: (id) => {
    set((s) => {
      const sessions = s.sessions.filter((sess) => sess.id !== id);
      const activeSessionId =
        s.activeSessionId === id ? (sessions[0]?.id ?? null) : s.activeSessionId;
      return { sessions, activeSessionId };
    });
    notifyChanged();
  },

  setVariables: (variables) => set({ variables }),
  appendConsole: (entry) =>
    set((s) => {
      const next = [...s.console, { ...entry, timestamp: Date.now() }];
      if (next.length > MAX_CONSOLE_ENTRIES) next.splice(0, next.length - MAX_CONSOLE_ENTRIES);
      return { console: next };
    }),
  clearConsole: () => set({ console: [] }),
  setRunning: (isRunning) => set({ isRunning }),
  setError: (error) => set({ error }),
  requestLoad: (program) => set({ pendingLoad: program }),
  consumeLoad: () => set({ pendingLoad: null }),
  resetRunOutputs: () =>
    set({ variables: {}, console: [], error: null, isRunning: false }),

  toJSON: () => ({
    // Clone sessions so the persisted snapshot is not aliased to live store
    // state: a later in-place edit would otherwise leak into the saved
    // project, and callers mutating the returned array would corrupt the store.
    sessions: get().sessions.map((s) => structuredClone(s)),
    activeSessionId: get().activeSessionId,
  }),

  fromJSON: (state) => {
    set({
      sessions: state.sessions ?? [],
      activeSessionId: state.activeSessionId ?? null,
      variables: {},
      console: [],
      isRunning: false,
      error: null,
      pendingLoad: null,
    });
  },
}));
