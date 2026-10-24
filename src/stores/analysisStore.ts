// ==========================================================================
// Ergalics Studio — transient analysis state
//
// Holds the most recently generated publication-grade chart so it can be
// exported from *either* the Analyze panel (quick, inline) or the Share
// dialog (central "Export" zone). Kept out of the project store on purpose:
// a chart preview is session UI state, not something that should be
// serialized into the project file.
// ==========================================================================

import { create } from 'zustand';
import type { SvgPlotPayload } from '@/core/plot/types';

interface AnalysisState {
  /** Latest chart produced in the Analyze panel, or null before any. */
  currentPlot: SvgPlotPayload | null;
  setCurrentPlot: (plot: SvgPlotPayload | null) => void;
}

export const useAnalysisStore = create<AnalysisState>((set) => ({
  currentPlot: null,
  setCurrentPlot: (plot) => set({ currentPlot: plot }),
}));
