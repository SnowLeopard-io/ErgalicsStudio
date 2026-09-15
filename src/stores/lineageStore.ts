// ==========================================================================
// Lineage store (business layer)
//
// Keeps the current project's data-lineage graph in sync: rebuilds from the
// project files + run records whenever a run completes or a file finishes
// chunked ingestion, then announces `LINEAGE_CHANGED` so open views refresh.
// Pure orchestration — graph construction/layout lives in the core layer.
// ==========================================================================

import { create } from 'zustand';
import { DATA_INGESTED, LINEAGE_CHANGED, RUN_COMPLETED, emit, on } from '@/core/events';
import type { DataIngestedPayload, RunCompletedPayload } from '@/core/events';
import { listRuns } from '@/core/storage';
import { buildLineage, layoutDag } from '@/core/lineage/graph';
import type { LineageGraph, LineageLayout } from '@/core/lineage/graph';
import { useProjectStore } from '@/stores/projectStore';

interface LineageStore {
  graph: LineageGraph;
  layout: LineageLayout | null;
  /** Bumped on every rebuild so consumers can cheaply detect changes. */
  version: number;
  loading: boolean;
  /** Rebuild graph + layout from current project data. */
  rebuild: () => Promise<void>;
}

export const useLineageStore = create<LineageStore>((set) => ({
  graph: { nodes: [], edges: [] },
  layout: null,
  version: 0,
  loading: false,

  rebuild: async () => {
    const project = useProjectStore.getState().project;
    if (!project) {
      set({ graph: { nodes: [], edges: [] }, layout: null });
      return;
    }
    set({ loading: true });
    try {
      const runs = await listRuns(project.id);
      const graph = buildLineage(project.data.files, runs);
      set({ graph, layout: layoutDag(graph), version: Date.now(), loading: false });
    } catch {
      // Storage unavailable — lineage degrades to files-only rather than
      // breaking the dialog.
      const graph = buildLineage(project.data.files, []);
      set({ graph, layout: layoutDag(graph), version: Date.now(), loading: false });
    }
  },
}));

// ---- app wiring ------------------------------------------------------------

let initialized = false;

/** Subscribe long-lived listeners; called once from `App.tsx`. */
export function initLineageStore(): void {
  if (initialized) return;
  initialized = true;

  on<RunCompletedPayload>(RUN_COMPLETED, () => {
    void useLineageStore.getState().rebuild();
    emit(LINEAGE_CHANGED, { reason: 'run' });
  });

  on<DataIngestedPayload>(DATA_INGESTED, () => {
    void useLineageStore.getState().rebuild();
    emit(LINEAGE_CHANGED, { reason: 'ingest' });
  });
}
