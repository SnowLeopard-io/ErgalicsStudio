// ==========================================================================
// Ergalics Studio — editor session store (block/code modes)
//
// Holds the editor sessions (the IR-based block/code documents), the active
// session, the run-time variable snapshot and the console. Persistence flows
// through `useProjectStore.applyEditor()` / `restoreEditor()` so sessions
// round-trip inside a `.clproj` (block-code-modes.md §9.2).
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
} from '@/types/editor';
import type { DataValue } from '@/types/datatable';

/** Emitted whenever a session's persisted shape mutates (for dirty tracking). */
export const EDITOR_STATE_CHANGED = 'editor:state:changed';

/** Cap on console entries so long-running sessions cannot grow unboundedly. */
const MAX_CONSOLE_ENTRIES = 1000;

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
