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
// ==========================================================================

import { useEffect } from 'react';
import { useAiPanelStore } from '@/stores/aiPanelStore';
import { AiAssistantPanel } from './AiAssistantPanel';

export function AiAssistantOverlay() {
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

  if (!open) return null;

  return (
    <div className="ai-overlay">
      <AiAssistantPanel runCode={runHandler ?? undefined} onClose={() => setOpen(false)} />
    </div>
  );
}