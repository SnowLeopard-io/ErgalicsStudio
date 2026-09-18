// ==========================================================================
// FR-17 — one-time migration: legacy IndexedDB chunk store → OPFS
//
// Walks every file that still has IDB `fileChunks` records, copies its chunks
// to the OPFS store, verifies the byte hash round-trip, and only then deletes
// the IDB copy and writes a migration record. Failures leave the IDB data
// untouched, so the migration is idempotent and safely retryable; already
// migrated files are skipped via their record. Cancellation is cooperative:
// `shouldStop()` is checked before each file.
// ==========================================================================

import { OpfsChunkStore } from '@/core/opfs';
import {
  deleteFileChunks,
  getMigrationRecord,
  listChunkFileRefs,
  listFileChunks,
  putMigrationRecord,
} from '@/core/storage';

/** FNV-1a (32-bit, hex8) over raw bytes — matches hashString's algorithm. */
export function hashBytes(data: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 1) {
    h ^= data[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export interface MigrationProgress {
  done: number;
  total: number;
  fileId: string;
}

export interface MigrationResult {
  migrated: number;
  skipped: number;
  failed: number;
  /** True when `shouldStop()` cut the run short. */
  stopped: boolean;
}

export interface MigrationOptions {
  onProgress?: (p: MigrationProgress) => void;
  shouldStop?: () => boolean;
  /** Injectable for tests; defaults to a live OPFS store. */
  store?: OpfsChunkStore;
}

/** Migrate one file's chunks IDB → OPFS (hash-verified). */
async function migrateOneFile(
  store: OpfsChunkStore,
  projectId: string,
  fileId: string,
): Promise<'migrated' | 'skipped'> {
  const chunks = await listFileChunks(projectId, fileId);
  if (chunks.length === 0) {
    // Nothing to move but a stale ref — skipped, no record written.
    return 'skipped';
  }
  const sourceHash = hashBytes(concat(chunks));

  await store.writeChunks(projectId, fileId, chunks);

  // Verify the OPFS copy byte-for-byte before dropping the IDB original.
  const verify: Uint8Array[] = [];
  for (let c = 0; c < chunks.length; c += 1) {
    verify.push(await store.readChunk(projectId, fileId, c));
  }
  const writtenHash = hashBytes(concat(verify));
  if (writtenHash !== sourceHash) {
    throw new Error(
      `hash mismatch after OPFS write for ${projectId}/${fileId} (${sourceHash} != ${writtenHash})`,
    );
  }

  await deleteFileChunks(projectId, fileId);
  await putMigrationRecord({
    id: `${projectId}/${fileId}`,
    projectId,
    fileId,
    status: 'migrated',
    migratedAt: Date.now(),
    hash: sourceHash,
  });
  return 'migrated';
}

/** Migrate every pending file; see module header for the guarantees. */
export async function migrateIdbToOpfs(
  opts: MigrationOptions = {},
): Promise<MigrationResult> {
  const store = opts.store ?? new OpfsChunkStore();
  const refs = await listChunkFileRefs();
  const result: MigrationResult = { migrated: 0, skipped: 0, failed: 0, stopped: false };
  const total = refs.length;

  for (let i = 0; i < refs.length; i += 1) {
    if (opts.shouldStop?.()) {
      result.stopped = true;
      return result;
    }
    const ref = refs[i]!;
    try {
      const existing = await getMigrationRecord(ref.projectId, ref.fileId);
      if (existing?.status === 'migrated') {
        result.skipped += 1;
      } else {
        const outcome = await migrateOneFile(store, ref.projectId, ref.fileId);
        if (outcome === 'migrated') result.migrated += 1;
        else result.skipped += 1;
      }
    } catch {
      // Keep the IDB copy on any failure — the next run retries this file.
      result.failed += 1;
    }
    opts.onProgress?.({ done: i + 1, total, fileId: ref.fileId });
  }

  return result;
}
