// ==========================================================================
// Figure store (business layer)
//
// Figure Studio sheets are the single source of truth in
// `project.state.figureSheets`; every mutation writes straight through to
// the project and marks it dirty (autosave persists). Exports go through the
// core `exportFigure` and announce `figure:exported` on the bus.
// ==========================================================================

import { create } from 'zustand';
import { FIGURE_EXPORTED, emit } from '@/core/events';
import { exportFigure } from '@/core/figure/compose';
import type { FigureExportFormat, FigurePanel } from '@/core/figure/compose';
import type { PlotSpec } from '@/core/plot';
import type { FigureSheet } from '@/types/project';
import { useProjectStore } from '@/stores/projectStore';
import { logger } from '@/core/logger';

/** Number of columns a new panel auto-places into (row-major fill). */
const AUTO_COLS = 2;

interface PanelPlacement {
  row?: number;
  col?: number;
  tag?: string;
}

interface FigureStore {
  activeSheetId: string | null;
  setActive: (id: string | null) => void;
  /** Create a sheet and make it active; returns its id (null without a project). */
  createSheet: (name?: string) => string | null;
  deleteSheet: (id: string) => void;
  updateSheet: (
    id: string,
    patch: Partial<Pick<FigureSheet, 'name' | 'templateId' | 'caption'>>,
  ) => void;
  /** Append a panel, auto-placing into the first free row-major cell. */
  addPanel: (sheetId: string, spec: PlotSpec, placement?: PanelPlacement) => void;
  /** Replace a panel's spec/placement in place. */
  updatePanel: (
    sheetId: string,
    index: number,
    spec: PlotSpec,
    placement?: PanelPlacement,
  ) => void;
  removePanel: (sheetId: string, index: number) => void;
  /** Compose + download; resolves after the export has been triggered. */
  exportSheet: (id: string, format: FigureExportFormat) => Promise<void>;
}

function nextFreeCell(panels: FigurePanel[]): { row: number; col: number } {
  const occupied = new Set(panels.map((p) => `${p.row}:${p.col}`));
  for (let row = 0; ; row += 1) {
    for (let col = 0; col < AUTO_COLS; col += 1) {
      if (!occupied.has(`${row}:${col}`)) return { row, col };
    }
  }
}

/** Write-through: replace project.state.figureSheets and flag dirty. */
function writeSheets(sheets: FigureSheet[]): void {
  const { project, setDirty } = useProjectStore.getState();
  if (!project) return;
  useProjectStore.setState({
    project: {
      ...project,
      state: { ...project.state, figureSheets: sheets },
    },
  });
  setDirty(true);
}

/** Apply `fn` to one sheet and persist; `fn` returning null declines the mutation. */
function mutateSheet(
  sheetId: string,
  fn: (sheet: FigureSheet) => FigureSheet | null,
): void {
  const { project } = useProjectStore.getState();
  const sheets = project?.state.figureSheets ?? [];
  const idx = sheets.findIndex((s) => s.id === sheetId);
  if (idx < 0) return;
  const updated = fn(sheets[idx]!);
  if (!updated) return;
  const next = sheets.slice();
  next[idx] = { ...updated, updatedAt: Date.now() };
  writeSheets(next);
}

export const useFigureStore = create<FigureStore>((set) => ({
  activeSheetId: null,

  setActive: (id) => set({ activeSheetId: id }),

  createSheet: (name) => {
    const { project } = useProjectStore.getState();
    if (!project) {
      logger.warn('figure', 'createSheet without an open project');
      return null;
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    const sheet: FigureSheet = {
      id,
      name: name?.trim() || `Figure ${(project.state.figureSheets?.length ?? 0) + 1}`,
      templateId: 'ieee_single',
      caption: '',
      panels: [],
      createdAt: now,
      updatedAt: now,
    };
    writeSheets([...(project.state.figureSheets ?? []), sheet]);
    set({ activeSheetId: id });
    return id;
  },

  deleteSheet: (id) => {
    const { project } = useProjectStore.getState();
    const sheets = project?.state.figureSheets ?? [];
    const next = sheets.filter((s) => s.id !== id);
    writeSheets(next);
    if (useFigureStore.getState().activeSheetId === id) {
      set({ activeSheetId: next[0]?.id ?? null });
    }
  },

  updateSheet: (id, patch) => {
    mutateSheet(id, (sheet) => ({ ...sheet, ...patch }));
  },

  addPanel: (sheetId, spec, placement) => {
    mutateSheet(sheetId, (sheet) => {
      const cell = placement?.row !== undefined && placement?.col !== undefined
        ? { row: placement.row, col: placement.col }
        : nextFreeCell(sheet.panels);
      const panel: FigurePanel = {
        row: cell.row,
        col: cell.col,
        tag: placement?.tag,
        spec,
      };
      return { ...sheet, panels: [...sheet.panels, panel] };
    });
  },

  updatePanel: (sheetId, index, spec, placement) => {
    mutateSheet(sheetId, (sheet) => {
      const panel = sheet.panels[index];
      if (!panel) return null;
      const next: FigurePanel = {
        ...panel,
        spec,
        row: placement?.row ?? panel.row,
        col: placement?.col ?? panel.col,
        tag: placement?.tag !== undefined ? placement.tag : panel.tag,
      };
      const panels = sheet.panels.slice();
      panels[index] = next;
      return { ...sheet, panels };
    });
  },

  removePanel: (sheetId, index) => {
    mutateSheet(sheetId, (sheet) => {
      if (index < 0 || index >= sheet.panels.length) return null;
      const panels = sheet.panels.slice();
      panels.splice(index, 1);
      return { ...sheet, panels };
    });
  },

  exportSheet: async (id, format) => {
    const { project } = useProjectStore.getState();
    const sheet = project?.state.figureSheets?.find((s) => s.id === id);
    if (!sheet) return;
    await exportFigure(
      { panels: sheet.panels, templateId: sheet.templateId, caption: sheet.caption },
      format,
      sheet.name || 'figure',
    );
    emit(FIGURE_EXPORTED, { figureId: id, format: format === 'png600' ? 'png' : format });
  },
}));
