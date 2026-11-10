// ==========================================================================
// Ergalics Studio — editing-surface chrome host
//
// The code / block canvases used to carry their own floating toolbar (run,
// language view, save, status) *inside* the central area, which left the
// canvas with a permanent panel on top. The toolbar is now hosted by the
// workbench right sidebar: RightPanel registers its container element here and
// each surface portals its toolbar into it, so the central area stays purely
// the canvas. When the sidebar is collapsed the host is null and the toolbar
// falls back to its inline position, keeping the controls reachable.
// ==========================================================================

import { create } from 'zustand';

interface SurfaceChromeState {
  /** Sidebar container the surface toolbar portals into; null when closed. */
  host: HTMLElement | null;
  setHost: (host: HTMLElement | null) => void;
}

export const useSurfaceChrome = create<SurfaceChromeState>((set) => ({
  host: null,
  setHost: (host) => set({ host }),
}));
