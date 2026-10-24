// ==========================================================================
// AI assistant panel global store
//
// The assistant used to be an inline right-hand column owned by each editor
// (CodeEditor / BlockEditor), so Flow mode had no entry point and the fixed
// panel ate into the block/code canvas. It is now a project-wide floating
// panel toggled from the shared top bar in every mode. The current editor
// registers its execution hook here on mount (via `registerRun`) so the
// floating panel can run the generated draft with the active runtime without
// either side knowing about the other.
// ==========================================================================

import { create } from 'zustand';

/** Outcome of a host-executed assistant run. */
export interface AiRunResult {
  ok: boolean;
  /** Error message when the run failed. */
  error?: string;
  /** True when the code was only inserted (canvas) — run it in code mode. */
  insertedOnly?: boolean;
}

/** Hook the active editor supplies to execute a generated draft. */
export type AiRunHandler = (code: string) => Promise<AiRunResult>;

interface AiPanelStore {
  open: boolean;
  /** Execution hook of the currently mounted editor (null outside an editor,
   *  e.g. Flow before a runnable surface exists — run is then disabled). */
  runHandler: AiRunHandler | null;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  /**
   * Register an editor's run hook. Returns a cleanup that de-registers this
   * hook on unmount without clobbering a hook registered by an editor that
   * was mounted later (mode switches can overlap during Suspense swaps).
   */
  registerRun: (handler: AiRunHandler) => () => void;
}

export const useAiPanelStore = create<AiPanelStore>((set, get) => ({
  open: false,
  runHandler: null,

  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),

  registerRun: (handler) => {
    set({ runHandler: handler });
    return () => {
      // Only clear the slot if we still hold it; otherwise a newer editor's
      // hook must stay intact.
      if (get().runHandler === handler) set({ runHandler: null });
    };
  },
}));