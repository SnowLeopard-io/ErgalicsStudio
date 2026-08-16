// ==========================================================================
// Ergalics Studio — variable panel (block/code mode)
//
// Shows the top-level variable snapshot produced by the last run. Values are
// DataValue: DataTable → row×col summary, Scalar → inline value, RenderedView
// → a marker. Mirrors block-code-modes.md §9.3.
// ==========================================================================

import { useT } from '@/i18n';
import { useEditorStore } from '@/stores/editorStore';
import { isDataTable, isRenderedView, isScalar } from '@/types/datatable';

export function VariablePanel() {
  const t = useT();
  const variables = useEditorStore((s) => s.variables);
  const names = Object.keys(variables);

  return (
    <div className="editor-panel editor-vars">
      <div className="editor-panel-title">{t('editor.variables.title')}</div>
      <div className="editor-panel-body">
        {names.length === 0 ? (
          <div className="editor-panel-empty">{t('blocks.preview.empty')}</div>
        ) : (
          names.map((name) => {
            const value = variables[name];
            return (
              <div key={name} className="editor-var-row">
                <span className="editor-var-name">{name}</span>
                <span className="editor-var-value">
                  {isScalar(value) ? (
                    String(value.value)
                  ) : isDataTable(value) ? (
                    `${value.length} × ${value.columns.length}`
                  ) : isRenderedView(value) ? (
                    '🖼'
                  ) : (
                    String(value)
                  )}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
