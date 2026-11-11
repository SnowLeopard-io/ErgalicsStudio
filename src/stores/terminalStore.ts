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
}

interface TerminalStore {
  sessions: TerminalSession[];
  activeId: string;
  /** Transcripts of extra sessions; the 'run' session reads editorStore. */
  transcripts: Record<string, ConsoleEntry[]>;
  /**
   * Interpreter cwd, shown in the prompt. It is GLOBAL: the interpreter has
   * one working directory, so a `cd` in any session moves every session.
   */
  cwd: string;
  /** Counter for naming new sessions (终端 2, 终端 3, …). */
  nextIndex: number;
  createSession: () => void;
  closeSession: (id: string) => void;
  setActive: (id: string) => void;
  append: (id: string, entry: ConsoleEntry) => void;
  clearSession: (id: string) => void;
  setCwd: (cwd: string) => void;
}

export const RUN_SESSION_ID = 'run';

export const useTerminalStore = create<TerminalStore>((set) => ({
  sessions: [{ id: RUN_SESSION_ID }],
  activeId: RUN_SESSION_ID,
  transcripts: {},
  cwd: '/workspace',
  nextIndex: 2,

  createSession: () =>
    set((s) => {
      const id = `t${s.nextIndex}-${Date.now().toString(36)}`;
      return {
        sessions: [...s.sessions, { id }],
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

  setCwd: (cwd) => set({ cwd }),
}));
