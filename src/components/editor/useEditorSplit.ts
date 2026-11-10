// ==========================================================================
// Resizable editor panels (code / block mode)
//
// Layout: the editor row sits above a bottom dock. The dock holds the console
// and the variables pane side by side, and the side panel keeps the preview.
// All three boundaries are pointer-draggable splitters; sizes live in
// component state. Keyboard users can nudge a focused splitter with arrows.
// ==========================================================================

import { useCallback, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const SIDE_MIN = 220;
const SIDE_MAX = 560;
const DOCK_MIN = 96;
const DOCK_MAX = 460;
const VARS_MIN = 200;
const VARS_MAX = 420;
const STEP = 16;

type Target = 'side' | 'dock' | 'vars';

interface DragState {
  target: Target;
  start: number;
  base: number;
  pointerId: number;
}

export function useEditorSplit() {
  // Width of the preview pane, height of the bottom dock, width of the
  // variables pane (docked to the right of the console).
  const [sideWidth, setSideWidth] = useState(308);
  const [dockHeight, setDockHeight] = useState(196);
  const [varsWidth, setVarsWidth] = useState(260);
  const drag = useRef<DragState | null>(null);

  const startDrag = (target: Target) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      target,
      start: target === 'dock' ? e.clientY : e.clientX,
      base: target === 'side' ? sideWidth : target === 'vars' ? varsWidth : dockHeight,
      pointerId: e.pointerId,
    };
  };

  const onMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.target === 'dock') {
      // Dragging the dock handle up grows the dock.
      setDockHeight(clamp(d.base - (e.clientY - d.start), DOCK_MIN, DOCK_MAX));
    } else if (d.target === 'side') {
      // Dragging a left-side handle left widens the pane.
      setSideWidth(clamp(d.base - (e.clientX - d.start), SIDE_MIN, SIDE_MAX));
    } else {
      setVarsWidth(clamp(d.base - (e.clientX - d.start), VARS_MIN, VARS_MAX));
    }
  }, []);

  const endDrag = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === e.pointerId) drag.current = null;
  }, []);

  const onKey = (target: Target) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? STEP * 3 : STEP;
    if (target === 'dock') {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setDockHeight((h) => clamp(h + step, DOCK_MIN, DOCK_MAX));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setDockHeight((h) => clamp(h - step, DOCK_MIN, DOCK_MAX));
      }
      return;
    }
    const grow = e.key === 'ArrowLeft';
    const shrink = e.key === 'ArrowRight';
    if (!grow && !shrink) return;
    e.preventDefault();
    const set = target === 'side' ? setSideWidth : setVarsWidth;
    set((w) => clamp(w + (grow ? step : -step), target === 'side' ? SIDE_MIN : VARS_MIN, target === 'side' ? SIDE_MAX : VARS_MAX));
  };

  const handle = (target: Target) => ({
    onPointerDown: startDrag(target),
    onPointerMove: onMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onKeyDown: onKey(target),
  });

  return {
    sideWidth,
    dockHeight,
    varsWidth,
    sideHandleProps: handle('side'),
    dockHandleProps: handle('dock'),
    varsHandleProps: handle('vars'),
  };
}
