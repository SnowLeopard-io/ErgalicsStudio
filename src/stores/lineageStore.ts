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

export const useLineageStore = create<LineageStore>((set) => {
  // Every rebuild takes a token; a late listRuns() response from an older
  // rebuild (or from a project the user has since closed) must not overwrite
  // the fresher graph.
  let rebuildSeq = 0;

  return {
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
    const my = ++rebuildSeq;
    const projectId = project.id;
    set({ loading: true });
    const finish = (files: typeof project.data.files, runs: Awaited<ReturnType<typeof listRuns>>) => {
      const graph = buildLineage(files, runs);
      set({ graph, layout: layoutDag(graph), version: Date.now(), loading: false });
    };
    try {
      const runs = await listRuns(projectId);
      // Re-read after the await: the project may have switched or another
      // rebuild may already be in flight.
      const current = useProjectStore.getState().project;
      if (my !== rebuildSeq || !current || current.id !== projectId) return;
      finish(current.data.files, runs);
    } catch {
      const current = useProjectStore.getState().project;
      if (my !== rebuildSeq || !current || current.id !== projectId) return;
      // Storage unavailable — lineage degrades to files-only rather than
      // breaking the dialog.
      finish(current.data.files, []);
    }
  },
  };
});

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
