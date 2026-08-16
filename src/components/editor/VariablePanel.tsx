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

function summarize(value: import('@/types/datatable').DataValue | undefined): { text: string; kind: 'scalar' | 'table' | 'view' | 'unknown' } {
  if (!value) return { text: 'undefined', kind: 'unknown' };
  if (isScalar(value)) return { text: String(value.value), kind: 'scalar' };
  if (isDataTable(value)) return { text: `${value.length} × ${value.columns.length}`, kind: 'table' };
  if (isRenderedView(value)) return { text: value.viewType, kind: 'view' };
  return { text: String(value), kind: 'unknown' };
}

function icon(kind: 'scalar' | 'table' | 'view' | 'unknown'): string {
  switch (kind) {
    case 'scalar': return '123';
    case 'table': return '▦';
    case 'view': return '◳';
    default: return '○';
  }
}

export function VariablePanel() {
  const t = useT();
  const variables = useEditorStore((s) => s.variables);
  const names = Object.keys(variables);

  return (
    <div className="editor-panel editor-vars">
      <div className="editor-panel-head">
        <span className="editor-panel-title">{t('editor.variables.title')}</span>
        {names.length > 0 && <span className="editor-panel-badge">{names.length}</span>}
      </div>
      <div className="editor-panel-body">
        {names.length === 0 ? (
          <div className="editor-panel-empty">
            <span className="editor-panel-empty-icon">◇</span>
            <span>{t('blocks.preview.empty')}</span>
          </div>
        ) : (
          names.map((name) => {
            const { text, kind } = summarize(variables[name]);
            return (
              <div key={name} className="editor-var-row">
                <span className="editor-var-name">
                  <span className={`editor-var-icon is-${kind}`}>{icon(kind)}</span>
                  {name}
                </span>
                <span className={`editor-var-value is-${kind}`}>{text}</span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}