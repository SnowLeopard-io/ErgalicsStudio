// Ergalics Studio — guided tour state (新手引导)
//
// Deliberately tiny: the tour is UI flow, so the store only tracks whether
// it is running, which flow it belongs to and which step it is on. The step
// definitions themselves live in TourGuide.tsx (they need i18n + selectors).
//
// Every onboarding part shares this store:
//   • 'menu'     — the entry chooser (see the cards in TourGuide).
//   • 'debut'    — the 30-second "data → paper figure" first-run story.
//   • 'ui'       — the classic region-by-region workbench walkthrough.
//   • 'analysis' — bundled sample data → descriptive statistics.
//   • 'publish'  — LaTeX manuscript → live preview → workspace files.
//   • 'launcher' — research-tool launcher map → open a suite.
//
// Completion is persisted in localStorage ('ergalics:tour') so the tour
// auto-starts only on the very first visit to the workbench.

import { create } from 'zustand';

const STORAGE_KEY = 'ergalics:tour';

export type TourFlow = 'menu' | 'debut' | 'ui' | 'analysis' | 'publish' | 'launcher';

interface TourState {
  active: boolean;
  flow: TourFlow;
  step: number;
  /** Start a flow. Defaults to the entry chooser. */
  start: (flow?: TourFlow, step?: number) => void;
  /** Jump into a specific step of a flow (used to resume the debut). */
  startAt: (flow: TourFlow, step: number) => void;
  next: () => void;
  /** Stop the tour and remember the user has seen (or skipped) it.
   *  `completed` distinguishes finishing the last step (rewards the tour XP /
   *  badge) from skipping midway. */
  finish: (completed?: boolean) => void;
}

export const useTourStore = create<TourState>((set) => ({
  active: false,
  flow: 'menu',
  step: 0,
  start: (flow = 'menu', step = 0) => set({ active: true, flow, step }),
  startAt: (flow, step) => set({ active: true, flow, step }),
  next: () => set((s) => ({ step: s.step + 1 })),
  finish: (completed = false) => {
    set({ active: false, step: 0 });
    try {
      localStorage.setItem(STORAGE_KEY, 'done');
    } catch {
      /* private mode — tour will just re-offer next visit */
    }
    if (!completed) return;
    // Ambience: tour completion XP + badge. Lazy import keeps this tiny store
    // free of the ambience graph; a failure must never affect the tour itself.
    void import('./ambienceStore')
      .then(({ useAmbienceStore }) => {
        const store = useAmbienceStore.getState();
        if (store.progress.flags.tourRewarded) return;
        useAmbienceStore.setState((s) => ({
          progress: {
            ...s.progress,
            counters: { ...s.progress.counters },
            flags: { ...s.progress.flags, tourRewarded: true },
          },
        }));
        store.awardXp('tour_completed');
        store.checkBadges();
      })
      .catch(() => undefined);
  },
}));

/** True when the user has already completed or skipped the tour. */
export function tourSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'done';
  } catch {
    return true;
  }
}
