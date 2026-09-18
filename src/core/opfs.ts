// ==========================================================================
// FR-17 — OPFS (Origin Private File System) chunk store
//
// Large ingested files are stored as binary chunks on the Origin Private
// File System instead of IndexedDB blob records: OPFS reads bypass the IDB
// deserialization cost, support byte-range access without loading a whole
// chunk record, and count against the same persistent-storage quota with far
// better throughput. Layout (all paths relative to the origin root):
//
//   /ergalics/<projectId>/<fileId>/<index>.bin   — one chunk per file
//   /ergalics/<projectId>/<fileId>/meta.json     — { sizes: number[], total }
//
// This module never touches `navigator` at import time; availability is a
// runtime probe (`isOpfsAvailable`) so it stays importable in node tests.
// ==========================================================================

/** Thrown (rejected) by every store method when OPFS is unavailable. */
export class OpfsUnavailableError extends Error {
  constructor(message = 'OPFS is not available in this environment') {
    super(message);
    this.name = 'OpfsUnavailableError';
  }
}

/** Runtime probe — safe to call anywhere (no top-level navigator access). */
export function isOpfsAvailable(): boolean {
  try {
    const storage = (globalThis.navigator as Navigator | undefined)?.storage;
    return typeof storage?.getDirectory === 'function';
  } catch {
    return false;
  }
}

const ROOT_DIR = 'ergalics';
const META_FILE = 'meta.json';

export interface OpfsFileRef {
  projectId: string;
  fileId: string;
  totalBytes: number;
  chunkCount: number;
}

interface OpfsMeta {
  sizes: number[];
  total: number;
}

/** Minimal structured-clone-safe subset of the FileSystem API we rely on. */
type DirHandle = FileSystemDirectoryHandle;
type FileHandle = FileSystemFileHandle;

async function getFileHandle(dir: DirHandle, name: string): Promise<FileHandle> {
  return dir.getFileHandle(name, { create: true });
}

async function writeFile(dir: DirHandle, name: string, data: Uint8Array): Promise<void> {
  const handle = await getFileHandle(dir, name);
  const writable = (await handle.createWritable()) as FileSystemWritableFileStream;
  await writable.write(data as unknown as BufferSource);
  await writable.close();
}

async function readFile(dir: DirHandle, name: string): Promise<Uint8Array> {
  const handle = await dir.getFileHandle(name);
  const file = await handle.getFile();
  return new Uint8Array(await file.arrayBuffer());
}

function textEncode(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function textDecode(u8: Uint8Array): string {
  return new TextDecoder().decode(u8);
}

/**
 * Chunk store backed by the Origin Private File System. All methods reject
 * with `OpfsUnavailableError` when the platform lacks OPFS; callers should
 * probe with `isOpfsAvailable()` first and degrade to the IDB backend.
 */
export class OpfsChunkStore {
  private readonly getRoot: () => Promise<DirHandle>;

  constructor(opts?: { getRoot?: () => Promise<DirHandle> }) {
    this.getRoot =
      opts?.getRoot ??
      (async () => {
        const storage = (globalThis.navigator as Navigator | undefined)?.storage;
        if (typeof storage?.getDirectory !== 'function') throw new OpfsUnavailableError();
        return storage.getDirectory();
      });
  }

  private async root(): Promise<DirHandle> {
    try {
      return await this.getRoot();
    } catch (err) {
      if (err instanceof OpfsUnavailableError) throw err;
      throw new OpfsUnavailableError(
        `OPFS root unavailable: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** `/ergalics/<projectId>` (created on demand). */
  private async projectDir(projectId: string, create: boolean): Promise<DirHandle> {
    const root = await this.root();
    const top = await root.getDirectoryHandle(ROOT_DIR, { create });
    return top.getDirectoryHandle(projectId, { create });
  }

  /** `/ergalics/<projectId>/<fileId>` (created on demand). */
  private async fileDir(projectId: string, fileId: string, create: boolean): Promise<DirHandle> {
    const proj = await this.projectDir(projectId, create);
    return proj.getDirectoryHandle(fileId, { create });
  }

  /** Write (replace) every chunk of a file plus its meta.json. */
  async writeChunks(projectId: string, fileId: string, chunks: Uint8Array[]): Promise<void> {
    const dir = await this.fileDir(projectId, fileId, true);
    const sizes: number[] = [];
    let total = 0;
    for (let i = 0; i < chunks.length; i += 1) {
      const data = chunks[i]!;
      await writeFile(dir, `${i}.bin`, data);
      sizes.push(data.byteLength);
      total += data.byteLength;
    }
    const meta: OpfsMeta = { sizes, total };
    await writeFile(dir, META_FILE, textEncode(JSON.stringify(meta)));
  }

  private async readMeta(projectId: string, fileId: string): Promise<OpfsMeta> {
    const dir = await this.fileDir(projectId, fileId, false);
    const raw = textDecode(await readFile(dir, META_FILE));
    const parsed = JSON.parse(raw) as OpfsMeta;
    if (!Array.isArray(parsed.sizes)) throw new Error('corrupt OPFS meta.json');
    return parsed;
  }

  /** Chunk byte sizes (in index order) for a stored file. */
  async getChunkSizes(projectId: string, fileId: string): Promise<number[]> {
    const meta = await this.readMeta(projectId, fileId);
    return meta.sizes;
  }

  /** Read one whole chunk (0-based index). */
  async readChunk(projectId: string, fileId: string, index: number): Promise<Uint8Array> {
    const dir = await this.fileDir(projectId, fileId, false);
    return readFile(dir, `${index}.bin`);
  }

  /**
   * Byte-range read over the concatenated chunk stream: `[byteStart,
   * byteEnd)` (end exclusive, clamped to the file size). Only the chunks that
   * overlap the range are loaded.
   */
  async readRange(projectId: string, fileId: string, byteStart: number, byteEnd: number): Promise<Uint8Array> {
    const meta = await this.readMeta(projectId, fileId);
    const start = Math.max(0, Math.min(byteStart, meta.total));
    const end = Math.max(start, Math.min(byteEnd, meta.total));
    const out = new Uint8Array(end - start);
    if (end === start) return out;

    const dir = await this.fileDir(projectId, fileId, false);
    let cursor = 0;
    let filled = 0;
    for (let i = 0; i < meta.sizes.length; i += 1) {
      const size = meta.sizes[i]!;
      const chunkStart = cursor;
      const chunkEnd = cursor + size;
      cursor = chunkEnd;
      if (chunkEnd <= start || chunkStart >= end) continue;
      const data = await readFile(dir, `${i}.bin`);
      const from = Math.max(0, start - chunkStart);
      const to = Math.min(size, end - chunkStart);
      out.set(data.subarray(from, to), filled);
      filled += to - from;
    }
    return out.subarray(0, filled);
  }

  /** Remove a file's directory (chunks + meta). Missing files are no-ops. */
  async removeFile(projectId: string, fileId: string): Promise<void> {
    try {
      const proj = await this.projectDir(projectId, false);
      await proj.removeEntry(fileId, { recursive: true });
    } catch (err) {
      if (isNotFoundError(err)) return;
      throw err;
    }
  }

  /** List every stored file (optionally within one project). */
  async listFiles(projectId?: string): Promise<OpfsFileRef[]> {
    const refs: OpfsFileRef[] = [];
    const root = await this.root();
    let top: DirHandle;
    try {
      top = await root.getDirectoryHandle(ROOT_DIR, { create: false });
    } catch (err) {
      if (isNotFoundError(err)) return refs;
      throw err;
    }
    const projectIds = projectId ? [projectId] : await dirNames(top);
    for (const pid of projectIds) {
      let proj: DirHandle;
      try {
        proj = await top.getDirectoryHandle(pid, { create: false });
      } catch (err) {
        if (isNotFoundError(err)) continue;
        throw err;
      }
      for (const fid of await dirNames(proj)) {
        try {
          const meta = await this.readMeta(pid, fid);
          refs.push({
            projectId: pid,
            fileId: fid,
            totalBytes: meta.total,
            chunkCount: meta.sizes.length,
          });
        } catch {
          /* a file without a readable meta is not a store-managed entry */
        }
      }
    }
    return refs;
  }

  /** Best-effort quota estimate; null when the API is unavailable. */
  async estimateUsage(): Promise<{ usage: number; quota: number } | null> {
    try {
      const storage = (globalThis.navigator as Navigator | undefined)?.storage;
      const est = await storage?.estimate?.();
      if (!est) return null;
      return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
    } catch {
      return null;
    }
  }

  /** Remove the whole `/ergalics` tree (cache cleanup). */
  async clearAll(): Promise<void> {
    try {
      const root = await this.root();
      await root.removeEntry(ROOT_DIR, { recursive: true });
    } catch (err) {
      if (isNotFoundError(err)) return;
      throw err;
    }
  }
}

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: string }).name === 'NotFoundError'
  );
}

async function dirNames(dir: DirHandle): Promise<string[]> {
  const names: string[] = [];
  // entries() is the only enumeration surface on FileSystemDirectoryHandle.
  const iter = (dir as unknown as {
    entries?: () => AsyncIterable<[string, { kind: string }]>;
  }).entries;
  if (typeof iter !== 'function') return names;
  for await (const [name, handle] of iter.call(dir)) {
    if (handle.kind === 'directory') names.push(name);
  }
  return names.sort();
}
