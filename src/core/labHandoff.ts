// ==========================================================================
// Ergalics Studio — one-shot dataset handoff between tools
//
// Light utility surfaces (quick-stats) stage a parsed sample here before
// opening a research suite (uncertainty lab) embedded in the workbench.
// The suite picks the payload up on mount with takeLabHandoff(); this keeps
// the handoff working across the SPA navigation that openToolEmbedded
// performs, without touching project data files.
// ==========================================================================

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

export function stageLabHandoff(payload: LabHandoff): void {
  pending = payload;
}

/** Consume the staged payload (returns it once, then clears). */
export function takeLabHandoff(): LabHandoff | null {
  const staged = pending;
  pending = null;
  return staged;
}
