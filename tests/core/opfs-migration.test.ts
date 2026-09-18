// ==========================================================================
// FR-17 — IDB → OPFS migration (hash-verified, idempotent, cancellable) and
// chunkedReadStored over both backends.
// ==========================================================================

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetDbForTests,
  chunkUsageBytes,
  getMigrationRecord,
  listChunkFileRefs,
  listFileChunks,
  putFileChunks,
  putMigrationRecord,
} from '@/core/storage';
import { OpfsChunkStore } from '@/core/opfs';
import { hashBytes, migrateIdbToOpfs } from '@/core/opfs-migration';
import { chunkedReadStored } from '@/core/chunked/reader';
import { installFakeIndexedDB, makeFakeRoot, uninstallFakeIndexedDB } from './opfs-helpers';

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

let root: ReturnType<typeof makeFakeRoot>;
let store: OpfsChunkStore;

beforeEach(() => {
  installFakeIndexedDB();
  __resetDbForTests();
  root = makeFakeRoot();
  store = new OpfsChunkStore({
    getRoot: async () => root as unknown as FileSystemDirectoryHandle,
  });
});

afterEach(() => {
  uninstallFakeIndexedDB();
});

async function seedFile(projectId: string, fileId: string, texts: string[]): Promise<void> {
  await putFileChunks(projectId, fileId, texts.map(enc));
}

describe('hashBytes', () => {
  it('is stable and length-sensitive', () => {
    expect(hashBytes(enc('abc'))).toBe(hashBytes(enc('abc')));
    expect(hashBytes(enc('abc'))).not.toBe(hashBytes(enc('abd')));
    expect(hashBytes(new Uint8Array(0))).toBe('811c9dc5');
  });
});

describe('migrateIdbToOpfs', () => {
  it('moves chunks to OPFS, deletes IDB copies, writes a record', async () => {
    await seedFile('p1', 'f1', ['abc', 'def']);
    const result = await migrateIdbToOpfs({ store });
    expect(result).toEqual({ migrated: 1, skipped: 0, failed: 0, stopped: false });
    expect(await listFileChunks('p1', 'f1')).toEqual([]);
    expect(await chunkUsageBytes()).toBe(0);
    const rec = await getMigrationRecord('p1', 'f1');
    expect(rec?.status).toBe('migrated');
    expect(rec?.hash).toBe(hashBytes(enc('abcdef')));
    // OPFS now holds the bytes.
    expect(await store.readChunk('p1', 'f1', 1)).toEqual(enc('def'));
  });

  it('is idempotent — a second run has nothing left to move', async () => {
    await seedFile('p1', 'f1', ['abc']);
    await migrateIdbToOpfs({ store });
    const second = await migrateIdbToOpfs({ store });
    expect(second).toEqual({ migrated: 0, skipped: 0, failed: 0, stopped: false });
  });

  it('skips files whose chunks survived a crash after the record was written', async () => {
    await seedFile('p1', 'f1', ['abc']);
    await putMigrationRecord({
      id: 'p1/f1',
      projectId: 'p1',
      fileId: 'f1',
      status: 'migrated',
      migratedAt: Date.now(),
      hash: hashBytes(enc('abc')),
    });
    const result = await migrateIdbToOpfs({ store });
    expect(result).toEqual({ migrated: 0, skipped: 1, failed: 0, stopped: false });
  });

  it('cancellation stops between files and a resumed run finishes the rest', async () => {
    await seedFile('p1', 'fa', ['aaa']);
    await seedFile('p1', 'fb', ['bbb']);
    let seen = 0;
    const first = await migrateIdbToOpfs({
      store,
      shouldStop: () => seen >= 1,
      onProgress: () => {
        seen += 1;
      },
    });
    expect(first.stopped).toBe(true);
    expect(first.migrated).toBe(1);
    // The second file still lives in IDB.
    expect((await listChunkFileRefs()).map((r) => r.fileId)).toEqual(['fb']);
    const second = await migrateIdbToOpfs({ store });
    expect(second.migrated).toBe(1);
    expect(await listChunkFileRefs()).toEqual([]);
  });

  it('a hash-verification failure keeps the IDB copy and counts as failed', async () => {
    await seedFile('p1', 'f1', ['abc', 'def']);
    // Corrupting store: writes shifted bytes so the read-back hash mismatches.
    const corrupt = {
      writeChunks: async (pid: string, fid: string, chunks: Uint8Array[]) => {
        await store.writeChunks(
          pid,
          fid,
          chunks.map((c) => new Uint8Array(c.map((b) => b ^ 0x5a))),
        );
      },
      readChunk: (pid: string, fid: string, i: number) => store.readChunk(pid, fid, i),
    } as unknown as OpfsChunkStore;
    const result = await migrateIdbToOpfs({ store: corrupt });
    expect(result).toEqual({ migrated: 0, skipped: 0, failed: 1, stopped: false });
    // IDB original untouched → retry can succeed with the good store.
    expect((await listFileChunks('p1', 'f1')).map((c) => new TextDecoder().decode(c))).toEqual([
      'abc',
      'def',
    ]);
    const retry = await migrateIdbToOpfs({ store });
    expect(retry.migrated).toBe(1);
  });

  it('reports progress per file', async () => {
    await seedFile('p1', 'f1', ['a']);
    await seedFile('p1', 'f2', ['b']);
    const progress: Array<{ done: number; total: number }> = [];
    await migrateIdbToOpfs({ store, onProgress: (p) => progress.push({ done: p.done, total: p.total }) });
    expect(progress).toEqual([
      { done: 1, total: 2 },
      { done: 2, total: 2 },
    ]);
  });

  it('with nothing stored, migrates zero files', async () => {
    const result = await migrateIdbToOpfs({ store });
    expect(result).toEqual({ migrated: 0, skipped: 0, failed: 0, stopped: false });
  });
});

describe('chunkedReadStored', () => {
  const TEXT = 'a,b\n1,2\n3,4\n5,6\n';

  it('idb backend reproduces chunkedRead semantics across byte boundaries', async () => {
    const bytes = enc(TEXT);
    // Awkward splits: mid-line boundaries (4/9/…). TEXT has 3 data rows.
    const chunks = [bytes.subarray(0, 4), bytes.subarray(4, 9), bytes.subarray(9)];
    await putFileChunks('p1', 'f1', chunks);
    const out = [];
    for await (const c of chunkedReadStored('p1', 'f1', { chunkRows: 2 })) out.push(c);
    expect(out.map((c) => c.rows)).toEqual([2, 1]);
    expect(out[out.length - 1]?.totalRows).toBe(3);
    expect(out[out.length - 1]?.done).toBe(true);
    expect(Array.from(out[0]!.table!.getColumn('a') as Float64Array)).toEqual([1, 3]);
  });

  it('opfs backend yields the same rows', async () => {
    const bytes = enc(TEXT);
    await store.writeChunks('p1', 'f2', [bytes.subarray(0, 6), bytes.subarray(6)]);
    let total = 0;
    for await (const c of chunkedReadStored('p1', 'f2', {
      backend: 'opfs',
      store,
      chunkRows: 3,
    })) {
      total = c.totalRows;
    }
    expect(total).toBe(3);
  });
});
