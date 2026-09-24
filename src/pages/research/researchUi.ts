// ==========================================================================
// Ergalics Studio — shared helpers for the research surfaces
// (Signal Lab page, Model Lab / Profiler / Sweep / Report UIs).
//
// Everything here is thin React-free glue over the tested cores: data-file
// loading through the shared registry, "send a PlotSpec to Figure Studio",
// and CSV assembly for derived outputs saved back into the project.
// ==========================================================================

import { useEffect, useState } from 'react';
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

/**
 * Grouped data files filtered down to ones that actually parse as a table.
 * The bundled examples mix real datasets with simulation *configs* (physics
 * JSON such as `{ B, damping, charges }`, lens/bridge/pendulum setups) that
 * a table picker must not offer — selecting one could only ever error.
 * Each candidate's content is loaded lazily and parse-sniffed, so this is
 * async (bundled example datasets are fetched on demand, not at first paint).
 */
export async function tabularDataGroups(allow?: readonly string[]): Promise<DataFileGroups> {
  const groups = groupedDataFiles(allow);
  const candidates = [...groups.project, ...groups.examples];
  const parsed = new Map<string, boolean>();
  await Promise.all(
    candidates.map(async (name) => {
      const text = await resolveDataFile(name);
      if (text === undefined) {
        parsed.set(name, false);
        return;
      }
      try {
        parsed.set(name, parseDataText(text, name).length > 0);
      } catch {
        parsed.set(name, false);
      }
    }),
  );
  return {
    project: groups.project.filter((n) => parsed.get(n) === true),
    examples: groups.examples.filter((n) => parsed.get(n) === true),
  };
}

/**
 * React hook that resolves `tabularDataGroups` and re-runs when `key`
 * changes (pass `project?.data.files`). Bundled examples load lazily.
 */
export function useTabularDataGroups(
  allow: readonly string[] | undefined,
  key: unknown,
): DataFileGroups {
  const [groups, setGroups] = useState<DataFileGroups>({ project: [], examples: [] });
  useEffect(() => {
    let cancelled = false;
    void tabularDataGroups(allow)
      .then((g) => {
        if (!cancelled) setGroups(g);
      })
      .catch(() => {
        if (!cancelled) setGroups({ project: [], examples: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [key, allow]);
  return groups;
}

/** React hook resolving + parsing the selected file's numeric columns. */
export function useFileCols(file: string): Pick<LoadedTable, 'numericCols' | 'allCols'> {
  const [cols, setCols] = useState<Pick<LoadedTable, 'numericCols' | 'allCols'>>({
    numericCols: [],
    allCols: [],
  });
  useEffect(() => {
    let cancelled = false;
    if (!file) {
      setCols({ numericCols: [], allCols: [] });
      return;
    }
    void loadTable(file)
      .then((lt) => {
        if (!cancelled) setCols({ numericCols: lt.numericCols, allCols: lt.allCols });
      })
      .catch(() => {
        if (!cancelled) setCols({ numericCols: [], allCols: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [file]);
  return cols;
}

export interface LoadedTable {
  table: DataTable;
  numericCols: string[];
  allCols: string[];
}

/** Resolve + parse a data file; throws with a readable message on failure. */
export async function loadTable(name: string): Promise<LoadedTable> {
  const text = await resolveDataFile(name);
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
