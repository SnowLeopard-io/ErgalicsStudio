// ==========================================================================
// Shared enhancement helpers for built-in plugins
//
// Small framework-aligned conveniences every builtin can opt into without
// changing the Plugin contract:
//   - localized "button" parameter factories
//   - one-click PNG snapshot export (Canvas 2D and Three.js handles)
//   - RFC-4180 CSV export of the plugin's underlying data
//   - locale-aware notify helper
//
// All exports are dependency-free so they work identically in the trusted
// host context and (via the RPC bridge) the isolated worker sandbox.
// ==========================================================================

import type { ParamDefinition, PluginApi } from '@/types/plugin';

// ---- parameter factories --------------------------------------------------

export type ButtonVariant = 'primary' | 'danger' | 'default';

/** A button param whose action name equals its key, with zh/en labels. */
export function actionButton(key: string, en: string, zh: string, variant: ButtonVariant = 'default'): ParamDefinition {
  return {
    key,
    label: en,
    labelI18n: { 'zh-CN': zh, 'en-US': en },
    type: 'button',
    variant,
    action: key,
  };
}

// ---- locale helpers --------------------------------------------------------

/** Show a notification choosing the zh/en text from the current locale. */
export function notify(api: PluginApi, kind: 'info' | 'success' | 'warning' | 'error', en: string, zh: string): void {
  api.notify(kind, api.locale === 'zh-CN' ? zh : en);
}

// ---- PNG export ------------------------------------------------------------

/** Decode a `data:<mime>;base64,...` URL into a Blob (pure, testable). */
export function dataUrlToBlob(url: string): Blob | null {
  const match = /^data:([^;,]+)(;base64)?,([\s\S]*)$/.exec(url);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? '';
  if (isBase64) {
    const binary = atobSafe(payload);
    if (binary === null) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

function atobSafe(b64: string): string | null {
  try {
    if (typeof atob !== 'function') return null;
    return atob(b64);
  } catch {
    return null;
  }
}

/**
 * Synchronously snapshot a 2-D canvas as a PNG blob. `toDataURL` is used
 * (rather than the async `toBlob`) so button handlers stay control-flow
 * simple; the data-URL round trip is fine for plot-sized canvases.
 */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Blob | null {
  try {
    return dataUrlToBlob(canvas.toDataURL('image/png'));
  } catch {
    return null;
  }
}

/** Export a canvas frame as `<baseName>.png`. Returns false on failure. */
export function exportCanvasPng(api: PluginApi, canvas: HTMLCanvasElement | null | undefined, baseName: string): boolean {
  if (!canvas) {
    notify(api, 'warning', 'Nothing to export yet.', '暂无可导出的画面。');
    return false;
  }
  const blob = canvasToPngBlob(canvas);
  if (!blob) {
    notify(api, 'error', 'PNG export failed.', 'PNG 导出失败。');
    return false;
  }
  api.exportFile(`${safeBaseName(baseName)}.png`, blob, 'image/png');
  return true;
}

/**
 * Export a Three.js snapshot (host `Scene3DHandle.snapshot()` already
 * returns a PNG data URL) as `<baseName>.png`.
 */
export function exportSnapshotPng(api: PluginApi, dataUrl: string | null | undefined, baseName: string): boolean {
  const blob = dataUrl ? dataUrlToBlob(dataUrl) : null;
  if (!blob) {
    notify(api, 'error', 'Snapshot failed.', '快照生成失败。');
    return false;
  }
  api.exportFile(`${safeBaseName(baseName)}.png`, blob, 'image/png');
  return true;
}

// ---- CSV export ------------------------------------------------------------

/** Quote one CSV cell per RFC 4180 (quote when needed, double inner quotes). */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Build CSV text from a header row and data rows. Null/undefined cells
 * become empty strings; numbers are emitted with their default rendering.
 */
export function toCsv(
  header: Array<string | number>,
  rows: Iterable<Array<string | number | null | undefined>>,
): string {
  const lines: string[] = [header.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  return lines.join('\r\n');
}

/** Export tabular data as `<baseName>.csv` (UTF-8 BOM for Excel). */
export function exportRowsCsv(
  api: PluginApi,
  baseName: string,
  header: Array<string | number>,
  rows: Iterable<Array<string | number | null | undefined>>,
): boolean {
  const csv = toCsv(header, rows);
  if (linesCount(csv) < 2) {
    notify(api, 'warning', 'No data to export yet.', '暂无可导出的数据。');
    return false;
  }
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  api.exportFile(`${safeBaseName(baseName)}.csv`, blob, 'text/csv;charset=utf-8');
  return true;
}

function linesCount(csv: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i]!;
    if (ch === '"') {
      if (inQuotes && csv[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (ch === '\n' && !inQuotes) {
      count += 1;
    }
  }
  return count + 1;
}

function safeBaseName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'export';
  return cleaned.slice(0, 80);
}
