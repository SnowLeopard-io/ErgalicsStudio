// ==========================================================================
// Ergalics Studio — terminal session store
//
// The floating terminal supports multiple sessions (VS Code style): each
// session has its own transcript, its own prompt cwd and its own input
// history. They share ONE interpreter (core/pyodide/code-runtime — a session
// singleton), so Python variables are global across sessions; what a session
// isolates is the *transcript* and the navigation state, which is what the
// multi-tab view is for.
//
// The first session ('run') is the mirror of the global run console: the
// workbench-level stdout/stderr bridge and the editors' error appends write
// to editorStore.console, which IS this session's transcript. Extra sessions
// own their transcripts here.
// ==========================================================================

import { create } from 'zustand';
import type { ConsoleEntry } from '@/types/editor';

export interface TerminalSession {
  id: string;
  /** Directory this session sits in (its own, not inherited). */
  cwd: string;
  /** The directory this session was in before the last `cd` — the target of
   *  `cd -`. */
  prevCwd: string;
}

interface TerminalStore {
  sessions: TerminalSession[];
  activeId: string;
  /** Transcripts of extra sessions; the 'run' session reads editorStore. */
  transcripts: Record<string, ConsoleEntry[]>;
  /** Counter for naming new sessions (终端 2, 终端 3, …). */
  nextIndex: number;
  createSession: () => void;
  closeSession: (id: string) => void;
  setActive: (id: string) => void;
  append: (id: string, entry: ConsoleEntry) => void;
  clearSession: (id: string) => void;
  /**
   * Move a session to a directory. `rememberPrevious` records the old
   * directory so `cd -` can go back to it.
   */
  setCwd: (id: string, cwd: string, rememberPrevious?: boolean) => void;
}

export const RUN_SESSION_ID = 'run';

export const useTerminalStore = create<TerminalStore>((set) => ({
  sessions: [{ id: RUN_SESSION_ID, cwd: '/workspace', prevCwd: '/workspace' }],
  activeId: RUN_SESSION_ID,
  transcripts: {},
  nextIndex: 2,

  createSession: () =>
    set((s) => {
      const id = `t${s.nextIndex}-${Date.now().toString(36)}`;
      return {
        // A new session starts at the workspace root — it must NOT inherit
        // the directory of the session that was active before it.
        sessions: [...s.sessions, { id, cwd: '/workspace', prevCwd: '/workspace' }],
        activeId: id,
        transcripts: { ...s.transcripts, [id]: [] },
        nextIndex: s.nextIndex + 1,
      };
    }),

  closeSession: (id) =>
    set((s) => {
      // The run session cannot be closed: it is the mirror of the global
      // console every editor writes errors and run output into.
      if (id === RUN_SESSION_ID || s.sessions.length <= 1) return s;
      const sessions = s.sessions.filter((x) => x.id !== id);
      const transcripts = { ...s.transcripts };
      delete transcripts[id];
      return {
        sessions,
        transcripts,
        activeId: s.activeId === id ? sessions[sessions.length - 1]!.id : s.activeId,
      };
    }),

  setActive: (id) => set((s) => (s.sessions.some((x) => x.id === id) ? { activeId: id } : s)),

  append: (id, entry) =>
    set((s) => ({ transcripts: { ...s.transcripts, [id]: [...(s.transcripts[id] ?? []), entry] } })),

  clearSession: (id) => set((s) => ({ transcripts: { ...s.transcripts, [id]: [] } })),

  setCwd: (id, cwd, rememberPrevious = true) =>
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === id
          ? { ...x, cwd, prevCwd: rememberPrevious && x.cwd !== cwd ? x.cwd : x.prevCwd }
          : x,
      ),
    })),
}));
