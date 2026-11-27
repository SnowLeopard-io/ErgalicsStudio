// ==========================================================================
// Ergalics Studio — industrial action-bar host
//
// Industrial pages used to render their operation bars (import, view presets,
// snapshot, export, solve, scan…) right above the canvas. In the workbench
// (embedded mode) those bars are parked in the right sidebar instead, so the
// canvas keeps only the viewport, charts and result tables. RightPanel
// registers its container here; each page portals its bars into it. A null
// host means "no sidebar" — standalone /studio pages keep the bars inline,
// while a collapsed sidebar hides them entirely.
// ==========================================================================

import { create } from 'zustand';

interface IndustrialChromeState {
  /** Sidebar container the action bars portal into; null when unavailable. */
  host: HTMLElement | null;
  setHost: (host: HTMLElement | null) => void;
  /** When enabled, export buttons write into the project workspace
   *  (figures/ · results/ · study/) instead of triggering a download. */
  outputToWorkspace: boolean;
  setOutputToWorkspace: (value: boolean) => void;
}

export const useIndustrialChrome = create<IndustrialChromeState>((set) => ({
  host: null,
  setHost: (host) => set({ host }),
  outputToWorkspace: false,
  setOutputToWorkspace: (outputToWorkspace) => set({ outputToWorkspace }),
}));
