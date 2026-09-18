// ==========================================================================
// Ergalics Studio — shared helpers for the research surfaces
// (Signal Lab page, Model Lab / Profiler / Sweep / Report UIs).
//
// Everything here is thin React-free glue over the tested cores: data-file
// loading through the shared registry, "send a PlotSpec to Figure Studio",
// and CSV assembly for derived outputs saved back into the project.
// ==========================================================================

import { listDataFilesGrouped, resolveDataFile } from '@/core/dataFiles';
import { parseDataText } from '@/blocks/fileData';
import { isNumericType } from '@/blocks/ops';
import type { DataTable } from '@/types/datatable';
import type { PlotSpec } from '@/core/plot';
import { useFigureStore } from '@/stores/figureStore';

export interface DataFileGroups {
  project: string[];
  examples: string[];
}

export function groupedDataFiles(allow?: readonly string[]): DataFileGroups {
  return listDataFilesGrouped(allow);
}

export interface LoadedTable {
  table: DataTable;
  numericCols: string[];
  allCols: string[];
}

/** Resolve + parse a data file; throws with a readable message on failure. */
export function loadTable(name: string): LoadedTable {
  const text = resolveDataFile(name);
  if (text === undefined) throw new Error(`data file not found: ${name}`);
  const table = parseDataText(text, name);
  const numericCols = table.columns
    .filter((c) => isNumericType(c.type))
    .map((c) => c.name);
  return { table, numericCols, allCols: table.columns.map((c) => c.name) };
}

/**
 * Create (or reuse the active) Figure Studio sheet carrying one PlotSpec,
 * optionally writing a caption. Returns true when the panel landed.
 */
export function sendSpecToFigure(sheetName: string, spec: PlotSpec, caption?: string): boolean {
  const store = useFigureStore.getState();
  let sheetId = store.activeSheetId;
  if (!sheetId) sheetId = store.createSheet(sheetName);
  if (!sheetId) return false;
  if (caption) store.updateSheet(sheetId, { caption });
  store.addPanel(sheetId, spec);
  return true;
}

/** Minimal CSV quoting (RFC 4180): quote when a value contains , " or newline. */
export function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Assemble CSV text from a header row and string-coercible rows. */
export function toCsv(columns: string[], rows: Array<Array<unknown>>): string {
  const head = columns.map(csvCell).join(',');
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\n');
  return body ? `${head}\n${body}` : head;
}

export function fmt(v: number, digits = 6): string {
  if (!Number.isFinite(v)) return '—';
  // toPrecision requires digits in [1, 100]; digits <= 0 means "round to integer"
  // (used for whole-millisecond timings). Keep it crash-free for any caller.
  if (digits <= 0) return String(Math.round(v));
  const d = Math.min(100, Math.trunc(digits));
  return String(Number(v.toPrecision(d)));
}
