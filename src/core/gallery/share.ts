// ==========================================================================
// FR-19 作品画廊 — share payload builder (pure TS)
//
// `buildGalleryShare` turns a FR-09 reproducible snapshot (self-contained
// HTML) plus share metadata into a public GalleryItem + the sanitized HTML
// that goes with it. The hard rule from REQUIREMENTS.md: public content must
// NEVER contain raw private data. The snapshot itself only embeds hashes and
// summaries, but users can attach extra figures (inline SVG) whose embedded
// data tables carry raw rows — so we run `sanitizeForGallery` over the HTML
// before storing it.
//
// Sanitization strategy (documented + test-guarded in tests/gallery.test.ts):
//   DEFAULT-PRIVATE: everything that looks like structured data is removed
//   unless it is explicitly allowed through. Concretely (issue #26):
//   1. Data tables — every `<table>…</table>` is inspected row by row. A
//      table survives only when it carries no raw-looking rows and is either
//      small (≤ MAX_TABLE_ROWS) or one of the snapshot's own summary tables
//      (header markers). A summary marker alone NEVER bypasses the row
//      checks — a 50-row dump with a `seed` column is still stripped.
//      Raw-looking now covers non-numeric PII too (emails, phone numbers).
//   2. JSON data islands — only the snapshot's own `repro-lock-json` /
//      `repro-runs-json` islands survive (fingerprints and metric summaries,
//      no raw records). Any other island — object-wrapped arrays, short
//      records, custom payloads — is dropped.
//   3. Inline data URIs — `data:` URIs carrying CSV/TSV/JSON/text payloads
//      (e.g. `<a href="data:text/csv,…">` download links) are neutralized.
//   4. Defense in depth — any line whose text content looks like a raw
//      CSV/TSV data row (≥4 tab/comma-separated fields, numeric or PII)
//      is replaced by a privacy notice, including rows embedded in markup
//      such as `<pre>` blocks or SVG `<text>` (only lines owned by the
//      structural passes — table cells and JSON islands — are exempt).
//   Structure, figures (SVG), statistical summaries (metrics like
//      `p=0.031`), headings and repro-lock information are all preserved.
// ==========================================================================

import { hashString } from '@/core/repro/random';
import type {
  GalleryChartType,
  GalleryItem,
  GalleryLicense,
  GalleryReproStatus,
  GallerySubject,
  LocalizedText,
} from './types';
import {
  isGalleryChartType,
  isGalleryLicense,
  isGalleryReproStatus,
  isGallerySubject,
} from './types';

/** Tables with more than this many body rows are treated as raw data dumps. */
export const MAX_TABLE_ROWS = 5;

export interface GalleryShareMeta {
  title: LocalizedText;
  summary: LocalizedText;
  author: string;
  subject: GallerySubject;
  chartTypes: GalleryChartType[];
  reproStatus: GalleryReproStatus;
  license: GalleryLicense;
  /** Template id powering the "Open in Ergalics" deep link (optional). */
  templateId?: string;
  /** Cover-art seed; derived from the id when omitted. */
  seed?: number;
  /** ISO timestamp override (tests / replay); defaults to now. */
  createdAt?: string;
}

export interface GalleryShareResult {
  item: GalleryItem;
  /** The private-data-stripped snapshot HTML to publish. */
  html: string;
}

// --------------------------------------------------------------------------
// sanitizeForGallery
// --------------------------------------------------------------------------

const PRIVACY_NOTICE =
  '<p class="note">[gallery] data rows removed for privacy · 数据行已因隐私策略移除</p>';

/**
 * Header signatures of the snapshot's own summary tables (core/repro/snapshot
 * renders: data fingerprints, dependency versions, locked-run metrics).
 * A `<table>` whose headers match may survive even when it has many rows —
 * but ONLY when no row looks like raw data (see stripDataTables).
 */
const SUMMARY_HEADER_MARKERS = [
  'fingerprint',
  '指纹',
  'metrics',
  '指标',
  'dependency',
  '依赖',
  'seed',
  '种子',
];

function isSummaryTable(table: string): boolean {
  const headers = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)]
    .map((m) => (m[1] ?? '').replace(/<[^>]*>/g, '').toLowerCase());
  return headers.some((h) => SUMMARY_HEADER_MARKERS.some((k) => h.includes(k)));
}

const EMAIL_RE = /[^\s<>"']+@[^\s<>"']+\.[^\s<>"']+/;
/**
 * Phone-ish cell detector. A bare run of digits is NOT a phone: the snapshot's
 * locked-runs `seed` column holds a 32-bit unsigned integer (≤10 digits, no
 * separators) and would otherwise be misread as PII, nuking the whole summary
 * table (issue #56). A phone is either international (`+…`), digit-grouped
 * (spaces/dashes/parens), or a bare run of ≥11 digits (a 32-bit seed is at
 * most 10 digits, so 11+ cannot be a seed).
 */
function looksLikePhone(s: string): boolean {
  if (/^\+\d[\d\s()-]{5,}$/.test(s)) return true; // international
  if (/^\d[\d\s()-]{5,}$/.test(s)) {
    if (/[()\s-]/.test(s)) return true; // grouped local number
    if (/^\d{11,}$/.test(s)) return true; // bare 11+ digit run
  }
  return false;
}

/** Numeric fields of a tab/comma-separated row (the original heuristic). */
function isNumericRow(cells: string[]): boolean {
  const numeric = cells.filter((c) => /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(c));
  return numeric.length >= Math.ceil(cells.length * 0.75);
}

/** Heuristic raw-record detector: ≥4 fields that are numeric or carry PII
 *  (emails / phone numbers — non-numeric raw data was invisible before,
 *  issue #26 bypass 2). */
function looksLikeRawRecordRow(text: string): boolean {
  const cells = text.split(/[\t,]/).map((c) => c.trim()).filter(Boolean);
  if (cells.length < 4) return false;
  if (isNumericRow(cells)) return true;
  return cells.some((c) => EMAIL_RE.test(c) || looksLikePhone(c));
}

/** Turn one `<tr>` into a tab-separated text line, then apply the heuristic. */
function rowLooksRaw(tr: string): boolean {
  return looksLikeRawRecordRow(tr.replace(/<[^>]*>/g, '\t'));
}

/** Drop `<table>` blocks that carry raw data rows. */
function stripDataTables(html: string): string {
  return html.replace(/<table(?=[\s>])[\s\S]*?<\/table>/gi, (table) => {
    const body = /<tbody(?=[\s>])[^>]*>([\s\S]*?)<\/tbody>/i.exec(table);
    const scope = body?.[1] ?? table;
    const rows = [...scope.matchAll(/<tr(?=[\s>])[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
    const rawRows = rows.filter(rowLooksRaw).length;
    // Default-private (issue #26): keep only tables with (almost) no raw rows
    // that are either small or one of the snapshot's own summaries. The
    // summary marker no longer bypasses the row checks.
    const smallClean = rows.length <= MAX_TABLE_ROWS && rawRows <= 1;
    const summaryClean = isSummaryTable(table) && rawRows === 0;
    return smallClean || summaryClean ? table : PRIVACY_NOTICE;
  });
}

/** Islands of the snapshot itself — fingerprints and run summaries only. */
const KEPT_ISLAND_IDS = new Set(['repro-lock-json', 'repro-runs-json']);

/**
 * Keep ONLY the snapshot's own JSON islands (whitelisted by id) and drop
 * every other application/json island — object-wrapped record arrays,
 * two-key records and custom payloads were all invisible before (issue #26
 * bypass 3). Unparseable islands are dropped too: the structural whitelist
 * replaces the old "looks-like-a-data-dump" guessing game.
 */
function stripDataIslands(html: string): string {
  return html.replace(
    /<script([^>]*\btype\s*=\s*["']application\/json["'][^>]*)>([\s\S]*?)<\/script>/gi,
    (full, attrs: string) => {
      const id = /\bid\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1] ?? '';
      if (!KEPT_ISLAND_IDS.has(id)) return '';
      // The kept islands must still parse — a corrupted lock island is
      // worthless to the reader and might hide arbitrary payloads.
      try {
        JSON.parse(full.replace(/^<script[^>]*>/i, '').replace(/<\/script>\s*$/i, ''));
        return full;
      } catch {
        return '';
      }
    },
  );
}

/** Neutralize inline data: URIs carrying text/csv/json payloads. */
function stripDataUris(html: string): string {
  return html.replace(
    /\b(href|src)\s*=\s*(["'])data:(?:text|application)\/[^"']*\2/gi,
    (_full, attr: string, quote: string) => `${attr}=${quote}#${quote}`,
  );
}

/** Line-level raw-record detector. Markup lines are checked by their TEXT
 *  content so rows embedded in `<pre>`/SVG `<text>` are caught too — except
 *  lines owned by the structural passes (table cells, kept JSON islands,
 *  stylesheets), whose text would be misread. */
function looksLikeDataRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('<')) {
    if (/<(?:tr|td|th|script|style)\b/i.test(trimmed)) return false;
    return looksLikeRawRecordRow(trimmed.replace(/<[^>]*>/g, '\t'));
  }
  return looksLikeRawRecordRow(trimmed);
}

/**
 * Remove raw private data from a snapshot HTML destined for the public
 * gallery. Pure: the input string is never mutated; returns a new string.
 * Raw lines are REPLACED by the privacy notice (not silently deleted) so the
 * document visibly shows where data was removed.
 */
export function sanitizeForGallery(html: string): string {
  let out = stripDataTables(html);
  out = stripDataIslands(out);
  out = stripDataUris(out);
  out = out
    .split('\n')
    .map((line) => (looksLikeDataRow(line) ? PRIVACY_NOTICE : line))
    .join('\n');
  return out;
}

// --------------------------------------------------------------------------
// buildGalleryShare
// --------------------------------------------------------------------------

function normalizeMeta(meta: GalleryShareMeta): void {
  if (!meta.title || (!meta.title.zh && !meta.title.en)) {
    throw new Error('gallery share: title required');
  }
  if (!isGallerySubject(meta.subject)) throw new Error(`gallery share: bad subject ${meta.subject}`);
  if (!meta.chartTypes.every(isGalleryChartType)) throw new Error('gallery share: bad chartTypes');
  if (!isGalleryReproStatus(meta.reproStatus)) throw new Error('gallery share: bad reproStatus');
  if (!isGalleryLicense(meta.license)) throw new Error(`gallery share: bad license ${meta.license}`);
}

/**
 * Build the public gallery entry from a snapshot + metadata. The stored HTML
 * is always the sanitized form — callers never get to publish the raw input.
 */
export function buildGalleryShare(snapshotHtml: string, meta: GalleryShareMeta): GalleryShareResult {
  normalizeMeta(meta);
  const html = sanitizeForGallery(snapshotHtml);
  const createdAt = meta.createdAt ?? new Date().toISOString();
  const id = `share-${hashString(`${meta.title.en}|${meta.author}|${createdAt}`).slice(0, 8)}`;
  const item: GalleryItem = {
    id,
    title: meta.title,
    summary: meta.summary,
    author: meta.author,
    subject: meta.subject,
    chartTypes: [...meta.chartTypes],
    reproStatus: meta.reproStatus,
    license: meta.license,
    snapshotRef: `local:${id}`,
    templateId: meta.templateId,
    seed: meta.seed ?? Number.parseInt(hashString(id), 16) % 1000,
    createdAt,
  };
  return { item, html };
}
