// ==========================================================================
// Research store (business layer, F2 / F5 / F8)
//
// Write-through persistence for the next-generation research surfaces:
// sweep plans + results (F2), cached data profiles (F5, FR5.6) and report
// builder specs (F8, FR8.6). Every mutation replaces the relevant slice of
// `project.state` and flags the project dirty, exactly like figureStore.
// ==========================================================================

import { create } from 'zustand';
import { useProjectStore } from '@/stores/projectStore';
import type { ProjectState } from '@/types/project';
import type { SweepPlan, SweepResult } from '@/core/sweep/types';
import type { ReportSpec } from '@/core/report/builder';
import type { SavedProfile } from '@/core/profiler/profile';

/** Apply a partial project-state patch and flag the project dirty. */
function patchState(patch: Partial<ProjectState>): void {
  const { project, setDirty } = useProjectStore.getState();
  if (!project) return;
  useProjectStore.setState({
    project: { ...project, state: { ...project.state, ...patch } },
  });
  setDirty(true);
}

interface ResearchStore {
  // ---- F2 sweeps ----
  savePlan: (plan: SweepPlan) => void;
  deletePlan: (id: string) => void;
  saveSweepResult: (result: SweepResult) => void;
  deleteSweepResult: (planId: string) => void;
  // ---- F5 profiler cache ----
  saveProfile: (saved: SavedProfile) => void;
  clearProfile: (fileKey: string) => void;
  // ---- F8 reports ----
  saveReport: (spec: ReportSpec) => void;
  deleteReport: (id: string) => void;
}

export const useResearchStore = create<ResearchStore>(() => ({
  savePlan: (plan) => {
    const plans = useProjectStore.getState().project?.state.sweeps ?? [];
    const idx = plans.findIndex((p) => p.id === plan.id);
    const next = idx < 0 ? [...plans, plan] : plans.map((p, i) => (i === idx ? plan : p));
    patchState({ sweeps: next });
  },

  deletePlan: (id) => {
    const plans = useProjectStore.getState().project?.state.sweeps ?? [];
    patchState({
      sweeps: plans.filter((p) => p.id !== id),
      sweepResults: Object.fromEntries(
        Object.entries(useProjectStore.getState().project?.state.sweepResults ?? {}).filter(
          ([k]) => k !== id,
        ),
      ),
    });
  },

  saveSweepResult: (result) => {
    const results = useProjectStore.getState().project?.state.sweepResults ?? {};
    patchState({ sweepResults: { ...results, [result.planId]: result } });
  },

  deleteSweepResult: (planId) => {
    const results = { ...(useProjectStore.getState().project?.state.sweepResults ?? {}) };
    delete results[planId];
    patchState({ sweepResults: results });
  },

  saveProfile: (saved) => {
    const profiles = useProjectStore.getState().project?.state.profiles ?? [];
    const idx = profiles.findIndex((p) => p.fileKey === saved.fileKey);
    const next =
      idx < 0 ? [...profiles, saved] : profiles.map((p, i) => (i === idx ? saved : p));
    patchState({ profiles: next });
  },

  clearProfile: (fileKey) => {
    const profiles = useProjectStore.getState().project?.state.profiles ?? [];
    patchState({ profiles: profiles.filter((p) => p.fileKey !== fileKey) });
  },

  saveReport: (spec) => {
    const reports = useProjectStore.getState().project?.state.reports ?? [];
    const id = spec.id ?? '';
    const idx = reports.findIndex((r) => r.id === id);
    const next =
      idx < 0 ? [...reports, spec] : reports.map((r, i) => (i === idx ? spec : r));
    patchState({ reports: next });
  },

  deleteReport: (id) => {
    const reports = useProjectStore.getState().project?.state.reports ?? [];
    patchState({ reports: reports.filter((r) => r.id !== id) });
  },
}));
