// ==========================================================================
// Ergalics Studio — block metadata localization (block system)
//
// Block metadata lives in the catalog as data (Chinese default + optional
// per-locale overrides in `nameI18n` / `descriptionI18n`). These helpers
// resolve the display string for a locale, mirroring core/examples.ts.
// ==========================================================================

import type { Locale } from '@/i18n';
import type { BlockMeta } from '@/types/block';

export function blockName(meta: BlockMeta, locale: Locale): string {
  return meta.nameI18n?.[locale] ?? meta.name;
}

export function blockDescription(meta: BlockMeta, locale: Locale): string {
  return meta.descriptionI18n?.[locale] ?? meta.description;
}
