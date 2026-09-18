import type { Project } from '@/types/project';
import type { RunRecord } from '@/core/experiment/record';

const DB_NAME = 'ergalics-studio';
const DB_VERSION = 5;
const STORE_PROJECTS = 'projects';
const STORE_PLUGINS = 'plugins';
const STORE_RUNS = 'runs';
const STORE_TRUSTED_KEYS = 'trustedKeys';
const STORE_FILE_CHUNKS = 'fileChunks';
const STORE_OPFS_MIGRATION = 'opfsMigration';
const STORE_COURSES = 'courses';

let dbPromise: Promise<IDBDatabase> | null = null;

export interface StorageStatus {
  available: boolean;
  usageBytes: number;
  usageHuman: string;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        const store = db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains(STORE_PLUGINS)) {
        db.createObjectStore(STORE_PLUGINS, { keyPath: 'id' });
      }
      // v2: experiment-tracking run records (idempotent — v1 databases get
      // the store on this same upgrade pass).
      if (!db.objectStoreNames.contains(STORE_RUNS)) {
        const runs = db.createObjectStore(STORE_RUNS, { keyPath: 'id' });
        runs.createIndex('projectId', 'projectId');
        runs.createIndex('createdAt', 'createdAt');
      }
      // v3: user-trusted plugin publisher keys (FR-05). Idempotent for
      // databases created before this version existed.
      if (!db.objectStoreNames.contains(STORE_TRUSTED_KEYS)) {
        db.createObjectStore(STORE_TRUSTED_KEYS, { keyPath: 'fingerprint' });
      }
      // v4: legacy IDB chunk store (FR-17) + OPFS migration bookkeeping.
      if (!db.objectStoreNames.contains(STORE_FILE_CHUNKS)) {
        const chunks = db.createObjectStore(STORE_FILE_CHUNKS, { keyPath: 'id' });
        chunks.createIndex('fileId', 'fileId');
      }
      if (!db.objectStoreNames.contains(STORE_OPFS_MIGRATION)) {
        db.createObjectStore(STORE_OPFS_MIGRATION, { keyPath: 'id' });
      }
      // v5: FR-13 course-mode partitions, keyed by projectId.
      if (!db.objectStoreNames.contains(STORE_COURSES)) {
        db.createObjectStore(STORE_COURSES, { keyPath: 'projectId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((err) => {
    // Never cache a failure: a transient error (blocked upgrade, private-mode
    // IndexedDB) previously poisoned every later storage call because the
    // rejected promise was kept forever.
    dbPromise = null;
    throw err;
  });
  return dbPromise;
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let result: T;
    const transaction = db.transaction(store, mode);
    const request = fn(transaction.objectStore(store));

    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      transaction.onabort = null;
      transaction.onerror = null;
      transaction.oncomplete = null;
      resolve(value);
    };
    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      transaction.onabort = null;
      transaction.onerror = null;
      transaction.oncomplete = null;
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    request.onsuccess = () => {
      result = request.result;
      // Resolve on transaction completion, not on request success: the caller
      // must see durably-committed data, and a request success followed by an
      // aborted commit would otherwise surface a value that was never stored.
      transaction.oncomplete = () => finish(result);
    };
    request.onerror = () => fail(request.error ?? new Error(`request failed on ${store}`));
    // A transaction can abort without a request-level error firing (quota
    // exceeded, blocked versionchange, connection closed). Listen on the
    // transaction itself so those cases reject instead of hanging forever.
    transaction.onabort = () => fail(transaction.error ?? new Error(`transaction aborted on ${store}`));
    transaction.onerror = () => fail(transaction.error ?? new Error(`transaction failed on ${store}`));
  });
}

export async function storageAvailable(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

/** Test hook: drop the cached connection so a suite can start from v1. */
export function __resetDbForTests(): void {
  dbPromise = null;
}

// ---- projects ----

export async function saveProject(project: Project): Promise<void> {
  await tx(STORE_PROJECTS, 'readwrite', (s) => s.put(project));
}

export async function deleteProject(id: string): Promise<void> {
  await tx(STORE_PROJECTS, 'readwrite', (s) => s.delete(id));
}

export async function listProjects(limit = 10): Promise<Project[]> {
  const db = await openDb();
  return new Promise<Project[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_PROJECTS, 'readonly');
    const index = transaction.objectStore(STORE_PROJECTS).index('updatedAt');
    const request = index.openCursor(null, 'prev');
    const projects: Project[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && projects.length < limit) {
        projects.push(cursor.value as Project);
        cursor.continue();
      } else {
        resolve(projects);
      }
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('transaction aborted listing projects'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('transaction failed listing projects'));
  });
}

export async function getProject(id: string): Promise<Project | undefined> {
  return tx(STORE_PROJECTS, 'readonly', (s) => s.get(id));
}

// ---- plugin packages ----

/**
 * Installed `.cspkg` record.
 *
 * Deliberately stores **no** `blob:` URLs. Object URLs are scoped to the
 * document that created them, so persisting one writes a value that is
 * guaranteed to be dead on the next session — the previous shape did exactly
 * that (`entryUrl` / `assets`), which silently grew the database with
 * unusable rows on every install. Re-hydrating a package requires re-reading
 * the file, so only the package-relative paths are kept.
 */
export interface StoredPluginPackage {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  icon?: string;
  /** Package-relative entry path from the manifest (e.g. `dist/index.js`). */
  entry: string;
  /** Package-relative file list (paths only, no URLs). */
  files: string[];
  installedAt: number;
  /** Where the package came from (FR-05 install provenance). */
  source?: 'local' | 'marketplace' | 'builtin';
  /** Signer name recorded at install time (undefined = unsigned). */
  signer?: string;
  /** `ed25519:<hex16>` fingerprint of the signing key (undefined = unsigned). */
  fingerprint?: string;
  /** Whether the signature verified against the trusted registry. */
  signed?: boolean;
}

export async function savePluginPackage(pkg: StoredPluginPackage): Promise<void> {
  await tx(STORE_PLUGINS, 'readwrite', (s) => s.put(pkg));
}

export async function listPluginPackages(): Promise<StoredPluginPackage[]> {
  return tx(STORE_PLUGINS, 'readonly', (s) => s.getAll());
}

export async function deletePluginPackage(id: string): Promise<void> {
  await tx(STORE_PLUGINS, 'readwrite', (s) => s.delete(id));
}

// ---- trusted plugin publisher keys (FR-05) --------------------------------

export interface StoredTrustedKey {
  /** `ed25519:<hex16>` — primary key. */
  fingerprint: string;
  /** Hex-encoded 32-byte ed25519 public key. */
  publicKey: string;
  /** Human-readable source label. */
  label: string;
  addedAt: number;
}

export async function saveTrustedKey(key: StoredTrustedKey): Promise<void> {
  await tx(STORE_TRUSTED_KEYS, 'readwrite', (s) => s.put(key));
}

export async function listTrustedKeys(): Promise<StoredTrustedKey[]> {
  return tx(STORE_TRUSTED_KEYS, 'readonly', (s) => s.getAll());
}

export async function deleteTrustedKey(fingerprint: string): Promise<void> {
  await tx(STORE_TRUSTED_KEYS, 'readwrite', (s) => s.delete(fingerprint));
}

// ---- chunked file storage (FR-17, legacy IDB backend) ----------------------

/** One binary chunk of a stored file (`id = ${projectId}/${fileId}/${index}`). */
export interface StoredFileChunk {
  id: string;
  projectId: string;
  fileId: string;
  index: number;
  data: Uint8Array;
  byteLength: number;
}

/** Bookkeeping written once a file's IDB chunks have moved to OPFS. */
export interface OpfsMigrationRecord {
  /** `id = ${projectId}/${fileId}`. */
  id: string;
  projectId: string;
  fileId: string;
  status: 'migrated';
  migratedAt: number;
  /** FNV hash of the concatenated chunk bytes (verification anchor). */
  hash: string;
}

function chunkId(projectId: string, fileId: string, index: number): string {
  return `${projectId}/${fileId}/${index}`;
}

/** Replace every chunk of a file (writes one record per chunk). */
export async function putFileChunks(
  projectId: string,
  fileId: string,
  chunks: Uint8Array[],
): Promise<void> {
  // Delete any stale tail first so a shrinking rewrite cannot leave orphan
  // chunks beyond the new count.
  const existing = await listFileChunkRecords(projectId, fileId);
  for (const rec of existing) {
    if (rec.index >= chunks.length) {
      await tx(STORE_FILE_CHUNKS, 'readwrite', (s) => s.delete(rec.id));
    }
  }
  for (let i = 0; i < chunks.length; i += 1) {
    const data = chunks[i]!;
    const rec: StoredFileChunk = {
      id: chunkId(projectId, fileId, i),
      projectId,
      fileId,
      index: i,
      data,
      byteLength: data.byteLength,
    };
    await tx(STORE_FILE_CHUNKS, 'readwrite', (s) => s.put(rec));
  }
}

async function listFileChunkRecords(
  projectId: string,
  fileId: string,
): Promise<StoredFileChunk[]> {
  const db = await openDb();
  return new Promise<StoredFileChunk[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_FILE_CHUNKS, 'readonly');
    const index = transaction.objectStore(STORE_FILE_CHUNKS).index('fileId');
    const request = index.openCursor();
    const found: StoredFileChunk[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const rec = cursor.value as StoredFileChunk;
        if (rec.projectId === projectId && rec.fileId === fileId) found.push(rec);
        cursor.continue();
      } else {
        found.sort((a, b) => a.index - b.index);
        resolve(found);
      }
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('transaction aborted listing chunks'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('transaction failed listing chunks'));
  });
}

/** Chunk payloads for one file, in index order. */
export async function listFileChunks(
  projectId: string,
  fileId: string,
): Promise<Uint8Array[]> {
  const records = await listFileChunkRecords(projectId, fileId);
  return records.map((r) => r.data);
}

/** Distinct files that currently have IDB chunk records. */
export async function listChunkFileRefs(): Promise<
  Array<{ projectId: string; fileId: string; count: number; bytes: number }>
> {
  const all = await tx<StoredFileChunk[]>(STORE_FILE_CHUNKS, 'readonly', (s) => s.getAll());
  const byFile = new Map<string, { projectId: string; fileId: string; count: number; bytes: number }>();
  for (const rec of all) {
    const key = `${rec.projectId}/${rec.fileId}`;
    const entry = byFile.get(key) ?? { projectId: rec.projectId, fileId: rec.fileId, count: 0, bytes: 0 };
    entry.count += 1;
    entry.bytes += rec.byteLength;
    byFile.set(key, entry);
  }
  return [...byFile.values()].sort((a, b) =>
    a.projectId === b.projectId ? a.fileId.localeCompare(b.fileId) : a.projectId.localeCompare(b.projectId),
  );
}

/** Total bytes held by the legacy IDB chunk store. */
export async function chunkUsageBytes(): Promise<number> {
  const all = await tx<StoredFileChunk[]>(STORE_FILE_CHUNKS, 'readonly', (s) => s.getAll());
  return all.reduce((sum, rec) => sum + rec.byteLength, 0);
}

/** Delete one file's chunks (or every chunk when fileId is omitted). */
export async function deleteFileChunks(projectId: string, fileId?: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_FILE_CHUNKS, 'readwrite');
    const index = transaction.objectStore(STORE_FILE_CHUNKS).index('fileId');
    const request = index.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const rec = cursor.value as StoredFileChunk;
        if (rec.projectId === projectId && (fileId === undefined || rec.fileId === fileId)) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('transaction aborted deleting chunks'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('transaction failed deleting chunks'));
  });
}

/** Drop every IDB chunk record (cache cleanup; projects/plugins/runs intact). */
export async function clearChunkCache(): Promise<void> {
  await tx(STORE_FILE_CHUNKS, 'readwrite', (s) => s.clear());
}

export async function getMigrationRecord(
  projectId: string,
  fileId: string,
): Promise<OpfsMigrationRecord | undefined> {
  return tx(STORE_OPFS_MIGRATION, 'readonly', (s) => s.get(`${projectId}/${fileId}`));
}

export async function putMigrationRecord(record: OpfsMigrationRecord): Promise<void> {
  await tx(STORE_OPFS_MIGRATION, 'readwrite', (s) => s.put(record));
}

export async function listMigrationRecords(): Promise<OpfsMigrationRecord[]> {
  return tx(STORE_OPFS_MIGRATION, 'readonly', (s) => s.getAll());
}

/** Drop every migration record (used by full cache cleanup). */
export async function clearMigrationRecords(): Promise<void> {
  await tx(STORE_OPFS_MIGRATION, 'readwrite', (s) => s.clear());
}

// ---- experiment run records ----

export async function saveRun(run: RunRecord): Promise<void> {
  await tx(STORE_RUNS, 'readwrite', (s) => s.put(run));
}

export async function deleteRun(id: string): Promise<void> {
  await tx(STORE_RUNS, 'readwrite', (s) => s.delete(id));
}

/**
 * List run records for a project, newest first. Cursor walks the `createdAt`
 * index (no key range — keeps node-env fakes and old browsers on one path)
 * and filters by projectId in memory.
 */
export async function listRuns(projectId: string, limit = 50): Promise<RunRecord[]> {
  const db = await openDb();
  return new Promise<RunRecord[]>((resolve, reject) => {
    const transaction = db.transaction(STORE_RUNS, 'readonly');
    const index = transaction.objectStore(STORE_RUNS).index('createdAt');
    const request = index.openCursor(null, 'prev');
    const runs: RunRecord[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const run = cursor.value as RunRecord;
        if (run.projectId === projectId && runs.length < limit) {
          runs.push(run);
        }
        cursor.continue();
      } else {
        resolve(runs);
      }
    };
    request.onerror = () => reject(request.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('transaction aborted listing runs'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('transaction failed listing runs'));
  });
}

/** Cascade helper: remove every run record belonging to a deleted project. */
export async function deleteRunsByProject(projectId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_RUNS, 'readwrite');
    const index = transaction.objectStore(STORE_RUNS).index('projectId');
    const request = index.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        const run = cursor.value as RunRecord;
        if (run.projectId === projectId) cursor.delete();
        cursor.continue();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('transaction aborted deleting runs'));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('transaction failed deleting runs'));
  });
}

// ---- course mode (FR-13) ----

/**
 * One project's course partition. The document is stored as JSON *text*
 * under `projectId` so the course domain module owns (de)serialisation and
 * a schema change never strands a structured record.
 */
export interface StoredCoursePartition {
  projectId: string;
  json: string;
  updatedAt: number;
}

export async function saveCoursePartition(partition: StoredCoursePartition): Promise<void> {
  await tx(STORE_COURSES, 'readwrite', (s) => s.put(partition));
}

export async function getCoursePartition(projectId: string): Promise<StoredCoursePartition | undefined> {
  return tx(STORE_COURSES, 'readonly', (s) => s.get(projectId));
}

export async function deleteCoursePartition(projectId: string): Promise<void> {
  await tx(STORE_COURSES, 'readwrite', (s) => s.delete(projectId));
}

/** Cascade helper: drop the course partition with the project. */
export async function deleteCoursesByProject(projectId: string): Promise<void> {
  await deleteCoursePartition(projectId);
}

// ---- quota / cache ----

export async function storageUsage(): Promise<StorageStatus> {
  const available = await storageAvailable();
  if (!available) {
    return { available, usageBytes: 0, usageHuman: '0 B' };
  }
  try {
    const estimate = await navigator.storage?.estimate();
    const usage = estimate?.usage ?? 0;
    return { available, usageBytes: usage, usageHuman: formatBytes(usage) };
  } catch {
    return { available, usageBytes: 0, usageHuman: '0 B' };
  }
}

export async function clearCache(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_PROJECTS, STORE_PLUGINS, STORE_RUNS], 'readwrite');
    transaction.objectStore(STORE_PROJECTS).clear();
    transaction.objectStore(STORE_PLUGINS).clear();
    transaction.objectStore(STORE_RUNS).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
