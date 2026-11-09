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
//
// Closed, the ball rests as a small "water puddle" tucked into the right
// screen edge. Pointer proximity (or keyboard focus) makes it gather back
// into a full droplet; moving away lets it melt back into the edge. Touch
// devices have no hover, so there the bead simply stays at rest and a tap
// opens the assistant directly — it must never sit permanently expanded.
// ==========================================================================

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';
import { useAiPanelStore } from '@/stores/aiPanelStore';
import { AiAssistantPanel } from './AiAssistantPanel';
import { SparklesIcon } from './icons';

/** How close (px) the pointer must get to the resting puddle to wake it. */
const PROXIMITY_PX = 92;
/** Delay before melting back, so brushing past the corner does not flicker. */
const SLEEP_DELAY_MS = 320;

export function AiAssistantOverlay() {
  const t = useT();
  const open = useAiPanelStore((s) => s.open);
  const runHandler = useAiPanelStore((s) => s.runHandler);
  const setOpen = useAiPanelStore((s) => s.setOpen);
  const [awake, setAwake] = useState(false);
  const dockRef = useRef<HTMLSpanElement | null>(null);

  // Esc dismisses the floating window without stealing focus from the canvas.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Proximity wake-up. A tiny fixed anchor (not the button itself) is used so
  // the detection radius does not move while the droplet expands/collapses —
  // that would otherwise create a feedback loop at the threshold.
  useEffect(() => {
    if (open) {
      setAwake(false);
      return;
    }
    if (window.matchMedia?.('(pointer: coarse)').matches) {
      // No hover proximity on touch: keep the bead at rest. Tapping it opens
      // the panel (the button's onClick), so the droplet never stays expanded.
      setAwake(false);
      return;
    }

    let raf = 0;
    let sleepTimer = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const anchor = dockRef.current;
        if (!anchor) return;
        const r = anchor.getBoundingClientRect();
        const distance = Math.hypot(e.clientX - r.left, e.clientY - r.top);
        if (distance <= PROXIMITY_PX) {
          if (sleepTimer) {
            window.clearTimeout(sleepTimer);
            sleepTimer = 0;
          }
          setAwake(true);
        } else if (!sleepTimer) {
          sleepTimer = window.setTimeout(() => {
            sleepTimer = 0;
            setAwake(false);
          }, SLEEP_DELAY_MS);
        }
      });
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) window.cancelAnimationFrame(raf);
      if (sleepTimer) window.clearTimeout(sleepTimer);
    };
  }, [open]);

  return (
    <>
      <div className={`ai-overlay${open ? '' : ' is-closed'}`} aria-hidden={!open}>
        <AiAssistantPanel runCode={runHandler ?? undefined} onClose={() => setOpen(false)} />
      </div>
      {!open && (
        <>
          <span ref={dockRef} className="ai-fab-anchor" aria-hidden="true" />
          <button
            type="button"
            className={`ai-fab${awake ? '' : ' is-puddle'}`}
            title={t('ux.ai.open')}
            aria-label={t('ux.ai.open')}
            onFocus={() => {
              // Touch focus follows the tap that opens the panel; waking the
              // droplet here would leave it expanded forever after closing.
              if (!window.matchMedia?.('(pointer: coarse)').matches) setAwake(true);
            }}
            onBlur={() => {
              // Coarse pointers have no hover: keep the droplet gathered.
              if (!window.matchMedia?.('(pointer: coarse)').matches) setAwake(false);
            }}
            onClick={() => setOpen(true)}
          >
            <span className="ai-fab-icon">
              <SparklesIcon size={18} />
            </span>
          </button>
        </>
      )}
    </>
  );
}
