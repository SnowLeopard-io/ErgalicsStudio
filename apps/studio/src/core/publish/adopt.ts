// ==========================================================================
// Ergalics Studio — adopt workspace manuscript sources
//
// Opening `*.tex` / `*.bib` from the workspace means "hand this to the
// publishing suite": a `.tex` becomes (or focuses) a manuscript, a `.bib`
// merges into the citation library. The file explorer and the terminal
// `open` command share this so both behave identically.
// ==========================================================================

import { usePublishStore } from '@/stores/publishStore';
import { useProjectStore } from '@/stores/projectStore';
import { parseBibtex } from '@/core/publish/bibtex';
import type { ManuscriptRecord } from '@/core/publish/state';

/** Focus the matching manuscript, or adopt a workspace `.tex` as a new one. */
export function adoptTexFile(name: string, source: string): void {
  const store = usePublishStore.getState();
  const manuscripts = useProjectStore.getState().project?.state.publish?.manuscripts ?? [];
  const stem = name.replace(/\.[^.]+$/, '') || 'manuscript';
  // The workspace file name is the identity: opening HELLO.tex must focus the
  // HELLO manuscript instead of creating a duplicate record. Source matching
  // remains for manuscripts exported before stems were recorded.
  const byStem = manuscripts.find(
    (m) => (m.workspaceStem ?? '').toLowerCase() === stem.toLowerCase(),
  );
  if (byStem) {
    // The workspace file is authoritative when opened from the file manager.
    if (byStem.source !== source) {
      store.saveManuscript({ ...byStem, source, updatedAt: Date.now() });
    } else {
      store.setActiveManuscript(byStem.id);
    }
    return;
  }
  const existing = manuscripts.find((m) => m.source === source);
  if (existing) {
    store.setActiveManuscript(existing.id);
    return;
  }
  const now = Date.now();
  const record: ManuscriptRecord = {
    id: crypto.randomUUID(),
    name: stem,
    templateId: 'ieee',
    citationStyle: 'ieee',
    source,
    workspaceStem: stem,
    createdAt: now,
    updatedAt: now,
  };
  store.saveManuscript(record);
}

/** Merge a workspace `.bib` into the citation library (same-key replaces). */
export function adoptBibFile(source: string): void {
  const entries = parseBibtex(source);
  if (entries.length > 0) usePublishStore.getState().addLibraryEntries(entries);
}
