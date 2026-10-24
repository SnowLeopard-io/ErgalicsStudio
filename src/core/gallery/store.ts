// ==========================================================================
// FR-19 作品画廊 — local "my shares" store (localStorage-backed)
//
// Records the works the user shared from this workstation: the GalleryItem
// metadata plus the sanitized snapshot HTML (FR-09), so the detail modal can
// re-open the snapshot offline. Sharing never uploads anywhere in v1 — the
// gallery surface is the local mirror of what a future public endpoint would
// serve. Take-down marks the entry (audit trail) and filters it from every
// listing.
//
// Storage pluggability: Vitest runs in a node environment without
// localStorage, so every function accepts an injected `GalleryStorage`
// (same adapter pattern as the theme-pack registry tests use). Without an
// injection and without a global localStorage, reads return empty and
// writes degrade to no-ops instead of throwing.
// ==========================================================================

import {
  isGalleryChartType,
  isGalleryLicense,
  isGalleryReproStatus,
  isGallerySubject,
  type GalleryItem,
} from './types';

export const GALLERY_SHARED_KEY = 'ergalics:gallery:shared';

/** Minimal storage surface (localStorage-compatible subset). */
export interface GalleryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One stored share: metadata + the sanitized snapshot HTML. */
export interface SharedGalleryEntry {
  item: GalleryItem;
  html: string;
}

let injected: GalleryStorage | null = null;

/** Test seam: swap the storage backend (null restores the default). */
export function setGalleryStorageForTests(storage: GalleryStorage | null): void {
  injected = storage;
}

function resolveStorage(): GalleryStorage | null {
  if (injected) return injected;
  if (typeof localStorage !== 'undefined' && localStorage !== null) return localStorage;
  return null;
}

// --------------------------------------------------------------------------
// Validation (a hand-edited / corrupted store can never smuggle junk into
// the UI — same defense as core/theme-pack/registry.ts)
// --------------------------------------------------------------------------

function isValidEntry(value: unknown): value is SharedGalleryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<SharedGalleryEntry>;
  const item = entry.item;
  if (!item || typeof item !== 'object') return false;
  if (typeof item.id !== 'string' || !item.id) return false;
  if (typeof item.author !== 'string') return false;
  if (typeof item.title?.zh !== 'string' && typeof item.title?.en !== 'string') return false;
  if (typeof item.summary?.zh !== 'string' && typeof item.summary?.en !== 'string') return false;
  if (!isGallerySubject(item.subject)) return false;
  if (!Array.isArray(item.chartTypes) || !item.chartTypes.every(isGalleryChartType)) return false;
  if (!isGalleryReproStatus(item.reproStatus)) return false;
  if (!isGalleryLicense(item.license)) return false;
  if (typeof item.seed !== 'number') return false;
  if (typeof item.createdAt !== 'string') return false;
  if (typeof entry.html !== 'string') return false;
  return true;
}

function readAll(storage: GalleryStorage | null): SharedGalleryEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(GALLERY_SHARED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

function writeAll(storage: GalleryStorage | null, entries: SharedGalleryEntry[]): void {
  if (!storage) return;
  try {
    storage.setItem(GALLERY_SHARED_KEY, JSON.stringify(entries));
  } catch {
    /* private mode / quota — the share simply does not persist */
  }
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/** All stored entries, newest first (take-down ones included). */
export function listSharedEntries(): SharedGalleryEntry[] {
  return readAll(resolveStorage()).sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt));
}

/** Locally shared works that are still publicly listed. */
export function listShared(): GalleryItem[] {
  return listSharedEntries().filter((e) => !e.item.takedown).map((e) => e.item);
}

/** Fetch one stored entry (including take-down-marked ones). */
export function getSharedEntry(id: string): SharedGalleryEntry | null {
  return readAll(resolveStorage()).find((e) => e.item.id === id) ?? null;
}

/** Add a share (idempotent by id — re-adding replaces the older copy). */
export function addShared(entry: SharedGalleryEntry): void {
  if (!isValidEntry(entry)) throw new Error('gallery store: invalid entry');
  const storage = resolveStorage();
  const next = readAll(storage).filter((e) => e.item.id !== entry.item.id);
  next.push(entry);
  writeAll(storage, next);
}

/**
 * Take a work down: flags the stored entry (kept for the audit trail) and
 * filters it from every listing. Returns false when the id is unknown.
 */
export function markTakedown(id: string): boolean {
  const storage = resolveStorage();
  const entries = readAll(storage);
  const target = entries.find((e) => e.item.id === id);
  if (!target) return false;
  target.item.takedown = true;
  writeAll(storage, entries);
  return true;
}

/** Permanently delete a stored entry (privacy "erase" path). */
export function removeShared(id: string): boolean {
  const storage = resolveStorage();
  const entries = readAll(storage);
  const next = entries.filter((e) => e.item.id !== id);
  if (next.length === entries.length) return false;
  writeAll(storage, next);
  return true;
}
