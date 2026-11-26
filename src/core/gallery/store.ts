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
// Every mutation REPORTS its outcome. The snapshot HTML is easily hundreds of
// KB and localStorage gives this origin ~5 MB, so a quota-exceeded write is a
// routine event, not an edge case. It used to be swallowed by writeAll while
// the dialogs still announced success — a take-down that silently did nothing
// is a privacy problem, so callers now get GalleryWriteResult and must show
// the failure.
//
// Storage pluggability: Vitest runs in a node environment without
// localStorage, so every function accepts an injected `GalleryStorage`
// (same adapter pattern as the theme-pack registry tests use). Without an
// injection and without a global localStorage, reads return empty and
// writes report `unavailable` instead of throwing.
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

interface ReadState {
  entries: SharedGalleryEntry[];
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
  return { entries: parsed.filter(isValidEntry), blocked: false };
}

function writeAll(storage: GalleryStorage | null, entries: SharedGalleryEntry[]): GalleryWriteResult {
  if (!storage) return { ok: false, reason: 'unavailable' };
  try {
    storage.setItem(GALLERY_SHARED_KEY, JSON.stringify(entries));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: isQuotaError(err) ? 'quota' : 'io' };
  }
}

/**
 * Read → transform → write, reporting every failure. `transform` returns null
 * when the target id does not exist (nothing to persist).
 */
function mutate(
  transform: (entries: SharedGalleryEntry[]) => SharedGalleryEntry[] | null,
): GalleryWriteResult {
  const storage = resolveStorage();
  const state = readState(storage);
  if (state.blocked) return { ok: false, reason: storage ? 'io' : 'unavailable' };
  const next = transform(state.entries);
  if (!next) return { ok: false, reason: 'not-found' };
  return writeAll(storage, next);
}

// --------------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------------

/** All stored entries, newest first (take-down ones included). */
export function listSharedEntries(): SharedGalleryEntry[] {
  return readState(resolveStorage()).entries.sort((a, b) =>
    b.item.createdAt.localeCompare(a.item.createdAt),
  );
}

/** Locally shared works that are still publicly listed. */
export function listShared(): GalleryItem[] {
  return listSharedEntries().filter((e) => !e.item.takedown).map((e) => e.item);
}

/** Fetch one stored entry (including take-down-marked ones). */
export function getSharedEntry(id: string): SharedGalleryEntry | null {
  return readState(resolveStorage()).entries.find((e) => e.item.id === id) ?? null;
}

/** Add a share (idempotent by id — re-adding replaces the older copy). */
export function addShared(entry: SharedGalleryEntry): GalleryWriteResult {
  if (!isValidEntry(entry)) throw new Error('gallery store: invalid entry');
  return mutate((entries) => [
    ...entries.filter((e) => e.item.id !== entry.item.id),
    entry,
  ]);
}

/**
 * Take a work down: flags the stored entry (kept for the audit trail) and
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
  return mutate((entries) => {
    const next = entries.filter((e) => e.item.id !== id);
    return next.length === entries.length ? null : next;
  });
}
