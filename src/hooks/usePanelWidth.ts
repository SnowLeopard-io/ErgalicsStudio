// Panel width with pointer-drag resize + localStorage persistence.
// Both side rails use this so their widths survive reloads and feel native:
// press on the hairline handle, drag, release — width sticks.
import { useCallback, useEffect, useRef, useState } from 'react';

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export interface PanelWidthBind {
  width: number;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export function usePanelWidth(
  storageKey: string,
  defaultValue: number,
  min: number,
  max: number,
  /** Which edge the handle sits on: 'left' (right panel) or 'right' (sidebar). */
  edge: 'left' | 'right' = 'right',
): PanelWidthBind {
  const [width, setWidth] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved >= min && saved <= max) return saved;
    } catch {
      /* storage unavailable */
    }
    return defaultValue;
  });

  const widthRef = useRef(width);
  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  // Persist on every settled value so a mid-session close keeps the width.
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(width));
    } catch {
      /* storage unavailable */
    }
  }, [storageKey, width]);

  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only the primary button drags; text selection must not start either.
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startW: widthRef.current };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // A handle on a panel's left edge widens the panel when dragged left,
    // so the raw dx must be negated (right-edge handles widen on +dx).
    const dx = edge === 'left' ? drag.startX - e.clientX : e.clientX - drag.startX;
    setWidth(clamp(drag.startW + dx, min, max));
  }, [edge, min, max]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be released */
    }
  }, []);

  return { width, onPointerDown, onPointerMove, onPointerUp };
}
