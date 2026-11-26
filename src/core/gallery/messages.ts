// FR-19 作品画廊 — failure → i18n key mapping (pure TS).
//
// The store reports *why* a mutation failed; only the UI knows how to phrase
// it. Keeping the mapping here lets the gallery page and the share dialog
// speak with one voice instead of growing their own copies of the switch.

import type { GalleryWriteFailure } from './store';

const FAILURE_KEYS: Record<GalleryWriteFailure, string> = {
  quota: 'gallery.store.quota',
  unavailable: 'gallery.store.unavailable',
  io: 'gallery.store.io',
  'not-found': 'gallery.store.not_found',
};

/** i18n key describing a failed gallery store mutation. */
export function galleryFailureKey(reason: GalleryWriteFailure): string {
  return FAILURE_KEYS[reason];
}
