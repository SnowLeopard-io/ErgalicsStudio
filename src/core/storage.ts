import type { Project } from '@/types/project';

const DB_NAME = 'ergalics-studio';
const DB_VERSION = 1;
const STORE_PROJECTS = 'projects';
const STORE_PLUGINS = 'plugins';

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
    const transaction = db.transaction(store, mode);
    const request = fn(transaction.objectStore(store));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // A transaction can abort without a request-level error firing (quota
    // exceeded, blocked versionchange, connection closed). Listen on the
    // transaction itself so those cases reject instead of hanging forever.
    transaction.onabort = () =>
      reject(transaction.error ?? new Error(`transaction aborted on ${store}`));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error(`transaction failed on ${store}`));
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

export interface StoredPluginPackage {
  id: string;
  name: string;
  version: string;
  author: string;
  description: string;
  icon?: string;
  entryUrl: string;
  assets: Record<string, string>;
  installedAt: number;
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
    const transaction = db.transaction([STORE_PROJECTS, STORE_PLUGINS], 'readwrite');
    transaction.objectStore(STORE_PROJECTS).clear();
    transaction.objectStore(STORE_PLUGINS).clear();
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
