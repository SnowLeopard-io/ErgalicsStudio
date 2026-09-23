// ==========================================================================
// Shared Figure Studio bridge for the geography plugin suite.
//
// One helper every geo plugin uses to stream its publication-grade panels
// into the figure store's shared sheet (same flow as fluid-cfd-coupler):
// create a sheet → addPanel × N → attach a bilingual caption → notify.
// Pure panel builders live in each plugin file; only this store-touching
// push is centralised here.
// ==========================================================================

import type { PlotSpec } from '@/core/plot';
import type { PluginApi } from '@/types/plugin';
import { notify } from '../shared/enhance';

/** One Figure Studio panel placement (row-major, spreadsheet-style tags). */
export interface GeoFigurePanel {
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

/** Standard panel geometry for geo figure sheets (3-up row-major). */
export const GEO_PANEL_WIDTH = 336;
export const GEO_PANEL_HEIGHT = 252;
export const GEO_PANEL_COLS = 3;

/** Tag letters a, b, c, … from a panel ordinal. */
export function panelTag(i: number): string {
  return String.fromCharCode(97 + (i % 26));
}

/** Row-major placement for the i-th panel in a 3-column layout. */
export function panelPlace(i: number): { row: number; col: number } {
  return { row: Math.floor(i / GEO_PANEL_COLS), col: i % GEO_PANEL_COLS };
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
  panels: GeoFigurePanel[],
): Promise<boolean> {
  if (panels.length === 0) {
    notify(api, 'warning', 'No plottable data yet — load a dataset first.', '暂无可绘图数据 — 请先加载数据。');
    return false;
  }
  const { useFigureStore } = await import('@/stores/figureStore');
  const zh = api.locale === 'zh-CN';
  const figure = useFigureStore.getState();
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
