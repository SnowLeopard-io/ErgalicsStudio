// ==========================================================================
// Ergalics Studio — one-shot dataset handoff between tools
//
// Light utility surfaces (quick-stats) stage a parsed sample here before
// opening a research suite (uncertainty lab) embedded in the workbench.
// The suite picks the payload up on mount with takeLabHandoff(); this keeps
// the handoff working across the SPA navigation that openToolEmbedded
// performs, without touching project data files.
// ==========================================================================

import { useProjectStore } from '@/stores/projectStore';

export interface LabHandoff {
  /** Display name used as the DataTable label (not a real project path). */
  name: string;
  /** Tabular text (CSV with a header row) the suite can parseDataText(). */
  csv: string;
  /**
   * Tool id this payload is intended for. Consumers ignore handoffs addressed
   * to another tool, so a payload staged for a page that never mounts (user
   * navigates away first) can never surprise-preselect a later manual visit.
   */
  target?: string;
}

let pending: LabHandoff | null = null;
/** Project the payload was staged in. */
let pendingProjectId: string | null = null;

/** The project currently open (null when there is none). */
function currentProjectId(): string | null {
  return useProjectStore.getState().project?.id ?? null;
}

export function stageLabHandoff(payload: LabHandoff): void {
  pending = payload;
  pendingProjectId = currentProjectId();
}

/** Consume the staged payload (returns it once, then clears).
 *
 *  A payload carries the CONTENT of a file, so it must not survive a
 *  project switch: staging a dataset in project A and opening the suite in
 *  project B would otherwise load project A's data into project B's lab. */
export function takeLabHandoff(): LabHandoff | null {
  if (pending && pendingProjectId !== currentProjectId()) pending = null;
  const staged = pending;
  pending = null;
  return staged;
}
