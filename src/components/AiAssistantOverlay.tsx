// ==========================================================================
// AI assistant project-wide floating window
//
// The assistant panel is rendered here — one floating layer above the whole
// workbench, toggled from the top bar — instead of inside an editor. Keeping
// it out of the editor's flex column means it never steals canvas space from
// Block/Code/Flow. `runCode` is the active editor's hook from aiPanelStore;
// when no runnable editor is mounted (e.g. Flow) the panel still lets the
// user generate and insert a draft, but the Run action falls back to
// insert-only. Esc or the panel's close button dismisses it; there is no
// full-screen dim so the canvas stays interactive.
//
// When closed the panel stays mounted (hidden with `.is-closed`) so the
// conversation survives collapsing; a compact floating ball (`.ai-fab`) is
// shown instead, so the assistant never occupies canvas space until asked.
// ==========================================================================

import { useEffect } from 'react';
import { useT } from '@/i18n';
import { useAiPanelStore } from '@/stores/aiPanelStore';
import { AiAssistantPanel } from './AiAssistantPanel';
import { SparklesIcon } from './icons';

export function AiAssistantOverlay() {
  const t = useT();
  const open = useAiPanelStore((s) => s.open);
  const runHandler = useAiPanelStore((s) => s.runHandler);
  const setOpen = useAiPanelStore((s) => s.setOpen);

  // Esc dismisses the floating window without stealing focus from the canvas.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  return (
    <>
      <div className={`ai-overlay${open ? '' : ' is-closed'}`} aria-hidden={!open}>
        <AiAssistantPanel runCode={runHandler ?? undefined} onClose={() => setOpen(false)} />
      </div>
      {!open && (
        <button
          type="button"
          className="ai-fab"
          title={t('ux.ai.open')}
          aria-label={t('ux.ai.open')}
          onClick={() => setOpen(true)}
        >
          <SparklesIcon size={18} />
        </button>
      )}
    </>
  );
}
