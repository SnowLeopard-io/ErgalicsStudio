// Ergalics Studio — subject-template guided tour state (FR-01)
//
// Tiny zustand store: which template tour is open and which step we are on.
// The step content itself lives in the catalog (bilingual, embedded), so the
// overlay renders from `getTemplate(templateId)` + the current locale.
// Deliberately not persisted — a tour belongs to the project load that
// started it.

import { create } from 'zustand';

interface TemplateTourState {
  templateId: string | null;
  step: number;
  open: boolean;
  start: (templateId: string) => void;
  next: () => void;
  prev: () => void;
  close: () => void;
}

export const useTemplateTourStore = create<TemplateTourState>((set) => ({
  templateId: null,
  step: 0,
  open: false,
  start: (templateId) => set({ templateId, step: 0, open: true }),
  next: () => set((s) => ({ step: s.step + 1 })),
  prev: () => set((s) => ({ step: Math.max(0, s.step - 1) })),
  close: () => set({ open: false }),
}));
