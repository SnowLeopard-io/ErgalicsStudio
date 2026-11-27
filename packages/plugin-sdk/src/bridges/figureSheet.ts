// ==========================================================================
// Ergalics Studio — Figure Studio sheet bridge (IoC)
//
// One shared helper that any plugin uses to stream its publication-grade
// panels into the host's Figure Studio sheet:
// create a sheet → addPanel × N → attach a bilingual caption → notify.
//
// The host registers its figure-store implementation at boot via
// `setFigureSheetHost(...)` — matching `setResultPublisher` in
// `scienceOutput.ts` so plugins never import host stores directly.
// ==========================================================================

import type { PlotSpec } from '../plot';
import type { PluginApi } from '../types/plugin';
import { notify } from '../tools/enhance';

/** One Figure Studio panel placement (row-major, spreadsheet-style tags). */
export interface FigurePanelSpec {
  spec: PlotSpec;
  row: number;
  col: number;
  tag: string;
}

/** A bilingual string pair (zh / en) for sheet titles and captions. */
export interface Bilingual {
  zh: string;
  en: string;
}

/** Host adapter registered at boot by the studio workbench. */
export interface FigureSheetHost {
  getActiveSheetId(): string | null;
  getLocale?(): string;
  createSheet(title: string): string | null;
  addPanel(
    sheetId: string,
    spec: PlotSpec,
    placement?: { row?: number; col?: number; tag?: string; x?: number; y?: number; width?: number; height?: number },
  ): string | null | void;
  updateSheet(sheetId: string, patch: { caption?: string; title?: string }): void;
}

let figureSheetHost: FigureSheetHost | null = null;

export function setFigureSheetHost(host: FigureSheetHost | null): void {
  figureSheetHost = host;
}

export function getFigureSheetHost(): FigureSheetHost | null {
  return figureSheetHost;
}

/** Standard panel geometry for figure sheets (3-up row-major). */
export const FIGURE_PANEL_WIDTH = 336;
export const FIGURE_PANEL_HEIGHT = 252;
export const FIGURE_PANEL_COLS = 3;

/** Tag letters a, b, c, … from a panel ordinal. */
export function panelTag(i: number): string {
  return String.fromCharCode(97 + (i % 26));
}

/** Row-major placement for the i-th panel in a 3-column layout. */
export function panelPlace(i: number): { row: number; col: number } {
  return { row: Math.floor(i / FIGURE_PANEL_COLS), col: i % FIGURE_PANEL_COLS };
}

/**
 * Push panels into a new Figure Studio sheet. Returns true when the sheet
 * was created and filled. Notifies the user on every early exit (no
 * plottable data, no open project) — callers can be one-liners.
 */
export async function pushPanelsToFigure(
  api: PluginApi,
  sheetTitle: Bilingual,
  caption: Bilingual,
  panels: FigurePanelSpec[],
): Promise<boolean> {
  if (panels.length === 0) {
    notify(api, 'warning', 'No plottable data yet — load a dataset first.', '暂无可绘图数据 — 请先加载数据。');
    return false;
  }
  const figure = figureSheetHost;
  if (!figure) {
    notify(api, 'warning', 'Figure Studio host is unavailable.', 'Figure Studio 宿主服务不可用。');
    return false;
  }
  const zh = api.locale === 'zh-CN';
  const sheetId = figure.createSheet(zh ? sheetTitle.zh : sheetTitle.en);
  if (!sheetId) {
    notify(api, 'warning', 'Open a project first.', '请先打开一个项目。');
    return false;
  }
  for (const p of panels) {
    figure.addPanel(sheetId, p.spec, { row: p.row, col: p.col, tag: p.tag });
  }
  figure.updateSheet(sheetId, { caption: zh ? caption.zh : caption.en });
  notify(
    api,
    'info',
    `Sent ${panels.length} panels to Figure Studio.`,
    `已将 ${panels.length} 个面板发送到 Figure Studio。`,
  );
  return true;
}
