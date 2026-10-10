// Global command palette store (Ctrl+K). Kept separate so any surface —
// top bar button, keyboard shortcut, future affordances — can open it without
// prop drilling. Rendered once by <CommandPalette /> inside AppShell.
import { create } from 'zustand';

interface CommandPaletteStore {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
}

export const useCommandPaletteStore = create<CommandPaletteStore>((set, get) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => {
    if (get().open === open) return;
    set({ open });
  },
}));
