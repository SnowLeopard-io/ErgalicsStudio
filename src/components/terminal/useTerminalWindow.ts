// ==========================================================================
// Ergalics Studio — floating terminal window geometry
//
// The terminal is a free-floating window: it can be dragged by its title
// bar and resized from every edge and corner, and it can never leave the
// viewport. This hook owns that geometry (plus its persistence) so the
// panel component stays about the terminal itself.
//
// The maths is pure and lives in `terminal-window.ts` (unit-tested); this
// hook only wires it to pointer events and localStorage.
// ==========================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampRect,
  defaultRect,
  resizeRect,
  type ResizeDir,
  type WindowRect,
} from './terminal-window';

const PREFS_KEY = 'ergalics:terminal-prefs';

interface TerminalPrefs {
  /** Window rectangle in viewport coordinates (left/top/width/height). */
  rect: WindowRect;
}

/** Read the persisted rectangle (migrating the older size+position format). */
function loadPrefs(): TerminalPrefs {
  const fallback: TerminalPrefs = { rect: defaultRect() };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<TerminalPrefs> & {
      w?: number;
      h?: number;
      pos?: { left: number; top: number } | null;
    };
    // Older builds stored a size + an optional position; migrate them.
    const rect: WindowRect = p.rect
      ? { left: p.rect.left, top: p.rect.top, width: p.rect.width, height: p.rect.height }
      : p.pos
        ? { left: p.pos.left, top: p.pos.top, width: p.w ?? fallback.rect.width, height: p.h ?? fallback.rect.height }
        : { ...fallback.rect, width: p.w ?? fallback.rect.width, height: p.h ?? fallback.rect.height };
    return { rect: clampRect(rect) };
  } catch {
    return fallback;
  }
}

export interface TerminalWindow {
  /** Current rectangle (inline style for the window element). */
  rect: WindowRect;
  /** Begin a resize drag on one of the grips. */
  startResize: (dir: ResizeDir) => (e: React.PointerEvent) => void;
  /** Pointer move during a resize drag. */
  onResizeMove: (e: React.PointerEvent) => void;
  /** End a resize drag. */
  endResize: () => void;
  /** Begin dragging the window by its title bar. */
  startDrag: (e: React.PointerEvent) => void;
  /** Pointer move during a title-bar drag. */
  onDragMove: (e: React.PointerEvent) => void;
  /** End a title-bar drag. */
  endDrag: () => void;
}

export function useTerminalWindow(): TerminalWindow {
  const prefs = useRef(loadPrefs());
  const [rect, setRect] = useState<WindowRect>(prefs.current.rect);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const resizeRef = useRef<{ dir: ResizeDir; x: number; y: number; rect: WindowRect } | null>(null);

  // Persist the rectangle whenever it changes.
  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ rect } satisfies TerminalPrefs));
    } catch {
      /* private mode — geometry simply does not persist */
    }
  }, [rect]);

  const startResize = useCallback(
    (dir: ResizeDir) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      resizeRef.current = { dir, x: e.clientX, y: e.clientY, rect };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [rect],
  );

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    const drag = resizeRef.current;
    if (!drag) return;
    setRect(
      resizeRect(drag.rect, drag.dir, e.clientX - drag.x, e.clientY - drag.y, {
        w: window.innerWidth,
        h: window.innerHeight,
      }),
    );
  }, []);

  const endResize = useCallback(() => {
    resizeRef.current = null;
  }, []);

  // Title-bar drag: the window follows the pointer — clamped so it can never
  // leave the viewport. The drag starts ONLY on the bare title bar:
  // pointerdown on a button (close) must not capture the pointer, or the
  // button never receives its click.
  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();
      dragRef.current = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [rect.left, rect.top],
  );

  const onDragMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const left = Math.min(
        Math.max(drag.left + (e.clientX - drag.x), 0),
        window.innerWidth - rect.width,
      );
      const top = Math.min(
        Math.max(drag.top + (e.clientY - drag.y), 0),
        window.innerHeight - rect.height,
      );
      setRect({ ...rect, left, top });
    },
    [rect],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  return { rect, startResize, onResizeMove, endResize, startDrag, onDragMove, endDrag };
}
