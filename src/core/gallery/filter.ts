// ==========================================================================
// FR-19 作品画廊 — filtering (pure TS)
//
// One pure function drives the gallery filter bar: subject / chart type /
// repro status equality filters plus a free-text query matched against the
// bilingual title, summary and author. Take-down items are always excluded,
// no matter what filters the caller passes.
// ==========================================================================

import type { GalleryChartType, GalleryItem, GalleryReproStatus, GallerySubject } from './types';

export interface GalleryFilter {
  subject?: GallerySubject | 'all';
  chartType?: GalleryChartType | 'all';
  reproStatus?: GalleryReproStatus | 'all';
  /** Case-insensitive substring over title(zh/en), summary(zh/en), author. */
  query?: string;
  /** Keep take-down-marked items (the "my shares" review view). */
  includeTakedown?: boolean;
}

export function filterGallery(items: GalleryItem[], filter: GalleryFilter = {}): GalleryItem[] {
  const q = filter.query?.trim().toLowerCase() ?? '';
  return items.filter((item) => {
    if (item.takedown && !filter.includeTakedown) return false;
    if (filter.subject && filter.subject !== 'all' && item.subject !== filter.subject) return false;
    if (
      filter.chartType &&
      filter.chartType !== 'all' &&
      !item.chartTypes.includes(filter.chartType)
    ) {
      return false;
    }
    if (
      filter.reproStatus &&
      filter.reproStatus !== 'all' &&
      item.reproStatus !== filter.reproStatus
    ) {
      return false;
    }
    if (q) {
      const haystack = [
        item.title.zh,
        item.title.en,
        item.summary.zh,
        item.summary.en,
        item.author,
      ]
        .join('\n')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}
