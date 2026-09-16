// ==========================================================================
// Experiment tracking store (business layer)
//
// Orchestrates run-record persistence: completion points (Code/Block editors,
// the Flow executor) call `recordRun`, which builds a `RunRecord`, saves it to
// the IndexedDB `runs` store and announces it on the typed host bus
// (`RUN_COMPLETED`) so downstream features (lineage) stay decoupled.
//
// Records are intentionally NOT part of the `.clproj`: they are per-project
// telemetry, cascade-deleted with the project (see projectStore.remove).
// ==========================================================================

import { create } from 'zustand';
import { RUN_COMPLETED, emit, on } from '@/core/events';
import { createRunRecord, type RunRecord, type RunSource } from '@/core/experiment/record';
import { saveRun, listRuns, deleteRun, deleteRunsByProject } from '@/core/storage';
import { useProjectStore } from '@/stores/projectStore';
import { FLOW_RUN_FINISHED } from '@/stores/blockStore';
import type { FlowRunFinishedPayload } from '@/stores/blockStore';

export interface RecordRunInput {
  source: RunSource;
  label?: string;
  params?: Record<string, unknown>;
  inputsHash?: string;
  metrics?: Record<string, number>;
  durationMs: number;
  /** Mark the run as failed (kept for the history, flagged in the label). */
  failed?: boolean;
  /** Reproducibility seed (sweeps pin one seed per cell). */
  seed?: number | null;
  /** When source is 'sweep', the parent plan id (FR2.7 lineage edge). */
  parentSweepId?: string;
  inputFileIds?: string[];
  outputFileIds?: string[];
}

interface ExperimentStore {
  runs: RunRecord[];
  loading: boolean;

  /** Load run records for the current project (no-op without a project). */
  loadRuns: () => Promise<void>;
  /**
   * Record one finished run. Silently skips when no project is open.
   * Returns the stored record (or null).
   */
  recordRun: (input: RecordRunInput) => Promise<RunRecord | null>;
  removeRun: (id: string) => Promise<void>;
  clearRuns: () => Promise<void>;
}

const MAX_METRICS = 10;

/**
 * Pull scalar numeric entries out of a run's outputs so the history table can
 * compare them across runs. Capped to keep records small.
 */
export function numericMetrics(outputs: Record<string, unknown> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!outputs) return out;
  for (const [key, value] of Object.entries(outputs)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    if (Object.keys(out).length >= MAX_METRICS) break;
  }
  return out;
}

export const useExperimentStore = create<ExperimentStore>((set, get) => ({
  runs: [],
  loading: false,

  loadRuns: async () => {
    const projectId = useProjectStore.getState().project?.id;
    if (!projectId) {
      set({ runs: [] });
      return;
    }
    set({ loading: true });
    try {
      const runs = await listRuns(projectId);
      set({ runs, loading: false });
    } catch {
      // Storage unavailable (private mode, quota) — tracking degrades to a
      // no-op rather than breaking the dialog.
      set({ runs: [], loading: false });
    }
  },

  recordRun: async (input) => {
    const projectId = useProjectStore.getState().project?.id;
    if (!projectId) return null;
    const run = createRunRecord({
      projectId,
      source: input.source,
      label: input.failed ? `${input.label ?? input.source} (failed)` : input.label,
      params: input.params,
      inputsHash: input.inputsHash,
      metrics: input.metrics,
      failed: input.failed ?? false,
      durationMs: input.durationMs,
      seed: input.seed ?? null,
      parentSweepId: input.parentSweepId,
      inputFileIds: input.inputFileIds,
      outputFileIds: input.outputFileIds,
    });
    try {
      await saveRun(run);
    } catch {
      return null; // storage unavailable — never break the running feature
    }
    if (get().runs.some((r) => r.id === run.id)) return run; // dedup
    set((s) => ({ runs: [run, ...s.runs].slice(0, 200) }));
    emit(RUN_COMPLETED, { run });
    return run;
  },

  removeRun: async (id) => {
    try {
      await deleteRun(id);
    } catch {
      /* ignore */
    }
    set((s) => ({ runs: s.runs.filter((r) => r.id !== id) }));
  },

  clearRuns: async () => {
    const projectId = useProjectStore.getState().project?.id;
    if (!projectId) {
      set({ runs: [] });
      return;
    }
    try {
      await deleteRunsByProject(projectId);
    } catch {
      /* ignore */
    }
    set({ runs: [] });
  },
}));

// ---- app wiring -----------------------------------------------------------

let initialized = false;

/**
 * Subscribe long-lived listeners. Called once from `App.tsx` (mirrors
 * `initProjectStore`), so Flow-mode runs are tracked from the first paint —
 * not only after the run-history dialog has been opened.
 */
export function initExperimentStore(): void {
  if (initialized) return;
  initialized = true;
  on<FlowRunFinishedPayload>(FLOW_RUN_FINISHED, (payload) => {
    void useExperimentStore.getState().recordRun({
      source: 'flow',
      params: { graphHash: payload.graphHash },
      inputsHash: payload.graphHash,
      metrics: numericMetrics(payload.outputs),
      durationMs: payload.durationMs,
      failed: !payload.ok,
    });
  });
}
