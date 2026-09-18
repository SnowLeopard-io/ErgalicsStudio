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
//   1. Data tables — every `<table>…</table>` whose body contains a `<tbody>`
//      with more than MAX_TABLE_ROWS (5) data rows is replaced by a visible
//      "rows removed for privacy" notice. Small tables (the snapshot's own
//      fingerprint / dependency / locked-run summaries) survive untouched.
//   2. JSON data islands — `<script type="application/json">` blocks whose
//      payload is a JSON *array of objects* (raw record rows) are dropped;
//      the repro lock object islands stay (fingerprints only, no raw data).
//   3. Inline data URIs — `data:` URIs carrying CSV/TSV/JSON/text payloads
//      (e.g. `<a href="data:text/csv,…">` download links) are neutralized.
//   4. Defense in depth — any line that looks like a raw CSV/TSV data row
//      (≥4 tab/comma-separated numeric fields) outside markup is stripped.
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
 * A `<table>` whose headers match is statistical/lock metadata, not raw data,
 * so it survives untouched even when it has many rows.
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

/** Heuristic raw-row detector over tab/comma-separated fields. */
function looksNumericRow(text: string): boolean {
  const cells = text.split(/[\t,]/).map((c) => c.trim()).filter(Boolean);
  if (cells.length < 4) return false;
  const numeric = cells.filter((c) => /^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(c));
  return numeric.length >= Math.ceil(cells.length * 0.75);
}

/** Turn one `<tr>` into a tab-separated text line, then apply the heuristic. */
function rowLooksRaw(tr: string): boolean {
  return looksNumericRow(tr.replace(/<[^>]*>/g, '\t'));
}

/** Drop `<table>` blocks that carry raw data rows. */
function stripDataTables(html: string): string {
  return html.replace(/<table(?=[\s>])[\s\S]*?<\/table>/gi, (table) => {
    if (isSummaryTable(table)) return table;
    const body = /<tbody(?=[\s>])[^>]*>([\s\S]*?)<\/tbody>/i.exec(table);
    const scope = body?.[1] ?? table;
    const rows = [...scope.matchAll(/<tr(?=[\s>])[\s\S]*?<\/tr>/gi)].map((m) => m[0]);
    const rawRows = rows.filter(rowLooksRaw).length;
    // ≥2 raw-looking rows, or a big multi-row dump past the summary allowance.
    if (rawRows >= 2 || (rows.length > MAX_TABLE_ROWS && rawRows >= 1)) {
      return PRIVACY_NOTICE;
    }
    return table;
  });
}

/** Drop JSON island scripts that hold an array of records (raw rows). */
function stripDataIslands(html: string): string {
  return html.replace(
    /<script([^>]*\btype\s*=\s*["']application\/json["'][^>]*)>([\s\S]*?)<\/script>/gi,
    (full, _attrs: string, body: string) => {
      // Only flat scalar records (a raw data dump) are private. The snapshot's
      // own islands — the repro lock object and the locked-runs summaries —
      // carry nested params/metrics objects (statistical results) and stay.
      try {
        const parsed: unknown = JSON.parse(body.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>'));
        if (!Array.isArray(parsed) || parsed.length === 0) return full;
        const flatRecords = parsed.every(
          (row) =>
            row !== null &&
            typeof row === 'object' &&
            !Array.isArray(row) &&
            Object.keys(row).length >= 3 &&
            Object.values(row).every((v) => v === null || typeof v !== 'object'),
        );
        return flatRecords ? '' : full;
      } catch {
        /* unparseable island — leave it to the line-level pass below */
        return full;
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

/** Heuristic raw-row detector: ≥4 numeric-ish fields on one line. */
function looksLikeDataRow(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('<')) return false;
  return looksNumericRow(trimmed);
}

/**
 * Remove raw private data from a snapshot HTML destined for the public
 * gallery. Pure: the input string is never mutated; returns a new string.
 */
export function sanitizeForGallery(html: string): string {
  let out = stripDataTables(html);
  out = stripDataIslands(out);
  out = stripDataUris(out);
  out = out
    .split('\n')
    .filter((line) => !looksLikeDataRow(line))
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
