// ==========================================================================
// Ergalics Studio — Interactive Column Mapping Modal
//
// Shown automatically when an imported tabular file has headers that do not
// match a plugin's TabularDataSchema with high confidence. Lets the user
// assign each required/optional column, preview the first 5 mapped rows with
// live Zod feedback, or switch straight to the online table editor.
// ==========================================================================

import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '@/i18n';
import { Modal } from '@/components/Modal';
import { useDataEditorStore } from '@/stores/dataEditorStore';
import {
  applyColumnMapping,
} from '@/core/data-schema/column-mapper';
import { columnLabel, extractTabularColumns } from '@/core/data-schema/presets';

export function ColumnMappingModal() {
  const { locale } = useLocale();
  const zh = locale.toLowerCase().startsWith('zh');
  const request = useDataEditorStore((s) => s.mappingRequest);
  const closeMapping = useDataEditorStore((s) => s.closeMapping);
  const ingestForPlugin = useDataEditorStore((s) => s.ingestForPlugin);
  const openEditor = useDataEditorStore((s) => s.openEditor);

  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (request) {
      setMapping({ ...request.suggestion.mapping });
    }
  }, [request]);

  const targetCols = useMemo(
    () => (request ? extractTabularColumns(request.schema) : []),
    [request],
  );

  const missingRequired = useMemo(
    () => targetCols.filter((c) => c.required && !mapping[c.key]).map((c) => c.key),
    [targetCols, mapping],
  );

  const previewRows = useMemo(() => {
    if (!request) return [];
    const sliced = { ...request.parsed, rows: request.parsed.rows.slice(0, 5) };
    return applyColumnMapping(sliced, mapping, request.schema);
  }, [request, mapping]);

  if (!request) return null;

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      await ingestForPlugin({
        pluginId: request.pluginId,
        schemaId: request.schema.id,
        fileName: request.fileName,
        text: request.text,
        origin: request.origin,
        fileId: request.fileId,
        columnMapping: mapping,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenEditor = () => {
    openEditor({
      pluginId: request.pluginId,
      schema: request.schema,
      fileName: request.fileName,
      origin: request.origin === 'project-file' ? 'project-file' : 'draft',
      fileId: request.fileId,
      layout: 'docked',
    });
  };

  return (
    <Modal
      open
      onClose={closeMapping}
      title={
        zh
          ? `列映射确认 · ${request.fileName}`
          : `Confirm Column Mapping · ${request.fileName}`
      }
      width={720}
      footer={
        <div className="pds-modal-footer">
          <button type="button" className="btn btn-sm" onClick={handleOpenEditor}>
            {zh ? '✎ 改用在线表格录入' : '✎ Use Online Editor'}
          </button>
          <div className="pds-modal-footer-right">
            <button type="button" className="btn btn-sm" onClick={closeMapping}>
              {zh ? '取消' : 'Cancel'}
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={missingRequired.length > 0 || submitting}
              onClick={() => void handleConfirm()}
            >
              {zh ? '确认映射并载入' : 'Confirm & Load'}
            </button>
          </div>
        </div>
      }
    >
      <div className="pds-mapping-body">
        <p className="pds-desc">
          {zh
            ? `文件「${request.fileName}」包含 ${request.parsed.headers.length} 列、${request.parsed.rows.length} 行数据，请将源列对应到插件要求的字段：`
            : `File "${request.fileName}" has ${request.parsed.headers.length} columns and ${request.parsed.rows.length} rows. Map source columns to the plugin's fields:`}
        </p>

        <div className="pds-mapping-grid">
          {targetCols.map((col) => {
            const label = columnLabel(col, locale);
            const selected = mapping[col.key] ?? '';
            return (
              <div key={col.key} className="pds-mapping-row">
                <div className="pds-mapping-target">
                  <span className="pds-col-key">
                    <strong>{label}</strong>
                    <code>{col.key}</code>
                    {col.required && <span className="pds-req">*</span>}
                  </span>
                  <span className="pds-mapping-hint">
                    {col.displayType}
                    {col.meta.unit ? ` · ${col.meta.unit}` : ''}
                  </span>
                </div>
                <span className="pds-mapping-arrow" aria-hidden="true">
                  ←
                </span>
                <select
                  className="select"
                  aria-label={label}
                  value={selected}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMapping((prev) => {
                      const next = { ...prev };
                      if (!val) delete next[col.key];
                      else next[col.key] = val;
                      return next;
                    });
                  }}
                >
                  <option value="">
                    {col.required
                      ? zh
                        ? '— 请选择源列（必填）—'
                        : '— Select source column (required) —'
                      : zh
                        ? '— 忽略（可选）—'
                        : '— Ignore (optional) —'}
                  </option>
                  {request.suggestion.sourceStats.map((src) => (
                    <option key={src.header} value={src.header}>
                      {src.header} ({src.inferredType}
                      {src.samples.length ? `: ${src.samples.slice(0, 2).join(', ')}` : ''})
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        {missingRequired.length > 0 && (
          <div className="pds-warning-bar">
            {zh
              ? `尚未映射必填列：${missingRequired.join('、')}`
              : `Unmapped required column(s): ${missingRequired.join(', ')}`}
          </div>
        )}

        <div className="pds-preview-section">
          <div className="pds-preview-head">
            {zh ? '映射结果预览（前 5 行）' : 'Mapped Preview (first 5 rows)'}
          </div>
          <div className="pds-preview-wrap">
            <table className="pds-preview-table">
              <thead>
                <tr>
                  <th>#</th>
                  {targetCols.map((col) => (
                    <th key={col.key}>
                      {col.key}
                      {col.required && <span className="pds-req">*</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, rIdx) => (
                  <tr key={rIdx}>
                    <td className="pds-row-num">{rIdx + 1}</td>
                    {targetCols.map((col) => (
                      <td key={col.key}>{row[col.key] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}
