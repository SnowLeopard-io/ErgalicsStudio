// ==========================================================================
// Ergalics Studio — Online Tabular Data Editor (Lazy Chunk)
//
// Full-featured scientific spreadsheet editor driven by `TabularDataSchema`:
//  - Schema-labelled headers with required `*`, type badge, unit, hover rules
//  - Incremental Zod row validation (red cell highlight + localized tooltips)
//  - Excel / WPS / CSV multi-cell clipboard block paste (atomic undo step)
//  - Undo / Redo stack (Ctrl+Z / Ctrl+Y) + keyboard cell navigation
//  - Windowed row rendering for large tables (60 FPS scrolling)
//  - 300ms debounced Live-Sync to active plugin canvas + ScienceOutputStrip
//  - Save-back to global project data (Overwrite or Save As) with VFS sync
// ==========================================================================

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type UIEvent,
} from 'react';
import { useLocale } from '@/i18n';
import type { DataValidationIssue, TabularDataSchema, TabularRow } from '@ergalics/plugin-sdk/types';
import {
  columnLabel,
  extractTabularColumns,
  type TabularColumnDescriptor,
} from '@/core/data-schema/presets';
import { parseRawTabularText, serializeTabularRows } from '@/core/data-schema/column-mapper';
import { compileTabularRowToZod } from '@/core/data-schema/json-to-zod';
import { formatZodIssues } from '@/core/data-schema/error-l10n';
import { splitDelimitedLine } from '@ergalics/sci-kernels/io/delimited';
import { downloadText } from '@ergalics/plugin-sdk/plot';
import { useDataEditorStore, type DataEditorSession } from '@/stores/dataEditorStore';
import { usePluginStore } from '@/stores/pluginStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';

interface GridState {
  columns: string[];
  rows: string[][];
}

const MAX_UNDO = 60;
const ROW_HEIGHT = 30;
const VIRTUAL_THRESHOLD = 150;

function parseInitialGrid(text: string, schema: TabularDataSchema | null): GridState {
  const schemaCols = schema ? extractTabularColumns(schema).map((c) => c.key) : [];
  const parsed = parseRawTabularText(text, schema ?? undefined);

  if (schema && schemaCols.length > 0) {
    if (parsed.rows.length === 0) {
      const sample = schema.sampleRows.map((r) =>
        schemaCols.map((k) => (r[k] === undefined || r[k] === null ? '' : String(r[k]))),
      );
      return { columns: [...schemaCols], rows: sample.length ? sample : [schemaCols.map(() => '')] };
    }
    const headerIdx = new Map<string, number>();
    parsed.headers.forEach((h, i) => headerIdx.set(h, i));
    // Preserve extra columns if allowed by schema
    const columns = [...schemaCols];
    if (schema.allowExtraColumns) {
      for (const h of parsed.headers) {
        if (!columns.includes(h)) columns.push(h);
      }
    }
    const rows = parsed.rows.map((r) =>
      columns.map((col, colPos) => {
        const idx = headerIdx.get(col);
        if (idx !== undefined) return r[idx] ?? '';
        // Positional fallback when raw file was headerless or mismatched
        return parsed.headerless ? (r[colPos] ?? '') : '';
      }),
    );
    return { columns, rows };
  }

  // Schema-less raw CSV editing
  if (parsed.headers.length === 0) {
    return { columns: ['col_1', 'col_2'], rows: [['', '']] };
  }
  return {
    columns: parsed.headers,
    rows: parsed.rows.length > 0 ? parsed.rows : [parsed.headers.map(() => '')],
  };
}

function serializeGrid(grid: GridState, schema: TabularDataSchema | null): string {
  if (schema) {
    const objs: TabularRow[] = grid.rows.map((row) => {
      const obj: TabularRow = {};
      grid.columns.forEach((col, i) => {
        obj[col] = row[i] ?? '';
      });
      return obj;
    });
    return serializeTabularRows(objs, schema);
  }
  const esc = (v: string) =>
    v.includes(',') || v.includes('"') || v.includes('\n')
      ? `"${v.replace(/"/g, '""')}"`
      : v;
  const lines = [grid.columns.map(esc).join(',')];
  for (const r of grid.rows) {
    lines.push(grid.columns.map((_, i) => esc(r[i] ?? '')).join(','));
  }
  return lines.join('\n');
}

export function TabularDataEditor({ session }: { session: DataEditorSession }) {
  const { locale } = useLocale();
  const zh = locale.toLowerCase().startsWith('zh');
  const schema = session.schema?.kind === 'tabular' ? session.schema : null;

  const updateEditorDraftText = useDataEditorStore((s) => s.updateEditorDraftText);
  const markEditorSaved = useDataEditorStore((s) => s.markEditorSaved);
  const ingestForPlugin = useDataEditorStore((s) => s.ingestForPlugin);
  const notify = useAppStore((s) => s.notify);

  const [grid, setGrid] = useState<GridState>(() => parseInitialGrid(session.text, schema));
  const [undoStack, setUndoStack] = useState<GridState[]>([]);
  const [redoStack, setRedoStack] = useState<GridState[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saveAsMode, setSaveAsMode] = useState(false);
  const [saveAsName, setSaveAsName] = useState(session.fileName);
  const [saving, setSaving] = useState(false);
  const [errorCursor, setErrorCursor] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(() =>
    session.focusRow ? { row: Math.max(0, session.focusRow - 1), col: 0 } : null,
  );
  const tableWrapRef = useRef<HTMLDivElement>(null);
  const liveSyncTimerRef = useRef<number | null>(null);
  const initializedKeyRef = useRef(session.sessionKey);

  // Reset grid only when a brand-new editing session starts (NOT when toggling docked <-> modal!).
  useEffect(() => {
    if (initializedKeyRef.current !== session.sessionKey) {
      initializedKeyRef.current = session.sessionKey;
      setGrid(parseInitialGrid(session.text, schema));
      setUndoStack([]);
      setRedoStack([]);
      setDirty(false);
      setSaveAsMode(false);
      setSaveAsName(session.fileName);
      setActiveCell(session.focusRow ? { row: Math.max(0, session.focusRow - 1), col: 0 } : null);
    }
  }, [session.sessionKey, session.text, session.fileName, session.focusRow, schema]);

  const colDescriptors = useMemo(() => {
    const map = new Map<string, TabularColumnDescriptor>();
    if (schema) {
      for (const c of extractTabularColumns(schema)) map.set(c.key, c);
    }
    return map;
  }, [schema]);

  // Compile Zod row validator once per schema.
  const rowZod = useMemo(() => (schema ? compileTabularRowToZod(schema) : null), [schema]);

  // Incremental / full row validation (capped at 200 issues for fast UI).
  const validation = useMemo(() => {
    if (!schema || !rowZod) {
      return { issues: [] as DataValidationIssue[], cellErrors: new Map<string, string>() };
    }
    const issues: DataValidationIssue[] = [];
    const cellErrors = new Map<string, string>();
    for (let r = 0; r < grid.rows.length; r += 1) {
      const rowArr = grid.rows[r]!;
      const rawObj: Record<string, string> = {};
      grid.columns.forEach((col, cIdx) => {
        rawObj[col] = rowArr[cIdx] ?? '';
      });
      const res = rowZod.safeParse(rawObj);
      if (!res.success) {
        const rowIssues = formatZodIssues(res.error.issues, {
          row: r + 1,
          rootSchema: schema.rowSchema,
          locale,
          rawValue: rawObj,
        });
        for (const iss of rowIssues) {
          const cellKey = `${r}:${iss.field}`;
          if (!cellErrors.has(cellKey)) cellErrors.set(cellKey, iss.message);
          if (issues.length < 200) issues.push(iss);
        }
      }
    }
    if (schema.minRows !== undefined && grid.rows.length < schema.minRows) {
      issues.unshift({
        row: null,
        field: '(table)',
        fieldLabel: schema.titleI18n?.[locale] ?? schema.title,
        code: 'table.min_rows',
        severity: 'error',
        message: zh
          ? `至少需要 ${schema.minRows} 行数据（当前 ${grid.rows.length} 行）`
          : `Requires at least ${schema.minRows} rows (currently ${grid.rows.length})`,
      });
    }
    return { issues, cellErrors };
  }, [grid, schema, rowZod, locale, zh]);

  const commitGrid = useCallback(
    (next: GridState, recordUndo = true) => {
      if (recordUndo) {
        setUndoStack((prev) => [...prev.slice(-(MAX_UNDO - 1)), grid]);
        setRedoStack([]);
      }
      setGrid(next);
      setDirty(true);
      updateEditorDraftText(serializeGrid(next, schema));
    },
    [grid, schema, updateEditorDraftText],
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1]!;
      setRedoStack((r) => [...r, grid]);
      setGrid(last);
      updateEditorDraftText(serializeGrid(last, schema));
      return prev.slice(0, -1);
    });
  }, [grid, schema, updateEditorDraftText]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1]!;
      setUndoStack((u) => [...u, grid]);
      setGrid(next);
      updateEditorDraftText(serializeGrid(next, schema));
      return prev.slice(0, -1);
    });
  }, [grid, schema, updateEditorDraftText]);

  // 300ms debounced Live-Sync into the active plugin whenever valid edits happen.
  useEffect(() => {
    if (!dirty || !session.liveSync || !session.pluginId) return;
    if (validation.issues.length > 0) return;

    if (liveSyncTimerRef.current !== null) window.clearTimeout(liveSyncTimerRef.current);
    liveSyncTimerRef.current = window.setTimeout(() => {
      liveSyncTimerRef.current = null;
      const csv = serializeGrid(grid, schema);
      void ingestForPlugin({
        pluginId: session.pluginId!,
        schemaId: schema?.id,
        fileName: session.fileName,
        text: csv,
        origin: 'online-editor',
        fileId: session.fileId,
        silent: true,
      });
    }, 300);

    return () => {
      if (liveSyncTimerRef.current !== null) window.clearTimeout(liveSyncTimerRef.current);
    };
  }, [
    dirty,
    grid,
    schema,
    session.liveSync,
    session.pluginId,
    session.fileName,
    session.fileId,
    validation.issues.length,
    ingestForPlugin,
  ]);

  const updateCell = (rowIdx: number, colIdx: number, value: string) => {
    const nextRows = grid.rows.map((r, i) => {
      if (i !== rowIdx) return r;
      const copy = [...r];
      while (copy.length < grid.columns.length) copy.push('');
      copy[colIdx] = value;
      return copy;
    });
    commitGrid({ ...grid, rows: nextRows });
  };

  const handleAddRow = () => {
    const empty = grid.columns.map(() => '');
    commitGrid({ ...grid, rows: [...grid.rows, empty] });
  };

  const handleDeleteRow = (rowIdx: number) => {
    const nextRows = grid.rows.filter((_, i) => i !== rowIdx);
    commitGrid({ ...grid, rows: nextRows.length ? nextRows : [grid.columns.map(() => '')] });
  };

  const handleAddColumn = () => {
    const name = `col_${grid.columns.length + 1}`;
    commitGrid({
      columns: [...grid.columns, name],
      rows: grid.rows.map((r) => [...r, '']),
    });
  };

  const handleFillSample = () => {
    if (!schema) return;
    const sampleText = serializeTabularRows(schema.sampleRows, schema);
    commitGrid(parseInitialGrid(sampleText, schema));
  };

  const handleClear = () => {
    commitGrid({ columns: [...grid.columns], rows: [grid.columns.map(() => '')] });
  };

  // Excel / WPS / CSV multi-cell block paste support.
  const handleCellPaste = (
    e: ClipboardEvent<HTMLInputElement | HTMLSelectElement>,
    startRow: number,
    startCol: number,
  ) => {
    const clip = e.clipboardData.getData('text/plain');
    if (!clip || (!clip.includes('\n') && !clip.includes('\t'))) return;
    e.preventDefault();

    const lines = clip
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .split('\n')
      .filter((l, idx, arr) => !(idx === arr.length - 1 && l === ''));

    const delim = lines.some((l) => l.includes('\t')) ? '\t' : ',';
    const pasted = lines.map((l) => splitDelimitedLine(l, delim).map((c) => c.trim()));
    if (pasted.length === 0) return;

    const neededRows = startRow + pasted.length;
    const nextRows = grid.rows.map((r) => [...r]);
    while (nextRows.length < neededRows) {
      nextRows.push(grid.columns.map(() => ''));
    }

    for (let dr = 0; dr < pasted.length; dr += 1) {
      const srcRow = pasted[dr]!;
      const dstRow = nextRows[startRow + dr]!;
      while (dstRow.length < grid.columns.length) dstRow.push('');
      for (let dc = 0; dc < srcRow.length; dc += 1) {
        const cIdx = startCol + dc;
        if (cIdx < grid.columns.length) {
          dstRow[cIdx] = srcRow[dc] ?? '';
        }
      }
    }
    commitGrid({ ...grid, rows: nextRows });
    notify(
      'info',
      zh
        ? `已粘贴 ${pasted.length} 行数据（Ctrl+Z 可撤销）`
        : `Pasted ${pasted.length} row(s) (Ctrl+Z to undo)`,
    );
  };

  const handleCellKeyDown = (
    e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    rowIdx: number,
    colIdx: number,
  ) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) handleRedo();
      else handleUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      handleRedo();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const nextRow = e.shiftKey ? Math.max(0, rowIdx - 1) : rowIdx + 1;
      if (nextRow >= grid.rows.length) handleAddRow();
      setActiveCell({ row: nextRow, col: colIdx });
    }
  };

  const handleApplyToPlugin = async () => {
    if (!session.pluginId) return;
    const csv = serializeGrid(grid, schema);
    await ingestForPlugin({
      pluginId: session.pluginId,
      schemaId: schema?.id,
      fileName: session.fileName,
      text: csv,
      origin: 'online-editor',
      fileId: session.fileId,
    });
  };

  const handleSaveToProject = async (mode: 'overwrite' | 'save-as') => {
    setSaving(true);
    try {
      const csv = serializeGrid(grid, schema);
      const projectStore = useProjectStore.getState();
      if (!projectStore.project) {
        const prevActiveId = usePluginStore.getState().activeId ?? session.pluginId;
        await projectStore.createProject('');
        if (prevActiveId && usePluginStore.getState().activeId !== prevActiveId) {
          await usePluginStore.getState().activate(prevActiveId);
          useAppStore.getState().showPluginCanvas();
        }
      }

      if (mode === 'overwrite' && session.fileId && session.origin === 'project-file') {
        const ok = await useProjectStore
          .getState()
          .updateDataFile(session.fileId, csv, session.pluginId ?? undefined);
        if (ok) {
          markEditorSaved(session.fileId, session.fileName, csv);
          setDirty(false);
          if (session.pluginId) {
            await ingestForPlugin({
              pluginId: session.pluginId,
              schemaId: schema?.id,
              fileName: session.fileName,
              text: csv,
              origin: 'project-file',
              fileId: session.fileId,
              silent: true,
            });
          }
          notify('success', zh ? `已覆盖保存 ${session.fileName}` : `Saved ${session.fileName}`);
        }
        return;
      }

      const rawName = saveAsName.trim() || session.fileName || 'table-data.csv';
      const finalName = rawName.includes('.') ? rawName : `${rawName}.csv`;
      const file = new File([csv], finalName, { type: 'text/csv' });
      const newId = await useProjectStore.getState().addDataFile(file);
      if (newId) {
        markEditorSaved(newId, finalName, csv);
        setDirty(false);
        setSaveAsMode(false);
        if (session.pluginId) {
          await ingestForPlugin({
            pluginId: session.pluginId,
            schemaId: schema?.id,
            fileName: finalName,
            text: csv,
            origin: 'project-file',
            fileId: newId,
            silent: true,
          });
        }
        notify('success', zh ? `已保存到项目数据：${finalName}` : `Saved to project: ${finalName}`);
      }
    } catch (err) {
      notify(
        'error',
        `${zh ? '保存失败：' : 'Save failed: '}${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setSaving(false);
    }
  };

  const jumpToError = (delta: number) => {
    const rowIssues = validation.issues.filter((i) => i.row !== null);
    if (rowIssues.length === 0) return;
    const nextIdx = (errorCursor + delta + rowIssues.length) % rowIssues.length;
    setErrorCursor(nextIdx);
    const target = rowIssues[nextIdx]!;
    const rIdx = Math.max(0, (target.row ?? 1) - 1);
    const cIdx = Math.max(0, grid.columns.indexOf(target.field));
    setActiveCell({ row: rIdx, col: cIdx });
    if (tableWrapRef.current) {
      tableWrapRef.current.scrollTop = Math.max(0, rIdx * ROW_HEIGHT - 60);
    }
  };

  // Virtual windowing for large tables (> 150 rows).
  const isVirtual = grid.rows.length > VIRTUAL_THRESHOLD;
  const viewHeight = 360;
  const overscan = 10;
  const firstRow = isVirtual ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - overscan) : 0;
  const lastRow = isVirtual
    ? Math.min(grid.rows.length, firstRow + Math.ceil(viewHeight / ROW_HEIGHT) + overscan * 2)
    : grid.rows.length;
  const visibleRows = grid.rows.slice(firstRow, lastRow);
  const topPad = firstRow * ROW_HEIGHT;
  const bottomPad = Math.max(0, (grid.rows.length - lastRow) * ROW_HEIGHT);

  const onTableScroll = (e: UIEvent<HTMLDivElement>) => {
    if (isVirtual) setScrollTop(e.currentTarget.scrollTop);
  };

  const canOverwrite = Boolean(session.fileId && session.origin === 'project-file');
  const hasErrors = validation.issues.length > 0;

  return (
    <div className="pds-editor-surface">
      {/* Toolbar */}
      <div className="pds-editor-toolbar">
        <div className="pds-editor-toolbar-group">
          <button type="button" className="btn btn-xs" onClick={handleAddRow}>
            {zh ? '+ 添加行' : '+ Row'}
          </button>
          {(!schema || schema.allowExtraColumns) && (
            <button type="button" className="btn btn-xs" onClick={handleAddColumn}>
              {zh ? '+ 添加列' : '+ Col'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-xs"
            disabled={undoStack.length === 0}
            title="Ctrl+Z"
            onClick={handleUndo}
          >
            {zh ? '撤销' : 'Undo'}
          </button>
          <button
            type="button"
            className="btn btn-xs"
            disabled={redoStack.length === 0}
            title="Ctrl+Y"
            onClick={handleRedo}
          >
            {zh ? '重做' : 'Redo'}
          </button>
          {schema && (
            <button type="button" className="btn btn-xs" onClick={handleFillSample}>
              {zh ? '填充示例' : 'Sample'}
            </button>
          )}
          <button type="button" className="btn btn-xs" onClick={handleClear}>
            {zh ? '清空' : 'Clear'}
          </button>
        </div>

        <div className="pds-editor-toolbar-group">
          <span className="pds-paste-hint">
            {zh ? '支持从 Excel/CSV 直接 Ctrl+V 块粘贴' : 'Supports Excel/CSV Ctrl+V block paste'}
          </span>
          <button
            type="button"
            className="btn btn-xs"
            onClick={() => downloadText(serializeGrid(grid, schema), session.fileName, 'text/csv')}
          >
            {zh ? '↓ 导出 CSV' : '↓ Export CSV'}
          </button>
        </div>
      </div>

      {/* Spreadsheet Grid */}
      <div
        ref={tableWrapRef}
        className="pds-sheet-wrap"
        onScroll={onTableScroll}
      >
        <table className="pds-sheet-table">
          <thead>
            <tr>
              <th className="pds-sheet-rowhead">#</th>
              {grid.columns.map((colKey) => {
                const desc = colDescriptors.get(colKey);
                const label = desc ? columnLabel(desc, locale) : colKey;
                return (
                  <th key={colKey} title={desc?.schema.description ?? colKey}>
                    <div className="pds-sheet-th">
                      <span className="pds-sheet-th-label">
                        {label}
                        {desc?.required && <span className="pds-req">*</span>}
                      </span>
                      <span className="pds-sheet-th-meta">
                        <code>{colKey}</code>
                        {desc ? ` · ${desc.displayType}` : ''}
                        {desc?.meta.unit ? ` (${desc.meta.unit})` : ''}
                      </span>
                    </div>
                  </th>
                );
              })}
              <th className="pds-sheet-delhead" aria-label={zh ? '操作' : 'Action'} />
            </tr>
          </thead>
          <tbody>
            {topPad > 0 && (
              <tr aria-hidden="true" style={{ height: topPad }}>
                <td colSpan={grid.columns.length + 2} style={{ padding: 0, border: 'none' }} />
              </tr>
            )}
            {visibleRows.map((row, localIdx) => {
              const rIdx = firstRow + localIdx;
              const rowHasErr = grid.columns.some((c) => validation.cellErrors.has(`${rIdx}:${c}`));
              return (
                <tr key={rIdx} className={rowHasErr ? 'is-row-invalid' : undefined}>
                  <td className="pds-sheet-rowhead">
                    {rowHasErr && <span className="pds-row-err-dot" aria-hidden="true" />}
                    {rIdx + 1}
                  </td>
                  {grid.columns.map((colKey, cIdx) => {
                    const desc = colDescriptors.get(colKey);
                    const cellErr = validation.cellErrors.get(`${rIdx}:${colKey}`);
                    const val = row[cIdx] ?? '';
                    const isFocused = activeCell?.row === rIdx && activeCell?.col === cIdx;
                    const enumVals = desc?.schema.enum;

                    return (
                      <td
                        key={colKey}
                        className={[
                          'pds-sheet-cell',
                          cellErr ? 'is-invalid' : '',
                          isFocused ? 'is-focused' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        title={cellErr}
                      >
                        {enumVals && enumVals.length > 0 ? (
                          <select
                            className="pds-cell-input"
                            value={val}
                            onFocus={() => setActiveCell({ row: rIdx, col: cIdx })}
                            onChange={(e) => updateCell(rIdx, cIdx, e.target.value)}
                            onPaste={(e) => handleCellPaste(e, rIdx, cIdx)}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, cIdx)}
                          >
                            <option value="">—</option>
                            {enumVals.map((opt) => (
                              <option key={String(opt)} value={String(opt)}>
                                {String(opt)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            className="pds-cell-input"
                            aria-label={`R${rIdx + 1}C${cIdx + 1}`}
                            value={val}
                            onFocus={() => setActiveCell({ row: rIdx, col: cIdx })}
                            onChange={(e) => updateCell(rIdx, cIdx, e.target.value)}
                            onPaste={(e) => handleCellPaste(e, rIdx, cIdx)}
                            onKeyDown={(e) => handleCellKeyDown(e, rIdx, cIdx)}
                          />
                        )}
                      </td>
                    );
                  })}
                  <td className="pds-sheet-delcell">
                    <button
                      type="button"
                      className="icon-btn"
                      title={zh ? '删除该行' : 'Delete row'}
                      onClick={() => handleDeleteRow(rIdx)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              );
            })}
            {bottomPad > 0 && (
              <tr aria-hidden="true" style={{ height: bottomPad }}>
                <td colSpan={grid.columns.length + 2} style={{ padding: 0, border: 'none' }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer: status + error jump + apply / save-back */}
      <div className="pds-editor-footer">
        <div className="pds-editor-status">
          <span>
            {zh
              ? `共 ${grid.rows.length} 行 · ${grid.columns.length} 列`
              : `${grid.rows.length} rows · ${grid.columns.length} cols`}
          </span>
          {hasErrors ? (
            <span className="pds-status-err">
              ⚠ {zh ? `${validation.issues.length} 处错误` : `${validation.issues.length} error(s)`}
              <button type="button" className="btn btn-xs" onClick={() => jumpToError(-1)}>
                ↑
              </button>
              <button type="button" className="btn btn-xs" onClick={() => jumpToError(1)}>
                ↓
              </button>
              <span className="pds-status-err-msg">
                {validation.issues[Math.min(errorCursor, validation.issues.length - 1)]?.message}
              </span>
            </span>
          ) : (
            <span className="pds-status-ok">
              ✓ {zh ? '校验通过' : 'Valid'}
            </span>
          )}
        </div>

        <div className="pds-editor-actions">
          {saveAsMode ? (
            <span className="pds-saveas-inline">
              <input
                type="text"
                className="input pds-saveas-input"
                value={saveAsName}
                placeholder="data.csv"
                onChange={(e) => setSaveAsName(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-xs btn-primary"
                disabled={saving}
                onClick={() => void handleSaveToProject('save-as')}
              >
                {zh ? '确认保存' : 'Save'}
              </button>
              <button
                type="button"
                className="btn btn-xs"
                onClick={() => setSaveAsMode(false)}
              >
                {zh ? '取消' : 'Cancel'}
              </button>
            </span>
          ) : (
            <>
              {canOverwrite && (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={hasErrors || saving}
                  onClick={() => void handleSaveToProject('overwrite')}
                >
                  {zh ? '覆盖原文件' : 'Overwrite File'}
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                disabled={hasErrors || saving}
                onClick={() => {
                  setSaveAsName(session.fileName);
                  setSaveAsMode(true);
                }}
              >
                {canOverwrite
                  ? zh
                    ? '另存为项目文件'
                    : 'Save As…'
                  : zh
                    ? '保存到项目数据'
                    : 'Save to Project'}
              </button>
              {session.pluginId && (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={hasErrors}
                  onClick={() => void handleApplyToPlugin()}
                >
                  {zh ? '应用到插件' : 'Apply to Plugin'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
