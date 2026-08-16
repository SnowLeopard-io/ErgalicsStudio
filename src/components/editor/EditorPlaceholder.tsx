// ==========================================================================
// Ergalics Studio — editor placeholder (block/code mode, Phase 0)
//
// Block and Code mode are wired into the TopBar and routing in Phase 0 but
// their editors (Blockly / Monaco) land in Phase 1/2. Until then these modes
// are disabled in the TopBar; this component is a defensive fallback so the
// routing surface is already in place.
// ==========================================================================

import { useT } from '@/i18n';

interface EditorPlaceholderProps {
  mode: 'block' | 'code';
}

export function EditorPlaceholder({ mode }: EditorPlaceholderProps) {
  const t = useT();
  const title = t(`workbench.mode.${mode}`);
  return (
    <div className="editor-placeholder">
      <div className="editor-placeholder-icon">{mode === 'block' ? '🧩' : '⌨'}</div>
      <div className="editor-placeholder-title">{title}</div>
      <div className="editor-placeholder-hint">{t('editor.placeholder.hint')}</div>
    </div>
  );
}
