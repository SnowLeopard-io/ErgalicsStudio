// ==========================================================================
// Ergalics Studio — publishing store (write-through to project.state.publish)
//
// Mirrors researchStore/figureStore: every mutation replaces the publish slice
// of `project.state` and flags the project dirty, so manuscripts, citation
// libraries and collaboration notebooks persist with the project and flow into
// the browser Git working tree on the next autosave.
// ==========================================================================

import { create } from 'zustand';
import { useProjectStore } from '@/stores/projectStore';
import type { BibEntry } from '@/core/publish/bibtex';
import type { CollabNote } from '@/core/publish/collab';
import type {
  ManuscriptRecord,
  PreprintRecord,
  PublishState,
} from '@/core/publish/state';
import { createPublishState } from '@/core/publish/state';

function read(): PublishState {
  return useProjectStore.getState().project?.state.publish ?? createPublishState();
}

function write(next: PublishState): void {
  const { project, setDirty } = useProjectStore.getState();
  if (!project) return;
  useProjectStore.setState({
    project: { ...project, state: { ...project.state, publish: next } },
  });
  setDirty(true);
}

function patch(patchState: Partial<PublishState>): void {
  write({ ...read(), ...patchState });
}

interface PublishStore {
  // ---- manuscripts ----
  saveManuscript: (manuscript: ManuscriptRecord) => void;
  deleteManuscript: (id: string) => void;
  setActiveManuscript: (id: string | null) => void;
  // ---- shared citation library ----
  setLibrary: (entries: BibEntry[]) => void;
  addLibraryEntries: (entries: BibEntry[]) => void;
  updateLibraryEntry: (key: string, entry: BibEntry) => void;
  deleteLibraryEntry: (key: string) => void;
  // ---- collaboration notes ----
  saveNote: (note: CollabNote) => void;
  deleteNote: (id: string) => void;
  setActiveNote: (id: string | null) => void;
  // ---- preprint snapshots ----
  addPreprint: (record: PreprintRecord) => void;
  deletePreprint: (id: string) => void;
}

export const usePublishStore = create<PublishStore>(() => ({
  saveManuscript: (manuscript) => {
    const state = read();
    const idx = state.manuscripts.findIndex((m) => m.id === manuscript.id);
    const manuscripts =
      idx < 0
        ? [...state.manuscripts, manuscript]
        : state.manuscripts.map((m, i) => (i === idx ? manuscript : m));
    patch({ manuscripts, activeManuscriptId: manuscript.id });
  },

  deleteManuscript: (id) => {
    const state = read();
    const manuscripts = state.manuscripts.filter((m) => m.id !== id);
    patch({
      manuscripts,
      activeManuscriptId:
        state.activeManuscriptId === id ? manuscripts[0]?.id ?? null : state.activeManuscriptId,
    });
  },

  setActiveManuscript: (id) => patch({ activeManuscriptId: id }),

  setLibrary: (entries) => patch({ library: entries }),

  addLibraryEntries: (entries) => {
    const library = [...read().library];
    for (const entry of entries) {
      const idx = library.findIndex((e) => e.key === entry.key);
      if (idx < 0) library.push(entry);
      else library[idx] = entry;
    }
    patch({ library });
  },

  updateLibraryEntry: (key, entry) => {
    patch({
      library: read().library.map((e) => (e.key === key ? entry : e)),
    });
  },

  deleteLibraryEntry: (key) => {
    patch({ library: read().library.filter((e) => e.key !== key) });
  },

  saveNote: (note) => {
    const state = read();
    const idx = state.notes.findIndex((n) => n.id === note.id);
    const notes =
      idx < 0 ? [...state.notes, note] : state.notes.map((n, i) => (i === idx ? note : n));
    patch({ notes, activeNoteId: note.id });
  },

  deleteNote: (id) => {
    const state = read();
    const notes = state.notes.filter((n) => n.id !== id);
    patch({
      notes,
      activeNoteId: state.activeNoteId === id ? notes[0]?.id ?? null : state.activeNoteId,
    });
  },

  setActiveNote: (id) => patch({ activeNoteId: id }),

  addPreprint: (record) => patch({ preprints: [record, ...read().preprints] }),

  deletePreprint: (id) => patch({ preprints: read().preprints.filter((p) => p.id !== id) }),
}));
