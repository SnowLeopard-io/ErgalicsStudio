// ==========================================================================
// Ergalics Studio — Vfs factory (environment-aware, git-free)
// ==========================================================================

import type { Vfs } from './types';
import { LightningVfs } from './lightning';
import { MemoryVfs } from './memory';

export type { Vfs, VfsEntry } from './types';
export { MemoryVfs } from './memory';
export { LightningVfs } from './lightning';
export { seedStandardSkeleton } from './skeleton';
export { safeVfsRelPath, safeVfsDirPath, isValidVfsEntryName, VfsPathError } from './path';

let injected: Vfs | null = null;
let memorySingleton: Vfs | null = null;

export function getVfs(): Vfs {
  if (injected) return injected;
  if (typeof window !== 'undefined') {
    return new LightningVfs();
  }
  // Node / unit tests have no IndexedDB: a shared MemoryVfs keeps consumers
  // testable (dependency-free, safe to import statically).
  if (!memorySingleton) memorySingleton = new MemoryVfs();
  return memorySingleton;
}

/** Swap the backing store (tests inject a MemoryVfs here). */
export function setVfs(vfs: Vfs): void {
  injected = vfs;
}

export function resetVfs(): void {
  injected = null;
}
