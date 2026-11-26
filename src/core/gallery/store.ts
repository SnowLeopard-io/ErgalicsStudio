// ==========================================================================
// FR-19 作品画廊 — local "my shares" store (localStorage-backed)
//
// Records the works the user shared from this workstation: small metadata in
// one index key, and each sanitized snapshot HTML (FR-09) under its OWN key.
// The v1 layout put the HTML inside the index, so every share re-serialized
// every snapshot on the device — with hundreds of KB per work that is slow,
// and a failed write could lose all of them. Splitting them keeps each write
// O(one work) and gives the UI an honest byte count plus a cleanup path.
//
// v1 entries with inline `html` are still read (and deleted) correctly; they
// are not rewritten until the user shares something new or prunes.
//
// Sharing never uploads anywhere in v1 — the gallery surface is the local
// mirror of what a future public endpoint would serve. Take-down marks the
// entry (audit trail) and filters it from every listing.
//
// Every mutation REPORTS its outcome. A quota-exceeded write used to be
// swallowed while the dialogs still announced success; a take-down that
// silently did nothing is a privacy problem, so callers get GalleryWriteResult
// and must show the failure.
//
// Storage pluggability: Vitest runs in a node environment without
// localStorage, so every function accepts an injected `GalleryStorage`.
// Without an injection and without a global localStorage, reads return empty
// and writes report `unavailable` instead of throwing.
// ==========================================================================

import {
  isGalleryChartType,
  isGalleryLicense,
  isGalleryReproStatus,
  isGallerySubject,
  type GalleryItem,
} from './types';

export const GALLERY_SHARED_KEY = 'ergalics:gallery:shared';
export const GALLERY_SNAPSHOT_PREFIX = 'ergalics:gallery:snap:';

/** The large value lives under its own key so writes stay O(one work). */
export function snapshotKey(id: string): string {
  return GALLERY_SNAPSHOT_PREFIX + id;
}

/** Minimal storage surface (localStorage-compatible subset). */
export interface GalleryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One share as callers see it: metadata + sanitized snapshot HTML. */
export interface SharedGalleryEntry {
  item: GalleryItem;
  html: string;
}

/** One row of the small index. `html` only exists in legacy v1 entries. */
interface StoredShare {
  item: GalleryItem;
  htmlBytes: number;
  html?: string;
}

/** Why a store mutation did not take effect. */
export type GalleryWriteFailure =
  /** The origin's storage quota is full (snapshot HTML is large). */
  | 'quota'
  /** No storage backend at all (SSR, storage disabled by policy). */
  | 'unavailable'
  /** A backend exists but threw while reading or writing. */
  | 'io'
  /** The id does not name a stored entry. */
  | 'not-found';

export type GalleryWriteResult = { ok: true } | { ok: false; reason: GalleryWriteFailure };

export interface GalleryStorageStats {
  works: number;
  bytes: number;
  /** v1 entries whose HTML is still embedded in the index. */
  legacy: number;
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

function isValidItem(value: unknown): value is GalleryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<GalleryItem>;
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
  return true;
}

function isValidEntry(value: unknown): value is SharedGalleryEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<SharedGalleryEntry>;
  return isValidItem(entry.item) && typeof entry.html === 'string';
}

function isValidStored(value: unknown): value is StoredShare {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<StoredShare>;
  if (!isValidItem(row.item)) return false;
  if (typeof row.html === 'string') return true; // v1 layout, still supported
  return (
    typeof row.htmlBytes === 'number' && Number.isFinite(row.htmlBytes) && row.htmlBytes >= 0
  );
}

/** Chromium/Safari/Firefox all signal quota exhaustion differently. */
function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const { name, code } = err as { name?: unknown; code?: unknown };
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    name === 'QUOTA_EXCEEDED_ERR' ||
    code === 22 ||
    code === 1014
  );
}

function writeValue(storage: GalleryStorage | null, key: string, value: string): GalleryWriteResult {
  if (!storage) return { ok: false, reason: 'unavailable' };
  try {
    storage.setItem(key, value);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: isQuotaError(err) ? 'quota' : 'io' };
  }
}

interface ReadState {
  entries: StoredShare[];
  /**
   * The backend exists but could not be read. Writes must not proceed: the
   * in-memory view is incomplete, so persisting it would silently drop every
   * share this read failed to see.
   */
  blocked: boolean;
}

function readState(storage: GalleryStorage | null): ReadState {
  if (!storage) return { entries: [], blocked: true };
  let raw: string | null;
  try {
    raw = storage.getItem(GALLERY_SHARED_KEY);
  } catch {
    return { entries: [], blocked: true };
  }
  if (!raw) return { entries: [], blocked: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Garbage, not an unreadable backend: recoverable, let the next write
    // replace it instead of blocking the feature forever.
    return { entries: [], blocked: false };
  }
  if (!Array.isArray(parsed)) return { entries: [], blocked: false };
  return { entries: parsed.filter(isValidStored), blocked: false };
}

function readEntry(storage: GalleryStorage | null, row: StoredShare): SharedGalleryEntry | null {
  if (typeof row.html === 'string') return { item: row.item, html: row.html };
  let html: string | null;
  try {
    html = storage?.getItem(snapshotKey(row.item.id)) ?? null;
  } catch {
    return null;
  }
  return html === null ? null : { item: row.item, html };
}

/** Read → transform → write the small index, reporting every failure. */
function mutate(transform: (entries: StoredShare[]) => StoredShare[] | null): GalleryWriteResult {
  const storage = resolveStorage();
  const state = readState(storage);
  if (state.blocked) return { ok: false, reason: storage ? 'io' : 'unavailable' };
  const next = transform(state.entries);
  if (!next) return { ok: false, reason: 'not-found' };
  return writeValue(storage, GALLERY_SHARED_KEY, JSON.stringify(next));
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/** All stored entries, newest first (take-down ones included). */
export function listSharedEntries(): SharedGalleryEntry[] {
  const storage = resolveStorage();
  return readState(storage)
    .entries.map((row) => readEntry(storage, row))
    .filter((entry): entry is SharedGalleryEntry => entry !== null)
    .sort((a, b) => b.item.createdAt.localeCompare(a.item.createdAt));
}

/** Locally shared works that are still publicly listed. */
export function listShared(): GalleryItem[] {
  return listSharedEntries().filter((e) => !e.item.takedown).map((e) => e.item);
}

/** Fetch one stored entry (including take-down-marked ones). */
export function getSharedEntry(id: string): SharedGalleryEntry | null {
  const storage = resolveStorage();
  const row = readState(storage).entries.find((e) => e.item.id === id);
  return row ? readEntry(storage, row) : null;
}

/** Add a share (idempotent by id — re-adding replaces the older copy). */
export function addShared(entry: SharedGalleryEntry): GalleryWriteResult {
  if (!isValidEntry(entry)) throw new Error('gallery store: invalid entry');
  const storage = resolveStorage();
  const state = readState(storage);
  if (state.blocked) return { ok: false, reason: storage ? 'io' : 'unavailable' };
  const id = entry.item.id;
  // The big value first; if the index write fails, roll it back so a failed
  // share never leaves an orphan snapshot behind.
  const snap = writeValue(storage, snapshotKey(id), entry.html);
  if (!snap.ok) return snap;
  const result = mutate((entries) => [
    ...entries.filter((e) => e.item.id !== id),
    { item: entry.item, htmlBytes: entry.html.length },
  ]);
  if (!result.ok) {
    try {
      storage?.removeItem(snapshotKey(id));
    } catch {
      /* best-effort rollback */
    }
  }
  return result;
}

/**
 * Take a work down: flags the index row (kept for the audit trail) and
 * filters it from every listing. Reports `not-found` for an unknown id and a
 * write failure when the flag could not be persisted — in that case the work
 * is STILL PUBLIC and the caller must say so.
 */
export function markTakedown(id: string): GalleryWriteResult {
  return mutate((entries) => {
    const target = entries.find((e) => e.item.id === id);
    if (!target) return null;
    target.item.takedown = true;
    return entries;
  });
}

/** Permanently delete a stored entry (privacy "erase" path). */
export function removeShared(id: string): GalleryWriteResult {
  const storage = resolveStorage();
  const state = readState(storage);
  if (state.blocked) return { ok: false, reason: storage ? 'io' : 'unavailable' };
  if (!state.entries.some((e) => e.item.id === id)) return { ok: false, reason: 'not-found' };
  // Erase the snapshot FIRST: if the index write fails afterwards, the work
  // may become an orphaned row but the private HTML is already gone.
  try {
    storage?.removeItem(snapshotKey(id));
  } catch (err) {
    return { ok: false, reason: isQuotaError(err) ? 'quota' : 'io' };
  }
  return mutate((entries) => entries.filter((e) => e.item.id !== id));
}

/** How much local storage the gallery is using (no snapshots need reading). */
export function galleryStorageStats(): GalleryStorageStats {
  const entries = readState(resolveStorage()).entries;
  return {
    works: entries.length,
    bytes: entries.reduce(
      (sum, row) => sum + (typeof row.html === 'string' ? row.html.length : row.htmlBytes),
      0,
    ),
    legacy: entries.filter((row) => typeof row.html === 'string').length,
  };
}

/** Erase the oldest works to free local storage (used by the gallery UI). */
export function pruneOldest(count = 5): GalleryWriteResult {
  if (!Number.isInteger(count) || count < 1) return { ok: false, reason: 'io' };
  const storage = resolveStorage();
  const state = readState(storage);
  if (state.blocked) return { ok: false, reason: storage ? 'io' : 'unavailable' };
  const victims = [...state.entries]
    .sort((a, b) => a.item.createdAt.localeCompare(b.item.createdAt))
    .slice(0, count);
  if (victims.length === 0) return { ok: false, reason: 'not-found' };
  for (const row of victims) {
    try {
      storage?.removeItem(snapshotKey(row.item.id));
    } catch (err) {
      return { ok: false, reason: isQuotaError(err) ? 'quota' : 'io' };
    }
  }
  const ids = new Set(victims.map((row) => row.item.id));
  return mutate((entries) => entries.filter((row) => !ids.has(row.item.id)));
}
