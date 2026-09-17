// ==========================================================================
// Chunked ingestion store (business layer)
//
// Walks a large delimited project file in row windows, keeping only the
// latest chunk (plus the small preview) in memory, and announces completion
// on the host bus (`DATA_INGESTED`) so lineage and other subscribers stay
// decoupled. Yields to the event loop between chunks to keep the UI fluid.
// ==========================================================================

import { create } from 'zustand';
import { DATA_INGESTED, emit } from '@/core/events';
import { chunkedRead, fingerprint, isChunkable } from '@/core/chunked/reader';
import type { DataTable } from '@/types/datatable';
import type { FileEntry } from '@/types/project';

export interface ChunkIngestState {
  /**
   * Monotonic token of the owning startIngest call. Guards against two
   * concurrent ingests of the SAME file (fileId alone cannot tell them
   * apart — repeated clicks would then run two interleaving iterators).
   */
  runId: number;
  fileId: string;
  fileName: string;
  hash: string;
  /** Data rows processed so far. */
  totalRows: number;
  /** Chunks processed so far. */
  chunkCount: number;
  running: boolean;
  cancelled: boolean;
  done: boolean;
  /** First rows of the file (stable preview). */
  preview: DataTable | null;
  /** Most recently processed chunk (kept for inspection). */
  current: DataTable | null;
  currentChunkIndex: number;
}

interface ChunkStore {
  state: ChunkIngestState | null;
  /** Only delimited-family files can be chunked; others stay on whole-file io. */
  canChunk: (fileName: string) => boolean;
  startIngest: (entry: FileEntry, chunkRows?: number) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export const useChunkStore = create<ChunkStore>((set, get) => {
  let nextRunId = 0;

  return {
  state: null,

  canChunk: (fileName) => isChunkable(fileName),

  startIngest: async (entry, chunkRows = 50_000) => {
    const hash = fingerprint(entry.content);
    const myRunId = ++nextRunId;
    set({
      state: {
        runId: myRunId,
        fileId: entry.id,
        fileName: entry.name,
        hash,
        totalRows: 0,
        chunkCount: 0,
        running: true,
        cancelled: false,
        done: false,
        preview: null,
        current: null,
        currentChunkIndex: -1,
      },
    });

    for await (const chunk of chunkedRead(entry.content, { chunkRows })) {
      const s = get().state;
      if (!s || s.cancelled || s.fileId !== entry.id || s.runId !== myRunId) return;
      set({
        state: {
          ...s,
          totalRows: chunk.totalRows,
          chunkCount: chunk.index + 1,
          preview: s.preview ?? (chunk.rows > 0 ? chunk.table : null),
          current: chunk.rows > 0 ? chunk.table : s.current,
          currentChunkIndex: chunk.index,
        },
      });
      // Yield so the dialog can paint between windows.
      await new Promise((r) => setTimeout(r, 0));
    }

    const s = get().state;
    if (!s || s.fileId !== entry.id || s.runId !== myRunId) return;
    if (s.cancelled) {
      set({ state: { ...s, running: false } });
      return;
    }
    set({ state: { ...s, running: false, done: true } });
    emit(DATA_INGESTED, { fileId: entry.id, hash, rows: s.totalRows });
  },

  cancel: () => {
    const s = get().state;
    if (s?.running) set({ state: { ...s, cancelled: true } });
  },

  reset: () => set({ state: null }),
  };
});
