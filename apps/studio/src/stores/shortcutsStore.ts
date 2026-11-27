// Global keyboard-shortcuts help store. Separate from the palette store so
// either surface can open it; rendered once by <ShortcutsDialog />.
import { create } from 'zustand';

interface ShortcutsStore {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

export const useShortcutsStore = create<ShortcutsStore>((set, get) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => {
    if (get().open === open) return;
    set({ open });
  },
}));
