// ==========================================================================
// Ergalics Studio — Structured Data Validation Error Modal
//
// Replaces raw thrown parser exceptions with a row/column addressable
// diagnostics table and one-click actions to either repair the offending
// cells in the online editor or skip invalid rows and proceed.
// ==========================================================================

import { useLocale } from '@/i18n';
import { Modal } from '@/components/Modal';
import { useDataEditorStore } from '@/stores/dataEditorStore';

export function ValidationErrorModal() {
  const { locale } = useLocale();
  const zh = locale.toLowerCase().startsWith('zh');
  const request = useDataEditorStore((s) => s.errorRequest);
  const closeError = useDataEditorStore((s) => s.closeError);
  const openEditor = useDataEditorStore((s) => s.openEditor);
  const ingestForPlugin = useDataEditorStore((s) => s.ingestForPlugin);

  if (!request) return null;

  const firstIssue = request.issues[0];

  const handleOpenInEditor = (row?: number | null, field?: string) => {
    openEditor({
      pluginId: request.pluginId,
      schema: request.schema,
      fileName: request.fileName,
      text: request.text,
      origin: request.origin === 'project-file' ? 'project-file' : 'draft',
      fileId: request.fileId,
      layout: 'modal',
      focusRow: row ?? firstIssue?.row ?? undefined,
      focusField: field ?? firstIssue?.field,
    });
  };

  const handleSkipBadRows = async () => {
    await ingestForPlugin({
      pluginId: request.pluginId,
      schemaId: request.schema.id,
      fileName: request.fileName,
      text: request.text,
      origin: request.origin,
      fileId: request.fileId,
      columnMapping: request.columnMapping,
      skipInvalidRows: true,
    });
  };

  return (
    <Modal
      open
      onClose={closeError}
      title={
        zh
          ? `数据校验未通过 · ${request.fileName}`
          : `Data Validation Failed · ${request.fileName}`
      }
      width={720}
      footer={
        <div className="pds-modal-footer">
          <button type="button" className="btn btn-sm" onClick={closeError}>
            {zh ? '关闭' : 'Close'}
          </button>
          <div className="pds-modal-footer-right">
            {request.canSkipInvalidRows && (
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void handleSkipBadRows()}
              >
                {zh ? '跳过无效行继续载入' : 'Skip Invalid Rows & Load'}
              </button>
            )}
            {request.schema.kind !== 'binary' && (
              <button
                type="button"
                className="btn btn-sm btn-primary"
                onClick={() => handleOpenInEditor()}
              >
                {zh ? '✎ 在在线编辑器中修复' : '✎ Fix in Online Editor'}
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="pds-error-body">
        <div className="pds-error-summary">
          {zh
            ? `共发现 ${request.totalErrorCount} 处不符合「${request.schema.titleI18n?.[locale] ?? request.schema.title}」规范的问题${request.totalErrorCount > request.issues.length ? `（下方仅显示前 ${request.issues.length} 条）` : ''}。点击任意行可直接在在线编辑器中定位修复：`
            : `Found ${request.totalErrorCount} issue(s) against "${request.schema.titleI18n?.[locale] ?? request.schema.title}". Click any row to jump straight into the online editor:`}
        </div>

        <div className="pds-preview-wrap pds-error-table-wrap">
          <table className="pds-preview-table">
            <thead>
              <tr>
                <th>{zh ? '行号' : 'Row'}</th>
                <th>{zh ? '列 / 字段' : 'Field'}</th>
                <th>{zh ? '问题描述' : 'Message'}</th>
                <th>{zh ? '当前值' : 'Actual'}</th>
              </tr>
            </thead>
            <tbody>
              {request.issues.map((issue, idx) => (
                <tr
                  key={`${issue.row ?? 'root'}-${issue.field}-${idx}`}
                  className="pds-error-row"
                  onClick={() => handleOpenInEditor(issue.row, issue.field)}
                >
                  <td className="pds-row-num">{issue.row ?? '—'}</td>
                  <td>
                    <code>{issue.field}</code>
                  </td>
                  <td>{issue.message}</td>
                  <td className="pds-actual-cell">
                    {issue.actual === undefined || issue.actual === ''
                      ? zh
                        ? '（空）'
                        : '(empty)'
                      : String(issue.actual)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
