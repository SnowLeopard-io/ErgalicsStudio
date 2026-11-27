// ==========================================================================
// FR-19 作品画廊 — shared types (pure TS)
//
// The GalleryItem shape is deliberately aligned with the marketing-site
// gallery schema (website/src/data/gallery.ts) so a workstation share can
// round-trip to the site catalog and vice versa:
//   website `repro: 'ok'|'partial'|'none'`  →  workstation
//   `reproStatus: 'locked'|'drifted'|'none'` (locked = a valid repro lock
//   passed all drift checks; drifted = partial/failed; none = never locked).
//   website `chartType` (single)            →  `chartTypes[]` (a work may
//   ship several figure kinds).
// ==========================================================================

/** Bilingual text pair (same convention as core/templates). */
export interface LocalizedText {
  zh: string;
  en: string;
}

/** Subject tags — identical to the website SUBJECTS list. */
export const GALLERY_SUBJECTS = [
  'physics',
  'biology',
  'astronomy',
  'engineering',
  'chemistry',
  'geoscience',
  'medicine',
  'mathematics',
] as const;
export type GallerySubject = (typeof GALLERY_SUBJECTS)[number];

/** Chart types — identical to the website CHART_TYPES list. */
export const GALLERY_CHART_TYPES = [
  'scatter',
  'line',
  'histogram',
  'heatmap',
  'contour',
  'boxplot',
  'surface',
  'pointcloud',
  'sankey',
  'qq',
] as const;
export type GalleryChartType = (typeof GALLERY_CHART_TYPES)[number];

export const GALLERY_REPRO_STATUSES = ['locked', 'drifted', 'none'] as const;
export type GalleryReproStatus = (typeof GALLERY_REPRO_STATUSES)[number];

export const GALLERY_LICENSES = [
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC0-1.0',
  'MIT',
  'CC-BY-NC-4.0',
] as const;
export type GalleryLicense = (typeof GALLERY_LICENSES)[number];

/** One gallery card (curated entry or a user's local share). */
export interface GalleryItem {
  /** Stable unique id (curated ids match the website gallery ids). */
  id: string;
  title: LocalizedText;
  summary: LocalizedText;
  author: string;
  subject: GallerySubject;
  /** One or more figure kinds present in the work. */
  chartTypes: GalleryChartType[];
  reproStatus: GalleryReproStatus;
  license: GalleryLicense;
  /**
   * Reference to the snapshot backing this work. Curated entries carry the
   * website-facing marker `curated`; user shares carry `local:<id>` and the
   * sanitized HTML itself lives in the local shared-works store.
   */
  snapshotRef?: string;
  /** Template id for the "Open in Ergalics" deep link (FR-01 catalog). */
  templateId?: string;
  /** Website studio route (kept for site↔workstation symmetry). */
  studioRoute?: string;
  /** Deterministic seed for the generated cover art. */
  seed: number;
  /** ISO date string (creation / share time). */
  createdAt: string;
  /** True for the built-in curated catalog (never stored in localStorage). */
  curated?: boolean;
  /** Take-down flag: marked works are filtered out of every listing. */
  takedown?: boolean;
}

export function isGallerySubject(v: unknown): v is GallerySubject {
  return typeof v === 'string' && (GALLERY_SUBJECTS as readonly string[]).includes(v);
}

export function isGalleryChartType(v: unknown): v is GalleryChartType {
  return typeof v === 'string' && (GALLERY_CHART_TYPES as readonly string[]).includes(v);
}

export function isGalleryReproStatus(v: unknown): v is GalleryReproStatus {
  return typeof v === 'string' && (GALLERY_REPRO_STATUSES as readonly string[]).includes(v);
}

export function isGalleryLicense(v: unknown): v is GalleryLicense {
  return typeof v === 'string' && (GALLERY_LICENSES as readonly string[]).includes(v);
}
