// ==========================================================================
// Ergalics Studio — console panel (block/code mode)
//
// Shows stdout/stderr from the last run (studio.print and errors).
// ==========================================================================

import { useT } from '@/i18n';
import { useEditorStore } from '@/stores/editorStore';

export function ConsolePanel() {
  const t = useT();
  const entries = useEditorStore((s) => s.console);
  const error = useEditorStore((s) => s.error);

  return (
    <div className="editor-panel editor-console">
      <div className="editor-panel-title">{t('editor.console.title')}</div>
      <div className="editor-panel-body">
        {entries.length === 0 && !error ? (
          <div className="editor-panel-empty">{t('blocks.preview.empty')}</div>
        ) : (
          <>
            {entries.map((e, i) => (
              <div key={i} className={`editor-console-line is-${e.stream}`}>
                {e.text}
              </div>
            ))}
            {error && <div className="editor-console-line is-stderr">{error}</div>}
          </>
        )}
      </div>
    </div>
  );
}
