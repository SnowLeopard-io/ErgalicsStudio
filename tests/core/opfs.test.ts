// ==========================================================================
// FR-17 — OpfsChunkStore over an in-memory fake OPFS tree.
// ==========================================================================

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OpfsChunkStore, OpfsUnavailableError, isOpfsAvailable } from '@/core/opfs';
import { makeFakeRoot } from './opfs-helpers';

function enc(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function dec(u8: Uint8Array): string {
  return new TextDecoder().decode(u8);
}

describe('isOpfsAvailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('true when navigator.storage.getDirectory is a function', () => {
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => null } });
    expect(isOpfsAvailable()).toBe(true);
  });

  it('false when navigator has no storage', () => {
    vi.stubGlobal('navigator', {});
    expect(isOpfsAvailable()).toBe(false);
  });

  it('false when navigator is absent', () => {
    vi.stubGlobal('navigator', undefined);
    expect(isOpfsAvailable()).toBe(false);
  });
});

describe('OpfsChunkStore (fake OPFS)', () => {
  let root: ReturnType<typeof makeFakeRoot>;
  let store: OpfsChunkStore;

  beforeEach(() => {
    root = makeFakeRoot();
    store = new OpfsChunkStore({ getRoot: async () => root as unknown as FileSystemDirectoryHandle });
  });

  it('writes chunks + meta under ergalics/<pid>/<fid>/', async () => {
    await store.writeChunks('p1', 'f1', [enc('abc'), enc('defg')]);
    const fileDir = (await (await (await root.getDirectoryHandle('ergalics')).getDirectoryHandle('p1')).getDirectoryHandle('f1'));
    expect([...fileDir.files.keys()].sort()).toEqual(['0.bin', '1.bin', 'meta.json']);
    expect(dec(fileDir.files.get('0.bin')!.data)).toBe('abc');
    expect(dec(fileDir.files.get('1.bin')!.data)).toBe('defg');
    expect(JSON.parse(dec(fileDir.files.get('meta.json')!.data))).toEqual({
      sizes: [3, 4],
      total: 7,
    });
  });

  it('readChunk returns the stored bytes', async () => {
    await store.writeChunks('p1', 'f1', [enc('hello'), enc(' world')]);
    expect(dec(await store.readChunk('p1', 'f1', 1))).toBe(' world');
  });

  it('getChunkSizes exposes the meta sizes', async () => {
    await store.writeChunks('p1', 'f1', [enc('aa'), enc('bbb')]);
    expect(await store.getChunkSizes('p1', 'f1')).toEqual([2, 3]);
  });

  it('readRange within a single chunk', async () => {
    await store.writeChunks('p1', 'f1', [enc('abcdef'), enc('ghi')]);
    expect(dec(await store.readRange('p1', 'f1', 1, 4))).toBe('bcd');
  });

  it('readRange across chunk boundaries', async () => {
    await store.writeChunks('p1', 'f1', [enc('abcdef'), enc('ghi')]);
    expect(dec(await store.readRange('p1', 'f1', 4, 8))).toBe('efgh');
  });

  it('readRange clamps out-of-bounds requests', async () => {
    await store.writeChunks('p1', 'f1', [enc('abcdef')]);
    expect(dec(await store.readRange('p1', 'f1', 2, 999))).toBe('cdef');
    expect((await store.readRange('p1', 'f1', 10, 20)).byteLength).toBe(0);
    expect(dec(await store.readRange('p1', 'f1', -5, 3))).toBe('abc');
  });

  it('removeFile deletes the file directory; missing files are no-ops', async () => {
    await store.writeChunks('p1', 'f1', [enc('x')]);
    await store.removeFile('p1', 'f1');
    await expect(store.readChunk('p1', 'f1', 0)).rejects.toBeDefined();
    await expect(store.removeFile('p1', 'nope')).resolves.toBeUndefined();
  });

  it('listFiles enumerates stored files with byte totals', async () => {
    await store.writeChunks('p1', 'f1', [enc('aa'), enc('bbb')]);
    await store.writeChunks('p1', 'f2', [enc('cccc')]);
    await store.writeChunks('p2', 'f3', [enc('d')]);
    const all = await store.listFiles();
    expect(all).toHaveLength(3);
    expect(all.find((f) => f.fileId === 'f1')).toEqual({
      projectId: 'p1',
      fileId: 'f1',
      totalBytes: 5,
      chunkCount: 2,
    });
    const scoped = await store.listFiles('p2');
    expect(scoped.map((f) => f.fileId)).toEqual(['f3']);
  });

  it('listFiles returns [] when the ergalics root never existed', async () => {
    expect(await store.listFiles()).toEqual([]);
  });

  it('clearAll wipes the whole tree', async () => {
    await store.writeChunks('p1', 'f1', [enc('x')]);
    await store.clearAll();
    expect(await store.listFiles()).toEqual([]);
  });

  it('estimateUsage reads navigator.storage.estimate', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 42, quota: 99 }) } });
    expect(await store.estimateUsage()).toEqual({ usage: 42, quota: 99 });
    vi.stubGlobal('navigator', { storage: {} });
    expect(await store.estimateUsage()).toBeNull();
    vi.unstubAllGlobals();
  });

  it('every method rejects OpfsUnavailableError without OPFS', async () => {
    vi.stubGlobal('navigator', {});
    const live = new OpfsChunkStore();
    await expect(live.writeChunks('p', 'f', [enc('x')])).rejects.toBeInstanceOf(OpfsUnavailableError);
    await expect(live.readChunk('p', 'f', 0)).rejects.toBeInstanceOf(OpfsUnavailableError);
    await expect(live.readRange('p', 'f', 0, 1)).rejects.toBeInstanceOf(OpfsUnavailableError);
    await expect(live.listFiles()).rejects.toBeInstanceOf(OpfsUnavailableError);
    await expect(live.removeFile('p', 'f')).rejects.toBeInstanceOf(OpfsUnavailableError);
    vi.unstubAllGlobals();
  });
});
