// ==========================================================================
// Ergalics Studio — console panel (block/code mode)
//
// Shows stdout/stderr from the last run (studio.print and errors).
// Stream markers are SVG glyphs rather than Unicode symbols: a bare ⚠/ℹ
// falls through to a CJK serif face on Windows and breaks the mono console.
// ==========================================================================

import { useT } from '@/i18n';
import { useEditorStore } from '@/stores/editorStore';
import { AlertIcon, ChevronRightIcon, InfoIcon, TerminalIcon, TrashIcon } from '@/components/icons';

function StreamIcon({ stream }: { stream: 'stdout' | 'stderr' | 'info' }) {
  if (stream === 'stderr') return <AlertIcon size={12} />;
  if (stream === 'info') return <InfoIcon size={12} />;
  return <ChevronRightIcon size={12} />;
}

export function ConsolePanel() {
  const t = useT();
  const entries = useEditorStore((s) => s.console);
  const error = useEditorStore((s) => s.error);
  const clear = useEditorStore((s) => s.clearConsole);

  return (
    <div className="editor-panel editor-console">
      <div className="editor-panel-head">
        <span className="editor-panel-title">{t('editor.console.title')}</span>
        <span className="editor-panel-actions">
          {entries.length > 0 && (
            <button type="button" className="editor-panel-action" onClick={clear} title={t('common.clear')}>
              <TrashIcon size={12} />
            </button>
          )}
        </span>
      </div>
      <div className="editor-panel-body">
        {entries.length === 0 && !error ? (
          <div className="editor-panel-empty">
            <span className="editor-panel-empty-icon">
              <TerminalIcon size={18} />
            </span>
            <span>{t('blocks.preview.empty')}</span>
          </div>
        ) : (
          <>
            {entries.map((e, i) => (
              <div key={i} className={`editor-console-line is-${e.stream}`}>
                <span className="editor-console-glyph">
                  <StreamIcon stream={e.stream} />
                </span>
                <span className="editor-console-text">{e.text}</span>
              </div>
            ))}
            {error && (
              <div className="editor-console-line is-stderr">
                <span className="editor-console-glyph">
                  <AlertIcon size={12} />
                </span>
                <span className="editor-console-text">{error}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
