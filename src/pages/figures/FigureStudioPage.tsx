// ==========================================================================
// Ergalics Studio — Figure Studio (/figures)
//
// Publication-figure workbench: multi-panel sheets composed on journal
// templates. Left: sheet/panel management; right: live SVG preview + caption
// + export (SVG / PDF / PNG 600dpi). All figure data persists in
// project.state.figureSheets via figureStore.
// ==========================================================================

import { useEffect, useMemo, useState } from 'react';
import { useT } from '@/i18n';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ToolShell } from '@/components/ToolShell';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  useFigureStore,
} from '@/stores/figureStore';
import { composeFigure, JOURNAL_TEMPLATES } from '@/core/figure/compose';
import type { FigureExportFormat } from '@/core/figure/compose';
import { createDataTable } from '@/types/datatable';
import {
  dataTableToBar,
  dataTableToHistogram,
  dataTableToLine,
  dataTableToScatter,
} from '@/core/plot';
import type { PlotSpec, ChartKind } from '@/core/plot';

type PanelKind = Extract<ChartKind, 'line' | 'scatter' | 'histogram' | 'bar'>;

interface PanelDraft {
  kind: PanelKind;
  title: string;
  xLabel: string;
  yLabel: string;
  seriesName: string;
  color: string;
  /** One point per line: "x,y" (line/scatter) or a value / "x0,x1,y" (bars). */
  dataText: string;
  row: string;
  col: string;
}

const EMPTY_DRAFT: PanelDraft = {
  kind: 'line',
  title: '',
  xLabel: '',
  yLabel: '',
  seriesName: '',
  color: '#0072B2',
  dataText: '',
  row: '',
  col: '',
};

interface ParsedData {
  points?: Array<{ x: number; y: number }>;
  values?: number[];
  bars?: Array<{ x0: number; x1: number; y: number }>;
}

/**
 * Parse the pasted data block. Lines starting with '#' are comments.
 * - line/scatter: first two numbers per line are (x, y); a lone number gets
 *   its row index as x.
 * - histogram/bar: three numbers per line are explicit (x0, x1, y) bars;
 *   one number per line is a raw value (auto-binned / counted).
 */
export function parsePanelData(kind: PanelKind, text: string): ParsedData | null {
  const rows: number[][] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const nums = trimmed
      .split(/[,;\s]+/)
      .filter((tok) => tok !== '')
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (nums.length > 0) rows.push(nums);
  }
  if (rows.length === 0) return null;

  if (kind === 'line' || kind === 'scatter') {
    const points = rows.map((r, i) =>
      r.length >= 2 ? { x: r[0]!, y: r[1]! } : { x: i, y: r[0]! },
    );
    return points.length > 0 ? { points } : null;
  }
  const barRows = rows.filter((r) => r.length >= 3);
  if (barRows.length === rows.length) {
    return {
      bars: barRows.map((r) => ({ x0: r[0]!, x1: r[1]!, y: r[2]! })),
    };
  }
  const values = rows.map((r) => r[0]!);
  return values.length > 0 ? { values } : null;
}

/** Build a PlotSpec from the draft, reusing the tested DataTable adapters. */
export function buildPanelSpec(draft: PanelDraft): PlotSpec | null {
  const parsed = parsePanelData(draft.kind, draft.dataText);
  if (!parsed) return null;
  const opts = {
    title: draft.title || undefined,
    xLabel: draft.xLabel || undefined,
    yLabel: draft.yLabel || undefined,
    color: draft.color || undefined,
  };

  if (draft.kind === 'line' || draft.kind === 'scatter') {
    const xs = parsed.points!.map((p) => p.x);
    const ys = parsed.points!.map((p) => p.y);
    const table = createDataTable('panel', [
      { name: 'x', type: 'f64', data: Float64Array.from(xs) },
      { name: 'y', type: 'f64', data: Float64Array.from(ys) },
    ]);
    const spec =
      draft.kind === 'line'
        ? dataTableToLine(table, 'x', 'y', opts)
        : dataTableToScatter(table, 'x', 'y', opts);
    if (draft.seriesName) spec.series[0]!.name = draft.seriesName;
    return spec;
  }

  if (parsed.bars) {
    // Explicit bars: assemble directly (adapters count raw values only).
    return {
      width: 640,
      height: 420,
      ...opts,
      series: [
        {
          name: draft.seriesName || draft.kind,
          kind: draft.kind,
          color: draft.color || '#0072B2',
          bars: parsed.bars,
        },
      ],
    };
  }

  const table = createDataTable('panel', [
    { name: 'v', type: 'f64', data: Float64Array.from(parsed.values!) },
  ]);
  const spec =
    draft.kind === 'histogram'
      ? dataTableToHistogram(table, 'v', opts)
      : dataTableToBar(table, 'v', opts);
  if (draft.seriesName) spec.series[0]!.name = draft.seriesName;
  return spec;
}

/** Draft from an existing panel spec (round-trip for editing). */
function draftFromSpec(spec: PlotSpec, row: number, col: number): PanelDraft {
  const s = spec.series[0];
  const kind: PanelKind = (s?.kind as PanelKind) ?? 'line';
  let dataText = '';
  if (s?.points) {
    dataText = s.points.map((p) => `${p.x},${p.y}`).join('\n');
  } else if (s?.bars) {
    dataText = s.bars.map((b) => `${b.x0},${b.x1},${b.y}`).join('\n');
  }
  return {
    kind,
    title: spec.title ?? '',
    xLabel: spec.xLabel ?? '',
    yLabel: spec.yLabel ?? '',
    seriesName: s?.name ?? '',
    color: s?.color ?? '#0072B2',
    dataText,
    row: String(row),
    col: String(col),
  };
}

function exportLabel(format: FigureExportFormat): string {
  if (format === 'png600') return 'PNG (600 dpi)';
  return format.toUpperCase();
}

export default function FigureStudioPage() {
  const t = useT();

  const notify = useAppStore((s) => s.notify);
  const project = useProjectStore((s) => s.project);
  const activeSheetId = useFigureStore((s) => s.activeSheetId);
  const setActive = useFigureStore((s) => s.setActive);
  const createSheet = useFigureStore((s) => s.createSheet);
  const deleteSheet = useFigureStore((s) => s.deleteSheet);
  const updateSheet = useFigureStore((s) => s.updateSheet);
  const addPanel = useFigureStore((s) => s.addPanel);
  const updatePanel = useFigureStore((s) => s.updatePanel);
  const removePanel = useFigureStore((s) => s.removePanel);
  const exportSheet = useFigureStore((s) => s.exportSheet);

  const sheets = project?.state.figureSheets ?? [];
  const active = sheets.find((s) => s.id === activeSheetId) ?? sheets[0] ?? null;

  useEffect(() => {
    if (active && active.id !== activeSheetId) setActive(active.id);
  }, [active, activeSheetId, setActive]);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<PanelDraft>(EMPTY_DRAFT);

  const composed = useMemo(() => {
    if (!active) return null;
    return composeFigure({
      panels: active.panels,
      templateId: active.templateId,
      caption: active.caption,
    });
  }, [active?.panels, active?.templateId, active?.caption]);

  const openAdd = () => {
    setEditIndex(null);
    setDraft(EMPTY_DRAFT);
    setEditorOpen(true);
  };

  const openEdit = (index: number) => {
    if (!active) return;
    const panel = active.panels[index];
    if (!panel) return;
    setEditIndex(index);
    setDraft(draftFromSpec(panel.spec, panel.row, panel.col));
    setEditorOpen(true);
  };

  const savePanel = () => {
    if (!active) return;
    const spec = buildPanelSpec(draft);
    if (!spec) {
      notify('error', t('figure.panel_data_invalid'));
      return;
    }
    const row = draft.row === '' ? undefined : Math.max(0, Math.floor(Number(draft.row) || 0));
    const col = draft.col === '' ? undefined : Math.max(0, Math.floor(Number(draft.col) || 0));
    const placement = {
      ...(row !== undefined ? { row } : {}),
      ...(col !== undefined ? { col } : {}),
    };
    if (editIndex === null) addPanel(active.id, spec, placement);
    else updatePanel(active.id, editIndex, spec, placement);
    setEditorOpen(false);
  };

  const handleExport = async (format: FigureExportFormat) => {
    if (!active) return;
    try {
      await exportSheet(active.id, format);
      notify('success', t('figure.exported', { format: exportLabel(format) }));
    } catch (err) {
      notify('error', t('figure.export_failed', { reason: String(err) }));
    }
  };

  const [deleteSheetOpen, setDeleteSheetOpen] = useState(false);
  const handleDeleteSheet = () => setDeleteSheetOpen(true);
  const confirmDeleteSheet = () => {
    if (active) deleteSheet(active.id);
  };

  const sheetActions =
    project && sheets.length > 0 ? (
      <>
        <select
          className="input figures-sheet-select"
          value={active?.id ?? ''}
          aria-label={t('figure.sheets')}
          onChange={(e) => setActive(e.target.value)}
        >
          {sheets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-sm" onClick={() => createSheet()}>
          + {t('figure.new_sheet')}
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={handleDeleteSheet}>
          {t('figure.delete_sheet')}
        </button>
      </>
    ) : null;

  return (
    <ToolShell toolId="figures" headerExtra={sheetActions}>
      {project && sheets.length === 0 && (
        <div className="empty-hint">
          {t('figure.no_sheets')}
          <div>
            <button type="button" className="btn btn-primary" onClick={() => createSheet()}>
              + {t('figure.new_sheet')}
            </button>
          </div>
        </div>
      )}

      {active && (
        <div className="figures-main">
          <aside className="figures-side">
            <div className="figures-field">
              <label className="figures-label" htmlFor="figure-name">
                {t('project.name')}
              </label>
              <input
                id="figure-name"
                className="input"
                value={active.name}
                onChange={(e) => updateSheet(active.id, { name: e.target.value })}
              />
            </div>

            <div className="figures-field">
              <label className="figures-label" htmlFor="figure-template">
                {t('figure.template')}
              </label>
              <select
                id="figure-template"
                className="input"
                value={active.templateId}
                onChange={(e) => updateSheet(active.id, { templateId: e.target.value })}
              >
                {JOURNAL_TEMPLATES.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="figures-side-header">
              <h2 className="figures-subtitle">
                {t('figure.panels')} ({active.panels.length})
              </h2>
              <button type="button" className="btn btn-sm btn-primary" onClick={openAdd}>
                + {t('figure.add_panel')}
              </button>
            </div>

            {active.panels.length === 0 && (
              <div className="empty-hint">{t('figure.empty')}</div>
            )}

            <ul className="figures-panel-list">
              {active.panels.map((panel, index) => {
                const tag = panel.tag ?? String.fromCharCode(97 + index);
                const kind = panel.spec.series[0]?.kind ?? '';
                const name = panel.spec.series[0]?.name ?? '';
                return (
                  <li key={index} className="figures-panel-item">
                    <span className="figures-panel-tag">{tag}</span>
                    <div className="figures-panel-info">
                      <div className="figures-panel-name" title={panel.spec.title || name}>
                        {panel.spec.title || name || kind}
                      </div>
                      <div className="figures-panel-meta">
                        {kind} · {t('figure.panel_row')} {panel.row} · {t('figure.panel_col')} {panel.col}
                      </div>
                    </div>
                    <div className="figures-panel-actions">
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => openEdit(index)}
                      >
                        {t('figure.edit')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-danger"
                        onClick={() => removePanel(active.id, index)}
                      >
                        {t('common.delete')}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </aside>

          <section className="figures-stage">
            <div className="figures-preview" aria-label={t('figure.preview')}>
              {composed && (
                <div
                  className="figures-preview-svg"
                  // Composed figure markup is fully generated by the core
                  // renderer (numeric layout + escaped text) — safe to inject.
                  dangerouslySetInnerHTML={{ __html: composed.markup }}
                />
              )}
              {active.panels.length === 0 && (
                <div className="empty-hint">{t('figure.empty')}</div>
              )}
            </div>

            <div className="figures-field">
              <label className="figures-label" htmlFor="figure-caption">
                {t('figure.caption')}
              </label>
              <textarea
                id="figure-caption"
                className="input figures-caption"
                rows={3}
                placeholder={t('figure.caption_placeholder')}
                value={active.caption}
                onChange={(e) => updateSheet(active.id, { caption: e.target.value })}
              />
            </div>

            <div className="figures-export">
              <span className="figures-label">{t('figure.export')}</span>
              {(['svg', 'pdf', 'png600'] as FigureExportFormat[]).map((format) => (
                <button
                  key={format}
                  type="button"
                  className="btn btn-sm"
                  disabled={active.panels.length === 0}
                  onClick={() => void handleExport(format)}
                >
                  {exportLabel(format)}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      <Modal
        open={editorOpen}
        title={editIndex === null ? t('figure.add_panel') : t('figure.edit_panel')}
        width={520}
        onClose={() => setEditorOpen(false)}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setEditorOpen(false)}>
              {t('common.cancel')}
            </button>
            <button type="button" className="btn btn-primary" onClick={savePanel}>
              {t('common.ok')}
            </button>
          </>
        }
      >
        <div className="figures-editor">
          <div className="figures-editor-grid">
            <div className="figures-field">
              <label className="figures-label" htmlFor="panel-kind">
                {t('figure.panel_kind')}
              </label>
              <select
                id="panel-kind"
                className="input"
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as PanelKind })}
              >
                <option value="line">{t('figure.kind_line')}</option>
                <option value="scatter">{t('figure.kind_scatter')}</option>
                <option value="histogram">{t('figure.kind_histogram')}</option>
                <option value="bar">{t('figure.kind_bar')}</option>
              </select>
            </div>
            <div className="figures-field">
              <label className="figures-label" htmlFor="panel-title">
                {t('figure.panel_title')}
              </label>
              <input
                id="panel-title"
                className="input"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div className="figures-field">
              <label className="figures-label" htmlFor="panel-x">
                {t('figure.panel_xlabel')}
              </label>
              <input
                id="panel-x"
                className="input"
                value={draft.xLabel}
                onChange={(e) => setDraft({ ...draft, xLabel: e.target.value })}
              />
            </div>
            <div className="figures-field">
              <label className="figures-label" htmlFor="panel-y">
                {t('figure.panel_ylabel')}
              </label>
              <input
                id="panel-y"
                className="input"
                value={draft.yLabel}
                onChange={(e) => setDraft({ ...draft, yLabel: e.target.value })}
              />
            </div>
            <div className="figures-field">
              <label className="figures-label" htmlFor="panel-name">
                {t('figure.panel_name')}
              </label>
              <input
                id="panel-name"
                className="input"
                value={draft.seriesName}
                onChange={(e) => setDraft({ ...draft, seriesName: e.target.value })}
              />
            </div>
            <div className="figures-field">
              <label className="figures-label" htmlFor="panel-color">
                {t('figure.panel_color')}
              </label>
              <input
                id="panel-color"
                type="color"
                className="input figures-color"
                value={draft.color}
                onChange={(e) => setDraft({ ...draft, color: e.target.value })}
              />
            </div>
            <div className="figures-field figures-field-small">
              <label className="figures-label" htmlFor="panel-row">
                {t('figure.panel_row')}
              </label>
              <input
                id="panel-row"
                type="number"
                min={0}
                className="input"
                placeholder="0"
                value={draft.row}
                onChange={(e) => setDraft({ ...draft, row: e.target.value })}
              />
            </div>
            <div className="figures-field figures-field-small">
              <label className="figures-label" htmlFor="panel-col">
                {t('figure.panel_col')}
              </label>
              <input
                id="panel-col"
                type="number"
                min={0}
                className="input"
                placeholder="0"
                value={draft.col}
                onChange={(e) => setDraft({ ...draft, col: e.target.value })}
              />
            </div>
          </div>

          <div className="figures-field">
            <label className="figures-label" htmlFor="panel-data">
              {t('figure.panel_data')}
            </label>
            <textarea
              id="panel-data"
              className="input figures-data"
              rows={7}
              placeholder={'0,1\n1,2.5\n2,4.1'}
              value={draft.dataText}
              onChange={(e) => setDraft({ ...draft, dataText: e.target.value })}
            />
            <span className="figures-field-hint">{t('figure.panel_data_hint')}</span>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deleteSheetOpen}
        title={t('figure.delete_sheet')}
        message={t('figure.delete_confirm', { name: active?.name ?? '' })}
        confirmLabel={t('common.delete')}
        onConfirm={confirmDeleteSheet}
        onClose={() => setDeleteSheetOpen(false)}
      />
    </ToolShell>
  );
}
